// Seeded level generator (v2).
//
// outline (symmetric shape, islands / holes) -> big cells -> walls -> portals -> crystals ->
// clues (num + a share of special clues) -> rotating / switching cells -> locks, gem clues, links,
// zones -> one start cell (+ local layout repair until the solver gets through) -> minimisation of
// redundant information down to the target rating.
//
// Every produced level is verified with solveLevel (solved === true). Deterministic given the seed:
// all limits are counts, never wall-clock time.

import { DIRS, edgeKey, hexDistance, key } from './hex';
import { hashString, makeRng, type Rng } from './rng';
import {
  buildBoard,
  cellConstraints,
  coneCells,
  donutCells,
  dotCells,
  feasible,
  islandCells,
  radiusCells,
  ray,
  ringCells,
  swirlCells,
  triangleCells,
  type Board,
} from './rules';
import { carveHoles, components, makeShape, SHAPE_IDS, SHAPES, type ShapeId } from './shapes';
import { constraintMechanics, solveDetailed, type DetailedReport, type SolveOptions, type Tier } from './solver';
import type { Clue, Level, LevelCell, Link, MechanicId, Portal, Wall, Zone } from './types';

export { SHAPE_IDS, type ShapeId };

export interface GenOptions {
  seed: number | string;
  /** Approximate hex count (7..300). */
  size: number;
  shape?: ShapeId;
  /** Crystal ratio (default 0.27). */
  density?: number;
  /** Allowed mechanics. */
  mechanics: MechanicId[];
  /** Relative weights of the special clue kinds. */
  weights?: Partial<Record<MechanicId, number>>;
  /** 1..10 */
  targetDifficulty: number;
  /** Fraction of adjacent hex pairs carrying a wall when 'walls' is allowed (default 0.09). */
  walls?: number;
  /** Allow holes (also implied by 'gaps' / 'portal' in mechanics). */
  gaps?: boolean;
  /** Split the board into 2–3 islands (default: half of the levels when gaps are allowed). */
  islands?: boolean;
  /** Share of safe cells carrying a non-num clue (default 0.15). */
  special?: number;
  /** Fog of war (default: on when 'fog' is among the mechanics). */
  fog?: boolean;
  /** Start cells (default 1; islands without any cross-island information get one each). */
  starts?: number;
  /** Mechanics this level teaches: a few special cells, verified to be needed. */
  teach?: MechanicId[];
  /** Mechanics that must stay present (at least one instance survives minimisation). */
  feature?: MechanicId[];
  id?: string;
  title?: string;
  /** Number of layouts to try (default 5; 14 for teaching levels, 3 for big boards). */
  attempts?: number;
  /** Solver-call budget for the whole generation (count-based, deterministic). Default ~400 + 10·size. */
  budget?: number;
  /** Accepted distance to targetDifficulty (default 1, 0 for targets <= 2). */
  tolerance?: number;
  /** Widest board in hex columns (default 9, 11 above 120 hexes). */
  maxCols?: number;
  /** Plain convex outlines only (first levels). */
  simple?: boolean;
  /**
   * Bottlenecks: longest wanted run of cells cleared by easy (single-clue) steps between two harder
   * steps. A pass after the minimisation weakens information inside longer runs so the frontier
   * there can only advance by a pair step (preferred) or a shallow three-clue step.
   */
  maxTrivialRun?: number;
  /** Share of safe cells that may be «Тишина» (default 0.11, 0.06 on easy targets). */
  maxBlankShare?: number;
  /**
   * Human solvability: at most `maxAha` steps that need more than a single clue, a pair of clues or
   * the counter alone; with `deep: false` each of them is a tier-3 step over at most 3 clues (no
   * contradiction chains). Default: none for targets <= 3, else 4 shallow ones.
   */
  human?: HumanLimits;
}

/**
 * Version of the generation output: bump whenever the same seed would produce a different level
 * (the UI keys cached daily / endless levels by it).
 */
export const GEN_VERSION = '6.0';

export interface HumanLimits {
  /** Hard cells: moves that need more than one clue, a pair of clues or the counter alone. */
  maxAha: number;
  /** Deep reasoning (contradiction chains, > 3 clues) allowed at all. */
  deep: boolean;
  /** With deep: at most this many cells decided by contradiction search (tier 4). */
  maxDeep?: number;
  /** At most this many hard moves in a row (without an easy move in between). */
  maxRun?: number;
}

type Trace = { events: { tier: number; reasons: unknown[]; cells: number[] }[] };

/** Deduction events a person has to "see" (beyond single clues, pairs and the counter alone). */
export function ahaSteps(r: Trace) {
  return r.events.filter((e) => e.tier >= 3);
}

/** Hard moves (cells) of a solution: each cell decided by an aha step counts. */
export function ahaCells(r: Trace): number {
  return ahaSteps(r).reduce((s, e) => s + e.cells.length, 0);
}

/** Longest run of hard moves without an easy move in between. */
export function hardRun(r: Trace): number {
  let run = 0, best = 0;
  for (const e of r.events) {
    if (e.tier >= 3) best = Math.max(best, (run += e.cells.length));
    else run = 0;
  }
  return best;
}

/** Cells decided by contradiction search (tier 4). */
export function deepCells(r: Trace): number {
  return r.events.filter((e) => e.tier === 4).reduce((s, e) => s + e.cells.length, 0);
}

export function humanOK(r: DetailedReport, h: HumanLimits): boolean {
  if (!r.solved) return false;
  if (ahaCells(r) > h.maxAha) return false;
  if (h.maxRun !== undefined && hardRun(r) > h.maxRun) return false;
  if (!h.deep) return ahaSteps(r).every((e) => e.tier === 3 && e.reasons.length <= 3);
  return h.maxDeep === undefined || deepCells(r) <= h.maxDeep;
}

export const defaultHuman = (T: number): HumanLimits => (T <= 3 ? { maxAha: 0, deep: false } : { maxAha: 6, deep: false, maxRun: 3 });

/** Solver calls made by the current generateLevel() (deterministic work budget). */
let work = 0;
/** Solver calls after which the current attempt wraps up (finishes with what it has). */
let workLimit = Infinity;
const spent = () => work > workLimit;
function solve(level: Level, o: SolveOptions = {}): DetailedReport {
  work++;
  return solveDetailed(level, o);
}

// ---------------------------------------------------------------------------------------------
// Layout helpers

type Coord = [number, number];

/** Merge some adjacent hexes into big cells (dominoes / triangles), kept apart from each other. */
function mergeBigCells(rng: Rng, cells: LevelCell[], count: number): void {
  for (let k = 0, tries = 0; k < count && tries < count * 30; tries++) {
    const idx = new Map<string, number>();
    cells.forEach((c, i) => {
      idx.set(key(c.q, c.r), i);
      for (const [q, r] of c.extra ?? []) idx.set(key(q, r), i);
    });
    const a = rng.int(cells.length);
    const A = cells[a];
    if (A.extra) continue;
    const d = rng.int(6);
    const bi = idx.get(key(A.q + DIRS[d][0], A.r + DIRS[d][1]));
    if (bi === undefined || cells[bi].extra) continue;
    const parts: number[] = [bi];
    if (rng.chance(0.4)) {
      const ci = idx.get(key(A.q + DIRS[(d + 1) % 6][0], A.r + DIRS[(d + 1) % 6][1]));
      if (ci !== undefined && !cells[ci].extra) parts.push(ci);
    }
    const near = (i: number) =>
      DIRS.some(([dq, dr]) => {
        const j = idx.get(key(cells[i].q + dq, cells[i].r + dr));
        return j !== undefined && !!cells[j].extra;
      });
    if (near(a) || parts.some(near)) continue;
    A.extra = parts.map((p) => [cells[p].q, cells[p].r] as Coord);
    for (const p of parts.sort((x, y) => y - x)) cells.splice(p, 1);
    k++;
  }
}

function placeWalls(rng: Rng, level: Level, fraction: number): Wall[] {
  const b = buildBoard(level);
  const unitAt = (q: number, r: number) => b.index.get(key(q, r));
  const walls = new Map<string, Wall>();
  let pairs = 0;
  for (const [k] of b.index) {
    const [q, r] = k.split(',').map(Number);
    for (let d = 0; d < 3; d++) {
      const u = unitAt(q + DIRS[d][0], r + DIRS[d][1]);
      if (u !== undefined && u !== unitAt(q, r)) pairs++;
    }
  }
  const openCount = (u: number) => {
    let o = 0, raw = 0;
    const seen = new Set<number>();
    for (const [q, r] of b.hexes[u])
      for (let d = 0; d < 6; d++) {
        const v = unitAt(q + DIRS[d][0], r + DIRS[d][1]);
        if (v === undefined || v === u) continue;
        raw++;
        if (!walls.has(edgeKey(q, r, d)) && !seen.has(v)) {
          seen.add(v);
          o++;
        }
      }
    return [o, raw];
  };
  const tryAdd = (q: number, r: number, d: number): boolean => {
    const u = unitAt(q, r), v = unitAt(q + DIRS[d][0], r + DIRS[d][1]);
    if (u === undefined || v === undefined || u === v) return false;
    const k = edgeKey(q, r, d);
    if (walls.has(k)) return false;
    walls.set(k, [q, r, d]);
    for (const w of [u, v]) {
      const [o, raw] = openCount(w);
      if (o < 2 && raw >= 2) {
        walls.delete(k);
        return false;
      }
    }
    return true;
  };
  const target = Math.round(fraction * pairs);
  const hexList = [...b.index.keys()].map((k) => k.split(',').map(Number) as Coord);
  for (let tries = 0; walls.size < target && tries < target * 12 + 20; tries++) {
    const [q, r] = rng.pick(hexList);
    let d = rng.int(6);
    if (!tryAdd(q, r, d)) continue;
    let len = 1 + rng.int(4);
    let cq = q, cr = r;
    let side = rng.chance(0.5) ? 1 : -1;
    while (--len > 0 && walls.size < target) {
      // continue the wall at the vertex between edge d and d+side of the current hex
      const [dq, dr] = DIRS[d];
      if (rng.chance(0.5)) d = (d + side + 6) % 6;
      else {
        cq += dq;
        cr += dr;
        d = (d + 2 * side + 6) % 6;
        side = -side; // the far end of the new edge lies on the other side
      }
      if (!tryAdd(cq, cr, d)) break;
    }
  }
  return [...walls.values()];
}

