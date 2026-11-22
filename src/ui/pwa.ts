// Service worker registration + the "new version available" flow. The update is applied only on
// the menu (never mid-level): the waiting worker takes over, then the page reloads.

import { useEffect, useState } from 'preact/hooks';

let waiting: ServiceWorker | null = null;
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

export function registerSW(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const base = import.meta.env.BASE_URL;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(base + 'sw.js', { scope: base })
      .then((reg) => {
        const track = (w: ServiceWorker | null) => {
          if (!w) return;
          const check = () => {
            // an installed worker while another one controls the page = an update is ready
            if (w.state === 'installed' && navigator.serviceWorker.controller) {
              waiting = w;
              notify();
            }
          };
          w.addEventListener('statechange', check);
          check();
        };
        track(reg.waiting);
        reg.addEventListener('updatefound', () => track(reg.installing));
        // look for updates now and then (the app is often kept open)
        setInterval(() => void reg.update().catch(() => undefined), 60 * 60 * 1000);
      })
      .catch((e) => console.warn('[hexlume] service worker not registered', e));
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading || !waiting) return;
      reloading = true;
      location.reload();
    });
  });
}

/** True when a new version is installed and waiting. */
export function useUpdateReady(): boolean {
  const [, set] = useState(0);
  useEffect(() => {
    const f = () => set((n) => n + 1);
    subs.add(f);
    return () => void subs.delete(f);
  }, []);
  return !!waiting;
}

/** Switch to the new version (call from the menu only). */
export function applyUpdate(): void {
  if (waiting) waiting.postMessage('skipWaiting');
  else location.reload();
}
