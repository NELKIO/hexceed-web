import { loadBest, loadLast, loadProgress } from '../storage';
import { isKnownLevel, levelPos, WORLDS, worldUnlocked } from '../levels';

export function doneSet(): Set<string> {
  return new Set(Object.keys(loadBest()));
}

export function campaignStats() {
  const best = loadBest();
  let done = 0, total = 0, stars = 0;
  for (const w of WORLDS)
    for (const id of w.levels) {
      total++;
      if (best[id]) {
        done++;
        stars += best[id].stars;
      }
    }
  return { done, total, stars, maxStars: total * 3 };
}

/** The level the big "Play" button continues: an unfinished last-played level, else the first unsolved one. */
export function continueTarget(): { id: string; world: number; index: number; fresh: boolean } | null {
  const done = doneSet();
  const isDone = (id: string) => done.has(id);
  const last = loadLast();
  if (last && isKnownLevel(last) && !isDone(last)) {
    const p = levelPos(last);
    if (p && worldUnlocked(p.world, isDone)) return { id: last, ...p, fresh: !loadProgress(last) };
  }
  for (let wi = 0; wi < WORLDS.length; wi++) {
    if (!worldUnlocked(wi, isDone)) break;
    const w = WORLDS[wi];
    const li = w.levels.findIndex((id) => !isDone(id));
    if (li >= 0) return { id: w.levels[li], world: wi, index: li, fresh: done.size === 0 };
  }
  // everything solved: replay the last one
  const lw = WORLDS[WORLDS.length - 1];
  return lw ? { id: lw.levels[lw.levels.length - 1], world: WORLDS.length - 1, index: lw.levels.length - 1, fresh: false } : null;
}
