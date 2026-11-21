// Bridge to the solver / generator modules. They are loaded lazily and optionally (import.meta.glob
// returns nothing for a missing file), so the UI builds and runs with local fallbacks.

import type { Board, Constraint } from '../core/rules';
import type { Level } from '../core/types';
import { hashString } from '../core/rng';
import { fallbackNextDeduction, type Deduction } from './game/fallbackSolver';
import { SAMPLES } from '../levels/samples';

export type { Deduction };
export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];

type SolverMod = { nextDeduction?: (b: Board, v: Int8Array, c: Constraint[]) => Deduction | null };
type GenMod = {
  dailyLevel?: (dateISO: string) => Level;
  endlessLevel?: (seed: number | string, d: Difficulty) => Level;
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
        const timer = window.setTimeout(() => finish(null), timeoutMs);
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

function sampleFor(seed: string, prefix: string): Level {
  const pool = SAMPLES.filter((l) => l.id !== 's01');
  const base = pool[hashString(seed) % pool.length];
  return { ...base, id: prefix };
}

export function todayISO(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export async function makeDaily(dateISO: string): Promise<Level> {
  const id = `daily-${dateISO}`;
  const w = await viaWorker({ type: 'daily', date: dateISO }, 20000);
  if (w) return { ...w, id };
  const g = await loadGen();
  if (g?.dailyLevel) {
    try {
      return { ...g.dailyLevel(dateISO), id };
    } catch (e) {
      console.warn('daily generator failed', e);
    }
  }
  return sampleFor(dateISO, id);
}

export async function makeEndless(seed: string, diff: Difficulty): Promise<Level> {
  const id = `endless-${diff}-${seed}`;
  const w = await viaWorker({ type: 'endless', seed, difficulty: diff }, 25000);
  if (w) return { ...w, id };
  const g = await loadGen();
  if (g?.endlessLevel) {
    try {
      return { ...g.endlessLevel(seed, diff), id };
    } catch (e) {
      console.warn('endless generator failed', e);
    }
  }
  return sampleFor(seed + diff, id);
}
