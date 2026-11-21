import { describe, expect, it } from 'vitest';
import { hexDistance } from '../src/core/hex';
import {
  buildBoard,
  cellConstraints,
  cellConstraintsAll,
  chainBounds,
  coneCells,
  donutCells,
  dotCells,
  effectiveClue,
  feasible,
  globalConstraint,
  islandCells,
  linkConstraint,
  radiusCells,
  ray,
  ringCells,
  swirlCells,
  triangleCells,
  zoneConstraint,
  type Constraint,
} from '../src/core/rules';
import type { Clue, Level, LevelCell, Wall } from '../src/core/types';

/** Hexagon of radius R around the origin. */
function hexCoords(R: number): [number, number][] {
  const out: [number, number][] = [];
  for (let q = -R; q <= R; q++) for (let r = -R; r <= R; r++) if (hexDistance(0, 0, q, r) <= R) out.push([q, r]);
  return out;
}

function mk(coords: [number, number][], gems: [number, number][], opts: { walls?: Wall[]; clues?: Record<string, Clue> } = {}): Level {
  const g = new Set(gems.map(([q, r]) => `${q},${r}`));
  const cells: LevelCell[] = coords.map(([q, r]) => {
    const c: LevelCell = { q, r, gem: g.has(`${q},${r}`) };
    const clue = opts.clues?.[`${q},${r}`];
    if (clue) c.clue = clue;
    return c;
  });
  return { id: 't', cells, walls: opts.walls ?? [] };
}

const idx = (L: Level, q: number, r: number) => L.cells.findIndex((c) => c.q === q && c.r === r);
const unknown = (n: number) => new Int8Array(n).fill(-1);

describe('num and walls', () => {
  it('counts crystals among the neighbours, not through walls', () => {
    const L = mk(hexCoords(1), [[0, -1], [0, 1]]);
    const b = buildBoard(L);
    const c = idx(L, 0, 0);
    expect(cellConstraints(b, c)[0]).toMatchObject({ kind: 'sum', value: 2 });
    const W = mk(hexCoords(1), [[0, -1], [0, 1]], { walls: [[0, 0, 0]] });
    const bw = buildBoard(W);
    const con = cellConstraints(bw, c)[0];
    expect(con.value).toBe(1);
    expect(con.cells).not.toContain(idx(W, 0, -1));
    expect(con.cells).toHaveLength(5);
    // wall normalisation: the same edge given from the other side
    const W2 = mk(hexCoords(1), [[0, -1], [0, 1]], { walls: [[0, -1, 3]] });
    expect(cellConstraints(buildBoard(W2), c)[0].value).toBe(1);
  });
});

describe('line', () => {
  const col: [number, number][] = [[0, 0], [0, 1], [0, 2], [0, 3]];
  it('counts along the ray', () => {
    const L = mk(col, [[0, 2], [0, 3]], { clues: { '0,0': { k: 'line', dirs: [3] } } });
    const b = buildBoard(L);
    expect(ray(b, 0, 3)).toEqual([1, 2, 3]);
    expect(cellConstraints(b, 0)[0].value).toBe(2);
  });
  it('stops at a wall', () => {
    const L = mk(col, [[0, 2], [0, 3]], { walls: [[0, 1, 3]], clues: { '0,0': { k: 'line', dirs: [3] } } });
    const b = buildBoard(L);
    expect(ray(b, 0, 3)).toEqual([1]);
    expect(cellConstraints(b, 0)[0].value).toBe(0);
  });
  it('jumps gaps', () => {
    const L = mk([[0, 0], [0, 1], [0, 3]], [[0, 3]], { clues: { '0,0': { k: 'line', dirs: [3] } } });
    const b = buildBoard(L);
    expect(ray(b, 0, 3)).toEqual([1, 2]);
    expect(cellConstraints(b, 0)[0].value).toBe(1);
  });
  it('multiline unions several rays', () => {
    const L = mk(hexCoords(2), [[0, -2], [0, 2], [2, 0]], { clues: { '0,0': { k: 'line', dirs: [0, 3] } } });
    const b = buildBoard(L);
    const con = cellConstraints(b, idx(L, 0, 0))[0];
    expect(con.cells).toHaveLength(4);
    expect(con.value).toBe(2);
  });
});

