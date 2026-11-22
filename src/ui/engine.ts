// Bridge to the solver / generator modules. They are loaded lazily and optionally (import.meta.glob
// returns nothing for a missing file), so the UI builds and runs with local fallbacks.

import type { Board, Constraint } from '../core/rules';
import type { Level, MechanicId } from '../core/types';
import { validateLevel } from '../core/validate';
import { loadDailyLevel, saveDailyLevel } from '../storage';
import { hashString } from '../core/rng';
import { fallbackNextDeduction, type Deduction } from './game/fallbackSolver';
import { SAMPLES } from '../levels/samples';

export type { Deduction };
export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];

type SolverMod = { nextDeduction?: (b: Board, v: Int8Array, c: Constraint[]) => Deduction | null };
type GenMod = {
  /** Bumped by the generator whenever the same seed would give a different level. */
  GEN_VERSION?: string;
  dailyLevel?: (dateISO: string, mechanics?: MechanicId[]) => Level;
  endlessLevel?: (seed: number | string, d: Difficulty, mechanics?: MechanicId[]) => Level;
};

const solverMods = import.meta.glob<SolverMod>('../core/solver.ts');
const genMods = import.meta.glob<GenMod>('../core/generator.ts');
const workerMods = import.meta.glob<{ default: new () => Worker }>('../core/gen.worker.ts', { query: '?worker' });

let solverP: Promise<SolverMod | null> | null = null;
function loadSolver(): Promise<SolverMod | null> {
  if (!solverP) {
    const f = Object.values(solverMods)[0];
    solverP = f ? f().catch(() => null) : Promise.resolve(null);
  }
  return solverP;
}

/** Start loading the solver early (e.g. when a level opens). */
export function preloadSolver(): void {
  void loadSolver();
}

export async function nextDeduction(b: Board, vals: Int8Array, cons: Constraint[]): Promise<Deduction | null> {
  const m = await loadSolver();
  try {
    if (m?.nextDeduction) {
      const d = m.nextDeduction(b, vals, cons);
      if (d) return d;
    }
  } catch (e) {
    console.warn('solver failed, using fallback', e);
  }
  return fallbackNextDeduction(b, vals, cons);
}

// ------------------------------------------------------------------ generation

let worker: Worker | null = null;
let workerTried = false;
let reqId = 0;

async function getWorker(): Promise<Worker | null> {
  if (worker || workerTried) return worker;
  workerTried = true;
  const f = Object.values(workerMods)[0];
  if (!f) return null;
  try {
    const W = (await f()).default;
    worker = new W();
  } catch {
    worker = null;
  }
  return worker;
}

function viaWorker(msg: Record<string, unknown>, timeoutMs: number): Promise<Level | null> {
  return getWorker().then(
    (w) =>
      new Promise<Level | null>((resolve) => {
        if (!w) return resolve(null);
        const id = ++reqId;
        let done = false;
        const finish = (l: Level | null) => {
          if (done) return;
          done = true;
          w.removeEventListener('message', onMsg);
          w.removeEventListener('error', onErr);
          clearTimeout(timer);
          resolve(l);
        };
        const onMsg = (e: MessageEvent) => {
          const d = e.data as { type?: string; level?: Level; id?: number };
          if (d?.type === 'level' && d.level && (d.id === undefined || d.id === id)) finish(d.level);
          else if (d?.type === 'error') finish(null);
        };
        const onErr = () => finish(null);
        const timer = window.setTimeout(() => {
          // a stuck worker would block every later request: start over with a fresh one
          try {
            w.terminate();
          } catch {
            /* ignore */
          }
          if (worker === w) {
            worker = null;
            workerTried = false;
          }
          finish(null);
        }, timeoutMs);
        w.addEventListener('message', onMsg);
        w.addEventListener('error', onErr);
        w.postMessage({ ...msg, id });
      }),
  );
}

async function loadGen(): Promise<GenMod | null> {
  const f = Object.values(genMods)[0];
  if (!f) return null;
  try {
    return await f();
  } catch {
    return null;
  }
}

