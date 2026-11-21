// Web Worker entry for in-browser level generation.
// Message in:  { type: 'gen', opts: GenOptions, id?: unknown }
//              { type: 'daily', date: string, id?: unknown }
//              { type: 'endless', seed: number | string, difficulty: EndlessDifficulty, mechanics?: MechanicId[], id?: unknown }
// Message out: { type: 'level', level: Level, id?: unknown } | { type: 'error', message: string, id?: unknown }

import { dailyLevel, endlessLevel, generateLevel, type EndlessDifficulty, type GenOptions } from './generator';
import type { MechanicId } from './types';

export type GenRequest =
  | { type: 'gen'; opts: GenOptions; id?: unknown }
  | { type: 'daily'; date: string; id?: unknown }
  | { type: 'endless'; seed: number | string; difficulty: EndlessDifficulty; mechanics?: MechanicId[]; id?: unknown };

const ctx = self as unknown as { onmessage: ((e: MessageEvent<GenRequest>) => void) | null; postMessage(m: unknown): void };

ctx.onmessage = (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'gen') ctx.postMessage({ type: 'level', level: generateLevel(msg.opts), id: msg.id });
    else if (msg.type === 'daily') ctx.postMessage({ type: 'level', level: dailyLevel(msg.date), id: msg.id });
    else if (msg.type === 'endless')
      ctx.postMessage({ type: 'level', level: endlessLevel(msg.seed, msg.difficulty, msg.mechanics), id: msg.id });
  } catch (err) {
    ctx.postMessage({ type: 'error', message: String(err), id: msg.id });
  }
};
