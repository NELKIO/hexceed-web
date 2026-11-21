// Builds the campaign: src/levels/campaign.json (compact JSON array of levels).
// Run: npx vite-node scripts/build-levels.ts [--only=w03] [--dry]
// Deterministic: every level is generated from a seed derived from its id.
//
// Calibration (reference study of the genre, see docs/MECHANICS.md): one start hex (2–3 only on the
// first tutorials / very big multi-island boards), fog on (off for the first 3 levels), crystal
// density 20% -> 25–29% -> 30–33%, 9–23% of safe cells with a non-num clue (rising), walls on 6–13% of
// adjacent pairs once introduced, half of the levels split into islands once gaps exist, tutorials
// 10–40 hexes with ~3 special cells, regular levels 40–110, one showcase per world 60–180, the
// finale's last level ~180 (UX review: boards must fit a portrait phone). Difficulty rises via density and mixing, not size.

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateLevel, teachOK, type GenOptions, type ShapeId } from '../src/core/generator';
import { makeRng } from '../src/core/rng';
import { solveDetailed } from '../src/core/solver';
import type { Level, MechanicId } from '../src/core/types';
import { WORLDS, mechanicsUpTo } from '../src/levels/worlds';

interface Tut {
  teach: MechanicId[];
  /** Extra mechanics besides basic + counter (+ fog unless fog === false). */
  with?: MechanicId[];
  size: number;
  target: number;
  fog?: boolean;
  /** false: the level must be solvable without the crystal counter. */
  counter?: boolean;
  starts?: number;
  islands?: boolean;
  shape?: ShapeId;
  attempts?: number;
}

interface WorldParams {
  tutorials: Tut[];
  /** Regular level sizes (first -> last), difficulty targets. */
  size: [number, number];
  target: [number, number];
  /** Showcase (last level) size. */
  showcase: number;
}

const PARAMS: WorldParams[] = [
  // 1 First steps
  {
    tutorials: [
      // tiny, no fog, solvable from the numbers alone (no counter tricks)
      { teach: ['basic'], size: 7, target: 1, fog: false, counter: false, starts: 2, shape: 'hexagon' },
      { teach: [], size: 10, target: 1, fog: false, counter: false },
      { teach: [], size: 12, target: 1, fog: false, counter: false },
      { teach: ['fog'], size: 14, target: 1, counter: false },
      { teach: ['counter'], size: 16, target: 2, fog: false, attempts: 30 },
    ],
    size: [22, 50],
    target: [1, 2],
    showcase: 60,
  },
  // 2 Walls & islands
  { tutorials: [{ teach: ['walls'], with: ['walls'], size: 20, target: 2 }, { teach: ['gaps'], with: ['gaps'], size: 26, target: 2 }], size: [40, 75], target: [1, 2], showcase: 100 },
  // 3 Rays
  {
    tutorials: [
      { teach: ['line'], with: ['line'], size: 18, target: 2 },
      { teach: ['multiline'], with: ['line', 'multiline'], size: 22, target: 2 },
      { teach: ['blank'], with: ['line', 'blank'], size: 28, target: 3 },
    ],
    size: [42, 80],
    target: [2, 4],
    showcase: 115,
  },
  // 4 Circles
  {
    tutorials: [
      { teach: ['radius'], with: ['radius', 'blank'], size: 18, target: 2 },
      { teach: ['ring'], with: ['ring', 'blank'], size: 22, target: 2 },
      { teach: ['donut'], with: ['donut', 'blank'], size: 26, target: 3 },
    ],
    size: [45, 85],
    target: [3, 4],
    showcase: 125,
  },
  // 5 Cones
  { tutorials: [{ teach: ['cone'], with: ['cone', 'blank'], size: 20, target: 2 }, { teach: ['triangle'], with: ['triangle', 'blank'], size: 24, target: 3 }], size: [45, 85], target: [3, 5], showcase: 135 },
  // 6 Locks
  { tutorials: [{ teach: ['lock'], with: ['lock', 'blank'], size: 20, target: 2 }, { teach: ['gemclue'], with: ['gemclue', 'blank'], size: 24, target: 3 }], size: [48, 90], target: [3, 5], showcase: 145 },
  // 7 Dots & swirls
  { tutorials: [{ teach: ['dot'], with: ['dot', 'blank'], size: 20, target: 2 }, { teach: ['swirl'], with: ['swirl', 'walls', 'blank'], size: 24, target: 3 }], size: [50, 90], target: [4, 5], showcase: 150 },
  // 8 Rotation
  {
    tutorials: [
      { teach: ['rotate'], with: ['rotate', 'walls', 'line', 'blank'], size: 22, target: 3 },
      { teach: ['switch'], with: ['switch', 'line', 'radius', 'blank'], size: 26, target: 3 },
    ],
    size: [50, 95],
    target: [4, 6],
    showcase: 155,
  },
  // 9 Big cells & portals
  {
    tutorials: [
      { teach: ['big'], with: ['big', 'blank'], size: 24, target: 2 },
      { teach: ['portal'], with: ['portal', 'gaps', 'line', 'blank'], size: 30, target: 3, islands: true },
    ],
    size: [52, 100],
    target: [5, 6],
    showcase: 160,
  },
  // 10 Island & chain
  {
    tutorials: [
      { teach: ['island'], with: ['island', 'walls', 'gaps', 'blank'], size: 26, target: 3, islands: true },
      { teach: ['chain'], with: ['chain', 'blank'], size: 26, target: 3 },
    ],
    size: [55, 100],
    target: [5, 7],
    showcase: 165,
  },
  // 11 Together & apart
  { tutorials: [{ teach: ['together'], with: ['together', 'blank'], size: 22, target: 2 }, { teach: ['apart'], with: ['apart', 'blank'], size: 24, target: 3 }], size: [55, 105], target: [6, 7], showcase: 170 },
  // 12 Eye & parity
  { tutorials: [{ teach: ['eye'], with: ['eye', 'blank'], size: 24, target: 3 }, { teach: ['parity'], with: ['parity', 'blank'], size: 24, target: 3 }], size: [55, 105], target: [6, 8], showcase: 175 },
  // 13 Threads & zones
  { tutorials: [{ teach: ['link'], with: ['link', 'blank'], size: 22, target: 2 }, { teach: ['zone'], with: ['zone', 'blank'], size: 24, target: 3 }], size: [60, 110], target: [7, 8], showcase: 175 },
  // 14 Finale
  { tutorials: [], size: [70, 110], target: [8, 10], showcase: 180 },
];

