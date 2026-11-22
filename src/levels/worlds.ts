// Campaign world metadata. Level data lives in campaign.json (built by scripts/build-levels.ts).

import type { MechanicId } from '../core/types';

export interface World {
  id: string;
  /** 1-based world number. */
  n: number;
  title: { ru: string; en: string };
  /** Accent colour (hex) for world cards and highlights. */
  accent: string;
  /** Mechanics this world introduces (explainer cards). */
  introduces: MechanicId[];
  /** Ids of the levels in play order (match campaign.json). */
  levels: string[];
}

interface WorldDef {
  id: string;
  title: { ru: string; en: string };
  accent: string;
  introduces: MechanicId[];
  count: number;
}

const DEFS: WorldDef[] = [
  { id: 'first-steps', title: { ru: 'Первые шаги', en: 'First Steps' }, accent: '#3aa6a0', introduces: ['basic', 'counter', 'fog', 'blank'], count: 12 },
  { id: 'walls-islands', title: { ru: 'Стены и пустоты', en: 'Walls & Gaps' }, accent: '#e07a5f', introduces: ['walls', 'gaps'], count: 12 },
  { id: 'rays', title: { ru: 'Лучи', en: 'Rays' }, accent: '#4f86c6', introduces: ['line', 'multiline'], count: 12 },
  { id: 'circles', title: { ru: 'Круги', en: 'Circles' }, accent: '#9b6dd6', introduces: ['radius', 'ring', 'donut'], count: 12 },
  { id: 'cones', title: { ru: 'Конусы', en: 'Cones' }, accent: '#e9a23b', introduces: ['cone', 'triangle'], count: 12 },
  { id: 'locks', title: { ru: 'Замки', en: 'Locks' }, accent: '#d4577b', introduces: ['lock', 'gemclue'], count: 12 },
  { id: 'dots-swirls', title: { ru: 'Точки и вихри', en: 'Dots & Swirls' }, accent: '#2fa58c', introduces: ['dot', 'swirl'], count: 12 },
  { id: 'rotation', title: { ru: 'Вращение', en: 'Rotation' }, accent: '#5b7fd6', introduces: ['rotate', 'switch'], count: 12 },
  { id: 'big-portals', title: { ru: 'Большие соты и порталы', en: 'Big Cells & Portals' }, accent: '#c7663a', introduces: ['big', 'portal'], count: 12 },
  { id: 'island-chain', title: { ru: 'Остров и цепь', en: 'Island & Chain' }, accent: '#6aa84f', introduces: ['island', 'chain'], count: 12 },
  { id: 'together-apart', title: { ru: 'Вместе и врозь', en: 'Together & Apart' }, accent: '#e0703a', introduces: ['together', 'apart'], count: 12 },
  { id: 'eye-parity', title: { ru: 'Глаз и чётность', en: 'Eye & Parity' }, accent: '#2f9bd6', introduces: ['eye', 'parity'], count: 12 },
  { id: 'threads-zones', title: { ru: 'Нити и зоны', en: 'Threads & Zones' }, accent: '#a35bc7', introduces: ['link', 'zone'], count: 12 },
  { id: 'finale', title: { ru: 'Финал', en: 'Finale' }, accent: '#c9a227', introduces: [], count: 12 },
];

export const levelId = (world: number, level: number) =>
  `w${String(world).padStart(2, '0')}-${String(level).padStart(2, '0')}`;

export const WORLDS: World[] = DEFS.map((d, i) => ({
  id: d.id,
  n: i + 1,
  title: d.title,
  accent: d.accent,
  introduces: d.introduces,
  levels: Array.from({ length: d.count }, (_, k) => levelId(i + 1, k + 1)),
}));

/** All mechanics available in world n (1-based): everything introduced so far. */
export function mechanicsUpTo(n: number): MechanicId[] {
  const out: MechanicId[] = [];
  for (const w of WORLDS.slice(0, n)) for (const m of w.introduces) if (!out.includes(m)) out.push(m);
  return out;
}

export function worldOfLevel(id: string): World | undefined {
  return WORLDS.find((w) => w.levels.includes(id));
}
