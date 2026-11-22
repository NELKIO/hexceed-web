// Live validation of the editor level: lint first, then the solver in a worker (debounced).
// A newer request replaces an older one; a solve that runs too long is cut off.

import { useEffect, useState } from 'preact/hooks';
import { lintLevel, type LintIssue } from '../../core/editor-utils';
import type { Level } from '../../core/types';
import { levelHash } from '../../storage';

export type Analysis =
  | { state: 'pending' }
  | { state: 'lint'; issues: LintIssue[] }
  | { state: 'ok'; diff: number; steps: number; warn: LintIssue[] }
  | { state: 'stuck'; frontier: number[]; unknown: number[]; warn: LintIssue[] }
  | { state: 'timeout' }
  | { state: 'error' };

type Result = { ok: true; solved: boolean; difficulty: number; steps: number; frontier: number[]; unknown: number[] } | { ok: false };

const TIMEOUT = 20000;
const cache = new Map<string, Analysis>();
let worker: Worker | null = null;
let seq = 0;
let pending: { id: number; resolve: (r: Result | 'timeout') => void; timer: number } | null = null;

function spawn(): Worker {
  const w = new Worker(new URL('./solve.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<Result & { id: number }>) => {
    if (!pending || e.data.id !== pending.id) return;
    const p = pending;
    pending = null;
    clearTimeout(p.timer);
    p.resolve(e.data);
  };
  w.onerror = () => {
    if (!pending) return;
    const p = pending;
    pending = null;
    clearTimeout(p.timer);
    p.resolve({ ok: false });
  };
  return w;
}

function kill(): void {
  try {
    worker?.terminate();
  } catch {
    /* ignore */
  }
  worker = null;
}

function solveInWorker(level: Level): Promise<Result | 'timeout'> {
  // a request still running is stale: drop it (and its worker, which may be deep in a search)
  if (pending) {
    const p = pending;
    pending = null;
    clearTimeout(p.timer);
    kill();
    p.resolve({ ok: false });
  }
  return new Promise((resolve) => {
    let w: Worker;
    try {
      w = worker ??= spawn();
    } catch {
      resolve({ ok: false });
      return;
    }
    const id = ++seq;
    const timer = window.setTimeout(() => {
      if (pending?.id !== id) return;
      pending = null;
      kill();
      resolve('timeout');
    }, TIMEOUT);
    pending = { id, resolve, timer };
    w.postMessage({ id, level });
  });
}

export function analysisKey(level: Level): string {
  return levelHash(level) + (level.fog === false ? 'f' : '') + level.cells.map((c) => (c.start ? 's' : c.lock ? 'l' + c.lock : '')).join('');
}

/** Lint + solver verdict for the level; `pending` while the (debounced) check runs. */
export function useAnalysis(level: Level, delay = 380): Analysis {
  const k = analysisKey(level);
  const [res, setRes] = useState<{ key: string; a: Analysis }>(() => ({ key: k, a: cache.get(k) ?? { state: 'pending' } }));
  useEffect(() => {
    const hit = cache.get(k);
    if (hit) {
      setRes({ key: k, a: hit });
      return undefined;
    }
    const issues = lintLevel(level);
    const errors = issues.filter((x) => x.error);
    if (errors.length) {
      const a: Analysis = { state: 'lint', issues: errors };
      setRes({ key: k, a });
      return undefined;
    }
    setRes({ key: k, a: { state: 'pending' } });
    let alive = true;
    const id = window.setTimeout(() => {
      void solveInWorker(level).then((r) => {
        let a: Analysis;
        if (r === 'timeout') a = { state: 'timeout' };
        else if (!r.ok) a = { state: 'error' };
        else if (r.solved) a = { state: 'ok', diff: r.difficulty, steps: r.steps, warn: issues };
        else a = { state: 'stuck', frontier: r.frontier, unknown: r.unknown, warn: issues };
        if (a.state !== 'error' || alive) {
          if (a.state !== 'error') cache.set(k, a);
          if (cache.size > 60) cache.delete(cache.keys().next().value!);
        }
        if (alive) setRes({ key: k, a });
      });
    }, delay);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [k]);
  return res.key === k ? res.a : cache.get(k) ?? { state: 'pending' };
}