const SHOWCASE: ShapeId[] = ['flower', 'islands2', 'star', 'heart', 'glyph', 'ring', 'flower', 'hexagon', 'islands3', 'glyph', 'heart', 'star', 'blob', 'flower'];
/** Older mechanics that are kept with a high probability (they shape every board). */
const STRUCTURAL: MechanicId[] = ['fog', 'blank', 'walls', 'gaps'];
const CLUE_MECHS: MechanicId[] = ['line', 'radius', 'ring', 'donut', 'cone', 'triangle', 'dot', 'swirl', 'island', 'chain', 'eye', 'parity'];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Mechanics that carry information from one island to another. */
const CROSS: MechanicId[] = ['line', 'radius', 'ring', 'donut', 'cone', 'triangle', 'dot', 'eye', 'portal', 'zone', 'link'];

export function plan(): GenOptions[] {
  const out: GenOptions[] = [];
  const W = WORLDS.length;
  WORLDS.forEach((w, wi) => {
    const P = PARAMS[wi];
    const older = mechanicsUpTo(w.n - 1);
    const count = w.levels.length;
    const nTut = P.tutorials.length;
    const worldT = W > 1 ? wi / (W - 1) : 0; // 0 .. 1 across the campaign
    w.levels.forEach((id, li) => {
      const rng = makeRng(`plan:${id}`);
      const seed = `campaign:${id}`;
      if (li < nTut) {
        const t = P.tutorials[li];
        const mechanics: MechanicId[] = [
          'basic',
          ...(t.counter === false ? [] : (['counter'] as MechanicId[])),
          ...(t.fog === false ? [] : (['fog'] as MechanicId[])),
          ...(t.with ?? []),
        ];
        out.push({
          seed,
          id,
          size: t.size,
          mechanics,
          targetDifficulty: t.target,
          teach: t.teach.length ? t.teach : undefined,
          fog: t.fog,
          starts: t.starts,
          islands: t.islands ?? false,
          shape: t.shape,
          density: lerp(0.2, 0.3, worldT) - 0.02,
          walls: t.with?.includes('walls') ? 0.12 : undefined,
          attempts: t.attempts,
        });
        return;
      }
      const showcase = li === count - 1;
      const p = count - 1 - nTut <= 0 ? 1 : (li - nTut) / (count - 1 - nTut);
      let size = Math.round(lerp(P.size[0], P.size[1], p) + (rng.next() * 2 - 1) * 6);
      let target = Math.round(lerp(P.target[0], P.target[1], p));
      if (!showcase && li % 4 === 3 && target > P.target[0]) target--; // breather
      if (showcase) {
        size = P.showcase + rng.int(10);
        target = P.target[1];
      }
      // mechanics: the world's own + a random selection of the older ones
      const mech = new Set<MechanicId>(['basic', 'counter', ...w.introduces]);
      const keepOld = wi === W - 1 ? 0.7 : 0.5;
      for (const m of older) {
        if (mech.has(m)) continue;
        if (m === 'blank' || rng.chance(STRUCTURAL.includes(m) ? Math.max(0.8, keepOld) : keepOld)) mech.add(m);
      }
      if (w.n >= 2) mech.add('fog');
      if (mech.has('multiline')) mech.add('line');
      if (mech.has('portal')) mech.add('gaps');
      const weights: Partial<Record<MechanicId, number>> = {};
      for (const m of w.introduces) if (CLUE_MECHS.includes(m)) weights[m] = 2.5;
      // world 1 has numbers only: density is its one lever for the first tier-2 moments
      const density = (w.n === 1 ? lerp(0.24, 0.3, p) : lerp(0.23, 0.33, worldT) + p * 0.02) + rng.next() * 0.01;
      out.push({
        seed,
        id,
        size,
        mechanics: [...mech],
        weights,
        targetDifficulty: target,
        feature: w.introduces.filter((m) => m !== 'fog' && m !== 'blank' && m !== 'gaps'),
        shape: showcase ? SHOWCASE[wi] : undefined,
        density,
        special: lerp(0.09, 0.17, worldT) + rng.next() * 0.02,
        walls: mech.has('walls') ? 0.06 + rng.next() * 0.07 : undefined,
        islands: mech.has('gaps') && size >= 30 && CROSS.some((m) => mech.has(m)) ? rng.chance(0.5) : false,
        fog: true,
        attempts: size <= 140 ? 8 : undefined,
        tolerance: target <= 6 ? 0 : 1,
      });
    });
  });
  return out;
}

