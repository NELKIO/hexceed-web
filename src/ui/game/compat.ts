// Tolerant access to the v2 core features (fog, phases, mistake modes, new clue kinds).
// Everything is read defensively so the UI works before and after the core lands.

import * as G from '../../core/game';
import * as R from '../../core/rules';
import type { Board, Constraint } from '../../core/rules';
import type { Game } from '../../core/game';
import type { Level, LevelCell } from '../../core/types';

export interface LooseClue {
  k: string;
  dirs?: number[];
  mod?: 'together' | 'apart';
  corner?: boolean;
  ccw?: boolean;
}

type AnyFn = (...a: unknown[]) => unknown;
const g = G as unknown as Record<string, AnyFn | undefined>;

type V2Cell = LevelCell & { rot?: number[]; alt?: LooseClue[]; extra?: [number, number][] };
const cellOf = (level: Level, i: number) => level.cells[i] as V2Cell;

export type MistakeMode = 'gentle' | 'classic' | 'hardcore';

export function newGameV2(level: Level, mode: MistakeMode): Game {
  // v2: newGame(level, { mode }); v1 only stores the extra argument as an unused start timestamp
  const ng = G.newGame as unknown as (l: Level, o?: unknown) => Game;
  return ng(level, { mode });
}

/** 1 = visible, 0 = fogged; null when the core has no fog. */
export function visibleOf(game: Game): Uint8Array | null {
  const f = g.visibleCells;
  if (!f) return null;
  try {
    return (f(game) as Uint8Array) ?? null;
  } catch {
    return null;
  }
}

export const phaseOf = (game: Game): number => ((game as unknown as { phase?: number }).phase ?? 0) | 0;

export function canRotate(): boolean {
  return typeof g.rotate === 'function';
}

export function rotateGame(game: Game): boolean {
  const f = g.rotate;
  if (!f) return false;
  f(game);
  return true;
}

export function levelHasPhases(level: Level): boolean {
  return level.cells.some((_, i) => !!cellOf(level, i).rot?.length || !!cellOf(level, i).alt?.length);
}

export function isRotating(level: Level, i: number): boolean {
  return !!cellOf(level, i).rot?.length;
}

export function isSwitching(level: Level, i: number): boolean {
  return !!cellOf(level, i).alt?.length;
}

/** Orientation offset (0..5) of a rotating cell at a phase. */
export function rotOffset(level: Level, i: number, phase: number): number {
  const rot = cellOf(level, i).rot;
  return rot?.length ? ((rot[phase % rot.length] % 6) + 6) % 6 : 0;
}

/** Clue shown by cell i at a phase (switching cells cycle through `alt`). */
export function clueAt(b: Board, i: number, phase: number): LooseClue | undefined {
  const base = R.effectiveClue(b, i) as LooseClue | undefined;
  const alt = cellOf(b.level, i).alt;
  if (alt?.length) {
    const all = [base, ...alt];
    return all[phase % all.length] ?? undefined;
  }
  return base;
}

export function constraintsAt(b: Board, i: number, phase: number): Constraint[] {
  try {
    const f = R.cellConstraints as unknown as (b: Board, i: number, p?: number) => Constraint[] | undefined;
    return f(b, i, phase) ?? [];
  } catch {
    return [];
  }
}

export function displayAt(b: Board, i: number, phase: number): string {
  try {
    const f = R.clueDisplay as unknown as (b: Board, i: number, p?: number) => { text: string } | null;
    const d = f(b, i, phase);
    if (d?.text) return d.text;
  } catch {
    /* fall through */
  }
  // fallback: compute from the constraint
  const cs = constraintsAt(b, i, phase);
  if (!cs.length) return '';
  const c = cs[0];
  if (c.kind === 'parity') return c.value ? 'odd' : 'even';
  return String(c.value);
}

/** Classic mode "danger" (remaining safe moves), 0 when not in danger. */
export function dangerOf(game: Game): number {
  const x = game as unknown as { danger?: number | boolean; dangerLeft?: number };
  if (typeof x.danger === 'number') return x.danger;
  if (x.danger === true) return x.dangerLeft ?? 1;
  return x.dangerLeft ?? 0;
}

export function portalsOf(level: Level): [number, number, number][] {
  const p = (level as unknown as { portals?: [number, number, number][] }).portals;
  return Array.isArray(p) ? p : [];
}

export function fogEnabled(level: Level): boolean {
  return (level as unknown as { fog?: boolean }).fog !== false;
}

/**
 * Restart a game in place. Uses the core's `resetGame` when present (clears danger, history,
 * phase…); otherwise copies every field of a fresh game so nothing from the previous attempt
 * (classic-mode danger / rewind history) survives.
 */
export function resetGameV2(game: Game, level: Level, mode: MistakeMode): void {
  const f = g.resetGame;
  if (f) {
    try {
      f(game);
      return;
    } catch {
      /* fall back below */
    }
  }
  const fresh = newGameV2(level, mode);
  Object.assign(game, fresh, { board: game.board });
}

/** Portal flags as they stand in a phase (rotating cells carry their portals along). */
export function portalsAtPhase(b: Board, level: Level, phase: number): [number, number, number][] {
  const phases = (b as unknown as { phases?: { portals?: Set<string> }[]; period?: number }).phases;
  const period = (b as unknown as { period?: number }).period ?? phases?.length ?? 1;
  const geo = phases?.[((phase % period) + period) % period];
  if (geo?.portals instanceof Set) return [...geo.portals].map((s) => s.split(',').map(Number) as [number, number, number]);
  return portalsOf(level);
}
