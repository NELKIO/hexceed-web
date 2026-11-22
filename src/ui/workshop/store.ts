// «Мастерская» storage: the author's drafts (with their published share codes) and the author name.
// Same rules as storage.ts: every access is wrapped, a broken entry is dropped, never thrown.

import type { Level } from '../../core/types';

const P = 'hexlume:ws:';

function read<T>(k: string, fallback: T): T {
  try {
    const s = localStorage.getItem(P + k);
    return s == null ? fallback : (JSON.parse(s) as T);
  } catch {
    return fallback;
  }
}

function write(k: string, v: unknown): boolean {
  try {
    if (v == null) localStorage.removeItem(P + k);
    else localStorage.setItem(P + k, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}

export interface Draft {
  id: string;
  title: string;
  level: Level;
  created: number;
  updated: number;
  /** Last share code and the content hash it was made from. */
  code?: string;
  codeHash?: string;
  /** Last validation result and the content hash it belongs to. */
  check?: { hash: string; solved: boolean; diff: number };
  /** Share code of the level this one was remixed from. */
  remixOf?: string;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isInt = (x: unknown) => typeof x === 'number' && Number.isInteger(x);

/** Loose shape check of a stored level (drafts may be work in progress, so no full validation). */
function okLevel(x: unknown): x is Level {
  if (!isObj(x) || !Array.isArray(x.cells) || !Array.isArray(x.walls)) return false;
  if (x.cells.length > 600) return false;
  return x.cells.every((c) => isObj(c) && isInt(c.q) && isInt(c.r) && typeof c.gem === 'boolean');
}

function okDraft(x: unknown): x is Draft {
  return isObj(x) && typeof x.id === 'string' && typeof x.title === 'string' && okLevel(x.level) && typeof x.updated === 'number';
}

export function loadDrafts(): Draft[] {
  const v = read<unknown>('drafts', []);
  return Array.isArray(v) ? v.filter(okDraft).sort((a, b) => b.updated - a.updated) : [];
}

export function loadDraft(id: string): Draft | null {
  return loadDrafts().find((d) => d.id === id) ?? null;
}

/** Insert or replace. Returns false when storage is full / unavailable. */
export function saveDraft(d: Draft): boolean {
  const all = loadDrafts().filter((x) => x.id !== d.id);
  all.unshift(d);
  return write('drafts', all);
}

export function deleteDraft(id: string): void {
  write('drafts', loadDrafts().filter((x) => x.id !== id));
}

export const newId = () => Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36).padStart(2, '0');

export function loadAuthor(): string {
  const v = read<unknown>('author', '');
  return typeof v === 'string' ? v.slice(0, 40) : '';
}

export function saveAuthor(name: string): void {
  write('author', name.trim() ? name.trim().slice(0, 40) : null);
}
