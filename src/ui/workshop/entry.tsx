// Main-bundle side of «Мастерская»: the routes. The editor itself (and its worker) loads on demand.

import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { registerRoute } from '../../router';
import { LogoMark } from '../icons';

type Mod = typeof import('./screens');
let mod: Promise<Mod> | null = null;
const load = () => (mod ??= import('./screens'));

function lazy(pick: (m: Mod) => ComponentType<{ params: string[] }>): ComponentType<{ params: string[]; path: string }> {
  return function Lazy({ params }) {
    const [m, set] = useState<Mod | null>(null);
    useEffect(() => {
      let alive = true;
      void load().then((x) => alive && set(() => x));
      return () => {
        alive = false;
      };
    }, []);
    if (!m) {
      return (
        <div class="screen center">
          <div class="screen-inner">
            <div class="loading">
              <LogoMark class="spinner" />
            </div>
          </div>
        </div>
      );
    }
    const C = pick(m);
    return <C params={params} />;
  };
}

export function registerWorkshopRoutes(): void {
  registerRoute({ name: 'workshop', pattern: /^\/workshop\/?$/, component: lazy((m) => m.WorkshopScreen) });
  registerRoute({ name: 'ws-edit', pattern: /^\/workshop\/edit\/([A-Za-z0-9]+)\/?$/, component: lazy((m) => m.EditorScreen) });
  registerRoute({ name: 'ws-test', pattern: /^\/workshop\/test\/([A-Za-z0-9]+)\/?$/, component: lazy((m) => m.TestScreen) });
  // trailing punctuation that messengers glue to links is ignored
  registerRoute({ name: 'shared', pattern: /^\/l\/([A-Za-z0-9_-]+)[.,;:!?)\]'"/]*$/, component: lazy((m) => m.SharedScreen) });
}

/** Warm the chunk up (e.g. when the menu shows). */
export const preloadWorkshop = () => void load().catch(() => undefined);
