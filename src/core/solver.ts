// Human-style logical solver.
//
// Tiers (always the lowest available tier is used):
//   1  a single constraint forces a cell (the global counter alone included: "0 left" / "all left")
//   2  two constraints that share unknown cells jointly force a cell
//   3  three connected constraints, or the global counter together with one/two constraints, or the
//      counter with a small packing of disjoint clues ("these clues already hold every remaining crystal")
//   4  contradiction search: assume a value, propagate with tiers 1–2, reach a contradiction (bounded);
//      also the counter with a large packing of disjoint clues
//
// Joint reasoning is exact: plain sums are combined by enumerating crystal counts per Venn region
// (cells in the same region are interchangeable), everything else (together/apart, eye, parity,
// links) by a backtracking search over cells that uses the exact partial `feasible()` of rules.ts.
// The global counter is never enumerated cell by cell: cells outside the combined constraints are
// summarised as one "outside" region of known size.

import { buildBoard, cellConstraintsAll, chainFlood, effectiveClue, feasible, hasFog, rayInfo, staticConstraints, type Board, type Constraint } from './rules';
import type { Level, MechanicId } from './types';

export type Tier = 1 | 2 | 3 | 4;

export interface Deduction {
  cell: number;
  gem: boolean;
  reasons: Constraint[];
  tier: Tier;
}

export interface SolveReport {
  solved: boolean;
  /** Number of deduction events (one event = one set of reasons forcing one or more cells). */
  steps: number;
  /** Deduction events per tier. */
  tierCounts: [number, number, number, number];
  difficulty: number; // 1..10
  stuckAt?: Int8Array;
}

export interface SolveOptions {
  maxTier?: Tier;
  /** Ignore the global crystal counter. */
  noGlobal?: boolean;
  /**
   * Pretend a mechanic does not exist: constraints tagged with it are dropped
   * (for together/apart only the modifier is dropped). Used to check that a mechanic is needed.
   */
  exclude?: MechanicId;
  /** Record the reasons of every event in the detailed report. */
  trace?: boolean;
}

export interface SolveEvent {
  tier: Tier;
  reasons: Constraint[];
  cells: number[];
}

export interface DetailedReport extends SolveReport {
  events: SolveEvent[];
  /** Number of cells deduced at each tier. */
  cellTierCounts: [number, number, number, number];
}

// ---------------------------------------------------------------------------------------------

interface CI {
  c: Constraint;
  /** Cells the constraint depends on (chain: its scope). */
  dep: number[];
  plain: boolean;
  changed: number;
  checked1: number;
}

interface Res {
  forced: number[]; // cell * 2 + value
  contra: boolean;
}

interface Found {
  tier: Tier;
  members: number[]; // indexes into ctx.list, G = global
  forced: number[];
  cost: number;
}

const G = -1;
const EMPTY: Res = { forced: [], contra: false };
const CONTRA: Res = { forced: [], contra: true };

const REGION_NODE_CAP = 20000;
const DFS_SEARCH_CAP = 6000;
const DFS_TOTAL_CAP = 15000;
const TRIPLE_MAX_UNKNOWN = 22;
const HYP_MAX_ASSIGN = 40;
const HYP_MAX_PAIRS = 90;

class Ctx {
  readonly n: number;
  readonly vals: Int8Array;
  readonly list: CI[] = [];
  glob: Constraint | null = null;
  readonly cellCons: number[][];
  U = 0;
  K = 0;
  time = 1;
  readonly mask: Int32Array;
  private cstamp: number[] = [];
  private stampV = 0;
  readonly memo = new Map<number, number>();
  /** Last time any constraint containing the cell was added or changed. */
  readonly cellStamp: Int32Array;
  /** Scratch for cellOptions(). */
  readonly opt: Uint8Array;
  private hypMemo = new Map<number, { t: number; cells: number[]; R: number; S: number; minR: number; minS: number }>();

  constructor(readonly board: Board, vals: ArrayLike<number>) {
    this.n = board.n;
    this.vals = Int8Array.from(vals);
    this.cellCons = [];
    for (let i = 0; i < this.n; i++) this.cellCons.push([]);
    this.mask = new Int32Array(this.n);
    this.cellStamp = new Int32Array(this.n);
    this.opt = new Uint8Array(this.n);
    for (let i = 0; i < this.n; i++) {
      if (this.vals[i] === -1) this.U++;
      else if (this.vals[i] === 1) this.K++;
    }
  }

  add(c: Constraint): void {
    if (c.src.type === 'global') {
      this.glob = c;
      return;
    }
    const idx = this.list.length;
    const dep = c.scope ?? c.cells;
    this.list.push({ c, dep, plain: c.kind === 'sum' && !c.mod, changed: ++this.time, checked1: 0 });
    this.cstamp.push(0);
    for (const x of dep) {
      const cc = this.cellCons[x];
      if (cc[cc.length - 1] !== idx) cc.push(idx);
      this.cellStamp[x] = this.time;
    }
  }

  set(x: number, v: number): void {
    this.vals[x] = v;
    this.U--;
    if (v === 1) this.K++;
    const t = ++this.time;
    this.cellStamp[x] = t;
    for (const a of this.cellCons[x]) {
      const ci = this.list[a];
      ci.changed = t;
      for (const y of ci.dep) this.cellStamp[y] = t;
    }
  }

  /** Fog: cells the player can see (null = everything). Deductions may only target visible cells. */
  vis: Uint8Array | null = null;

  visible(x: number): boolean {
    return !this.vis || this.vis[x] === 1;
  }

  /** Set when a deduction was dropped because its cells are fogged. */
  filtered = false;

  usable(forced: number[]): number[] {
    if (!this.vis || !forced.length) return forced;
    const u = forced.filter((e) => this.vis![e >> 1] === 1);
    if (u.length < forced.length) this.filtered = true;
    return u;
  }

  member(m: number): Constraint {
    return m === G ? this.glob! : this.list[m].c;
  }

  remaining(): number {
    return this.glob ? this.glob.value - this.K : 0;
  }

  alive(a: number): boolean {
    for (const x of this.list[a].dep) if (this.vals[x] === -1) return true;
    return false;
  }

  unknownCount(a: number): number {
    let u = 0;
    for (const x of this.list[a].dep) if (this.vals[x] === -1) u++;
    return u;
  }