/** Portal pairs across gaps: hex H, direction d with a gap next to it, partner = first hex along d. */
function placePortals(rng: Rng, level: Level, count: number): Portal[] {
  const b = buildBoard(level);
  const out: Portal[] = [];
  const used = new Set<string>();
  const cand: [number, number, number, number, number][] = [];
  const B = b.bounds;
  level.cells.forEach((c) => {
    if (c.extra) return;
    for (let d = 0; d < 6; d++) {
      const [dq, dr] = DIRS[d];
      if (b.index.has(key(c.q + dq, c.r + dr))) continue;
      for (let k = 2; k < 14; k++) {
        const x = c.q + k * dq, y = c.r + k * dr;
        const s = -x - y;
        if (x < B.minQ || x > B.maxQ || y < B.minR || y > B.maxR || s < B.minS || s > B.maxS) break;
        const u = b.index.get(key(x, y));
        if (u === undefined) continue;
        if (!level.cells[u].extra) cand.push([c.q, c.r, d, x, y]);
        break;
      }
    }
  });
  rng.shuffle(cand);
  for (const [q, r, d, x, y] of cand) {
    if (out.length >= 2 * count) break;
    if (used.has(`${q},${r}`) || used.has(`${x},${y}`)) continue;
    used.add(`${q},${r}`);
    used.add(`${x},${y}`);
    out.push([q, r, d], [x, y, (d + 3) % 6]);
  }
  return out;
}

function placeCrystals(rng: Rng, b: Board, density: number): boolean[] {
  const n = b.n;
  const nbs = b.phases[0].adj;
  const gem = new Array<boolean>(n).fill(false);
  const factor = [1.25, 1.15, 0.95, 0.62, 0.32, 0.1, 0];
  const order = rng.shuffle(Array.from({ length: n }, (_, i) => i));
  for (const i of order) {
    let g = 0;
    for (const j of nbs[i]) if (gem[j]) g++;
    gem[i] = rng.chance(density * factor[Math.min(6, g)]);
  }
  const target = Math.max(1, Math.min(n - 2, Math.round(density * n)));
  const gemNb = (i: number) => nbs[i].reduce((s, j) => s + (gem[j] ? 1 : 0), 0);
  let count = gem.filter(Boolean).length;
  while (count < target) {
    let best = -1;
    for (const i of order) if (!gem[i] && (best < 0 || gemNb(i) < gemNb(best))) best = i;
    gem[best] = true;
    count++;
  }
  while (count > target) {
    let best = -1;
    for (const i of order) if (gem[i] && (best < 0 || gemNb(i) > gemNb(best))) best = i;
    gem[best] = false;
    count--;
  }
  // coverage: every cell needs a safe neighbour, or no number will ever point at it (fog)
  for (const i of order)
    if (nbs[i].length && nbs[i].every((j) => gem[j])) gem[rng.pick(nbs[i])] = false;
  return gem;
}

// ---------------------------------------------------------------------------------------------
// Clues

const CLUE_KINDS = ['line', 'radius', 'ring', 'donut', 'cone', 'triangle', 'dot', 'swirl', 'island', 'chain', 'eye', 'parity'] as const;
type SpecialKind = (typeof CLUE_KINDS)[number];
const DIRECTIONAL: SpecialKind[] = ['line', 'cone', 'triangle', 'dot', 'swirl'];
/** Clue kinds that reach beyond the neighbours (used by the repair to carry information over gaps). */
const REACHING: SpecialKind[] = ['line', 'radius', 'ring', 'donut', 'cone', 'triangle', 'dot', 'eye'];

const DEFAULT_WEIGHTS: Record<SpecialKind, number> = {
  line: 1,
  radius: 0.8,
  ring: 0.7,
  donut: 0.6,
  cone: 0.8,
  triangle: 0.6,
  dot: 0.6,
  swirl: 0.6,
  island: 0.5,
  chain: 0.45,
  eye: 0.6,
  parity: 0.5,
};

function runsOfGems(seq: number[], gem: boolean[], cyclic: boolean): number {
  const m = seq.length;
  let runs = 0, total = 0;
  for (let t = 0; t < m; t++) {
    const cur = seq[t] >= 0 && gem[seq[t]];
    if (cur) total++;
    const prevIdx = t === 0 ? (cyclic ? m - 1 : -1) : t - 1;
    const prev = prevIdx >= 0 && seq[prevIdx] >= 0 && gem[seq[prevIdx]];
    if (cur && !prev) runs++;
  }
  if (cyclic && total === m && m > 0) return 1;
  return runs;
}

interface Ctx {
  rng: Rng;
  mech: Set<MechanicId>;
  teach: Set<MechanicId>;
  weights: Partial<Record<MechanicId, number>>;
}

function modFor(cx: Ctx, value: number, runs: number, p: number): Clue['mod'] | undefined {
  if (value < 2 || p <= 0) return undefined;
  if (runs === 1 && cx.mech.has('together') && cx.rng.chance(p)) return 'together';
  if (runs > 1 && cx.mech.has('apart') && cx.rng.chance(p)) return 'apart';
  return undefined;
}

function hasDupes(seq: number[]): boolean {
  const s = seq.filter((j) => j >= 0);
  return new Set(s).size !== s.length;
}

function numClue(cx: Ctx, b: Board, i: number, gem: boolean[], modP: number): Clue | undefined {
  if (b.level.cells[i].extra) return undefined;
  const seq = b.neighbours[i];
  if (hasDupes(seq)) return undefined;
  const value = seq.filter((j) => j >= 0 && gem[j]).length;
  const mod = modFor(cx, value, runsOfGems(seq, gem, true), modP);
  return mod ? { k: 'num', mod } : undefined;
}

/** A clue of the given special kind for cell i, or null when it would be degenerate there. */
function specialClue(cx: Ctx, b: Board, i: number, gem: boolean[], k: SpecialKind, modP = 0.3): Clue | null {
  const { rng, mech } = cx;

  switch (k) {
    case 'line': {
      const lens = [0, 1, 2, 3, 4, 5].map((d) => ray(b, i, d).length);
      let cand = [0, 1, 2, 3, 4, 5].filter((d) => lens[d] >= 2);
      if (!cand.length) cand = [0, 1, 2, 3, 4, 5].filter((d) => lens[d] >= 1);
      if (!cand.length) return null;
      rng.shuffle(cand);
      let nd = 1;
      if (mech.has('multiline') && cand.length >= 2 && rng.chance(cx.teach.has('multiline') ? 0.9 : 0.4)) nd = cand.length >= 3 && rng.chance(0.3) ? 3 : 2;
      const dirs = cand.slice(0, nd).sort((a, c) => a - c);
      const clue: Clue = { k: 'line', dirs };
      if (nd === 1) {
        const seq = ray(b, i, dirs[0]);
        const mod = modFor(cx, seq.filter((j) => gem[j]).length, runsOfGems(seq, gem, false), modP);
        if (mod) clue.mod = mod;
      }
      return clue;
    }
    case 'radius':
      return radiusCells(b, i).length >= 8 ? { k: 'radius' } : null;
    case 'ring':
      return ringCells(b, i).length >= 6 ? { k: 'ring' } : null;
    case 'donut':
      return donutCells(b, i).length >= 12 ? { k: 'donut' } : null;
    case 'cone':
    case 'triangle': {
      const f = k === 'cone' ? coneCells : triangleCells;
      const cand = [0, 1, 2, 3, 4, 5].filter((c) => f(b, i, c).length >= (k === 'cone' ? 5 : 4));
      if (!cand.length) return null;
      rng.shuffle(cand);
      const nd = cand.length >= 2 && rng.chance(0.25) ? 2 : 1;
      return { k, dirs: cand.slice(0, nd).sort((a, c) => a - c) };
    }
    case 'dot': {
      const corner = rng.chance(0.5);
      const cand = [0, 1, 2, 3, 4, 5].filter((d) => dotCells(b, i, d, corner).length > 0);
      if (cand.length < 2) return null;
      rng.shuffle(cand);
      const nd = 2 + rng.int(Math.min(2, cand.length - 1));
      const c: Clue = { k: 'dot', dirs: cand.slice(0, nd).sort((a, x) => a - x) };
      if (corner) c.corner = true;
      return c;
    }
    case 'swirl': {
      const ccw = rng.chance(0.5);
      const cand = [0, 1, 2, 3, 4, 5].filter((d) => swirlCells(b, i, d, ccw).length >= 3);
      if (!cand.length) return null;
      const c: Clue = { k: 'swirl', dirs: [rng.pick(cand)] };
      if (ccw) c.ccw = true;
      return c;
    }
    case 'island': {
      const s = islandCells(b, i).length;
      return s >= 3 ? { k: 'island' } : null;
    }
    case 'chain': {
      const nb = b.phases[0].adj[i];
      return nb.some((j) => gem[j]) && nb.length >= 3 ? { k: 'chain' } : null;
    }
    case 'eye':
      return [0, 1, 2, 3, 4, 5].filter((d) => ray(b, i, d).length > 0).length >= 3 ? { k: 'eye' } : null;
    case 'parity':
      return b.phases[0].adj[i].length >= 2 ? { k: 'parity' } : null;
  }
}

