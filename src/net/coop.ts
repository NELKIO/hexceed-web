// Co-op protocol, pure (no DOM, no network): an op log with per-author sequence numbers.
//
// Every correct move, mistake, rotation and hint is an op stamped {by, seq, at}. Ops are applied
// strictly in per-author order (a gap is buffered until the missing ops arrive), duplicates are
// dropped by (by, seq), and the board is a pure function of the *set* of ops: a cell's state comes
// from the solution, so two players opening the same hex at once is a harmless no-op, the crystal
// count / locks only grow, and rotation is addition mod the period. Hence both boards converge as
// soon as both logs hold the same ops, whatever the delivery order. Resync: each side sends its
// version vector, the other answers with every op the vector lacks.

import { act, isWon, rotate, type Game } from '../core/game';
import { CellState } from '../core/types';

export type CoopOp =
  | { t: 'act'; cell: number; a: 'reveal' | 'mark' }
  | { t: 'miss'; cell: number }
  | { t: 'rot' }
  | { t: 'hint'; cell: number };

export interface Stamped {
  by: string;
  seq: number;
  at: number;
  op: CoopOp;
}

/** Highest contiguous seq applied per author. */
export type Vec = Record<string, number>;

const isInt = (x: unknown): x is number => Number.isSafeInteger(x);

/** Shape check of an untrusted op (cell range is checked against the board in applyOp). */
export function isStamped(x: unknown): x is Stamped {
  if (!x || typeof x !== 'object') return false;
  const s = x as Record<string, unknown>;
  if (typeof s.by !== 'string' || s.by.length > 40 || !isInt(s.seq) || s.seq < 1 || !isInt(s.at)) return false;
  const op = s.op as Record<string, unknown> | undefined;
  if (!op || typeof op !== 'object') return false;
  switch (op.t) {
    case 'act':
      return isInt(op.cell) && (op.a === 'reveal' || op.a === 'mark');
    case 'miss':
    case 'hint':
      return isInt(op.cell);
    case 'rot':
      return true;
    default:
      return false;
  }
}

export class CoopLog {
  readonly self: string;
  private have = new Map<string, Stamped[]>();
  private pending = new Map<string, Map<number, Stamped>>();
  /** Every applied op in local application order (for replay after a reload). */
  private order: Stamped[] = [];

  constructor(self: string, init: Stamped[] = []) {
    this.self = self;
    this.receive(init);
  }

  /** Stamp an op made on this device (already applied to the local board by the caller). */
  local(op: CoopOp, at = Date.now()): Stamped {
    const seq = this.seq(this.self) + 1;
    const s: Stamped = { by: this.self, seq, at, op };
    this.push(s);
    return s;
  }

  seq(author: string): number {
    return this.have.get(author)?.length ?? 0;
  }

  private push(s: Stamped) {
    let list = this.have.get(s.by);
    if (!list) this.have.set(s.by, (list = []));
    list.push(s);
    this.order.push(s);
  }

  /**
   * Take ops from the network (any order, duplicates allowed). Returns the ops that became
   * applicable, in an order that respects every author's sequence; the caller applies exactly these.
   */
  receive(list: readonly Stamped[]): Stamped[] {
    const out: Stamped[] = [];
    const touched = new Set<string>();
    for (const s of list) {
      if (!isStamped(s)) continue;
      if (s.seq <= this.seq(s.by)) continue; // duplicate
      let buf = this.pending.get(s.by);
      if (!buf) this.pending.set(s.by, (buf = new Map()));
      if (!buf.has(s.seq)) buf.set(s.seq, { by: s.by, seq: s.seq, at: s.at, op: s.op });
      touched.add(s.by);
    }
    for (const by of touched) {
      const buf = this.pending.get(by)!;
      for (let next = this.seq(by) + 1; buf.has(next); next++) {
        const s = buf.get(next)!;
        buf.delete(next);
        this.push(s);
        out.push(s);
      }
      if (!buf.size) this.pending.delete(by);
    }
    return out;
  }

  /** Ops are waiting for a missing earlier op: ask the peer for a resync. */
  hasGaps(): boolean {
    return this.pending.size > 0;
  }

  vector(): Vec {
    const v: Vec = {};
    for (const [by, list] of this.have) v[by] = list.length;
    return v;
  }