  /** Constraints sharing at least one unknown cell with constraint a (a excluded). */
  neigh(a: number): number[] {
    const s = ++this.stampV;
    const out: number[] = [];
    const st = this.cstamp;
    st[a] = s;
    for (const x of this.list[a].dep)
      if (this.vals[x] === -1)
        for (const b of this.cellCons[x])
          if (st[b] !== s) {
            st[b] = s;
            out.push(b);
          }
    return out;
  }

  /** Union size of the cells the members talk about (what the UI highlights). */
  cost(members: number[]): number {
    if (members.includes(G)) return this.n + members.length;
    const seen = new Set<number>();
    for (const m of members) for (const x of this.list[m].c.cells) seen.add(x);
    return seen.size;
  }

  // ----- tier 1 -------------------------------------------------------------------------------

  single(a: number): Res {
    const c = this.list[a].c;
    const vals = this.vals;
    if (this.list[a].plain) {
      let gems = 0, unk = 0;
      for (const x of c.cells) {
        const v = vals[x];
        if (v === 1) gems++;
        else if (v === -1) unk++;
      }
      const need = c.value - gems;
      if (need < 0 || need > unk) return CONTRA;
      if (unk === 0 || (need > 0 && need < unk)) return EMPTY;
      const v = need === 0 ? 0 : 1;
      const forced: number[] = [];
      for (const x of c.cells) if (vals[x] === -1) forced.push(x * 2 + v);
      return { forced, contra: false };
    }
    const opt = this.opt;
    if (!cellOptions(c, vals, opt)) return CONTRA;
    let forced: number[] | null = null;
    for (const x of this.list[a].dep) {
      if (vals[x] !== -1) continue;
      const o = opt[x];
      if (o === 0) return CONTRA;
      if (o !== 3) (forced ??= []).push(x * 2 + (o === 2 ? 1 : 0));
    }
    return forced ? { forced, contra: false } : EMPTY;
  }

  singleGlobal(): Res {
    if (!this.glob) return EMPTY;
    const R = this.remaining();
    if (R < 0 || R > this.U) return CONTRA;
    if (this.U === 0 || (R > 0 && R < this.U)) return EMPTY;
    const v = R === 0 ? 0 : 1;
    const forced: number[] = [];
    for (let x = 0; x < this.n; x++) if (this.vals[x] === -1) forced.push(x * 2 + v);
    return { forced, contra: false };
  }

  // ----- joint analysis -----------------------------------------------------------------------

  analyze(members: number[], withGlobal: boolean): Res {
    if (withGlobal && !this.glob) return EMPTY;
    for (const m of members) if (this.list[m].c.kind === 'chain' && chainRegion(this.list[m].c, this.vals).length > 8) return EMPTY;
    for (const m of members) if (!this.list[m].plain) return this.dfs(members, withGlobal);
    return this.regions(members, withGlobal);
  }

  /** Exact joint analysis of plain sum constraints via crystal counts per Venn region. */
  private regions(members: number[], withGlobal: boolean): Res {
    const k = members.length;
    const vals = this.vals, mask = this.mask;
    const touched: number[] = [];
    const needs = new Int32Array(k);
    for (let i = 0; i < k; i++) {
      const c = this.list[members[i]].c;
      let gems = 0;
      for (const x of c.cells) {
        const v = vals[x];
        if (v === 1) gems++;
        else if (v === -1) {
          if (mask[x] === 0) touched.push(x);
          mask[x] |= 1 << i;
        }
      }
      needs[i] = c.value - gems;
    }
    const reset = () => {
      for (const x of touched) mask[x] = 0;
    };
    const M = 1 << k;
    const size = new Int32Array(M);
    for (const x of touched) size[mask[x]]++;
    const regs: number[] = [];
    const regIdx = new Int32Array(M).fill(-1);
    // regions shared by more constraints first: they decide the most
    for (let pc = k; pc >= 1; pc--)
      for (let m = 1; m < M; m++)
        if (size[m] && popcount(m) === pc) {
          regIdx[m] = regs.length;
          regs.push(m);
        }
    const nr = regs.length;
    const R = withGlobal ? this.remaining() : 0;
    const F = withGlobal ? this.U - touched.length : 0;
    for (let i = 0; i < k; i++)
      if (needs[i] < 0) {
        reset();
        return CONTRA;
      }
    if (withGlobal && (R < 0 || R > this.U)) {
      reset();
      return CONTRA;
    }
    const capAfter = new Int32Array((nr + 1) * k);
    const totAfter = new Int32Array(nr + 1);
    for (let j = nr - 1; j >= 0; j--) {
      const m = regs[j], s = size[m];
      totAfter[j] = totAfter[j + 1] + s;
      for (let i = 0; i < k; i++) capAfter[j * k + i] = capAfter[(j + 1) * k + i] + ((m >> i) & 1 ? s : 0);
    }
    const lo = new Int32Array(nr).fill(1 << 30);
    const hi = new Int32Array(nr).fill(-1);
    let outLo = 1 << 30, outHi = -1;
    let sols = 0, nodes = 0;
    let capped = false, done = false;
    const sums = new Int32Array(k);
    const cnt = new Int32Array(nr);
    const allOpen = (): boolean => {
      for (let j = 0; j < nr; j++) if (lo[j] !== 0 || hi[j] !== size[regs[j]]) return false;
      if (withGlobal && F > 0 && (outLo !== 0 || outHi !== F)) return false;
      return true;
    };
    const rec = (j: number, total: number): void => {
      if (++nodes > REGION_NODE_CAP) {
        capped = done = true;
        return;
      }
      if (j === nr) {
        for (let i = 0; i < k; i++) if (sums[i] !== needs[i]) return;
        if (withGlobal) {
          const out = R - total;
          if (out < 0 || out > F) return;
          if (out < outLo) outLo = out;
          if (out > outHi) outHi = out;
        }
        sols++;
        for (let t = 0; t < nr; t++) {
          if (cnt[t] < lo[t]) lo[t] = cnt[t];
          if (cnt[t] > hi[t]) hi[t] = cnt[t];
        }
        if (allOpen()) done = true;
        return;
      }
      const m = regs[j];
      let cmin = 0, cmax = size[m];
      const base = (j + 1) * k;
      for (let i = 0; i < k; i++) {
        const rem = needs[i] - sums[i];
        if ((m >> i) & 1) {
          if (rem < cmax) cmax = rem;
          const mn = rem - capAfter[base + i];
          if (mn > cmin) cmin = mn;
        } else if (rem > capAfter[base + i]) return;
      }
      if (withGlobal) {
        const rem = R - total;
        if (rem < cmax) cmax = rem;
        const mn = rem - totAfter[j + 1] - F;
        if (mn > cmin) cmin = mn;
      }
      for (let c = cmin; c <= cmax && !done; c++) {
        cnt[j] = c;
        for (let i = 0; i < k; i++) if ((m >> i) & 1) sums[i] += c;
        rec(j + 1, total + c);
        for (let i = 0; i < k; i++) if ((m >> i) & 1) sums[i] -= c;
      }
    };
    rec(0, 0);
    if (capped) {
      reset();
      return EMPTY;
    }
    if (sols === 0) {
      reset();
      return CONTRA;
    }
    let forced: number[] | null = null;
    for (const x of touched) {
      const j = regIdx[mask[x]];
      if (hi[j] === 0) (forced ??= []).push(x * 2);
      else if (lo[j] === size[regs[j]]) (forced ??= []).push(x * 2 + 1);
    }
    if (withGlobal && F > 0 && (outHi === 0 || outLo === F)) {
      const v = outHi === 0 ? 0 : 1;
      for (let x = 0; x < this.n; x++) if (vals[x] === -1 && mask[x] === 0) (forced ??= []).push(x * 2 + v);
    }
    reset();
    return forced ? { forced, contra: false } : EMPTY;
  }

