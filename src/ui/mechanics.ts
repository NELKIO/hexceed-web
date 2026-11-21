// Which mechanics a level uses + tiny demo boards for the explainer cards.

import type { Level, MechanicId } from '../core/types';
import { buildSample } from '../levels/samples';
import type { TKey } from '../i18n';
import { buildBoard } from '../core/rules';

export type Mech = MechanicId;

export const MECH_ORDER: Mech[] = [
  'basic', 'counter', 'fog', 'walls', 'gaps', 'line', 'multiline', 'radius', 'ring', 'donut', 'cone', 'triangle',
  'dot', 'swirl', 'lock', 'gemclue', 'together', 'apart', 'eye', 'parity', 'island', 'chain', 'big', 'portal',
  'rotate', 'switch', 'link', 'zone', 'blank',
];

export const mechTitle = (m: Mech) => `m_${m}` as TKey;
export const mechDesc = (m: Mech) => `m_${m}_d` as TKey;

const CLUE_MECH = new Set(['radius', 'ring', 'donut', 'cone', 'triangle', 'dot', 'swirl', 'island', 'chain', 'eye', 'parity', 'blank']);

export function levelMechanics(level: Level): Mech[] {
  const s = new Set<Mech>(['basic', 'counter']);
  if (level.fog !== false) s.add('fog');
  if (level.walls.length) s.add('walls');
  if (level.links?.length) s.add('link');
  if (level.zones?.length) s.add('zone');
  if (level.portals?.length) s.add('portal');
  for (const c of level.cells) {
    if (c.lock) s.add('lock');
    if (c.extra?.length) s.add('big');
    if (c.rot?.length) s.add('rotate');
    if (c.alt?.length) s.add('switch');
    for (const k of [c.clue, ...(c.alt ?? [])]) {
      if (!k) continue;
      if (c.gem) s.add('gemclue');
      if (k.k === 'line') s.add((k.dirs?.length ?? 1) > 1 ? 'multiline' : 'line');
      else if (CLUE_MECH.has(k.k)) s.add(k.k as Mech);
      if (k.mod) s.add(k.mod);
    }
  }
  // gaps: a missing hex that a straight line could jump (present on two opposite sides)
  try {
    const b = buildBoard(level);
    const has = (q: number, r: number) => b.index.has(`${q},${r}`);
    const B = b.bounds;
    outer: for (let q = B.minQ; q <= B.maxQ; q++)
      for (let r = B.minR; r <= B.maxR; r++) {
        if (has(q, r)) continue;
        if ((has(q, r - 1) && has(q, r + 1)) || (has(q - 1, r) && has(q + 1, r)) || (has(q + 1, r - 1) && has(q - 1, r + 1))) {
          s.add('gaps');
          break outer;
        }
      }
  } catch {
    /* ignore */
  }
  return MECH_ORDER.filter((m) => s.has(m));
}

/** Mechanics to explain when this level opens: taught ones + detected ones not seen yet. */
export function toExplain(level: Level, seen: string[]): Mech[] {
  const set = new Set(seen);
  const want = new Set<Mech>([...(level.teach ?? []), ...levelMechanics(level)]);
  const fresh = MECH_ORDER.filter((m) => want.has(m) && !set.has(m));
  // keep the first encounter light: taught mechanics first, at most four cards
  const taught = fresh.filter((m) => level.teach?.includes(m));
  return [...taught, ...fresh.filter((m) => !taught.includes(m))].slice(0, 4);
}

export interface Demo {
  level: Level;
  /** Cells revealed/marked from the start (offset keys). */
  focus: string[];
  /** Press "rotate" every beat instead of solving (rotating / switching demos). */
  phases?: boolean;
  /** Lock demo: mark the gems first, then the lock opens. */
  lock?: boolean;
}

const tiny = (spec: Parameters<typeof buildSample>[0]) => buildSample(spec);
const T = (id: string) => ({ id: 'd-' + id, title: '' });

