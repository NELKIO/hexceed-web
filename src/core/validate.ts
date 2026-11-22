// Strict sanitiser for untrusted level JSON (e.g. a level sent by an online partner).
// Returns a fresh, normalised Level built field by field (no foreign keys, no prototype tricks),
// or null when anything is malformed or out of bounds.

import type { Clue, ClueKind, Level, LevelCell, Link, MechanicId, Portal, Wall, Zone } from './types';

const CLUE_KINDS: ReadonlySet<string> = new Set<ClueKind>([
  'num', 'line', 'radius', 'ring', 'donut', 'cone', 'triangle', 'dot', 'swirl', 'island', 'chain', 'eye', 'parity', 'blank',
]);
const MECHANICS: ReadonlySet<string> = new Set<MechanicId>([
  'basic', 'counter', 'fog', 'walls', 'gaps', 'line', 'multiline', 'radius', 'ring', 'donut', 'cone', 'triangle', 'lock', 'gemclue',
  'dot', 'swirl', 'rotate', 'switch', 'big', 'portal', 'island', 'chain', 'together', 'apart', 'eye', 'parity', 'link', 'zone', 'blank',
]);

export const LIMITS = { cells: 400, coord: 64, extra: 6, rot: 6, alt: 5, period: 6, zoneCells: 40, text: 120 } as const;

class Invalid extends Error {}
const fail = (): never => {
  throw new Invalid();
};

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const int = (x: unknown, lo: number, hi: number): number => (typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi ? x : fail());
const bool = (x: unknown): boolean => (typeof x === 'boolean' ? x : fail());
const optBool = (x: unknown): boolean | undefined => (x === undefined ? undefined : bool(x));
const str = (x: unknown, max: number): string => (typeof x === 'string' && x.length <= max ? x : fail());
const arr = (x: unknown, max: number): unknown[] => (Array.isArray(x) && x.length <= max ? x : fail());

function dirs(x: unknown): number[] {
  const a = arr(x, 6).map((d) => int(d, 0, 5));
  if (new Set(a).size !== a.length) fail();
  return a;
}