function pickWeighted<T>(rng: Rng, items: readonly T[], w: (t: T) => number): T | undefined {
  let tot = 0;
  for (const it of items) tot += w(it);
  if (tot <= 0) return undefined;
  let x = rng.next() * tot;
  for (const it of items) {
    x -= w(it);
    if (x <= 0) return it;
  }
  return items[items.length - 1];
}

function growZone(rng: Rng, b: Board, used: Uint8Array, size: number): number[] | null {
  const free: number[] = [];
  for (let i = 0; i < b.n; i++) if (!used[i]) free.push(i);
  if (!free.length) return null;
  const zone = [rng.pick(free)];
  const inZ = new Set(zone);
  while (zone.length < size) {
    const front: number[] = [];
    for (const i of zone) for (const j of b.phases[0].adj[i]) if (!used[j] && !inZ.has(j) && !front.includes(j)) front.push(j);
    if (!front.length) break;
    const j = rng.pick(front);
    zone.push(j);
    inZ.add(j);
  }
  if (zone.length < 3) return null;
  return zone.sort((a, c) => a - c);
}

const GEM_CLUES = ['num', 'radius', 'ring'];

/**
 * Make every piece of information true for the current crystal layout: drop modifiers that no
 * longer hold (in any phase), recompute links, clamp locks, keep starts / locks on safe cells.
 */
function sanitize(level: Level): void {
  const cells = level.cells;
  const total = cells.filter((c) => c.gem).length;
  for (const c of cells) {
    if (c.gem) {
      delete c.start;
      delete c.lock;
      delete c.alt;
      delete c.rot;
      if (c.clue && (c.extra || !GEM_CLUES.includes(c.clue.k))) delete c.clue;
      if (c.clue?.mod) delete c.clue.mod;
    } else if (c.lock) {
      if (total < 1) delete c.lock;
      else c.lock = Math.max(1, Math.min(total, c.lock));
    }
  }
  for (const l of level.links ?? []) l.same = cells[l.a].gem === cells[l.b].gem;
  const b = buildBoard(level);
  const sol = cells.map((c) => (c.gem ? 1 : 0));
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (!c.clue?.mod) continue;
    if (c.extra) {
      delete c.clue.mod;
      continue;
    }
    for (let t = 0; t < b.period; t++)
      if (cellConstraints(b, i, t).some((x) => !feasible(x, sol) || x.value < 2)) {
        delete c.clue.mod;
        break;
      }
  }
}

// ---------------------------------------------------------------------------------------------
// Generation

function maxTierFor(T: number): Tier {
  return T <= 1 ? 1 : T <= 2 ? 2 : T <= 5 ? 3 : 4;
}

interface Built {
  level: Level;
  report: DetailedReport;
  teachOK: boolean;
  /** Extra score (lower is better): opening cascade, unneeded featured mechanics, soft tutorials. */
  penalty: number;
}

/** Share of the cells decided by easy (tier-1) steps before the first harder step. */
function openingShare(r: DetailedReport, n: number): number {
  let cells = 0;
  for (const e of r.events) {
    if (e.tier >= 2) break;
    cells += e.cells.length;
  }
  return cells / Math.max(1, n);
}

const hardSteps = (r: DetailedReport) => r.tierCounts[1] + r.tierCounts[2] + r.tierCounts[3];

/** Longest stretch of cells decided by tier-1 steps without a harder step in between. */
export function longestTrivialRun(r: { events: { tier: number; cells: number[] }[] }): number {
  let run = 0, best = 0;
  for (const e of r.events) {
    if (e.tier >= 2) run = 0;
    else best = Math.max(best, (run += e.cells.length));
  }
  return best;
}

function solveOpts(mech: Set<MechanicId>, maxTier: Tier) {
  return { maxTier, noGlobal: !mech.has('counter') };
}

/** Teach mechanics that are only checked structurally. */
const STRUCTURAL: MechanicId[] = ['basic', 'blank', 'fog', 'gaps', 'counter'];

/** Mechanics of the teach list that the solution really needs (used + not solvable without). */
function teachSatisfied(level: Level, teach: MechanicId[], report: DetailedReport, mech: Set<MechanicId>, maxTier: Tier): boolean {
  if (!teach.length) return true;
  const b = buildBoard(level);
  for (const t of teach) {
    if (STRUCTURAL.includes(t)) {
      if (t === 'counter' && solve(level, { ...solveOpts(mech, maxTier), noGlobal: true }).solved) return false;
      continue;
    }
    const used = report.events.some((e) => e.reasons.some((c) => constraintMechanics(b, c).includes(t)));
    if (!used) return false;
    const without = solve(level, { ...solveOpts(mech, maxTier), exclude: t });
    if (without.solved) return false;
  }
  return true;
}

/** True when every mechanic in level.teach is used by the solution and (where checkable) needed. */
export function teachOK(level: Level, mechanics: MechanicId[]): boolean {
  const mech = new Set(mechanics);
  const rep = solve(level, { ...solveOpts(mech, 4), trace: true });
  return rep.solved && teachSatisfied(level, level.teach ?? [], rep, mech, 4);
}

/** How many instances of a mechanic the level contains (structural ones count as unlimited). */
function mechanicCount(level: Level, m: MechanicId): number {
  const clues = level.cells.map((c) => c.clue);
  switch (m) {
    case 'multiline':
      return clues.filter((c) => c?.k === 'line' && (c.dirs?.length ?? 1) > 1).length;
    case 'together':
    case 'apart':
      return clues.filter((c) => c?.mod === m).length;
    case 'lock':
      return level.cells.filter((c) => c.lock).length;
    case 'gemclue':
      return level.cells.filter((c) => c.gem && c.clue).length;
    case 'link':
      return level.links?.length ?? 0;
    case 'zone':
      return level.zones?.length ?? 0;
    case 'switch':
      return level.cells.filter((c) => c.alt?.length).length;
    default:
      if ((CLUE_KINDS as readonly string[]).includes(m))
        return clues.filter((c) => c?.k === m).length + level.cells.filter((c) => c.alt?.some((a) => a.k === m)).length;
      return Infinity;
  }
}

function compact(level: Level): Level {
  const cells: LevelCell[] = level.cells.map((c) => {
    const o: LevelCell = { q: c.q, r: c.r, gem: c.gem };
    if (c.clue && !(c.clue.k === 'num' && !c.clue.mod && !c.gem)) o.clue = c.clue;
    if (c.start) o.start = true;
    if (c.lock) o.lock = c.lock;
    if (c.extra?.length) o.extra = c.extra;
    if (c.rot?.length) o.rot = c.rot;
    if (c.alt?.length) o.alt = c.alt;
    return o;
  });
  const out: Level = { id: level.id, cells, walls: level.walls };
  if (level.title) out.title = level.title;
  if (level.portals?.length) out.portals = level.portals;
  if (level.links?.length) out.links = level.links;
  if (level.zones?.length) out.zones = level.zones;
  if (level.fog === false) out.fog = false;
  if (level.teach?.length) out.teach = level.teach;
  if (level.diff !== undefined) out.diff = level.diff;
  if (level.seed !== undefined) out.seed = level.seed;
  return out;
}

/** Mechanics that carry information from one island to another. */
const CROSS_ISLAND: MechanicId[] = ['line', 'radius', 'ring', 'donut', 'cone', 'triangle', 'dot', 'eye', 'portal', 'zone', 'link'];

