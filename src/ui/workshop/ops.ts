// Pure editing operations of the level editor. Every op takes a Level and returns a new one (or
// null when nothing changes), so undo / redo is a stack of snapshots.

import { DIRS, edgeKey, hexDistance, key } from '../../core/hex';
import type { Clue, Level, LevelCell } from '../../core/types';
import { LIMITS } from '../../core/validate';

export const cloneLevel = (l: Level): Level => JSON.parse(JSON.stringify(l)) as Level;

export const MAX_HEXES = LIMITS.cells;
const C = LIMITS.coord;

/** A hexagon of `rings` rings (rings = 5 → radius 4, 61 hexes), the centre is the start. */
export function hexagonLevel(rings = 5): Level {
  const R = rings - 1;
  const cells: LevelCell[] = [];
  for (let q = -R; q <= R; q++)
    for (let r = -R; r <= R; r++) if (hexDistance(0, 0, q, r) <= R) cells.push({ q, r, gem: false });
  cells.find((c) => c.q === 0 && c.r === 0)!.start = true;
  return { id: 'draft', cells, walls: [] };
}

/** Hex → unit index. */
export function hexIndex(l: Level): Map<string, number> {
  const m = new Map<string, number>();
  l.cells.forEach((c, i) => {
    m.set(key(c.q, c.r), i);
    for (const [q, r] of c.extra ?? []) m.set(key(q, r), i);
  });
  return m;
}

export const unitAt = (l: Level, q: number, r: number) => hexIndex(l).get(key(q, r)) ?? -1;

export const hexCount = (l: Level) => l.cells.reduce((s, c) => s + 1 + (c.extra?.length ?? 0), 0);
export const gemCount = (l: Level) => l.cells.reduce((s, c) => s + (c.gem ? 1 : 0), 0);

/** Drop walls with no hex on either side and portals whose hex is gone. */
function prune(l: Level): Level {
  const idx = hexIndex(l);
  const has = (q: number, r: number) => idx.has(key(q, r));
  l.walls = l.walls.filter(([q, r, d]) => has(q, r) || has(q + DIRS[d][0], r + DIRS[d][1]));
  if (l.portals) {
    l.portals = l.portals.filter(([q, r]) => has(q, r));
    if (!l.portals.length) delete l.portals;
  }
  return l;
}

/** Remove whole units, remapping links and zones. */
function removeUnits(src: Level, drop: Set<number>): Level {
  const l = cloneLevel(src);
  const map: number[] = [];
  let k = 0;
  l.cells.forEach((_, i) => (map[i] = drop.has(i) ? -1 : k++));
  l.cells = l.cells.filter((_, i) => !drop.has(i));
  if (l.links) {
    l.links = l.links.filter((x) => map[x.a] >= 0 && map[x.b] >= 0).map((x) => ({ ...x, a: map[x.a], b: map[x.b] }));
    if (!l.links.length) delete l.links;
  }
  if (l.zones) {
    l.zones = l.zones.map((z) => ({ cells: z.cells.map((i) => map[i]).filter((i) => i >= 0) })).filter((z) => z.cells.length);
    if (!l.zones.length) delete l.zones;
  }
  return prune(l);
}

export function addHex(src: Level, q: number, r: number): Level | null {
  if (Math.abs(q) > C || Math.abs(r) > C || Math.abs(q + r) > C) return null;
  if (unitAt(src, q, r) >= 0 || hexCount(src) >= MAX_HEXES) return null;
  const l = cloneLevel(src);
  l.cells.push({ q, r, gem: false });
  return l;
}

/** Dissolve a big cell into single hexes (the extra hexes copy its light / no light). */
export function split(src: Level, i: number): Level | null {
  const c = src.cells[i];
  if (!c?.extra?.length) return null;
  const l = cloneLevel(src);
  const a = l.cells[i];
  for (const [q, r] of a.extra!) l.cells.push({ q, r, gem: a.gem });
  delete a.extra;
  return l;
}

