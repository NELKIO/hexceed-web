// Handmade sample levels: one small board per mechanic. Used until the generated campaign
// (src/levels/campaign.json + src/levels/worlds.ts) is present, and by the tutorial.
// Coordinates in the specs are "column,row" offsets (odd columns sit half a hex lower);
// they are converted to axial (q, r) here. Every level is checked by a logic-only solver.

import type { Clue, Level, LevelCell, MechanicId, Wall } from '../core/types';

interface Spec {
  id: string;
  title: string;
  w: number;
  h: number;
  holes?: string[];
  gems: string[];
  clues?: Record<string, Clue>;
  start: string[];
  locks?: Record<string, number>;
  walls?: [string, number][];
  links?: [string, string, boolean][];
  zones?: string[][];
  teach?: MechanicId[];
  diff?: number;
  fog?: boolean;
  /** Big cells: owner hex -> its extra hexes (removed as separate cells). */
  big?: Record<string, string[]>;
  portals?: [string, number][];
  rot?: Record<string, number[]>;
  alt?: Record<string, Clue[]>;
}

const ax = (s: string): [number, number] => {
  const [c, row] = s.split(',').map(Number);
  return [c, row - Math.floor(c / 2)];
};

function build(s: Spec): Level {
  const holes = new Set(s.holes ?? []);
  for (const ex of Object.values(s.big ?? {})) for (const k of ex) holes.add(k);
  const gems = new Set(s.gems);
  const start = new Set(s.start);
  const cells: LevelCell[] = [];
  const idx = new Map<string, number>();
  for (let c = 0; c < s.w; c++)
    for (let row = 0; row < s.h; row++) {
      const k = `${c},${row}`;
      if (holes.has(k)) continue;
      const [q, r] = ax(k);
      const cell: LevelCell = { q, r, gem: gems.has(k) };
      const clue = s.clues?.[k];
      if (clue) cell.clue = clue;
      if (start.has(k)) cell.start = true;
      const lock = s.locks?.[k];
      if (lock) cell.lock = lock;
      if (s.big?.[k]) cell.extra = s.big[k].map(ax);
      if (s.rot?.[k]) cell.rot = s.rot[k];
      if (s.alt?.[k]) cell.alt = s.alt[k];
      idx.set(k, cells.length);
      cells.push(cell);
    }
  const walls: Wall[] = (s.walls ?? []).map(([k, d]) => {
    const [q, r] = ax(k);
    return [q, r, d];
  });
  const level: Level = { id: s.id, title: s.title, cells, walls, teach: s.teach, diff: s.diff, fog: s.fog ?? false };
  if (s.links) level.links = s.links.map(([a, b, same]) => ({ a: idx.get(a)!, b: idx.get(b)!, same }));
  if (s.portals) level.portals = s.portals.map(([k, d]) => {
    const [q, r] = ax(k);
    return [q, r, d];
  });
  if (s.zones) level.zones = s.zones.map((z) => ({ cells: z.map((k) => idx.get(k)!) }));
  return level;
}

const line = (...dirs: number[]): Clue => ({ k: 'line', dirs });
const cone = (...dirs: number[]): Clue => ({ k: 'cone', dirs });
const radius: Clue = { k: 'radius' };
const eye: Clue = { k: 'eye' };
const par: Clue = { k: 'parity' };
const blank: Clue = { k: 'blank' };
const ring: Clue = { k: 'ring' };
const donut: Clue = { k: 'donut' };
const tri = (...dirs: number[]): Clue => ({ k: 'triangle', dirs });
const tog: Clue = { k: 'num', mod: 'together' };
const apa: Clue = { k: 'num', mod: 'apart' };

