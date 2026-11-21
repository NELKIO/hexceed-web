// Derives render props from the game state (phase-, fog- and big-cell-aware).

import { isLocked, knownVals, lockRemaining, type Game } from '../../core/game';
import { isResolved, linkConstraint, zoneConstraint, type Board, type Constraint } from '../../core/rules';
import { CellState } from '../../core/types';
import type { CellProps, Enter } from './Cell';
import { edgeSegment, linkCurve, S, zoneBadge, type Layout } from './geometry';
import type { Badge } from './Board';
import { toPixel } from '../../core/hex';
import { clueAt, constraintsAt, displayAt, isRotating, isSwitching, levelHasPhases, phaseOf, rotOffset, visibleOf, type LooseClue } from './compat';

export interface Pre {
  phased: boolean;
  rotating: boolean[];
  switching: boolean[];
  /** Static per-cell data for phase 0 (reused when the level has no phases). */
  clues0: (LooseClue | undefined)[];
  values0: string[];
  cons0: Constraint[][];
  zoneValues: number[];
  badges: Badge[];
  /** Walls owned by rotating cells, local path per cell. */
  ownWalls: (string | undefined)[];
  /** Global walls (not owned by a rotating cell). */
  staticWalls: string;
}

export function precompute(b: Board, layout: Layout): Pre {
  const phased = levelHasPhases(b.level);
  const n = b.n;
  const rotating: boolean[] = [], switching: boolean[] = [];
  const clues0: (LooseClue | undefined)[] = [], values0: string[] = [], cons0: Constraint[][] = [];
  for (let i = 0; i < n; i++) {
    rotating.push(isRotating(b.level, i));
    switching.push(isSwitching(b.level, i));
    clues0.push(clueAt(b, i, 0));
    values0.push(displayAt(b, i, 0));
    cons0.push(constraintsAt(b, i, 0));
  }
  let zoneValues: number[] = [];
  try {
    zoneValues = (b.level.zones ?? []).map((_, z) => zoneConstraint(b, z).value);
  } catch {
    zoneValues = [];
  }
  const badges: Badge[] = [];
  (b.level.zones ?? []).forEach((z, k) => {
    const [x, y] = zoneBadge(layout, z.cells);
    badges.push({ kind: 'zone', idx: k, x, y, r: 16 });
  });
  (b.level.links ?? []).forEach((l, k) => {
    const { mid } = linkCurve(layout, l.a, l.b);
    badges.push({ kind: 'link', idx: k, x: mid[0], y: mid[1], r: 15 });
  });
  // walls: those listed with a rotating cell's hex rotate with it
  const own: string[][] = Array.from({ length: n }, () => []);
  let staticWalls = '';
  const seg = (a: [number, number], c: [number, number]) => {
    const k = 0.06;
    const ax = a[0] + (c[0] - a[0]) * k, ay = a[1] + (c[1] - a[1]) * k;
    const bx = c[0] + (a[0] - c[0]) * k, by = c[1] + (a[1] - c[1]) * k;
    return `M${ax.toFixed(1)},${ay.toFixed(1)}L${bx.toFixed(1)},${by.toFixed(1)}`;
  };
  for (const [q, r, d] of b.level.walls) {
    const u = layout.hexUnit.get(`${q},${r}`);
    const [x, y] = toPixel(q, r, S);
    if (u !== undefined && rotating[u]) {
      const [cx, cy] = layout.px[u];
      const [a, c] = edgeSegment(x - cx, y - cy, d, S);
      own[u].push(seg(a, c));
    } else {
      const [a, c] = edgeSegment(x, y, d, S);
      staticWalls += seg(a, c);
    }
  }
  return {
    phased,
    rotating,
    switching,
    clues0,
    values0,
    cons0,
    zoneValues,
    badges,
    ownWalls: own.map((w) => (w.length ? w.join('') : undefined)),
    staticWalls,
  };
}

export function clueNow(g: Game, pre: Pre, i: number): LooseClue | undefined {
  return pre.phased && pre.switching[i] ? clueAt(g.board, i, phaseOf(g)) : pre.clues0[i];
}

/** Constraints a cell currently shows (current phase). */
export function shownConstraints(g: Game, pre: Pre, i: number): Constraint[] {
  if (pre.phased) return constraintsAt(g.board, i, phaseOf(g));
  return pre.cons0[i];
}

