// One unit of the board: tile + clue glyph. Pure SVG, memoised; one-off effects (shake, bloom)
// are played imperatively through the element handed to `refCb`.
//
// Visual language of the clue glyphs (number always upright in the centre):
//   line = thin coral arrow on the edge · cone = wide blue wedge · triangle = hollow wedge
//   radius = circle · ring = double circle · donut = thick torus · dot = small dot marker
//   swirl = curved arrow · island = island outline · chain = chain links · eye = eye
//   parity = one / two dots · together {n} · apart -n- · blank = faint dot

import type { ComponentChildren } from 'preact';
import { memo } from 'preact/compat';
import { useState } from 'preact/hooks';
import { CORNER_ANGLE, EDGE_ANGLE } from '../../core/hex';
import { CellState } from '../../core/types';
import { TILE_PATH } from './geometry';
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

function Num({ v, y = 0, size = 25 }: { v: string; y?: number; size?: number }) {
  return (
    <text key={v} class="cn" y={y} font-size={size} text-anchor="middle" dominant-baseline="central">
      {v}
    </text>
  );
}

function EdgeArrow({ d }: { d: number }) {
  return (
    <g transform={`rotate(${EDGE_ANGLE[m6(d)]})`}>
      <path class="c-arrow" d="M21,-7.6 L31.5,0 L21,7.6 Z" />
    </g>
  );
}

function Wedge({ c, hollow }: { c: number; hollow?: boolean }) {
  return (
    <g transform={`rotate(${CORNER_ANGLE[m6(c)]})`}>
      {hollow ? <path class="c-tri" d="M22,-12 L34,0 L22,12 Q26.5,0 22,-12 Z" /> : <path class="c-cone" d="M19.5,-12.5 L33,0 L19.5,12.5 Q24,0 19.5,-12.5 Z" />}
    </g>
  );
}

function DotMark({ d, corner }: { d: number; corner?: boolean }) {
  const a = corner ? CORNER_ANGLE[m6(d)] : EDGE_ANGLE[m6(d)];
  return (
    <g transform={`rotate(${a})`}>
      <circle class="c-dot-trail" cx={17} r={1.6} />
      <circle class="c-dot-trail" cx={22.5} r={1.9} />
      <circle class="c-dot" cx={29} r={4.4} />
    </g>
  );
}

function Swirl({ d, ccw }: { d: number; ccw?: boolean }) {
  const a0 = EDGE_ANGLE[m6(d)];
  const a1 = a0 + (ccw ? -120 : 120);
  const r = 24;
  const tang = a1 + (ccw ? -90 : 90);
  const ex = r * Math.cos(a1 * DEG), ey = r * Math.sin(a1 * DEG);
  return (
    <g>
      <path class="c-swirl" d={`M${pol(r, a0)} A${r},${r} 0 0 ${ccw ? 0 : 1} ${pol(r, a1)}`} />
      <path class="c-swirl-head" d="M-4,-6 L6,0 L-4,6 Z" transform={`translate(${ex.toFixed(2)} ${ey.toFixed(2)}) rotate(${tang})`} />
      <circle class="c-swirl-start" cx={r * Math.cos(a0 * DEG)} cy={r * Math.sin(a0 * DEG)} r={3} />
    </g>
  );
}

function Braces({ mod, w = 15 }: { mod: 'together' | 'apart'; w?: number }) {
  if (mod === 'together')
    return (
      <g class="c-mod">
        <path d={`M${-w + 2},-11 q-4,0 -4,4 v3 q0,4 -3,4 q3,0 3,4 v3 q0,4 4,4`} />
        <path d={`M${w - 2},-11 q4,0 4,4 v3 q0,4 3,4 q-3,0 -3,4 v3 q0,4 -4,4`} />
      </g>
    );
  return (
    <g class="c-mod">
      <path d={`M${-w - 5},0 h6`} />
      <path d={`M${w - 1},0 h6`} />
    </g>
  );
}

export function CrystalGlyph({ scale = 1, y = 0 }: { scale?: number; y?: number }) {
  return (
    <g class="crystal" transform={`translate(0 ${y}) scale(${scale})`}>
      <path class="cr-body" d="M-13,-5 L-6.5,-13 L6.5,-13 L13,-5 L0,14 Z" />
      <path class="cr-facet" d="M-13,-5 H13 M-6.5,-13 L-3,-5 L0,14 L3,-5 L6.5,-13" />
      <path class="cr-shine" d="M-8.5,-6.5 L-5,-10.8 L-2.8,-6.5 Z" />
    </g>
  );
}

export function LockGlyph({ n }: { n: number }) {
  return (
    <g class="lockg">
      <path class="lk-shackle" d="M-7.5,-3 V-9.5 a7.5,7.5 0 0 1 15,0 V-3" />
      <rect class="lk-body" x={-13} y={-4} width={26} height={21} rx={6} />
      <text key={n} class="lk-n" y={6.8} font-size={13} text-anchor="middle" dominant-baseline="central">
        {n}
      </text>
    </g>
  );
}

function EyeGlyph() {
  return (
    <g class="c-eye" transform="translate(0 -13)">
      <path d="M-12,0 Q0,-10 12,0 Q0,10 -12,0 Z" />
      <circle r={3.6} />
    </g>
  );
}

