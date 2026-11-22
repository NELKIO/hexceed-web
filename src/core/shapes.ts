// Board outlines: a library of mostly symmetric shapes (mirror / rotational), rasterised on the
// flat-top hex grid at a fitted scale. Predicates live in a unit-ish box; the grid's own symmetries
// (point, x/y mirror, 60° rotation about a hex centre) keep symmetric predicates symmetric.

import { DIRS, key } from './hex';
import type { Rng } from './rng';

export type ShapeId =
  | 'hexagon'
  | 'disk'
  | 'triangle'
  | 'rhombus'
  | 'diamond'
  | 'ring'
  | 'islands2'
  | 'islands3'
  | 'flower'
  | 'heart'
  | 'star'
  | 'wave'
  | 'blob'
  | 'glyph';

const SQ3 = Math.sqrt(3);

// ---------------------------------------------------------------------------------------------
// Shapes: predicates in a unit-ish box (|x|,|y| <= ~1.3), rasterised at a fitted scale.

type Pred = (x: number, y: number) => boolean;

export interface ShapeDef {
  id: ShapeId;
  make: (rng: Rng) => Pred;
  gaps?: boolean; // shape itself has holes / several islands
  multi?: boolean; // keep several components
  minSize: number;
  weight: number;
}

const polar = (x: number, y: number) => [Math.hypot(x, y), Math.atan2(y, x)] as const;

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

const GLYPHS: number[][][] = [
  // H
  [[-0.62, -1, -0.62, 1], [0.62, -1, 0.62, 1], [-0.62, 0, 0.62, 0]],
  // T
  [[-0.85, -0.85, 0.85, -0.85], [0, -0.85, 0, 1]],
  // X
  [[-0.8, -1, 0.8, 1], [0.8, -1, -0.8, 1]],
  // Y
  [[-0.8, -1, 0, 0], [0.8, -1, 0, 0], [0, 0, 0, 1]],
  // U
  [[-0.62, -1, -0.62, 0.45], [0.62, -1, 0.62, 0.45], [-0.62, 0.45, -0.3, 0.9], [-0.3, 0.9, 0.3, 0.9], [0.3, 0.9, 0.62, 0.45]],
  // A
  [[-0.75, 1, 0, -1], [0, -1, 0.75, 1], [-0.42, 0.3, 0.42, 0.3]],
  // plus
  [[-0.95, 0, 0.95, 0], [0, -0.95, 0, 0.95]],
  // V
  [[-0.8, -1, 0, 1], [0.8, -1, 0, 1]],
];

