// Hint wording (src/ui/game/explain.ts): every hint type on small handmade boards, with the exact
// Russian and English sentence — cases, plurals, numbers, and no clue name lost or duplicated.

import { afterAll, describe, expect, it } from 'vitest';
import { act, newGame, rotate, type Game } from '../src/core/game';
import { cellConstraints, globalConstraint, zoneConstraint, type Constraint } from '../src/core/rules';
import { nextDeduction } from '../src/core/solver';
import { CellState, type Level, type LevelCell } from '../src/core/types';
import { setLang } from '../src/i18n';
import { explain } from '../src/ui/game/explain';
import type { Deduction } from '../src/ui/engine';

afterAll(() => setLang('ru'));

/** Both languages at once: [ru, en]. */
function both(f: () => string): [string, string] {
  setLang('ru');
  const ru = f();
  setLang('en');
  const en = f();
  setLang('ru');
  return [ru, en];
}

const unknown = (n: number) => new Int8Array(n).fill(-1);

/** Cells far apart (no adjacency): only zones and the counter talk about them. */
function zoneLevel(gems: boolean[], zones: number[][]): Level {
  const cells: LevelCell[] = gems.map((gem, i) => ({ q: i * 3, r: 0, gem, clue: { k: 'blank' } }));
  return { id: 'z', cells, walls: [], fog: false, zones: zones.map((cells) => ({ cells })) };
}

/** Known values from a game state (as the game screen passes them). */
function valsOf(g: Game): Int8Array {
  const v = unknown(g.board.n);
  for (let i = 0; i < g.board.n; i++) v[i] = g.state[i] === CellState.Revealed ? 0 : g.state[i] === CellState.Marked ? 1 : -1;
  return v;
}

