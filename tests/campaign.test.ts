import { describe, expect, it } from 'vitest';
import { act, activeConstraints, knownVals, newGame } from '../src/core/game';
import { ahaCells, ahaSteps, deepCells, hardRun, teachOK } from '../src/core/generator';
import { buildBoard, cellConstraintsAll, portalTarget } from '../src/core/rules';
import { nextDeduction, solveDetailed, solveLevel } from '../src/core/solver';
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

  it('difficulty ramps: gentle start, challenging late worlds, hard finale', () => {
    const of = (w: number) => WORLDS[w].levels.map((id) => levels.find((l) => l.id === id)!.diff ?? 0);
    const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(avg(of(0))).toBeLessThanOrEqual(1.5);
    expect(avg(of(1))).toBeLessThanOrEqual(1.5);
    const late = [9, 10, 11, 12].flatMap(of);
    // human-solvability limits (few shallow aha cells, no long hard runs) cap the late worlds
    expect(avg(late)).toBeGreaterThanOrEqual(4.5);
    expect(late.filter((d) => d >= 6).length).toBeGreaterThanOrEqual(10);
    const finale = of(WORLDS.length - 1);
    expect(avg(finale)).toBeGreaterThanOrEqual(7.5);
    expect(finale.filter((d) => d >= 9).length).toBeGreaterThanOrEqual(2);
    // smooth rise: never more than one point down from one level to the next
    for (let k = 1; k < finale.length; k++) expect(finale[k], `finale ${k}`).toBeGreaterThanOrEqual(finale[k - 1] - 1);
  });

  it('world 1 is friendly: tiny, fog-free, no counter tricks; fog taught on a tiny board', () => {
    for (const id of ['w01-01', 'w01-02', 'w01-03']) {
      const l = levels.find((x) => x.id === id)!;
      expect(l.cells.length, id).toBeLessThanOrEqual(12);
      expect(l.fog, id).toBe(false);
      expect(solveLevel(l, { noGlobal: true }).solved, id).toBe(true);
    }
    const fog = levels.find((x) => x.id === 'w01-04')!;
    expect(fog.teach).toEqual(['fog']);
    expect(fog.fog).not.toBe(false);
    expect(fog.cells.length).toBeLessThanOrEqual(16);
  });

  // TODO(docs/NEXT.md): re-enable after the campaign is regenerated with the new size caps.
  it('follows the calibration: one start, fog, sizes', () => {
    levels.forEach((l, i) => {
      const starts = l.cells.filter((c) => c.start).length;
      if (i === 0) expect(starts, l.id).toBeLessThanOrEqual(3);
      else if (l.cells.length >= 120) expect(starts, l.id).toBeLessThanOrEqual(3);
      else expect(starts, l.id).toBeLessThanOrEqual(islands(l) > 1 ? 3 : l.teach ? 2 : 1);
      expect(l.fog !== false, l.id).toBe(i >= 3 && l.id !== 'w01-05'); // the counter is taught without fog
      expect(l.cells.length, l.id).toBeLessThanOrEqual(190);
    });
    const last = levels[levels.length - 1];
    expect(last.cells.length).toBeGreaterThanOrEqual(120);
    expect(last.cells.length).toBeLessThanOrEqual(160);
    const cap = [45, 60, 80];
    WORLDS.forEach((w, wi) => {
      for (const id of w.levels) {
        const l = levels.find((x) => x.id === id)!;
        const hexes = l.cells.flatMap((c) => [[c.q, c.r], ...(c.extra ?? [])]);
        const cols = new Set(hexes.map(([q]) => q)).size;
        if (wi < 3) expect(l.cells.length, id).toBeLessThanOrEqual(cap[wi]);
        expect(cols, id).toBeLessThanOrEqual(wi < 3 ? 7 : id === last.id ? 11 : 9);
        if (id.endsWith('-12') && wi < WORLDS.length - 1) expect(l.cells.length, id).toBeLessThanOrEqual(115);
      }
    });
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

  it('portals are paired in every phase; big cells carry no modifiers', () => {
    for (const l of levels) {
      const b = buildBoard(l);
      for (const geo of b.phases)
        for (const k of geo.portals) {
          const [q, r, d] = k.split(',').map(Number);
          const t = portalTarget(b, geo, q, r, d);
          expect(t, `${l.id} ${k}`).not.toBeNull();
          expect(geo.portals.has(`${t![0]},${t![1]},${(d + 3) % 6}`), l.id).toBe(true);
        }
      for (const c of l.cells) if (c.extra) expect(c.clue?.mod, l.id).toBeUndefined();
    }
  });

  it("a world's own mechanics are needed in most of its regular levels", () => {
    const hard = (r: { tierCounts: number[] }) => r.tierCounts[1] + r.tierCounts[2] + r.tierCounts[3];
    for (const w of WORLDS) {
      const own = w.introduces.filter((m) => !['basic', 'counter', 'fog', 'gaps', 'blank'].includes(m));
      if (!own.length) continue;
      const regular = w.levels.map((id) => levels.find((l) => l.id === id)!).filter((l) => !l.teach);
      let needed = 0;
      for (const l of regular) {
        const base = solveDetailed(l);
        if (own.some((m) => {
          const r = solveDetailed(l, { exclude: m });
          return !r.solved || hard(r) > hard(base);
        })) needed++;
      }
      expect(needed / regular.length, w.id).toBeGreaterThanOrEqual(0.7);
    }
  });

  it('is human-solvable: few "aha" steps, scattered «Тишина», close islands, every cell pointed at', () => {
    WORLDS.forEach((w, wi) => {
      const last = wi === WORLDS.length - 1;
      for (const id of w.levels) {
        const l = levels.find((x) => x.id === id)!;
        const r = solveDetailed(l, { trace: true });
        const aha = ahaSteps(r);
        const max = l.teach ? (w.n <= 3 ? 0 : 2) : w.n <= 3 ? 0 : w.n <= 8 ? 4 : last ? 14 : 7;
        expect(ahaCells(r), id).toBeLessThanOrEqual(max);
        if (w.n > 3) expect(hardRun(r), id).toBeLessThanOrEqual(l.teach ? 2 : 3);
        if (!last) for (const e of aha) expect(e.tier === 3 && e.reasons.length <= 3, id).toBe(true);
        else expect(deepCells(r), id).toBeLessThanOrEqual(4);
        const b = buildBoard(l);
        const safe = l.cells.filter((c) => !c.gem).length;
        const blank = l.cells.map((c, i) => (c.clue?.k === 'blank' ? i : -1)).filter((i) => i >= 0);
        if (!l.teach) expect(blank.length, id).toBeLessThanOrEqual(Math.round(safe * 0.11) + 1);
        for (const i of blank) expect(b.phases[0].adj[i].filter((j) => l.cells[j].clue?.k === 'blank').length, id).toBeLessThanOrEqual(1);
        // every cell is covered by some informative clue, zone or link
        const covered = new Set<number>();
        l.cells.forEach((_, i) => cellConstraintsAll(b, i).forEach((c) => c.cells.forEach((j) => covered.add(j))));
        for (const z of l.zones ?? []) z.cells.forEach((j) => covered.add(j));
        for (const k of l.links ?? []) (covered.add(k.a), covered.add(k.b));
        l.cells.forEach((c, i) => { if (!c.start && !c.lock) expect(covered.has(i), `${id} cell ${i}`).toBe(true); }); // locks open by themselves
        // islands at most 2 empty hexes apart
        const hexes = l.cells.flatMap((c) => [[c.q, c.r] as [number, number], ...(c.extra ?? [])]);
        const comps = islandsOf(hexes);
        for (let a = 1; a < comps.length; a++) {
          let m = Infinity;
          for (const [q1, r1] of comps[a]) for (let bI = 0; bI < comps.length; bI++) if (bI !== a) for (const [q2, r2] of comps[bI]) m = Math.min(m, (Math.abs(q1 - q2) + Math.abs(r1 - r2) + Math.abs(q1 + r1 - q2 - r2)) / 2);
          expect(m, id).toBeLessThanOrEqual(2);
        }
      }
    });
  });
});

function islandsOf(hexes: [number, number][]): [number, number][][] {
  const set = new Set(hexes.map(([q, r]) => `${q},${r}`));
  const seen = new Set<string>();
  const out: [number, number][][] = [];
  for (const [q, r] of hexes) {
    if (seen.has(`${q},${r}`)) continue;
    const comp: [number, number][] = [];
    const st: [number, number][] = [[q, r]];
    seen.add(`${q},${r}`);
    while (st.length) {
      const [x, y] = st.pop()!;
      comp.push([x, y]);
      for (const [dq, dr] of [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0]]) {
        const k = `${x + dq},${y + dr}`;
        if (set.has(k) && !seen.has(k)) {
          seen.add(k);
          st.push([x + dq, y + dr]);
        }
      }
    }
    out.push(comp);
  }
  return out;
}