  /** Exact joint analysis of arbitrary constraints by backtracking over their unknown cells. */
  private dfs(members: number[], withGlobal: boolean): Res {
    const vals = this.vals, mask = this.mask;
    const cons = members.map((m) => this.list[m].c);
    const vars: number[] = [];
    for (let i = 0; i < cons.length; i++)
      for (const x of cons[i].kind === 'chain' ? chainRegion(cons[i], vals) : cons[i].cells)
        if (vals[x] === -1) {
          if (mask[x] === 0) vars.push(x);
          mask[x] |= 1 << i;
        }
    const masks = vars.map((x) => mask[x]);
    const reset = () => {
      for (const x of vars) mask[x] = 0;
    };
    for (const c of cons)
      if (!feasible(c, vals)) {
        reset();
        return CONTRA;
      }
    const R = withGlobal ? this.remaining() : 0;
    const F = withGlobal ? this.U - vars.length : 0;
    if (withGlobal && (R < 0 || R > this.U)) {
      reset();
      return CONTRA;
    }
    // shared cells first
    const order = vars.map((_, i) => i).sort((a, b) => popcount(masks[b]) - popcount(masks[a]) || a - b);
    const V = order.map((i) => vars[i]);
    const VM = order.map((i) => masks[i]);
    const m = V.length;
    const varCons: Constraint[][] = VM.map((mk) => cons.filter((_, i) => (mk >> i) & 1));
    // Without the counter, members only interact through shared cells: once those are assigned and
    // every member is still feasible (feasible() is exact), a completion of the private cells exists.
    let shared = 0;
    while (shared < m && popcount(VM[shared]) >= 2) shared++;
    const poss = new Uint8Array(m); // bit0: can be safe, bit1: can be crystal
    if (!withGlobal && shared <= 8) {
      // enumerate assignments of the shared cells; for each, every private cell is decided by its
      // own constraint alone (exact feasible)
      let sols = 0, nodes = 0, capped = false, done = false;
      const plainM = members.map((mm) => this.list[mm].plain);
      const privBits = new Uint8Array(cons.length);
      const privOwner = VM.map((mk) => 31 - Math.clz32(mk));
      const opt = this.opt;
      const leaf = () => {
        sols++;
        let open = true;
        for (let t = 0; t < shared; t++) {
          poss[t] |= vals[V[t]] === 1 ? 2 : 1;
          if (poss[t] !== 3) open = false;
        }
        // plain members: private cells can be a crystal iff need >= 1, safe iff need <= unknown - 1
        for (let i = 0; i < cons.length; i++) {
          if (!plainM[i]) continue;
          const c = cons[i];
          let gems = 0, unk = 0;
          for (const x of c.cells) {
            const v = vals[x];
            if (v === 1) gems++;
            else if (v === -1) unk++;
          }
          const need = c.value - gems;
          privBits[i] = (need <= unk - 1 ? 1 : 0) | (need >= 1 ? 2 : 0);
        }
        let optDone = 0;
        for (let t = shared; t < m; t++) {
          if (poss[t] === 3) continue;
          const owner = privOwner[t];
          if (plainM[owner]) {
            poss[t] |= privBits[owner];
            if (poss[t] !== 3) open = false;
            continue;
          }
          if (!((optDone >> owner) & 1)) {
            cellOptions(cons[owner], vals, opt);
            optDone |= 1 << owner;
          }
          poss[t] |= opt[V[t]];
          if (poss[t] !== 3) open = false;
        }
        if (open) done = true;
      };
      const enumerate = (k: number): void => {
        if ((nodes += 1 + (k === shared ? m - shared : 0)) > DFS_TOTAL_CAP) {
          capped = done = true;
          return;
        }
        if (k === shared) {
          leaf();
          return;
        }
        const x = V[k];
        for (let v = 0; v < 2 && !done; v++) {
          vals[x] = v;
          let ok = true;
          for (const c of varCons[k])
            if (!feasible(c, vals)) {
              ok = false;
              break;
            }
          if (ok) enumerate(k + 1);
          vals[x] = -1;
        }
      };
      enumerate(0);
      reset();
      if (capped) return EMPTY;
      if (!sols) return CONTRA;
      let forced: number[] | null = null;
      for (let t = 0; t < m; t++) if (poss[t] !== 3) (forced ??= []).push(V[t] * 2 + (poss[t] === 2 ? 1 : 0));
      return forced ? { forced, contra: false } : EMPTY;
    }
    // full backtracking (counter involved / many shared cells) only on small unions
    if (m > 18) {
      reset();
      return EMPTY;
    }
    const limit = m;
    let outGem = false, outSafe = false;
    const gLo0 = withGlobal ? R - F : -1;
    const gHi0 = withGlobal ? R : m + 1;
    let nodes = 0, total = 0, capped = false;
    let gLo = gLo0, gHi = gHi0, fixK = -1;
    const rec = (k: number, g: number): boolean => {
      if (++nodes > DFS_SEARCH_CAP) {
        capped = true;
        return false;
      }
      if (k === limit) {
        if (g < gLo || g > gHi) return false;
        for (let t = 0; t < limit; t++) poss[t] |= vals[V[t]] === 1 ? 2 : 1;
        if (fixK >= limit) poss[fixK] |= vals[V[fixK]] === 1 ? 2 : 1;
        if (withGlobal) {
          const out = R - g;
          if (out > 0) outGem = true;
          if (out < F) outSafe = true;
        }
        return true;
      }
      if (k === fixK) return rec(k + 1, g);
      const x = V[k];
      const first = poss[k] & 2 ? 0 : 1;
      for (let t = 0; t < 2; t++) {
        const v = t === 0 ? first : 1 - first;
        if (v === 1 && g + 1 > gHi) continue;
        if (v === 0 && g + (m - k - 1) < gLo) continue;
        vals[x] = v;
        let ok = true;
        for (const c of varCons[k])
          if (!feasible(c, vals)) {
            ok = false;
            break;
          }
        const r = ok && rec(k + 1, g + v);
        vals[x] = -1;
        if (r) return true;
        if (capped) return false;
      }
      return false;
    };
    const search = (fk: number, fv: number, lo: number, hi: number): boolean | null => {
      if (total > DFS_TOTAL_CAP) return null;
      nodes = 0;
      capped = false;
      gLo = lo;
      gHi = hi;
      fixK = fk;
      let r: boolean;
      if (fk >= 0) {
        const x = V[fk];
        vals[x] = fv;
        let ok = true;
        for (const c of varCons[fk])
          if (!feasible(c, vals)) {
            ok = false;
            break;
          }
        r = ok && rec(0, fv);
        vals[x] = -1;
      } else r = rec(0, 0);
      total += nodes;
      fixK = -1;
      return capped ? null : r;
    };
    const first = search(-1, 0, gLo0, gHi0);
    if (first !== true) {
      reset();
      return first === false ? CONTRA : EMPTY;
    }
    let forced: number[] | null = null;
    for (let k = 0; k < m; k++)
      for (let v = 0; v < 2; v++) {
        if (poss[k] & (1 << v)) continue;
        const r = search(k, v, gLo0, gHi0);
        if (r === false) (forced ??= []).push(V[k] * 2 + (1 - v));
      }
    if (withGlobal && F > 0) {
      let outV = -1;
      if (!outGem && search(-1, 0, gLo0, R - 1) === false) outV = 0;
      else if (!outSafe && search(-1, 0, R - F + 1, gHi0) === false) outV = 1;
      if (outV >= 0) for (let x = 0; x < this.n; x++) if (vals[x] === -1 && mask[x] === 0) (forced ??= []).push(x * 2 + outV);
    }
    reset();
    return forced ? { forced, contra: false } : EMPTY;
  }