function attempt(opts: GenOptions, rng: Rng, T: number, maxTier: Tier, relaxed = false): Built | null {
  const human = opts.human ?? defaultHuman(T);
  const okH = (r: DetailedReport) => humanOK(r, human);
  const mech = new Set<MechanicId>(opts.mechanics);
  mech.add('basic');
  if (mech.has('multiline')) mech.add('line');
  const teach = (opts.teach ?? []).filter((t) => mech.has(t) || t === 'basic');
  const cx: Ctx = { rng, mech, teach: new Set(teach), weights: opts.weights ?? {} };
  const size = Math.max(7, Math.min(300, Math.round(opts.size)));
  const gaps = !!opts.gaps || mech.has('gaps') || mech.has('portal');
  // islands only when some clue can carry information across (otherwise every island needs a start)
  const wantPortal = cx.teach.has('portal') || (opts.feature ?? []).includes('portal');
  const islands = opts.islands ?? (gaps && size >= 16 && (wantPortal || (CROSS_ISLAND.some((m) => mech.has(m)) && rng.chance(0.5))));
  const fog = opts.fog ?? mech.has('fog');
  const isTeach = teach.length > 0;
  const NT = 3; // special cells on a teaching level

  // --- outline
  let { coords, shape } = makeShape(rng, size, { gaps, islands, want: opts.shape, maxCols: opts.maxCols, simple: opts.simple });
  if (gaps && !islands && !SHAPES.find((s) => s.id === shape)!.gaps && size >= 16 && (mech.has('portal') || rng.chance(0.6))) coords = carveHoles(rng, coords);
  let cells: LevelCell[] = coords.map(([q, r]) => ({ q, r, gem: false }));
  const level: Level = { id: opts.id ?? `gen-${typeof opts.seed === 'number' ? opts.seed : hashString(opts.seed)}`, cells, walls: [] };
  if (!fog) level.fog = false;

  // --- big cells, walls, portals
  if (mech.has('big')) mergeBigCells(rng, cells, cx.teach.has('big') ? NT : Math.max(1, Math.round(cells.length / 30)));
  if (mech.has('walls')) level.walls = placeWalls(rng, level, opts.walls ?? (cx.teach.has('walls') ? 0.16 : 0.09));
  if (mech.has('portal')) {
    const p = placePortals(rng, level, cx.teach.has('portal') ? NT : 1 + rng.int(2));
    if (p.length) level.portals = p;
  }
  const n = cells.length;

  // --- crystals
  const modTeach = cx.teach.has('together') || cx.teach.has('apart');
  let b = buildBoard(level);
  const gem = placeCrystals(rng, b, opts.density ?? (modTeach ? 0.36 : 0.27));
  cells.forEach((c, i) => (c.gem = gem[i]));
  b = buildBoard(level);
  const safe = () => cells.map((_, i) => i).filter((i) => !cells[i].gem);

  // --- clues: num everywhere, a share of special clues
  const kinds = CLUE_KINDS.filter((k) => mech.has(k));
  const teachKinds = kinds.filter((k) => cx.teach.has(k) || (k === 'line' && (cx.teach.has('multiline') || cx.teach.has('portal'))));
  const special = isTeach ? 0 : (opts.special ?? 0.15);
  const weightOf = (k: SpecialKind) => cx.weights[k] ?? DEFAULT_WEIGHTS[k];
  const modP = isTeach ? 0 : 0.3;
  for (const i of safe()) {
    let clue: Clue | undefined | null = undefined;
    if (!cells[i].extra && kinds.length && rng.chance(special)) {
      for (let tries = 0; tries < 3 && !clue; tries++) {
        const k = pickWeighted(rng, kinds, weightOf);
        if (k) clue = specialClue(cx, b, i, gem, k, modP);
      }
    }
    if (!clue) clue = numClue(cx, b, i, gem, modP);
    if (clue) cells[i].clue = clue;
  }
  // taught kinds: a few cells; featured kinds: at least one
  const want = new Map<SpecialKind, number>();
  for (const k of teachKinds) want.set(k, NT);
  for (const m of opts.feature ?? []) if ((kinds as readonly string[]).includes(m) && !want.has(m as SpecialKind)) want.set(m as SpecialKind, 1);
  for (const [k, cnt] of want) {
    let have = cells.filter((c) => c.clue?.k === k).length;
    for (const i of rng.shuffle(safe())) {
      if (have >= cnt) break;
      if (cells[i].extra || (cells[i].clue && cells[i].clue!.k !== 'num')) continue;
      const c = specialClue(cx, b, i, gem, k, 0);
      if (c) {
        cells[i].clue = c;
        have++;
      }
    }
  }
  if (mech.has('multiline') && (opts.feature ?? []).includes('multiline') && !cells.some((c) => c.clue?.k === 'line' && (c.clue.dirs?.length ?? 1) > 1))
    for (const i of rng.shuffle(safe())) {
      if (cells[i].extra || (cells[i].clue && cells[i].clue!.k !== 'num')) continue;
      const cand = [0, 1, 2, 3, 4, 5].filter((d) => ray(b, i, d).length >= 1);
      if (cand.length < 2) continue;
      cells[i].clue = { k: 'line', dirs: rng.shuffle(cand).slice(0, 2).sort((a, c) => a - c) };
      break;
    }
  for (const m of ['together', 'apart'] as const) {
    if (!mech.has(m)) continue;
    const cnt = cx.teach.has(m) ? NT : (opts.feature ?? []).includes(m) ? 4 : 0;
    let have = cells.filter((c) => c.clue?.mod === m).length;
    for (const i of rng.shuffle(safe())) {
      if (have >= cnt) break;
      if (cells[i].extra || cells[i].clue) continue;
      const seq = b.neighbours[i];
      if (hasDupes(seq)) continue;
      const value = seq.filter((j) => j >= 0 && gem[j]).length;
      if (value >= 2 && (m === 'together') === (runsOfGems(seq, gem, true) === 1)) {
        cells[i].clue = { k: 'num', mod: m };
        have++;
      }
    }
  }

  // featured together / apart: also on a single-direction line when lines exist
  for (const m of ['together', 'apart'] as const) {
    if (!mech.has(m) || !mech.has('line') || !(opts.feature ?? []).includes(m)) continue;
    if (cells.some((c) => c.clue?.k === 'line' && c.clue.mod === m)) continue;
    for (const i of rng.shuffle(safe())) {
      if (cells[i].extra || (cells[i].clue && cells[i].clue!.k !== 'num') || cells[i].clue?.mod) continue;
      const d = [0, 1, 2, 3, 4, 5].find((dd) => {
        const seq = ray(b, i, dd);
        const v = seq.filter((j) => gem[j]).length;
        return seq.length >= 3 && v >= 2 && (m === 'together') === (runsOfGems(seq, gem, false) === 1);
      });
      if (d === undefined) continue;
      cells[i].clue = { k: 'line', dirs: [d], mod: m };
      break;
    }
  }

  // --- rotating and switching cells (cycle lengths 2 / 3: the period stays <= 6)
  if (mech.has('rotate')) {
    const k = cx.teach.has('rotate') ? NT : 1 + rng.int(2);
    const dirKinds = DIRECTIONAL.filter((x) => mech.has(x));
    let made = 0;
    for (const i of rng.shuffle(safe())) {
      if (made >= k) break;
      const c = cells[i];
      if (c.extra || c.lock || c.clue?.mod) continue;
      if ((level.portals ?? []).some(([q, r]) => q === c.q && r === c.r)) continue; // portals stay put
      const nbDirs = [0, 1, 2, 3, 4, 5].filter(
        (d) => b.index.has(key(c.q + DIRS[d][0], c.r + DIRS[d][1])) && !level.walls.some(([q, r, e]) => edgeKey(q, r, e) === edgeKey(c.q, c.r, d)),
      );
      if (nbDirs.length < 3) continue;
      const dk = dirKinds.length ? rng.pick(dirKinds) : undefined;
      const clue = dk ? specialClue(cx, b, i, gem, dk, 0) : null;
      const rot = rng.pick([[0, 1], [0, 2], [0, 3], [0, 2, 4], [0, 1, 2]]);
      const own = rng.shuffle(nbDirs).slice(0, 1 + rng.int(2));
      const oldClue = c.clue;
      for (const d of own) level.walls.push([c.q, c.r, d]); // owned: turns with the cell
      c.rot = rot;
      if (clue) c.clue = clue;
      // every orientation must still show something
      const bt = buildBoard(level);
      if (rot.some((_, t) => !(cellConstraints(bt, i, t)[0]?.cells.length))) {
        level.walls.splice(level.walls.length - own.length, own.length);
        delete c.rot;
        c.clue = oldClue;
        continue;
      }
      made++;
    }
  }
  if (mech.has('switch')) {
    const k = cx.teach.has('switch') ? NT : 1 + rng.int(2);
    const pool: (SpecialKind | 'num')[] = ['num', ...kinds];
    let made = 0;
    for (const i of rng.shuffle(safe())) {
      if (made >= k) break;
      const c = cells[i];
      if (c.extra || c.rot || c.lock || c.clue?.mod) continue;
      const len = rng.chance(0.6) ? 1 : 2;
      const alt: Clue[] = [];
      const curK = c.clue?.k ?? 'num';
      for (let t = 0; t < 10 && alt.length < len; t++) {
        const kk = rng.pick(pool);
        if (kk === curK || alt.some((a) => a.k === kk)) continue;
        const cl = kk === 'num' ? ({ k: 'num' } as Clue) : specialClue(cx, b, i, gem, kk, 0);
        if (cl) alt.push(cl);
      }
      if (!alt.length) continue;
      c.alt = alt;
      made++;
    }
  }
  b = buildBoard(level);

  // --- extras
  const totalGems = cells.filter((c) => c.gem).length;
  if (mech.has('gemclue')) {
    const rate = cx.teach.has('gemclue') ? 0 : 0.2;
    for (const c of cells) if (c.gem && !c.extra && rng.chance(rate)) c.clue = rng.chance(0.7) ? { k: 'radius' } : { k: 'num' };
    const cnt = cx.teach.has('gemclue') ? NT : (opts.feature ?? []).includes('gemclue') ? 1 : 0;
    const have = cells.filter((x) => x.gem && x.clue).length;
    for (const c of rng.shuffle(cells.filter((x) => x.gem && !x.extra && !x.clue)).slice(0, Math.max(0, cnt - have)))
      c.clue = rng.chance(0.7) ? { k: 'radius' } : { k: 'num' };
  }
  if (mech.has('lock') && totalGems >= 2) {
    const k = cx.teach.has('lock') ? 2 + rng.int(2) : Math.max(1, Math.round(n / 35));
    const cand = rng.shuffle(safe().filter((i) => !cells[i].extra && !cells[i].rot));
    for (let t = 0; t < Math.min(k, cand.length - 2); t++) cells[cand[t]].lock = 1 + rng.int(Math.max(1, Math.ceil(totalGems * 0.7)));
  }
  const links: Link[] = [];
  if (mech.has('link')) {
    const k = cx.teach.has('link') ? NT : Math.max(1, Math.round(n / 14));
    const deg = new Uint8Array(n);
    for (let tries = 0; links.length < k && tries < k * 20; tries++) {
      const a = rng.int(n);
      const near: number[] = [];
      for (let j = 0; j < n; j++) {
        const d = hexDistance(cells[a].q, cells[a].r, cells[j].q, cells[j].r);
        if (d >= 1 && d <= 4 && deg[j] < 2) near.push(j);
      }
      if (!near.length || deg[a] >= 2) continue;
      const bb = rng.pick(near);
      if (links.some((l) => (l.a === a && l.b === bb) || (l.a === bb && l.b === a))) continue;
      links.push({ a, b: bb, same: cells[a].gem === cells[bb].gem });
      deg[a]++;
      deg[bb]++;
    }
  }
  const zones: Zone[] = [];
  if (mech.has('zone')) {
    const k = cx.teach.has('zone') ? NT : Math.max(1, Math.round(n / 18));
    const used = new Uint8Array(n);
    for (let t = 0; t < k * 3 && zones.length < k; t++) {
      const z = growZone(rng, b, used, 3 + rng.int(6));
      if (!z) continue;
      for (const i of z) used[i] = 1;
      zones.push({ cells: z });
    }
  }
  if (links.length) level.links = links;
  if (zones.length) level.zones = zones;
  sanitize(level);

  // cells carrying taught / featured information are never toggled by the repair or densify steps
  const keepKinds = new Set<string>([...teach, ...(opts.feature ?? [])]);
  const isProtected = (i: number) => {
    const c = cells[i];
    if (c.start || c.extra) return true;
    if (c.clue && (keepKinds.has(c.clue.k) || (c.clue.mod && keepKinds.has(c.clue.mod)) || (c.clue.k === 'line' && (c.clue.dirs?.length ?? 1) > 1 && keepKinds.has('multiline')))) return true;
    if ((c.rot && keepKinds.has('rotate')) || (c.alt && keepKinds.has('switch')) || (c.lock && keepKinds.has('lock'))) return true;
    if (c.gem && c.clue && keepKinds.has('gemclue')) return true;
    return false;
  };

  // --- start cell(s)
  const sOpts = solveOpts(mech, maxTier);
  b = buildBoard(level);
  const unitComps = components(cells.flatMap((c) => [[c.q, c.r] as Coord, ...(c.extra ?? [])])).map(
    (comp) => new Set(comp.map(([q, r]) => b.index.get(key(q, r))!)),
  );
  const compOf = (i: number) => unitComps.findIndex((s) => s.has(i));
  const crossInfo = CROSS_ISLAND.some((m) => mech.has(m));
  const nStarts = opts.starts ?? (unitComps.length > 1 && !crossInfo ? Math.min(3, unitComps.length) : 1);
  // a start whose number is 0 opens the board (like a first click): preferred on easy levels only,
  // harder levels start anywhere (no big opening cascade)
  const preferZero = T <= 1 || isTeach;
  const startCands = () => {
    const c = rng.shuffle(safe().filter((i) => !cells[i].lock && !cells[i].extra && !cells[i].rot && !cells[i].alt));
    const zero = (i: number) => (!cells[i].clue || cells[i].clue!.k === 'num') && b.phases[0].adj[i].every((j) => !cells[j].gem);
    const z = c.filter(zero), nz = c.filter((i) => !zero(i));
    // harder levels try a few arbitrary starts first, zero cells as the fallback
    return preferZero ? [...z, ...nz] : [...nz.slice(0, 5), ...z, ...nz.slice(5)];
  };
  if (!startCands().some((i) => b.phases[0].adj[i].every((j) => !cells[j].gem))) {
    // no zero cell: clear the neighbourhood of an interior cell
    const inner = rng.shuffle(safe().filter((i) => !cells[i].extra && !cells[i].lock && b.phases[0].adj[i].length >= 5));
    if (inner.length) {
      for (const j of b.phases[0].adj[inner[0]]) cells[j].gem = false;
      if (cells[inner[0]].clue && cells[inner[0]].clue!.k !== 'num') delete cells[inner[0]].clue;
      sanitize(level);
    }
  }
  const setStarts = (s: number[]) => {
    for (const c of cells) delete c.start;
    for (const i of s) cells[i].start = true;
  };
  const progress = (r: DetailedReport) => (r.solved ? Infinity : [...r.stuckAt!].filter((v) => v !== -1).length);
  let rep: DetailedReport | null = null;
  let best = -1;
  let bestStarts: number[] = [];
  let tried = 0;
  for (const s0 of startCands()) {
    if (tried++ >= 12) break;
    const s = [s0];
    if (nStarts > 1) {
      const usedComps = new Set([compOf(s0)]);
      for (const i of startCands()) {
        if (s.length >= nStarts) break;
        if (!usedComps.has(compOf(i))) {
          usedComps.add(compOf(i));
          s.push(i);
        }
      }
    }
    setStarts(s);
    const r = solve(level, { ...sOpts, trace: true });
    const p = progress(r);
    // among solvable starts: closest to the target rating first, then the smallest opening cascade
    const better = () => {
      const dr = Math.abs(r.difficulty - T), db = Math.abs(rep!.difficulty - T);
      return dr < db || (dr === db && openingShare(r, n) < openingShare(rep!, n));
    };
    if (p > best || (r.solved && rep?.solved && better())) {
      best = p;
      rep = r;
      bestStarts = s.slice();
    }
    if (rep?.solved && (T <= 1 || isTeach || tried >= 6)) break;
  }
  if (!rep) return null;
  setStarts(bestStarts);

  // --- repair: toggle frontier cells (crystal <-> safe) while that lets the solver get further
  const density = opts.density ?? 0.27;
  const repairs = Math.round(Math.min(Math.max(45, Math.min(160, n * 0.6)), opts.budget ? opts.budget * 0.3 : Infinity) * (relaxed ? 1.5 : 1));
  const tabu: number[] = [];
  let stall = 0;
  let noFront = 0;
  let extraStarts = n >= 120 || relaxed ? Math.max(0, 3 - bestStarts.length) : 0; // big boards may get 2–3 starts
  for (let it = 0; !rep.solved && !spent(); it++) {
    if (it >= repairs) {
      if (!extraStarts) break;
      // add a start in the unknown part (a zero cell when possible) and go on repairing
      const vals = rep.stuckAt!;
      const bb = buildBoard(level);
      const unk = rng.shuffle(safe().filter((i) => vals[i] === -1 && !cells[i].lock && !cells[i].extra && !cells[i].rot && !cells[i].alt));
      const s = unk.find((i) => bb.phases[0].adj[i].every((j) => !cells[j].gem)) ?? unk[0];
      if (s === undefined) break;
      cells[s].start = true;
      extraStarts--;
      it = Math.round(repairs / 2);
      rep = solve(level, { ...sOpts, trace: true });
      best = progress(rep);
      continue;
    }
    const vals = rep.stuckAt!;
    const bb = buildBoard(level);
    const front: number[] = [];
    for (let i = 0; i < n; i++) {
      if (isProtected(i) || tabu.includes(i)) continue;
      const adj = bb.phases[0].adj[i];
      // unknown cells at the border of the known region, and known crystals walling unknown cells in
      if (vals[i] === -1 ? adj.some((j) => vals[j] !== -1) : vals[i] === 1 && adj.some((j) => vals[j] === -1)) front.push(i);
    }
    const snapshot = JSON.stringify(level);
    // move B: give a known safe cell a special clue reaching into the unknown part (this is what
    // carries information across gaps); move A: toggle a frontier cell
    let upgraded = false;
    const reach = kinds.filter((k) => REACHING.includes(k));
    if (reach.length && (!front.length || (stall >= 6 && it % 2 === 0) || rng.chance(0.2))) {
      const unknownHex = cells.filter((_, j) => vals[j] === -1);
      const dist = (i: number) => Math.min(...unknownHex.map((u) => hexDistance(cells[i].q, cells[i].r, u.q, u.r)));
      const known = rng
        .shuffle(safe().filter((i) => vals[i] === 0 && !cells[i].extra && !cells[i].rot && !cells[i].alt && (!cells[i].clue || cells[i].clue.k === 'num' || cells[i].clue.k === 'blank')))
        .map((i) => [i, dist(i)] as const)
        .sort((x, y) => x[1] - y[1])
        .map(([i]) => i);
      for (const i of known.slice(0, 16)) {
        const k = pickWeighted(rng, reach, weightOf)!;
        const c = specialClue(cx, bb, i, cells.map((x) => x.gem), k, 0);
        if (!c) continue;
        const old = cells[i].clue;
        cells[i].clue = c;
        if (cellConstraints(buildBoard(level), i)[0]?.cells.some((j) => vals[j] === -1)) {
          upgraded = true;
          break;
        }
        cells[i].clue = old;
      }
    }
    if (!upgraded && !front.length && ++noFront < 5) {
      it--;
      continue;
    }
    if (!upgraded && !front.length && level.walls.length) {
      // a region walled off from everything known: open one of its walls
      const unitAt = (q: number, r: number) => bb.index.get(key(q, r));
      const w = rng.shuffle(level.walls.slice()).find(([q, r, d]) => {
        const u = unitAt(q, r), v = unitAt(q + DIRS[d][0], r + DIRS[d][1]);
        return u !== undefined && v !== undefined && !cells[u].rot && (vals[u] === -1) !== (vals[v] === -1);
      });
      if (w) {
        level.walls.splice(level.walls.indexOf(w), 1);
        upgraded = true;
      }
    }
    if (!upgraded && !front.length) {
      // an island nothing reaches: it gets its own start
      const unk = rng.shuffle(safe().filter((i) => vals[i] === -1 && !cells[i].lock && !cells[i].extra && !cells[i].rot && !cells[i].alt));
      const st = unk.find((i) => bb.phases[0].adj[i].every((j) => !cells[j].gem)) ?? unk[0];
      if (st === undefined || cells.filter((c) => c.start).length >= 3) break;
      cells[st].start = true;
      upgraded = true;
    }
    if (!upgraded) {
      const gemsNow = cells.filter((c) => c.gem).length;
      const pool = front.filter((i) => (gemsNow / n > density + 0.02 ? cells[i].gem : true));
      const f = rng.pick(pool.length ? pool : front);
      tabu.push(f);
      if (tabu.length > 3) tabu.shift();
      cells[f].gem = !cells[f].gem;
    }
    sanitize(level);
    const r = solve(level, { ...sOpts, trace: true });
    const p = progress(r);
    stall = p > best ? 0 : stall + 1;
    if (p >= best) {
      // equal progress is accepted too: walking along a plateau escapes local dead ends
      best = p;
      rep = r;
    } else {
      const back = JSON.parse(snapshot) as Level;
      cells.splice(0, n, ...back.cells);
      level.links = back.links;
      level.zones = back.zones;
      level.walls = back.walls;
    }
  }
  if (!rep.solved) return null;
  cells = level.cells;

  // --- densify: repairs mostly turn crystals into safe cells; win the density back where the
  // solver still gets through (more crystals = richer numbers = the main difficulty lever)
  const slack = T >= 7 ? 1 : 0;
  {
    const goal = Math.round(density * n);
    let gemsNow = cells.filter((c) => c.gem).length;
    const cand = rng.shuffle(safe().filter((i) => !isProtected(i) && !cells[i].lock && !cells[i].rot && !cells[i].alt && (!cells[i].clue || (cells[i].clue.k === 'num' && !cells[i].clue.mod))));
    let tries = 0;
    for (const i of cand) {
      if (gemsNow >= goal || spent() || tries++ > Math.min(n / 2, opts.budget ? opts.budget * 0.15 : Infinity)) break;
      const snapshot = JSON.stringify(level);
      cells[i].gem = true;
      delete cells[i].clue;
      sanitize(level);
      const r = solve(level, { ...sOpts, trace: true });
      if (r.solved && r.difficulty <= T + slack && okH(r)) {
        rep = r;
        gemsNow++;
      } else {
        const back = JSON.parse(snapshot) as Level;
        cells.splice(0, n, ...back.cells);
        level.links = back.links;
        level.zones = back.zones;
      }
    }
  }

  // --- minimisation: remove information while the rating stays within the target
  const safeNow = safe();
  // «Тишина» stays rare and scattered: at most ~11% of the safe cells, never in clusters
  // (the bottleneck pass below may use the rest of the share)
  const blankShare = opts.maxBlankShare ?? (isTeach ? 0.3 : T <= 2 ? 0.06 : 0.11);
  const maxBlanksTotal = Math.round(safeNow.length * blankShare);
  const maxBlanks = opts.maxTrivialRun ? Math.round(maxBlanksTotal * 0.6) : maxBlanksTotal;
  const isBlank = (j: number) => cells[j].clue?.k === 'blank';
  const blankNbs = (j: number) => bNow.phases[0].adj[j].filter(isBlank);
  let blanks = cells.filter((c) => c.clue?.k === 'blank').length;
  type Item = { tags: MechanicId[]; blank?: boolean; free?: () => boolean; apply: () => (() => void) | null };
  const items: Item[] = [];
  // Information never used by the current solution path can be removed without re-solving: the
  // solver only loses useless options, the path and the rating stay the same.
  let used = { cells: new Set<number>(), zones: new Set<Zone>(), links: new Set<Link>() };
  const computeUsed = (r: DetailedReport) => {
    used = { cells: new Set(), zones: new Set(), links: new Set() };
    for (const e of r.events)
      for (const c of e.reasons) {
        if (c.src.type === 'cell') used.cells.add(c.src.cell);
        else if (c.src.type === 'zone') used.zones.add(level.zones![c.src.zone]);
        else if (c.src.type === 'link') used.links.add(level.links![c.src.link]);
      }
  };
  computeUsed(rep);
  const bNow = buildBoard(level);
  const tagsOfCell = (i: number): MechanicId[] => {
    const s = new Set<MechanicId>();
    for (let t = 0; t < bNow.period; t++) for (const c of cellConstraints(bNow, i, t)) for (const x of constraintMechanics(bNow, c)) s.add(x);
    return [...s];
  };
  const dropProp = (i: number, k: 'lock' | 'alt' | 'clue', tags: MechanicId[], free: boolean) =>
    items.push({
      tags,
      free: free ? () => !used.cells.has(i) : undefined,
      apply: () => {
        const c = cells[i];
        const old = c[k];
        if (old === undefined) return null;
        delete c[k];
        return () => {
          (c as unknown as Record<string, unknown>)[k] = old;
        };
      },
    });
  for (const i of safeNow) {
    const c = cells[i];
    if (mech.has('blank') && !c.extra && !c.alt)
      items.push({
        blank: true,
        free: () => !used.cells.has(i),
        tags: tagsOfCell(i),
        apply: () => {
          const old = cells[i].clue;
          if (old?.k === 'blank') return null;
          // no clusters: at most one blank neighbour, and that one has no other blank neighbour
          const nb = blankNbs(i);
          if (nb.length > 1 || nb.some((j) => blankNbs(j).length > 0)) return null;
          cells[i].clue = { k: 'blank' };
          return () => {
            cells[i].clue = old;
          };
        },
      });
    const clue = c.clue;
    if (clue?.dirs && clue.dirs.length > 1 && (clue.k === 'line' || clue.k === 'cone' || clue.k === 'dot'))
      items.push({
        tags: clue.k === 'line' ? ['multiline'] : [clue.k],
        apply: () => {
          const cc = cells[i].clue;
          if (!cc?.dirs || cc.dirs.length < 2) return null;
          const old = cc.dirs;
          const drop = rng.int(old.length);
          cc.dirs = old.filter((_, t) => t !== drop);
          return () => {
            cc.dirs = old;
          };
        },
      });
    if (clue?.mod)
      items.push({
        tags: [clue.mod],
        free: () => !used.cells.has(i),
        apply: () => {
          const cc = cells[i].clue;
          if (!cc?.mod) return null;
          const old = cc.mod;
          delete cc.mod;
          return () => {
            cc.mod = old;
          };
        },
      });
    if (c.lock) dropProp(i, 'lock', ['lock'], false);
    if (c.alt) dropProp(i, 'alt', ['switch'], false);
  }
  for (let i = 0; i < n; i++) if (cells[i].gem && cells[i].clue) dropProp(i, 'clue', ['gemclue'], true);
  const removeFrom = <X,>(arr: X[] | undefined, item: X, tag: MechanicId, free: () => boolean): Item => ({
    free,
    tags: [tag],
    apply: () => {
      if (!arr) return null;
      const at = arr.indexOf(item);
      if (at < 0) return null;
      arr.splice(at, 1);
      return () => {
        arr.splice(at, 0, item);
      };
    },
  });
  for (const l of level.links ?? []) items.push(removeFrom(level.links, l, 'link', () => !used.links.has(l)));
  for (const z of level.zones ?? []) items.push(removeFrom(level.zones, z, 'zone', () => !used.zones.has(z)));

  const order = rng.shuffle(items);
  let teachDone = !teach.length;
  const feature = new Set<MechanicId>((opts.feature ?? []).filter((m) => mech.has(m)));
  let solves = 0;
  const maxSolves = Math.min(n > 140 ? 90 : n > 90 ? 160 : Infinity, opts.budget ? Math.round(opts.budget * 0.45) : Infinity);
  for (const it of order) {
    const cap = teachDone ? T + slack : T + slack + 1;
    if (it.tags.some((t) => cx.teach.has(t))) continue;
    if (it.tags.some((t) => feature.has(t) && mechanicCount(level, t) <= (t === 'together' || t === 'apart' ? 3 : 1))) continue;
    if (it.blank && blanks >= maxBlanks) continue;
    const free = it.free?.() ?? false;
    if (!free && (solves >= maxSolves || spent())) continue;
    const undo = it.apply();
    if (!undo) continue;
    if (free) {
      if (it.blank) blanks++;
      continue;
    }
    solves++;
    const r = solve(level, { ...sOpts, trace: true });
    if (r.solved && r.difficulty <= cap && okH(r)) {
      rep = r;
      computeUsed(r);
      if (it.blank) blanks++;
      if (!teachDone && r.difficulty <= T + slack) teachDone = teachSatisfied(level, teach, r, mech, maxTier);
    } else undo();
  }
  // bottlenecks: split long runs of easy moves by weakening a clue inside them (pairs preferred)
  if (opts.maxTrivialRun && !isTeach) {
    let cur = solve(level, { ...sOpts, trace: true });
    if (cur.solved) {
      rep = cur;
      const L = opts.maxTrivialRun;
      const bnow = buildBoard(level);
      const quality = (r: DetailedReport) => -Math.max(0, longestTrivialRun(r) - L) * 10 + r.tierCounts[1] * 2 + r.tierCounts[2];
      let misses = 0;
      for (let round = 0; round < (L <= 22 ? 28 : 16) && longestTrivialRun(rep) > L && !spent(); round++) {
        // candidate clues: those used by the easy steps inside over-long runs (middle part first)
        const runs: number[][] = [];
        let curRun: { cells: number; clues: number[] } = { cells: 0, clues: [] };
        const flush = () => {
          if (curRun.cells > L) {
            const m = curRun.clues.length;
            runs.push([...curRun.clues.slice(Math.floor(m * 0.3), Math.ceil(m * 0.8)), ...curRun.clues]);
          }
          curRun = { cells: 0, clues: [] };
        };
        for (const e of rep.events) {
          if (e.tier >= 2) {
            flush();
            continue;
          }
          curRun.cells += e.cells.length;
          for (const c of e.reasons) if (c.src.type === 'cell') curRun.clues.push(c.src.cell);
        }
        flush();
        const seen = new Set<number>();
        const cand: number[] = [];
        for (const r of runs) for (const i of r) if (!seen.has(i)) (seen.add(i), cand.push(i));
        const ok = (i: number) => !cells[i].gem && !cells[i].start && !isProtected(i) && cells[i].clue?.k !== 'blank' && !cells[i].extra && !cells[i].alt;
        const pool = cand.filter(ok);
        // middle of the runs first, a little randomness
        const head = rng.shuffle(pool.slice(0, 10)), tail = rng.shuffle(pool.slice(10));
        let done = false;
        let tries = 0;
        for (const i of [...head, ...tail]) {
          if (tries >= 14 || spent()) break;
          for (const how of ['blank', 'gem'] as const) {
            const blanksNow = cells.filter((c) => c.clue?.k === 'blank').length;
            const nb = bnow.phases[0].adj[i].filter((j) => cells[j].clue?.k === 'blank');
            if (how === 'blank' && !(mech.has('blank') && blanksNow < maxBlanksTotal && nb.length <= 1 && nb.every((j) => bnow.phases[0].adj[j].filter((k) => cells[k].clue?.k === 'blank').length === 0))) continue;
            if (how === 'gem' && cells.filter((c) => c.gem).length >= Math.round((density + 0.04) * n)) continue;
            tries++;
            const snapshot = JSON.stringify(level);
            if (how === 'blank') cells[i].clue = { k: 'blank' };
            else {
              // turn the cell into a crystal: changes the numbers around it
              cells[i].gem = true;
              delete cells[i].clue;
              delete cells[i].lock;
              sanitize(level);
            }
            let r = solve(level, { ...sOpts, trace: true });
            const good = (x: DetailedReport) => x.solved && okH(x) && x.difficulty <= T + slack + 1 && quality(x) > quality(rep!);
            if (!r.solved && r.stuckAt) {
              // stuck right there: a small change of the crystals at the stuck frontier often turns
              // the gap into a pair step
              const vals = r.stuckAt;
              const front = rng.shuffle(
                cells.map((_, j) => j).filter((j) => vals[j] === -1 && !isProtected(j) && !cells[j].lock && bnow.phases[0].adj[j].some((k) => vals[k] !== -1)),
              );
              for (const f of front.slice(0, 8)) {
                const snap2 = JSON.stringify(level);
                cells[f].gem = !cells[f].gem;
                if (!cells[f].gem && cells[f].clue && !['num', 'radius', 'ring'].includes(cells[f].clue!.k)) delete cells[f].clue;
                sanitize(level);
                const r2 = solve(level, { ...sOpts, trace: true });
                if (good(r2)) {
                  r = r2;
                  break;
                }
                const b2 = JSON.parse(snap2) as Level;
                cells.splice(0, n, ...b2.cells);
                level.links = b2.links;
                level.zones = b2.zones;
              }
            }
            if (good(r)) {
              rep = r;
              done = true;
              break;
            }
            const back = JSON.parse(snapshot) as Level;
            cells.splice(0, n, ...back.cells);
            level.links = back.links;
            level.zones = back.zones;
          }
          if (done) break;
        }
        if (!done && ++misses >= 3) break;
      }
      computeUsed(rep);
    }
  }
  // hardening (hard targets still below the target): turn safe number cells into crystals when
  // that makes the solution need more hard steps (bottlenecks), up to a few points of density
  if (T >= 2 && rep.difficulty < T - (T >= 6 || T <= 3 ? 0 : 1)) {
    const hardness = (r: DetailedReport) => r.difficulty * 100 + r.tierCounts[2] * 3 + r.tierCounts[3] * 5 + r.tierCounts[1];
    let cur = solve(level, { ...sOpts, trace: true });
    if (cur.solved) {
      rep = cur;
      computeUsed(rep);
      const maxGems = Math.round(Math.min(0.37, density + 0.04) * n);
      const cand = rng.shuffle(safe().filter((i) => !isProtected(i) && !cells[i].lock && !cells[i].rot && !cells[i].alt && (!cells[i].clue || cells[i].clue.k === 'num' || cells[i].clue.k === 'blank')));
      let tries = 0;
      const limit = Math.min(opts.budget ? opts.budget * 0.1 : T <= 3 ? 90 : 60, T <= 3 ? n * 1.5 : n / 2);
      for (let ci = 0; ci < cand.length * 2; ci++) {
        const i = cand[ci % cand.length];
        if (rep.difficulty >= T || spent() || tries++ > limit) break;
        if (cells[i].gem || cells[i].start) continue;
        const snapshot = JSON.stringify(level);
        // over the density cap: swap with a crystal instead (keeps the density)
        if (cells.filter((c) => c.gem).length >= maxGems) {
          const g = rng.pick(cells.map((c, j) => (c.gem && !isProtected(j) && !c.clue ? j : -1)).filter((j) => j >= 0));
          if (g === undefined) break;
          cells[g].gem = false;
        }
        cells[i].gem = true;
        delete cells[i].clue;
        sanitize(level);
        const r = solve(level, { ...sOpts, trace: true });
        if (r.solved && r.difficulty <= T + slack && okH(r) && hardness(r) > hardness(rep)) {
          rep = r;
          computeUsed(r);
        } else {
          const back = JSON.parse(snapshot) as Level;
          cells.splice(0, n, ...back.cells);
          level.links = back.links;
          level.zones = back.zones;
        }
      }
    }
  }
  // verify the final level (free removals assumed an unchanged path)
  rep = solve(level, { ...sOpts, trace: true });
  if (!rep.solved) return null;
  level.diff = rep.difficulty;
  // penalties for the attempt ranking
  let penalty = 0;
  if (!okH(rep)) penalty += 10; // a person would get stuck somewhere
  if (T >= 4) penalty += Math.max(0, openingShare(rep, n) - 0.5) * 4;
  if (opts.maxTrivialRun) penalty += Math.max(0, longestTrivialRun(rep) - opts.maxTrivialRun - 3) / (opts.maxTrivialRun <= 22 ? 3 : 8);
  penalty += Math.max(0, cells.filter((c) => c.start).length - nStarts) * 1.5; // extra starts are a last resort
  for (const m of opts.feature ?? []) {
    if (!mech.has(m) || STRUCTURAL.includes(m) || mechanicCount(level, m) === 0 || spent()) continue;
    const without = solve(level, { ...sOpts, exclude: m });
    if (without.solved && hardSteps(without) <= hardSteps(rep)) penalty += 1.5; // the mechanic is not needed
  }
  if (isTeach && !STRUCTURAL.includes(teach[0])) {
    const bt = buildBoard(level);
    if (!rep.events.some((e) => e.tier >= 2 && e.reasons.some((c) => constraintMechanics(bt, c).includes(teach[0])))) penalty += 0.4;
  }
  return { level, report: rep, teachOK: teachSatisfied(level, teach, rep, mech, maxTier), penalty };
}

