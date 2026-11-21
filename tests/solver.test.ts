import { describe, expect, it } from 'vitest';
import { buildBoard, cellConstraints, globalConstraint, zoneConstraint, type Constraint } from '../src/core/rules';
import { nextDeduction, rateDifficulty, solveLevel } from '../src/core/solver';
import type { Level, LevelCell } from '../src/core/types';

/** Cells laid out far apart (no adjacency) so only zones/links/global talk about them. */
function zoneLevel(gems: boolean[], zones: number[][]): Level {
  const cells: LevelCell[] = gems.map((gem, i) => ({ q: i * 3, r: 0, gem, clue: { k: 'blank' } }));
  return { id: 't', cells, walls: [], fog: false, zones: zones.map((cells) => ({ cells })) };
}

function zonesOf(level: Level): Constraint[] {
  const b = buildBoard(level);
  return level.zones!.map((_, z) => zoneConstraint(b, z));
}

const unknown = (n: number) => new Int8Array(n).fill(-1);

describe('solver tiers', () => {
  it('tier 1: a satisfied number clears its neighbours', () => {
    const cells: LevelCell[] = [{ q: 0, r: 0, gem: false, start: true }];
    const ring = [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0]];
    ring.forEach(([q, r], i) => cells.push({ q, r, gem: i === 0 }));
    const level: Level = { id: 't1', cells, walls: [], fog: false };
    const b = buildBoard(level);
    const vals = unknown(b.n);
    vals[0] = 0;
    vals[1] = 1; // the crystal is already marked
    const d = nextDeduction(b, vals, cellConstraints(b, 0));
    expect(d).not.toBeNull();
    expect(d!.tier).toBe(1);
    expect(d!.gem).toBe(false);
    expect(d!.reasons).toHaveLength(1);
    // all six neighbours are crystals: one tier-1 event solves it
    const full: Level = { id: 't1b', cells: cells.map((c, i) => ({ ...c, gem: i > 0 })), walls: [], fog: false };
    const r = solveLevel(full);
    expect(r.solved).toBe(true);
    expect(solveLevel(level).solved).toBe(false);
    expect(r.tierCounts[1] + r.tierCounts[2] + r.tierCounts[3]).toBe(0);
    expect(r.difficulty).toBeLessThanOrEqual(2);
  });

  it('tier 2: subset reasoning between two zones', () => {
    const level = zoneLevel([true, false, false], [[0, 1], [0, 1, 2]]);
    const b = buildBoard(level);
    const z = zonesOf(level);
    const d = nextDeduction(b, unknown(3), z);
    expect(d).toMatchObject({ cell: 2, gem: false, tier: 2 });
    expect(new Set(d!.reasons)).toEqual(new Set(z));
  });

  it('tier 3: three constraints needed', () => {
    // a+b=1, b+c=1, a+c+d=1  =>  a=c=0, b=d=1
    const level = zoneLevel([false, true, false, true], [[0, 1], [1, 2], [0, 2, 3]]);
    const b = buildBoard(level);
    const z = zonesOf(level);
    const d = nextDeduction(b, unknown(4), z);
    expect(d?.tier).toBe(3);
    expect(d!.reasons).toHaveLength(3);
    expect(level.cells[d!.cell].gem).toBe(d!.gem);
  });

  it('tier 3: global counter with one clue', () => {
    const level = zoneLevel([true, false, false, false], [[0, 1]]);
    const b = buildBoard(level);
    const cons = [globalConstraint(b), ...zonesOf(level)];
    const d = nextDeduction(b, unknown(4), cons);
    expect(d?.tier).toBe(3);
    expect(d!.gem).toBe(false);
    expect([2, 3]).toContain(d!.cell);
    expect(d!.reasons.some((c) => c.src.type === 'global')).toBe(true);
  });

  it('tier 3: global counter with a packing of disjoint clues', () => {
    const level = zoneLevel([true, false, false, true, false, false], [[0, 1], [2, 3]]);
    const b = buildBoard(level);
    const cons = [globalConstraint(b), ...zonesOf(level)];
    const d = nextDeduction(b, unknown(6), cons);
    expect(d?.tier).toBe(3);
    expect(d!.gem).toBe(false);
    expect([4, 5]).toContain(d!.cell);
    expect(d!.reasons).toHaveLength(3);
  });

  it('tier 4: contradiction along a chain', () => {
    // x1+x2=1, x2+x3=1, x3+x4=1, x1+x4+y=1  =>  y = 0 (only by contradiction)
    const level = zoneLevel([true, false, true, false, false], [[0, 1], [1, 2], [2, 3], [0, 3, 4]]);
    const b = buildBoard(level);
    const z = zonesOf(level);
    const d = nextDeduction(b, unknown(5), z);
    expect(d).toMatchObject({ cell: 4, gem: false, tier: 4 });
    expect(d!.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it('returns null when nothing can be deduced', () => {
    const level = zoneLevel([true, false], [[0, 1]]);
    const b = buildBoard(level);
    expect(nextDeduction(b, unknown(2), zonesOf(level))).toBeNull();
    expect(solveLevel(level).solved).toBe(false);
  });

  it('maxTier limits the solver', () => {
    const level = zoneLevel([false, true, false, true], [[0, 1], [1, 2], [0, 2, 3]]);
    level.cells.forEach((c) => (c.clue = { k: 'blank' }));
    expect(solveLevel(level, { noGlobal: true }).solved).toBe(true);
    expect(solveLevel(level, { maxTier: 2, noGlobal: true }).solved).toBe(false);
  });

  it('difficulty grows with hard steps', () => {
    expect(rateDifficulty(10, [5, 0, 0, 0])).toBeLessThanOrEqual(2);
    expect(rateDifficulty(60, [30, 6, 1, 0])).toBeGreaterThanOrEqual(4);
    expect(rateDifficulty(60, [30, 6, 1, 0])).toBeLessThanOrEqual(6);
    expect(rateDifficulty(90, [40, 12, 6, 3])).toBeGreaterThanOrEqual(8);
  });

  it('fog: deductions only target visible cells', () => {
    // global counter with one zone: the cells outside the zone are safe but nothing shows them
    const level = zoneLevel([true, false, false, false], [[0, 1]]);
    level.fog = true;
    const b = buildBoard(level);
    const cons = [globalConstraint(b), ...zonesOf(level)];
    expect(nextDeduction(b, unknown(4), cons)).toBeNull();
    const vis = new Uint8Array([1, 1, 1, 0]);
    expect(nextDeduction(b, unknown(4), cons, vis)).toMatchObject({ cell: 2, gem: false, tier: 3 });
  });
});
