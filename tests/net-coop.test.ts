// Co-op protocol: per-author sequence numbers, idempotency, out-of-order delivery, resync.

import { describe, expect, it } from 'vitest';
import { isLocked, newGame, visibleCells, type Game } from '../src/core/game';
import { CellState, type Level } from '../src/core/types';
import { applyOp, contributions, CoopLog, isStamped, type CoopOp, type Stamped } from '../src/net/coop';

/** Radius-3 hexagon (37 cells), deterministic crystals, a lock, a rotating cell, fog on. */
function testLevel(seed = 1): Level {
  const cells: Level['cells'] = [];
  let x = seed * 9973;
  const rnd = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let q = -3; q <= 3; q++)
    for (let r = Math.max(-3, -q - 3); r <= Math.min(3, -q + 3); r++) {
      const centre = q === 0 && r === 0;
      cells.push({ q, r, gem: !centre && rnd() < 0.3, start: centre });
    }
  const safe = cells.map((c, i) => (!c.gem && !c.start ? i : -1)).filter((i) => i >= 0);
  cells[safe[0]].lock = 2;
  cells[safe[1]].rot = [0, 1, 2];
  cells[safe[1]].clue = { k: 'line', dirs: [0] };
  return { id: 'net-test', cells, walls: [] };
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Replica {
  id: string;
  g: Game;
  log: CoopLog;
}

function replica(id: string, level: Level): Replica {
  return { id, g: newGame(level, 0), log: new CoopLog(id) };
}

/** A valid local move like the game screen makes it (visible, unlocked, correct). */
function localMove(rp: Replica, rand: () => number): CoopOp | null {
  const g = rp.g;
  const roll = rand();
  if (roll < 0.06) return { t: 'rot' };
  const vis = visibleCells(g);
  const cand: number[] = [];
  for (let i = 0; i < g.board.n; i++) if (g.state[i] === CellState.Hidden && vis[i] && !isLocked(g, i)) cand.push(i);
  if (!cand.length) return null;
  const cell = cand[Math.floor(rand() * cand.length)];
  if (roll < 0.12) return { t: 'miss', cell };
  if (roll < 0.15) return { t: 'hint', cell };
  return { t: 'act', cell, a: g.board.level.cells[cell].gem ? 'mark' : 'reveal' };
}

function snapshot(g: Game) {
  return { state: Array.from(g.state), marked: g.marked, mistakes: g.mistakes, hints: g.hintsUsed, phase: g.phase, won: !!g.finishedAt };
}

describe('CoopLog', () => {
  it('stamps local ops with increasing per-author sequence numbers', () => {
    const log = new CoopLog('a');
    const s1 = log.local({ t: 'rot' }, 10);
    const s2 = log.local({ t: 'act', cell: 3, a: 'reveal' }, 11);
    expect([s1.seq, s2.seq]).toEqual([1, 2]);
    expect(s1.by).toBe('a');
    expect(log.vector()).toEqual({ a: 2 });
  });

  it('drops duplicates and buffers gaps until the missing op arrives', () => {
    const src = new CoopLog('b');
    const ops = [0, 1, 2, 3].map((k) => src.local({ t: 'act', cell: k, a: 'reveal' }, k));
    const dst = new CoopLog('a');
    expect(dst.receive([ops[0]]).map((s) => s.seq)).toEqual([1]);
    expect(dst.receive([ops[0]])).toEqual([]); // duplicate
    expect(dst.receive([ops[2], ops[3]])).toEqual([]); // gap: 2 is missing
    expect(dst.hasGaps()).toBe(true);
    expect(dst.vector()).toEqual({ b: 1 });
    expect(dst.receive([ops[1]]).map((s) => s.seq)).toEqual([2, 3, 4]);
    expect(dst.hasGaps()).toBe(false);
    expect(dst.receive(ops)).toEqual([]);
    expect(dst.size()).toBe(4);
  });

  it('answers a version vector with exactly the missing ops (of every author)', () => {
    const a = new CoopLog('a');
    const b = new CoopLog('b');
    a.local({ t: 'rot' });
    a.local({ t: 'rot' });
    b.receive(a.all());
    b.local({ t: 'hint', cell: 1 });
    a.local({ t: 'rot' });
    // b lacks a#3; a lacks b#1
    expect(a.missing(b.vector()).map((s) => `${s.by}${s.seq}`)).toEqual(['a3']);
    expect(b.missing(a.vector()).map((s) => `${s.by}${s.seq}`)).toEqual(['b1']);
    // a fresh device (lost storage) gets everything, including its own old ops
    const fresh = new CoopLog('a');
    expect(b.missing(fresh.vector()).length).toBe(3);
    expect(a.covers(b.vector())).toBe(false);
    b.receive(a.missing(b.vector()));
    a.receive(b.missing(a.vector()));
    expect(a.covers(b.vector()) && b.covers(a.vector())).toBe(true);
  });

  it('rejects malformed ops', () => {
    expect(isStamped({ by: 'x', seq: 0, at: 1, op: { t: 'rot' } })).toBe(false);
    expect(isStamped({ by: 'x', seq: 1, at: 1, op: { t: 'act', cell: 1, a: 'boom' } })).toBe(false);
    expect(isStamped({ by: 'x', seq: 1, at: 1, op: { t: 'nope' } })).toBe(false);
    expect(isStamped({ by: 'x', seq: 1, at: 1, op: { t: 'act', cell: 2, a: 'mark' } })).toBe(true);
    const log = new CoopLog('a');
    expect(log.receive([{ by: 'x', seq: 1.5, at: 0, op: { t: 'rot' } } as unknown as Stamped])).toEqual([]);
  });
});

