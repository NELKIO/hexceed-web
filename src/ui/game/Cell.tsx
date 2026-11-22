// One unit of the board: tile + clue glyph. Pure SVG, memoised; one-off effects (shake, bloom)
// are played imperatively through the element handed to `refCb`.
//
// Visual language of the clue glyphs (v3 «Instrument»: monochrome line glyphs in --glyph, the
// number always upright in the centre; every kind differs by SHAPE, not by colour):
//   line = solid arrowhead whose tip touches the edge it looks through · cone = solid fan opening
//   towards a corner · triangle = the same fan as an open outline, cut short (only its far part) ·
//   radius = soft filled disc · ring = one thin circle · donut = two thin circles · dot = one dot
//   two steps out (with a dotted trail) · swirl = curved arrow · island = coastline contour ·
//   chain = two links · eye = an almond whose iris holds the number · parity = two bare pips (even) /
//   one pip (odd) + a word · together {n} · apart -n- · blank = short dash.
//   Decorations sit in `.deco` groups so the done state can dim them separately from the number
//   (numbers keep >= 4.5:1 contrast).

import type { ComponentChildren } from 'preact';
import { memo } from 'preact/compat';
import { useState } from 'preact/hooks';
import { CORNER_ANGLE, EDGE_ANGLE } from '../../core/hex';
import { CellState } from '../../core/types';
import { t } from '../../i18n';
import { TILE_PATH } from './geometry';
import { PieceGlyph } from '../art/Piece';
import type { LooseClue } from './compat';

export type Enter = 'none' | 'deal' | 'flip' | 'unlock' | 'pop' | 'condense' | 'rewind';

export interface CellProps {
  i: number;
  x: number;
  y: number;
  st: CellState;
  /** Hidden and out of sight (fog): a faint silhouette, not interactive. */
  fog: boolean;
  /** Remaining marks before a lock opens (0 = not locked). */
  lockN: number;
  clue: LooseClue | undefined;
  /** Display value: number as text, 'even'/'odd' for parity, '' for none. */
  value: string;
  /** Cumulative rotation (degrees) of a rotating cell's walls and arrows. */
  rotDeg: number;
  rotating: boolean;
  switching: boolean;
  /** Changes when a switching cell changes its clue (remounts the glyph). */
  glyphKey: string;
  /** Big cell outline (local coords); undefined = one hex. */
  tile?: string;
  /** Walls that belong to this (rotating) cell, in local coords at offset 0. */
  ownWalls?: string;
  done: boolean;
  enter: Enter;
  delay: number;
  refCb?: (i: number, el: SVGGElement | null) => void;
}

const DEG = Math.PI / 180;
const m6 = (d: number) => ((d % 6) + 6) % 6;
const pol = (r: number, aDeg: number) => `${(r * Math.cos(aDeg * DEG)).toFixed(2)},${(r * Math.sin(aDeg * DEG)).toFixed(2)}`;

function Num({ v, y = 0, size = 24 }: { v: string; y?: number; size?: number }) {
  return (
    <text key={v} class="cn" y={y} font-size={size} text-anchor="middle" dominant-baseline="central">
      {v}
    </text>
  );
}

/** Ray: a solid arrowhead, its tip on the edge it looks through. */
function EdgeArrow({ d }: { d: number }) {
  return (
    <g transform={`rotate(${EDGE_ANGLE[m6(d)]})`}>
      <path class="c-arrow" d="M16.4,-9.8 L31,0 L16.4,9.8 L20.6,0 Z" />
    </g>
  );
}

/** Cone: a solid fan opening towards its corner. Triangle: the far part of it, as an open outline. */
function Wedge({ c, hollow }: { c: number; hollow?: boolean }) {
  return (
    <g transform={`rotate(${CORNER_ANGLE[m6(c)]})`}>
      {hollow ? <path class="c-tri" d="M22.5,-5 L29.4,-10.2 Q34.4,0 29.4,10.2 L22.5,5 Z" /> : <path class="c-cone" d="M17.5,0 L29.6,-10.6 Q34.8,0 29.6,10.6 Z" />}
    </g>
  );
}