function ChainGlyph() {
  return (
    <g class="c-chain" transform="translate(0 -14) rotate(-20)">
      <rect x={-11.5} y={-4.5} width={13} height={9} rx={4.5} />
      <rect x={-1.5} y={-4.5} width={13} height={9} rx={4.5} />
    </g>
  );
}

function ParityGlyph({ odd }: { odd: boolean }) {
  return (
    <g class="c-par">
      <rect x={-17} y={-10.5} width={34} height={21} rx={10.5} />
      {odd ? <circle class="dot" r={5} /> : [<circle key="a" class="dot" cx={-6.5} r={4.6} />, <circle key="b" class="dot" cx={6.5} r={4.6} />]}
    </g>
  );
}

/** Clue drawing for an open (or marked gemclue) unit. Direction decorations rotate with `rotDeg`. */
export function ClueGlyph({ clue, value, rotDeg = 0, onGem }: { clue: LooseClue | undefined; value: string; rotDeg?: number; onGem?: boolean }) {
  if (!clue) return null;
  const rot = (children: ComponentChildren) => (
    <g class="rotg" style={{ transform: `rotate(${rotDeg}deg)` }}>
      {children}
    </g>
  );
  const dirs = clue.dirs ?? [0];
  switch (clue.k) {
    case 'blank':
      return <circle class="c-blank" r={3.4} />;
    case 'num':
      if (clue.mod)
        return (
          <g>
            <Braces mod={clue.mod} w={clue.mod === 'apart' ? 13 : 15} />
            <Num v={value} size={22} />
          </g>
        );
      return <Num v={value} />;
    case 'line':
      return (
        <g>
          {rot(dirs.map((d) => <EdgeArrow d={d} key={d} />))}
          {clue.mod ? <Braces mod={clue.mod} w={12} /> : null}
          <Num v={value} size={clue.mod ? 18 : 22} />
        </g>
      );
    case 'cone':
    case 'triangle':
      return (
        <g>
          {rot(dirs.map((c) => <Wedge c={c} key={c} hollow={clue.k === 'triangle'} />))}
          <Num v={value} size={21} />
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
        <g class={onGem ? 'on-gem' : ''}>
          <circle class="c-radius" r={17.5} />
          <Num v={value} size={19} />
        </g>
      );
    case 'ring':
      return (
        <g class={onGem ? 'on-gem' : ''}>
          <circle class="c-ring" r={14.5} />
          <circle class="c-ring" r={20} />
          <Num v={value} size={17} />
        </g>
      );
    case 'donut':
      return (
        <g class={onGem ? 'on-gem' : ''}>
          <circle class="c-donut" r={18.5} />
          <Num v={value} size={18} />
        </g>
      );
    case 'island':
      return (
        <g class={onGem ? 'on-gem' : ''}>
          <path class="c-island" d="M-19,-3 C-20,-14 -7,-20 3,-18 C14,-16 21,-8 19,3 C17,13 6,19 -5,18 C-15,17 -18,8 -19,-3 Z" />
          <Num v={value} size={18} />
        </g>
      );
    case 'chain':
      return (
        <g>
          <ChainGlyph />
          <Num v={value} y={8} size={19} />
        </g>
      );
    case 'eye':
      return (
        <g>
          <EyeGlyph />
          <Num v={value} y={8} size={19} />
        </g>
      );
    case 'parity':
      return <ParityGlyph odd={value === 'odd'} />;
    default:
      return value ? <Num v={value} /> : null;
  }
}

function HiddenTile({ locked, lockN, tile }: { locked: boolean; lockN: number; tile: string }) {
  return (
    <>
      <path class="t-base" d={tile} transform="translate(0 3.6)" />
      <path class="t-face" d={tile} />
      <path class="t-hi" d={tile} />
      {locked && <LockGlyph n={lockN} />}
    </>
  );
}

function Badges({ rotating, switching }: { rotating: boolean; switching: boolean }) {
  if (!rotating && !switching) return null;
  return (
    <g class="cbadge" transform="translate(-26.5 0)">
      <circle r={7.5} />
      {rotating ? (
        <path class="cb-ic" d="M-3.6,-1.2 A3.8,3.8 0 0 1 3.4,-1.6 M3.6,1.2 A3.8,3.8 0 0 1 -3.4,1.6 M3.4,-1.6 l0.2,-2.4 M3.4,-1.6 l-2.3,-0.4 M-3.4,1.6 l-0.2,2.4 M-3.4,1.6 l2.3,0.4" />
      ) : (
        <>
          <circle class="cb-dot on" cx={-2.6} r={2} />
          <circle class="cb-dot" cx={2.6} r={2} />
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
          <path class="t-base" d={tile} transform="translate(0 3.6)" />
          <path class="t-face" d={tile} />
          <path class="t-hi" d={tile} />
          {gc ? (
            <g class={p.done ? 'clue done' : 'clue'} key={p.glyphKey}>
              <CrystalGlyph scale={1.9} y={0} />
              <ClueGlyph clue={p.clue} value={p.value} rotDeg={p.rotDeg} onGem />
            </g>
          ) : (
            <g class="gem-g">
              <CrystalGlyph scale={1.12} />
              <path class="twinkle" d="M14,-17 l1.6,4 4,1.6 -4,1.6 -1.6,4 -1.6,-4 -4,-1.6 4,-1.6 Z" />
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
