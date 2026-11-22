import { describe, expect, it } from 'vitest';
import { clueToStr, decodeLevel, encodeLevel, lintLevel, MAX_CODE, pack, strToClue, stuckInfo } from '../src/core/editor-utils';
import { solveLevel } from '../src/core/solver';
import type { Clue, Level } from '../src/core/types';
import { validateLevel } from '../src/core/validate';
import { SAMPLES } from '../src/levels/samples';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/** A small hand-made level with most features (wall, portal, line, lock, link, zone, big, rot, alt, gemclue). */
function rich(): Level {
  const cells: Level['cells'] = [];
  for (let q = -2; q <= 2; q++)
    for (let r = -2; r <= 2; r++) if (Math.abs(q + r) <= 2 && !(q === 2 && r === -1) && !(q === 2 && r === 0)) cells.push({ q, r, gem: false });
  const at = (q: number, r: number) => cells.findIndex((c) => c.q === q && c.r === r);
  cells[at(0, 0)].start = true;
  cells[at(1, 0)].gem = true;
  cells[at(-1, 1)].gem = true;
  cells[at(-1, 1)].clue = { k: 'num' };
  cells[at(0, -1)].clue = { k: 'line', dirs: [3], mod: 'together' };
  cells[at(0, 1)].lock = 1;
  cells[at(-2, 2)].clue = { k: 'dot', dirs: [0, 1], corner: true };
  cells[at(-2, 0)].clue = { k: 'swirl', dirs: [2], ccw: true };
  cells[at(-1, 0)].rot = [0, 3];
  cells[at(-1, 0)].clue = { k: 'cone', dirs: [1] };
  cells[at(1, 1)].alt = [{ k: 'parity' }];
  // big cell: (2,-2) + (1,-2)
  const bi = at(2, -2);
  cells[bi].extra = [[1, -2]];
  cells.splice(at(1, -2), 1);
  const idx = (q: number, r: number) => cells.findIndex((c) => c.q === q && c.r === r);
  return {
    id: 'rich',
    cells,
    walls: [[0, 0, 1], [-1, 0, 2]],
    portals: [[1, 1, 2]],
    links: [{ a: idx(0, 0), b: idx(1, 1), same: true }, { a: idx(1, 0), b: idx(-2, 1), same: false }],
    zones: [{ cells: [idx(-2, 1), idx(-1, 2), idx(0, 2)] }],
    fog: false,
  };
}

/** Raw base64url of a JSON value (the uncompressed 'j' form). */
const plain = (x: unknown) => 'j' + Buffer.from(JSON.stringify(x)).toString('base64url');

