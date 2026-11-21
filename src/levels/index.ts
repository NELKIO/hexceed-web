// Level source adapter. Uses the generated campaign (worlds.ts + campaign.json) when present,
// otherwise falls back to the handmade samples. The UI only talks to this module.
//
// campaign.json (~400 KB) is loaded lazily so it never blocks the first paint: world metadata
// (titles, level ids) comes eagerly from worlds.ts, the level data arrives with
// `campaignReady()`. Until then `getLevel()` returns undefined for campaign ids.

import { useEffect, useState } from 'preact/hooks';
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
type CampMod = Level[] | { default: Level[] };
const worldMods = import.meta.glob<{ WORLDS?: ExtWorld[] }>('./worlds.ts', { eager: true });
const campMods = import.meta.glob<CampMod>('./campaign.json', { import: 'default' });

const SAMPLE_WORLDS: WorldDef[] = [
  { id: 'w-first', title: { ru: 'Первые шаги', en: 'First steps' }, accent: '#ff8a5c', mechanics: ['basic', 'counter', 'walls', 'line', 'gaps', 'multiline'], levels: ['s01', 's02', 's03', 's04'] },
  { id: 'w-mech', title: { ru: 'Механики', en: 'Mechanics' }, accent: '#8b5cf6', mechanics: ['radius', 'gemclue', 'cone', 'lock', 'together', 'apart'], levels: ['s05', 's06', 's07', 's08', 's09'] },
  { id: 'w-work', title: { ru: 'Мастерская', en: 'Workshop' }, accent: '#22b8a8', mechanics: ['eye', 'parity', 'link', 'zone', 'blank'], levels: ['s10', 's12', 's13', 's14'] },
  { id: 'w-v2', title: { ru: 'Туман и чудеса', en: 'Fog & wonders' }, accent: '#4f7cff', mechanics: ['fog', 'ring', 'donut', 'triangle', 'dot', 'swirl', 'island', 'chain', 'big', 'portal', 'rotate', 'switch'], levels: ['s15', 's16', 's17', 's18', 's19', 's20', 's21'] },
];

const extWorlds = Object.values(worldMods)[0]?.WORLDS;
const campLoader = Object.values(campMods)[0];
const generated = !!(extWorlds?.length && campLoader);

/** World list (mutated in place once the campaign data arrives, so imports stay valid). */
export const WORLDS: WorldDef[] = generated
  ? extWorlds!.map((w) => ({
      id: w.id,
      title: w.title,
      accent: w.accent,
      mechanics: w.mechanics ?? w.introduces ?? [],
      levels: [...w.levels],
    }))
  : SAMPLE_WORLDS;
export const CAMPAIGN_IS_GENERATED = generated;

const byId = new Map<string, Level>();
for (const l of SAMPLES) byId.set(l.id, l);

export interface LevelPos {
  world: number;
  index: number; // 0-based inside the world
}

const pos = new Map<string, LevelPos>();
function indexPositions(): void {
  pos.clear();
  WORLDS.forEach((w, wi) => w.levels.forEach((id, li) => pos.set(id, { world: wi, index: li })));
}
indexPositions();

let loaded = !generated;
const subs = new Set<() => void>();
let readyP: Promise<void> | null = null;

/** Load the campaign level data (once). Resolves also when loading fails (samples stay). */
export function campaignReady(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (!readyP) {
    readyP = campLoader!()
      .then((m) => {
        const camp = (Array.isArray(m) ? m : (m as { default?: Level[] })?.default) ?? [];
        for (const l of camp) byId.set(l.id, l);
        const ids = new Set(camp.map((l) => l.id));
        for (const w of WORLDS) w.levels = w.levels.filter((id) => ids.has(id));
        for (let k = WORLDS.length - 1; k >= 0; k--) if (!WORLDS[k].levels.length) WORLDS.splice(k, 1);
        if (!WORLDS.length) WORLDS.push(...SAMPLE_WORLDS);
        indexPositions();
      })
      .catch((e) => {
        console.error('campaign failed to load', e);
        WORLDS.splice(0, WORLDS.length, ...SAMPLE_WORLDS);
        indexPositions();
      })
      .finally(() => {
        loaded = true;
        subs.forEach((f) => f());
      });
  }
  return readyP;
}

export function isCampaignLoaded(): boolean {
  return loaded;
}

/** Re-render when the campaign data has arrived (and start loading it). Returns the loaded flag. */
export function useCampaign(): boolean {
  const [, set] = useState(0);
  useEffect(() => {
    if (loaded) return undefined;
    const f = () => set((n) => n + 1);
    subs.add(f);
    void campaignReady();
    return () => void subs.delete(f);
  }, []);
  return loaded;
}

export function getLevel(id: string): Level | undefined {
  return byId.get(id);
}

/** Whether `id` names a campaign/sample level (known before the data is loaded). */
export function isKnownLevel(id: string): boolean {
  return byId.has(id) || pos.has(id);
}

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

// start fetching right after the first paint: by the time the player taps "Play" it is there
if (generated && typeof window !== 'undefined') {
  const kick = () => void campaignReady();
  const ric = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(kick, { timeout: 1500 });
  else setTimeout(kick, 300);
}
