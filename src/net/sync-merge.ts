// Device sync document + merge. Pure (no DOM, no network).
//
// The merge is a join on a semilattice, so it is commutative, associative and idempotent: devices
// can merge each other's documents in any order, any number of times, and still agree.
//   best[level]  = max stars, min time, min mistakes, min hints (per field)
//   seen         = union
//   daily[date]  = max stars, min time, min mistakes, min hints; level id: the smaller one
// Settings are never synced.

import type { Best, DailyResult } from '../storage';

export const DOC_VERSION = 1;
const MAX_LEVELS = 5000;
const MAX_DAILY = 4000;
const MAX_SEEN = 200;

export interface SyncDoc {
  v: number;
  best: Record<string, Best>;
  seen: string[];
  daily: Record<string, DailyResult>;
}

export function emptyDoc(): SyncDoc {
  return { v: DOC_VERSION, best: {}, seen: [], daily: {} };
}

const okKey = (k: unknown): k is string => typeof k === 'string' && k.length > 0 && k.length <= 120 && k !== '__proto__' && k !== 'constructor' && k !== 'prototype';
const num = (x: unknown, max = 1e12): number | null => (typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= max ? x : null);

function cleanBest(x: unknown): Best | null {
  if (!x || typeof x !== 'object') return null;
  const b = x as Record<string, unknown>;
  const stars = num(b.stars, 3);
  const time = num(b.time);
  const mistakes = num(b.mistakes, 1e6);
  if (stars === null || time === null || mistakes === null) return null;
  const out: Best = { stars: Math.round(stars), time: Math.round(time), mistakes: Math.round(mistakes) };
  const hints = num(b.hints, 1e6);
  if (hints !== null) out.hints = Math.round(hints);
  const at = num(b.at, 1e14);
  if (at !== null) out.at = Math.round(at);
  return out;
}

function cleanDaily(x: unknown): DailyResult | null {
  const b = cleanBest(x);
  const id = (x as Record<string, unknown> | null)?.levelId;
  if (!b || typeof id !== 'string' || id.length > 120) return null;
  return { ...b, levelId: id };
}

/** Sanitize an untrusted document (from a relay or old local storage). Unknown fields are dropped. */
export function cleanDoc(x: unknown): SyncDoc {
  const d = emptyDoc();
  if (!x || typeof x !== 'object') return d;
  const o = x as Record<string, unknown>;
  if (Number.isSafeInteger(o.v) && (o.v as number) > 0) d.v = o.v as number;
  if (o.best && typeof o.best === 'object' && !Array.isArray(o.best)) {
    let n = 0;
    for (const [k, v] of Object.entries(o.best as Record<string, unknown>)) {
      if (n >= MAX_LEVELS) break;
      const b = okKey(k) ? cleanBest(v) : null;
      if (b) {
        d.best[k] = b;
        n++;
      }
    }
  }
  if (Array.isArray(o.seen)) d.seen = [...new Set(o.seen.filter(okKey))].slice(0, MAX_SEEN).sort();
  if (o.daily && typeof o.daily === 'object' && !Array.isArray(o.daily)) {
    let n = 0;
    for (const [k, v] of Object.entries(o.daily as Record<string, unknown>)) {
      if (n >= MAX_DAILY) break;
      const r = okKey(k) && /^\d{4}-\d\d-\d\d$/.test(k) ? cleanDaily(v) : null;
      if (r) {
        d.daily[k] = r;
        n++;
      }
    }
  }
  return d;
}

const minOpt = (a?: number, b?: number): number | undefined => (a === undefined ? b : b === undefined ? a : Math.min(a, b));
const maxOpt = (a?: number, b?: number): number | undefined => (a === undefined ? b : b === undefined ? a : Math.max(a, b));

export function mergeBest(a: Best, b: Best): Best {
  const out: Best = { stars: Math.max(a.stars, b.stars), time: Math.min(a.time, b.time), mistakes: Math.min(a.mistakes, b.mistakes) };
  const hints = minOpt(a.hints, b.hints);
  if (hints !== undefined) out.hints = hints;
  const at = maxOpt(a.at, b.at);
  if (at !== undefined) out.at = at;
  return out;
}

function mergeDaily(a: DailyResult, b: DailyResult): DailyResult {
  return { ...mergeBest(a, b), levelId: a.levelId <= b.levelId ? a.levelId : b.levelId };
}

/** Merge any number of documents (already cleaned or not). The result is cleaned and canonical. */
export function mergeDocs(...docs: unknown[]): SyncDoc {
  const out = emptyDoc();
  const seen = new Set<string>();
  for (const raw of docs) {
    const d = cleanDoc(raw);
    out.v = Math.max(out.v, d.v);
    for (const [k, b] of Object.entries(d.best)) out.best[k] = out.best[k] ? mergeBest(out.best[k], b) : b;
    for (const [k, r] of Object.entries(d.daily)) out.daily[k] = out.daily[k] ? mergeDaily(out.daily[k], r) : r;
    d.seen.forEach((s) => seen.add(s));
  }
  out.seen = [...seen].sort();
  return canonical(out);
}

/** Same content → same key order (for comparisons and stable JSON). */
function canonical(d: SyncDoc): SyncDoc {
  const sortObj = <T>(o: Record<string, T>): Record<string, T> => {
    const r: Record<string, T> = {};
    for (const k of Object.keys(o).sort()) r[k] = o[k];
    return r;
  };
  return { v: d.v, best: sortObj(d.best), seen: d.seen, daily: sortObj(d.daily) };
}

/** JSON with sorted keys at every level. */
export function stableJson(x: unknown): string {
  return JSON.stringify(x, (_k, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const r: Record<string, unknown> = {};
      for (const k of Object.keys(v as object).sort()) r[k] = (v as Record<string, unknown>)[k];
      return r;
    }
    return v;
  });
}

/** Equal content (canonical JSON comparison). */
export function sameProgress(a: SyncDoc, b: SyncDoc): boolean {
  return stableJson(a) === stableJson(b);
}