  // ----- tiers --------------------------------------------------------------------------------

  tier1(best: boolean): Found | null {
    let bestF: Found | null = null;
    for (let a = 0; a < this.list.length; a++) {
      const u = this.usable(this.single(a).forced);
      if (!u.length) continue;
      const f: Found = { tier: 1, members: [a], forced: u, cost: this.list[a].c.cells.length };
      if (!best) return f;
      if (!bestF || f.cost < bestF.cost) bestF = f;
    }
    if (!bestF) {
      const u = this.usable(this.singleGlobal().forced);
      if (u.length) bestF = { tier: 1, members: [G], forced: u, cost: this.n };
    }
    return bestF;
  }

  clean2 = 0;
  clean3 = 0;

  /** Visibility grew: results discarded because of fog may be usable now. */
  visibilityChanged(): void {
    this.clean2 = this.clean3 = 0;
    this.memo.clear();
    for (const ci of this.list) ci.checked1 = 0;
    this.filtered = false;
  }

  /** Constraints with unknown cells; in incremental mode only those changed since `since`. */
  private aliveList(since: number): number[] {
    const out: number[] = [];
    for (let a = 0; a < this.list.length; a++) if (this.list[a].changed > since && this.alive(a)) out.push(a);
    return out;
  }

  /** The counter can only matter when few crystals or few safe cells remain compared to the region. */
  private globalUseful(members: number[]): boolean {
    const u = this.unionUnknown(members);
    const R = this.remaining();
    return R <= u || this.U - R <= u;
  }

  tier2(best: boolean): Found | null {
    let bestF: Found | null = null;
    const since = best ? 0 : this.clean2;
    for (const a of this.aliveList(since)) {
      const ca = this.list[a].changed;
      for (const b of this.neigh(a)) {
        if (best && b <= a) continue;
        const key2 = a < b ? a * 4096 + b : b * 4096 + a;
        const ch = Math.max(ca, this.list[b].changed);
        if (!best && (this.memo.get(key2) ?? -1) >= ch) continue;
        const r = this.analyze([a, b], false);
        const u = this.usable(r.forced);
        if (u.length) {
          const f: Found = { tier: 2, members: [a, b], forced: u, cost: best ? this.cost([a, b]) : 0 };
          if (!best) return f;
          if (!bestF || f.cost < bestF.cost) bestF = f;
        } else if (!best && !r.forced.length) this.memo.set(key2, this.time);
      }
    }
    if (!best) this.clean2 = this.time;
    return bestF;
  }

  tier3(best: boolean): Found | null {
    let bestF: Found | null = null;
    const consider = (f: Found): boolean => {
      if (!best) {
        bestF = f;
        return true;
      }
      if (!bestF || f.cost < bestF.cost) bestF = f;
      return false;
    };
    const alive = this.aliveList(0);
    // global + single
    if (this.glob) {
      for (const a of alive) {
        if (!this.globalUseful([a])) continue;
        const u = this.usable(this.analyze([a], true).forced);
        if (u.length && consider({ tier: 3, members: [G, a], forced: u, cost: this.n + 1 })) return bestF;
      }
    }
    // connected triples containing at least one constraint changed since the last clean scan
    const nc = new Map<number, number[]>();
    const N = (a: number) => {
      let r = nc.get(a);
      if (!r) nc.set(a, (r = this.neigh(a)));
      return r;
    };
    const visited = new Set<number>();
    const dirty = best ? alive : this.aliveList(this.clean3);
    for (const a of dirty) {
      const na = N(a);
      const ca = this.list[a].changed;
      for (const b of na) {
        const nb = N(b);
        const cab = Math.max(ca, this.list[b].changed);
        for (let t = 0; t < na.length + nb.length; t++) {
          const c = t < na.length ? na[t] : nb[t - na.length];
          if (c === a || c === b) continue;
          const [x, y, z] = sort3(a, b, c);
          const k3 = (x * 2048 + y) * 2048 + z;
          if (visited.has(k3)) continue;
          visited.add(k3);
          const ch = Math.max(cab, this.list[c].changed);
          if (!best && (this.memo.get(k3) ?? -1) >= ch) continue;
          const plain3 = this.list[x].plain && this.list[y].plain && this.list[z].plain;
          if (this.unionUnknown([x, y, z]) > (plain3 ? TRIPLE_MAX_UNKNOWN : 14)) {
            if (!best) this.memo.set(k3, this.time);
            continue;
          }
          const r = this.analyze([x, y, z], false);
          const u = this.usable(r.forced);
          if (u.length) {
            if (consider({ tier: 3, members: [x, y, z], forced: u, cost: best ? this.cost([x, y, z]) : 0 })) return bestF;
          } else if (!best && !r.forced.length) this.memo.set(k3, this.time);
        }
      }
    }
    if (this.glob) {
      // global + connected pair
      for (const a of alive)
        for (const b of N(a)) {
          if (b <= a || !this.globalUseful([a, b])) continue;
          const u = this.usable(this.analyze([a, b], true).forced);
          if (u.length && consider({ tier: 3, members: [G, a, b], forced: u, cost: this.n + 2 })) return bestF;
        }
      const p = this.packing(alive, 3);
      if (p && consider(p)) return bestF;
    }
    if (!best) this.clean3 = this.time;
    return bestF;
  }