const SPECS: Spec[] = [
  {
    id: 's01',
    title: 'Первые шаги',
    w: 4,
    h: 5,
    gems: ['0,1', '1,3', '2,0', '3,2', '2,4'],
    start: ['0,0', '1,1', '0,3'],
    teach: ['basic', 'counter'],
    diff: 1,
  },
  {
    id: 's02',
    title: 'Стены',
    w: 5,
    h: 5,
    gems: ['0,0', '1,2', '2,1', '3,3', '4,0', '2,4', '4,4'],
    walls: [['1,1', 2], ['1,1', 3], ['2,2', 3], ['3,2', 4], ['3,1', 1], ['2,3', 2]],
    start: ['4,2', '0,1'],
    teach: ['walls'],
    diff: 2,
  },
  {
    id: 's03',
    title: 'Лучи',
    w: 5,
    h: 6,
    gems: ['0,2', '1,0', '2,3', '3,1', '4,4', '1,5', '3,5'],
    clues: { '2,0': line(3), '0,4': line(1), '4,1': line(4), '2,5': line(0), '0,0': line(2), '4,5': line(5) },
    start: ['4,5', '4,0', '2,0', '1,2', '0,5'],
    teach: ['line'],
    diff: 2,
  },
  {
    id: 's04',
    title: 'Острова',
    w: 5,
    h: 6,
    holes: ['2,2', '1,3', '3,3', '2,4'],
    gems: ['0,1', '1,0', '2,3', '4,2', '0,4', '3,5', '4,0'],
    clues: { '2,0': line(3), '0,2': line(2, 1), '4,4': line(5, 0), '2,5': line(0), '1,1': line(2) },
    start: ['0,0', '2,1', '3,4', '4,5'],
    teach: ['gaps', 'multiline'],
    diff: 3,
  },
  {
    id: 's05',
    title: 'Круги',
    w: 5,
    h: 6,
    gems: ['0,0', '1,2', '3,1', '2,4', '4,3', '0,5', '4,5'],
    clues: { '2,2': radius, '1,4': radius, '3,3': radius, '1,2': radius, '4,3': radius },
    start: ['2,0', '4,0', '0,1'],
    teach: ['radius', 'gemclue'],
    diff: 3,
  },
  {
    id: 's06',
    title: 'Конусы',
    w: 5,
    h: 6,
    gems: ['1,1', '3,0', '2,3', '4,2', '0,4', '3,5', '1,5'],
    clues: { '0,0': cone(1), '4,0': cone(3), '0,3': cone(0, 1), '4,5': cone(4), '2,1': cone(2, 3) },
    start: ['4,4', '0,5', '1,4'],
    teach: ['cone'],
    diff: 3,
  },
  {
    id: 's07',
    title: 'Замки',
    w: 5,
    h: 5,
    gems: ['0,1', '1,3', '2,0', '3,2', '4,4', '0,4', '4,0'],
    locks: { '2,2': 3, '1,1': 1, '3,4': 5 },
    clues: { '2,2': radius },
    start: ['0,0', '1,0'],
    teach: ['lock'],
    diff: 3,
  },
  {
    id: 's08',
    title: 'Вместе и врозь',
    w: 5,
    h: 6,
    gems: ['1,1', '2,1', '0,3', '3,3', '3,4', '1,5', '4,1'],
    clues: { '1,0': tog, '2,2': tog, '2,4': tog, '4,4': tog, '0,2': apa, '1,2': apa, '3,1': apa, '2,5': apa },
    start: ['0,0', '0,2'],
    teach: ['together', 'apart'],
    diff: 4,
  },
  {
    id: 's09',
    title: 'Глаз',
    w: 5,
    h: 6,
    gems: ['0,0', '2,1', '4,1', '1,3', '3,4', '0,5', '4,5'],
    clues: { '2,3': eye, '1,1': eye, '3,2': eye, '2,5': eye, '0,3': eye },
    start: ['4,3', '0,2'],
    teach: ['eye'],
    diff: 4,
  },
  {
    id: 's10',
    title: 'Чёт и нечет',
    w: 5,
    h: 6,
    gems: ['1,0', '0,2', '2,2', '4,1', '3,4', '1,4', '4,5'],
    clues: { '1,1': par, '3,2': par, '2,4': par, '0,4': par, '2,0': par, '4,3': par },
    start: ['0,0', '0,1', '1,1', '0,3', '0,5'],
    teach: ['parity'],
    diff: 4,
  },
  {
    id: 's12',
    title: 'Нити',
    w: 5,
    h: 6,
    gems: ['1,0', '3,1', '0,3', '2,3', '4,4', '1,5', '4,0'],
    links: [
      ['1,0', '3,1', true],
      ['0,3', '2,2', false],
      ['4,4', '2,5', false],
      ['3,3', '4,2', true],
    ],
    start: ['3,4', '1,4'],
    teach: ['link'],
    diff: 4,
  },
  {
    id: 's13',
    title: 'Зоны',
    w: 5,
    h: 6,
    gems: ['0,0', '1,2', '3,1', '2,4', '4,3', '0,5', '3,5'],
    zones: [
      ['0,0', '1,0', '0,1', '1,1'],
      ['3,3', '4,3', '3,4', '4,4', '4,2'],
      ['1,4', '1,5', '0,4', '0,5'],
    ],
    clues: { '2,2': blank, '2,0': blank, '4,0': blank },
    start: ['0,1', '1,1', '0,3', '1,4'],
    teach: ['zone', 'blank'],
    diff: 4,
  },
  {
    id: 's14',
    title: 'Всё вместе',
    w: 6,
    h: 7,
    holes: ['2,3', '3,3'],
    gems: ['0,1', '1,0', '2,2', '4,1', '5,3', '3,5', '1,4', '0,6', '4,6', '5,0'],
    walls: [['1,2', 2], ['4,2', 4], ['2,5', 1]],
    clues: { '0,3': line(2), '5,5': radius, '2,0': cone(2), '3,1': apa, '4,5': tog, '4,4': eye, '1,6': par },
    links: [['0,6', '4,6', true]],
    zones: [['2,5', '2,6', '3,6']],
    locks: { '3,4': 4 },
    start: ['0,0', '0,2'],
    diff: 5,
  },
  {
    id: 's15',
    title: 'Туман и кольца',
    w: 5,
    h: 6,
    fog: true,
    gems: ['1,0', '3,1', '0,3', '2,3', '4,4', '1,5', '4,0'],
    clues: { '2,2': ring, '2,4': donut, '0,1': ring, '4,2': radius, '3,5': ring },
    start: ['0,0', '1,1'],
    teach: ['fog', 'ring', 'donut'],
    diff: 4,
  },
  {
    id: 's16',
    title: 'Треугольники и точки',
    w: 5,
    h: 6,
    fog: true,
    gems: ['0,1', '2,0', '1,3', '3,2', '4,4', '2,5', '0,5'],
    clues: { '0,0': tri(2), '4,1': { k: 'dot', dirs: [3, 4] }, '2,2': { k: 'dot', dirs: [0, 3], corner: true }, '4,5': tri(4), '1,1': tri(2, 3) },
    start: ['0,0', '1,0', '1,4'],
    teach: ['triangle', 'dot'],
    diff: 4,
  },
  {
    id: 's17',
    title: 'Вихри',
    w: 5,
    h: 6,
    fog: true,
    gems: ['1,1', '3,0', '2,3', '4,2', '0,4', '3,5', '1,5'],
    clues: { '1,2': { k: 'swirl', dirs: [1] }, '3,3': { k: 'swirl', dirs: [4], ccw: true }, '0,2': { k: 'swirl', dirs: [2] }, '4,4': { k: 'swirl', dirs: [5] } },
    start: ['1,2', '0,3', '0,0'],
    teach: ['swirl'],
    diff: 4,
  },
  {
    id: 's18',
    title: 'Острова и цепи',
    w: 5,
    h: 6,
    fog: true,
    gems: ['0,0', '1,0', '3,1', '2,3', '2,4', '4,5', '0,5'],
    walls: [['1,2', 2], ['1,2', 3], ['2,2', 3], ['3,2', 3], ['3,2', 2], ['0,2', 3]],
    clues: { '0,1': { k: 'chain' }, '4,0': { k: 'island' }, '1,4': { k: 'chain' }, '3,4': { k: 'island' }, '2,1': { k: 'chain' } },
    start: ['0,2', '1,4'],
    teach: ['island', 'chain'],
    diff: 5,
  },
  {
    id: 's19',
    title: 'Большие клетки',
    w: 5,
    h: 6,
    fog: true,
    gems: ['0,0', '3,1', '1,4', '4,4', '2,5', '4,0'],
    big: { '1,1': ['2,1', '1,2'], '3,3': ['3,4', '2,4'] },
    start: ['2,3'],
    teach: ['big'],
    diff: 3,
  },
  {
    id: 's20',
    title: 'Порталы',
    w: 5,
    h: 6,
    fog: true,
    holes: ['2,2', '2,3'],
    gems: ['0,1', '1,3', '3,2', '4,4', '2,0', '1,5'],
    portals: [['2,1', 3], ['2,4', 0], ['1,2', 2], ['3,3', 5]],
    start: ['4,0', '2,1', '0,0'],
    teach: ['portal'],
    diff: 4,
  },
  {
    id: 's21',
    title: 'Поворот',
    w: 5,
    h: 6,
    fog: true,
    gems: ['1,0', '3,1', '0,3', '2,4', '4,3', '1,5'],
    walls: [['2,2', 0], ['2,2', 2]],
    rot: { '2,2': [0, 2, 4], '1,3': [0, 1, 2, 3, 4, 5] },
    alt: { '3,3': [{ k: 'radius' }], '1,1': [{ k: 'line', dirs: [3] }] },
    clues: { '1,3': { k: 'line', dirs: [1] } },
    start: ['1,3'],
    teach: ['rotate', 'switch'],
    diff: 5,
  },
];

export const SAMPLE_SPECS = SPECS;
export const SAMPLES: Level[] = SPECS.map(build);
export { build as buildSample };
