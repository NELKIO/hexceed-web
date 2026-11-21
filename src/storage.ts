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
  theme: 'auto',
  volume: 0.7,
  vibration: true,
  leftHanded: false,
  colorBlind: false,
  mistakeMode: 'gentle',
  autoRotate: 0,
  autoZero: true,
};

export function loadSettings(): Settings {
  const s = read<Partial<Settings>>('settings', {});
  return { ...DEFAULT_SETTINGS, ...(s && typeof s === 'object' ? s : {}) };
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

export function loadBest(): Record<string, Best> {
  const v = read<Record<string, Best>>('best', {});
  return v && typeof v === 'object' ? v : {};
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
  const v = read<MechanicId[]>('seen', []);
  return Array.isArray(v) ? v : [];
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
  const v = read<Record<string, DailyResult>>('daily', {});
  return v && typeof v === 'object' ? v : {};
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
  return read<Record<string, number>>('endless', {});
}

export function bumpEndless(diff: string): void {
  const s = loadEndlessStats();
  s[diff] = (s[diff] ?? 0) + 1;
  write('endless', s);
}

// ------------------------------------------------------------------ last played

export function loadLast(): string | null {
  return read<string | null>('last', null);
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
  at: number;
}

export function loadProgress(id: string): SavedBoard | null {
  const v = read<SavedBoard | null>('run:' + id, null);
  if (!v || !Array.isArray(v.state)) return null;
  return v;
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
      // settings and the online profile (nickname, device id) are not progress
      if (k && k.startsWith(P) && k !== P + 'settings' && !k.startsWith(P + 'net:')) keys.push(k);
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
