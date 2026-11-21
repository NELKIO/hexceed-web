// Level source adapter. Uses the generated campaign (worlds.ts + campaign.json) when present,
// otherwise falls back to the handmade samples. The UI only talks to this module.

import type { Level, MechanicId } from '../core/types';
import { SAMPLES } from './samples';

export interface WorldDef {
  id: string;
  title: { ru: string; en: string };
  accent: string;
  mechanics: MechanicId[];
  levels: string[];
}

type ExtWorld = Omit<WorldDef, 'mechanics'> & { mechanics?: MechanicId[]; introduces?: MechanicId[] };
const worldMods = import.meta.glob<{ WORLDS?: ExtWorld[] }>('./worlds.ts', { eager: true });
const campMods = import.meta.glob<Level[] | { default: Level[] }>('./campaign.json', { eager: true, import: 'default' });

const SAMPLE_WORLDS: WorldDef[] = [
  { id: 'w-first', title: { ru: 'Первые шаги', en: 'First steps' }, accent: '#ff8a5c', mechanics: ['basic', 'counter', 'walls', 'line', 'gaps', 'multiline'], levels: ['s01', 's02', 's03', 's04'] },
  { id: 'w-mech', title: { ru: 'Механики', en: 'Mechanics' }, accent: '#8b5cf6', mechanics: ['radius', 'gemclue', 'cone', 'lock', 'together', 'apart'], levels: ['s05', 's06', 's07', 's08', 's09'] },
  { id: 'w-work', title: { ru: 'Мастерская', en: 'Workshop' }, accent: '#22b8a8', mechanics: ['eye', 'parity', 'link', 'zone', 'blank'], levels: ['s10', 's12', 's13', 's14'] },
  { id: 'w-v2', title: { ru: 'Туман и чудеса', en: 'Fog & wonders' }, accent: '#4f7cff', mechanics: ['fog', 'ring', 'donut', 'triangle', 'dot', 'swirl', 'island', 'chain', 'big', 'portal', 'rotate', 'switch'], levels: ['s15', 's16', 's17', 's18', 's19', 's20', 's21'] },
];

function pickCampaign(): { worlds: WorldDef[]; levels: Level[]; generated: boolean } {
  const wm = Object.values(worldMods)[0];
  const cm = Object.values(campMods)[0];
  const camp = (Array.isArray(cm) ? cm : (cm as { default?: Level[] } | undefined)?.default) as Level[] | undefined;
  if (wm?.WORLDS?.length && camp?.length) {
    const ids = new Set(camp.map((l) => l.id));
    const worlds: WorldDef[] = wm.WORLDS.map((w) => ({
      id: w.id,
      title: w.title,
      accent: w.accent,
      mechanics: w.mechanics ?? w.introduces ?? [],
      levels: w.levels.filter((id) => ids.has(id)),
    })).filter((w) => w.levels.length);
    if (worlds.length) return { worlds, levels: camp, generated: true };
  }
  return { worlds: SAMPLE_WORLDS, levels: SAMPLES, generated: false };
}

const C = pickCampaign();
const byId = new Map<string, Level>();
for (const l of C.levels) byId.set(l.id, l);
for (const l of SAMPLES) if (!byId.has(l.id)) byId.set(l.id, l);

export const WORLDS: WorldDef[] = C.worlds;
export const CAMPAIGN_IS_GENERATED = C.generated;

export function getLevel(id: string): Level | undefined {
  return byId.get(id);
}

export interface LevelPos {
  world: number;
  index: number; // 0-based inside the world
}

const pos = new Map<string, LevelPos>();
WORLDS.forEach((w, wi) => w.levels.forEach((id, li) => pos.set(id, { world: wi, index: li })));

export function levelPos(id: string): LevelPos | undefined {
  return pos.get(id);
}

/** Campaign order: the level after `id` (crossing into the next world), or null. */
export function nextLevelId(id: string): string | null {
  const p = pos.get(id);
  if (!p) return null;
  const w = WORLDS[p.world];
  if (p.index + 1 < w.levels.length) return w.levels[p.index + 1];
  const nw = WORLDS[p.world + 1];
  return nw ? nw.levels[0] : null;
}

export const UNLOCK_SHARE = 0.7;

export function worldNeeded(wi: number): number {
  const prev = WORLDS[wi - 1];
  return prev ? Math.ceil(prev.levels.length * UNLOCK_SHARE) : 0;
}

/** World unlocked: the previous world has at least 70% of its levels done. */
export function worldUnlocked(wi: number, done: (id: string) => boolean): boolean {
  if (wi <= 0) return true;
  const prev = WORLDS[wi - 1];
  const n = prev.levels.filter(done).length;
  return worldUnlocked(wi - 1, done) && n >= worldNeeded(wi);
}

export function allCampaignIds(): string[] {
  return WORLDS.flatMap((w) => w.levels);
}
