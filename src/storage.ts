// localStorage persistence. Every access is wrapped: private windows, quota and disabled storage
// must never break the game — it just forgets.

import type { MechanicId } from './core/types';

const P = 'hexlume:';

function read<T>(k: string, fallback: T): T {
  try {
    const s = localStorage.getItem(P + k);
    if (s == null) return fallback;
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function write(k: string, v: unknown): void {
  try {
    if (v === undefined || v === null) localStorage.removeItem(P + k);
    else localStorage.setItem(P + k, JSON.stringify(v));
  } catch {
    /* ignore */
  }
  if (SYNCED.has(k)) progressSubs.forEach((f) => f());
}

// ------------------------------------------------------------------ change feed (device sync)

/** Keys that device sync carries (settings and in-progress boards stay local). */
const SYNCED = new Set(['best', 'seen', 'daily']);
const progressSubs = new Set<() => void>();

/** Called after any change of synced progress (in this tab or, via the storage event, another one). */
export function onProgressChange(f: () => void): () => void {
  progressSubs.add(f);
  return () => void progressSubs.delete(f);
}

try {
  window.addEventListener('storage', (e) => {
    if (e.key && e.key.startsWith(P) && SYNCED.has(e.key.slice(P.length))) progressSubs.forEach((f) => f());
  });
} catch {
  /* no window (tests) */
}

export interface ProgressData {
  best: Record<string, Best>;
  seen: MechanicId[];
  daily: Record<string, DailyResult>;
}

export function exportProgress(): ProgressData {
  return { best: loadBest(), seen: loadSeen(), daily: loadDaily() };
}

/** Replace the synced progress (the sync module passes an already merged document). */
export function importProgress(d: ProgressData): void {
  write('best', d.best);
  write('seen', d.seen);
  write('daily', d.daily);
}

// ------------------------------------------------------------------ settings

export type ThemePref = 'auto' | 'light' | 'dark';
export type LangPref = 'auto' | 'ru' | 'en';

export interface Settings {
  lang: LangPref;
  theme: ThemePref;
  volume: number; // 0..1
  vibration: boolean;
  leftHanded: boolean;
  colorBlind: boolean;
  mistakeMode: 'gentle' | 'classic' | 'hardcore';
  /** Auto-rotate period in seconds for levels with phases (0 = off). */
  autoRotate: number;
  /** Revealing a plain 0 opens its hidden neighbours (they are logically safe). */
  autoZero: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  lang: 'auto',
  // dark «Ночь» is the default since v3; a theme the player saved earlier (light, auto) is kept
  theme: 'dark',
  volume: 0.7,
  vibration: true,
  leftHanded: false,
  colorBlind: false,
  mistakeMode: 'gentle',
  autoRotate: 0,
  autoZero: true,
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const oneOf = <T extends string | number>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

/** Settings with every field checked (a hand-edited or old value never breaks the app). */
export function loadSettings(): Settings {
  const s = read<unknown>('settings', {});
  const o = isObj(s) ? s : {};
  const D = DEFAULT_SETTINGS;
  return {
    lang: oneOf(o.lang, ['auto', 'ru', 'en'] as const, D.lang),
    theme: oneOf(o.theme, ['auto', 'light', 'dark'] as const, D.theme),
    volume: num(o.volume) ? Math.max(0, Math.min(1, o.volume)) : D.volume,
    vibration: bool(o.vibration, D.vibration),
    leftHanded: bool(o.leftHanded, D.leftHanded),
    colorBlind: bool(o.colorBlind, D.colorBlind),
    mistakeMode: oneOf(o.mistakeMode, ['gentle', 'classic', 'hardcore'] as const, D.mistakeMode),
    autoRotate: oneOf(o.autoRotate, [0, 15, 30] as const, 0),
    autoZero: bool(o.autoZero, D.autoZero),
  };
}

export function saveSettings(s: Settings): void {
  write('settings', s);
}

// ------------------------------------------------------------------ progress

export interface Best {
  stars: number;
  time: number; // ms
  mistakes: number;
  hints?: number;
  at?: number;
}

const isBest = (v: unknown): v is Best => isObj(v) && num(v.stars) && num(v.time);

/** Keep only well-formed entries of a record. */
function cleanRecord<T>(v: unknown, ok: (x: unknown) => x is T): Record<string, T> {
  const out: Record<string, T> = {};
  if (!isObj(v)) return out;
  for (const [k, x] of Object.entries(v)) if (ok(x)) out[k] = x;
  return out;
}

export function loadBest(): Record<string, Best> {
  return cleanRecord(read<unknown>('best', {}), isBest);
}

export function getBest(id: string): Best | undefined {
  return loadBest()[id];
}

/** Store a result; keeps the better stars and the better time separately. Returns true for a new best time. */
export function recordResult(id: string, r: Best): { newBest: boolean; prev?: Best } {
  const all = loadBest();
  const prev = all[id];
  const next: Best = prev
    ? {
        stars: Math.max(prev.stars, r.stars),
        time: Math.min(prev.time, r.time),
        mistakes: Math.min(prev.mistakes, r.mistakes),
        hints: Math.min(prev.hints ?? 99, r.hints ?? 0),
        at: Date.now(),
      }
    : { ...r, at: Date.now() };
  all[id] = next;
  write('best', all);
  return { newBest: !!prev && r.time < prev.time, prev };
}

// ------------------------------------------------------------------ seen mechanics

export function loadSeen(): MechanicId[] {
  const v = read<unknown>('seen', []);
  return Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as MechanicId[]) : [];
}

export function markSeen(ids: MechanicId[]): void {
  const s = new Set(loadSeen());
  ids.forEach((i) => s.add(i));
  write('seen', [...s]);
}

// ------------------------------------------------------------------ daily

export interface DailyResult extends Best {
  levelId: string;
  /** Crystals on the board (for the statistics). */
  gems?: number;
}

export function loadDaily(): Record<string, DailyResult> {
  return cleanRecord(read<unknown>('daily', {}), (x): x is DailyResult => isBest(x));
}

export function saveDaily(date: string, r: DailyResult): void {
  const all = loadDaily();
  const prev = all[date];
  if (prev && prev.stars >= r.stars && prev.time <= r.time) return;
  all[date] = prev ? { ...r, stars: Math.max(prev.stars, r.stars), time: Math.min(prev.time, r.time) } : r;
  write('daily', all);
}

// ------------------------------------------------------------------ endless

export function loadEndlessStats(): Record<string, number> {
  return cleanRecord(read<unknown>('endless', {}), num as (x: unknown) => x is number);
}

export function bumpEndless(diff: string): void {
  const s = loadEndlessStats();
  s[diff] = (s[diff] ?? 0) + 1;
  write('endless', s);
}

// ------------------------------------------------------------------ last played

export function loadLast(): string | null {
  const v = read<unknown>('last', null);
  return typeof v === 'string' ? v : null;
}

export function saveLast(id: string): void {
  write('last', id);
}

// ------------------------------------------------------------------ in-progress boards

export interface SavedBoard {
  state: number[];
  phase?: number;
  mistakes: number;
  hintsUsed: number;
  elapsed: number; // ms of play time
  moves: number;
  /** For generated levels the level itself is stored too (it cannot be rebuilt cheaply). */
  level?: unknown;
  /** Content hash of the level the state belongs to (a changed level drops the save). */
  hash?: string;
  at: number;
}

/** A saved board with sane fields (state values 0/1/2, numeric counters), or null. */
export function loadProgress(id: string): SavedBoard | null {
  const v = read<unknown>('run:' + id, null);
  if (!isObj(v) || !Array.isArray(v.state)) return null;
  if (!v.state.every((x) => x === 0 || x === 1 || x === 2)) return null;
  const n = (x: unknown) => (num(x) && x >= 0 ? x : 0);
  return {
    state: v.state as number[],
    phase: n(v.phase),
    mistakes: n(v.mistakes),
    hintsUsed: n(v.hintsUsed),
    elapsed: n(v.elapsed),
    moves: n(v.moves),
    level: v.level,
    hash: typeof v.hash === 'string' ? v.hash : undefined,
    at: n(v.at),
  };
}

/** FNV-1a content hash of everything that defines a level's solution and clues. */
export function levelHash(level: {
  cells: { q: number; r: number; gem?: boolean; clue?: unknown; extra?: unknown; rot?: unknown; alt?: unknown }[];
  walls?: unknown;
  portals?: unknown;
  links?: unknown;
  zones?: unknown;
}): string {
  const body = JSON.stringify([
    level.cells.map((c) => [c.q, c.r, c.gem ? 1 : 0, c.clue ?? 0, c.extra ?? 0, c.rot ?? 0, c.alt ?? 0]),
    level.walls ?? 0,
    level.portals ?? 0,
    level.links ?? 0,
    level.zones ?? 0,
  ]);
  let h = 0x811c9dc5;
  for (let i = 0; i < body.length; i++) {
    h ^= body.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function saveProgress(id: string, b: SavedBoard | null): void {
  write('run:' + id, b);
}

/** Most recent in-progress generated level of a kind (prefix like "endless-"). */
export function findProgress(prefix: string): { id: string; save: SavedBoard } | null {
  let best: { id: string; save: SavedBoard } | null = null;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(P + 'run:' + prefix)) continue;
      const id = k.slice((P + 'run:').length);
      const s = loadProgress(id);
      if (s && (!best || s.at > best.save.at)) best = { id, save: s };
    }
  } catch {
    /* ignore */
  }
  return best;
}

export function resetAll(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      // settings, the online profile (nickname, device id) and the workshop's own levels are not progress
      if (k && k.startsWith(P) && k !== P + 'settings' && !k.startsWith(P + 'net:') && !k.startsWith(P + 'ws:')) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------------ daily numbering, streaks, totals

/** Launch day of the daily puzzle: puzzle №1. */
export const DAILY_EPOCH = '2026-11-22';

const dayNum = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, (m || 1) - 1, d || 1) / 86400000);
};

