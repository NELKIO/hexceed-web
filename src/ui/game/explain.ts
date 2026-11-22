// One-sentence explanations for hints, per constraint kind and tier.
// Names come from the clue as shown in the constraint's own phase (rotating / switching cells),
// with a note when that phase is not the one on screen.

import { effectiveClue, type Constraint } from '../../core/rules';
import { getLang, plural, t, type TKey } from '../../i18n';
import type { Game } from '../../core/game';
import type { Deduction } from '../engine';

type Case = 'nom' | 'acc';

/** Mechanic title per clue kind (for naming the area of a bright light). */
const KIND_TITLE: Partial<Record<string, TKey>> = {
  line: 'm_line',
  ring: 'm_ring',
  cone: 'm_cone',
  eye: 'm_eye',
  radius: 'm_radius',
  donut: 'm_donut',
  triangle: 'm_triangle',
  dot: 'm_dot',
  swirl: 'm_swirl',
  island: 'm_island',
  chain: 'm_chain',
  parity: 'm_parity',
};

/** Russian accusative of a clue name: feminine "-а" words turn to "-у" (Зона → Зону, Точка → Точку). */
function accRu(name: string): string {
  if (getLang() !== 'ru') return name;
  return name.replace(/^([А-ЯЁа-яё]+)а(?=\s|$|-)/, '$1у');
}

const srcPhase = (c: Constraint): number | undefined => (c.src.type === 'cell' ? c.src.phase : undefined);

function clueOf(g: Game, c: Constraint) {
  if (c.src.type !== 'cell') return undefined;
  return effectiveClue(g.board, c.src.cell, srcPhase(c) ?? g.phase ?? 0);
}

function baseName(g: Game, c: Constraint): string {
  const v = c.value;
  switch (c.src.type) {
    case 'global':
      return t('src_global');
    case 'zone':
      return t('src_zone', { v });
    case 'link':
      return t('src_link');
    case 'cell': {
      const cell = g.board.level.cells[c.src.cell];
      const clue = clueOf(g, c);
      if (!clue) return t('src_num', { v });
      if (cell.gem) {
        // a bright light names its area kind: «Яркий огонёк (круг) 7»
        const kind = clue.k !== 'num' && clue.k !== 'blank' ? KIND_TITLE[clue.k] : undefined;
        return kind ? t('src_gemclueKind', { v, kind: t(kind).toLowerCase() }) : t('src_gemclue', { v });
      }
      switch (clue.k) {
        case 'num':
          return clue.mod === 'together' ? t('src_together', { v }) : clue.mod === 'apart' ? t('src_apart', { v }) : t('src_num', { v });
        case 'parity':
          return t(v ? 'src_parity_odd' : 'src_parity_even');
        case 'line':
        case 'ring':
        case 'cone':
        case 'eye':
        case 'radius':
        case 'donut':
        case 'triangle':
        case 'dot':
        case 'swirl':
        case 'island':
        case 'chain':
          return t(`src_${clue.k}` as TKey, { v });
        default:
          return t('src_num', { v });
      }
    }
  }
}

/** Name of the clue behind a constraint (+ "shown after a rotation" when it is another phase). */
export function sourceName(g: Game, c: Constraint, cs: Case = 'nom'): string {
  const name = cs === 'acc' ? accRu(baseName(g, c)) : baseName(g, c);
  const ph = srcPhase(c);
  const period = (g.board as unknown as { period?: number }).period ?? 1;
  if (ph !== undefined && period > 1 && ph % period !== (g.phase ?? 0) % period) return name + t('phaseNote');
  return name;
}

/** Which words describe the clue's area: neighbours, a ray, or anything else. */
function areaOf(g: Game, c: Constraint): 'num' | 'line' | 'other' {
  const clue = clueOf(g, c);
  if (!clue || clue.k === 'num') return 'num';
  if (clue.k === 'line') return 'line';
  return 'other';
}

function joinList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  const and = getLang() === 'ru' ? ' и ' : ' and ';
  return names.slice(0, -1).join(', ') + and + names[names.length - 1];
}

