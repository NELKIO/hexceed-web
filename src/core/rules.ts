// Rule semantics: turns a Level into a Board (indexed geometry, per phase) and every piece of
// information (cell clues, zones, links, the global counter) into a Constraint over cell (unit)
// indexes. The solver, the generator, the game logic and the UI all go through this file, so the
// meaning of each mechanic is defined exactly once. See docs/MECHANICS.md.
//
// Units: a level cell is a unit; a big cell owns several hexes (anchor + `extra`). Board.index maps
// every hex to its unit. Areas map hexes to units, dedupe them and never contain the clue cell itself.
//
// Phases: rotating cells (`rot`) and switching cells (`alt`) make the geometry / clues depend on a
// global phase t (0 <= t < board.period). Geometry for each phase is precomputed.

import { DIRS, edgeKey, hexDistance, key } from './hex';
import type { Clue, Level } from './types';

export interface PhaseGeo {
  /** Normalised edge keys (edgeKey) carrying a wall in this phase. */
  walls: Set<string>;
  /** One-sided portal flags "q,r,d" in this phase. */
  portals: Set<string>;
  /** nb[i][d] = unit reached from unit i's anchor hex in edge direction d (walls respected, portals followed), -1 if none. */
  nb: number[][];
  /** adj[i] = every unit adjacent to any hex of unit i (walls respected, portals followed), deduped, without i. */
  adj: number[][];
}