  tier4(best: boolean): Found | null {
    const L = this.list.length;
    const alive: number[] = [];
    for (let a = 0; a < L; a++) if (this.alive(a)) alive.push(a);
    if (this.glob) {
      const p = this.packing(alive, 1 << 30);
      if (p) {
        p.tier = 4;
        return p;
      }
    }
    // frontier cells, most constrained first
    const score = new Float64Array(this.n).fill(Infinity);
    const front: number[] = [];
    for (const a of alive) {
      const u = this.unknownCount(a);
      for (const x of this.list[a].c.cells)
        if (this.vals[x] === -1 && this.visible(x)) {
          if (score[x] === Infinity) front.push(x);
          if (u < score[x]) score[x] = u;
        }
    }
    front.sort((x, y) => score[x] - score[y] || x - y);
    let bestF: Found | null = null;
    let bestHyp: [number, number] | null = null;
    // phase 0: propagate with single constraints only (cheap, simplest chains); phase 1: with pairs
    // (bounded: the full search with pairs only tries the most constrained cells)
    for (let phase = 0; phase < 2 && !bestF; phase++)
    for (const x of phase === 0 || best ? front : front.slice(0, 40))
      for (const v of [1, 0]) {
        const reasons = this.hyp(x, v, null, HYP_MAX_ASSIGN, phase === 0 ? 0 : HYP_MAX_PAIRS);
        if (!reasons) continue;
        const f: Found = { tier: 4, members: reasons, forced: [x * 2 + (1 - v)], cost: best ? this.cost(reasons) : 0 };
        if (!best) return f;
        if (!bestF || f.cost < bestF.cost) {
          bestF = f;
          bestHyp = [x, v];
        }
      }
    if (bestF && bestHyp) {
      // shrink the reasons to a minimal set that still yields the contradiction
      let members = bestF.members.slice();
      for (const m of bestF.members) {
        const trial = members.filter((t) => t !== m);
        if (this.hyp(bestHyp[0], bestHyp[1], new Set(trial), 4 * HYP_MAX_ASSIGN, 4 * HYP_MAX_PAIRS)) members = trial;
      }
      bestF.members = members;
    }
    return bestF;
  }

  private ustamp = new Int32Array(0);
  private ustampV = 0;
  private unionUnknown(members: number[]): number {
    if (this.ustamp.length !== this.n) this.ustamp = new Int32Array(this.n);
    const st = this.ustamp, s = ++this.ustampV;
    let u = 0;
    for (const m of members)
      for (const x of this.list[m].dep)
        if (this.vals[x] === -1 && st[x] !== s) {
          st[x] = s;
          u++;
        }
    return u;
  }

