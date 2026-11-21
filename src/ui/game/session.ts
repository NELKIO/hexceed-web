// Optional online session for GameView (co-op / race). GameView stays the single game screen:
// it reports local events to the session and plays the visuals of remote moves; everything
// network-related lives behind this interface (implemented in src/ui/online/bridge.tsx).

import type { ComponentType } from 'preact';
import type { Action, Game } from '../../core/game';
import type { Layout } from './geometry';
import type { WinInfo } from './GameView';

export type SessionOp = { t: 'act'; cell: number; a: Action } | { t: 'miss'; cell: number } | { t: 'rot' } | { t: 'hint'; cell: number };

/** A partner's move, already applied to the board by the session. */
export interface RemoteMove {
  op: SessionOp;
  name: string;
  color: string;
  /** The board changed (false: a duplicate / no-op). */
  changed: boolean;
  /** Locks this move opened. */
  opened: number[];
  won: boolean;
}

export interface GameSession {
  kind: 'coop' | 'race';
  /** Co-op: the board is the shared history — apply it to a fresh game. Returns the replay position. */
  restore?(g: Game): number;
  /** Co-op: partner moves after `from` (applied to `g` by the session), then live ones. */
  subscribe?(g: Game, from: number, onMove: (m: RemoteMove) => void): () => void;
  /** The game screen is ready (after restore / local progress load). */
  begin?(g: Game): void;
  /** A local change, after it was applied to `g`. */
  local(op: SessionOp, g: Game): void;
  /** Hex under this player's pointer / finger (-1: none). */
  pointer(cell: number): void;
  /** Play time to report at the win (co-op: shared, from the history); null = this device's clock. */
  elapsed?(g: Game): number | null;
  /** The board was solved on this device. */
  finished(w: WinInfo, g: Game): void;
  /** Leave the game screen (back button). */
  exit(): void;
  /** Rendered inside the board in board units (partner pointer, ripples). */
  Overlay?: ComponentType<{ layout: Layout }>;
  /** Slim strip under the top bar. */
  Strip?: ComponentType<{ g: Game }>;
  /** Replaces the body of the result sheet. */
  Result?: ComponentType<{ win: WinInfo; g: Game }>;
}
