// Menu hero: a tiny board that slowly solves itself in a loop (decorative, not interactive).
// With reduced motion it shows one still, half-solved frame.

import { useEffect, useMemo, useState } from 'preact/hooks';
import { act } from '../../core/game';
import { CellState } from '../../core/types';
import { buildSample } from '../../levels/samples';
import { BoardLayer } from '../game/BoardLayer';
import { layoutBoard } from '../game/geometry';
import { cellProps, newFx, precompute } from '../game/view';
import { newGameV2 } from '../game/compat';
import { useReducedMotion } from './ui';

const HERO = buildSample({
  id: 'hero',
  title: '',
  w: 7,
  h: 4,
  holes: ['0,0', '6,0', '0,3', '6,3', '1,3', '5,3'],
  gems: ['1,0', '4,1', '2,2', '5,2', '3,3'],
  start: ['3,1'],
  fog: false,
});

const STEP_MS = 900;

/** Solving order: always the hidden cell next to the opened area that is closest to the start. */
function solveOrder(): number[] {
  const g = newGameV2(HERO, 'gentle');
  const layout = layoutBoard(g.board);
  const start = HERO.cells.findIndex((c) => c.start);
  const [sx, sy] = layout.px[Math.max(0, start)];
  const order: number[] = [];
  const done = new Set<number>(HERO.cells.map((c, i) => (c.start ? i : -1)).filter((i) => i >= 0));
  const n = HERO.cells.length;
  while (done.size < n) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < n; i++) {
      if (done.has(i)) continue;
      const touching = [...done].some((j) => Math.hypot(layout.px[i][0] - layout.px[j][0], layout.px[i][1] - layout.px[j][1]) < 75);
      const d = Math.hypot(layout.px[i][0] - sx, layout.px[i][1] - sy) + (touching ? 0 : 1000);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    done.add(best);
    order.push(best);
  }
  return order;
}

export function HeroBoard() {
  const reduced = useReducedMotion();
  const base = useMemo(() => {
    const g = newGameV2(HERO, 'gentle');
    const layout = layoutBoard(g.board);
    return { layout, pre: precompute(g.board, layout), order: solveOrder() };
  }, []);
  const [round, setRound] = useState(0);
  const [, force] = useState(0);
  const sim = useMemo(() => {
    const g = newGameV2(HERO, 'gentle');
    const fx = newFx(g.board.n);
    if (round > 0) {
      const { layout } = base;
      const cx = layout.minX + layout.w / 2, cy = layout.minY + layout.h / 2;
      for (let i = 0; i < g.board.n; i++) {
        fx.enter[i] = 'deal';
        fx.delay[i] = Math.round(Math.hypot(layout.px[i][0] - cx, layout.px[i][1] - cy) * 1.5);
      }
    }
    return { g, fx };
  }, [round]);

  const step = (i: number) => {
    const { g, fx } = sim;
    if (g.state[i] !== CellState.Hidden) return;
    const gem = HERO.cells[i].gem;
    fx.enter[i] = gem ? 'pop' : 'flip';
    fx.delay[i] = 0;
    act(g, i, gem ? 'mark' : 'reveal');
  };

  useEffect(() => {
    if (reduced) {
      // a still frame: about half solved
      base.order.slice(0, Math.ceil(base.order.length / 2)).forEach(step);
      sim.fx.enter.fill('none');
      force((n) => n + 1);
      return undefined;
    }
    const timers: number[] = [];
    let t = round > 0 ? 1200 : 1600;
    timers.push(window.setTimeout(() => sim.fx.enter.fill('none'), t - 200));
    for (const i of base.order) {
      timers.push(
        window.setTimeout(() => {
          if (document.hidden) return;
          step(i);
          force((n) => n + 1);
        }, t),
      );
      t += STEP_MS;
    }
    timers.push(window.setTimeout(() => setRound((r) => r + 1), t + 2600));
    return () => timers.forEach(clearTimeout);
  }, [sim, reduced]);

  const { layout, pre } = base;
  const cells = cellProps(sim.g, pre, layout, sim.fx);
  const pad = 6;
  const vb = `${layout.minX - pad} ${layout.minY - pad} ${layout.w + pad * 2} ${layout.h + pad * 2}`;
  return (
    <div class="hero-board" aria-hidden="true">
      <svg viewBox={vb} class="hero-svg">
        <BoardLayer
          board={sim.g.board}
          layout={layout}
          cells={cells}
          zoneValues={[]}
          zoneDone={[]}
          linkDone={[]}
          highlights={[]}
          hintCell={-1}
          hover={-1}
          press={null}
          staticWalls=""
          portals={[]}
        />
      </svg>
    </div>
  );
}