export function explain(g: Game, d: Deduction, vals: Int8Array): string {
  const cell = t(d.gem ? 'hintGem' : 'hintSafe');
  const other = t(d.gem ? 'hintSafe' : 'hintGem');
  const reasons = d.reasons.length ? d.reasons : [];
  // a contradiction chain: name every clue involved, the last one is the one that breaks
  if (d.tier >= 4 && reasons.length) {
    const names = [...new Set(reasons.map((c) => sourceName(g, c)))].slice(0, 4);
    if (names.length === 1) return t('h_tryContra', { other, a: names[0], cell });
    return t('h_tryChain', { other, list: joinList(names.slice(0, -1)), last: names[names.length - 1], cell });
  }
  if (reasons.length === 1) {
    const c = reasons[0];
    const src = sourceName(g, c);
    let gems = 0, unk = 0;
    for (const j of c.cells) {
      if (vals[j] === 1) gems++;
      else if (vals[j] === -1) unk++;
    }
    const need = c.value - gems;
    if (c.kind === 'sum') {
      if (c.src.type === 'global') {
        if (need === 0) return t('h_counterAll');
        return t('h_counter', { need, gemsWord1: plural(need, 'gems1', 'gems2', 'gems5'), left: unk, cellsWord: plural(unk, 'cells1', 'cells2', 'cells5'), cell });
      }
      const area = areaOf(g, c);
      if (!c.mod || d.tier > 1) {
        if (need === 0 && !d.gem)
          return c.value === 0
            ? t('h_zeroFound', { src, zero: t(`zero_${area}` as TKey) })
            : t('h_allFound', { src, v: c.value, gemsWord: plural(c.value, 'gems1', 'gems2', 'gems5') });
        if (need === unk && d.gem) return t('h_fill', { src, need, gemsWord1: plural(need, 'gemsG1', 'gemsG5', 'gemsG5'), area: t(`area_${area}` as TKey) });
      }
      if (c.mod?.type === 'together') return t(d.gem ? 'h_togetherGem' : 'h_togetherSafe', { src });
      if (c.mod?.type === 'apart') return t(d.gem ? 'h_apartGem' : 'h_apartSafe', { src });
      return t('h_generic', { src, cell });
    }
    if (c.kind === 'eye') return t('h_eye', { src, v: c.value, cellsWord: plural(c.value, 'cells1', 'cells2', 'cells5'), cell });
    if (c.kind === 'parity') return t('h_parity', { src, cell });
    if (c.kind === 'link') return t(c.value ? 'h_linkSame' : 'h_linkDiff', { cell });
    return t('h_generic', { src, cell });
  }
  // the counter with one area clue: how many lights are left inside the area and outside it
  const glob = reasons.find((c) => c.src.type === 'global' && c.kind === 'sum');
  const areas = reasons.filter((c) => c !== glob);
  if (glob && areas.length === 1 && areas[0].kind === 'sum') {
    const left = (c: Constraint) => c.value - c.cells.reduce((n, j) => n + (vals[j] === 1 ? 1 : 0), 0);
    const total = left(glob), inside = left(areas[0]);
    if (total >= inside && inside >= 0)
      return t('h_counterArea', { total, gemsWord: plural(total, 'gems1', 'gems2', 'gems5'), src: sourceName(g, areas[0]), inside, outside: total - inside, cell });
  }
  if (reasons.length === 2) return t('h_pair', { a: sourceName(g, reasons[0], 'acc'), b: sourceName(g, reasons[1], 'acc'), cell });
  if (reasons.length > 2) {
    // every clue counts: equal names are grouped as "Число 1 ×2", never silently merged
    const counts = new Map<string, number>();
    for (const c of reasons) {
      const n = sourceName(g, c, 'acc');
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    const names = [...counts].map(([n, k]) => (k > 1 ? `${n} ×${k}` : n));
    const shown = names.length > 5 ? [...names.slice(0, 4), t('h_more', { n: names.length - 4 })] : names;
    return t('h_many', { list: joinList(shown), cell });
  }
  return t('h_generic', { src: t('src_global'), cell });
}
