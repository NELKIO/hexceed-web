// Editor rendering helpers: the level drawn as its solution (every safe cell open with its live
// clue value, every light lit), the clue / direction pickers, and the small board marks.

import type { ComponentChildren, JSX } from 'preact';
import { CORNER_ANGLE, DIRS, EDGE_ANGLE, key, toPixel } from '../../core/hex';
import type { Board } from '../../core/rules';
import { CellState, type Clue, type ClueKind, type Level } from '../../core/types';
import { knownVals, type Game } from '../../core/game';
import { ClueGlyph, LockGlyph, type CellProps } from '../game/Cell';
import { edgeSegment, layoutBoard, roundedHexPath, S, TILE_PATH, type Layout } from '../game/geometry';
import { cellProps, newFx, precompute, type Pre } from '../game/view';
import { newGameV2, portalsAtPhase } from '../game/compat';
import { sfx } from '../../audio/sfx';
import type { Box } from './Canvas';

export interface EdView {
  g: Game;
  board: Board;
  layout: Layout;
  pre: Pre;
  cells: CellProps[];
  portals: [number, number, number][];
  index: Map<string, number>;
}

/** Everything the canvas draws for a level, or null for an empty board. */
export function buildView(level: Level): EdView | null {
  if (!level.cells.length) return null;
  try {
    const g = newGameV2(level, 'gentle');
    const n = g.board.n;
    for (let i = 0; i < n; i++) g.state[i] = level.cells[i].gem ? CellState.Marked : CellState.Revealed;
    g.marked = level.cells.filter((c) => c.gem).length;
    const layout = layoutBoard(g.board);
    const pre = precompute(g.board, layout);
    const vis = new Uint8Array(n).fill(1);
    const cells = cellProps(g, pre, layout, newFx(n), knownVals(g), vis).map((c) => ({ ...c, done: false }));
    return { g, board: g.board, layout, pre, cells, portals: portalsAtPhase(g.board, level, 0), index: layout.hexUnit };
  } catch (e) {
    console.warn('[workshop] cannot draw level', e);
    return null;
  }
}

/** Axial hex under a board point. */
export function hexAt(x: number, y: number): [number, number] {
  const q = ((2 / 3) * x) / S;
  const r = ((-1 / 3) * x + (Math.sqrt(3) / 3) * y) / S;
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return [rq, rr];
}

/** The hex edge nearest to a board point, owned by an existing hex: [q, r, d], or null. */
export function edgeAt(index: Map<string, number>, x: number, y: number): [number, number, number] | null {
  const [q, r] = hexAt(x, y);
  const [cx, cy] = toPixel(q, r, S);
  const a = (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
  let d = 0, best = Infinity;
  for (let k = 0; k < 6; k++) {
    const diff = Math.abs((((a - EDGE_ANGLE[k]) % 360) + 540) % 360 - 180);
    if (diff < best) {
      best = diff;
      d = k;
    }
  }
  if (index.has(key(q, r))) return [q, r, d];
  const nq = q + DIRS[d][0], nr = r + DIRS[d][1];
  if (index.has(key(nq, nr))) return [nq, nr, (d + 3) % 6];
  return null;
}

/** Empty positions next to the board (where a hex can be added); a starter hexagon when empty. */
export function slotsOf(level: Level, index: Map<string, number>): [number, number][] {
  const out: [number, number][] = [];
  const seen = new Set<string>();
  const add = (q: number, r: number) => {
    const k = key(q, r);
    if (index.has(k) || seen.has(k)) return;
    seen.add(k);
    out.push([q, r]);
  };
  if (!level.cells.length) {
    for (let q = -4; q <= 4; q++) for (let r = -4; r <= 4; r++) if (Math.abs(q + r) <= 4) add(q, r);
    return out;
  }
  for (const k of index.keys()) {
    const [q, r] = k.split(',').map(Number);
    for (const [dq, dr] of DIRS) add(q + dq, r + dr);
  }
  return out;
}

/** Board-unit box of the level plus one ring around it (stable while switching tools). */
export function boxOf(index: Map<string, number>, slots: [number, number][]): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const h = (S * Math.sqrt(3)) / 2;
  const take = (q: number, r: number) => {
    const [x, y] = toPixel(q, r, S);
    minX = Math.min(minX, x - S);
    maxX = Math.max(maxX, x + S);
    minY = Math.min(minY, y - h);
    maxY = Math.max(maxY, y + h);
  };
  for (const k of index.keys()) {
    const [q, r] = k.split(',').map(Number);
    take(q, r);
  }
  for (const [q, r] of slots) take(q, r);
  if (minX === Infinity) return { minX: -200, minY: -200, maxX: 200, maxY: 200 };
  return { minX, minY, maxX, maxY };
}