export interface Board {
  level: Level;
  /** Number of units (= level.cells.length). */
  n: number;
  /** Every hex "q,r" -> its unit index. */
  index: Map<string, number>;
  /** Hexes of each unit, anchor first. */
  hexes: [number, number][][];
  /** Phase-0 walls (normalised edge keys). */
  walls: Set<string>;
  /** Phase-0 neighbours of the anchor hex per edge direction (see PhaseGeo.nb). */
  neighbours: number[][];
  /** rawNeighbours[i][d] = unit of the hex next to the anchor in direction d ignoring walls/portals, -1 if missing. */
  rawNeighbours: number[][];
  totalGems: number;
  bounds: { minQ: number; maxQ: number; minR: number; maxR: number; minS: number; maxS: number };
  /** Number of distinct phases (lcm of all cycle lengths, 1 when nothing rotates or switches). */
  period: number;
  phases: PhaseGeo[];
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

export function buildBoard(level: Level): Board {
  const n = level.cells.length;
  const index = new Map<string, number>();
  const hexes: [number, number][][] = [];
  level.cells.forEach((c, i) => {
    const hs: [number, number][] = [[c.q, c.r], ...(c.extra ?? [])];
    hexes.push(hs);
    for (const [q, r] of hs) index.set(key(q, r), i);
  });
  let minQ = Infinity, maxQ = -Infinity, minR = Infinity, maxR = -Infinity, minS = Infinity, maxS = -Infinity;
  let totalGems = 0;
  let period = 1;
  level.cells.forEach((c, i) => {
    if (c.gem) totalGems++;
    for (const [q, r] of hexes[i]) {
      minQ = Math.min(minQ, q); maxQ = Math.max(maxQ, q);
      minR = Math.min(minR, r); maxR = Math.max(maxR, r);
      const s = -q - r;
      minS = Math.min(minS, s); maxS = Math.max(maxS, s);
    }
    for (const len of [c.rot?.length ?? 0, c.alt ? c.alt.length + 1 : 0]) if (len > 1) period = (period * len) / gcd(period, len);
  });
  const bounds = { minQ, maxQ, minR, maxR, minS, maxS };
  const rawNeighbours = level.cells.map((c) => DIRS.map(([dq, dr]) => index.get(key(c.q + dq, c.r + dr)) ?? -1));
  const b: Board = { level, n, index, hexes, walls: new Set(), neighbours: [], rawNeighbours, totalGems, bounds, period, phases: [] };
  for (let t = 0; t < period; t++) b.phases.push(buildPhase(b, t));
  b.walls = b.phases[0].walls;
  b.neighbours = b.phases[0].nb;
  return b;
}

/** Orientation offset of cell i in phase t (0 for non-rotating cells). */
export function rotOffset(b: Board, i: number, t: number): number {
  const rot = b.level.cells[i].rot;
  return rot?.length ? rot[t % rot.length] : 0;
}

function buildPhase(b: Board, t: number): PhaseGeo {
  const lv = b.level;
  const walls = new Set<string>();
  const portals = new Set<string>();
  const ownerOff = (q: number, r: number) => {
    const u = b.index.get(key(q, r));
    return u !== undefined && lv.cells[u].rot ? rotOffset(b, u, t) : 0;
  };
  for (const [q, r, d] of lv.walls) walls.add(edgeKey(q, r, (d + ownerOff(q, r)) % 6));
  for (const [q, r, d] of lv.portals ?? []) portals.add(`${q},${r},${(d + ownerOff(q, r)) % 6}`);
  const geo: PhaseGeo = { walls, portals, nb: [], adj: [] };
  for (let i = 0; i < b.n; i++) {
    const [aq, ar] = b.hexes[i][0];
    geo.nb.push(DIRS.map((_, d) => {
      const j = hexNeighbour(b, geo, aq, ar, d);
      return j === i ? -1 : j;
    }));
    const adj: number[] = [];
    for (const [q, r] of b.hexes[i])
      for (let d = 0; d < 6; d++) {
        const j = hexNeighbour(b, geo, q, r, d);
        if (j >= 0 && j !== i && !adj.includes(j)) adj.push(j);
      }
    geo.adj.push(adj);
  }
  return geo;
}

export function inBounds(b: Board, q: number, r: number): boolean {
  const s = -q - r;
  const B = b.bounds;
  return q >= B.minQ && q <= B.maxQ && r >= B.minR && r <= B.maxR && s >= B.minS && s <= B.maxS;
}

/** Exit hex of a portal on edge d of (q,r): the first hex further along d whose edge d+3 is a portal. */
export function portalTarget(b: Board, geo: PhaseGeo, q: number, r: number, d: number): [number, number] | null {
  const [dq, dr] = DIRS[d];
  const back = (d + 3) % 6;
  for (let k = 1; ; k++) {
    const x = q + k * dq, y = r + k * dr;
    if (!inBounds(b, x, y)) return null;
    if (b.index.has(key(x, y)) && geo.portals.has(`${x},${y},${back}`)) return [x, y];
  }
}

/** Unit adjacent to hex (q,r) across its edge d in this phase (walls respected, portals followed), -1 if none. */
export function hexNeighbour(b: Board, geo: PhaseGeo, q: number, r: number, d: number): number {
  if (geo.walls.size && geo.walls.has(edgeKey(q, r, d))) return -1;
  if (geo.portals.size && geo.portals.has(`${q},${r},${d}`)) {
    const p = portalTarget(b, geo, q, r, d);
    if (p) return b.index.get(key(p[0], p[1]))!;
  }
  return b.index.get(key(q + DIRS[d][0], r + DIRS[d][1])) ?? -1;
}

const geoOf = (b: Board, phase: number) => b.phases[((phase % b.period) + b.period) % b.period];

/**
 * Units along a straight ray from cell i in edge direction d (phase-dependent walls/portals).
 * Walls stop the ray, gaps are jumped, portals teleport it. Deduped, never contains i.
 */
export function ray(b: Board, i: number, d: number, phase = 0): number[] {
  return rayInfo(b, i, d, phase).cells;
}

/** ray() plus what it went through (for explanations / mechanic tags). */
export function rayInfo(b: Board, i: number, d: number, phase = 0): { cells: number[]; wall: boolean; gap: boolean; portal: boolean } {
  const geo = geoOf(b, phase);
  const out: number[] = [];
  let [q, r] = b.hexes[i][0];
  const [dq, dr] = DIRS[d];
  let wall = false, gap = false, portal = false, inGap = false;
  const push = (j: number) => {
    if (j !== i && !out.includes(j)) out.push(j);
  };
  const hasWalls = geo.walls.size > 0, hasPortals = geo.portals.size > 0;
  for (;;) {
    if (hasWalls && geo.walls.has(edgeKey(q, r, d))) {
      wall = true;
      break;
    }
    if (hasPortals && geo.portals.has(`${q},${r},${d}`)) {
      const p = portalTarget(b, geo, q, r, d);
      if (p) {
        [q, r] = p;
        portal = true;
        push(b.index.get(key(q, r))!);
        continue;
      }
    }
    q += dq;
    r += dr;
    if (!inBounds(b, q, r)) break;
    const j = b.index.get(key(q, r));
    if (j === undefined) inGap = true;
    else {
      if (inGap) gap = true;
      push(j);
    }
  }
  return { cells: out, wall, gap, portal };
}

function areaUnits(b: Board, i: number, offsets: Iterable<readonly [number, number]>): number[] {
  const [q, r] = b.hexes[i][0];
  const out: number[] = [];
  for (const [dq, dr] of offsets) {
    const j = b.index.get(key(q + dq, r + dr));
    if (j !== undefined && j !== i && !out.includes(j)) out.push(j);
  }
  return out;
}

function* distanceBand(lo: number, hi: number): Generator<[number, number]> {
  for (let dq = -hi; dq <= hi; dq++)
    for (let dr = -hi; dr <= hi; dr++) {
      const dist = hexDistance(0, 0, dq, dr);
      if (dist >= lo && dist <= hi) yield [dq, dr];
    }
}

/** Units at hex distance lo..hi from cell i (ignores walls and gaps). */
export function bandCells(b: Board, i: number, lo: number, hi: number): number[] {
  return areaUnits(b, i, distanceBand(lo, hi));
}

/** Distance 1..2 (the `radius` clue, 18 hexes). */
export const radiusCells = (b: Board, i: number) => bandCells(b, i, 1, 2);
/** Exactly distance 2 (the `ring` clue, 12 hexes). */
export const ringCells = (b: Board, i: number) => bandCells(b, i, 2, 2);
/** Distance 2..3 (the `donut` clue, 30 hexes). */
export const donutCells = (b: Board, i: number) => bandCells(b, i, 2, 3);

function wedge(corner: number, ok: (a: number, bb: number) => boolean): [number, number][] {
  const A = DIRS[corner % 6];
  const B = DIRS[(corner + 1) % 6];
  const out: [number, number][] = [];
  for (let a = 0; a <= 3; a++) for (let bb = 0; bb <= 3; bb++) if (ok(a, bb)) out.push([a * A[0] + bb * B[0], a * A[1] + bb * B[1]]);
  return out;
}

/** 9-hex wedge towards corner c (between edge dirs c and c+1): a·e_c + b·e_(c+1), 1 <= a+b <= 3. */
export function coneCells(b: Board, i: number, corner: number): number[] {
  return areaUnits(b, i, wedge(corner, (a, bb) => a + bb >= 1 && a + bb <= 3));
}

/** The far 6 hexes of the wedge: a <= 2, b <= 2, a+b >= 2. */
export function triangleCells(b: Board, i: number, corner: number): number[] {
  return areaUnits(b, i, wedge(corner, (a, bb) => a <= 2 && bb <= 2 && a + bb >= 2));
}

/** dot: the hex 2·e_d (or e_d + e_(d+1) when corner). */
export function dotCells(b: Board, i: number, d: number, corner = false): number[] {
  const A = DIRS[d % 6];
  const B = corner ? DIRS[(d + 1) % 6] : A;
  return areaUnits(b, i, [[A[0] + B[0], A[1] + B[1]]]);
}

/**
 * swirl: walk out of edge d around the pivot P = self + e_(d+1) (ccw: self + e_(d-1)), visiting the
 * other 5 hexes around P in order; a wall between consecutive positions ends the walk.
 */
export function swirlCells(b: Board, i: number, d: number, ccw = false, phase = 0): number[] {
  const geo = geoOf(b, phase);
  const [sq, sr] = b.hexes[i][0];
  const s = ccw ? -1 : 1;
  const pd = (((d + s) % 6) + 6) % 6;
  const P = [sq + DIRS[pd][0], sr + DIRS[pd][1]];
  // self = P + e_j0
  let j = (d + (ccw ? 2 : 4)) % 6;
  let cq = sq, cr = sr;
  const out: number[] = [];
  for (let k = 1; k <= 5; k++) {
    const cross = (((j + 2 * s) % 6) + 6) % 6;
    if (geo.walls.has(edgeKey(cq, cr, cross))) break;
    j = (((j + s) % 6) + 6) % 6;
    cq = P[0] + DIRS[j][0];
    cr = P[1] + DIRS[j][1];
    const u = b.index.get(key(cq, cr));
    if (u !== undefined && u !== i && !out.includes(u)) out.push(u);
  }
  return out;
}

/** Units reachable from unit i without crossing walls (adjacency incl. portals), i excluded. */
export function islandCells(b: Board, i: number, phase = 0): number[] {
  const adj = geoOf(b, phase).adj;
  const seen = new Uint8Array(b.n);
  seen[i] = 1;
  const out: number[] = [];
  const st = [i];
  while (st.length) {
    const x = st.pop()!;
    for (const y of adj[x])
      if (!seen[y]) {
        seen[y] = 1;
        out.push(y);
        st.push(y);
      }
  }
  return out.sort((a, c) => a - c);
}

// ---------------------------------------------------------------------------------------------
// Constraints

export type ConstraintSource =
  | { type: 'cell'; cell: number; phase?: number } // phase in which this information is shown (omitted = all / 0)
  | { type: 'zone'; zone: number }
  | { type: 'link'; link: number }
  | { type: 'global' };

export interface Constraint {
  src: ConstraintSource;
  /** Cells the constraint talks about (what the UI highlights; what fog reveals). */
  cells: number[];
  kind: 'sum' | 'eye' | 'parity' | 'link' | 'chain';
  /** sum: crystal count; eye: rays that see a crystal; parity: 0 even / 1 odd; link: 1 same / 0 different; chain: crystals in the touching clusters. */
  value: number;
  /** together/apart modifier for 'sum'. seq lists cell indexes in order, -1 = separator. */
  mod?: { type: 'together' | 'apart'; seq: number[]; cyclic: boolean };
  /** eye: the 6 rays as ordered cell index lists. */
  rays?: number[][];
  /** chain: every cell the value may depend on (the clue's wall-bounded component, itself excluded). */
  scope?: number[];
  /** chain: unit adjacency used for clusters (walls respected). */
  graph?: number[][];
  /** chain: the clue cell (never part of a cluster). */
  self?: number;
}

function countGems(b: Board, cells: number[]): number {
  let n = 0;
  for (const j of cells) if (b.level.cells[j].gem) n++;
  return n;
}

/** The clue cell i shows in phase t (switching cells cycle, rotating cells turn their directions). */
export function effectiveClue(b: Board, i: number, phase = 0): Clue | undefined {
  const c = b.level.cells[i];
  let clue: Clue | undefined = c.clue ?? (c.gem ? undefined : { k: 'num' });
  if (c.alt?.length) clue = [clue, ...c.alt][phase % (c.alt.length + 1)];
  if (clue && c.rot?.length && clue.dirs) {
    const off = rotOffset(b, i, phase);
    if (off) clue = { ...clue, dirs: clue.dirs.map((d) => (d + off) % 6) };
  }
  return clue;
}

/** Merge consecutive duplicates (a big cell seen in two neighbouring directions is one position). */
function mergeSeq(seq: number[], cyclic: boolean): number[] {
  const out: number[] = [];
  for (const j of seq) if (j < 0 || out[out.length - 1] !== j) out.push(j);
  if (cyclic && out.length > 1 && out[0] >= 0 && out[0] === out[out.length - 1]) out.pop();
  return out;
}

/** Constraint provided by cell i's clue in phase t once it is revealed/marked ([] for none / blank). */
export function cellConstraints(b: Board, i: number, phase = 0): Constraint[] {
  const clue = effectiveClue(b, i, phase);
  if (!clue || clue.k === 'blank') return [];
  const geo = geoOf(b, phase);
  const src = b.period > 1 ? { type: 'cell' as const, cell: i, phase: ((phase % b.period) + b.period) % b.period } : { type: 'cell' as const, cell: i };
  const sum = (cells: number[]): Constraint => ({ src, cells, kind: 'sum', value: countGems(b, cells) });
  switch (clue.k) {
    case 'num':
    case 'parity': {
      const cells = geo.adj[i].slice();
      const value = countGems(b, cells);
      if (clue.k === 'parity') return [{ src, cells, kind: 'parity', value: value & 1 }];
      const con: Constraint = { src, cells, kind: 'sum', value };
      if (clue.mod) con.mod = { type: clue.mod, seq: mergeSeq(geo.nb[i], true), cyclic: true };
      return [con];
    }
    case 'line': {
      const dirs = clue.dirs ?? [0];
      const cells: number[] = [];
      for (const d of dirs) for (const j of ray(b, i, d, phase)) if (!cells.includes(j)) cells.push(j);
      const con = sum(cells);
      if (clue.mod && dirs.length === 1) con.mod = { type: clue.mod, seq: cells.slice(), cyclic: false };
      return [con];
    }
    case 'radius':
      return [sum(radiusCells(b, i))];
    case 'ring':
      return [sum(ringCells(b, i))];
    case 'donut':
      return [sum(donutCells(b, i))];
    case 'cone':
    case 'triangle':
    case 'dot':
    case 'swirl': {
      const dirs = clue.dirs ?? [0];
      const cells: number[] = [];
      for (const d of dirs) {
        const part =
          clue.k === 'cone' ? coneCells(b, i, d)
          : clue.k === 'triangle' ? triangleCells(b, i, d)
          : clue.k === 'dot' ? dotCells(b, i, d, !!clue.corner)
          : swirlCells(b, i, d, !!clue.ccw, phase);
        for (const j of part) if (!cells.includes(j)) cells.push(j);
      }
      return [sum(cells)];
    }
    case 'island':
      return [sum(islandCells(b, i, phase))];
    case 'chain': {
      const graph = geo.adj;
      const seeds = graph[i].slice();
      const scope = islandCells(b, i, phase);
      const gem = b.level.cells.map((c) => c.gem);
      const seen = new Uint8Array(b.n);
      seen[i] = 1;
      let value = 0;
      const st = seeds.filter((j) => gem[j]);
      for (const j of st) seen[j] = 1;
      while (st.length) {
        const x = st.pop()!;
        value++;
        for (const y of graph[x])
          if (!seen[y] && gem[y]) {
            seen[y] = 1;
            st.push(y);
          }
      }
      return [{ src, cells: seeds, kind: 'chain', value, scope, graph, self: i }];
    }
    case 'eye': {
      const rays: number[][] = [];
      const cells: number[] = [];
      let value = 0;
      for (let d = 0; d < 6; d++) {
        const r = ray(b, i, d, phase).filter((j) => !cells.includes(j));
        rays.push(r);
        for (const j of r) cells.push(j);
        if (r.some((j) => b.level.cells[j].gem)) value++;
      }
      return [{ src, cells, kind: 'eye', value, rays }];
    }
  }
}

function sameConstraint(a: Constraint, c: Constraint): boolean {
  if (a.kind !== c.kind || a.value !== c.value || a.cells.length !== c.cells.length) return false;
  if ((a.mod?.type ?? '') !== (c.mod?.type ?? '')) return false;
  const s = new Set(a.cells);
  for (const x of c.cells) if (!s.has(x)) return false;
  if (a.mod && c.mod && a.mod.seq.join() !== c.mod.seq.join()) return false;
  if (a.kind === 'eye') return a.rays!.map((r) => r.join()).join('|') === c.rays!.map((r) => r.join()).join('|');
  if (a.kind === 'chain') return a.scope!.join() === c.scope!.join() && a.graph === c.graph;
  return true;
}

/** Everything cell i shows over all phases (identical information deduplicated). */
export function cellConstraintsAll(b: Board, i: number): Constraint[] {
  if (b.period === 1) return cellConstraints(b, i, 0);
  const out: Constraint[] = [];
  for (let t = 0; t < b.period; t++)
    for (const c of cellConstraints(b, i, t)) if (!out.some((o) => sameConstraint(o, c))) out.push(c);
  return out;
}

export function zoneConstraint(b: Board, z: number): Constraint {
  const cells = b.level.zones![z].cells;
  return { src: { type: 'zone', zone: z }, cells, kind: 'sum', value: countGems(b, cells) };
}

export function linkConstraint(b: Board, l: number): Constraint {
  const L = b.level.links![l];
  return { src: { type: 'link', link: l }, cells: [L.a, L.b], kind: 'link', value: L.same ? 1 : 0 };
}

export function globalConstraint(b: Board): Constraint {
  const cells = b.level.cells.map((_, i) => i);
  return { src: { type: 'global' }, cells, kind: 'sum', value: b.totalGems };
}

/** Constraints visible before any move (zones, links, global counter). */
export function staticConstraints(b: Board): Constraint[] {
  const out: Constraint[] = [globalConstraint(b)];
  b.level.zones?.forEach((_, z) => out.push(zoneConstraint(b, z)));
  b.level.links?.forEach((_, l) => out.push(linkConstraint(b, l)));
  return out;
}

/** Fog of war is on unless the level switches it off. */
export const hasFog = (level: Level) => level.fog !== false;

// ---------------------------------------------------------------------------------------------
// Feasibility under a partial assignment. vals[i]: -1 unknown, 0 safe, 1 crystal.
// Returns false only when NO completion of the unknown cells satisfies the constraint.
// Exact for every kind except 'chain', where partial assignments are judged by bounds
// (min = known crystal clusters, max = everything reachable through non-safe cells); bounds never
// reject a satisfiable assignment and are exact once the relevant cells are decided.

function binom(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

/** Number of contiguous blocks of exactly `len` crystals consistent with vals (all other cells in seq safe). */
function consistentBlocks(seq: number[], cyclic: boolean, len: number, vals: ArrayLike<number>): number {
  const m = seq.length;
  if (len === 0) return 0;
  let count = 0;
  const starts = cyclic ? m : m - len + 1;
  if (cyclic && len >= m) {
    // whole cycle
    for (const j of seq) if (j < 0 || vals[j] === 0) return 0;
    return 1;
  }
  for (let s = 0; s < starts; s++) {
    let ok = true;
    for (let t = 0; t < m && ok; t++) {
      const off = cyclic ? (t - s + m) % m : t - s;
      const inBlock = off >= 0 && off < len;
      const j = seq[t];
      if (inBlock) {
        if (j < 0 || vals[j] === 0) ok = false;
      } else if (j >= 0 && vals[j] === 1) ok = false;
    }
    if (ok) count++;
  }
  return count;
}

let chainSeen = new Int32Array(0);
let chainStamp = 0;
const chainStack: number[] = [];

/**
 * chain: flood from the clue's neighbours through the cells `pass` accepts (never through the clue
 * itself); returns the number of cells reached. `out` (optional) collects them.
 */
export function chainFlood(c: Constraint, pass: (v: number) => boolean, vals: ArrayLike<number>, out?: number[]): number {
  const g = c.graph!;
  if (chainSeen.length < g.length) chainSeen = new Int32Array(g.length * 2);
  const s = ++chainStamp;
  const seen = chainSeen;
  seen[c.self!] = s;
  const st = chainStack;
  st.length = 0;
  for (const j of c.cells)
    if (seen[j] !== s && pass(vals[j])) {
      seen[j] = s;
      st.push(j);
    }
  let cnt = 0;
  while (st.length) {
    const x = st.pop()!;
    cnt++;
    if (out) out.push(x);
    for (const y of g[x])
      if (seen[y] !== s && pass(vals[y])) {
        seen[y] = s;
        st.push(y);
      }
  }
  return cnt;
}

const isGem = (v: number) => v === 1;
const notSafe = (v: number) => v !== 0;

/** chain: [min, max] crystals in the touching clusters under a partial assignment. */
export function chainBounds(c: Constraint, vals: ArrayLike<number>): [number, number] {
  return [chainFlood(c, isGem, vals), chainFlood(c, notSafe, vals)];
}

export function feasible(c: Constraint, vals: ArrayLike<number>): boolean {
  switch (c.kind) {
    case 'sum': {
      let gems = 0, unk = 0;
      for (const j of c.cells) {
        const v = vals[j];
        if (v === 1) gems++;
        else if (v === -1) unk++;
      }
      const need = c.value - gems;
      if (need < 0 || need > unk) return false;
      if (!c.mod) return true;
      if (c.mod.type === 'together') {
        if (c.value <= 1) return true;
        return consistentBlocks(c.mod.seq, c.mod.cyclic, c.value, vals) > 0;
      }
      // apart
      if (c.value <= 1) return false;
      return binom(unk, need) > consistentBlocks(c.mod.seq, c.mod.cyclic, c.value, vals);
    }
    case 'parity': {
      let gems = 0;
      for (const j of c.cells) {
        const v = vals[j];
        if (v === -1) return true;
        if (v === 1) gems++;
      }
      return (gems & 1) === c.value;
    }
    case 'link': {
      const a = vals[c.cells[0]], b = vals[c.cells[1]];
      if (a === -1 || b === -1) return true;
      return (a === b) === (c.value === 1);
    }
    case 'eye': {
      let lo = 0, hi = 0;
      for (const r of c.rays!) {
        // the ray sees a crystal iff it contains one: a known crystal anywhere decides it
        let status = 0; // 0 sees nothing, 1 sees crystal, 2 undecided
        for (const j of r) {
          const v = vals[j];
          if (v === 1) {
            status = 1;
            break;
          }
          if (v === -1) status = 2;
        }
        if (status === 1) { lo++; hi++; } else if (status === 2) hi++;
      }
      return c.value >= lo && c.value <= hi;
    }
    case 'chain': {
      const [lo, hi] = chainBounds(c, vals);
      return c.value >= lo && c.value <= hi;
    }
  }
}

/** True when the constraint is fully decided (used to dim finished clues). */
export function isResolved(c: Constraint, vals: ArrayLike<number>): boolean {
  if (c.kind === 'chain') {
    const [lo, hi] = chainBounds(c, vals);
    return lo === hi;
  }
  for (const j of c.cells) if (vals[j] === -1) return false;
  return true;
}

/** Display value of a cell clue in phase t: number, or 'even'/'odd' for parity. */
export function clueDisplay(b: Board, i: number, phase = 0): { text: string; values?: number[] } | null {
  const clue = effectiveClue(b, i, phase);
  if (!clue || clue.k === 'blank') return null;
  const cons = cellConstraints(b, i, phase);
  if (!cons.length) return null;
  if (clue.k === 'parity') return { text: cons[0].value ? 'odd' : 'even' };
  return { text: String(cons[0].value) };
}