describe('areas', () => {
  it('radius = distance 1..2 (18), ring = exactly 2 (12), donut = 2..3 (30); walls ignored', () => {
    const walls: Wall[] = [0, 1, 2, 3, 4, 5].map((d) => [0, 0, d] as Wall);
    const L = mk(hexCoords(3), [[2, 0], [-1, 0], [3, 0]], { walls, clues: { '0,0': { k: 'radius' } } });
    const b = buildBoard(L);
    const c = idx(L, 0, 0);
    expect(radiusCells(b, c)).toHaveLength(18);
    expect(ringCells(b, c)).toHaveLength(12);
    expect(donutCells(b, c)).toHaveLength(30);
    expect(cellConstraints(b, c)[0].value).toBe(2);
    L.cells[c].clue = { k: 'ring' };
    expect(cellConstraints(buildBoard(L), c)[0].value).toBe(1);
    L.cells[c].clue = { k: 'donut' };
    expect(cellConstraints(buildBoard(L), c)[0].value).toBe(2);
  });
  it('triangle = the far 6 hexes of the wedge; dot = single hexes', () => {
    const L = mk(hexCoords(4), [[2, -2], [0, -2]]);
    const b = buildBoard(L);
    const c = idx(L, 0, 0);
    for (let k = 0; k < 6; k++) {
      const t = triangleCells(b, c, k);
      expect(t).toHaveLength(6);
      const cone = new Set(coneCells(b, c, k));
      expect(t.filter((j) => cone.has(j))).toHaveLength(5); // all but 2·e_c + 2·e_(c+1) lie in the cone
    }
    expect(dotCells(b, c, 0)).toEqual([idx(L, 0, -2)]);
    expect(dotCells(b, c, 0, true)).toEqual([idx(L, 1, -2)]);
    L.cells[c].clue = { k: 'dot', dirs: [0, 1] };
    expect(cellConstraints(buildBoard(L), c)[0]).toMatchObject({ value: 2 }); // (0,-2) and (2,-2)
  });
  it('each cone is a 9-cell wedge; six cones tile radius 3', () => {
    const L = mk(hexCoords(3), []);
    const b = buildBoard(L);
    const c = idx(L, 0, 0);
    const union = new Set<number>();
    for (let k = 0; k < 6; k++) {
      const cc = coneCells(b, c, k);
      expect(cc).toHaveLength(9);
      for (const j of cc) {
        const d = hexDistance(0, 0, L.cells[j].q, L.cells[j].r);
        expect(d).toBeGreaterThanOrEqual(1);
        expect(d).toBeLessThanOrEqual(3);
        union.add(j);
      }
    }
    expect(union.size).toBe(36);
  });
});

describe('eye (field of view)', () => {
  it('counts the hexes seen before the first crystal', () => {
    const L = mk(hexCoords(2), [[0, -2], [0, -1], [2, 0]], { clues: { '0,0': { k: 'eye' } } });
    const b = buildBoard(L);
    const con = cellConstraints(b, idx(L, 0, 0))[0];
    expect(con.kind).toBe('eye');
    expect(con.value).toBe(9); // N sees 0, SE sees 1, the other four rays see 2 each
  });
  it('walls stop sight, gaps are jumped but not counted', () => {
    const W = mk(hexCoords(2), [[0, -2], [2, 0]], { walls: [[0, 0, 0]], clues: { '0,0': { k: 'eye' } } });
    expect(cellConstraints(buildBoard(W), idx(W, 0, 0))[0].value).toBe(9);
    const O = mk(hexCoords(2), [[0, -2], [2, 0]], { clues: { '0,0': { k: 'eye' } } });
    expect(cellConstraints(buildBoard(O), idx(O, 0, 0))[0].value).toBe(10);
    const G = mk([[0, 0], [0, 1], [0, 3]], [], { clues: { '0,0': { k: 'eye' } } });
    expect(cellConstraints(buildBoard(G), 0)[0].value).toBe(2);
  });
  it('partial feasibility is exact (per-ray counts + subset sum)', () => {
    const L = mk(hexCoords(2), [], { clues: { '0,0': { k: 'eye' } } });
    const b = buildBoard(L);
    const con = cellConstraints(b, idx(L, 0, 0))[0];
    const v = unknown(b.n);
    v[idx(L, 0, 0)] = 0;
    for (let k = 0; k <= 12; k++) expect(feasible({ ...con, value: k }, v)).toBe(true);
    v[idx(L, 0, -1)] = 1; // N ray blocked at once
    expect(feasible({ ...con, value: 11 }, v)).toBe(false);
    expect(feasible({ ...con, value: 10 }, v)).toBe(true);
    v[idx(L, 0, -1)] = 0; // N ray sees 1 or 2
    for (const r of con.rays!.slice(1)) for (const j of r) v[j] = 0; // the other five rays see 2 each
    expect(feasible({ ...con, value: 10 }, v)).toBe(false);
    expect(feasible({ ...con, value: 11 }, v)).toBe(true);
    expect(feasible({ ...con, value: 12 }, v)).toBe(true);
  });
});