export const SHAPES: ShapeDef[] = [
  { id: 'hexagon', minSize: 7, weight: 1.2, make: () => (x, y) => Math.abs(y) <= SQ3 / 2 && Math.abs(x) + Math.abs(y) / SQ3 <= 1 },
  { id: 'disk', minSize: 7, weight: 1, make: () => (x, y) => x * x + y * y <= 1 },
  {
    id: 'triangle',
    minSize: 9,
    weight: 1,
    make: (rng) => {
      const down = rng.chance(0.5) ? -1 : 1;
      return (x, y) => {
        const yy = y * down - 0.15;
        // equilateral triangle pointing up (screen y down), inradius 0.55, rounded by a disk
        const n = [[0, 1], [SQ3 / 2, -0.5], [-SQ3 / 2, -0.5]];
        for (const [nx, ny] of n) if (x * nx + yy * ny > 0.55) return false;
        return x * x + yy * yy <= 0.92 * 0.92;
      };
    },
  },
  {
    id: 'rhombus',
    minSize: 9,
    weight: 0.8,
    make: (rng) => {
      const pair = rng.int(3);
      const a = 0.62 + rng.next() * 0.1;
      return (x, y) => {
        const q = x / 1.5;
        const r = y / SQ3 - q / 2;
        const s = -q - r;
        const [u, v] = pair === 0 ? [q, r] : pair === 1 ? [r, s] : [q, s];
        return Math.abs(u) <= a && Math.abs(v) <= a;
      };
    },
  },
  { id: 'diamond', minSize: 9, weight: 0.8, make: () => (x, y) => Math.abs(x) / 0.85 + Math.abs(y) <= 1 },
  { id: 'ring', minSize: 24, weight: 1, gaps: true, make: (rng) => { const inner = 0.42 + rng.next() * 0.12; return (x, y) => { const d = Math.hypot(x, y); return d <= 1 && d >= inner; }; } },
  {
    id: 'islands2',
    minSize: 16,
    weight: 0.8,
    gaps: true,
    multi: true,
    make: (rng) => {
      // stacked vertically (portrait phones), slightly offset for variety
      const sx = (rng.chance(0.5) ? 1 : -1) * rng.next() * 0.15;
      const c = [[sx, -0.55], [-sx, 0.55]];
      return (x, y) => c.some(([cx, cy]) => (x - cx) ** 2 + (y - cy) ** 2 <= 0.41 * 0.41);
    },
  },
  {
    id: 'islands3',
    minSize: 24,
    weight: 0.8,
    gaps: true,
    multi: true,
    make: (rng) => {
      const rot = rng.chance(0.5) ? 0 : Math.PI;
      // a tight triangle of pieces, or a column of three
      const col = rng.chance(0.4);
      const c = col
        ? [[0, -0.8], [0, 0], [0, 0.8]]
        : [0, 1, 2].map((k) => [0.62 * Math.cos(rot - Math.PI / 2 + (k * 2 * Math.PI) / 3), 0.62 * Math.sin(rot - Math.PI / 2 + (k * 2 * Math.PI) / 3)]);
      const rad = col ? 0.33 : 0.36;
      return (x, y) => c.some(([cx, cy]) => (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad);
    },
  },
  {
    id: 'flower',
    minSize: 19,
    weight: 1,
    make: (rng) => {
      const k = rng.chance(0.5) ? 6 : 5;
      const depth = 0.22 + rng.next() * 0.1;
      return (x, y) => {
        const [d, t] = polar(x, y);
        return d <= 1 - depth + depth * Math.cos(k * (t + Math.PI / 2));
      };
    },
  },
  {
    id: 'heart',
    minSize: 20,
    weight: 0.9,
    make: () => (x, y) => {
      const X = x * 1.12, Y = -y * 1.12 + 0.18;
      const a = X * X + Y * Y - 1;
      return a * a * a - X * X * Y * Y * Y <= 0;
    },
  },
  {
    id: 'star',
    minSize: 30,
    weight: 0.7,
    make: (rng) => {
      const k = rng.chance(0.6) ? 5 : 6;
      return (x, y) => {
        const [d, t] = polar(x, y);
        return d <= 0.52 + 0.5 * Math.pow(Math.abs(Math.cos((k / 2) * (t + Math.PI / 2))), 2.2);
      };
    },
  },
  {
    id: 'wave',
    minSize: 20,
    weight: 0.7,
    make: (rng) => {
      const amp = 0.22 + rng.next() * 0.1;
      const ph = rng.chance(0.5) ? 0 : Math.PI;
      return (x, y) => Math.abs(y) <= 1 && Math.abs(x - amp * Math.sin(Math.PI * y + ph)) <= 0.4;
    },
  },
  {
    id: 'blob',
    minSize: 20,
    weight: 1.2,
    make: (rng) => {
      const a = [2, 3, 4, 5].map((k) => ((rng.next() * 2 - 1) * 0.2) / Math.sqrt(k - 1));
      return (x, y) => {
        const [d, t] = polar(x, y);
        let r = 0.95;
        for (let k = 2; k <= 5; k++) r += a[k - 2] * Math.cos(k * (t + Math.PI / 2));
        return d <= r;
      };
    },
  },
  {
    id: 'glyph',
    minSize: 34,
    weight: 0.6,
    make: (rng) => {
      const g = rng.pick(GLYPHS);
      const w = 0.27;
      return (x, y) => g.some(([ax, ay, bx, by]) => segDist(x, y, ax * 0.85, ay, bx * 0.85, by) <= w);
    },
  },
];

export const SHAPE_IDS: ShapeId[] = SHAPES.map((s) => s.id);

/** Rasterise at scale s; sy > 1 stretches the outline vertically (portrait boards). */
function rasterize(pred: Pred, s: number, sy = 1): [number, number][] {
  const out: [number, number][] = [];
  const Q = Math.ceil((1.7 * s) / 1.5) + 1;
  for (let q = -Q; q <= Q; q++) {
    const R = Math.ceil((1.7 * s * sy) / SQ3 + Math.abs(q) / 2) + 1;
    for (let r = -R; r <= R; r++) {
      const x = 1.5 * q, y = SQ3 * (r + q / 2);
      if (pred(x / s, y / (s * sy))) out.push([q, r]);
    }
  }
  return out;
}

export function components(coords: [number, number][]): [number, number][][] {
  const idx = new Map<string, number>();
  coords.forEach(([q, r], i) => idx.set(key(q, r), i));
  const seen = new Uint8Array(coords.length);
  const out: [number, number][][] = [];
  for (let i = 0; i < coords.length; i++) {
    if (seen[i]) continue;
    const comp: [number, number][] = [];
    const st = [i];
    seen[i] = 1;
    while (st.length) {
      const j = st.pop()!;
      comp.push(coords[j]);
      for (const [dq, dr] of DIRS) {
        const k = idx.get(key(coords[j][0] + dq, coords[j][1] + dr));
        if (k !== undefined && !seen[k]) {
          seen[k] = 1;
          st.push(k);
        }
      }
    }
    out.push(comp);
  }
  return out.sort((a, b) => b.length - a.length);
}

function cleanup(coords: [number, number][], multi: boolean): [number, number][] {
  const comps = components(coords);
  if (!comps.length) return [];
  if (!multi) return comps[0];
  return comps.filter((c) => c.length >= 3).flat();
}

export function aspect(coords: [number, number][]): number {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [q, r] of coords) {
    const x = 1.5 * q, y = SQ3 * (r + q / 2);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return (maxX - minX + 2) / (maxY - minY + SQ3);
}

function fitShape(def: ShapeDef, pred: Pred, size: number, sy = 1): [number, number][] {
  let lo = 0.3, hi = 32;
  const count = (s: number) => cleanup(rasterize(pred, s, sy), !!def.multi).length;
  for (let it = 0; it < 22; it++) {
    const mid = (lo + hi) / 2;
    if (count(mid) < size) lo = mid;
    else hi = mid;
  }
  const a = cleanup(rasterize(pred, lo, sy), !!def.multi);
  const b = cleanup(rasterize(pred, hi, sy), !!def.multi);
  return Math.abs(a.length - size) <= Math.abs(b.length - size) && a.length > 0 ? a : b;
}

export interface ShapeOptions {
  /** Holes / islands allowed. */
  gaps: boolean;
  /** Split the board into 2–3 islands (implies gaps). */
  islands?: boolean;
  want?: ShapeId;
  /** Widest allowed board in hex columns (phones: ~9 for regular levels, ~11 for showcases). */
  maxCols?: number;
  /** Only plain, convex-looking outlines (first levels: nothing that could read as a hole). */
  simple?: boolean;
}

const SIMPLE: ShapeId[] = ['hexagon', 'disk', 'triangle', 'rhombus', 'diamond', 'blob'];

/** Missing hexes enclosed by the board (not reachable from outside its bounding box). */
export function enclosedHoles(coords: [number, number][]): number {
  const set = new Set(coords.map(([q, r]) => key(q, r)));
  let minQ = Infinity, maxQ = -Infinity, minR = Infinity, maxR = -Infinity;
  for (const [q, r] of coords) {
    minQ = Math.min(minQ, q); maxQ = Math.max(maxQ, q);
    minR = Math.min(minR, r); maxR = Math.max(maxR, r);
  }
  minQ--; maxQ++; minR--; maxR++;
  const seen = new Set<string>();
  const st: [number, number][] = [[minQ, minR]];
  seen.add(key(minQ, minR));
  while (st.length) {
    const [q, r] = st.pop()!;
    for (const [dq, dr] of DIRS) {
      const x = q + dq, y = r + dr;
      if (x < minQ || x > maxQ || y < minR || y > maxR) continue;
      const k = key(x, y);
      if (seen.has(k) || set.has(k)) continue;
      seen.add(k);
      st.push([x, y]);
    }
  }
  let holes = 0;
  for (let q = minQ; q <= maxQ; q++) for (let r = minR; r <= maxR; r++) if (!set.has(key(q, r)) && !seen.has(key(q, r))) holes++;
  return holes;
}

/** Number of hex columns (distinct q). */
export function columns(coords: [number, number][]): number {
  return new Set(coords.map(([q]) => q)).size;
}

/** A board outline of about `size` hexes, aspect ratio (width / height) 0.6..1.2, portrait-friendly. */
export function makeShape(rng: Rng, size: number, o: ShapeOptions): { coords: [number, number][]; shape: ShapeId } {
  const gaps = o.gaps || !!o.islands;
  const pool = SHAPES.filter((s) => s.minSize <= size && (gaps || !s.gaps) && (!o.islands || s.multi || !s.gaps) && (!o.simple || SIMPLE.includes(s.id)));
  for (let tries = 0; tries < 14; tries++) {
    let def: ShapeDef | undefined = tries < 3 && o.want ? SHAPES.find((s) => s.id === o.want) : undefined;
    if (!def) {
      const w = (s: ShapeDef) => s.weight * (o.islands && s.multi ? 2.5 : gaps && s.gaps ? 1.3 : 1);
      let tot = 0;
      for (const s of pool) tot += w(s);
      let x = rng.next() * tot;
      def = pool[pool.length - 1];
      for (const s of pool) {
        x -= w(s);
        if (x <= 0) {
          def = s;
          break;
        }
      }
    }
    // portrait: stretch vertically until the board is at most as wide as tall and fits the columns
    const pred = def.make(rng);
    const maxCols = o.maxCols ?? (size <= 120 ? 9 : 11);
    let coords: [number, number][] = [];
    for (const sy of [1, 1.15, 1.3, 1.45, 1.6, 1.8, 2.05, 2.3]) {
      coords = fitShape(def, pred, size, sy);
      if (o.islands && components(coords).length < 2) {
        const split = splitIslands(rng, coords);
        if (split) coords = split;
      }
      if (aspect(coords) <= 1.0 && columns(coords) <= maxCols) break;
    }
    if (o.islands && components(coords).length < 2) continue;
    if (!gaps && enclosedHoles(coords) > 0) continue; // no holes on boards without gaps
    const ar = aspect(coords);
    const tol = Math.max(3, size * 0.25);
    if (coords.length >= 4 && Math.abs(coords.length - size) <= tol && ar >= 0.45 && ar <= 1.05 && (columns(coords) <= maxCols || size < 12)) return { coords, shape: def.id };
  }
  const fb = SHAPES[0];
  let coords = fitShape(fb, fb.make(rng), size);
  for (const sy of [1.15, 1.3, 1.5, 1.8, 2.1, 2.4, 2.8]) {
    if (aspect(coords) <= 1.0 && columns(coords) <= (o.maxCols ?? (size <= 120 ? 9 : 11))) break;
    coords = fitShape(fb, fb.make(rng), size, sy);
  }
  return { coords, shape: 'hexagon' };
}

/**
 * Cut a symmetric channel (one or two hexes wide) through the centre along one of the grid's
 * symmetry axes, leaving 2 islands of comparable size. null when that does not work out.
 */
export function splitIslands(rng: Rng, coords: [number, number][]): [number, number][] | null {
  // horizontal or slightly tilted channels: the pieces end up stacked (portrait screens)
  const axes = rng.shuffle([0, 1, 5]);
  for (const k of axes) {
    const th = (k * Math.PI) / 6; // multiples of 30°: edge- and corner-aligned axes
    const nx = -Math.sin(th), ny = Math.cos(th);
    const w = rng.chance(0.5) ? 0.9 : 1.6;
    const kept = coords.filter(([q, r]) => {
      const x = 1.5 * q, y = SQ3 * (r + q / 2);
      return Math.abs(x * nx + y * ny) > w;
    });
    const comps = components(kept);
    if (comps.length < 2) continue;
    const big = comps.filter((c) => c.length >= Math.max(4, kept.length * 0.2));
    if (big.length < 2 || big.length > 3) continue;
    return big.flat();
  }
  return null;
}

/** Mirror image (x -> -x) of an axial coordinate. */
export const mirror = (q: number, r: number): [number, number] => [-q, r + q];

export function carveHoles(rng: Rng, coords: [number, number][]): [number, number][] {
  const set = new Map<string, [number, number]>();
  for (const c of coords) set.set(key(c[0], c[1]), c);
  const holes = 1 + rng.int(Math.max(1, Math.floor(coords.length / 28)));
  for (let h = 0, tries = 0; h < holes && tries < 40; tries++) {
    const [q, r] = rng.pick([...set.values()]);
    if (q === 0 && r === 0 && coords.length > 30) continue;
    const interior = DIRS.every(([dq, dr]) => set.has(key(q + dq, r + dr)));
    if (!interior) continue;
    const victims = [[q, r] as [number, number], mirror(q, r)];
    const removed: [string, [number, number]][] = [];
    for (const [vq, vr] of victims) {
      const k = key(vq, vr);
      const v = set.get(k);
      if (v) {
        set.delete(k);
        removed.push([k, v]);
      }
    }
    if (components([...set.values()]).length !== 1) {
      for (const [k, v] of removed) set.set(k, v);
      continue;
    }
    h++;
  }
  return [...set.values()];
}