export function removeHex(src: Level, q: number, r: number): Level | null {
  let l = src;
  let i = unitAt(l, q, r);
  if (i < 0) return null;
  if (l.cells[i].extra?.length) {
    l = split(l, i)!;
    i = unitAt(l, q, r);
  }
  return removeUnits(l, new Set([i]));
}

/** Whether a set of hexes is edge-connected. */
function connected(hexes: [number, number][]): boolean {
  if (!hexes.length) return false;
  const set = new Set(hexes.map(([q, r]) => key(q, r)));
  const seen = new Set([key(...hexes[0])]);
  const st = [hexes[0]];
  while (st.length) {
    const [q, r] = st.pop()!;
    for (const [dq, dr] of DIRS) {
      const k = key(q + dq, r + dr);
      if (set.has(k) && !seen.has(k)) {
        seen.add(k);
        st.push([q + dq, r + dr]);
      }
    }
  }
  return seen.size === set.size;
}

export type MergeError = 'mergeFew' | 'mergeBig' | 'mergeApart' | 'mergeMany';

/** Merge single cells into one big cell (anchor = the first). */
export function merge(src: Level, idxs: number[]): Level | MergeError {
  const u = [...new Set(idxs)].filter((i) => src.cells[i]);
  if (u.length < 2) return 'mergeFew';
  if (u.some((i) => src.cells[i].extra?.length)) return 'mergeBig';
  if (u.length > LIMITS.extra + 1) return 'mergeMany';
  const hexes = u.map((i) => [src.cells[i].q, src.cells[i].r] as [number, number]);
  if (!connected(hexes)) return 'mergeApart';
  const l = cloneLevel(src);
  const a = l.cells[u[0]];
  a.extra = hexes.slice(1);
  if (a.clue && (a.gem || (a.clue.k !== 'num' && a.clue.k !== 'blank') || a.clue.mod)) delete a.clue;
  delete a.rot;
  delete a.alt;
  // the anchor's links / zones stay; the merged hexes' ones move to the anchor
  const rest = new Set(u.slice(1));
  for (const x of l.links ?? []) {
    if (rest.has(x.a)) x.a = u[0];
    if (rest.has(x.b)) x.b = u[0];
  }
  if (l.links) l.links = l.links.filter((x) => x.a !== x.b);
  for (const z of l.zones ?? []) z.cells = [...new Set(z.cells.map((i) => (rest.has(i) ? u[0] : i)))];
  return removeUnits(l, rest);
}

function edit(src: Level, i: number, f: (c: LevelCell, l: Level) => boolean | void): Level | null {
  if (!src.cells[i]) return null;
  const l = cloneLevel(src);
  if (f(l.cells[i], l) === false) return null;
  return l;
}

export const toggleGem = (src: Level, i: number) =>
  edit(src, i, (c) => {
    c.gem = !c.gem;
    if (c.gem) {
      delete c.start;
      delete c.lock;
      delete c.clue;
      delete c.alt;
    }
  });

/** Set the clue (undefined = the default: a number on a safe cell, nothing on a light). */
export const setClue = (src: Level, i: number, clue: Clue | undefined) =>
  edit(src, i, (c) => {
    const norm = clue && !c.gem && clue.k === 'num' && !clue.mod ? undefined : clue;
    if (JSON.stringify(norm) === JSON.stringify(c.clue)) return false;
    if (norm) c.clue = norm;
    else delete c.clue;
  });

export const toggleStart = (src: Level, i: number) =>
  edit(src, i, (c) => {
    if (c.gem) return false;
    if (c.start) delete c.start;
    else {
      c.start = true;
      delete c.lock;
    }
  });

export const setLock = (src: Level, i: number, n: number | undefined) =>
  edit(src, i, (c) => {
    if (c.gem || c.lock === n) return false;
    if (n) {
      c.lock = n;
      delete c.start;
    } else delete c.lock;
  });

