// Every visual layer of a board, in board units. Used by the interactive board and by the
// small illustration boards (explainers, how-to-play).

import { memo } from 'preact/compat';
import type { Board } from '../../core/rules';
import { Cell, type CellProps } from './Cell';
import { edgeSegment, linkCurve, OUTLINE_PATH, S, zoneBadge, zoneOutline, type Layout } from './geometry';
import { DIRS, toPixel } from '../../core/hex';
import { CellState } from '../../core/types';
import { useMemo } from 'preact/hooks';
import type { WallSeg } from './view';

export interface Highlight {
  cells: number[];
  /** Source cell index (gets a ring), or -1. */
  src: number;
  /** Source point for zones/links (badge position). */
  srcPoint?: [number, number];
  tint: number; // 0..3 pinned palette, 9 = hover, 8 = hint
  key: string;
}

export interface BoardLayerProps {
  board: Board;
  layout: Layout;
  cells: CellProps[];
  zoneValues: number[];
  zoneDone: boolean[];
  linkDone: boolean[];
  highlights: Highlight[];
  hintCell: number;
  hover: number;
  press: { cell: number; toGem: boolean; key: number } | null;
  staticWalls: string;
  /** Per-wall segments; when given, walls deep in the fog are drawn faint. */
  wallSegs?: WallSeg[];
  portals: [number, number, number][];
}

const Statics = memo(function Statics({ board, layout }: { board: Board; layout: Layout }) {
  const zoneFills = useMemo(
    () => (board.level.zones ?? []).map((z) => zoneOutline(board, layout, z.cells)),
    [board, layout],
  );
  return (
    <g class="zone-fills">
      {zoneFills.map((d, z) => (
        <path key={z} class="zone-fill" d={d} />
      ))}
    </g>
  );
});

function Walls({ d, dim }: { d: string; dim?: string }) {
  if (!d && !dim) return null;
  return (
    <>
      {dim ? (
        <g class="walls fogged">
          <path class="wall" d={dim} />
        </g>
      ) : null}
      {d ? (
        <g class="walls">
          <path class="wall-shadow" d={d} />
          <path class="wall" d={d} />
        </g>
      ) : null}
    </>
  );
}

/** Split walls into "in sight" and "deep in the fog" (both sides fogged or missing). */
function splitWalls(segs: WallSeg[], cells: CellProps[]): [string, string] {
  let vis = '', dim = '';
  const fogged = (u: number) => u < 0 || !!cells[u]?.fog;
  for (const w of segs) {
    if (fogged(w.a) && fogged(w.b)) dim += w.d;
    else vis += w.d;
  }
  return [vis, dim];
}

/** Portal flags: a glowing arc on the edge, and a faint dashed bridge to the partner across the gap. */
function Portals({ board, portals }: { board: Board; portals: [number, number, number][] }) {
  const geo = useMemo(() => {
    const set = new Set(portals.map(([q, r, d]) => `${q},${r},${d}`));
    const has = (q: number, r: number) => board.index.has(`${q},${r}`);
    const B = board.bounds;
    const arcs: string[] = [];
    const bridges: string[] = [];
    for (const [q, r, d] of portals) {
      const [x, y] = toPixel(q, r, S);
      const [a, c] = edgeSegment(x, y, d, S * 0.93);
      const mx = (a[0] + c[0]) / 2, my = (a[1] + c[1]) / 2;
      // bulge towards the hex centre
      const bx = mx + (x - mx) * 0.32, by = my + (y - my) * 0.32;
      arcs.push(`M${a[0].toFixed(1)},${a[1].toFixed(1)}Q${bx.toFixed(1)},${by.toFixed(1)} ${c[0].toFixed(1)},${c[1].toFixed(1)}`);
      if (d >= 3) continue; // draw each bridge once
      let qq = q, rr = r;
      for (let k = 0; k < 40; k++) {
        qq += DIRS[d][0];
        rr += DIRS[d][1];
        const s = -qq - rr;
        if (qq < B.minQ - 1 || qq > B.maxQ + 1 || rr < B.minR - 1 || rr > B.maxR + 1 || s < B.minS - 1 || s > B.maxS + 1) break;
        if (has(qq, rr) && set.has(`${qq},${rr},${(d + 3) % 6}`)) {
          const [x2, y2] = toPixel(qq, rr, S);
          const [a2, c2] = edgeSegment(x2, y2, (d + 3) % 6, S);
          bridges.push(`M${mx.toFixed(1)},${my.toFixed(1)}L${((a2[0] + c2[0]) / 2).toFixed(1)},${((a2[1] + c2[1]) / 2).toFixed(1)}`);
          break;
        }
      }
    }
    return { arcs: arcs.join(''), bridges: bridges.join('') };
  }, [board, portals]);
  if (!portals.length) return null;
  return (
    <g class="portals">
      <path class="portal-bridge" d={geo.bridges} />
      <path class="portal-glow" d={geo.arcs} />
      <path class="portal" d={geo.arcs} />
    </g>
  );
}

function Zones({ board, layout, values, done }: { board: Board; layout: Layout; values: number[]; done: boolean[] }) {
  const geo = useMemo(
    () => (board.level.zones ?? []).map((z) => ({ d: zoneOutline(board, layout, z.cells), badge: zoneBadge(layout, z.cells) })),
    [board, layout],
  );
  return (
    <g class="zones">
      {geo.map((g, z) => (
        <g key={z} class={done[z] ? 'zone done' : 'zone'}>
          <path class="zone-line" d={g.d} />
          <g transform={`translate(${g.badge[0].toFixed(1)} ${g.badge[1].toFixed(1)})`} class="zone-badge">
            <rect x={-14} y={-12} width={28} height={24} rx={12} />
            <text font-size={15} text-anchor="middle" dominant-baseline="central">
              {values[z]}
            </text>
          </g>
        </g>
      ))}
    </g>
  );
}

