import { describe, expect, it } from 'vitest';
import { generateLevel } from '../src/core/generator';
import { makeRng } from '../src/core/rng';
import { buildBoard, cellConstraints, feasible, staticConstraints, type Constraint } from '../src/core/rules';
import { nextDeduction } from '../src/core/solver';
import type { MechanicId } from '../src/core/types';

const ALL: MechanicId[] = ['basic', 'counter', 'fog', 'walls', 'gaps', 'line', 'multiline', 'radius', 'ring', 'donut', 'cone', 'triangle', 'lock', 'gemclue', 'dot', 'swirl', 'rotate', 'switch', 'big', 'portal', 'island', 'chain', 'together', 'apart', 'eye', 'parity', 'link', 'zone', 'blank'];

/** Brute force: which unknown cells have the same value in every assignment satisfying all constraints. */
function bruteForced(n: number, vals: Int8Array, cons: Constraint[]): Map<number, number> | null {
  const unk: number[] = [];
  for (let i = 0; i < n; i++) if (vals[i] === -1) unk.push(i);
  const seen = new Map<number, number>(); // bit0 safe, bit1 gem
  const v = Int8Array.from(vals);
  let sols = 0;
  const rec = (k: number) => {
    for (const c of cons) if (!feasible(c, v)) return; // feasible is exact, so pruning is safe
    if (k === unk.length) {
      sols++;
      for (const x of unk) seen.set(x, (seen.get(x) ?? 0) | (v[x] === 1 ? 2 : 1));
      return;
    }
    for (const b of [0, 1]) {
      v[unk[k]] = b;
      rec(k + 1);
    }
    v[unk[k]] = -1;
  };
  rec(0);
  if (!sols) return null;
  const forced = new Map<number, number>();
  for (const x of unk) {
    const s = seen.get(x)!;
    if (s !== 3) forced.set(x, s === 2 ? 1 : 0);
  }
  return forced;
}

describe('solver soundness against brute force', () => {
  it('every hint is a truly forced move, and hints exist when moves are forced', () => {
    const rng = makeRng(12345);
    let checked = 0, missed = 0, forcedStates = 0;
    for (let t = 0; t < 40; t++) {
      const mech = t % 3 === 0 ? (['basic', 'counter', 'eye', 'walls', 'gaps'] as MechanicId[]) : ALL.filter(() => rng.chance(0.5));
      const level = generateLevel({ seed: 1000 + t, size: 12 + rng.int(8), mechanics: mech, targetDifficulty: 3, attempts: 1, special: t % 3 === 0 ? 0.6 : undefined });
      const b = buildBoard(level);
      for (let s = 0; s < 6; s++) {
        const vals = new Int8Array(b.n).fill(-1);
        const known = new Set<number>();
        const p = 0.05 + 0.3 * rng.next();
        level.cells.forEach((c, i) => {
          if (rng.chance(p) || c.start || c.lock) known.add(i);
        });
        for (const i of known) vals[i] = level.cells[i].gem ? 1 : 0;
        let unk = 0;
        for (let i = 0; i < b.n; i++) if (vals[i] === -1) unk++;
        if (unk > 18 || unk === 0) continue;
        const cons = staticConstraints(b);
        for (const i of known) if (!level.cells[i].lock || level.cells[i].gem) cons.push(...cellConstraints(b, i));
        const forced = bruteForced(b.n, vals, cons)!;
        expect(forced).not.toBeNull();
        const d = nextDeduction(b, vals, cons);
        checked++;
        if (forced.size) forcedStates++;
        if (d) {
          expect(forced.get(d.cell)).toBe(d.gem ? 1 : 0);
          expect(level.cells[d.cell].gem).toBe(d.gem);
          // the reasons alone must prove it
          const alone = bruteForced(b.n, vals, d.reasons);
          expect(alone?.get(d.cell)).toBe(d.gem ? 1 : 0);
        } else if (forced.size) missed++;
      }
    }
    expect(checked).toBeGreaterThan(50);
    // the solver is bounded (tier 4 is a limited contradiction search) but should rarely miss
    expect(missed).toBeLessThanOrEqual(Math.ceil(forcedStates * 0.05));
  });
});