/** Daily puzzle number (1 on the launch day). */
export function dailyNumber(dateISO: string): number {
  return Math.max(1, dayNum(dateISO) - dayNum(DAILY_EPOCH) + 1);
}

/** Current streak (consecutive solved days ending today, or yesterday when today is not solved yet) and the best one. */
export function dailyStreak(todayISO: string): { current: number; best: number; solvedToday: boolean } {
  const days = new Set(Object.keys(loadDaily()).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).map(dayNum));
  const today = dayNum(todayISO);
  const solvedToday = days.has(today);
  let cur = 0;
  for (let d = solvedToday ? today : today - 1; days.has(d); d--) cur++;
  let best = 0;
  for (const d of days) {
    if (days.has(d - 1)) continue; // not the start of a run
    let n = 0;
    while (days.has(d + n)) n++;
    best = Math.max(best, n);
  }
  return { current: cur, best: Math.max(best, cur), solvedToday };
}

export interface Totals {
  wins: number;
  time: number;
  gems: number;
  mistakes: number;
}

/** Lifetime totals of endless games (campaign and daily totals are derived from their records). */
export function loadEndlessTotals(): Totals {
  const v = read<Partial<Totals>>('endlessTotals', {});
  return { wins: v.wins ?? 0, time: v.time ?? 0, gems: v.gems ?? 0, mistakes: v.mistakes ?? 0 };
}