let maskSeq = 0;

/**
 * Link threads. They pass *under* the clue layer: a mask cuts the thread around every cell that
 * currently shows a clue, so a thread never covers a number. The "=/≠" badge sits on the point of
 * the curve farthest from all cell centres (see linkCurve).
 */
function Links({ board, layout, done, cells }: { board: Board; layout: Layout; done: boolean[]; cells: CellProps[] }) {
  const geo = useMemo(() => (board.level.links ?? []).map((l) => { const c = linkCurve(layout, l.a, l.b); return { ...c, same: l.same, a: c.ends[0], b: c.ends[1] }; }), [board, layout]);
  const id = useMemo(() => 'lkm' + ++maskSeq, []);
  if (!geo.length) return null;
  const holes = cells.filter((c) => c.st !== CellState.Hidden && c.clue && (c.value || c.clue.k === 'blank'));
  return (
    <g class="links">
      <defs>
        <mask id={id} maskUnits="userSpaceOnUse" x={layout.minX - S * 4} y={layout.minY - S * 4} width={layout.w + S * 8} height={layout.h + S * 8}>
          <rect x={layout.minX - S * 4} y={layout.minY - S * 4} width={layout.w + S * 8} height={layout.h + S * 8} fill="#fff" />
          {holes.map((c) => (
            <circle key={c.i} cx={c.x} cy={c.y} r={S * 0.56} fill="#000" />
          ))}
        </mask>
      </defs>
      {geo.map((g, k) => (
        <g key={k} class={(done[k] ? 'link done' : 'link') + (g.same ? ' same' : ' diff')}>
          <g mask={`url(#${id})`}>
            <path class="thread-glow" d={g.d} />
            <path class="thread" d={g.d} />
          </g>
          <circle class="knot" cx={g.a[0]} cy={g.a[1]} r={3.6} />
          <circle class="knot" cx={g.b[0]} cy={g.b[1]} r={3.6} />
          <g transform={`translate(${g.mid[0].toFixed(1)} ${g.mid[1].toFixed(1)})`} class="link-badge">
            <circle r={12} />
            {g.same ? <path d="M-5,-2.6 H5 M-5,2.6 H5" /> : <path d="M-5,-2.6 H5 M-5,2.6 H5 M2.6,-7 L-2.6,7" />}
          </g>
        </g>
      ))}
    </g>
  );
}

function Highlights({ layout, highlights }: { layout: Layout; highlights: Highlight[] }) {
  return (
    <g class="hls">
      {highlights.map((h) => (
        <g key={h.key} class={`hl t${h.tint}`}>
          {h.cells.map((i) => {
            const [x, y] = layout.px[i];
            return <path key={i} d={layout.outline[i] ?? OUTLINE_PATH} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`} class="hl-cell" />;
          })}
          {h.src >= 0 && (
            <circle class="hl-src" cx={layout.px[h.src][0]} cy={layout.px[h.src][1]} r={S * 0.78} />
          )}
          {h.srcPoint && <circle class="hl-src" cx={h.srcPoint[0]} cy={h.srcPoint[1]} r={17} />}
          {h.tint <= 3 && (
            <g class="hl-mark">
              {h.cells.map((i) => {
                const [x, y] = layout.px[i];
                return <circle key={i} cx={x + S * 0.46} cy={y - S * 0.5} r={3.2} />;
              })}
            </g>
          )}
        </g>
      ))}
    </g>
  );
}

export function BoardLayer(p: BoardLayerProps) {
  const { layout } = p;
  return (
    <g class="board-layer">
      <Statics board={p.board} layout={layout} />
      <g class="cells">
        {p.cells.map((c) => (
          <Cell key={c.i} {...c} />
        ))}
      </g>
      {p.wallSegs ? <Walls {...(([d, dim]) => ({ d, dim }))(splitWalls(p.wallSegs, p.cells))} /> : <Walls d={p.staticWalls} />}
      <Portals board={p.board} portals={p.portals} />
      <Zones board={p.board} layout={layout} values={p.zoneValues} done={p.zoneDone} />
      <Links board={p.board} layout={layout} done={p.linkDone} cells={p.cells} />
      <Highlights layout={layout} highlights={p.highlights} />
      {p.hover >= 0 && (
        <path class="hover-ring" d={layout.outline[p.hover] ?? OUTLINE_PATH} transform={`translate(${layout.px[p.hover][0].toFixed(1)} ${layout.px[p.hover][1].toFixed(1)})`} />
      )}
      {p.hintCell >= 0 && (
        <g class="hint-target" transform={`translate(${layout.px[p.hintCell][0].toFixed(1)} ${layout.px[p.hintCell][1].toFixed(1)})`}>
          <path class="hint-ring r1" d={layout.outline[p.hintCell] ?? OUTLINE_PATH} />
          <path class="hint-ring r2" d={layout.outline[p.hintCell] ?? OUTLINE_PATH} />
        </g>
      )}
      {p.press && (
        <g key={p.press.key} class={'press ' + (p.press.toGem ? 'to-gem' : 'to-open')} transform={`translate(${layout.px[p.press.cell][0].toFixed(1)} ${layout.px[p.press.cell][1].toFixed(1)})`}>
          <circle class="press-bg" r={S * 0.62} />
          <circle class="press-arc" r={S * 0.62} pathLength={100} transform="rotate(-90)" />
        </g>
      )}
    </g>
  );
}