describe('share code', () => {
  it('clue strings round-trip', () => {
    const cs: Clue[] = [
      { k: 'num' }, { k: 'num', mod: 'apart' }, { k: 'line', dirs: [0, 3, 5] }, { k: 'line', dirs: [2], mod: 'together' },
      { k: 'cone', dirs: [4] }, { k: 'triangle', dirs: [0, 1] }, { k: 'dot', dirs: [1], corner: true }, { k: 'swirl', dirs: [5], ccw: true },
      { k: 'radius' }, { k: 'ring' }, { k: 'donut' }, { k: 'island' }, { k: 'chain' }, { k: 'eye' }, { k: 'parity' }, { k: 'blank' },
    ];
    for (const c of cs) expect(strToClue(clueToStr(c))).toEqual(c);
    expect(() => strToClue('x')).toThrow();
    expect(() => strToClue('l9')).toThrow();
    expect(() => strToClue(5)).toThrow();
  });

  it('round-trips a rich level (compressed and plain)', async () => {
    const l = rich();
    expect(validateLevel(l)).not.toBeNull();
    for (const compress of [true, false]) {
      const code = await encodeLevel(l, { title: 'Проба', author: 'Лука', diff: 4 }, { compress });
      expect(code[0]).toBe(compress ? 'z' : 'j');
      expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
      const back = await decodeLevel(code);
      expect(back).not.toBeNull();
      expect(back!.title).toBe('Проба');
      expect(back!.author).toBe('Лука');
      expect(back!.diff).toBe(4);
      const { id: _a, title: _t, diff: _d, ...rest } = back!.level;
      void _a; void _t; void _d;
      const { id: _b, ...orig } = clone(l);
      void _b;
      expect(rest).toEqual(orig);
    }
  });

  it('round-trips every sample level and stays short', async () => {
    for (const s of SAMPLES) {
      const l = validateLevel(clone(s))!;
      const code = await encodeLevel(l);
      expect(code.length).toBeLessThan(2000);
      const back = await decodeLevel(code);
      expect(back, s.id).not.toBeNull();
      expect(back!.level.cells).toEqual(l.cells);
      expect(back!.level.walls).toEqual(l.walls);
    }
  });

  it('compresses: a 61-hex hexagon fits in a short link', async () => {
    const cells: Level['cells'] = [];
    for (let q = -4; q <= 4; q++) for (let r = -4; r <= 4; r++) if (Math.abs(q + r) <= 4) cells.push({ q, r, gem: (q * 7 + r * 3) % 5 === 0 });
    const l: Level = { id: 'h', cells, walls: [[0, 0, 0], [1, 1, 2]] };
    const z = await encodeLevel(l);
    const j = await encodeLevel(l, {}, { compress: false });
    expect(z.length).toBeLessThan(j.length);
    expect(z.length).toBeLessThan(600);
  });

  it('strips control characters and caps title / author', async () => {
    const code = await encodeLevel(rich(), { title: 'a\u0000b‮' + 'x'.repeat(200), author: '\n bob \t' });
    const back = (await decodeLevel(code))!;
    expect(back.title.startsWith('abx')).toBe(true);
    expect(back.title.length).toBeLessThanOrEqual(60);
    expect(back.author).toBe('bob');
  });
});

