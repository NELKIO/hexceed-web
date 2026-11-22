// The hidden object of the game, drawn in one place so the theme can change without touching
// the board, the counters or the menus. Theme v3 «Instrument»: one warm light in dark glass.
//
//   PieceGlyph — on the board (board units, ~40 = hex circumradius): a thin ring around a small
//                bright core, with a soft inner light. The tile itself (dark glass) is drawn by Cell.
//   PieceHalo  — the soft light a lit cell spills onto its neighbours (drawn in a layer above tiles).
//   PieceIcon  — 24×24 UI icon (counter, mode switch, stats…): ring + core.
//   PieceLogo  — the app mark: a graphite hex with a single lit core (logo, favicon, PWA icons).
//
// Paint servers (#pc-core, #pc-aura, #pc-halo) live in App.tsx <SvgDefs>, coloured by CSS tokens
// (--lume*), so light and dark themes recolour everything at once.

import type { JSX } from 'preact';

type P = JSX.SVGAttributes<SVGSVGElement>;

/** The light itself (board units). `scale` 1 = a 12.5-unit ring around a 6.5-unit core. */
export function PieceGlyph({ scale = 1, y = 0 }: { scale?: number; y?: number }) {
  return (
    <g class="piece" transform={`translate(0 ${y}) scale(${scale})`}>
      <circle class="pc-aura" r={27} />
      <circle class="pc-flash" r={12.5} />
      <circle class="pc-ring" r={12.5} />
      <circle class="pc-core" r={6.6} />
    </g>
  );
}

/** The light a lit cell spills around it (one circle, shared radial gradient). */
export function PieceHalo({ x, y, r, delay }: { x: number; y: number; r: number; delay?: number }) {
  return <circle class="pc-halo" cx={x.toFixed(1)} cy={y.toFixed(1)} r={r} style={delay ? { animationDelay: `${delay}ms` } : undefined} />;
}

/** 24×24 icon for buttons and chips: a thin ring around a lit core. */
export function PieceIcon(p: P) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...p} class={'piece-ic ' + (p.class ?? '')}>
      <circle class="pi-ring" cx="12" cy="12" r="7.5" />
      <circle class="pi-core" cx="12" cy="12" r="3.6" />
    </svg>
  );
}

const HEX = 'M17.6 8.2h28.8L60.8 32 46.4 55.8H17.6L3.2 32z';

/** The app mark: a graphite hex with a single warm light inside. */
export function PieceLogo(p: P) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" {...p} class={'logo-mark ' + (p.class ?? '')}>
      <defs>
        <radialGradient id="lg-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="#f4c77a" stop-opacity="0.55" />
          <stop offset="0.55" stop-color="#f4c77a" stop-opacity="0.12" />
          <stop offset="1" stop-color="#f4c77a" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="lg-core" cx="0.45" cy="0.42" r="0.6">
          <stop offset="0" stop-color="#fffaf0" />
          <stop offset="0.6" stop-color="#ffe6b5" />
          <stop offset="1" stop-color="#f4c77a" />
        </radialGradient>
      </defs>
      <path class="lm-hex" d={HEX} />
      <circle cx="32" cy="32" r="20" fill="url(#lg-glow)" />
      <circle cx="32" cy="32" r="10.5" fill="none" stroke="#f4c77a" stroke-width="1.6" />
      <circle cx="32" cy="32" r="5.6" fill="url(#lg-core)" />
    </svg>
  );
}

/** Same mark as a standalone SVG string (favicon / PWA icons / OG image). */
export const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><radialGradient id="g" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#f4c77a" stop-opacity=".55"/><stop offset=".55" stop-color="#f4c77a" stop-opacity=".12"/><stop offset="1" stop-color="#f4c77a" stop-opacity="0"/></radialGradient><radialGradient id="c" cx=".45" cy=".42" r=".6"><stop offset="0" stop-color="#fffaf0"/><stop offset=".6" stop-color="#ffe6b5"/><stop offset="1" stop-color="#f4c77a"/></radialGradient></defs><path d="${HEX}" fill="#1a1d23" stroke="#ffffff" stroke-opacity=".14" stroke-width="1.2"/><circle cx="32" cy="32" r="20" fill="url(#g)"/><circle cx="32" cy="32" r="10.5" fill="none" stroke="#f4c77a" stroke-width="1.6"/><circle cx="32" cy="32" r="5.6" fill="url(#c)"/></svg>`;
