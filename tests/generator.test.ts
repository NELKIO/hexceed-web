import { describe, expect, it } from 'vitest';
import { ahaCells, ahaSteps, dailyLevel, endlessLevel, GEN_VERSION, generateLevel, hardRun, SHAPE_IDS, teachOK } from '../src/core/generator';
import { buildBoard } from '../src/core/rules';
import { components, enclosedHoles } from '../src/core/shapes';
import { solveDetailed, solveLevel } from '../src/core/solver';
import type { Level, MechanicId } from '../src/core/types';

const BASE: MechanicId[] = ['basic', 'counter', 'fog'];

function aspect(L: Level): number {
  const hexes = L.cells.flatMap((c) => [[c.q, c.r], ...(c.extra ?? [])]);
  const xs = hexes.map(([q]) => 1.5 * q);
  const ys = hexes.map(([q, r]) => Math.sqrt(3) * (r + q / 2));
  return (Math.max(...xs) - Math.min(...xs) + 2) / (Math.max(...ys) - Math.min(...ys) + Math.sqrt(3));
}

/** Does the level actually contain the mechanic? */
function has(L: Level, m: MechanicId): boolean {
  const clues = L.cells.flatMap((c) => [c.clue, ...(c.alt ?? [])]);
  switch (m) {
    case 'walls':
      return L.walls.length > 0;
    case 'multiline':
      return clues.some((c) => c?.k === 'line' && (c.dirs?.length ?? 1) > 1);
    case 'together':
    case 'apart':
      return clues.some((c) => c?.mod === m);
    case 'lock':
      return L.cells.some((c) => c.lock);
    case 'gemclue':
      return L.cells.some((c) => c.gem && c.clue);
    case 'link':
      return !!L.links?.length;
    case 'zone':
      return !!L.zones?.length;
    case 'rotate':
      return L.cells.some((c) => c.rot);
    case 'switch':
      return L.cells.some((c) => c.alt);
    case 'big':
      return L.cells.some((c) => c.extra);
    case 'portal':
      return !!L.portals?.length;
    case 'fog':
      return L.fog !== false;
    case 'gaps': {
      const b = buildBoard(L);
      const B = b.bounds;
      for (let q = B.minQ; q <= B.maxQ; q++)
        for (let r = B.minR; r <= B.maxR; r++) if (-q - r >= B.minS && -q - r <= B.maxS && !b.index.has(`${q},${r}`)) return true;
      return false;
    }
    default:
      return clues.some((c) => c?.k === m);
  }
}