export function addEndlessTotals(r: Omit<Totals, 'wins'>): void {
  const s = loadEndlessTotals();
  write('endlessTotals', { wins: s.wins + 1, time: s.time + r.time, gems: s.gems + r.gems, mistakes: s.mistakes + r.mistakes });
}

// ------------------------------------------------------------------ one-time UI tips / counters

/** How many times a tip / event happened (one-time hints, the first mistakes explained…). */
export function uiCount(k: string): number {
  const v = read<unknown>('ui', {});
  const x = isObj(v) ? v[k] : 0;
  return num(x) ? x : 0;
}

export function bumpUiCount(k: string): number {
  const v = read<unknown>('ui', {});
  const o = isObj(v) ? { ...v } : {};
  const n = (num(o[k]) ? (o[k] as number) : 0) + 1;
  o[k] = n;
  write('ui', o);
  return n;
}

// ------------------------------------------------------------------ cached daily level

/**
 * The generated daily level of a date (generated once per day, also before it is opened).
 * With `ver` (the generator version) a level made by another generator version counts as missing,
 * so a generator update regenerates today's puzzle.
 */
export function loadDailyLevel(date: string, ver?: string): unknown | null {
  const v = read<unknown>('dailyLevel', null);
  if (!isObj(v) || v.date !== date) return null;
  if (ver !== undefined && (v.ver ?? '') !== ver) return null;
  return v.level ?? null;
}

export function saveDailyLevel(date: string, level: unknown, ver = ''): void {
  write('dailyLevel', { date, ver, level });
}
