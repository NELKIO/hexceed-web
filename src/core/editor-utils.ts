// Level editor helpers («Мастерская»): the compact share code, editor lint, and the "where is the
// solver stuck" analysis. Pure (no DOM besides the standard CompressionStream / TextEncoder), so it
// runs in the page, in a worker and under vitest.
//
// Share code: compact JSON (see `pack`) → deflate-raw (CompressionStream) → base64url, prefixed
// with 'z'. Without CompressionStream the JSON is sent as plain base64url, prefixed with 'j'.
// Decoding never trusts the input: length caps before and after inflating, strict structural
// parsing, and then the core's validateLevel (bounds, unique hexes, the phase-LCM cap, …).

import { buildBoard, cellConstraintsAll, staticConstraints } from './rules';
import type { Clue, ClueKind, Level, LevelCell } from './types';
import { LIMITS, validateLevel } from './validate';

/** Longest share code we even look at (characters after the '#/l/'). */
export const MAX_CODE = 12000;
/** Largest decompressed payload (bytes): a deflate bomb stops here. */
export const MAX_JSON = 120000;
export const MAX_TITLE = 60;
export const MAX_AUTHOR = 40;
export const SHARE_BASE = 'https://nelkio.github.io/hexceed-web/#/l/';

export interface SharedLevel {
  level: Level;
  title: string;
  author: string;
  /** Difficulty 1..10 the editor measured when the link was made (0 = unknown). */
  diff: number;
}

// ------------------------------------------------------------------ clue <-> short string

const KIND_CH: Record<ClueKind, string> = {
  num: 'n', line: 'l', radius: 'R', ring: 'r', donut: 'D', cone: 'c', triangle: 't', dot: 'd',
  swirl: 's', island: 'i', chain: 'h', eye: 'e', parity: 'p', blank: 'b',
};
const CH_KIND: Record<string, ClueKind> = Object.fromEntries(Object.entries(KIND_CH).map(([k, v]) => [v, k as ClueKind]));

/** {k:'line', dirs:[0,3], mod:'together'} → "l03+" ('+' together, '-' apart, '*' corner, '~' ccw). */
export function clueToStr(c: Clue): string {
  let s = KIND_CH[c.k] + (c.dirs ?? []).join('');
  if (c.mod === 'together') s += '+';
  else if (c.mod === 'apart') s += '-';
  if (c.corner) s += '*';
  if (c.ccw) s += '~';
  return s;
}

const CLUE_RE = /^([nlRrDctdsihepb])([0-5]{0,6})(\+|-)?(\*)?(~)?$/;

/** Inverse of clueToStr; throws on anything else. */
export function strToClue(s: unknown): Clue {
  if (typeof s !== 'string' || s.length > 12) throw new Error('clue');
  const m = CLUE_RE.exec(s);
  if (!m) throw new Error('clue');
  const c: Clue = { k: CH_KIND[m[1]] };
  if (m[2]) c.dirs = m[2].split('').map(Number);
  if (m[3]) c.mod = m[3] === '+' ? 'together' : 'apart';
  if (m[4]) c.corner = true;
  if (m[5]) c.ccw = true;
  return c;
}

// ------------------------------------------------------------------ compact level form

// cell: [q, r, flags, ...fields in flag order]
const F_GEM = 1, F_START = 2, F_CLUE = 4, F_LOCK = 8, F_EXTRA = 16, F_ROT = 32, F_ALT = 64;

interface Packed {
  v: 1;
  t?: string;
  a?: string;
  d?: number;
  f?: 0;
  c: unknown[][];
  w?: number[];
  p?: number[];
  l?: number[];
  z?: number[][];
}

const flat3 = (xs: readonly (readonly number[])[]) => xs.flatMap((x) => [x[0], x[1], x[2]]);