export function generateLevel(opts: GenOptions): Level {
  const seedNum = typeof opts.seed === 'number' ? opts.seed >>> 0 : hashString(opts.seed);
  const T = Math.max(1, Math.min(10, Math.round(opts.targetDifficulty)));
  const human = opts.human ?? defaultHuman(T);
  // no deep reasoning allowed: the solver never goes beyond tier 3 (tier 2 when no aha step is allowed)
  const maxTier = Math.min(maxTierFor(T), human.deep ? 4 : human.maxAha ? 3 : 2) as Tier;
  const attempts = opts.attempts ?? (opts.teach?.length ? 14 : opts.size > 140 ? 3 : 5);
  let best: Built | null = null;
  let bestScore = Infinity;
  // count-based budget: once spent, keep the best layout found so far (deterministic, unlike a timer)
  const budget = opts.budget ?? Math.round(400 + 10 * Math.min(300, opts.size)) * (opts.teach?.length ? 2 : 1);
  work = 0;
  let extra = 0;
  for (let a = 0; (a < attempts || (best && best.level.diff! < T - 2 && extra++ < 3 && work < budget * 1.3)) && !(best && work > budget * (a < attempts ? 1 : 1.3)); a++) {
    workLimit = opts.budget ? Math.max(work + 30, Math.min(work + opts.budget * 0.7, opts.budget)) : Infinity;
    const rng = makeRng(hashString(`${seedNum}:${a}`));
    const built = attempt(opts, rng, T, maxTier);
    if (!built) continue;
    const d = built.level.diff!;
    const tol = opts.tolerance ?? (T <= 2 ? 0 : 1);
    const score = Math.max(0, Math.abs(d - T) - tol) + (built.teachOK ? 0 : 20) + built.penalty + Math.abs(d - T) * 0.01;
    if (score < bestScore) {
      best = built;
      bestScore = score;
    }
    if (score < 0.5) break;
  }
  // last resort before the plain fallback: longer repairs, a second / third start allowed
  for (let a = 0; !best && a < 4; a++) {
    workLimit = opts.budget ? work + opts.budget : Infinity;
    const built = attempt(opts, makeRng(hashString(`${seedNum}:relaxed:${a}`)), T, maxTier, true);
    if (built) best = built;
  }
  workLimit = Infinity;
  if (!best) return fallbackLevel(opts, seedNum);
  const level = best.level;
  level.seed = seedNum;
  if (opts.title) level.title = opts.title;
  if (opts.teach?.length) level.teach = opts.teach.slice();
  return compact(level);
}

