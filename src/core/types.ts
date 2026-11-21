// Level format and game types. See docs/MECHANICS.md for the exact rule semantics.

/** Kind of information a cell shows once it is revealed (safe) or marked (crystal). */
export type ClueKind =
  | 'num' // crystals among the neighbours (walls respected, through portals)
  | 'line' // crystals along straight rays (edge directions), stopped by walls, jumps gaps, through portals
  | 'radius' // crystals at distance 1..2 (18 hexes), ignores walls
  | 'ring' // crystals at exactly distance 2 (12 hexes), ignores walls
  | 'donut' // crystals at distance 2..3 (30 hexes), ignores walls
  | 'cone' // 9-hex wedges towards corner directions (a·e_c + b·e_(c+1), 1 <= a+b <= 3), ignores walls
  | 'triangle' // the far 6 hexes of the same wedge (a <= 2, b <= 2, a+b >= 2), ignores walls
  | 'dot' // single hexes: 2·e_d, or e_d + e_(d+1) when `corner`
  | 'swirl' // walk around a pivot hex (see MECHANICS.md), a wall ends the walk
  | 'island' // crystals in the wall-bounded region reachable from the cell
  | 'chain' // crystals in the crystal clusters touching the cell (non-linear)
  | 'eye' // number of the 6 directions that see a crystal along the ray (walls stop)
  | 'parity' // even / odd number of crystals among neighbours
  | 'blank'; // no information

export type ClueMod = 'together' | 'apart';

export interface Clue {
  k: ClueKind;
  /** line: edge directions; cone/triangle: corner directions; dot: edge (or corner) directions; swirl: one edge direction. */
  dirs?: number[];
  /** num (and single-direction line): crystals are one contiguous group / not one contiguous group. */
  mod?: ClueMod;
  /** dot: use corner positions e_d + e_(d+1) instead of 2·e_d. */
  corner?: boolean;
  /** swirl: counter-clockwise walk. */
  ccw?: boolean;
}

export interface LevelCell {
  q: number;
  r: number;
  /** Solution: true = crystal ("mine"), false = safe. */
  gem: boolean;
  /** What the cell shows once solved. Safe cells default to {k:'num'}; crystals default to no clue. */
  clue?: Clue;
  /** Safe cell revealed at the start. */
  start?: boolean;
  /** Safe cell, visibly locked: opens by itself once N crystals are marked anywhere. */
  lock?: number;
  /** Big cell: further hexes belonging to the same unit (only `num` or no clue). */
  extra?: [number, number][];
  /** Rotating cell: orientation offsets cycled with the phase; its walls, portals and clue dirs rotate. */
  rot?: number[];
  /** Switching cell: alternative clues, shown cyclically with the phase ([clue, ...alt][t % (1 + alt.length)]). */
  alt?: Clue[];
}

/** Wall on the edge between (q,r) and its neighbour in direction d (0..5). Owned by (q,r) when it rotates. */
export type Wall = [q: number, r: number, d: number];

/** One-sided portal flag on edge d of hex (q,r). */
export type Portal = [q: number, r: number, d: number];

/** Visible from the start: the two cells are both crystals/both safe (same) or exactly one is a crystal. */
export interface Link {
  a: number; // cell index
  b: number;
  same: boolean;
}

/** Visible from the start: an outlined group of cells with the number of crystals inside. */
export interface Zone {
  cells: number[];
}

export type MechanicId =
  | 'basic'
  | 'counter'
  | 'fog'
  | 'walls'
  | 'gaps'
  | 'line'
  | 'multiline'
  | 'radius'
  | 'ring'
  | 'donut'
  | 'cone'
  | 'triangle'
  | 'lock'
  | 'gemclue'
  | 'dot'
  | 'swirl'
  | 'rotate'
  | 'switch'
  | 'big'
  | 'portal'
  | 'island'
  | 'chain'
  | 'together'
  | 'apart'
  | 'eye'
  | 'parity'
  | 'link'
  | 'zone'
  | 'blank';

export interface Level {
  id: string;
  title?: string;
  cells: LevelCell[];
  walls: Wall[];
  portals?: Portal[];
  links?: Link[];
  zones?: Zone[];
  /** Fog of war (default true): cells no visible information refers to are hidden and not clickable. */
  fog?: boolean;
  /** Mechanics this level introduces (show a short explainer on first encounter). */
  teach?: MechanicId[];
  /** Rated difficulty 1..10 (from the solver). */
  diff?: number;
  seed?: number;
}

/** Player-facing state of a cell. */
export const CellState = {
  Hidden: 0,
  Revealed: 1, // safe & opened
  Marked: 2, // crystal & marked
} as const;
export type CellState = (typeof CellState)[keyof typeof CellState];
