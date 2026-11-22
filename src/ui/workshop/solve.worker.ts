// Web Worker: checks an editor level with the human-style solver, off the main thread.
// In:  { id: number, level: Level }
// Out: { id, ok: true, solved, difficulty, steps, frontier, unknown } | { id, ok: false }

import { solveLevel } from '../../core/solver';
import { stuckInfo } from '../../core/editor-utils';
import type { Level } from '../../core/types';

const ctx = self as unknown as { onmessage: ((e: MessageEvent<{ id: number; level: Level }>) => void) | null; postMessage(m: unknown): void };

ctx.onmessage = (e) => {
  const { id, level } = e.data;
  try {
    const r = solveLevel(level);
    const s = r.solved ? { frontier: [], unknown: [] } : stuckInfo(level, r.stuckAt!);
    // not solved although nothing is left open: the information contradicts the solution
    if (!r.solved && !s.unknown.length) ctx.postMessage({ id, ok: false, message: 'contradiction' });
    else ctx.postMessage({ id, ok: true, solved: r.solved, difficulty: r.difficulty, steps: r.steps, ...s });
  } catch (err) {
    ctx.postMessage({ id, ok: false, message: String(err) });
  }
};