/** Always-solvable fallback: no fog, every safe cell revealed (the counter then decides the rest). */
function fallbackLevel(opts: GenOptions, seedNum: number): Level {
  const rng = makeRng(seedNum ^ 0x5bd1e995);
  const { coords } = makeShape(rng, Math.max(7, Math.min(300, opts.size)), { gaps: false });
  const cells: LevelCell[] = coords.map(([q, r]) => ({ q, r, gem: false }));
  const level: Level = { id: opts.id ?? `gen-${seedNum}`, cells, walls: [], fog: false, seed: seedNum };
  const gem = placeCrystals(rng, buildBoard(level), opts.density ?? 0.27);
  cells.forEach((c, i) => {
    c.gem = gem[i];
    if (!c.gem) c.start = true;
  });
  level.diff = solve(level).difficulty;
  return compact(level);
}

// ---------------------------------------------------------------------------------------------
// Daily & endless

const EXTRA_MECHS: MechanicId[] = [
  'walls', 'gaps', 'line', 'multiline', 'radius', 'ring', 'donut', 'cone', 'triangle', 'lock', 'gemclue', 'dot', 'swirl',
  'rotate', 'switch', 'big', 'portal', 'island', 'chain', 'together', 'apart', 'eye', 'parity', 'link', 'zone',
];