function DotMark({ d, corner }: { d: number; corner?: boolean }) {
  const a = corner ? CORNER_ANGLE[m6(d)] : EDGE_ANGLE[m6(d)];
  return (
    <g transform={`rotate(${a})`}>
      <circle class="c-dot-trail" cx={17.5} r={1.3} />
      <circle class="c-dot-trail" cx={22.2} r={1.3} />
      <circle class="c-dot" cx={28.4} r={3.7} />
    </g>
  );
}

function Swirl({ d, ccw }: { d: number; ccw?: boolean }) {
  const a0 = EDGE_ANGLE[m6(d)];
  const a1 = a0 + (ccw ? -120 : 120);
  const r = 23.5;
  const tang = a1 + (ccw ? -90 : 90);
  const ex = r * Math.cos(a1 * DEG), ey = r * Math.sin(a1 * DEG);
  return (
    <g>
      <path class="c-swirl" d={`M${pol(r, a0)} A${r},${r} 0 0 ${ccw ? 0 : 1} ${pol(r, a1)}`} />
      <path class="c-swirl-head" d="M-3.5,-5.2 L5.5,0 L-3.5,5.2 Z" transform={`translate(${ex.toFixed(2)} ${ey.toFixed(2)}) rotate(${tang})`} />
      <circle class="c-swirl-start" cx={r * Math.cos(a0 * DEG)} cy={r * Math.sin(a0 * DEG)} r={2.4} />
    </g>
  );
}

function Braces({ mod, w = 15 }: { mod: 'together' | 'apart'; w?: number }) {
  if (mod === 'together')
    return (
      <g class="c-mod">
        <path d={`M${-w + 2},-11 q-3.5,0 -3.5,3.5 v3.5 q0,4 -3,4 q3,0 3,4 v3.5 q0,3.5 3.5,3.5`} />
        <path d={`M${w - 2},-11 q3.5,0 3.5,3.5 v3.5 q0,4 3,4 q-3,0 -3,4 v3.5 q0,3.5 -3.5,3.5`} />
      </g>
    );
  return (
    <g class="c-mod">
      <path d={`M${-w - 5},0 h6`} />
      <path d={`M${w - 1},0 h6`} />
    </g>
  );
}

/** The hidden object as drawn on the board (theme art: ui/art/Piece.tsx). */
export const CrystalGlyph = PieceGlyph;

/** Padlock outline with the remaining count in mono. */
export function LockGlyph({ n }: { n: number }) {
  return (
    <g class="lockg">
      <path class="lk-shackle" d="M-6.5,-4 V-9 a6.5,6.5 0 0 1 13,0 V-4" />
      <rect class="lk-body" x={-12} y={-4} width={24} height={19} rx={3} />
      <text key={n} class="lk-n" y={5.8} font-size={12.5} text-anchor="middle" dominant-baseline="central">
        {n}
      </text>
    </g>
  );
}

function EyeGlyph() {
  return (
    <g class="c-eye">
      <path class="eye-lid" d="M-25,0 Q0,-22 25,0 Q0,22 -25,0 Z" />
      <path class="eye-lash" d="M-12,-11 L-14.5,-15.5 M0,-12.6 V-18 M12,-11 L14.5,-15.5" />
      <circle class="eye-iris" r={12.5} />
    </g>
  );
}

function ChainGlyph() {
  return (
    <g class="c-chain" transform="translate(0 -15) rotate(-20)">
      <rect x={-11} y={-4.2} width={12.5} height={8.4} rx={4.2} />
      <rect x={-1.5} y={-4.2} width={12.5} height={8.4} rx={4.2} />
    </g>
  );
}

function ParityGlyph({ odd }: { odd: boolean }) {
  return (
    <g class={'c-par' + (odd ? ' odd' : ' even')}>
      <g class="deco">
        {odd ? (
          <circle class="dot" cy={-7} r={4} />
        ) : (
          <>
            <circle class="dot" cx={-6.5} cy={-7} r={4} />
            <circle class="dot" cx={6.5} cy={-7} r={4} />
          </>
        )}
      </g>
      <text class="cn par-lbl" y={12.5} font-size={odd ? 10.5 : 11.5} text-anchor="middle" dominant-baseline="central">
        {t(odd ? 'odd' : 'even')}
      </text>
    </g>
  );
}

const deco = (children: ComponentChildren) => <g class="deco">{children}</g>;