describe('generator', () => {
  it('is deterministic', () => {
    const o = { seed: 'det', size: 40, mechanics: [...BASE, 'line', 'radius', 'zone'] as MechanicId[], targetDifficulty: 4 };
    expect(JSON.stringify(generateLevel(o))).toBe(JSON.stringify(generateLevel(o)));
    expect(JSON.stringify(generateLevel({ ...o, seed: 'det2' }))).not.toBe(JSON.stringify(generateLevel(o)));
  });

  // the mechanics the game generates (chain, island, parity, swirl, eye, together/apart, link, big cells,
  // portals, switching cells, gem clues and «Тишина» were cut)
  const MECHS: MechanicId[] = ['walls', 'gaps', 'line', 'multiline', 'radius', 'ring', 'donut', 'cone', 'triangle', 'dot', 'lock', 'rotate', 'zone'];
  const NEEDS: Partial<Record<MechanicId, MechanicId[]>> = {
    multiline: ['line'],
    gaps: ['line'],
    rotate: ['walls', 'line'],
  };
  for (const m of MECHS)
    it(`produces solvable levels with ${m}`, () => {
      const mechanics: MechanicId[] = [...BASE, m, ...(NEEDS[m] ?? [])];
      const L = generateLevel({ seed: `mech-${m}`, size: 40, mechanics, targetDifficulty: 4, feature: [m] });
      const r = solveLevel(L);
      expect(r.solved).toBe(true);
      expect(L.diff).toBe(r.difficulty);
      expect(has(L, m)).toBe(true);
      expect(L.fog).not.toBe(false);
      expect(L.cells.filter((c) => c.start)).toHaveLength(1);
      for (const c of L.cells) if (c.lock) expect(c.lock).toBeLessThanOrEqual(L.cells.filter((x) => x.gem).length);
      expect(buildBoard(L).period).toBeLessThanOrEqual(6);
    });

  it('teaching levels need the taught mechanic', () => {
    for (const m of ['ring', 'zone', 'dot', 'cone'] as MechanicId[]) {
      const mechanics: MechanicId[] = [...BASE, m, ...(NEEDS[m] ?? [])];
      const L = generateLevel({ seed: `teach-${m}`, size: 20, mechanics, targetDifficulty: 2, teach: [m] });
      expect(L.teach).toEqual([m]);
      expect(teachOK(L, mechanics)).toBe(true);
      expect(solveLevel(L).solved).toBe(true);
    }
  });

  it('hits easy and hard targets', () => {
    const easy = generateLevel({ seed: 'easy', size: 30, mechanics: [...BASE, 'line'], targetDifficulty: 2, density: 0.2 });
    const re = solveDetailed(easy);
    expect(re.difficulty).toBeLessThanOrEqual(2);
    expect(re.tierCounts[2] + re.tierCounts[3]).toBe(0);
    const hard = generateLevel({ seed: 'hard', size: 70, mechanics: [...BASE, 'line', 'radius', 'cone', 'zone', 'walls'], targetDifficulty: 8, density: 0.32, attempts: 8 });
    const rh = solveDetailed(hard);
    expect(rh.solved).toBe(true);
    expect(rh.difficulty).toBeGreaterThanOrEqual(5);
    expect(rh.tierCounts[1] + rh.tierCounts[2] + rh.tierCounts[3]).toBeGreaterThanOrEqual(4);
  });

  it('shapes stay compact', () => {
    for (const shape of SHAPE_IDS) {
      const L = generateLevel({ seed: `shape-${shape}`, size: 50, shape, mechanics: ['basic', 'counter', 'gaps', 'line'], targetDifficulty: 2, attempts: 1 });
      const a = aspect(L);
      expect(a).toBeGreaterThanOrEqual(0.45);
      expect(a).toBeLessThanOrEqual(1.05); // portrait-friendly
      expect(L.cells.length).toBeGreaterThanOrEqual(35);
      expect(L.cells.length).toBeLessThanOrEqual(65);
    }
  });

  it('daily and endless levels are deterministic and solvable', () => {
    const d1 = dailyLevel('2026-11-22');
    expect(JSON.stringify(dailyLevel('2026-11-22'))).toBe(JSON.stringify(d1));
    expect(d1.id).toBe('daily-2026-11-22');
    expect(solveLevel(d1).solved).toBe(true);
    for (const diff of ['easy', 'medium', 'hard'] as const) {
      const L = endlessLevel(7, diff);
      expect(solveLevel(L).solved).toBe(true);
    }
  });

  it('endless enforces the rating of each mode; easy is numbers and walls', () => {
    const range = { easy: [1, 2], medium: [3, 5], hard: [5, 10], expert: [6, 10] } as const; // no «Тишина» any more: the top modes rate a little lower
    for (const d of ['easy', 'medium', 'hard', 'expert'] as const)
      for (const seed of [1, 2]) {
        const L = endlessLevel(seed, d);
        expect(L.diff!, `${d} ${seed}`).toBeGreaterThanOrEqual(range[d][0]);
        expect(L.diff!, `${d} ${seed}`).toBeLessThanOrEqual(range[d][1]);
        expect(L.id).toBe(`endless-${d}-${seed}`);
        if (d === 'easy') for (const c of L.cells) expect([undefined, 'num']).toContain(c.clue?.k);
      }
    expect(JSON.stringify(endlessLevel(3, 'hard'))).toBe(JSON.stringify(endlessLevel(3, 'hard')));
  });

  it('hard endless does not split a board when gaps are excluded', () => {
    const L = endlessLevel(2, 'hard', BASE);
    const coords = L.cells.map((c): [number, number] => [c.q, c.r]);
    expect(components(coords)).toHaveLength(1);
    expect(enclosedHoles(coords)).toBe(0);
    expect(solveLevel(L).solved).toBe(true);
  });

  it('daily can be restricted to unlocked mechanics', () => {
    const allowed: MechanicId[] = ['basic', 'counter', 'fog', 'walls', 'line', 'radius'];
    const L = dailyLevel('2026-12-24', allowed);
    expect(L.id).toBe('daily-2026-12-24');
    expect(solveLevel(L).solved).toBe(true);
    for (const c of L.cells) if (c.clue) expect(['num', 'line', 'radius']).toContain(c.clue.k);
    expect(L.links ?? []).toHaveLength(0);
    expect(L.zones ?? []).toHaveLength(0);
    expect(JSON.stringify(dailyLevel('2026-12-24', allowed))).toBe(JSON.stringify(L));
    expect(dailyLevel('2026-12-24').diff!).toBeGreaterThanOrEqual(3);
  });

  it('daily and easy endless stay human-solvable without blank clues', () => {
    const check = (L: ReturnType<typeof dailyLevel>, maxAha: number) => {
      const r = solveDetailed(L, { trace: true });
      const aha = ahaSteps(r);
      expect(ahaCells(r), L.id).toBeLessThanOrEqual(maxAha);
      expect(hardRun(r), L.id).toBeLessThanOrEqual(3);
      for (const e of aha) expect(e.tier === 3 && e.reasons.length <= 3, L.id).toBe(true);
      expect(L.cells.some((c) => c.clue?.k === 'blank'), L.id).toBe(false);
    };
    for (const d of ['2026-11-22', '2026-11-23', '2026-11-24']) check(dailyLevel(d), 4);
    expect(typeof GEN_VERSION).toBe('string');
    for (const s of [1, 2, 3]) check(endlessLevel(s, 'easy'), 0);
  });

  it('daily and endless never use cut mechanics', () => {
    const cut = ['chain', 'island', 'parity', 'swirl', 'eye', 'blank'];
    const levels = [dailyLevel('2026-12-01'), dailyLevel('2026-12-02'), endlessLevel(5, 'medium'), endlessLevel(5, 'hard'), endlessLevel(5, 'expert')];
    for (const L of levels) {
      for (const c of L.cells) {
        expect(cut.includes(c.clue?.k ?? 'num'), L.id).toBe(false);
        expect(c.clue?.mod ?? c.extra ?? c.alt, L.id).toBeUndefined();
      }
      expect((L.links ?? []).length + (L.portals ?? []).length, L.id).toBe(0);
    }
  });
});