function islandsOf(hexes: [number, number][]): number {
  const set = new Set(hexes.map(([q, r]) => `${q},${r}`));
  const seen = new Set<string>();
  let k = 0;
  const D = [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0]];
  for (const [q, r] of hexes) {
    const s0 = `${q},${r}`;
    if (seen.has(s0)) continue;
    k++;
    const st: [number, number][] = [[q, r]];
    seen.add(s0);
    while (st.length) {
      const [x, y] = st.pop()!;
      for (const [dq, dr] of D) {
        const s = `${x + dq},${y + dr}`;
        if (set.has(s) && !seen.has(s)) {
          seen.add(s);
          st.push([x + dq, y + dr]);
        }
      }
    }
  }
  return k;
}

function main() {
  const args = process.argv.slice(2);
  const only = args.find((a) => a.startsWith('--only='))?.slice(7);
  const dry = args.includes('--dry');
  const plans = plan().filter((p) => !only || p.id!.startsWith(only));
  const levels: Level[] = [];
  const t0 = Date.now();
  console.log('world level    n  T diff  tiers(1/2/3/4)  dens  spec starts isl fog open cols  teach              ms');
  let teachFail = 0;
  for (const p of plans) {
    const t = Date.now();
    const level = generateLevel(p);
    const rep = solveDetailed(level, { trace: true });
    if (!rep.solved) throw new Error(`${p.id} is not solvable`);
    const ms = Date.now() - t;
    let teachInfo = '';
    if (level.teach?.length) {
      const ok = teachOK(level, p.mechanics);
      if (!ok) teachFail++;
      teachInfo = level.teach.join(',') + (ok ? ' ok' : ' WEAK');
    }
    levels.push(level);
    const [w, l] = p.id!.slice(1).split('-');
    const n = level.cells.length;
    const safe = level.cells.filter((c) => !c.gem);
    const spec = safe.filter((c) => c.clue && c.clue.k !== 'num' && c.clue.k !== 'blank').length / Math.max(1, safe.length);
    const hexes = level.cells.flatMap((c) => [[c.q, c.r] as [number, number], ...(c.extra ?? [])]);
    let opened = 0;
    for (const e of rep.events) {
      if (e.tier >= 2) break;
      opened += e.cells.length;
    }
    const cols = new Set(hexes.map(([q]) => q)).size;
    console.log(
      `${w.padStart(5)} ${l.padStart(5)} ${String(n).padStart(4)} ${String(p.targetDifficulty).padStart(2)} ${String(level.diff).padStart(4)}  ${rep.tierCounts.join('/').padEnd(14)} ${(level.cells.filter((c) => c.gem).length / n).toFixed(2)}  ${spec.toFixed(2)} ${String(level.cells.filter((c) => c.start).length).padStart(6)} ${String(islandsOf(hexes)).padStart(3)} ${level.fog === false ? ' no' : 'yes'} ${(opened / n).toFixed(2)} ${String(cols).padStart(4)}  ${teachInfo.padEnd(18)} ${String(ms).padStart(6)}`,
    );
  }
  console.log(`${levels.length} levels in ${((Date.now() - t0) / 1000).toFixed(1)} s, teach levels where the mechanic is not strictly needed: ${teachFail}`);
  if (dry || only) return;
  const here = dirname(fileURLToPath(import.meta.url));
  const file = resolve(here, '../src/levels/campaign.json');
  writeFileSync(file, JSON.stringify(levels));
  console.log(`wrote ${file}`);
}

if (!process.env.HEX_NO_MAIN) main();