export type Src = { t: 'cell'; i: number } | { t: 'zone'; z: number } | { t: 'link'; l: number };

export const srcKey = (s: Src) => (s.t === 'cell' ? 'c' + s.i : s.t === 'zone' ? 'z' + s.z : 'l' + s.l);

export function srcCells(g: Game, pre: Pre, s: Src): number[] {
  if (s.t === 'zone') return g.board.level.zones![s.z].cells;
  if (s.t === 'link') {
    const l = g.board.level.links![s.l];
    return [l.a, l.b];
  }
  const out = new Set<number>();
  for (const c of shownConstraints(g, pre, s.i)) for (const j of c.cells) out.add(j);
  out.delete(s.i);
  return [...out];
}

/** Whether a source currently shows information (an open/marked clue, or a static zone/link). */
export function srcActive(g: Game, pre: Pre, s: Src): boolean {
  if (s.t !== 'cell') return true;
  if (g.state[s.i] === CellState.Hidden) return false;
  return shownConstraints(g, pre, s.i).length > 0;
}

export function srcDone(g: Game, pre: Pre, s: Src, vals: Int8Array): boolean {
  try {
    if (s.t === 'zone') return isResolved(zoneConstraint(g.board, s.z), vals);
    if (s.t === 'link') return isResolved(linkConstraint(g.board, s.l), vals);
  } catch {
    return false;
  }
  const cs = shownConstraints(g, pre, s.i);
  return cs.length > 0 && cs.every((c) => isResolved(c, vals));
}

export interface FxState {
  enter: Enter[];
  delay: number[];
  /** Cumulative 60° turns of rotating cells (always forward). */
  rotTurns: number[];
  rotOff: number[];
}

export function newFx(n: number): FxState {
  return { enter: new Array(n).fill('none'), delay: new Array(n).fill(0), rotTurns: new Array(n).fill(0), rotOff: new Array(n).fill(0) };
}

/** Sync rotation counters with the game phase; returns true when something turned. */
export function syncRotation(g: Game, pre: Pre, fx: FxState): boolean {
  if (!pre.phased) return false;
  const ph = phaseOf(g);
  let moved = false;
  for (let i = 0; i < g.board.n; i++) {
    if (!pre.rotating[i]) continue;
    const off = rotOffset(g.board.level, i, ph);
    if (off !== fx.rotOff[i]) {
      fx.rotTurns[i] += (((off - fx.rotOff[i]) % 6) + 6) % 6;
      fx.rotOff[i] = off;
      moved = true;
    }
  }
  return moved;
}

/** Visible units (fog); all visible when the core has no fog. */
export function visibility(g: Game): Uint8Array {
  const v = visibleOf(g);
  if (v && v.length === g.board.n) return v;
  return new Uint8Array(g.board.n).fill(1);
}

export function cellProps(g: Game, pre: Pre, layout: Layout, fx: FxState, vals = knownVals(g), vis = visibility(g)): CellProps[] {
  const out: CellProps[] = [];
  const ph = pre.phased ? phaseOf(g) : 0;
  for (let i = 0; i < g.board.n; i++) {
    const st = g.state[i] as CellState;
    const shown = st !== CellState.Hidden;
    const clue = shown ? clueNow(g, pre, i) : undefined;
    const value = shown ? (pre.phased ? displayAt(g.board, i, ph) : pre.values0[i]) : '';
    const done = shown && !!clue && clue.k !== 'blank' && srcDone(g, pre, { t: 'cell', i }, vals);
    out.push({
      i,
      x: layout.px[i][0],
      y: layout.px[i][1],
      st,
      fog: st === CellState.Hidden && !vis[i],
      lockN: st === CellState.Hidden && isLocked(g, i) ? lockRemaining(g, i) : 0,
      clue,
      value,
      rotDeg: 60 * fx.rotTurns[i],
      rotating: pre.rotating[i],
      switching: pre.switching[i],
      glyphKey: pre.switching[i] ? `${clue?.k}-${ph}` : 'g',
      tile: layout.tile[i],
      ownWalls: pre.ownWalls[i],
      done,
      enter: fx.enter[i],
      delay: fx.delay[i],
    });
  }
  return out;
}