describe('parity', () => {
  it('only the parity is known', () => {
    const L = mk(hexCoords(1), [[0, -1], [1, 0], [0, 1]], { clues: { '0,0': { k: 'parity' } } });
    const b = buildBoard(L);
    const con = cellConstraints(b, idx(L, 0, 0))[0];
    expect(con).toMatchObject({ kind: 'parity', value: 1 });
    const v = unknown(b.n);
    expect(feasible(con, v)).toBe(true);
    for (const j of con.cells) v[j] = 0;
    expect(feasible(con, v)).toBe(false);
    v[con.cells[0]] = 1;
    expect(feasible(con, v)).toBe(true);
  });
});

describe('together / apart', () => {
  // the origin cell of a radius-1 hexagon minus some neighbours
  const at = (dirs: number[]) => {
    const D: [number, number][] = [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0]];
    return [[0, 0] as [number, number], ...dirs.map((d) => D[d])];
  };
  const make = (present: number[], mod: 'together' | 'apart', value: number): { con: Constraint; L: Level } => {
    const L = mk(at(present), [], { clues: { '0,0': { k: 'num', mod } } });
    const b = buildBoard(L);
    const con = { ...cellConstraints(b, 0)[0], value };
    return { con, L };
  };
  const D: [number, number][] = [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0]];
  const setGems = (L: Level, dirs: number[], rest: number) => {
    const v = new Int8Array(L.cells.length).fill(rest);
    v[0] = 0;
    for (let i = 1; i < L.cells.length; i++) if (rest === -1) v[i] = -1;
    for (const d of dirs) v[idx(L, D[d][0], D[d][1])] = 1;
    return v;
  };

  it('missing neighbours separate the cycle', () => {
    const t = make([0, 1, 2, 3], 'together', 2);
    expect(feasible(t.con, setGems(t.L, [0, 3], 0))).toBe(false);
    expect(feasible(t.con, setGems(t.L, [0, 1], 0))).toBe(true);
    const a = make([0, 1, 2, 3], 'apart', 2);
    expect(feasible(a.con, setGems(a.L, [0, 3], 0))).toBe(true);
    expect(feasible(a.con, setGems(a.L, [2, 3], 0))).toBe(false);
  });
  it('the cycle wraps around (NW next to N)', () => {
    const t = make([0, 1, 4, 5], 'together', 2);
    expect(feasible(t.con, setGems(t.L, [5, 0], 0))).toBe(true);
    expect(feasible(t.con, setGems(t.L, [1, 4], 0))).toBe(false);
  });
  it('walls separate too', () => {
    const L = mk(at([0, 1, 2, 3, 4, 5]), [], { walls: [[0, 0, 1]], clues: { '0,0': { k: 'num', mod: 'together' } } });
    const con = { ...cellConstraints(buildBoard(L), 0)[0], value: 2 };
    expect(feasible(con, setGems(L, [0, 2], 0))).toBe(false); // NE walled off between them
    expect(feasible(con, setGems(L, [2, 3], 0))).toBe(true);
  });
  it('partial assignments are judged exactly', () => {
    const a = make([0, 1, 2, 3, 4, 5], 'apart', 2);
    const v = setGems(a.L, [0], -1);
    expect(feasible(a.con, v)).toBe(true);
    // N crystal, all but NE unknown -> NE crystal would be together; others fine
    for (const d of [2, 3, 4, 5]) v[idx(a.L, D[d][0], D[d][1])] = 0;
    expect(feasible(a.con, v)).toBe(false); // only NE left: must be the 2nd crystal -> together
    const t = make([0, 1, 2, 3, 4, 5], 'together', 3);
    const vt = setGems(t.L, [0, 3], -1);
    expect(feasible(t.con, vt)).toBe(false); // N and S cannot be in one arc of 3
  });
  it('apart needs at least two crystals', () => {
    const a = make([0, 1, 2, 3, 4, 5], 'apart', 1);
    expect(feasible(a.con, setGems(a.L, [], -1))).toBe(false);
  });
  it('together on a single line', () => {
    const L = mk([[0, 0], [0, 1], [0, 2], [0, 3]], [[0, 1], [0, 3]], { clues: { '0,0': { k: 'line', dirs: [3], mod: 'apart' } } });
    const con = cellConstraints(buildBoard(L), 0)[0];
    expect(con.mod).toMatchObject({ type: 'apart', cyclic: false });
    const v = new Int8Array([0, -1, -1, -1]);
    v[1] = 1;
    v[2] = 1;
    expect(feasible(con, v)).toBe(false);
    v[2] = 0;
    expect(feasible(con, v)).toBe(true);
  });
});