describe('hostile codes', () => {
  it('rejects junk', async () => {
    for (const c of [undefined, null, 42, {}, '', 'z', 'j', 'q' + 'A'.repeat(20), 'z!!!', 'j@@@', 'zAAAA', 'z' + 'A'.repeat(100), 'j' + 'A'.repeat(100), 'jbm90IGpzb24', plain('hello'), plain([]), plain(null)])
      expect(await decodeLevel(c)).toBeNull();
  });

  it('rejects oversized codes before decoding', async () => {
    const ok = await encodeLevel(rich());
    expect(await decodeLevel(ok + 'A'.repeat(MAX_CODE))).toBeNull();
  });

  it('stops a deflate bomb', async () => {
    // 4 MB of a valid-looking JSON prefix + spaces compresses to a few KB
    const big = new TextEncoder().encode('{"v":1,"c":[[0,0,0]]' + ' '.repeat(4_000_000) + '}');
    const cs = new CompressionStream('deflate-raw');
    const w = cs.writable.getWriter();
    void w.write(big).then(() => w.close());
    const z = new Uint8Array(await new Response(cs.readable).arrayBuffer());
    const code = 'z' + Buffer.from(z).toString('base64url');
    expect(code.length).toBeLessThan(MAX_CODE);
    expect(await decodeLevel(code)).toBeNull();
  });

  it('rejects structural attacks', async () => {
    const good = pack(rich());
    const bad: unknown[] = [];
    const mut = (f: (p: ReturnType<typeof pack>) => void) => {
      const p = clone(good);
      f(p);
      bad.push(p);
    };
    mut((p) => ((p as unknown as Record<string, unknown>).v = 2));
    mut((p) => (p.c = []));
    mut((p) => (p.c[0] = [0, 0, 0, 'extra']));
    mut((p) => (p.c[0] = [0.5, 0, 0]));
    mut((p) => (p.c[0] = [0, 0, 999]));
    mut((p) => (p.c[0] = [9999, 0, 0]));
    mut((p) => (p.c[1] = [p.c[0][0], p.c[0][1], 0])); // duplicate hex
    mut((p) => (p.c[0] = [p.c[0][0], p.c[0][1], 4, 'zz']));
    mut((p) => (p.c[0] = [p.c[0][0], p.c[0][1], 1 | 8, 1])); // lock on a light
    mut((p) => (p.c[0] = [p.c[0][0], p.c[0][1], 8, 50])); // lock larger than the light count
    mut((p) => (p.l = [0, 0, 1]));
    mut((p) => (p.l = [0, 5000, 1]));
    mut((p) => (p.l = [0, 1, 2]));
    mut((p) => (p.l = [p.l![0], p.l![1], 1 - p.l![2]])); // a thread that lies about the solution
    mut((p) => (p.z = [[0, 0]]));
    mut((p) => (p.z = [[]]));
    mut((p) => (p.w = [0, 0]));
    mut((p) => (p.w = [0, 0, 9]));
    mut((p) => (p.c = Array.from({ length: 500 }, (_, i) => [i % 60, Math.floor(i / 60), 0])));
    mut((p) => ((p as unknown as Record<string, unknown>).f = true));
    for (const b of bad) expect(await decodeLevel(plain(b))).toBeNull();
    expect(await decodeLevel(plain(good))).not.toBeNull();
  });

  it('rejects the LCM attack (rotation / switch cycles whose period explodes)', async () => {
    const lv = rich();
    const free = lv.cells.map((c, i) => (!c.rot && !c.alt && !c.extra ? i : -1)).filter((i) => i >= 0);
    lv.cells[free[0]].rot = [0, 1, 2, 3];
    lv.cells[free[1]].rot = [0, 1, 2, 3, 4];
    const p = pack(lv);
    expect(await decodeLevel(plain(p))).toBeNull();
    const code = await encodeLevel(lv);
    expect(await decodeLevel(code)).toBeNull();
    // 2 × 3 (alt) still fits the cap of 6
    const ok = rich();
    ok.cells[free[0]].rot = [0, 2, 4];
    expect(await decodeLevel(await encodeLevel(ok))).not.toBeNull();
    // a 7-long rotation list is rejected outright
    const seven = rich();
    seven.cells[free[0]].rot = [0, 1, 2, 3, 4, 5, 0];
    expect(await decodeLevel(await encodeLevel(seven))).toBeNull();
  });

  it('never pollutes prototypes', async () => {
    const p = JSON.parse(JSON.stringify(pack(rich())).replace('{"v":1', '{"v":1,"__proto__":{"polluted":1},"constructor":{"prototype":{"bad":1}}'));
    const back = await decodeLevel(plain(p));
    expect(back).not.toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(back!.level).sort()).toEqual(['cells', 'fog', 'id', 'links', 'portals', 'walls', 'zones']);
  });
});

describe('editor analysis', () => {
  it('lint flags locks above the light count and missing starts', () => {
    const l = rich();
    expect(lintLevel(l).filter((x) => x.error)).toEqual([]);
    const at = l.cells.findIndex((c) => c.lock);
    l.cells[at].lock = 9;
    expect(lintLevel(l).map((x) => x.key)).toContain('lockTooBig');
    const m = rich();
    for (const c of m.cells) delete c.start, delete c.lock;
    expect(lintLevel(m).map((x) => x.key)).toContain('noStart');
    expect(lintLevel({ id: 'e', cells: [], walls: [] })[0].key).toBe('empty');
  });

  it('stuck frontier: the undetermined cells next to what is known', () => {
    // a 1×3 strip: start in the middle with "1", a light on one side → a coin flip; far away an
    // unseen pair holds the other light (undetermined, but nothing visible talks about it)
    const l: Level = { id: 's', cells: [{ q: -1, r: 0, gem: true }, { q: 0, r: 0, gem: false, start: true }, { q: 1, r: 0, gem: false }, { q: 5, r: 5, gem: true }, { q: 5, r: 6, gem: false }], walls: [], fog: false };
    const rep = solveLevel(l);
    expect(rep.solved).toBe(false);
    const s = stuckInfo(l, rep.stuckAt!);
    expect(s.frontier.sort()).toEqual([0, 2]);
    expect(s.unknown.sort()).toEqual([0, 2, 3, 4]);
  });
});
