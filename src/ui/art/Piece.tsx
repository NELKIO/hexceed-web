// The hidden object of the game, drawn in one place so the theme can change without touching
// the board, the counters or the menus. Current theme: «огоньки» — warm glowing lights.
//
//   PieceGlyph — on the board (board units, ~40 = hex circumradius): a luminous core.
//   PieceHalo  — the soft light a lit cell spills onto its neighbours (drawn in a layer above tiles).
//   PieceIcon  — 24×24 UI icon (counter chip, mode switch, stats…).
//   PieceLogo  — the app mark: a hex with a warm glowing core (logo, favicon, PWA icons).
//
// Paint servers (#pc-core, #pc-halo, #pc-lit) live in App.tsx <SvgDefs>, coloured by CSS tokens
// (--glow-*), so light and dark themes recolour everything at once.

import type { JSX } from 'preact';

type P = JSX.SVGAttributes<SVGSVGElement>;

/** The light itself (board units). `scale` 1 ≈ a 30-unit glow with a 10-unit core. */
export function PieceGlyph({ scale = 1, y = 0 }: { scale?: number; y?: number }) {
  return (
    <g class="piece" transform={`translate(0 ${y}) scale(${scale})`}>
      <circle class="pc-aura" r={22} />
      <circle class="pc-core" r={7.6} />
      <circle class="pc-spark" cx={-2.4} cy={-2.6} r={2} />
    </g>
  );
}

/** The light a lit cell spills around it (one circle, shared radial gradient). */
export function PieceHalo({ x, y, r, delay }: { x: number; y: number; r: number; delay?: number }) {
  return <circle class="pc-halo" cx={x.toFixed(1)} cy={y.toFixed(1)} r={r} style={delay ? { animationDelay: `${delay}ms` } : undefined} />;
}

/** 24×24 icon for buttons and chips: a glowing orb with soft rays. */
export function PieceIcon(p: P) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...p} class={'piece-ic ' + (p.class ?? '')}>
      <circle class="pi-halo" cx="12" cy="12" r="10.5" />
      <circle class="pi-ring" cx="12" cy="12" r="7" />
      <circle class="pi-core" cx="12" cy="12" r="4.4" />
      <circle cx="10.7" cy="10.6" r="1.3" fill="#fff" />
    </svg>
  );
}

/** The app mark: a hex with a warm light inside. */
export function PieceLogo(p: P) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" {...p}>
      <defs>
        <linearGradient id="lg-hex" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#3f4588" />
          <stop offset="1" stop-color="#232650" />
        </linearGradient>
        <radialGradient id="lg-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="#fff6dc" />
          <stop offset="0.28" stop-color="#ffd27a" />
          <stop offset="0.62" stop-color="#f59a37" stop-opacity="0.55" />
          <stop offset="1" stop-color="#f08a2e" stop-opacity="0" />
        </radialGradient>
      </defs>
      <path d="M17.5 7.5h29l14.5 24.5-14.5 24.5h-29L3 32z" fill="url(#lg-hex)" />
      <path d="M17.5 7.5h29l14.5 24.5-14.5 24.5h-29L3 32z" fill="none" stroke="#fff" stroke-opacity="0.18" stroke-width="2" />
      <circle cx="32" cy="32" r="22" fill="url(#lg-glow)" />
      <circle cx="32" cy="32" r="8.5" fill="#fff4d6" />
      <circle cx="29.2" cy="29" r="2.6" fill="#fff" />
    </svg>
  );
}

/** Same mark as a standalone SVG string (favicon / PWA icons / OG image). */
export const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3f4588"/><stop offset="1" stop-color="#232650"/></linearGradient><radialGradient id="b" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff6dc"/><stop offset=".28" stop-color="#ffd27a"/><stop offset=".62" stop-color="#f59a37" stop-opacity=".55"/><stop offset="1" stop-color="#f08a2e" stop-opacity="0"/></radialGradient></defs><path d="M17.5 7.5h29l14.5 24.5-14.5 24.5h-29L3 32z" fill="url(#a)"/><path d="M17.5 7.5h29l14.5 24.5-14.5 24.5h-29L3 32z" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="2"/><circle cx="32" cy="32" r="22" fill="url(#b)"/><circle cx="32" cy="32" r="8.5" fill="#fff4d6"/><circle cx="29.2" cy="29" r="2.6" fill="#fff"/></svg>`;