  /**
   * Global counter + a packing of disjoint plain clues whose remaining crystals (or remaining safe
   * cells) add up to all that is left: everything outside the packing is decided.
   */
  private packing(alive: number[], maxMembers: number): Found | null {
    const R = this.remaining();
    const S = this.U - R;
    const info: { a: number; need: number; unk: number }[] = [];
    for (const a of alive) {
      if (!this.list[a].plain) continue;
      const c = this.list[a].c;
      let gems = 0, unk = 0;
      for (const x of c.cells) {
        if (this.vals[x] === 1) gems++;
        else if (this.vals[x] === -1) unk++;
      }
      info.push({ a, need: c.value - gems, unk });
    }
    for (const side of [0, 1]) {
      const target = side === 0 ? R : S;
      if (target <= 0) continue;
      const w = (t: { need: number; unk: number }) => (side === 0 ? t.need : t.unk - t.need);
      const cand = info.filter((t) => w(t) > 0);
      // exact search for a disjoint selection hitting the target, fewest members first
      cand.sort((p, q) => w(q) - w(p) || p.unk - q.unk || p.a - q.a);
      const cells = cand.map((t) => this.list[t.a].c.cells.filter((x) => this.vals[x] === -1));
      const ws = cand.map(w);
      const suffix = new Array<number>(cand.length + 1).fill(0);
      for (let i = cand.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + ws[i];
      if (suffix[0] < target) continue;
      const usedC = new Uint8Array(this.n);
      const chosen: number[] = [];
      let nodes = 0;
      let covered = 0;
      const dfs = (i: number, sum: number, left: number): boolean => {
        if (sum === target) return covered < this.U;
        if (left === 0 || i >= cand.length || sum + suffix[i] < target || ++nodes > 20000) return false;
        for (let j = i; j < cand.length; j++) {
          if (sum + ws[j] > target) continue;
          if (sum + suffix[j] < target) break;
          const cj = cells[j];
          let ok = true;
          for (const x of cj) if (usedC[x]) { ok = false; break; }
          if (!ok) continue;
          for (const x of cj) usedC[x] = 1;
          covered += cj.length;
          chosen.push(j);
          if (dfs(j + 1, sum + ws[j], left - 1)) return true;
          chosen.pop();
          covered -= cj.length;
          for (const x of cj) usedC[x] = 0;
        }
        return false;
      };
      const maxK = Math.min(maxMembers, cand.length);
      for (let k = 1; k <= maxK && nodes <= 20000; k++) {
        if (!dfs(0, 0, k)) continue;
        const members = chosen.map((j) => cand[j].a);
        const v = side === 0 ? 0 : 1;
        const forced: number[] = [];
        for (let x = 0; x < this.n; x++) if (this.vals[x] === -1 && !usedC[x] && this.visible(x)) forced.push(x * 2 + v);
        if (!forced.length) return null;
        return { tier: 3, members: [G, ...members], forced, cost: this.n + members.length };
      }
    }
    return null;
  }

  /**
   * Assume vals[x] = v and propagate with tiers 1–2 (restricted to `allowed` constraints).
   * Returns the constraints used when a contradiction is reached, else null. State is restored.
   */
  hyp(x: number, v: number, allowed: Set<number> | null, maxAssign: number, maxPairs: number): number[] | null {
    const vals = this.vals;
    const mkey = x * 4 + v * 2 + (maxPairs > 0 ? 1 : 0);
    if (!allowed) {
      // a previous run that found nothing is still valid if nothing it looked at has changed
      const m = this.hypMemo.get(mkey);
      if (m) {
        let valid = true;
        for (const y of m.cells)
          if (this.cellStamp[y] > m.t) {
            valid = false;
            break;
          }
        if (valid && this.glob) {
          const R = this.remaining(), S = this.U - R;
          if (m.minR - (m.R - R) <= 0 || m.minS - (m.S - S) <= 0) valid = false;
        }
        if (valid) return null;
      }
    }
    const examined = allowed ? null : new Set<number>();
    const R0 = this.remaining(), S0 = this.U - R0;
    let minR = Infinity, minS = Infinity;
    const trail: number[] = [];
    const used = new Set<number>();
    const queue: number[] = [];
    const touched = new Set<number>();
    const ok = (a: number) => !allowed || allowed.has(a);
    const assign = (y: number, w: number) => {
      vals[y] = w;
      this.U--;
      if (w === 1) this.K++;
      trail.push(y);
      for (const a of this.cellCons[y])
        if (ok(a)) {
          queue.push(a);
          touched.add(a);
        }
    };
    let contra = false;
    let pairs = 0;
    assign(x, v);
    const applyForced = (forced: number[]): boolean => {
      for (const f of forced) {
        const y = f >> 1;
        if (vals[y] === -1) {
          if (trail.length >= maxAssign) return false;
          assign(y, f & 1);
        }
      }
      return true;
    };
    outer: for (;;) {
      while (queue.length) {
        const a = queue.pop()!;
        examined?.add(a);
        const r = this.single(a);
        if (r.contra) {
          used.add(a);
          contra = true;
          break outer;
        }
        if (r.forced.length) {
          used.add(a);
          if (!applyForced(r.forced)) break outer;
        }
      }
      if (this.glob && ok(G)) {
        const R = this.remaining();
        if (R < minR) minR = R;
        if (this.U - R < minS) minS = this.U - R;
        const r = this.singleGlobal();
        if (r.contra) {
          used.add(G);
          contra = true;
          break;
        }
        if (r.forced.length) {
          used.add(G);
          if (!applyForced(r.forced)) break;
          continue;
        }
      }
      let progress = false;
      const ts = [...touched];
      touched.clear();
      for (let ti = 0; ti < ts.length && !progress; ti++) {
        const a = ts[ti];
        for (const b of this.neigh(a)) {
          if (!ok(b)) continue;
          if (++pairs > maxPairs) break outer;
          examined?.add(b);
          const r = this.analyze([a, b], false);
          if (r.contra) {
            used.add(a);
            used.add(b);
            contra = true;
            break outer;
          }
          if (r.forced.length) {
            used.add(a);
            used.add(b);
            if (!applyForced(r.forced)) break outer;
            progress = true;
            // constraints not yet pair-checked in this pass stay touched
            for (let tj = ti; tj < ts.length; tj++) touched.add(ts[tj]);
            break;
          }
        }
      }
      if (!progress) break;
    }
    for (const y of trail) {
      if (vals[y] === 1) this.K--;
      vals[y] = -1;
      this.U++;
    }
    if (contra) return [...used];
    if (examined && !used.has(G)) {
      const cells = new Set<number>();
      for (const a of examined) for (const y of this.list[a].dep) cells.add(y);
      this.hypMemo.set(mkey, { t: this.time, cells: [...cells], R: R0, S: S0, minR, minS });
    }
    return null;
  }

  find(tier: Tier, best: boolean): Found | null {
    switch (tier) {
      case 1:
        return this.tier1(best);
      case 2:
        return this.tier2(best);
      case 3:
        return this.tier3(best);
      case 4:
        return this.tier4(best);
    }
  }
}

/**
 * For every unknown cell x of c (c alone): out[x] bit0 = x can be safe, bit1 = x can be a crystal.
 * Returns false when c is already infeasible. Exact (analytic for sums and eyes).
 */
function cellOptions(c: Constraint, vals: Int8Array, out: Uint8Array): boolean {
  if (c.kind === 'sum' && !c.mod) {
    let gems = 0, unk = 0;
    for (const x of c.cells) {
      const v = vals[x];
      if (v === 1) gems++;
      else if (v === -1) unk++;
    }
    const need = c.value - gems;
    if (need < 0 || need > unk) return false;
    const o = (need <= unk - 1 ? 1 : 0) | (need >= 1 ? 2 : 0);
    for (const x of c.cells) if (vals[x] === -1) out[x] = o;
    return true;
  }
  if (c.kind === 'eye' && c.rays!.reduce((s, r) => s + r.length, 0) === c.cells.length) {
    // disjoint rays (no big cell seen twice); a ray sees a crystal iff it contains one
    let lo = 0, hi = 0;
    const rays = c.rays!;
    const st = [0, 0, 0, 0, 0, 0];
    const unk = [0, 0, 0, 0, 0, 0];
    for (let d = 0; d < rays.length; d++) {
      let s = 0, u = 0;
      for (const j of rays[d]) {
        const v = vals[j];
        if (v === 1) s = 1;
        else if (v === -1) u++;
      }
      if (s === 0 && u > 0) s = 2;
      st[d] = s;
      unk[d] = u;
      if (s === 1) lo++, hi++;
      else if (s === 2) hi++;
    }
    const v = c.value;
    if (v < lo || v > hi) return false;
    for (let d = 0; d < rays.length; d++) {
      if (!unk[d]) continue;
      let o = 3;
      if (st[d] === 2) o = (unk[d] >= 2 || v <= hi - 1 ? 1 : 0) | (v >= lo + 1 ? 2 : 0);
      for (const j of rays[d]) if (vals[j] === -1) out[j] = o;
    }
    return true;
  }
  if (c.kind === 'chain') return chainOptions(c, vals, out);
  if (!feasible(c, vals)) return false;
  for (const x of c.cells) {
    if (vals[x] !== -1) continue;
    vals[x] = 0;
    const f0 = feasible(c, vals);
    vals[x] = 1;
    const f1 = feasible(c, vals);
    vals[x] = -1;
    out[x] = (f0 ? 1 : 0) | (f1 ? 2 : 0);
  }
  return true;
}

/** chain: unknown cells reachable from the clue's neighbours through non-safe cells. */
function chainRegion(c: Constraint, vals: ArrayLike<number>): number[] {
  const reach: number[] = [];
  chainFlood(c, (v) => v !== 0, vals, reach);
  return reach.filter((x) => vals[x] === -1);
}

/**
 * chain, alone: options per unknown cell from the bounds (lo = known clusters, hi = everything
 * reachable through non-safe cells). Exact when the value sits on a bound; otherwise single cells are
 * probed (bounded work, unprobed cells stay open: sound).
 */
function chainOptions(c: Constraint, vals: Int8Array, out: Uint8Array): boolean {
  for (const x of c.scope!) if (vals[x] === -1) out[x] = 3;
  const lo = chainFlood(c, (v) => v === 1, vals);
  const reach: number[] = [];
  const hi = chainFlood(c, (v) => v !== 0, vals, reach);
  const V = c.value;
  if (V < lo || V > hi) return false;
  const region = reach.filter((x) => vals[x] === -1);
  if (V === hi) {
    for (const x of region) out[x] = 2;
    return true;
  }
  // cells that would join a counted cluster (or start one) if they were crystals
  const g = c.graph!;
  const seeds = new Set(c.cells);
  const touches = (x: number) => seeds.has(x) || g[x].some((y) => vals[y] === 1);
  if (V === lo) {
    // nothing may be added to the counted clusters
    const counted: number[] = [];
    chainFlood(c, (v) => v === 1, vals, counted);
    const inCounted = new Set(counted);
    for (const x of region) if (seeds.has(x) || g[x].some((y) => inCounted.has(y))) out[x] = 1;
    return true;
  }
  if (region.length > 40) return true;
  for (const x of region) {
    let o = 0;
    vals[x] = 0;
    const hi0 = chainFlood(c, (v) => v !== 0, vals);
    if (hi0 >= V) o |= 1;
    vals[x] = 1;
    if (touches(x)) {
      if (chainFlood(c, (v) => v === 1, vals) <= V) o |= 2;
    } else o |= 2;
    vals[x] = -1;
    out[x] = o;
  }
  return true;
}

function popcount(m: number): number {
  let c = 0;
  while (m) {
    m &= m - 1;
    c++;
  }
  return c;
}

function sort3(a: number, b: number, c: number): [number, number, number] {
  if (a > b) [a, b] = [b, a];
  if (b > c) [b, c] = [c, b];
  if (a > b) [a, b] = [b, a];
  return [a, b, c];
}

// ---------------------------------------------------------------------------------------------
// Public API

/** The easiest next logical move for the player (hint), or null when no deduction exists. */
/**
 * The easiest next logical move for the player (hint), or null when no deduction exists.
 * vals: -1 unknown, 0 safe, 1 crystal. cons: everything the player can see (activeConstraints).
 * visible: fog mask (visibleCells); computed from vals + cons when omitted. Only visible cells are targeted.
 */
export function nextDeduction(board: Board, vals: Int8Array, cons: Constraint[], visible?: Uint8Array): Deduction | null {
  const ctx = new Ctx(board, vals);
  for (const c of cons) ctx.add(c);
  if (hasFog(board.level)) {
    let vis = visible;
    if (!vis) {
      vis = new Uint8Array(board.n);
      board.level.cells.forEach((c, i) => {
        if (vals[i] !== -1 || c.start || c.lock) vis![i] = 1;
      });
      for (const c of cons) if (c.src.type !== 'global') for (const j of c.cells) vis[j] = 1;
    }
    ctx.vis = vis;
  }
  for (const t of [1, 2, 3, 4] as Tier[]) {
    const f = ctx.find(t, true);
    if (!f) continue;
    let cell = f.forced[0];
    for (const e of f.forced) if (e >> 1 < cell >> 1) cell = e;
    return { cell: cell >> 1, gem: (cell & 1) === 1, reasons: f.members.map((m) => ctx.member(m)), tier: f.tier };
  }
  return null;
}

export function solveLevel(level: Level, opts: SolveOptions = {}): SolveReport {
  const r = solveDetailed(level, opts);
  const out: SolveReport = { solved: r.solved, steps: r.steps, tierCounts: r.tierCounts, difficulty: r.difficulty };
  if (r.stuckAt) out.stuckAt = r.stuckAt;
  return out;
}

/** Simulates play from the start position, applying the easiest deductions first. */
export function solveDetailed(level: Level, opts: SolveOptions = {}): DetailedReport {
  const board = buildBoard(level);
  const n = board.n;
  const cells = level.cells;
  const maxTier = opts.maxTier ?? 4;
  const vals = new Int8Array(n).fill(-1);
  for (let i = 0; i < n; i++) if (!cells[i].gem && (cells[i].start || cells[i].lock)) vals[i] = 0;
  const ctx = new Ctx(board, vals);
  const opened = new Uint8Array(n);
  let marked = 0;
  const ex = opts.exclude;
  const vis = hasFog(level) ? new Uint8Array(n) : null;
  if (vis) {
    for (let i = 0; i < n; i++) if (vals[i] !== -1) vis[i] = 1;
    ctx.vis = vis;
  }
  const addC = (c: Constraint) => {
    if (c.src.type === 'global' && opts.noGlobal) return;
    if (ex) {
      const tags = constraintMechanics(board, c);
      if (tags.includes(ex)) {
        if (ex === 'together' || ex === 'apart') {
          const { mod: _m, ...rest } = c;
          void _m;
          c = rest;
        } else return;
      }
    }
    ctx.add(c);
    if (vis && c.src.type !== 'global') {
      let grew = false;
      for (const j of c.cells)
        if (!vis[j]) {
          vis[j] = 1;
          grew = true;
        }
      if (grew && ctx.filtered) ctx.visibilityChanged();
    }
  };
  const reveal = (i: number) => {
    if (opened[i]) return;
    opened[i] = 1;
    for (const c of cellConstraintsAll(board, i)) addC(c);
  };
  const locks: number[] = [];
  for (let i = 0; i < n; i++) if (cells[i].lock && !cells[i].gem) locks.push(i);
  const openLocks = () => {
    for (const i of locks) if (!opened[i] && marked >= cells[i].lock!) reveal(i);
  };
  for (const c of staticConstraints(board)) addC(c);
  for (let i = 0; i < n; i++) if (cells[i].start && !cells[i].gem) reveal(i);
  openLocks();

  const tierCounts: [number, number, number, number] = [0, 0, 0, 0];
  const cellTierCounts: [number, number, number, number] = [0, 0, 0, 0];
  const events: SolveEvent[] = [];
  let contradiction = false;
  const apply = (f: { tier: Tier; members: number[]; forced: number[] }) => {
    const done: number[] = [];
    for (const e of f.forced) {
      const x = e >> 1, v = e & 1;
      if (ctx.vals[x] !== -1) {
        if (ctx.vals[x] !== v) contradiction = true;
        continue;
      }
      if (cells[x].gem !== (v === 1)) contradiction = true; // would be a solver bug
      ctx.set(x, v);
      done.push(x);
      if (v === 1) marked++;
      reveal(x);
    }
    if (!done.length) return;
    openLocks();
    tierCounts[f.tier - 1]++;
    cellTierCounts[f.tier - 1] += done.length;
    if (opts.trace) events.push({ tier: f.tier, reasons: f.members.map((m) => ctx.member(m)), cells: done });
  };

  while (ctx.U > 0 && !contradiction) {
    // tier 1: exhaust everything that is directly forced
    let progress = false;
    for (let pass = true; pass; ) {
      pass = false;
      for (let a = 0; a < ctx.list.length; a++) {
        const ci = ctx.list[a];
        if (ci.checked1 >= ci.changed) continue;
        ci.checked1 = ctx.time;
        const u = ctx.usable(ctx.single(a).forced);
        if (u.length) {
          apply({ tier: 1, members: [a], forced: u });
          pass = progress = true;
        }
      }
      if (!pass) {
        const u = ctx.usable(ctx.singleGlobal().forced);
        if (u.length) {
          apply({ tier: 1, members: [G], forced: u });
          pass = progress = true;
        }
      }
    }
    if (ctx.U === 0 || contradiction) break;
    if (progress) continue;
    let found: Found | null = null;
    for (let t = 2; t <= maxTier && !found; t++) found = ctx.find(t as Tier, false);
    if (!found) break;
    apply(found);
  }
  const solved = ctx.U === 0 && !contradiction;
  const report: DetailedReport = {
    solved,
    steps: tierCounts[0] + tierCounts[1] + tierCounts[2] + tierCounts[3],
    tierCounts,
    cellTierCounts,
    difficulty: rateDifficulty(n, tierCounts),
    events,
  };
  if (!solved) report.stuckAt = Int8Array.from(ctx.vals);
  return report;
}

/**
 * Difficulty 1..10 from the number of deduction events per tier and the board size.
 * Every event of tier >= 2 is a moment where nothing easier was available.
 */
export function rateDifficulty(n: number, tc: readonly number[]): number {
  const [, t2, t3, t4] = tc;
  // hard steps per "screen": a 250-hex board with three times the steps of a 70-hex one is longer, not harder
  const hard = (t2 + 2.6 * t3 + 5 * t4) * Math.sqrt(70 / Math.max(70, n));
  let d = 1 + 1.75 * Math.log(1 + hard / 1.6) + 0.45 * Math.log(1 + n / 40);
  if (t3 > 0) d += 0.3;
  if (t4 > 0) d += 0.6;
  return Math.max(1, Math.min(10, Math.round(d)));
}

// ---------------------------------------------------------------------------------------------
// Mechanic tags (for explanations, teaching checks and statistics)

/** Mechanics a constraint relies on (a cell clue may have several, e.g. line + walls + gaps). */
export function constraintMechanics(b: Board, c: Constraint): MechanicId[] {
  const s = c.src;
  if (s.type === 'global') return ['counter'];
  if (s.type === 'zone') return ['zone'];
  if (s.type === 'link') return ['link'];
  const i = s.cell;
  const phase = s.phase ?? 0;
  const cell = b.level.cells[i];
  const clue = effectiveClue(b, i, phase);
  const out = new Set<MechanicId>();
  if (cell.gem) out.add('gemclue');
  if (cell.lock) out.add('lock');
  if (cell.rot) out.add('rotate');
  if (cell.alt && phase % (cell.alt.length + 1) !== 0) out.add('switch');
  if (cell.extra || c.cells.some((j) => b.level.cells[j].extra)) out.add('big');
  if (!clue) return [...out];
  const geo = b.phases[phase % b.period];
  // walls / portals / phase-dependent geometry around the cell
  const nbFeatures = () => {
    for (const [q, r] of b.hexes[i])
      for (let d = 0; d < 6; d++) {
        const k = `${q},${r},${d}`;
        if (geo.portals.has(k)) out.add('portal');
      }
    if (geo.adj[i].length < b.rawNeighbours[i].filter((j) => j >= 0).length || b.neighbours[i].some((j, d) => j < 0 && b.rawNeighbours[i][d] >= 0)) out.add('walls');
    if (b.period > 1 && b.phases.some((g) => g.adj[i].join() !== geo.adj[i].join())) out.add('rotate');
  };
  const rayFeatures = (d: number) => {
    const info = rayInfo(b, i, d, phase);
    if (info.wall) out.add('walls');
    if (info.gap) out.add('gaps');
    if (info.portal) out.add('portal');
  };
  switch (clue.k) {
    case 'num':
      out.add('basic');
      nbFeatures();
      break;
    case 'parity':
    case 'island':
    case 'chain':
      out.add(clue.k);
      nbFeatures();
      break;
    case 'line': {
      const dirs = clue.dirs ?? [0];
      out.add('line');
      if (dirs.length > 1) out.add('multiline');
      for (const d of dirs) rayFeatures(d);
      break;
    }
    case 'eye':
      out.add('eye');
      for (let d = 0; d < 6; d++) rayFeatures(d);
      break;
    case 'swirl':
      out.add('swirl');
      break;
    case 'radius':
    case 'ring':
    case 'donut':
    case 'cone':
    case 'triangle':
    case 'dot':
      out.add(clue.k);
      break;
    case 'blank':
      break;
  }
  if (c.mod) out.add(c.mod.type);
  return [...out];
}
