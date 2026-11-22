// Small self-playing illustration board for the explainer cards.

import { useEffect, useMemo, useState } from 'preact/hooks';
import { act } from '../../core/game';
import { CellState } from '../../core/types';
import type { MechanicId } from '../../core/types';
import { BoardLayer, type Highlight } from './BoardLayer';
import { layoutBoard } from './geometry';
import { cellProps, newFx, precompute, srcCells, syncRotation, type Src } from './view';
import { newGameV2, portalsOf, rotateGame } from './compat';
import { DEMOS } from '../mechanics';
import { IconGem } from '../icons';

export function MiniBoard({ mech, playing = true }: { mech: MechanicId; playing?: boolean }) {
  const demo = DEMOS[mech] ?? DEMOS.basic!;
  const level = demo.level;
  const base = useMemo(() => {
    const g = newGameV2(level, 'gentle');
    const layout = layoutBoard(g.board);
    return { layout, pre: precompute(g.board, layout) };
  }, [level]);
  const [tick, setTick] = useState(0);
  const [, force] = useState(0);
  const focusIdx = useMemo(() => {
    const idx: number[] = [];
    level.cells.forEach((c, i) => {
      const k = `${c.q},${c.r + Math.floor(c.q / 2)}`;
      if (demo.focus.includes(k)) idx.push(i);
    });
    return idx;
  }, [level]);

  const sim = useMemo(() => {
    const g = newGameV2(level, 'gentle');
    for (const i of focusIdx) if (g.state[i] === CellState.Hidden) act(g, i, level.cells[i].gem ? 'mark' : 'reveal');
    // the lights a clue counts are lit from the start, so its number visibly matches them
    // (not for the counter / lock demos, which are about lighting them one by one)
    if (mech !== 'counter' && !demo.lock && mech !== 'fog')
      level.cells.forEach((c, i) => {
        if (c.gem && g.state[i] === CellState.Hidden) act(g, i, 'mark');
      });
    return { g, fx: newFx(level.cells.length), hl: [] as Highlight[] };
  }, [level, tick]);

  useEffect(() => {
    const { g, fx } = sim;
    if (!playing) return;
    const timers: number[] = [];
    const at = (ms: number, f: () => void) => timers.push(window.setTimeout(() => { f(); force((n) => n + 1); }, ms));
    const srcs: Src[] = [];
    focusIdx.forEach((i) => srcs.push({ t: 'cell', i }));
    (level.zones ?? []).forEach((_, z) => srcs.push({ t: 'zone', z }));
    (level.links ?? []).forEach((_, l) => srcs.push({ t: 'link', l }));
    const showHl = () => {
      // one accent hue per card; only the covered cells are outlined (no rings on the source)
      sim.hl = srcs.map((s, k) => ({ cells: srcCells(g, base.pre, s), src: -1, tint: 0, key: 'h' + k }));
    };
    let t = 600;
    if (demo.phases) {
      at(t, showHl);
      for (let r = 0; r < 6; r++) {
        t += 1100;
        at(t, () => {
          rotateGame(g);
          syncRotation(g, base.pre, fx);
          showHl();
        });
      }
      t += 1200;
    } else {
      at(t, showHl);
      t += 900;
      const order = level.cells.map((_, i) => i).filter((i) => g.state[i] === CellState.Hidden && !level.cells[i].lock);
      // crystals first for the lock demo, otherwise by distance to the first focus cell
      if (srcs.length) {
        const cover = new Set(srcs.flatMap((sr) => srcCells(g, base.pre, sr)));
        for (let k = order.length - 1; k >= 0; k--) if (!cover.has(order[k])) order.splice(k, 1);
      }
      const f0 = focusIdx[0];
      const d = (i: number) => (f0 === undefined ? 0 : Math.hypot(base.layout.px[i][0] - base.layout.px[f0][0], base.layout.px[i][1] - base.layout.px[f0][1]));
      order.sort((a, b) => d(a) - d(b));
      if (demo.lock) order.sort((a, b) => Number(level.cells[b].gem) - Number(level.cells[a].gem));
      for (const i of order) {
        at(t, () => {
          fx.enter[i] = level.cells[i].gem ? 'pop' : 'flip';
          const r = act(g, i, level.cells[i].gem ? 'mark' : 'reveal');
          for (const j of r.opened) fx.enter[j] = 'unlock';
          if (srcs.length) showHl();
        });
        t += 380;
      }
      t += 1400;
    }
    at(t, () => {
      sim.hl = [];
    });
    timers.push(window.setTimeout(() => setTick((n) => n + 1), t + 400));
    return () => timers.forEach(clearTimeout);
  }, [sim, playing]);

  const { layout, pre } = base;
  const cells = cellProps(sim.g, pre, layout, sim.fx);
  const pad = 12;
  const vb = `${layout.minX - pad} ${layout.minY - pad - 10} ${layout.w + pad * 2} ${layout.h + pad * 2 + 10}`;
  const left = sim.g.board.totalGems - sim.g.marked;
  return (
    <div class="mini">
      <svg viewBox={vb} class="mini-svg" aria-hidden="true">
        <BoardLayer
          board={sim.g.board}
          layout={layout}
          cells={cells}
          zoneValues={pre.zoneValues}
          zoneDone={[]}
          linkDone={[]}
          highlights={sim.hl}
          hintCell={-1}
          hover={-1}
          press={null}
          staticWalls={pre.staticWalls}
          portals={portalsOf(level)}
        />
      </svg>
      {mech === 'counter' && (
        <div class="mini-counter">
          <IconGem />
          <b key={left}>{left}</b>
        </div>
      )}
    </div>
  );
}