/** basic + counter + fog + blank and k extra mechanics, drawn from `from` (default: all). */
function randomMechanics(rng: Rng, k: number, from: MechanicId[] = EXTRA_MECHS): MechanicId[] {
  const allowed = new Set(from);
  const pool = rng.shuffle(EXTRA_MECHS.filter((m) => allowed.has(m)));
  const base: MechanicId[] = ['basic', 'counter', 'fog', 'blank'].filter((m) => m === 'basic' || allowed.has(m as MechanicId) || from === EXTRA_MECHS) as MechanicId[];
  const out: MechanicId[] = [...base, ...pool.slice(0, k)];
  if (out.includes('multiline') && !out.includes('line') && allowed.has('line')) out.push('line');
  if ((out.includes('gaps') || out.includes('portal')) && !out.includes('line') && allowed.has('line') && rng.chance(0.7)) out.push('line');
  return out;
}

/**
 * Generate until the rating lands in [lo, hi]: options for try k come from make(k) (k = 0 is the
 * plain seed, later tries use derived seeds); the closest result is kept. Deterministic.
 */
function generateInRange(make: (k: number) => GenOptions, lo: number, hi: number, tries: number): Level {
  let best: Level | null = null;
  let bestDist = Infinity;
  let id = '';
  for (let k = 0; k < tries; k++) {
    const o = make(k);
    id ||= o.id ?? '';
    const L = generateLevel(o);
    const d = L.diff ?? 1;
    const dist = d < lo ? lo - d : d > hi ? d - hi : 0;
    if (dist < bestDist) {
      best = L;
      bestDist = dist;
    }
    if (dist === 0) break;
  }
  return { ...best!, id: id || best!.id };
}