export function pack(level: Level, meta: { title?: string; author?: string; diff?: number } = {}): Packed {
  const out: Packed = { v: 1, c: [] };
  const title = cleanText(meta.title ?? level.title ?? '', MAX_TITLE);
  const author = cleanText(meta.author ?? '', MAX_AUTHOR);
  if (title) out.t = title;
  if (author) out.a = author;
  if (meta.diff && meta.diff >= 1 && meta.diff <= 10) out.d = Math.round(meta.diff);
  if (level.fog === false) out.f = 0;
  out.c = level.cells.map((c) => {
    let f = 0;
    const rest: unknown[] = [];
    if (c.gem) f |= F_GEM;
    if (c.start) f |= F_START;
    if (c.clue) {
      f |= F_CLUE;
      rest.push(clueToStr(c.clue));
    }
    if (c.lock) {
      f |= F_LOCK;
      rest.push(c.lock);
    }
    if (c.extra?.length) {
      f |= F_EXTRA;
      rest.push(c.extra.flatMap((h) => [h[0], h[1]]));
    }
    if (c.rot?.length) {
      f |= F_ROT;
      rest.push(c.rot.slice());
    }
    if (c.alt?.length) {
      f |= F_ALT;
      rest.push(c.alt.map(clueToStr));
    }
    return [c.q, c.r, f, ...rest];
  });
  if (level.walls.length) out.w = flat3(level.walls);
  if (level.portals?.length) out.p = flat3(level.portals);
  if (level.links?.length) out.l = level.links.flatMap((l) => [l.a, l.b, l.same ? 1 : 0]);
  if (level.zones?.length) out.z = level.zones.map((z) => z.cells.slice());
  return out;
}

const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);

function intArr(x: unknown, max: number): number[] {
  if (!Array.isArray(x) || x.length > max || !x.every(isInt)) throw new Error('ints');
  return x as number[];
}

function triples(x: unknown, max: number): [number, number, number][] {
  const a = intArr(x, max * 3);
  if (a.length % 3) throw new Error('triples');
  const out: [number, number, number][] = [];
  for (let i = 0; i < a.length; i += 3) out.push([a[i], a[i + 1], a[i + 2]]);
  return out;
}

/** Remove control characters, trim, cap the length. */
export function cleanText(s: unknown, max: number): string {
  if (typeof s !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').trim().slice(0, max);
}

/** Packed form → a raw level (still untrusted: validateLevel runs afterwards). Throws on junk. */
function unpack(x: unknown): { raw: Record<string, unknown>; title: string; author: string; diff: number } {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) throw new Error('obj');
  const o = x as Record<string, unknown>;
  const own = (k: string) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
  if (own('v') !== 1) throw new Error('version');
  const cs = own('c');
  if (!Array.isArray(cs) || !cs.length || cs.length > LIMITS.cells) throw new Error('cells');
  const cells = cs.map((rc): LevelCell => {
    if (!Array.isArray(rc) || rc.length < 3 || rc.length > 8) throw new Error('cell');
    const [q, r, f] = rc;
    if (!isInt(q) || !isInt(r) || !isInt(f) || f < 0 || f > 127) throw new Error('cell');
    const c: LevelCell = { q, r, gem: !!(f & F_GEM) };
    let k = 3;
    const next = () => {
      if (k >= rc.length) throw new Error('cell field');
      return rc[k++];
    };
    if (f & F_START) c.start = true;
    if (f & F_CLUE) c.clue = strToClue(next());
    if (f & F_LOCK) {
      const n = next();
      if (!isInt(n)) throw new Error('lock');
      c.lock = n;
    }
    if (f & F_EXTRA) {
      const a = intArr(next(), LIMITS.extra * 2);
      if (a.length % 2) throw new Error('extra');
      c.extra = [];
      for (let i = 0; i < a.length; i += 2) c.extra.push([a[i], a[i + 1]]);
    }
    if (f & F_ROT) c.rot = intArr(next(), LIMITS.rot);
    if (f & F_ALT) {
      const a = next();
      if (!Array.isArray(a) || a.length > LIMITS.alt) throw new Error('alt');
      c.alt = a.map(strToClue);
    }
    if (k !== rc.length) throw new Error('cell tail');
    return c;
  });
  const n = cells.length;
  const raw: Record<string, unknown> = { id: 'shared', cells, walls: triples(own('w') ?? [], 4 * n) };
  if (own('p') !== undefined) raw.portals = triples(own('p'), 4 * n);
  if (own('l') !== undefined) {
    const a = intArr(own('l'), 4 * n * 3);
    if (a.length % 3) throw new Error('links');
    const links = [];
    for (let i = 0; i < a.length; i += 3) {
      if (a[i + 2] !== 0 && a[i + 2] !== 1) throw new Error('link');
      links.push({ a: a[i], b: a[i + 1], same: a[i + 2] === 1 });
    }
    raw.links = links;
  }
  if (own('z') !== undefined) {
    const z = own('z');
    if (!Array.isArray(z) || z.length > n) throw new Error('zones');
    raw.zones = z.map((zc) => ({ cells: intArr(zc, LIMITS.zoneCells) }));
  }
  const fog = own('f');
  if (fog !== undefined) {
    if (fog !== 0) throw new Error('fog');
    raw.fog = false;
  }
  const d = own('d');
  const diff = isInt(d) && d >= 1 && d <= 10 ? d : 0;
  const title = cleanText(own('t'), MAX_TITLE);
  const author = cleanText(own('a'), MAX_AUTHOR);
  if (title) raw.title = title;
  return { raw, title, author, diff };
}

