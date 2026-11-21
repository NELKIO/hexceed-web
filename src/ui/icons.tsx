import type { JSX } from 'preact';

type P = JSX.SVGAttributes<SVGSVGElement>;

const base = (children: JSX.Element | JSX.Element[], p: P, sw = 2) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" {...p}>
    {children}
  </svg>
);

export const IconBack = (p: P) => base(<path d="M15 5l-7 7 7 7" />, p, 2.4);
export const IconChevron = (p: P) => base(<path d="M9 5l7 7-7 7" />, p, 2.4);
export const IconArrow = (p: P) => base(<path d="M5 12h14M13 6l6 6-6 6" />, p, 2.4);
export const IconPlay = (p: P) => base(<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />, p);
export const IconGear = (p: P) =>
  base(
    [
      <circle cx="12" cy="12" r="3" />,
      <path d="M12 2.8v2.4M12 18.8v2.4M4.2 7.5l2.1 1.2M17.7 15.3l2.1 1.2M4.2 16.5l2.1-1.2M17.7 8.7l2.1-1.2" />,
      <path d="M12 5.2a6.8 6.8 0 1 0 0 13.6 6.8 6.8 0 0 0 0-13.6z" />,
    ],
    p,
  );
export const IconHelp = (p: P) => base([<circle cx="12" cy="12" r="9" />, <path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.8" />, <circle cx="12" cy="17.2" r="0.6" fill="currentColor" />], p);
export const IconCalendar = (p: P) =>
  base([<rect x="3.5" y="5" width="17" height="15.5" rx="4" />, <path d="M3.5 10h17M8.5 3v4M15.5 3v4" />, <path d="M12 13.2l.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3z" fill="currentColor" stroke-width="1" />], p);
export const IconInfinity = (p: P) => base(<path d="M7.5 8.5c-2 0-3.5 1.6-3.5 3.5s1.5 3.5 3.5 3.5C11 15.5 13 8.5 16.5 8.5c2 0 3.5 1.6 3.5 3.5s-1.5 3.5-3.5 3.5C13 15.5 11 8.5 7.5 8.5z" />, p, 2.2);
export const IconUsers = (p: P) =>
  base([<circle cx="9" cy="8.5" r="3.5" />, <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />, <path d="M16 5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" />], p);
export const IconHexes = (p: P) =>
  base(
    [
      <path d="M7 3.5l3.5 2v4L7 11.5l-3.5-2v-4z" />,
      <path d="M17 3.5l3.5 2v4l-3.5 2-3.5-2v-4z" />,
      <path d="M12 12.5l3.5 2v4l-3.5 2-3.5-2v-4z" fill="currentColor" fill-opacity="0.25" />,
    ],
    p,
  );
export const IconBulb = (p: P) => base([<path d="M9 18h6M10 21h4" />, <path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.4 1.1 2.2h5c0-.8.4-1.6 1.1-2.2A6 6 0 0 0 12 3z" />], p);
export const IconRestart = (p: P) => base([<path d="M4 12a8 8 0 1 0 2.4-5.7" />, <path d="M4 4.5V9h4.5" />], p, 2.2);
export const IconRotate = (p: P) =>
  base([<path d="M20 12a8 8 0 0 1-13.7 5.7" />, <path d="M4 12a8 8 0 0 1 13.7-5.7" />, <path d="M17.7 2.8v3.9h-3.9M6.3 21.2v-3.9h3.9" />], p, 2.2);
export const IconSkull = (p: P) =>
  base([<path d="M12 3a7.5 7.5 0 0 0-4.5 13.5V19a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-2.5A7.5 7.5 0 0 0 12 3z" />, <circle cx="9.3" cy="11.5" r="1.4" fill="currentColor" />, <circle cx="14.7" cy="11.5" r="1.4" fill="currentColor" />, <path d="M10.5 20v-2M13.5 20v-2" />], p);
export const IconShield = (p: P) => base([<path d="M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z" />], p);
export const IconX = (p: P) => base(<path d="M6 6l12 12M18 6L6 18" />, p, 2.4);
export const IconCheck = (p: P) => base(<path d="M5 12.5l4.5 4.5L19 7.5" />, p, 2.6);
export const IconSun = (p: P) => base([<circle cx="12" cy="12" r="4" />, <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />], p);
export const IconMoon = (p: P) => base(<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />, p);
export const IconAuto = (p: P) => base([<circle cx="12" cy="12" r="8.5" />, <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" />], p);
export const IconVolume = (p: P) => base([<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />, <path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />], p);
export const IconVibrate = (p: P) => base([<rect x="7.5" y="3.5" width="9" height="17" rx="2.5" />, <path d="M3.5 9v6M20.5 9v6" />], p);
export const IconHand = (p: P) =>
  base([<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5M14 10.5V5.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.5a6 6 0 0 1-4.8-2.4L3.4 15.5a1.6 1.6 0 0 1 2.4-2l2.2 2" />], p);
export const IconEye = (p: P) => base([<path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />, <circle cx="12" cy="12" r="3" />], p);
export const IconTrash = (p: P) => base([<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" />], p);
export const IconGlobe = (p: P) => base([<circle cx="12" cy="12" r="9" />, <path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9S14.5 18.4 12 21c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z" />], p);
export const IconPalette = (p: P) => base([<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.2-1-1.6-1-2.8 0-1 .8-1.6 1.8-1.6H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z" />, <circle cx="7.5" cy="11" r="1.2" fill="currentColor" />, <circle cx="10" cy="7" r="1.2" fill="currentColor" />, <circle cx="15" cy="7.2" r="1.2" fill="currentColor" />], p);
export const IconClock = (p: P) => base([<circle cx="12" cy="12" r="9" />, <path d="M12 7v5l3 2" />], p);
export const IconShare = (p: P) => base([<path d="M12 15V3.5M7.5 8L12 3.5 16.5 8" />, <path d="M5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6.5" />], p);
export const IconLock = (p: P) => base([<rect x="5" y="10.5" width="14" height="10" rx="3" />, <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />], p);
export const IconLink = (p: P) => base([<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" />, <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />], p);
export const IconCopy = (p: P) => base([<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5" />, <path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" />], p);
export const IconTrophy = (p: P) => base([<path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0z" />, <path d="M7.5 6H4.5a3 3 0 0 0 3 4M16.5 6h3a3 3 0 0 1-3 4M12 13.5V17M8.5 20.5h7M9.5 17h5" />], p);
export const IconSync = (p: P) => base([<path d="M19.5 12a7.5 7.5 0 0 1-12.8 5.3M4.5 12a7.5 7.5 0 0 1 12.8-5.3" />, <path d="M17.5 3v3.8h-3.8M6.5 21v-3.8h3.8" />], p);
export const IconDevices = (p: P) => base([<rect x="2.5" y="5" width="13" height="10" rx="2" />, <path d="M6 19h6" />, <rect x="17" y="8" width="5" height="11" rx="1.5" />], p);
export const IconTarget = (p: P) => base([<path d="M12 3.5l7.4 4.25v8.5L12 20.5l-7.4-4.25v-8.5z" />, <circle cx="12" cy="12" r="1.5" fill="currentColor" />], p);

/** Hex outline: the "open" tool. */
export const IconOpen = (p: P) =>
  base([<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z" />, <path d="M9 12.5l2 2 4-4.5" />], p, 2.2);

/** Faceted crystal. */
export const IconGem = (p: P) =>
  base(
    [
      <path d="M3.5 9.5L7.5 4.5h9l4 5L12 20.5z" fill="currentColor" fill-opacity="0.18" />,
      <path d="M3.5 9.5h17M9.5 4.5L8 9.5l4 11 4-11-1.5-5" />,
    ],
    p,
    2,
  );

export function IconStar({ filled = true, ...p }: P & { filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...p}>
      <path
        d="M12 2.8l2.75 5.6 6.15.9-4.45 4.33 1.05 6.12L12 16.87l-5.5 2.88 1.05-6.12L3.1 9.3l6.15-.9z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        stroke-width={filled ? 0 : 1.8}
        stroke-linejoin="round"
      />
    </svg>
  );
}

/** Logo mark: a glowing hex with a crystal inside. */
export function LogoMark(p: P) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" {...p}>
      <defs>
        <linearGradient id="lg-hex" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#9b6cff" />
          <stop offset="1" stop-color="#1fc8b5" />
        </linearGradient>
        <linearGradient id="lg-gem" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffffff" />
          <stop offset="1" stop-color="#e6ddff" />
        </linearGradient>
      </defs>
      <path d="M17.5 7.5h29l14.5 24.5-14.5 24.5h-29L3 32z" fill="url(#lg-hex)" />
      <path d="M17.5 7.5h29l14.5 24.5-14.5 24.5h-29L3 32z" fill="none" stroke="#fff" stroke-opacity="0.35" stroke-width="2" />
      <path d="M19 27l6.5-8h13L45 27 32 47z" fill="url(#lg-gem)" />
      <path d="M19 27h26M25.5 19l3 8L32 47l3.5-20 3-8" fill="none" stroke="#8b5cf6" stroke-opacity="0.45" stroke-width="1.6" stroke-linejoin="round" />
      <path d="M22.5 26l3.6-4.5 1.6 4.5z" fill="#fff" />
    </svg>
  );
}
