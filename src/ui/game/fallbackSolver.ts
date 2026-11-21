// Small local solver used for hints only while src/core/solver.ts is not available.
// Sound (never deduces something false), not complete: single-constraint tests, then pairs.

import { feasible, type Board, type Constraint } from '../../core/rules';

export interface Deduction {
  cell: number;
  gem: boolean;
  reasons: Constraint[];
  tier: 1 | 2 | 3 | 4;
}

function unknownsOf(c: Constraint, vals: Int8Array): number[] {
  const out: number[] = [];
  for (const j of c.cells) if (vals[j] === -1) out.push(j);
  return out;
}

export function fallbackNextDeduction(_board: Board, vals0: Int8Array, cons: Constraint[]): Deduction | null {
  const vals = Int8Array.from(vals0);
  const live = cons.filter((c) => unknownsOf(c, vals).length > 0);
  // tier 1: one constraint alone
  const small = live.filter((c) => c.src.type !== 'global');
  const global = live.filter((c) => c.src.type === 'global');
  for (const group of [small, global]) {
    for (const c of group) {
      for (const x of unknownsOf(c, vals)) {
        for (const v of [0, 1]) {
          vals[x] = v;
          const ok = feasible(c, vals);
          vals[x] = -1;
          if (!ok) {
            // make sure the other value is possible (otherwise the state is contradictory)
            vals[x] = 1 - v;
            const ok2 = feasible(c, vals);
            vals[x] = -1;
            if (ok2) return { cell: x, gem: v === 0, reasons: [c], tier: 1 };
          }
        }
      }
    }
  }
  // tier 2: pairs of constraints sharing unknown cells (enumerate their union)
  const all = [...small, ...global];
  for (let a = 0; a < all.length; a++) {
    const ua = unknownsOf(all[a], vals);
    for (let b = a + 1; b < all.length; b++) {
      const ub = unknownsOf(all[b], vals);
      if (!ub.some((x) => ua.includes(x))) continue;
      const union = [...new Set([...ua, ...ub])];
      if (union.length > 16) continue;
      const r = enumerate([all[a], all[b]], union, vals);
      if (r) return { ...r, reasons: [all[a], all[b]], tier: 2 };
    }
  }
  // tier 3: triples with small unions
  for (let a = 0; a < small.length; a++)
    for (let b = a + 1; b < small.length; b++)
      for (let c = b + 1; c < all.length; c++) {
        const ua = unknownsOf(small[a], vals), ub = unknownsOf(small[b], vals), uc = unknownsOf(all[c], vals);
        const share = (p: number[], q: number[]) => p.some((x) => q.includes(x));
        if (!(share(ua, ub) || share(ua, uc) || share(ub, uc))) continue;
        const union = [...new Set([...ua, ...ub, ...uc])];
        if (union.length > 14) continue;
        const r = enumerate([small[a], small[b], all[c]], union, vals);
        if (r) return { ...r, reasons: [small[a], small[b], all[c]], tier: 3 };
      }
  return null;
}

function enumerate(cs: Constraint[], cells: number[], vals: Int8Array): { cell: number; gem: boolean } | null {
  const n = cells.length;
  const canBe = cells.map(() => [false, false]);
  let any = false;
  for (let m = 0; m < 1 << n; m++) {
    for (let k = 0; k < n; k++) vals[cells[k]] = (m >> k) & 1;
    let ok = true;
    for (const c of cs) if (!feasible(c, vals)) { ok = false; break; }
    if (ok) {
      any = true;
      for (let k = 0; k < n; k++) canBe[k][(m >> k) & 1] = true;
    }
  }
  for (const x of cells) vals[x] = -1;
  if (!any) return null;
  for (let k = 0; k < n; k++) {
    if (canBe[k][0] !== canBe[k][1]) return { cell: cells[k], gem: canBe[k][1] };
  }
  return null;
}