describe('applyOp', () => {
  it('is idempotent for moves and validates against the solution', () => {
    const level = testLevel(3);
    const g = newGame(level, 0);
    const gem = level.cells.findIndex((c) => c.gem);
    const safe = level.cells.findIndex((c) => !c.gem && !c.start && !c.lock);
    expect(applyOp(g, { t: 'act', cell: gem, a: 'reveal' }).invalid).toBe(true);
    expect(applyOp(g, { t: 'act', cell: 999, a: 'reveal' }).invalid).toBe(true);
    const r1 = applyOp(g, { t: 'act', cell: safe, a: 'reveal' });
    expect(r1.changed).toBe(true);
    const before = snapshot(g);
    const r2 = applyOp(g, { t: 'act', cell: safe, a: 'reveal' });
    expect(r2.changed).toBe(false);
    expect(snapshot(g)).toEqual(before);
  });

  it('forces a correct move on a hex that is fogged / locked on this board', () => {
    const level = testLevel(5);
    const g = newGame(level, 0);
    const vis = visibleCells(g);
    const fogged = level.cells.findIndex((c, i) => !vis[i] && !c.lock);
    expect(fogged).toBeGreaterThanOrEqual(0);
    const r = applyOp(g, { t: 'act', cell: fogged, a: level.cells[fogged].gem ? 'mark' : 'reveal' });
    expect(r.changed).toBe(true);
    expect(g.state[fogged]).not.toBe(CellState.Hidden);
    const lock = level.cells.findIndex((c) => !!c.lock);
    expect(applyOp(g, { t: 'act', cell: lock, a: 'reveal' }).changed).toBe(true);
    expect(g.state[lock]).toBe(CellState.Revealed);
  });

  it('opens locks when enough crystals are marked, whoever marked them', () => {
    const level = testLevel(7);
    const g = newGame(level, 0);
    const lock = level.cells.findIndex((c) => !!c.lock);
    const gems = level.cells.map((c, i) => (c.gem ? i : -1)).filter((i) => i >= 0);
    applyOp(g, { t: 'act', cell: gems[0], a: 'mark' });
    expect(g.state[lock]).toBe(CellState.Hidden);
    const r = applyOp(g, { t: 'act', cell: gems[1], a: 'mark' });
    expect(r.opened).toContain(lock);
    expect(g.state[lock]).toBe(CellState.Revealed);
  });
});

describe('two replicas over a lossy, reordering, duplicating channel', () => {
  for (let seed = 1; seed <= 25; seed++) {
    it(`converge after resync (seed ${seed})`, () => {
      const rand = rng(seed);
      const level = testLevel(seed);
      const A = replica('alice', level);
      const B = replica('bob', level);
      const wire: { to: Replica; ops: Stamped[] }[] = [];
      const deliver = (msg: { to: Replica; ops: Stamped[] }) => {
        for (const s of msg.to.log.receive(msg.ops)) applyOp(msg.to.g, s.op, 1);
      };
      for (let step = 0; step < 400; step++) {
        const me = rand() < 0.5 ? A : B;
        const other = me === A ? B : A;
        if (rand() < 0.7) {
          const op = localMove(me, rand);
          if (op) {
            const r = applyOp(me.g, op, 1);
            if (r.invalid) throw new Error('local move must be valid');
            const s = me.log.local(op, step);
            if (rand() > 0.3) wire.push({ to: other, ops: [s] }); // 30% lost
            if (rand() < 0.2) wire.push({ to: other, ops: [s] }); // 20% duplicated
          }
        }
        // deliver a random in-flight message (reordering)
        if (wire.length && rand() < 0.8) deliver(wire.splice(Math.floor(rand() * wire.length), 1)[0]);
        // occasional anti-entropy ping (like the room's 4 s ping)
        if (rand() < 0.05) wire.push({ to: me, ops: other.log.missing(me.log.vector()) });
      }
      while (wire.length) deliver(wire.shift()!);
      // resync by version vectors until both cover each other
      for (let k = 0; k < 3 && !(A.log.covers(B.log.vector()) && B.log.covers(A.log.vector())); k++) {
        deliver({ to: B, ops: A.log.missing(B.log.vector()) });
        deliver({ to: A, ops: B.log.missing(A.log.vector()) });
      }
      expect(A.log.hasGaps() || B.log.hasGaps()).toBe(false);
      expect(snapshot(A.g)).toEqual(snapshot(B.g));
      expect(contributions(A.log.all())).toEqual(contributions(B.log.all()));
      // the board is a function of the op set: a replay in any order gives the same result
      const C = newGame(level, 0);
      const all = A.log.all().slice().sort(() => rand() - 0.5);
      for (const s of all) applyOp(C, s.op, 1);
      expect(snapshot(C)).toEqual(snapshot(A.g));
      // every resolved hex is credited exactly once (start hexes and locks open by themselves)
      const tot = Object.values(contributions(A.log.all())).reduce((n, c) => n + c.opens + c.marks, 0);
      expect(tot).toBe(A.g.state.reduce((n, st, i) => n + (st !== CellState.Hidden && !level.cells[i].start && !level.cells[i].lock ? 1 : 0), 0));
    });
  }
});

