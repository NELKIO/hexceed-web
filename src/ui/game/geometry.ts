// Board geometry for the SVG renderer: pixel layout, tile path, zone outlines, link curves.

import { DIRS, EDGE_CORNERS, hexPoints, toPixel } from '../../core/hex';
import type { Board } from '../../core/rules';

/** Circumradius of a hex in board units. */
export const S = 40;
export const TILE_R = S * 0.935;
export const INNER = (S * Math.sqrt(3)) / 2;

/** Rounded flat-top hexagon path centred on the origin. */
export function roundedHexPath(r: number, round: number): string {
  const pts = hexPoints(0, 0, r);
  let d = '';
  for (let i = 0; i < 6; i++) {
    const p = pts[i];
    const prev = pts[(i + 5) % 6];
    const next = pts[(i + 1) % 6];
    const a: [number, number] = [p[0] + (prev[0] - p[0]) * round, p[1] + (prev[1] - p[1]) * round];
    const b: [number, number] = [p[0] + (next[0] - p[0]) * round, p[1] + (next[1] - p[1]) * round];
    d += `${i === 0 ? 'M' : 'L'}${a[0].toFixed(2)},${a[1].toFixed(2)}Q${p[0].toFixed(2)},${p[1].toFixed(2)} ${b[0].toFixed(2)},${b[1].toFixed(2)}`;
  }
  return d + 'Z';
}

export const TILE_PATH = roundedHexPath(TILE_R, 0.16);
export const OUTLINE_PATH = roundedHexPath(S * 0.99, 0.14);
export const SMALL_PATH = roundedHexPath(S * 0.8, 0.16);

export interface Layout {
  /** Unit centre (centroid of its hexes for big cells). */
  px: [number, number][];
  /** Every hex of a unit (axial). */
  hexes: [number, number][][];
  /** Axial key of any hex -> unit index. */
  hexUnit: Map<string, number>;
  /** Tile path (local coords) for big cells; undefined = the standard hex. */
  tile: (string | undefined)[];
  /** Outline path (local coords) used by highlights; undefined = the standard hex. */
  outline: (string | undefined)[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  w: number;
  h: number;
}

type Pt = [number, number];

/** Inset (by `inset`) and rounded outline of a union of hexes, relative to `origin`. */
export function blobPath(hexes: Pt[], origin: Pt, inset: number, round = 0.16): string {
  const set = new Set(hexes.map(([q, r]) => `${q},${r}`));
  const k = (p: Pt) => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`;
  const segs: [string, string, Pt, Pt][] = [];
  for (const [q, r] of hexes) {
    const [x, y] = toPixel(q, r, S);
    for (let d = 0; d < 6; d++) {
      if (set.has(`${q + DIRS[d][0]},${r + DIRS[d][1]}`)) continue;
      const [p1, p2] = edgeSegment(x - origin[0], y - origin[1], d, S);
      segs.push([k(p1), k(p2), p1, p2]);
    }
  }
  if (!segs.length) return '';
  // chain into the outer loop (clockwise in screen space, like hexPoints)
  const used = new Array(segs.length).fill(false);
  const loop: Pt[] = [segs[0][2]];
  used[0] = true;
  let end = segs[0][1];
  let endP = segs[0][3];
  for (let guard = 0; guard < segs.length; guard++) {
    if (end === segs[0][0]) break;
    loop.push(endP);
    const t = segs.findIndex((sg, j) => !used[j] && sg[0] === end);
    if (t < 0) break;
    used[t] = true;
    end = segs[t][1];
    endP = segs[t][3];
  }
  const n = loop.length;
  // signed area tells the orientation; inward normal = rotate edge accordingly
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = loop[i], [x2, y2] = loop[(i + 1) % n];
    area += x1 * y2 - x2 * y1;
  }
  const sgn = area > 0 ? 1 : -1;
  const nrm = (a: Pt, b: Pt): Pt => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    return [(-dy / l) * sgn, (dx / l) * sgn];
  };
  const pts: Pt[] = loop.map((v, i) => {
    const prev = loop[(i + n - 1) % n], next = loop[(i + 1) % n];
    const n1 = nrm(prev, v), n2 = nrm(v, next);
    const dot = n1[0] * n2[0] + n1[1] * n2[1];
    const f = inset / (1 + dot);
    return [v[0] + (n1[0] + n2[0]) * f, v[1] + (n1[1] + n2[1]) * f];
  });
  let d = '';
  for (let i = 0; i < n; i++) {
    const p = pts[i], prev = pts[(i + n - 1) % n], next = pts[(i + 1) % n];
    const a: Pt = [p[0] + (prev[0] - p[0]) * round, p[1] + (prev[1] - p[1]) * round];
    const c: Pt = [p[0] + (next[0] - p[0]) * round, p[1] + (next[1] - p[1]) * round];
    d += `${i === 0 ? 'M' : 'L'}${a[0].toFixed(2)},${a[1].toFixed(2)}Q${p[0].toFixed(2)},${p[1].toFixed(2)} ${c[0].toFixed(2)},${c[1].toFixed(2)}`;
  }
  return d + 'Z';
}

export function layoutBoard(b: Board): Layout {
  const hexes: Pt[][] = [];
  const hexUnit = new Map<string, number>();
  const px: Pt[] = [];
  const tile: (string | undefined)[] = [];
  const outline: (string | undefined)[] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  b.level.cells.forEach((c, i) => {
    const extra = ((c as { extra?: Pt[] }).extra ?? []).filter((h) => Array.isArray(h));
    const hs: Pt[] = [[c.q, c.r], ...extra];
    hexes.push(hs);
    let sx = 0, sy = 0;
    for (const [q, r] of hs) {
      hexUnit.set(`${q},${r}`, i);
      const [x, y] = toPixel(q, r, S);
      sx += x;
      sy += y;
      minX = Math.min(minX, x - S);
      maxX = Math.max(maxX, x + S);
      minY = Math.min(minY, y - INNER);
      maxY = Math.max(maxY, y + INNER + 4);
    }
    const o: Pt = [sx / hs.length, sy / hs.length];
    px.push(o);
    if (hs.length > 1) {
      tile.push(blobPath(hs, o, (S - TILE_R) * 0.87, 0.16));
      outline.push(blobPath(hs, o, S * 0.01 * 0.87, 0.14));
    } else {
      tile.push(undefined);
      outline.push(undefined);
    }
  });
  return { px, hexes, hexUnit, tile, outline, minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/** Unit index under a board-space point (or -1). */
export function cellAt(_b: Board, layout: Layout, x: number, y: number): number {
  const q = ((2 / 3) * x) / S;
  const r = ((-1 / 3) * x + (Math.sqrt(3) / 3) * y) / S;
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  const i = layout.hexUnit.get(`${rq},${rr}`);
  return i === undefined ? -1 : i;
}

/** Endpoints of the edge of cell centre (x,y) in direction d, at radius r. */
export function edgeSegment(x: number, y: number, d: number, r = S): [[number, number], [number, number]] {
  const pts = hexPoints(x, y, r);
  const [a, c] = EDGE_CORNERS[d];
  return [pts[a], pts[c]];
}

/** Closed outline loops (board units) of a set of cells — the union of their hexes. */
export function zoneOutline(_b: Board, layout: Layout, cells: number[], r = S): string {
  const hexes = cells.flatMap((i) => layout.hexes[i] ?? []);
  const set = new Set(hexes.map(([q, rr]) => `${q},${rr}`));
  const segs: [string, string, [number, number], [number, number]][] = [];
  const k = (p: [number, number]) => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`;
  for (const [q, rr] of hexes) {
    const [x, y] = toPixel(q, rr, S);
    for (let d = 0; d < 6; d++) {
      if (set.has(`${q + DIRS[d][0]},${rr + DIRS[d][1]}`)) continue;
      const [p, pq] = edgeSegment(x, y, d, r);
      segs.push([k(p), k(pq), p, pq]);
    }
  }
  // chain segments into loops
  const used = new Array(segs.length).fill(false);
  let d = '';
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (used[s0]) continue;
    used[s0] = true;
    const loop: [number, number][] = [segs[s0][2], segs[s0][3]];
    let end = segs[s0][1];
    const startK = segs[s0][0];
    for (let guard = 0; guard < segs.length && end !== startK; guard++) {
      let found = -1;
      for (let t = 0; t < segs.length; t++) {
        if (used[t]) continue;
        if (segs[t][0] === end) { found = t; loop.push(segs[t][3]); end = segs[t][1]; break; }
        if (segs[t][1] === end) { found = t; loop.push(segs[t][2]); end = segs[t][0]; break; }
      }
      if (found < 0) break;
      used[found] = true;
    }
    d += 'M' + loop.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('L') + 'Z';
  }
  return d;
}