function clue(x: unknown): Clue {
  if (!isObj(x)) fail();
  const o = x as Record<string, unknown>;
  const k = own(o, 'k');
  if (typeof k !== 'string' || !CLUE_KINDS.has(k)) fail();
  const c: Clue = { k: k as ClueKind };
  const d = own(o, 'dirs');
  if (d !== undefined) c.dirs = dirs(d);
  const mod = own(o, 'mod');
  if (mod !== undefined) {
    if (mod !== 'together' && mod !== 'apart') fail();
    c.mod = mod as 'together' | 'apart';
  }
  const corner = optBool(own(o, 'corner'));
  if (corner) c.corner = true;
  const ccw = optBool(own(o, 'ccw'));
  if (ccw) c.ccw = true;
  return c;
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

function edge(x: unknown, C: number): [number, number, number] {
  const a = arr(x, 3);
  if (a.length !== 3) fail();
  return [int(a[0], -C, C), int(a[1], -C, C), int(a[2], 0, 5)];
}

function validate(x: unknown): Level {
  if (!isObj(x)) fail();
  const o = x as Record<string, unknown>;
  const C = LIMITS.coord;
  const rawCells = arr(own(o, 'cells'), LIMITS.cells);
  if (!rawCells.length) fail();
  const n = rawCells.length;
  const hexes = new Set<string>();
  const addHex = (q: number, r: number) => {
    const k = `${q},${r}`;
    if (hexes.has(k)) fail();
    hexes.add(k);
  };
  let period = 1;
  const cells: LevelCell[] = rawCells.map((rc) => {
    if (!isObj(rc)) fail();
    const r0 = rc as Record<string, unknown>;
    const c: LevelCell = { q: int(own(r0, 'q'), -C, C), r: int(own(r0, 'r'), -C, C), gem: bool(own(r0, 'gem')) };
    addHex(c.q, c.r);
    const cl = own(r0, 'clue');
    if (cl !== undefined) c.clue = clue(cl);
    if (optBool(own(r0, 'start'))) {
      if (c.gem) fail();
      c.start = true;
    }
    const lock = own(r0, 'lock');
    if (lock !== undefined) {
      if (c.gem) fail();
      c.lock = int(lock, 1, LIMITS.cells);
    }
    const ex = own(r0, 'extra');
    if (ex !== undefined) {
      c.extra = arr(ex, LIMITS.extra).map((h) => {
        const a = arr(h, 2);
        if (a.length !== 2) fail();
        const hq = int(a[0], -C, C), hr = int(a[1], -C, C);
        addHex(hq, hr);
        return [hq, hr] as [number, number];
      });
      if (!c.extra.length) delete c.extra;
      else if (c.clue && c.clue.k !== 'num' && c.clue.k !== 'blank') fail(); // big cells: only numbers
      else if (c.clue?.mod) fail();
    }
    const rot = own(r0, 'rot');
    if (rot !== undefined) {
      c.rot = arr(rot, LIMITS.rot).map((v) => int(v, 0, 5));
      if (!c.rot.length) fail();
      if (c.rot.length > 1) period = (period * c.rot.length) / gcd(period, c.rot.length);
    }
    const alt = own(r0, 'alt');
    if (alt !== undefined) {
      c.alt = arr(alt, LIMITS.alt).map(clue);
      if (!c.alt.length) delete c.alt;
      else period = (period * (c.alt.length + 1)) / gcd(period, c.alt.length + 1);
    }
    if (period > LIMITS.period) fail();
    return c;
  });
  const totalGems = cells.filter((c) => c.gem).length;
  for (const c of cells) if (c.lock && c.lock > totalGems) fail();

  const level: Level = { id: str(own(o, 'id'), LIMITS.text), cells, walls: [] };
  const title = own(o, 'title');
  if (title !== undefined) level.title = str(title, LIMITS.text);
  level.walls = arr(own(o, 'walls') ?? [], 4 * n).map((w) => edge(w, C) as Wall);
  const portals = own(o, 'portals');
  if (portals !== undefined) level.portals = arr(portals, 4 * n).map((p) => edge(p, C) as Portal);
  const links = own(o, 'links');
  if (links !== undefined)
    level.links = arr(links, 4 * n).map((l): Link => {
      if (!isObj(l)) fail();
      const lo = l as Record<string, unknown>;
      const a = int(own(lo, 'a'), 0, n - 1), b = int(own(lo, 'b'), 0, n - 1);
      if (a === b) fail();
      return { a, b, same: bool(own(lo, 'same')) };
    });
  const zones = own(o, 'zones');
  if (zones !== undefined)
    level.zones = arr(zones, n).map((z): Zone => {
      if (!isObj(z)) fail();
      const zc = arr(own(z as Record<string, unknown>, 'cells'), LIMITS.zoneCells).map((i) => int(i, 0, n - 1));
      if (!zc.length || new Set(zc).size !== zc.length) fail();
      return { cells: zc };
    });
  const fog = own(o, 'fog');
  if (fog !== undefined) level.fog = bool(fog);
  const teach = own(o, 'teach');
  if (teach !== undefined)
    level.teach = arr(teach, 8).map((m) => (typeof m === 'string' && MECHANICS.has(m) ? (m as MechanicId) : fail()));
  const diff = own(o, 'diff');
  if (diff !== undefined) level.diff = int(diff, 1, 10);
  const seed = own(o, 'seed');
  if (seed !== undefined) level.seed = int(seed, 0, 2 ** 32 - 1);
  return level;
}

/** A clean copy of an untrusted level, or null when it is malformed / out of bounds. */
export function validateLevel(x: unknown): Level | null {
  try {
    return validate(x);
  } catch (e) {
    if (e instanceof Invalid) return null;
    return null;
  }
}