  /** Every op a peer with vector `v` lacks. */
  missing(v: Vec): Stamped[] {
    const out: Stamped[] = [];
    for (const [by, list] of this.have) {
      const n = isInt(v?.[by]) ? Math.max(0, v[by]) : 0;
      for (let k = n; k < list.length; k++) out.push(list[k]);
    }
    return out;
  }

  /** Does the peer hold everything this log holds? */
  covers(v: Vec): boolean {
    for (const [by, list] of this.have) if ((v?.[by] ?? 0) < list.length) return false;
    return true;
  }

  all(): Stamped[] {
    return this.order.slice();
  }

  size(): number {
    return this.order.length;
  }
}

// ------------------------------------------------------------------ applying ops to a board

export interface ApplyResult {
  /** The board changed (a hex opened/marked, phase turned, a counter moved). */
  changed: boolean;
  /** Locks this op opened. */
  opened: number[];
  won: boolean;
  /** The op contradicts the solution (a buggy or hostile peer); it was ignored. */
  invalid?: boolean;
}

/**
 * Apply one op (from either player) to a board. Idempotent for moves: a hex already resolved is
 * left alone. A move is checked against the solution; it is forced through when the local board
 * would call it illegal only because of fog / a lock (the author's board may legitimately be ahead).
 */
export function applyOp(g: Game, op: CoopOp, now = Date.now()): ApplyResult {
  const n = g.board.n;
  switch (op.t) {
    case 'act': {
      if (op.cell < 0 || op.cell >= n) return { changed: false, opened: [], won: false, invalid: true };
      const gem = g.board.level.cells[op.cell].gem;
      if (gem !== (op.a === 'mark')) return { changed: false, opened: [], won: false, invalid: true };
      if (g.state[op.cell] !== CellState.Hidden) return { changed: false, opened: [], won: false };
      const r = act(g, op.cell, op.a, now);
      if (r.ok) return { changed: true, opened: r.opened, won: r.won };
      // illegal locally (fogged / locked / finished): force the solution value
      g.state[op.cell] = gem ? CellState.Marked : CellState.Revealed;
      g.moves++;
      const opened: number[] = [];
      if (gem) {
        g.marked++;
        g.board.level.cells.forEach((c, i) => {
          if (c.lock && g.state[i] === CellState.Hidden && g.marked >= c.lock) {
            g.state[i] = CellState.Revealed;
            opened.push(i);
          }
        });
      }
      g.history.push({ cell: op.cell, opened });
      const won = !g.finishedAt && isWon(g);
      if (won) g.finishedAt = now;
      return { changed: true, opened, won };
    }
    case 'miss':
      if (op.cell < 0 || op.cell >= n) return { changed: false, opened: [], won: false, invalid: true };
      g.mistakes++;
      return { changed: true, opened: [], won: false };
    case 'hint':
      if (op.cell < 0 || op.cell >= n) return { changed: false, opened: [], won: false, invalid: true };
      g.hintsUsed++;
      return { changed: true, opened: [], won: false };
    case 'rot':
      rotate(g);
      return { changed: true, opened: [], won: false };
  }
}

// ------------------------------------------------------------------ contribution

export interface Contribution {
  opens: number;
  marks: number;
  mistakes: number;
  hints: number;
}

/**
 * Per-player contribution. A hex both players resolved at the same moment is credited to the
 * earliest op by (at, by, seq), so both devices compute the same table from the same set of ops.
 */
export function contributions(ops: readonly Stamped[]): Record<string, Contribution> {
  const out: Record<string, Contribution> = {};
  const get = (by: string) => (out[by] ??= { opens: 0, marks: 0, mistakes: 0, hints: 0 });
  const first = new Map<number, Stamped>();
  const before = (a: Stamped, b: Stamped) => a.at < b.at || (a.at === b.at && (a.by < b.by || (a.by === b.by && a.seq < b.seq)));
  for (const s of ops) {
    get(s.by);
    if (s.op.t === 'act') {
      const f = first.get(s.op.cell);
      if (!f || before(s, f)) first.set(s.op.cell, s);
    } else if (s.op.t === 'miss') get(s.by).mistakes++;
    else if (s.op.t === 'hint') get(s.by).hints++;
  }
  for (const s of first.values()) {
    if (s.op.t !== 'act') continue;
    if (s.op.a === 'mark') get(s.by).marks++;
    else get(s.by).opens++;
  }
  return out;
}