describe('swirl, island, chain', () => {
  it('swirl walks around the pivot; walls end the walk', () => {
    const L = mk(hexCoords(3), [[1, -2], [2, -1]]);
    const b = buildBoard(L);
    const c = idx(L, 0, 0);
    const at = (q: number, r: number) => idx(L, q, r);
    expect(swirlCells(b, c, 0)).toEqual([at(0, -1), at(1, -2), at(2, -2), at(2, -1), at(1, 0)]);
    expect(swirlCells(b, c, 0, true)).toEqual([at(0, -1), at(-1, -1), at(-2, 0), at(-2, 1), at(-1, 1)]);
    const W = mk(hexCoords(3), [[1, -2], [2, -1]], { walls: [[1, -2, 2]], clues: { '0,0': { k: 'swirl', dirs: [0] } } });
    const bw = buildBoard(W);
    expect(swirlCells(bw, c, 0)).toEqual([at(0, -1), at(1, -2)]);
    expect(cellConstraints(bw, c)[0].value).toBe(1);
    const W0 = mk(hexCoords(3), [], { walls: [[0, 0, 0]] });
    expect(swirlCells(buildBoard(W0), c, 0)).toEqual([]);
  });
  it('island = the wall-bounded region', () => {
    // a column of 4 hexes, wall between 2nd and 3rd
    const L = mk([[0, 0], [0, 1], [0, 2], [0, 3]], [[0, 1], [0, 3]], { walls: [[0, 1, 3]], clues: { '0,0': { k: 'island' } } });
    const b = buildBoard(L);
    expect(islandCells(b, 0)).toEqual([1]);
    expect(cellConstraints(b, 0)[0].value).toBe(1);
  });
  it('chain counts the crystal clusters touching the cell', () => {
    const L = mk(hexCoords(3), [[0, -1], [0, -2], [1, -3], [3, 0], [-1, 1]], { clues: { '0,0': { k: 'chain' } } });
    const b = buildBoard(L);
    const c = idx(L, 0, 0);
    const con = cellConstraints(b, c)[0];
    expect(con.kind).toBe('chain');
    expect(con.value).toBe(4); // N cluster of 3 + SW single; (3,0) does not touch
    expect(con.cells).toHaveLength(6);
    const v = new Int8Array(b.n).fill(-1);
    v[c] = 0;
    expect(chainBounds(con, v)[0]).toBe(0);
    expect(feasible(con, v)).toBe(true);
    const sol = new Int8Array(L.cells.map((x) => (x.gem ? 1 : 0)));
    expect(chainBounds(con, sol)).toEqual([4, 4]);
    expect(feasible({ ...con, value: 3 }, sol)).toBe(false);
    // all neighbours safe -> nothing can touch the cell
    const v2 = new Int8Array(b.n).fill(-1);
    v2[c] = 0;
    for (const j of con.cells) v2[j] = 0;
    expect(feasible(con, v2)).toBe(false);
    expect(feasible({ ...con, value: 0 }, v2)).toBe(true);
  });
});

