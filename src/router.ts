// Tiny hash router. Screens register a pattern; later registrations win, so other modules
// (for example the online mode adding `#/room/<CODE>`) can plug in without touching this file.

import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';

export interface RouteMatch {
  path: string;
  name: string;
  params: string[];
}

export interface RouteDef {
  name: string;
  pattern: RegExp;
  component: ComponentType<{ params: string[]; path: string }>;
}

const defs: RouteDef[] = [];
const subs = new Set<() => void>();

/** Add (or replace by name) a route. Patterns are matched against the path after `#`. */
export function registerRoute(def: RouteDef): void {
  const i = defs.findIndex((d) => d.name === def.name);
  if (i >= 0) defs.splice(i, 1);
  defs.unshift(def);
  subs.forEach((f) => f());
}

export function currentPath(): string {
  const h = location.hash.replace(/^#/, '');
  return h.startsWith('/') ? h : '/' + h;
}

export function matchRoute(path: string): { def: RouteDef; params: string[] } | null {
  for (const d of defs) {
    const m = d.pattern.exec(path);
    if (m) return { def: d, params: m.slice(1).map((s) => decodeURIComponent(s ?? '')) };
  }
  return null;
}

export function navigate(path: string, replace = false): void {
  const url = '#' + path;
  if (replace) {
    history.replaceState(null, '', url);
    subs.forEach((f) => f());
  } else if (location.hash === url) {
    subs.forEach((f) => f());
  } else {
    location.hash = path;
  }
}

/** In-app history of visited paths (to make "back" buttons and the system back gesture agree). */
const stack: string[] = [currentPath()];
window.addEventListener('hashchange', () => {
  const p = currentPath();
  if (stack.length > 1 && stack[stack.length - 2] === p) stack.pop();
  else stack.push(p);
  subs.forEach((f) => f());
});

/** Go to `parent`: by going back when it is the previous entry, otherwise by replacing this one. */
export function goBack(parent = '/'): void {
  if (stack.length > 1 && stack[stack.length - 2] === parent) history.back();
  else {
    stack.pop();
    stack.push(parent);
    navigate(parent, true);
  }
}

export function usePath(): string {
  const [p, set] = useState(currentPath());
  useEffect(() => {
    const f = () => set(currentPath());
    subs.add(f);
    return () => void subs.delete(f);
  }, []);
  return p;
}