describe('hint wording', () => {
  it('three clues with the same name are grouped (×3), not merged into one', () => {
    // a+b=1, b+c=1, a+c+d=1: needs all three zones (tier 3); every zone reads «Зона 1»
    const level = zoneLevel([false, true, false, true], [[0, 1], [1, 2], [0, 2, 3]]);
    const g = newGame(level);
    const z = level.zones!.map((_, k) => zoneConstraint(g.board, k));
    const d = nextDeduction(g.board, unknown(4), z)!;
    expect(d.tier).toBe(3);
    expect(d.reasons).toHaveLength(3);
    const cell = d.gem ? ['огонёк', 'a light'] : ['пусто', 'empty'];
    expect(both(() => explain(g, d, unknown(4)))).toEqual([
      `Сопоставь Зону 1 ×3: только так всё сходится — здесь ${cell[0]}`,
      `Match Zone 1 ×3: only then everything fits — this is ${cell[1]}`,
    ]);
  });

  it('different names are all listed; more than five end in «ещё N»', () => {
    const level = zoneLevel([true, true, true, true, true, true, true, false], [[0], [0, 1], [0, 1, 2], [0, 1, 2, 3], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4, 5]]);
    const g = newGame(level);
    const reasons = level.zones!.map((_, k) => zoneConstraint(g.board, k));
    const d: Deduction = { cell: 7, gem: false, reasons, tier: 3 };
    expect(both(() => explain(g, d, unknown(8)))).toEqual([
      'Сопоставь Зону 1, Зону 2, Зону 3, Зону 4 и ещё 2: только так всё сходится — здесь пусто',
      'Match Zone 1, Zone 2, Zone 3, Zone 4 and 2 more: only then everything fits — this is empty',
    ]);
    // five or fewer: all names, joined with «и»
    const three: Deduction = { cell: 7, gem: false, reasons: reasons.slice(0, 3), tier: 3 };
    expect(both(() => explain(g, three, unknown(8)))[0]).toBe('Сопоставь Зону 1, Зону 2 и Зону 3: только так всё сходится — здесь пусто');
  });

  it('two clues that read the same: «обе подсказки», not «Зону 1 и Зону 1»', () => {
    const level = zoneLevel([true, false, false], [[0, 1], [0, 2]]);
    const g = newGame(level);
    const reasons = [zoneConstraint(g.board, 0), zoneConstraint(g.board, 1)];
    const d: Deduction = { cell: 1, gem: false, reasons, tier: 2 };
    expect(both(() => explain(g, d, unknown(3)))).toEqual([
      'Сравни обе подсказки «Зона 1»: вместе они показывают, что здесь пусто',
      'Compare both “Zone 1” clues: together they show this is empty',
    ]);
  });

  it('counter + one area: how many lights are left inside and outside', () => {
    // 2 lights in all, the zone {0,1,2} holds both: cell 3 (outside) is empty
    const level = zoneLevel([true, true, false, false], [[0, 1, 2]]);
    const g = newGame(level);
    const cons = [globalConstraint(g.board), zoneConstraint(g.board, 0)];
    const d = nextDeduction(g.board, unknown(4), cons)!;
    expect(d).toMatchObject({ cell: 3, gem: false });
    expect(d.reasons).toHaveLength(2);
    expect(both(() => explain(g, d, unknown(4)))).toEqual([
      'Всего осталось 2 огонька; Зона 2 забирает 2 — снаружи остаётся 0. Здесь пусто',
      '2 lights left in all; Zone 2 takes 2 of them, so 0 remain outside. This is empty',
    ]);
    // one light already lit: the numbers count what is still missing
    act(g, 0, 'mark');
    const v = valsOf(g);
    const d2 = nextDeduction(g.board, v, cons)!;
    expect(d2).toMatchObject({ cell: 3, gem: false });
    expect(both(() => explain(g, d2, v))[0]).toBe('Всего осталось 1 огонёк; Зона 2 забирает 1 — снаружи остаётся 0. Здесь пусто');
  });

  it('a bright light names its area kind: «Яркий огонёк (круг) 7»', () => {
    // the centre is a lit cell with a radius clue; 7 of the 18 hexes around it are lights
    const cells: LevelCell[] = [{ q: 0, r: 0, gem: true, clue: { k: 'radius' } }];
    let lights = 0;
    for (let q = -2; q <= 2; q++)
      for (let r = -2; r <= 2; r++) {
        const s = -q - r;
        if (Math.abs(s) > 2 || (q === 0 && r === 0)) continue;
        cells.push({ q, r, gem: lights++ < 7, clue: { k: 'blank' } });
      }
    const level: Level = { id: 'gc', cells, walls: [], fog: false };
    const g = newGame(level);
    for (let i = 0; i < cells.length; i++) if (cells[i].gem) act(g, i, 'mark');
    const v = valsOf(g);
    const [c] = cellConstraints(g.board, 0);
    expect(c.value).toBe(7);
    const safe = cells.findIndex((x) => !x.gem);
    const d: Deduction = { cell: safe, gem: false, reasons: [c], tier: 1 };
    expect(both(() => explain(g, d, v))).toEqual([
      'Яркий огонёк (круг) 7 уже видит 7 огоньков — остальные клетки пусты',
      'Bright light (circle) 7 already sees 7 lights — the other hexes are empty',
    ]);
  });

  it('a clue shown in another rotation phase says so', () => {
    // a rotating ray: phase 0 looks north, phase 1 north-east (2 cells each way)
    const cells: LevelCell[] = [
      { q: 0, r: 0, gem: false, start: true, clue: { k: 'line', dirs: [0] }, rot: [0, 1] },
      { q: 0, r: -1, gem: true, clue: { k: 'blank' } },
      { q: 0, r: -2, gem: false, clue: { k: 'blank' } },
      { q: 1, r: -1, gem: false, clue: { k: 'blank' } },
      { q: 2, r: -2, gem: false, clue: { k: 'blank' } },
    ];
    const level: Level = { id: 'rot', cells, walls: [], fog: false };
    const g = newGame(level);
    const [later] = cellConstraints(g.board, 0, 1); // the north-east ray, seen after a turn
    expect(later.value).toBe(0);
    const d: Deduction = { cell: 3, gem: false, reasons: [later], tier: 1 };
    expect(both(() => explain(g, d, valsOf(g)))).toEqual([
      'Луч 0 (видно после поворота): на луче нет огоньков — все клетки на луче пусты',
      'Line 0 (shown after a rotation): no lights on the line — every hex on it is empty',
    ]);
    // after the turn the same clue is on screen: no note
    rotate(g);
    expect(both(() => explain(g, d, valsOf(g)))[0]).toBe('Луч 0: на луче нет огоньков — все клетки на луче пусты');
  });

  it('a contradiction chain names every clue, the breaking one last, with the right verb', () => {
    const level = zoneLevel([true, false, false, true], [[0, 1], [1, 2], [2, 3], [0, 3]]);
    const g = newGame(level);
    const z = level.zones!.map((_, k) => zoneConstraint(g.board, k));
    // values: zone1 = 1, zone2 = 0, zone3 = 1, zone4 = 2
    const one: Deduction = { cell: 1, gem: false, reasons: [z[1], z[3]], tier: 4 };
    expect(both(() => explain(g, one, unknown(4)))).toEqual([
      'Допустим, здесь огонёк. Тогда Зона 0 требует своего, и Зона 2 уже не сходится — значит, здесь пусто',
      'Suppose this were a light. Then Zone 0 forces its cells, and Zone 2 no longer fits — so it is empty',
    ]);
    const many: Deduction = { cell: 1, gem: false, reasons: [z[0], z[2], z[1], z[3]], tier: 4 };
    expect(both(() => explain(g, many, unknown(4)))[0]).toBe(
      'Допустим, здесь огонёк. Тогда Зона 1 ×2 и Зона 0 требуют своего, и Зона 2 уже не сходится — значит, здесь пусто',
    );
    const single: Deduction = { cell: 1, gem: true, reasons: [z[0]], tier: 4 };
    expect(both(() => explain(g, single, unknown(4)))[0]).toBe('Допустим, здесь пусто. Тогда Зона 1 не сходится — значит, здесь огонёк');
  });

  it('single clues: all found, fill, zero, counter', () => {
    // a number in the middle of a full ring; neighbours 0 and 1 are lights
    const cells: LevelCell[] = [{ q: 0, r: 0, gem: false, start: true }];
    [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0]].forEach(([q, r], i) => cells.push({ q, r, gem: i < 2, clue: { k: 'blank' } }));
    const g = newGame({ id: 'n', cells, walls: [], fog: false });
    const [c] = cellConstraints(g.board, 0);
    act(g, 1, 'mark');
    act(g, 2, 'mark');
    let v = valsOf(g);
    expect(both(() => explain(g, { cell: 3, gem: false, reasons: [c], tier: 1 }, v))).toEqual([
      'Число 2 уже видит 2 огонька — остальные клетки пусты',
      'Number 2 already sees 2 lights — the other hexes are empty',
    ]);
    // fill: 2 lights missing on exactly 2 closed hexes
    const g2 = newGame({ id: 'n2', cells, walls: [], fog: false });
    for (const i of [3, 4, 5, 6]) act(g2, i, 'reveal');
    v = valsOf(g2);
    expect(both(() => explain(g2, { cell: 1, gem: true, reasons: [c], tier: 1 }, v))[0]).toBe(
      'Число 2: рядом не хватает 2 огоньков, и закрытых клеток там ровно 2 — здесь огонёк',
    );
    // the counter alone
    const g3 = newGame({ id: 'n3', cells, walls: [], fog: false });
    act(g3, 1, 'mark');
    act(g3, 2, 'mark');
    expect(both(() => explain(g3, { cell: 3, gem: false, reasons: [globalConstraint(g3.board)], tier: 1 }, valsOf(g3)))).toEqual([
      'Счётчик: все огоньки найдены — остальное пусто',
      'Counter: every light is found — the rest is empty',
    ]);
  });

  it('zones and area clues get their own words (no «рядом» for a zone, no «её» for «Круг»)', () => {
    const level = zoneLevel([false, false, true, false], [[0, 1], [2, 3]]);
    const g = newGame(level);
    const [z0, z1] = [zoneConstraint(g.board, 0), zoneConstraint(g.board, 1)];
    expect(both(() => explain(g, { cell: 0, gem: false, reasons: [z0], tier: 1 }, unknown(4)))).toEqual([
      'Зона 0: в зоне нет огоньков — все её клетки пусты',
      'Zone 0: no lights in the zone — all its hexes are empty',
    ]);
    const v = unknown(4);
    v[3] = 0;
    expect(both(() => explain(g, { cell: 2, gem: true, reasons: [z1], tier: 1 }, v))[0]).toBe('Зона 1: в зоне не хватает 1 огонька, и закрытых клеток там ровно 1 — здесь огонёк');
    // an area clue (radius) with nothing in it
    const cells: LevelCell[] = [{ q: 0, r: 0, gem: false, start: true, clue: { k: 'radius' } }];
    [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0]].forEach(([q, r]) => cells.push({ q, r, gem: false, clue: { k: 'blank' } }));
    const g2 = newGame({ id: 'rad', cells, walls: [], fog: false });
    const [c] = cellConstraints(g2.board, 0);
    expect(both(() => explain(g2, { cell: 1, gem: false, reasons: [c], tier: 1 }, valsOf(g2)))).toEqual([
      'Круг 0: в области подсказки нет огоньков — все эти клетки пусты',
      'Circle 0: no lights in the clue’s area — all those hexes are empty',
    ]);
  });

  it('the generic sentence keeps the rotation note outside the quotes', () => {
    const cells: LevelCell[] = [
      { q: 0, r: 0, gem: false, start: true, clue: { k: 'parity' }, rot: [0, 1] },
      { q: 0, r: -1, gem: true, clue: { k: 'blank' } },
      { q: 1, r: -1, gem: false, clue: { k: 'blank' } },
    ];
    const g = newGame({ id: 'par', cells, walls: [], fog: false });
    const [c] = cellConstraints(g.board, 0, 1);
    expect(both(() => explain(g, { cell: 2, gem: false, reasons: [c], tier: 1 }, valsOf(g)))[0]).toBe('Нечет (видно после поворота): чётность сойдётся, только если здесь пусто');
    const chain: Constraint = { ...c, kind: 'chain' };
    expect(both(() => explain(g, { cell: 2, gem: false, reasons: [chain], tier: 1 }, valsOf(g)))[0]).toBe('Подсказка «Нечет» (видно после поворота) сходится, только если здесь пусто');
  });
});