/**
 * The daily puzzle: deterministic per date (the same for everyone when `mechanics` is omitted).
 * `mechanics` restricts the draw to those mechanics (e.g. what the player has unlocked).
 */
export function dailyLevel(dateISO: string, mechanics?: MechanicId[]): Level {
  const day = dateISO.slice(0, 10);
  const base = mechanics ? `daily:${day}:${[...mechanics].sort().join(',')}` : `daily:${day}`;
  return generateInRange(
    (k) => {
      const tag = k ? `${base}#${k}` : base;
      const rng = makeRng(tag);
      return {
        seed: tag,
        id: `daily-${day}`,
        size: 50 + rng.int(25),
        density: 0.27 + rng.next() * 0.04,
        special: 0.14 + rng.next() * 0.05,
        mechanics: mechanics ? randomMechanics(rng, 2 + rng.int(3), mechanics) : randomMechanics(rng, 2 + rng.int(3)),
        targetDifficulty: 5,
        attempts: 3,
        budget: 160,
        maxCols: 9,
        human: { maxAha: 4, deep: false, maxRun: 3 },
        maxTrivialRun: 30,
      };
    },
    4,
    6,
    3,
  );
}

export type EndlessDifficulty = 'easy' | 'medium' | 'hard' | 'expert';

const ENDLESS: Record<
  EndlessDifficulty,
  { size: [number, number]; target: number; range: [number, number]; mechs: [number, number]; density: [number, number]; budget: number; human: HumanLimits }
> = {
  easy: { size: [25, 45], target: 2, range: [1, 2], mechs: [0, 2], density: [0.2, 0.24], budget: 200, human: { maxAha: 0, deep: false } },
  medium: { size: [45, 70], target: 4, range: [3, 5], mechs: [2, 4], density: [0.25, 0.29], budget: 280, human: { maxAha: 4, deep: false, maxRun: 3 } },
  hard: { size: [60, 85], target: 8, range: [6, 10], mechs: [3, 5], density: [0.31, 0.34], budget: 260, human: { maxAha: 9, deep: false, maxRun: 4 } },
  expert: { size: [75, 100], target: 10, range: [7, 10], mechs: [4, 6], density: [0.32, 0.35], budget: 170, human: { maxAha: 12, deep: true, maxDeep: 6, maxRun: 4 } },
};

/** "Numbers and walls": what easy endless levels are made of unless mechanics are given. */
const EASY_MECHS: MechanicId[] = ['basic', 'counter', 'fog', 'walls', 'gaps'];

/**
 * Endless level of a difficulty mode, rating enforced (easy 1–2, medium 3–5, hard >= 5, expert >= 7).
 * `mechanics` (e.g. the unlocked ones) is the allowed set; easy defaults to numbers, walls and gaps.
 */
export function endlessLevel(seed: number | string, difficulty: EndlessDifficulty, mechanics?: MechanicId[]): Level {
  const cfg = ENDLESS[difficulty];
  const base = mechanics ? `endless:${difficulty}:${seed}:${[...mechanics].sort().join(',')}` : `endless:${difficulty}:${seed}`;
  return generateInRange(
    (k) => {
      const tag = k ? `${base}#${k}` : base;
      const rng = makeRng(tag);
      const size = cfg.size[0] + rng.int(cfg.size[1] - cfg.size[0] + 1);
      const mechs = mechanics ?? (difficulty === 'easy' ? EASY_MECHS : randomMechanics(rng, cfg.mechs[0] + rng.int(cfg.mechs[1] - cfg.mechs[0] + 1)));
      return {
        seed: tag,
        id: `endless-${difficulty}-${seed}`,
        size,
        density: cfg.density[0] + rng.next() * (cfg.density[1] - cfg.density[0]),
        special: 0.12 + rng.next() * 0.1,
        mechanics: mechs,
        targetDifficulty: cfg.target,
        attempts: 3,
        budget: cfg.budget,
        maxCols: 9,
        human: cfg.human,
        maxTrivialRun: difficulty === 'easy' ? undefined : difficulty === 'medium' ? 30 : 25,
      };
    },
    cfg.range[0],
    cfg.range[1],
    difficulty === 'easy' ? 3 : difficulty === 'medium' ? 4 : difficulty === 'hard' ? 8 : 8,
  );
}