// A one-shot notice for the next game screen (e.g. "generation failed, showing a backup puzzle").
let notice: string | null = null;

/** Take (and clear) the pending notice for the game screen. */
export function takeNotice(): string | null {
  const n = notice;
  notice = null;
  return n;
}

const FALLBACK = '__fallback';

/** A backup puzzle shown because generation failed: never stored, never cached. */
export function isFallback(level: Level): boolean {
  return !!(level as unknown as Record<string, unknown>)[FALLBACK];
}

/** Generation failed: keep the player going with a handmade puzzle, but say so loudly. */
function sampleFor(seed: string, prefix: string, why: unknown): Level {
  console.error(`[hexlume] level generation failed for ${prefix}; using a backup puzzle`, why);
  notice = 'genFallback';
  const pool = SAMPLES.filter((l) => l.id !== 's01');
  const base = pool[hashString(seed) % pool.length];
  return { ...base, id: prefix, [FALLBACK]: true } as Level;
}

/**
 * Structural check of level JSON from storage or the network (the core's validateLevel when it
 * exists, else a light local check). Returns the level or null.
 */
export function checkLevel(x: unknown): Level | null {
  try {
    return validateLevel(x);
  } catch {
    return null;
  }
}

export function todayISO(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Thrown when the generator worker timed out / crashed: the screen offers "try again". */
export class GenTimeout extends Error {}

const workerAvailable = async () => !!(await getWorker());

/**
 * Today's puzzle: cached per date (generated once — the menu pre-generates it while idle).
 * `mechanics` restricts it to what the player has unlocked.
 */
/** Generator version ('' when the generator does not export one). */
async function genVersion(): Promise<string> {
  const g = await loadGen();
  const v = g?.GEN_VERSION;
  return typeof v === 'string' ? v : '';
}

export async function makeDaily(dateISO: string, mechanics?: MechanicId[]): Promise<Level> {
  const id = `daily-${dateISO}`;
  const ver = await genVersion();
  const cached = checkLevel(loadDailyLevel(dateISO, ver));
  if (cached) return { ...cached, id };
  let level: Level | null = null;
  if (await workerAvailable()) {
    const w = await viaWorker({ type: 'daily', date: dateISO, mechanics }, 25000);
    if (!w) throw new GenTimeout('daily');
    level = checkLevel(w);
  } else {
    const g = await loadGen();
    try {
      if (g?.dailyLevel) level = checkLevel(g.dailyLevel(dateISO, mechanics));
    } catch (e) {
      return sampleFor(dateISO, id, e);
    }
  }
  if (!level) return sampleFor(dateISO, id, 'invalid level');
  level = { ...level, id };
  saveDailyLevel(dateISO, level, ver);
  return level;
}

/** Generate today's puzzle in the background (menu idle time) so opening it is instant. */
export function pregenDaily(mechanics?: MechanicId[]): void {
  const date = todayISO();
  // makeDaily returns the cached level at once when it is from this generator version
  const run = () => void makeDaily(date, mechanics).catch(() => undefined);
  const w = window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 1500);
}

/** Mechanics of the "easy" endless board: numbers, walls and holes only. */
export const EASY_MECHANICS: MechanicId[] = ['basic', 'counter', 'fog', 'walls', 'gaps', 'blank'];

export async function makeEndless(seed: string, diff: Difficulty, mechanics?: MechanicId[]): Promise<Level> {
  const id = `endless-${diff}-${seed}`;
  const mech = diff === 'easy' ? EASY_MECHANICS : mechanics;
  let level: Level | null = null;
  if (await workerAvailable()) {
    const w = await viaWorker({ type: 'endless', seed, difficulty: diff, mechanics: mech }, 25000);
    if (!w) throw new GenTimeout('endless');
    level = checkLevel(w);
  } else {
    const g = await loadGen();
    try {
      if (g?.endlessLevel) level = checkLevel(g.endlessLevel(seed, diff, mech));
    } catch (e) {
      return sampleFor(seed + diff, id, e);
    }
  }
  if (!level) return sampleFor(seed + diff, id, 'invalid level');
  return { ...level, id };
}
