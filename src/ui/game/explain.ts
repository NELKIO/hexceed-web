// One-sentence explanations for hints, per constraint kind and tier.

import { effectiveClue, type Constraint } from '../../core/rules';
import { plural, t } from '../../i18n';
import type { Game } from '../../core/game';
import type { Deduction } from '../engine';

export function sourceName(g: Game, c: Constraint): string {
  const v = c.value;
  switch (c.src.type) {
    case 'global':
      return t('src_global');
    case 'zone':
      return t('src_zone', { v });
    case 'link':
      return t('src_link');
    case 'cell': {
      const i = c.src.cell;
      const cell = g.board.level.cells[i];
      const clue = effectiveClue(g.board, i);
      if (!clue) return t('src_num', { v });
      if (cell.gem) return t('src_gemclue', { v });
      switch (clue.k) {
        case 'num':
          return clue.mod === 'together' ? t('src_together', { v }) : clue.mod === 'apart' ? t('src_apart', { v }) : t('src_num', { v });
        case 'line':
          return t('src_line', { v });
        case 'ring':
          return t('src_ring', { v });
        case 'cone':
          return t('src_cone', { v });
        case 'eye':
          return t('src_eye', { v });
        case 'parity':
          return t(v ? 'src_parity_odd' : 'src_parity_even');
        case 'radius':
          return t('src_radius', { v });
        case 'donut':
          return t('src_donut', { v });
        case 'triangle':
          return t('src_triangle', { v });
        case 'dot':
          return t('src_dot', { v });
        case 'swirl':
          return t('src_swirl', { v });
        case 'island':
          return t('src_island', { v });
        case 'chain':
          return t('src_chain', { v });
        default:
          return t('src_num', { v });
      }
    }
  }
}

export function explain(g: Game, d: Deduction, vals: Int8Array): string {
  const cell = t(d.gem ? 'hintGem' : 'hintSafe');
  const other = t(d.gem ? 'hintSafe' : 'hintGem');
  const reasons = d.reasons.length ? d.reasons : [];
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
      if (!c.mod || d.tier > 1) {
        if (need === 0 && !d.gem) return c.value === 0 ? t('h_zeroFound', { src }) : t('h_allFound', { src, v: c.value, gemsWord: plural(c.value, 'gems1', 'gems2', 'gems5') });
        if (need === unk && d.gem) return t('h_fill', { src, need, gemsWord1: plural(need, 'gemsG1', 'gemsG5', 'gemsG5') });
      }
      if (c.mod?.type === 'together') return t(d.gem ? 'h_togetherGem' : 'h_togetherSafe', { src });
      if (c.mod?.type === 'apart') return t(d.gem ? 'h_apartGem' : 'h_apartSafe', { src });
      if (d.tier >= 4) return t('h_tryContra', { other, a: src, cell });
      return t('h_generic', { src, cell });
    }
    if (c.kind === 'eye') return t('h_eye', { src, v: c.value, cellsWord: plural(c.value, 'cells1', 'cells2', 'cells5'), cell });
    if (c.kind === 'parity') return t('h_parity', { src, cell });
    if (c.kind === 'link') return t(c.value ? 'h_linkSame' : 'h_linkDiff', { cell });
    return t('h_generic', { src, cell });
  }
  if (d.tier >= 4 && reasons.length) return t('h_tryContra', { other, a: sourceName(g, reasons[0]), cell });
  if (reasons.length === 2) return t('h_pair', { a: sourceName(g, reasons[0]), b: sourceName(g, reasons[1]), cell });
  if (reasons.length > 2) {
    const names = [...new Set(reasons.map((c) => sourceName(g, c)))];
    return t('h_many', { list: names.slice(0, 4).join(', '), cell });
  }
  return t('h_generic', { src: t('src_global'), cell });
}
