// Hex geometry. Flat-top hexes, axial coordinates (q, r), y axis points down.
//
// Edge directions (an edge is shared with a neighbour):
//   0 N, 1 NE, 2 SE, 3 S, 4 SW, 5 NW
// Corner directions (a corner sits between edge dirs c and c+1):
//   0 between N & NE (up-right), 1 E, 2 down-right, 3 between S & SW (down-left), 4 W, 5 up-left

export const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], // 0 N
  [1, -1], // 1 NE
  [1, 0], // 2 SE
  [0, 1], // 3 S
  [-1, 1], // 4 SW
  [-1, 0], // 5 NW
];

/** Angle (degrees, screen space, 0 = right, clockwise positive because y is down) of edge direction d. */
export const EDGE_ANGLE = [-90, -30, 30, 90, 150, 210];
/** Angle of corner direction c. */
export const CORNER_ANGLE = [-60, 0, 60, 120, 180, 240];

export const opposite = (d: number) => (d + 3) % 6;

export const key = (q: number, r: number) => `${q},${r}`;

export function hexDistance(q1: number, r1: number, q2: number, r2: number): number {
  const dq = q1 - q2;
  const dr = r1 - r2;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Normalised key of the edge between (q,r) and its neighbour in direction d. */
export function edgeKey(q: number, r: number, d: number): string {
  if (d >= 3) {
    const [dq, dr] = DIRS[d];
    return `${q + dq},${r + dr},${d - 3}`;
  }
  return `${q},${r},${d}`;
}

/** Pixel centre of a flat-top hex with circumradius `size`. */
export function toPixel(q: number, r: number, size: number): [number, number] {
  return [size * 1.5 * q, size * Math.sqrt(3) * (r + q / 2)];
}

/** Corner points of a flat-top hex (circumradius `size`) around (cx, cy). */
export function hexPoints(cx: number, cy: number, size: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i);
    pts.push([cx + size * Math.cos(a), cy + size * Math.sin(a)]);
  }
  return pts;
}

/**
 * The two corner points (as indexes into hexPoints) bounding the edge in direction d.
 * hexPoints index i sits at angle 60*i (0 = right, clockwise since y is down).
 */
export const EDGE_CORNERS: ReadonlyArray<readonly [number, number]> = [
  [4, 5], // N   (angles 240..300)
  [5, 0], // NE  (300..360)
  [0, 1], // SE  (0..60)
  [1, 2], // S   (60..120)
  [2, 3], // SW  (120..180)
  [3, 4], // NW  (180..240)
];
