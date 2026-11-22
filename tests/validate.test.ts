import { describe, expect, it } from 'vitest';
import { buildBoard } from '../src/core/rules';
import { solveLevel } from '../src/core/solver';
import type { Level } from '../src/core/types';
import { validateLevel } from '../src/core/validate';
import campaign from '../src/levels/campaign.json';

const levels = campaign as unknown as Level[];
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const base = (): Level => clone(levels.find((l) => l.cells.some((c) => c.rot) && l.links?.length) ?? levels[60]);

describe('validateLevel', () => {
  it('accepts every campaign level unchanged', () => {
    for (const l of levels) {
      const v = validateLevel(clone(l));
      expect(v, l.id).not.toBeNull();
      expect(JSON.stringify(v)).toBe(JSON.stringify(l));
      expect(solveLevel(v!).solved).toBe(true);
    }
  });

  it('returns a fresh object without foreign keys or prototype tricks', () => {
    const raw = JSON.parse(
      '{"id":"x","walls":[],"cells":[{"q":0,"r":0,"gem":false,"start":true,"__proto__":{"polluted":1},"evil":1},{"q":1,"r":0,"gem":true}],"constructor":{"prototype":{"bad":1}},"__proto__":{"polluted":1}}',
    );
    const v = validateLevel(raw)!;
    expect(v).not.toBeNull();
    expect(Object.keys(v).sort()).toEqual(['cells', 'id', 'walls']);
    expect(Object.keys(v.cells[0]).sort()).toEqual(['gem', 'q', 'r', 'start']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((v as unknown as Record<string, unknown>).polluted).toBeUndefined();
    expect(v.cells[0]).not.toBe(raw.cells[0]);
  });

  it('rejects the LCM attack (rotation cycles 7 / 11 / 13)', () => {
    const l = base();
    l.cells[0].rot = [0, 1, 2, 3, 4, 5, 0]; // 7 entries
    expect(validateLevel(l)).toBeNull();
    const m = base();
    m.cells[0].rot = [0, 1];
    m.cells[1].rot = [0, 1, 2];
    m.cells[2].alt = [{ k: 'num' }, { k: 'ring' }, { k: 'radius' }]; // period lcm(2,3,4) = 12
    expect(validateLevel(m)).toBeNull();
    const ok = base();
    ok.cells.forEach((c) => (delete c.rot, delete c.alt));
    ok.cells[0].rot = [0, 1];
    ok.cells[1].rot = [0, 2, 4];
    const v = validateLevel(ok)!;
    expect(buildBoard(v).period).toBe(6);
  });

  it('rejects junk', () => {
    const bad: ((l: Level) => unknown)[] = [
      () => null,
      () => 42,
      () => [],
      () => ({ id: 'x', walls: [], cells: [] }),
      (l) => ({ ...l, id: 7 }),
      (l) => ({ ...l, cells: 'nope' }),
      (l) => ({ ...l, cells: Array.from({ length: 401 }, (_, i) => ({ q: i % 60, r: Math.floor(i / 60), gem: false })) }),
      (l) => ((l.cells[1] = { ...l.cells[0] }), l), // duplicate hex
      (l) => ((l.cells[0].q = 65), l),
      (l) => ((l.cells[0].q = 1.5), l),
      (l) => (((l.cells[0] as unknown as Record<string, unknown>).gem = 'yes'), l),
      (l) => ((l.cells[0].clue = { k: 'spin' as never }), l),
      (l) => ((l.cells[0].clue = { k: 'line', dirs: [1, 1] }), l),
      (l) => ((l.cells[0].clue = { k: 'line', dirs: [6] }), l),
      (l) => ((l.cells[0].clue = { k: 'num', mod: 'maybe' as never }), l),
      (l) => ((l.cells[0].rot = [0, 9]), l),
      (l) => ((l.cells[0].alt = Array.from({ length: 6 }, () => ({ k: 'num' as const }))), l),
      (l) => ((l.cells[0].extra = [[l.cells[1].q, l.cells[1].r]]), l), // overlaps another cell
      (l) => {
        const s = l.cells.find((c) => !c.gem)!;
        s.lock = l.cells.filter((c) => c.gem).length + 1;
        return l;
      },
      (l) => {
        const g = l.cells.find((c) => c.gem)!;
        g.start = true;
        return l;
      },
      (l) => ({ ...l, walls: [[0, 0, 7]] }),
      (l) => ({ ...l, walls: Array.from({ length: 4 * l.cells.length + 1 }, () => [0, 0, 0]) }),
      (l) => ({ ...l, portals: [[0, 0]] }),
      (l) => ({ ...l, links: [{ a: 0, b: l.cells.length, same: true }] }),
      (l) => ({ ...l, links: [{ a: 0, b: 0, same: true }] }),
      (l) => ({ ...l, zones: [{ cells: Array.from({ length: 41 }, (_, i) => i % l.cells.length) }] }),
      (l) => ({ ...l, zones: [{ cells: [0, 0] }] }),
      (l) => ({ ...l, fog: 'off' }),
      (l) => ({ ...l, teach: ['hacking'] }),
      (l) => ({ ...l, diff: 11 }),
    ];
    bad.forEach((f, i) => expect(validateLevel(f(base())), `case ${i}`).toBeNull());
  });
});
