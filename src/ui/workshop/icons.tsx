// Line icons of the editor tools (24×24, 1.5px strokes, same family as ui/icons.tsx).

import type { JSX } from 'preact';

type P = JSX.SVGAttributes<SVGSVGElement>;

const base = (children: JSX.Element | JSX.Element[], p: P, sw = 1.5) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" {...p}>
    {children}
  </svg>
);

const HEX = 'M7.5 4.2h9L21 12l-4.5 7.8h-9L3 12z';
const SMALL = (cx: number, cy: number, r: number) => {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return 'M' + pts.join('L') + 'Z';
};

export const IcPaint = (p: P) => base([<path d={HEX} />, <path d="M12 8.6v6.8M8.6 12h6.8" />], p);
export const IcClue = (p: P) => base([<path d={HEX} />, <path d="M10.6 9.4l1.9-1.2v7.6" />], p);
export const IcStart = (p: P) => base([<path d={HEX} />, <path d="M10.2 8.8v6.4l5-3.2z" fill="currentColor" stroke-width={1.2} />], p);
export const IcWall = (p: P) => base([<path d={SMALL(7.5, 12, 5)} stroke-opacity={0.55} />, <path d={SMALL(16.5, 7, 5)} stroke-opacity={0.55} />, <path d="M10 7.7l4 7" stroke-width={3} stroke-linecap="square" />], p);
export const IcPortal = (p: P) => base([<path d={SMALL(12, 12, 8)} stroke-opacity={0.55} />, <path d="M8 5.1q4 3 8 0" stroke-width={2.2} />, <path d="M8 18.9q4 -3 8 0" stroke-width={2.2} />], p);
export const IcThread = (p: P) => base([<circle cx="5.5" cy="16.5" r="2" />, <circle cx="18.5" cy="7.5" r="2" />, <path d="M7.3 15.4C10 9 13.5 15 16.7 8.6" />], p);
export const IcZone = (p: P) => base([<path d={HEX} stroke-dasharray="2.2 2.4" />, <path d="M11 9.4l1.8-1v7.4" />], p);
export const IcBig = (p: P) => base([<path d="M3 9.5L5.6 5h5.2l2.6 4.5L16 5h5l-2.6 4.5L21 14l-2.6 4.5h-5.2L10.6 14 8 18.5H3.4L6 14z" />], p);
export const IcUndo = (p: P) => base([<path d="M9 14L4.5 9.5 9 5" />, <path d="M4.5 9.5H14a5.5 5.5 0 0 1 0 11h-3" />], p, 1.7);
export const IcRedo = (p: P) => base([<path d="M15 14l4.5-4.5L15 5" />, <path d="M19.5 9.5H10a5.5 5.5 0 0 0 0 11h3" />], p, 1.7);
export const IcFit = (p: P) => base([<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />], p, 1.6);
export const IcMore = (p: P) => base([<circle cx="6" cy="12" r="1.2" fill="currentColor" />, <circle cx="12" cy="12" r="1.2" fill="currentColor" />, <circle cx="18" cy="12" r="1.2" fill="currentColor" />], p);
export const IcPencil = (p: P) => base([<path d="M4.5 19.5l1-4.2L15.8 5a2 2 0 0 1 2.9 0l.3.3a2 2 0 0 1 0 2.9L8.7 18.5z" />, <path d="M13.8 7l3.2 3.2" />], p);
export const IcPlus = (p: P) => base(<path d="M12 5v14M5 12h14" />, p, 1.8);
export const IcMinus = (p: P) => base(<path d="M5 12h14" />, p, 1.8);
export const IcDup = (p: P) => base([<path d={SMALL(9.5, 13.5, 6)} />, <path d="M10.2 5.6A6 6 0 0 1 20.3 11" />], p);
