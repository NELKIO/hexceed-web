// App-wide toast outside the game screen (e.g. "this level is still locked", "a new version is ready").

import { useEffect, useState } from 'preact/hooks';

export interface Notice {
  text: string;
  /** Optional action button. */
  action?: { label: string; run: () => void };
  /** Auto-hide after ms (0 = stays until dismissed). */
  ms: number;
  key: number;
}

let current: Notice | null = null;
const subs = new Set<() => void>();
let timer = 0;

export function showNotice(text: string, opts: { ms?: number; action?: Notice['action'] } = {}): void {
  clearTimeout(timer);
  current = { text, action: opts.action, ms: opts.ms ?? 3200, key: Date.now() };
  subs.forEach((f) => f());
  if (current.ms) timer = window.setTimeout(hideNotice, current.ms);
}

export function hideNotice(): void {
  current = null;
  subs.forEach((f) => f());
}

export function useNotice(): Notice | null {
  const [, set] = useState(0);
  useEffect(() => {
    const f = () => set((n) => n + 1);
    subs.add(f);
    return () => void subs.delete(f);
  }, []);
  return current;
}
