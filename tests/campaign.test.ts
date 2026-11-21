import { describe, expect, it } from 'vitest';
import { act, activeConstraints, knownVals, newGame } from '../src/core/game';
import { teachOK } from '../src/core/generator';
import { nextDeduction, solveLevel } from '../src/core/solver';
import type { Level } from '../src/core/types';
import campaign from '../src/levels/campaign.json';
import { WORLDS, mechanicsUpTo } from '../src/levels/worlds';

const levels = campaign as unknown as Level[];

function islands(l: Level): number {
  const hexes = l.cells.flatMap((c) => [[c.q, c.r] as [number, number], ...(c.extra ?? [])]);
  const set = new Set(hexes.map(([q, r]) => `${q},${r}`));
  const seen = new Set<string>();
  let k = 0;
  for (const [q, r] of hexes) {
    if (seen.has(`${q},${r}`)) continue;
    k++;
    const st: [number, number][] = [[q, r]];
    seen.add(`${q},${r}`);
    while (st.length) {
      const [x, y] = st.pop()!;
      for (const [dq, dr] of [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0]]) {
        const s = `${x + dq},${y + dr}`;
        if (set.has(s) && !seen.has(s)) {
          seen.add(s);
          st.push([x + dq, y + dr]);
        }
      }
    }
  }
  return k;
}

describe('campaign.json', () => {
  it('matches the world list', () => {
    const ids = levels.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(WORLDS.flatMap((w) => w.levels));
    expect(levels.length).toBeGreaterThanOrEqual(140);
  });

  it('every level is solvable without guessing and rated as stored', () => {
    for (const l of levels) {
      const r = solveLevel(l);
      expect(r.solved, l.id).toBe(true);
      expect(r.difficulty, l.id).toBe(l.diff);
    }
  });

  it('levels are sane: sizes, locks, starts', () => {
    for (const l of levels) {
      expect(l.cells.length, l.id).toBeGreaterThanOrEqual(7);
      expect(l.cells.length, l.id).toBeLessThanOrEqual(300);
      const gems = l.cells.filter((c) => c.gem).length;
      for (const c of l.cells) {
        if (c.lock) expect(c.lock).toBeLessThanOrEqual(gems);
        if (c.start) expect(c.gem).toBe(false);
      }
    }
  });

  it('teaching levels need their mechanic', () => {
    WORLDS.forEach((w) => {
      for (const id of w.levels) {
        const l = levels.find((x) => x.id === id)!;
        if (l.teach?.length) expect(teachOK(l, mechanicsUpTo(w.n)), id).toBe(true);
      }
    });
  });

  it('difficulty ramps: the finale is hard, the first world easy', () => {
    const avg = (w: number) => {
      const ls = WORLDS[w].levels.map((id) => levels.find((l) => l.id === id)!);
      return ls.reduce((s, l) => s + (l.diff ?? 0), 0) / ls.length;
    };
    expect(avg(0)).toBeLessThan(2.5);
    expect(avg(WORLDS.length - 1)).toBeGreaterThanOrEqual(6);
    expect(avg(WORLDS.length - 1)).toBeGreaterThan(avg(0) + 3);
    for (const id of ['w01-01', 'w01-02', 'w01-03', 'w01-04']) expect(levels.find((l) => l.id === id)!.cells.length).toBeLessThanOrEqual(25);
  });

  it('follows the calibration: one start, fog, sizes', () => {
    levels.forEach((l, i) => {
      const starts = l.cells.filter((c) => c.start).length;
      if (i === 0) expect(starts, l.id).toBeLessThanOrEqual(3);
      else if (l.cells.length >= 120) expect(starts, l.id).toBeLessThanOrEqual(3);
      else expect(starts, l.id).toBeLessThanOrEqual(islands(l) > 1 ? 3 : l.teach ? 2 : 1);
      expect(l.fog !== false, l.id).toBe(i >= 3);
      expect(l.cells.length, l.id).toBeLessThanOrEqual(300);
    });
    const last = levels[levels.length - 1];
    expect(last.cells.length).toBeGreaterThanOrEqual(200);
  });

  it('can be finished by following hints only (hints are never wrong)', () => {
    for (const l of levels) {
      const g = newGame(l, 0);
      let won = false;
      for (let step = 0; step <= l.cells.length && !won; step++) {
        const d = nextDeduction(g.board, knownVals(g), activeConstraints(g));
        expect(d, l.id).not.toBeNull();
        const r = act(g, d!.cell, d!.gem ? 'mark' : 'reveal', 1);
        expect(r.ok, l.id).toBe(true);
        won = r.won;
      }
      expect(won, l.id).toBe(true);
      expect(g.mistakes).toBe(0);
    }
  });
});