// ------------------------------------------------------------------ bytes <-> base64url

function toB64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b + '==='.slice((b.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const hasStreams = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

async function readCapped(stream: ReadableStream<Uint8Array>, cap: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > cap) {
      void reader.cancel().catch(() => undefined);
      throw new Error('too big');
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function pipeBytes(bytes: Uint8Array, ts: { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }, cap: number): Promise<Uint8Array> {
  const writer = ts.writable.getWriter();
  const done = writer.write(bytes).then(() => writer.close());
  done.catch(() => undefined);
  const out = await readCapped(ts.readable, cap);
  await done.catch(() => undefined);
  return out;
}

// ------------------------------------------------------------------ public API

/** Encode a level (+ title / author / measured difficulty) as a URL-safe share code. */
export async function encodeLevel(level: Level, meta: { title?: string; author?: string; diff?: number } = {}, opts: { compress?: boolean } = {}): Promise<string> {
  const json = JSON.stringify(pack(level, meta));
  const bytes = new TextEncoder().encode(json);
  if (opts.compress !== false && hasStreams()) {
    try {
      const z = await pipeBytes(bytes, new CompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>, MAX_JSON * 2);
      return 'z' + toB64url(z);
    } catch {
      /* fall through to plain */
    }
  }
  return 'j' + toB64url(bytes);
}

/** The share link for a code. */
export const shareUrl = (code: string) => SHARE_BASE + code;

/** Decode an untrusted share code. Null for anything malformed, oversized or invalid. */
export async function decodeLevel(code: unknown): Promise<SharedLevel | null> {
  try {
    if (typeof code !== 'string' || code.length < 2 || code.length > MAX_CODE) return null;
    if (!/^[zj][A-Za-z0-9_-]+$/.test(code)) return null;
    const bytes = fromB64url(code.slice(1));
    let jsonBytes: Uint8Array;
    if (code[0] === 'z') {
      if (!hasStreams()) return null;
      jsonBytes = await pipeBytes(bytes, new DecompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>, MAX_JSON);
    } else {
      if (bytes.length > MAX_JSON) return null;
      jsonBytes = bytes;
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(jsonBytes);
    const { raw, title, author, diff } = unpack(JSON.parse(text));
    const level = validateLevel(raw);
    if (!level) return null;
    // a thread must tell the truth about the solution (zones and clues are computed from it anyway)
    if (level.links?.some((l) => l.same !== (level.cells[l.a].gem === level.cells[l.b].gem))) return null;
    level.id = 'l-' + fnv(code);
    if (diff) level.diff = diff;
    return { level, title, author, diff };
  } catch {
    return null;
  }
}

/** FNV-1a (base36) of a string. */
export function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// ------------------------------------------------------------------ editor lint

export type LintKey = 'empty' | 'tooMany' | 'noStart' | 'lockTooBig' | 'period' | 'bigClue' | 'invalid';

export interface LintIssue {
  key: LintKey;
  /** Blocking (the level cannot be played) vs a warning. */
  error: boolean;
  cells: number[];
  /** Extra number for the message (e.g. the light count). */
  n?: number;
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** Problems the author should fix, most important first. */
export function lintLevel(level: Level): LintIssue[] {
  const out: LintIssue[] = [];
  const cells = level.cells;
  if (!cells.length) return [{ key: 'empty', error: true, cells: [] }];
  const hexes = cells.reduce((s, c) => s + 1 + (c.extra?.length ?? 0), 0);
  if (cells.length > LIMITS.cells || hexes > LIMITS.cells) out.push({ key: 'tooMany', error: true, cells: [], n: LIMITS.cells });
  const gems = cells.filter((c) => c.gem).length;
  const bigLocks = cells.map((c, i) => (c.lock && c.lock > gems ? i : -1)).filter((i) => i >= 0);
  if (bigLocks.length) out.push({ key: 'lockTooBig', error: true, cells: bigLocks, n: gems });
  let period = 1;
  for (const c of cells)
    for (const len of [c.rot?.length ?? 0, c.alt ? c.alt.length + 1 : 0]) if (len > 1) period = (period * len) / gcd(period, len);
  if (period > LIMITS.period) out.push({ key: 'period', error: true, cells: cells.map((c, i) => (c.rot || c.alt ? i : -1)).filter((i) => i >= 0), n: LIMITS.period });
  const bigBad = cells.map((c, i) => (c.extra?.length && c.clue && c.clue.k !== 'num' && c.clue.k !== 'blank' ? i : -1)).filter((i) => i >= 0);
  if (bigBad.length) out.push({ key: 'bigClue', error: true, cells: bigBad });
  if (!out.some((x) => x.error) && !validateLevel(level)) out.push({ key: 'invalid', error: true, cells: [] });
  if (!cells.some((c) => (c.start || c.lock) && !c.gem)) out.push({ key: 'noStart', error: false, cells: [] });
  return out;
}

// ------------------------------------------------------------------ stuck analysis

/**
 * Where the solver stopped. vals: the solver's final assignment (-1 unknown, 0 safe, 1 light).
 * frontier = undetermined cells that visible information talks about (where one more fact is
 * needed); unknown = every undetermined cell.
 */
export function stuckInfo(level: Level, vals: ArrayLike<number>): { frontier: number[]; unknown: number[] } {
  const b = buildBoard(level);
  const unknown: number[] = [];
  let marked = 0;
  for (let i = 0; i < b.n; i++) {
    if (vals[i] === -1) unknown.push(i);
    else if (vals[i] === 1) marked++;
  }
  const seen = new Uint8Array(b.n);
  const take = (cs: number[]) => {
    for (const j of cs) if (vals[j] === -1) seen[j] = 1;
  };
  for (const c of staticConstraints(b)) if (c.src.type !== 'global') take(c.cells);
  for (let i = 0; i < b.n; i++) {
    if (vals[i] === -1) continue;
    const c = level.cells[i];
    if (c.lock && !c.start && marked < c.lock) continue; // still locked: shows nothing yet
    for (const con of cellConstraintsAll(b, i)) take(con.cells);
  }
  const frontier = unknown.filter((i) => seen[i]);
  return { frontier, unknown };
}