/** Anchor for a zone badge: the top edge midpoint of its top-most cell. */
export function zoneBadge(layout: Layout, cells: number[]): [number, number] {
  let best = cells[0];
  for (const i of cells) {
    const [x, y] = layout.px[i];
    const [bx, by] = layout.px[best];
    if (y < by - 0.1 || (Math.abs(y - by) < 0.1 && x < bx)) best = i;
  }
  const [x, y] = layout.px[best];
  return [x, y - INNER];
}

/** Quadratic curve for a link thread between cells a and b (starting at the hex rims); path + ends + midpoint. */
export function linkCurve(layout: Layout, a: number, b: number): { d: string; mid: [number, number]; ends: [[number, number], [number, number]] } {
  const [x1, y1] = layout.px[a];
  const [x2, y2] = layout.px[b];
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.min(0.22 * len, S * 1.1);
  const nx = -dy / len, ny = dx / len;
  const cx = (x1 + x2) / 2 + nx * bow, cy = (y1 + y2) / 2 + ny * bow;
  const toward = (px: number, py: number): [number, number] => {
    const l = Math.hypot(cx - px, cy - py) || 1;
    const r = S * 0.62;
    return [px + ((cx - px) / l) * r, py + ((cy - py) / l) * r];
  };
  const p1 = toward(x1, y1), p2 = toward(x2, y2);
  // badge: the point of the curve farthest from every cell centre (so it never sits on a
  // number), mildly preferring the middle of the thread
  const at = (t: number): [number, number] => {
    const u = 1 - t;
    return [u * u * p1[0] + 2 * u * t * cx + t * t * p2[0], u * u * p1[1] + 2 * u * t * cy + t * t * p2[1]];
  };
  let mid = at(0.5);
  let best = -Infinity;
  for (let t = 0.15; t <= 0.851; t += 0.025) {
    const p = at(t);
    let near = Infinity;
    for (const c of layout.px) {
      const d = Math.hypot(c[0] - p[0], c[1] - p[1]);
      if (d < near) near = d;
    }
    const score = Math.min(near, S * 0.95) - Math.abs(t - 0.5) * S * 0.5;
    if (score > best) {
      best = score;
      mid = p;
    }
  }
  const f = (p: [number, number]) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  return { d: `M${f(p1)}Q${cx.toFixed(1)},${cy.toFixed(1)} ${f(p2)}`, mid, ends: [p1, p2] };
}

export const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
