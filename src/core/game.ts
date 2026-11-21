// Game state + player actions. Pure logic, no DOM. Mistakes never change the board (except the
// "classic" mode rewind, which takes back the player's own last correct moves).

import { buildBoard, cellConstraints, cellConstraintsAll, hasFog, staticConstraints, type Board, type Constraint } from './rules';
import { CellState, type Level } from './types';

export type Action = 'reveal' | 'mark';

/**
 * gentle: mistakes are only counted. classic: the first mistake puts the player "in danger" for the
 * next DANGER_MOVES correct moves; a mistake while in danger rewinds the last REWIND_MOVES correct
 * moves. hardcore: any mistake means the level restarts (the caller restarts, see ActResult.restart).
 */
export type MistakeMode = 'gentle' | 'classic' | 'hardcore';
export const DANGER_MOVES = 10;
export const REWIND_MOVES = 5;

export interface GameOptions {
  mode?: MistakeMode;
  now?: number;
}

export interface Move {
  cell: number;
  /** Lock cells this move opened. */
  opened: number[];
}

export interface Game {
  board: Board;
  state: Uint8Array; // CellState per cell
  mistakes: number;
  hintsUsed: number;
  marked: number;
  moves: number;
  startedAt: number;
  finishedAt: number;
  mode: MistakeMode;
  /** Remaining correct moves in danger (classic mode), 0 = safe. */
  danger: number;
  /** Correct moves in order (for the classic rewind). */
  history: Move[];
  /** Current phase (rotating / switching cells), 0 <= phase < board.period. */
  phase: number;
}

export interface ActResult {
  ok: boolean; // false = mistake (or illegal: locked / fogged / already open)
  illegal?: boolean;
  /** Cells opened as a consequence (locks opening). */
  opened: number[];
  won: boolean;
  /** classic: cells hidden again by a rewind. */
  rewound?: number[];
  /** classic: the player is (now) in danger. */
  danger?: boolean;
  /** hardcore: the level must restart. */
  restart?: boolean;
}

export function newGame(level: Level, opts: GameOptions | number = {}): Game {
  const o: GameOptions = typeof opts === 'number' ? { now: opts } : opts;
  const board = buildBoard(level);
  const state = new Uint8Array(board.n);
  level.cells.forEach((c, i) => {
    if (c.start && !c.gem) state[i] = CellState.Revealed;
  });
  const g: Game = {
    board,
    state,
    mistakes: 0,
    hintsUsed: 0,
    marked: 0,
    moves: 0,
    startedAt: o.now ?? Date.now(),
    finishedAt: 0,
    mode: o.mode ?? 'gentle',
    danger: 0,
    history: [],
    phase: 0,
  };
  openLocks(g);
  return g;
}

/** Restart in place: the initial position again, counters, danger, history and phase cleared. */
export function resetGame(g: Game, now = Date.now()): void {
  const level = g.board.level;
  g.state.fill(CellState.Hidden);
  level.cells.forEach((c, i) => {
    if (c.start && !c.gem) g.state[i] = CellState.Revealed;
  });
  g.mistakes = 0;
  g.hintsUsed = 0;
  g.marked = 0;
  g.moves = 0;
  g.startedAt = now;
  g.finishedAt = 0;
  g.danger = 0;
  g.history = [];
  g.phase = 0;
  openLocks(g);
}

export function isLocked(g: Game, i: number): boolean {
  const c = g.board.level.cells[i];
  return !!c.lock && g.state[i] === CellState.Hidden && g.marked < c.lock;
}

/** Locks remaining before cell i opens (0 when not locked). */
export function lockRemaining(g: Game, i: number): number {
  const c = g.board.level.cells[i];
  if (!c.lock || g.state[i] !== CellState.Hidden) return 0;
  return Math.max(0, c.lock - g.marked);
}

function openLocks(g: Game): number[] {
  const opened: number[] = [];
  g.board.level.cells.forEach((c, i) => {
    if (c.lock && g.state[i] === CellState.Hidden && g.marked >= c.lock) {
      g.state[i] = CellState.Revealed;
      opened.push(i);
    }
  });
  return opened;
}

export function isWon(g: Game): boolean {
  for (let i = 0; i < g.board.n; i++) if (g.state[i] === CellState.Hidden) return false;
  return true;
}

/**
 * Fog of war: 1 = the cell can be seen (and clicked when hidden). Visible = start ∪ locks ∪ revealed
 * ∪ marked ∪ cells covered by any revealed clue (any phase) ∪ zone / link cells. All 1 without fog.
 */