const SLOT_PATH = roundedHexPath(S * 0.86, 0.08);
const START_RING = roundedHexPath(S * 0.8, 0.08);

export function Slots({ slots }: { slots: [number, number][] }) {
  return (
    <g class="ed-slots">
      {slots.map(([q, r]) => {
        const [x, y] = toPixel(q, r, S);
        return <path key={`${q},${r}`} d={SLOT_PATH} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`} />;
      })}
    </g>
  );
}

/** Start ring + play badge, lock badge with its count. */
export function Marks({ level, layout }: { level: Level; layout: Layout }) {
  return (
    <g class="ed-marks">
      {level.cells.map((c, i) => {
        if (!c.start && !c.lock) return null;
        const [x, y] = layout.px[i];
        return (
          <g key={i} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>
            {c.start && (
              <>
                <path class="ed-start" d={layout.outline[i] ? undefined : START_RING} />
                <g class="ed-badge start" transform="translate(21 -18)">
                  <circle r={8.5} />
                  <path d="M-2.6,-4.2 L4.4,0 L-2.6,4.2 Z" />
                </g>
              </>
            )}
            {!!c.lock && (
              <g class="ed-badge lock" transform="translate(21 -20) scale(0.62)">
                <LockGlyph n={c.lock} />
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}

export function EdgeHover({ edge }: { edge: [number, number, number] | null }) {
  if (!edge) return null;
  const [x, y] = toPixel(edge[0], edge[1], S);
  const [a, b] = edgeSegment(x, y, edge[2], S);
  return <path class="ed-edge-hover" d={`M${a[0].toFixed(1)},${a[1].toFixed(1)}L${b[0].toFixed(1)},${b[1].toFixed(1)}`} />;
}

// ------------------------------------------------------------------ pickers

export const CLUE_KINDS: ClueKind[] = ['num', 'line', 'radius', 'ring', 'donut', 'cone', 'triangle', 'dot', 'swirl', 'island', 'chain', 'eye', 'parity', 'blank'];
export const DIR_KINDS = new Set<ClueKind>(['line', 'cone', 'triangle', 'dot', 'swirl']);

/** A one-hex picture of a clue kind, drawn with the board's own glyph. */
export function ClueTile({ clue, gem }: { clue: Clue | null; gem?: boolean }) {
  return (
    <svg class="ed-tile" viewBox="-42 -42 84 84" aria-hidden="true">
      <g class={'face ' + (gem ? 'gem' : 'open')}>
        <path class="t-face" d={TILE_PATH} />
        {clue ? (
          <g class="clue">
            <ClueGlyph clue={clue} value={clue.k === 'parity' ? 'odd' : '2'} onGem={gem} />
          </g>
        ) : (
          <path class="ed-none" d="M-12,0 H12" />
        )}
      </g>
    </svg>
  );
}

/** Six direction toggles around a hex: edges (rays, dots, swirl) or corners (cone, triangle, corner dots). */
export function DirPicker({ dirs, corners, single, onChange }: { dirs: number[]; corners?: boolean; single?: boolean; onChange: (d: number[]) => void }) {
  const angles = corners ? CORNER_ANGLE : EDGE_ANGLE;
  const R = 34;
  return (
    <svg class="ed-dirs" viewBox="-52 -52 104 104" role="group">
      <path class="ed-dirs-hex" d={roundedHexPath(19, 0.1)} />
      {angles.map((a, d) => {
        const on = dirs.includes(d);
        const x = R * Math.cos((a * Math.PI) / 180), y = R * Math.sin((a * Math.PI) / 180);
        return (
          <g
            key={d}
            class={'ed-dir' + (on ? ' on' : '')}
            role="checkbox"
            aria-checked={on}
            aria-label={`${d}`}
            transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}
            onClick={() => {
              sfx.tick();
              if (single) onChange([d]);
              else if (on) {
                if (dirs.length > 1) onChange(dirs.filter((x2) => x2 !== d));
              } else onChange([...dirs, d].sort((p, q) => p - q));
            }}
          >
            <circle class="ed-dir-hit" r={15} />
            <path class="ed-dir-arrow" d="M-5.5,-6.5 L6.5,0 L-5.5,6.5 L-2.2,0 Z" transform={`rotate(${a})`} />
          </g>
        );
      })}
    </svg>
  );
}

/** A row of small chips (single choice). */
export function Chips<T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: ComponentChildren; disabled?: boolean }[]; onChange: (v: T) => void }) {
  return (
    <div class="ed-chips" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.v}
          class={'ed-chip' + (o.v === value ? ' on' : '')}
          role="radio"
          aria-checked={o.v === value}
          disabled={o.disabled}
          onClick={() => {
            if (o.v !== value) {
              sfx.toggle();
              onChange(o.v);
            }
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export type { JSX };