export const setRot = (src: Level, i: number, rot: number[] | undefined) =>
  edit(src, i, (c) => {
    if (c.extra?.length) return false;
    if (JSON.stringify(rot) === JSON.stringify(c.rot)) return false;
    if (rot?.length) c.rot = rot.slice();
    else delete c.rot;
  });

export const setAlt = (src: Level, i: number, alt: Clue[] | undefined) =>
  edit(src, i, (c) => {
    if (c.extra?.length) return false;
    if (JSON.stringify(alt) === JSON.stringify(c.alt)) return false;
    if (alt?.length) c.alt = alt.map((x) => ({ ...x }));
    else delete c.alt;
  });

const sameEdge = (a: readonly number[], q: number, r: number, d: number) => edgeKey(a[0], a[1], a[2]) === edgeKey(q, r, d);

export function toggleWall(src: Level, q: number, r: number, d: number): Level {
  const l = cloneLevel(src);
  const k = l.walls.findIndex((w) => sameEdge(w, q, r, d));
  if (k >= 0) l.walls.splice(k, 1);
  else l.walls.push([q, r, d]);
  return l;
}

export function togglePortal(src: Level, q: number, r: number, d: number): Level {
  const l = cloneLevel(src);
  const ps = l.portals ?? [];
  const k = ps.findIndex((p) => p[0] === q && p[1] === r && p[2] === d);
  if (k >= 0) ps.splice(k, 1);
  else ps.push([q, r, d]);
  if (ps.length) l.portals = ps;
  else delete l.portals;
  return l;
}

/**
 * a–b thread: added, or removed when it exists. Its "=" / "≠" is never chosen by hand: it always
 * tells the truth about the solution (see syncLinks).
 */
export function toggleLink(src: Level, a: number, b: number): Level | null {
  if (a === b || !src.cells[a] || !src.cells[b]) return null;
  const l = cloneLevel(src);
  const links = l.links ?? [];
  const k = links.findIndex((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
  if (k >= 0) links.splice(k, 1);
  else links.push({ a, b, same: l.cells[a].gem === l.cells[b].gem });
  if (links.length) l.links = links;
  else delete l.links;
  return l;
}

/** Threads show "=" when both ends are of the same kind, "≠" otherwise (kept true after every edit). */
export function syncLinks(l: Level): Level {
  if (!l.links?.some((x) => x.same !== (l.cells[x.a]?.gem === l.cells[x.b]?.gem))) return l;
  const out = cloneLevel(l);
  for (const x of out.links!) x.same = out.cells[x.a].gem === out.cells[x.b].gem;
  return out;
}

export function addZone(src: Level, cells: number[]): Level | null {
  const u = [...new Set(cells)].filter((i) => src.cells[i]).sort((x, y) => x - y);
  if (!u.length || u.length > LIMITS.zoneCells) return null;
  const l = cloneLevel(src);
  (l.zones ??= []).push({ cells: u });
  return l;
}

export function removeZonesWith(src: Level, cells: number[]): Level | null {
  const s = new Set(cells);
  if (!src.zones?.some((z) => z.cells.some((i) => s.has(i)))) return null;
  const l = cloneLevel(src);
  l.zones = l.zones!.filter((z) => !z.cells.some((i) => s.has(i)));
  if (!l.zones.length) delete l.zones;
  return l;
}

export function setFog(src: Level, on: boolean): Level | null {
  if ((src.fog !== false) === on) return null;
  const l = cloneLevel(src);
  if (on) delete l.fog;
  else l.fog = false;
  return l;
}

/** The level as it is played and shared: no editor leftovers, a stable id. */
export function playable(src: Level, id: string, title?: string): Level {
  const l = cloneLevel(src);
  l.id = id;
  if (title) l.title = title;
  else delete l.title;
  delete l.diff;
  delete l.teach;
  delete l.seed;
  return l;
}