export const DEMOS: Partial<Record<Mech, Demo>> = {
  basic: { level: tiny({ ...T('basic'), w: 3, h: 3, holes: ['0,0', '2,0'], gems: ['1,0', '2,2'], start: ['1,1'] }), focus: ['1,1'] },
  counter: { level: tiny({ ...T('counter'), w: 3, h: 2, gems: ['0,0', '2,1'], start: [] }), focus: [] },
  fog: { level: tiny({ ...T('fog'), w: 5, h: 3, gems: ['1,0', '3,2'], start: ['0,1'], fog: true }), focus: ['0,1'] },
  walls: {
    level: tiny({ ...T('walls'), w: 3, h: 3, holes: ['0,0', '2,0'], gems: ['1,0', '2,2', '0,2'], walls: [['1,1', 2]], start: ['1,1'] }),
    focus: ['1,1'],
  },
  gaps: { level: tiny({ ...T('gaps'), w: 1, h: 5, holes: ['0,2'], gems: ['0,3'], clues: { '0,0': { k: 'line', dirs: [3] } }, start: ['0,0'] }), focus: ['0,0'] },
  line: { level: tiny({ ...T('line'), w: 1, h: 5, gems: ['0,2', '0,4'], clues: { '0,0': { k: 'line', dirs: [3] } }, start: ['0,0'] }), focus: ['0,0'] },
  multiline: { level: tiny({ ...T('ml'), w: 3, h: 4, gems: ['1,0', '2,3', '0,3'], clues: { '1,1': { k: 'line', dirs: [0, 3] } }, start: ['1,1'] }), focus: ['1,1'] },
  radius: { level: tiny({ ...T('radius'), w: 5, h: 5, gems: ['1,1', '3,3', '0,4', '4,0'], clues: { '2,2': { k: 'radius' } }, start: ['2,2'] }), focus: ['2,2'] },
  ring: { level: tiny({ ...T('ring'), w: 5, h: 5, gems: ['1,1', '2,0', '4,3', '0,4'], clues: { '2,2': { k: 'ring' } }, start: ['2,2'] }), focus: ['2,2'] },
  donut: { level: tiny({ ...T('donut'), w: 7, h: 7, gems: ['3,2', '1,1', '5,5', '3,6', '6,3'], clues: { '3,3': { k: 'donut' } }, start: ['3,3'] }), focus: ['3,3'] },
  gemclue: { level: tiny({ ...T('gc'), w: 5, h: 5, gems: ['2,2', '1,1', '3,3'], clues: { '2,2': { k: 'radius' } }, start: [] }), focus: ['2,2'] },
  cone: { level: tiny({ ...T('cone'), w: 4, h: 4, gems: ['1,1', '3,2', '2,3'], clues: { '0,0': { k: 'cone', dirs: [2] } }, start: ['0,0'] }), focus: ['0,0'] },
  triangle: { level: tiny({ ...T('tri'), w: 4, h: 4, gems: ['1,1', '3,2', '2,3'], clues: { '0,0': { k: 'triangle', dirs: [2] } }, start: ['0,0'] }), focus: ['0,0'] },
  dot: { level: tiny({ ...T('dot'), w: 5, h: 5, gems: ['2,0', '1,1', '2,4'], clues: { '2,2': { k: 'dot', dirs: [0, 3] } }, start: ['2,2'] }), focus: ['2,2'] },
  swirl: { level: tiny({ ...T('swirl'), w: 4, h: 4, gems: ['2,0', '3,2', '1,2'], clues: { '1,1': { k: 'swirl', dirs: [1] } }, start: ['1,1'] }), focus: ['1,1'] },
  lock: { level: tiny({ ...T('lock'), w: 3, h: 2, gems: ['0,0', '2,0'], locks: { '1,1': 2 }, start: [] }), focus: [], lock: true },
  together: {
    level: tiny({ ...T('tog'), w: 3, h: 3, holes: ['0,0', '2,0'], gems: ['1,0', '2,1'], clues: { '1,1': { k: 'num', mod: 'together' } }, start: ['1,1'] }),
    focus: ['1,1'],
  },
  apart: {
    level: tiny({ ...T('apa'), w: 3, h: 3, holes: ['0,0', '2,0'], gems: ['1,0', '1,2'], clues: { '1,1': { k: 'num', mod: 'apart' } }, start: ['1,1'] }),
    focus: ['1,1'],
  },
  eye: { level: tiny({ ...T('eye'), w: 5, h: 5, gems: ['2,0', '4,3', '0,3', '2,4'], clues: { '2,2': { k: 'eye' } }, start: ['2,2'] }), focus: ['2,2'] },
  parity: {
    level: tiny({ ...T('par'), w: 3, h: 3, holes: ['0,0', '2,0'], gems: ['1,0', '2,2', '0,1'], clues: { '1,1': { k: 'parity' } }, start: ['1,1'] }),
    focus: ['1,1'],
  },
  island: {
    level: tiny({ ...T('island'), w: 4, h: 3, gems: ['0,2', '1,0', '3,1'], walls: [['1,0', 2], ['1,1', 2], ['1,1', 3], ['1,2', 2]], clues: { '0,0': { k: 'island' } }, start: ['0,0'] }),
    focus: ['0,0'],
  },
  chain: { level: tiny({ ...T('chain'), w: 4, h: 3, gems: ['1,0', '2,0', '2,1', '3,2'], clues: { '0,1': { k: 'chain' } }, start: ['0,1'] }), focus: ['0,1'] },
  big: { level: tiny({ ...T('big'), w: 4, h: 3, gems: ['0,0', '3,2'], big: { '1,1': ['2,1', '1,2'] }, start: ['1,1'] }), focus: ['1,1'] },
  portal: {
    level: tiny({ ...T('portal'), w: 1, h: 5, holes: ['0,2'], gems: ['0,3'], portals: [['0,1', 3], ['0,3', 0]], start: ['0,1'] }),
    focus: ['0,1'],
  },
  rotate: {
    level: tiny({ ...T('rot'), w: 3, h: 3, holes: ['0,0', '2,0'], gems: ['1,0', '2,2'], clues: { '1,1': { k: 'line', dirs: [0] } }, rot: { '1,1': [0, 1, 2, 3, 4, 5] }, start: ['1,1'] }),
    focus: ['1,1'],
    phases: true,
  },
  switch: {
    level: tiny({ ...T('sw'), w: 5, h: 5, gems: ['2,0', '1,1', '4,3'], alt: { '2,2': [{ k: 'radius' }] }, start: ['2,2'] }),
    focus: ['2,2'],
    phases: true,
  },
  link: { level: tiny({ ...T('link'), w: 4, h: 2, gems: ['0,0', '3,1'], links: [['0,0', '3,1', true], ['1,1', '2,0', true]], start: [] }), focus: [] },
  zone: { level: tiny({ ...T('zone'), w: 4, h: 3, gems: ['0,0', '1,1', '3,2'], zones: [['0,0', '1,0', '0,1', '1,1']], start: [] }), focus: [] },
  blank: { level: tiny({ ...T('blank'), w: 3, h: 3, holes: ['0,0', '2,0'], gems: ['1,0'], clues: { '1,1': { k: 'blank' } }, start: ['1,1'] }), focus: ['1,1'] },
};
