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
  { id: 'first-steps', title: { ru: 'Первые шаги', en: 'First Steps' }, accent: '#3aa6a0', introduces: ['basic', 'counter', 'fog'], count: 12 },
  { id: 'walls-islands', title: { ru: 'Стены и острова', en: 'Walls & Islands' }, accent: '#e07a5f', introduces: ['walls', 'gaps'], count: 12 },
  { id: 'rays', title: { ru: 'Лучи', en: 'Rays' }, accent: '#4f86c6', introduces: ['line', 'multiline'], count: 12 },
  { id: 'circles', title: { ru: 'Круги', en: 'Circles' }, accent: '#9b6dd6', introduces: ['radius'], count: 12 },
  { id: 'rings', title: { ru: 'Кольца', en: 'Rings' }, accent: '#7a5fd0', introduces: ['ring', 'donut'], count: 12 },
  { id: 'cones', title: { ru: 'Конусы', en: 'Cones' }, accent: '#e9a23b', introduces: ['cone', 'triangle'], count: 12 },
  { id: 'dots', title: { ru: 'Точки', en: 'Dots' }, accent: '#2fa58c', introduces: ['dot'], count: 12 },
  { id: 'locks', title: { ru: 'Замки', en: 'Locks' }, accent: '#d4577b', introduces: ['lock'], count: 12 },
  { id: 'rotation', title: { ru: 'Вращение', en: 'Rotation' }, accent: '#5b7fd6', introduces: ['rotate'], count: 12 },
  { id: 'zones', title: { ru: 'Зоны', en: 'Zones' }, accent: '#a35bc7', introduces: ['zone'], count: 12 },
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