/** Clue drawing for an open (or marked gemclue) unit. Direction decorations rotate with `rotDeg`. */
export function ClueGlyph({ clue, value, rotDeg = 0, onGem }: { clue: LooseClue | undefined; value: string; rotDeg?: number; onGem?: boolean }) {
  if (!clue) return null;
  const rot = (children: ComponentChildren) => (
    <g class="rotg deco" style={{ transform: `rotate(${rotDeg}deg)` }}>
      {children}
    </g>
  );
  const dirs = clue.dirs ?? [0];
  const long = value.length > 1;
  const body = (() => {
    switch (clue.k) {
      case 'blank':
        return deco(<path class="c-blank" d="M-7,0 H7" />);
      case 'num':
        if (clue.mod)
          return (
            <g>
              {deco(<Braces mod={clue.mod} w={clue.mod === 'apart' ? 13 : 15} />)}
              <Num v={value} size={21} />
            </g>
          );
        return <Num v={value} size={long ? 22 : 24} />;
      case 'line':
        return (
          <g>
            {rot(dirs.map((d) => <EdgeArrow d={d} key={d} />))}
            {clue.mod ? deco(<Braces mod={clue.mod} w={12} />) : null}
            <Num v={value} size={clue.mod ? 17 : long ? 19 : 22} />
          </g>
        );
      case 'cone':
      case 'triangle':
        return (
          <g>
            {rot(dirs.map((c) => <Wedge c={c} key={c} hollow={clue.k === 'triangle'} />))}
            <Num v={value} size={long ? 19 : 21} />
          </g>
        );
      case 'dot':
        return (
          <g>
            {rot(dirs.map((d) => <DotMark d={d} key={d} corner={clue.corner} />))}
            <Num v={value} size={21} />
          </g>
        );
      case 'swirl':
        return (
          <g>
            {rot(<Swirl d={dirs[0] ?? 0} ccw={clue.ccw} />)}
            <Num v={value} size={20} />
          </g>
        );
      case 'radius':
        return (
          <g>
            {deco(<circle class="c-radius" r={18.5} />)}
            <Num v={value} size={long ? 17 : 20} />
          </g>
        );
      case 'ring':
        return (
          <g>
            {deco(<circle class="c-ring" r={17.5} />)}
            <Num v={value} size={long ? 15.5 : 18} />
          </g>
        );
      case 'donut':
        return (
          <g>
            {deco(
              <>
                <circle class="c-donut" r={21.5} />
                <circle class="c-donut" r={16} />
              </>,
            )}
            <Num v={value} size={long ? 14 : 16.5} />
          </g>
        );
      case 'island':
        return (
          <g>
            {deco(<path class="c-island" d="M-19,-3 C-20,-14 -7,-20 3,-18 C14,-16 21,-8 19,3 C17,13 6,19 -5,18 C-15,17 -18,8 -19,-3 Z" />)}
            <Num v={value} size={long ? 16 : 18} />
          </g>
        );
      case 'chain':
        return (
          <g>
            {deco(<ChainGlyph />)}
            <Num v={value} y={7} size={long ? 17 : 19} />
          </g>
        );
      case 'eye':
        return (
          <g>
            {deco(<EyeGlyph />)}
            <Num v={value} size={long ? 14 : 17} />
          </g>
        );
      case 'parity':
        return <ParityGlyph odd={value === 'odd'} />;
      default:
        return value ? <Num v={value} /> : null;
    }
  })();
  return onGem ? <g class="on-gem">{body}</g> : body;
}

function HiddenTile({ locked, lockN, tile }: { locked: boolean; lockN: number; tile: string }) {
  return (
    <>
      <path class="t-base" d={tile} transform="translate(0 1.6)" />
      <path class="t-face" d={tile} />
      <path class="t-hi" d={tile} />
      {locked && <LockGlyph n={lockN} />}
    </>
  );
}

function Badges({ rotating, switching }: { rotating: boolean; switching: boolean }) {
  if (!rotating && !switching) return null;
  return (
    <g class="cbadge" transform="translate(-22 -17) scale(1.25)">
      <circle r={7.5} />
      {rotating ? (
        <path class="cb-ic" d="M-3.6,-1.2 A3.8,3.8 0 0 1 3.4,-1.6 M3.6,1.2 A3.8,3.8 0 0 1 -3.4,1.6 M3.4,-1.6 l0.2,-2.4 M3.4,-1.6 l-2.3,-0.4 M-3.4,1.6 l-0.2,2.4 M-3.4,1.6 l2.3,0.4" />
      ) : (
        <>
          <circle class="cb-dot on" cx={-2.6} r={1.8} />
          <circle class="cb-dot" cx={2.6} r={1.8} />
        </>
      )}
    </g>
  );
}

