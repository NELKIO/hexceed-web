// A tiny one-hex picture of a mechanic, drawn with the board's own glyphs (how-to-play list).

import type { JSX } from 'preact';
import type { MechanicId } from '../../core/types';
import { ClueGlyph, CrystalGlyph, LockGlyph } from '../game/Cell';
import { blobPath, edgeSegment, TILE_PATH } from '../game/geometry';
import type { LooseClue } from '../game/compat';

const OPEN = (extra?: JSX.Element) => (
  <g class="face open">
    <path class="t-face" d={TILE_PATH} />
    {extra}
  </g>
);

const HIDDEN = (extra?: JSX.Element) => (
  <g class="face hid">
    <path class="t-base" d={TILE_PATH} transform="translate(0 3.6)" />
    <path class="t-face" d={TILE_PATH} />
    <path class="t-hi" d={TILE_PATH} />
    {extra}
  </g>
);

const GEM = (extra?: JSX.Element) => (
  <g class="face gem">
    <path class="t-base" d={TILE_PATH} transform="translate(0 3.6)" />
    <path class="t-face" d={TILE_PATH} />
    <path class="t-hi" d={TILE_PATH} />
    {extra}
  </g>
);

const clue = (c: LooseClue, v: string) => OPEN(<g class="clue"><ClueGlyph clue={c} value={v} /></g>);

const edge = (d: number) => {
  const [a, b] = edgeSegment(0, 0, d, 40);
  return `M${a[0].toFixed(1)},${a[1].toFixed(1)}L${b[0].toFixed(1)},${b[1].toFixed(1)}`;
};

const BIG = blobPath([[0, 0], [1, 0], [0, 1]], [20, 34.64], 2.4);

function art(m: MechanicId): JSX.Element {
  switch (m) {
    case 'basic':
      return clue({ k: 'num' }, '2');
    case 'counter':
      return GEM(<g class="gem-g"><CrystalGlyph /></g>);
    case 'fog':
      return <path class="t-fog" d={TILE_PATH} />;
    case 'walls':
      return OPEN(
        <>
          <g class="clue"><ClueGlyph clue={{ k: 'num' }} value="1" /></g>
          <path class="wall" d={edge(1) + edge(2)} />
        </>,
      );
    case 'gaps':
      return <path class="mi-gap" d={TILE_PATH} />;
    case 'line':
      return clue({ k: 'line', dirs: [1] }, '2');
    case 'multiline':
      return clue({ k: 'line', dirs: [0, 3] }, '3');
    case 'radius':
    case 'ring':
    case 'donut':
    case 'island':
    case 'chain':
    case 'eye':
      return clue({ k: m }, '3');
    case 'cone':
    case 'triangle':
      return clue({ k: m, dirs: [1] }, '2');
    case 'dot':
      return clue({ k: 'dot', dirs: [0] }, '1');
    case 'swirl':
      return clue({ k: 'swirl', dirs: [0] }, '2');
    case 'parity':
      return clue({ k: 'parity' }, 'even');
    case 'blank':
      return clue({ k: 'blank' }, '');
    case 'together':
      return clue({ k: 'num', mod: 'together' }, '2');
    case 'apart':
      return clue({ k: 'num', mod: 'apart' }, '2');
    case 'lock':
      return <g class="face hid locked"><path class="t-base" d={TILE_PATH} transform="translate(0 3.6)" /><path class="t-face" d={TILE_PATH} /><LockGlyph n={2} /></g>;
    case 'gemclue':
      return GEM(
        <g class="clue">
          <ClueGlyph clue={{ k: 'radius' }} value="2" onGem />
        </g>,
      );
    case 'big':
      return (
        <g class="face open" transform="scale(0.62)">
          <path class="t-face" d={BIG} />
          <g class="clue"><ClueGlyph clue={{ k: 'num' }} value="2" /></g>
        </g>
      );
    case 'portal':
      return HIDDEN(<path class="portal" d="M-18,31 Q0,20 18,31" />);
    case 'rotate':
      return OPEN(
        <>
          <g class="clue"><ClueGlyph clue={{ k: 'line', dirs: [1] }} value="1" /></g>
          <path class="mi-rot" d="M-24,-6 A24,24 0 0 1 -6,-24 M-6,-24 l-6,-3 M-6,-24 l-3,6" />
        </>,
      );
    case 'switch':
      return OPEN(
        <>
          <g class="clue"><ClueGlyph clue={{ k: 'ring' }} value="2" /></g>
          <g class="cbadge" transform="translate(-26.5 0)">
            <circle r={7.5} />
            <circle class="cb-dot on" cx={-2.6} r={2} />
            <circle class="cb-dot" cx={2.6} r={2} />
          </g>
        </>,
      );
    case 'link':
      return (
        <g class="link same">
          <path class="thread" d="M-26,14 Q0,-26 26,14" />
          <circle class="knot" cx={-26} cy={14} r={4.5} />
          <circle class="knot" cx={26} cy={14} r={4.5} />
          <g class="link-badge" transform="translate(0 -6)">
            <circle r={12} />
            <path d="M-5,-2.6 H5 M-5,2.6 H5" />
          </g>
        </g>
      );
    case 'zone':
      return (
        <g class="zone">
          <path class="zone-fill" d={TILE_PATH} />
          <path class="zone-line" d={TILE_PATH} />
          <g class="zone-badge">
            <rect x={-14} y={-12} width={28} height={24} rx={12} />
            <text font-size={15} text-anchor="middle" dominant-baseline="central">2</text>
          </g>
        </g>
      );
    default:
      return clue({ k: 'num' }, '?');
  }
}

export function MechIcon({ m, class: cls = '' }: { m: MechanicId; class?: string }) {
  return (
    <svg class={'mech-ic ' + cls} viewBox="-44 -44 88 92" aria-hidden="true">
      {art(m)}
    </svg>
  );
}
