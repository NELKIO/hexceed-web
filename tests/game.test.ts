import { describe, expect, it } from 'vitest';
import { act, activeConstraints, chordMoves, DANGER_MOVES, isLocked, knownVals, lockRemaining, newGame, rotate, stars, visibleCells } from '../src/core/game';
import { CellState, type Level } from '../src/core/types';

// radius-1 hexagon: centre (index 0) + 6 neighbours (indexes 1..6, directions N..NW)
const D = [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0]];
function level(gemDirs: number[], extra: Partial<Level> = {}, lock?: [number, number]): Level {
  const cells: Level['cells'] = [{ q: 0, r: 0, gem: false, start: true }];
  D.forEach(([q, r], d) => cells.push({ q, r, gem: gemDirs.includes(d) }));
  if (lock) cells[lock[0]].lock = lock[1];
  return { id: 'g', cells, walls: [], ...extra };
}

describe('game actions', () => {
  it('a mistake does not change the board', () => {
    const g = newGame(level([0, 1]), 0);
    const before = Uint8Array.from(g.state);
    const r = act(g, 1, 'reveal', 1); // cell 1 is a crystal
    expect(r.ok).toBe(false);
    expect(r.illegal).toBeFalsy();
    expect(g.mistakes).toBe(1);
    expect(g.moves).toBe(0);
    expect(g.state).toEqual(before);
    const r2 = act(g, 3, 'mark', 1); // cell 3 is safe
    expect(r2.ok).toBe(false);
    expect(g.mistakes).toBe(2);
    expect(g.marked).toBe(0);
    expect(stars(g)).toBe(2);
  });

  it('correct moves reveal / mark and finish the level', () => {
    const g = newGame(level([0]), 0);
    expect(act(g, 1, 'mark', 1).ok).toBe(true);
    expect(g.state[1]).toBe(CellState.Marked);
    for (let i = 2; i <= 6; i++) expect(act(g, i, 'reveal', 2).ok).toBe(true);
    expect(g.finishedAt).toBe(2);
    expect(stars(g)).toBe(3);
    expect(act(g, 1, 'mark', 3).illegal).toBe(true);
  });

  it('locks open once enough crystals are marked', () => {
    const g = newGame(level([0, 1], {}, [4, 2]), 0);
    expect(isLocked(g, 4)).toBe(true);
    expect(lockRemaining(g, 4)).toBe(2);
    expect(act(g, 4, 'reveal').illegal).toBe(true);
    expect(knownVals(g)[4]).toBe(0); // the solver knows a locked cell is safe
    expect(act(g, 1, 'mark').opened).toEqual([]);
    expect(lockRemaining(g, 4)).toBe(1);
    const r = act(g, 2, 'mark');
    expect(r.opened).toEqual([4]);
    expect(g.state[4]).toBe(CellState.Revealed);
    expect(activeConstraints(g).some((c) => c.src.type === 'cell' && c.src.cell === 4)).toBe(true);
  });

  it('chord on a satisfied clue reveals the rest, on a full clue marks the rest', () => {
    const g = newGame(level([0, 1]), 0);
    expect(chordMoves(g, 0)).toEqual([]);
    act(g, 1, 'mark');
    act(g, 2, 'mark');
    const m = chordMoves(g, 0);
    expect(m.map((x) => x.cell).sort()).toEqual([3, 4, 5, 6]);
    expect(m.every((x) => x.action === 'reveal')).toBe(true);

    const g2 = newGame(level([0, 1, 2, 3, 4, 5]), 0);
    act(g2, 1, 'mark');
    const m2 = chordMoves(g2, 0);
    expect(m2).toHaveLength(5);
    expect(m2.every((x) => x.action === 'mark')).toBe(true);
  });

  it('active constraints: counter always, clues once open', () => {
    const g = newGame(level([0], { zones: [{ cells: [1, 2] }], links: [{ a: 3, b: 4, same: true }] }), 0);
    const kinds = activeConstraints(g).map((c) => c.src.type).sort();
    expect(kinds).toEqual(['cell', 'global', 'link', 'zone']);
  });

  it('fog: only cells some visible information points at can be played', () => {
    // a line of 4 hexes: start at the end; its number covers only the next hex
    const L: Level = { id: 'f', walls: [], cells: [0, 1, 2, 3].map((r) => ({ q: 0, r, gem: r === 3, start: r === 0 })) };
    const g = newGame(L, 0);
    expect([...visibleCells(g)]).toEqual([1, 1, 0, 0]);
    expect(act(g, 2, 'reveal').illegal).toBe(true);
    expect(act(g, 1, 'reveal').ok).toBe(true);
    expect([...visibleCells(g)]).toEqual([1, 1, 1, 0]);
    expect(act(g, 2, 'reveal').ok).toBe(true);
    expect(act(g, 3, 'mark').won).toBe(true);
    const nofog = newGame({ ...L, fog: false }, 0);
    expect([...visibleCells(nofog)]).toEqual([1, 1, 1, 1]);
  });

  it('classic mode: danger, then a rewind of the last correct moves', () => {
    const L: Level = { id: 'c', walls: [], fog: false, cells: Array.from({ length: 12 }, (_, r) => ({ q: 0, r, gem: r % 4 === 3, start: r === 0 })) };
    const g = newGame(L, { mode: 'classic', now: 0 });
    expect(act(g, 1, 'mark').danger).toBe(true); // mistake: 1 is safe
    expect(g.danger).toBe(DANGER_MOVES);
    expect(g.mistakes).toBe(1);
    for (const i of [1, 2]) expect(act(g, i, 'reveal').ok).toBe(true);
    expect(act(g, 3, 'mark').ok).toBe(true);
    expect(g.marked).toBe(1);
    const r = act(g, 4, 'mark'); // second mistake while in danger
    expect(r.ok).toBe(false);
    expect(r.rewound!.sort()).toEqual([1, 2, 3]);
    expect(g.marked).toBe(0);
    expect(g.state[1]).toBe(CellState.Hidden);
    expect(g.history).toHaveLength(0);
  });

  it('hardcore mode asks for a restart', () => {
    const g = newGame(level([0]), { mode: 'hardcore' });
    expect(act(g, 1, 'reveal').restart).toBe(true);
    const gentle = newGame(level([0]));
    expect(act(gentle, 1, 'reveal').restart).toBeFalsy();
  });

  it('rotate cycles the phase; information of every phase is known', () => {
    const L = level([1]);
    L.walls = [[0, 0, 0]];
    L.cells[0].rot = [0, 1];
    const g = newGame(L, 0);
    expect(g.board.period).toBe(2);
    rotate(g);
    expect(g.phase).toBe(1);
    rotate(g);
    expect(g.phase).toBe(0);
    // N (index 1) is safe; the crystal sits at NE (index 2)
    act(g, 1, 'reveal');
    const fromN = activeConstraints(g).filter((c) => c.src.type === 'cell' && c.src.cell === 1);
    expect(fromN).toHaveLength(2); // the wall next to it moves away in phase 1
  });
});