/** The face of a unit for one state; enter animation is frozen at mount. */
function Face(p: CellProps) {
  const [enter] = useState(p.enter);
  const [delay] = useState(p.delay);
  const [wasLocked] = useState(p.enter === 'unlock');
  const tile = p.tile ?? TILE_PATH;
  const style = delay ? { animationDelay: `${delay}ms` } : undefined;
  const walls = p.ownWalls ? (
    <g class="rotg own-walls" style={{ transform: `rotate(${p.rotDeg}deg)` }}>
      <path class="wall-shadow" d={p.ownWalls} />
      <path class="wall" d={p.ownWalls} />
    </g>
  ) : null;
  // while a delayed reveal waits for its turn, the old hidden tile stays visible
  const ghost =
    delay > 0 && (enter === 'flip' || enter === 'pop' || enter === 'unlock') ? (
      <g class={'cghost hid' + (wasLocked ? ' locked' : '')} style={style}>
        <HiddenTile locked={wasLocked} lockN={0} tile={tile} />
      </g>
    ) : null;
  if (p.st === CellState.Hidden && p.fog) {
    return (
      <g class={`face fogf e-${enter === 'deal' ? 'deal' : 'none'}`} style={style}>
        <path class="t-fog" d={tile} />
        {walls}
      </g>
    );
  }
  if (p.st === CellState.Hidden) {
    const locked = p.lockN > 0;
    return (
      <g class={`face hid${locked ? ' locked' : ''} e-${enter}`} style={style}>
        <HiddenTile locked={locked} lockN={p.lockN} tile={tile} />
        {walls}
        <Badges rotating={p.rotating} switching={p.switching} />
      </g>
    );
  }
  if (p.st === CellState.Marked) {
    const gc = !!p.clue;
    const e = enter === 'deal' || enter === 'none' || enter === 'rewind' ? enter : 'pop';
    return (
      <>
        {ghost}
        <g class={`face gem e-${e}`} style={style}>
          <path class="t-base" d={tile} transform="translate(0 1.6)" />
          <path class="t-face" d={tile} />
          {gc ? (
            <g class={p.done ? 'clue done' : 'clue'} key={p.glyphKey}>
              <ClueGlyph clue={p.clue} value={p.value} rotDeg={p.rotDeg} onGem />
            </g>
          ) : (
            <g class="gem-g">
              <CrystalGlyph scale={1} />
            </g>
          )}
          {walls}
          <Badges rotating={p.rotating} switching={p.switching} />
        </g>
      </>
    );
  }
  return (
    <>
      {ghost}
      <g class={`face open e-${enter}`} style={style}>
        <path class="t-base" d={tile} transform="translate(0 1.6)" />
        <path class="t-face" d={tile} />
        <g class={(p.done ? 'clue done' : 'clue') + (p.switching ? ' morph' : '')} key={p.glyphKey}>
          <ClueGlyph clue={p.clue} value={p.value} rotDeg={p.rotDeg} />
        </g>
        {walls}
        <Badges rotating={p.rotating} switching={p.switching} />
      </g>
      {enter === 'unlock' && (
        <g class="unlock-fly" style={style}>
          <LockGlyph n={0} />
        </g>
      )}
    </>
  );
}

function CellImpl(p: CellProps) {
  return (
    <g class="cell" transform={`translate(${p.x.toFixed(2)} ${p.y.toFixed(2)})`}>
      <g class="ci" ref={(el) => p.refCb?.(p.i, el)}>
        <Face key={`${p.st}${p.fog ? 'f' : ''}`} {...p} />
      </g>
    </g>
  );
}

export const Cell = memo(CellImpl, (a, b) => {
  return (
    a.st === b.st &&
    a.fog === b.fog &&
    a.lockN === b.lockN &&
    a.value === b.value &&
    a.rotDeg === b.rotDeg &&
    a.glyphKey === b.glyphKey &&
    a.done === b.done &&
    a.x === b.x &&
    a.y === b.y &&
    a.clue === b.clue &&
    a.tile === b.tile
  );
});