describe('big cells, portals, phases', () => {
  it('a big cell is one unit: counted once, neighbours of all its hexes', () => {
    const L: Level = { id: 'b', walls: [], cells: [
      { q: 0, r: 0, gem: true, extra: [[1, 0]] },
      { q: 0, r: 1, gem: false },
      { q: 2, r: 0, gem: false },
      { q: -1, r: 0, gem: false },
      { q: 1, r: 1, gem: false, clue: { k: 'radius' } },
    ] };
    const b = buildBoard(L);
    expect(b.index.get('1,0')).toBe(0);
    expect(b.phases[0].adj[0].sort()).toEqual([1, 2, 3, 4]);
    const con = cellConstraints(b, 4)[0];
    expect(con.cells.filter((j) => j === 0)).toHaveLength(1);
    expect(con.value).toBe(1);
    expect(cellConstraints(b, 2)[0].value).toBe(1);
  });
  it('portals connect across gaps for numbers and lines', () => {
    const L: Level = { id: 'p', cells: [{ q: 0, r: 0, gem: false }, { q: 0, r: 3, gem: true }, { q: 0, r: 4, gem: true }], walls: [], portals: [[0, 0, 3], [0, 3, 0]] };
    const b = buildBoard(L);
    expect(b.neighbours[0][3]).toBe(1);
    expect(cellConstraints(b, 0)[0].value).toBe(1);
    expect(ray(b, 0, 3)).toEqual([1, 2]);
    const noPortal = buildBoard({ ...L, portals: [] });
    expect(noPortal.neighbours[0][3]).toBe(-1);
    expect(cellConstraints(noPortal, 0)[0].value).toBe(0);
  });
  it('rotating cells turn their walls and clue directions with the phase', () => {
    const L = mk(hexCoords(1), [[1, -1]], { walls: [[0, 0, 0]] });
    const c = idx(L, 0, 0);
    L.cells[c].rot = [0, 1];
    L.cells[c].clue = { k: 'line', dirs: [3] };
    const b = buildBoard(L);
    expect(b.period).toBe(2);
    const n = idx(L, 0, -1);
    expect(cellConstraints(b, n, 0)[0].cells).not.toContain(c);
    expect(cellConstraints(b, n, 1)[0].cells).toContain(c);
    expect(effectiveClue(b, c, 1)!.dirs).toEqual([4]);
    expect(cellConstraintsAll(b, n)).toHaveLength(2);
    expect(cellConstraintsAll(b, idx(L, 0, 1))).toHaveLength(1); // unaffected neighbour: same info in both phases
  });
  it('switching cells cycle their clue', () => {
    const L = mk(hexCoords(2), [[0, -2], [0, -1]]);
    const c = idx(L, 0, 0);
    L.cells[c].alt = [{ k: 'ring' }, { k: 'radius' }];
    const b = buildBoard(L);
    expect(b.period).toBe(3);
    expect([0, 1, 2, 3].map((t) => effectiveClue(b, c, t)!.k)).toEqual(['num', 'ring', 'radius', 'num']);
    expect(cellConstraintsAll(b, c).map((x) => x.value)).toEqual([1, 1, 2]);
  });
});

describe('link, zone, global', () => {
  it('link same / different', () => {
    const L: Level = { ...mk([[0, 0], [3, 0]], [[0, 0]]), links: [{ a: 0, b: 1, same: false }] };
    const con = linkConstraint(buildBoard(L), 0);
    expect(feasible(con, new Int8Array([1, 0]))).toBe(true);
    expect(feasible(con, new Int8Array([1, 1]))).toBe(false);
    expect(feasible(con, new Int8Array([1, -1]))).toBe(true);
    const same = { ...con, value: 1 };
    expect(feasible(same, new Int8Array([0, 0]))).toBe(true);
    expect(feasible(same, new Int8Array([0, 1]))).toBe(false);
  });
  it('zone counts its cells', () => {
    const L: Level = { ...mk(hexCoords(1), [[0, 0], [1, 0], [0, 1]]), zones: [{ cells: [0, 1, 2, 3] }] };
    const b = buildBoard(L);
    const z = zoneConstraint(b, 0);
    expect(z.value).toBe(L.zones![0].cells.filter((i) => L.cells[i].gem).length);
    expect(globalConstraint(b)).toMatchObject({ kind: 'sum', value: 3 });
    expect(globalConstraint(b).cells).toHaveLength(7);
  });
  it('gem clues: a crystal with a radius clue', () => {
    const L = mk(hexCoords(2), [[0, 0], [1, 0]], { clues: { '0,0': { k: 'radius' } } });
    const cons = cellConstraints(buildBoard(L), idx(L, 0, 0));
    expect(cons[0].value).toBe(1);
    const plain = mk(hexCoords(1), [[0, 0]]);
    expect(cellConstraints(buildBoard(plain), idx(plain, 0, 0))).toHaveLength(0);
  });
});