export function visibleCells(g: Game): Uint8Array {
  const n = g.board.n;
  const vis = new Uint8Array(n);
  if (!hasFog(g.board.level)) return vis.fill(1);
  g.board.level.cells.forEach((c, i) => {
    if (c.start || c.lock || g.state[i] !== CellState.Hidden) vis[i] = 1;
  });
  for (const c of activeConstraints(g)) if (c.src.type !== 'global') for (const j of c.cells) vis[j] = 1;
  return vis;
}

export function isFogged(g: Game, i: number): boolean {
  return visibleCells(g)[i] === 0;
}

function rewind(g: Game, count: number): number[] {
  const back: number[] = [];
  for (let k = 0; k < count && g.history.length; k++) {
    const m = g.history.pop()!;
    for (const j of m.opened) {
      g.state[j] = CellState.Hidden;
      back.push(j);
    }
    if (g.state[m.cell] === CellState.Marked) g.marked--;
    g.state[m.cell] = CellState.Hidden;
    back.push(m.cell);
  }
  return back;
}

export function act(g: Game, i: number, a: Action, now = Date.now()): ActResult {
  if (g.state[i] !== CellState.Hidden || isLocked(g, i) || g.finishedAt || isFogged(g, i))
    return { ok: false, illegal: true, opened: [], won: false };
  const gem = g.board.level.cells[i].gem;
  if ((a === 'reveal') === gem) {
    g.mistakes++;
    const res: ActResult = { ok: false, opened: [], won: false };
    if (g.mode === 'hardcore') res.restart = true;
    else if (g.mode === 'classic') {
      if (g.danger > 0) res.rewound = rewind(g, REWIND_MOVES);
      g.danger = DANGER_MOVES;
      res.danger = true;
    }
    return res;
  }
  g.moves++;
  g.state[i] = gem ? CellState.Marked : CellState.Revealed;
  let opened: number[] = [];
  if (gem) {
    g.marked++;
    opened = openLocks(g);
  }
  g.history.push({ cell: i, opened });
  if (g.danger > 0) g.danger--;
  const won = isWon(g);
  if (won) g.finishedAt = now || 1; // finishedAt is also the "finished" flag
  const res: ActResult = { ok: true, opened, won };
  if (g.danger > 0) res.danger = true;
  return res;
}

/** Next phase (the Rotate button). No-op on levels without rotating / switching cells. */
export function rotate(g: Game, delta = 1): void {
  const p = g.board.period;
  g.phase = (((g.phase + delta) % p) + p) % p;
}

/** Known values for the solver: -1 hidden, 0 safe (revealed or locked), 1 marked crystal. */
export function knownVals(g: Game): Int8Array {
  const v = new Int8Array(g.board.n).fill(-1);
  for (let i = 0; i < g.board.n; i++) {
    if (g.state[i] === CellState.Revealed) v[i] = 0;
    else if (g.state[i] === CellState.Marked) v[i] = 1;
    else if (g.board.level.cells[i].lock) v[i] = 0; // locked cells are known to be safe
  }
  return v;
}

/** All information the player can know: static info + every open clue in every phase. */
export function activeConstraints(g: Game): Constraint[] {
  const out = staticConstraints(g.board);
  for (let i = 0; i < g.board.n; i++) if (g.state[i] !== CellState.Hidden) out.push(...cellConstraintsAll(g.board, i));
  return out;
}

/**
 * "Chord" on an open clue (as shown in the current phase): when the clue is already satisfied, every
 * remaining hidden cell it covers is safe; when the remaining hidden cells exactly fill the count,
 * they are all crystals. Returns the moves that follow (empty when the clue decides nothing by itself).
 */
export function chordMoves(g: Game, i: number): { cell: number; action: Action }[] {
  if (g.state[i] === CellState.Hidden) return [];
  const cons = cellConstraints(g.board, i, g.phase);
  const c = cons[0];
  if (!c || c.kind !== 'sum') return [];
  const vals = knownVals(g);
  let gems = 0;
  const hidden: number[] = [];
  for (const j of c.cells) {
    if (vals[j] === 1) gems++;
    else if (vals[j] === -1) hidden.push(j);
  }
  if (!hidden.length) return [];
  if (gems === c.value) return hidden.map((cell) => ({ cell, action: 'reveal' as const }));
  if (c.value - gems === hidden.length) return hidden.map((cell) => ({ cell, action: 'mark' as const }));
  return [];
}

/** Stars: 3 = no mistakes and no hints, 2 = up to 2 mistakes / hints combined, 1 otherwise. */
export function stars(g: Game): number {
  const p = g.mistakes + g.hintsUsed;
  return p === 0 ? 3 : p <= 2 ? 2 : 1;
}
