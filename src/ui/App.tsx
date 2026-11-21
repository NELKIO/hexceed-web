import { matchRoute, usePath } from '../router';
import { MenuScreen } from './screens/Menu';
import { useSettings } from './settings';

/** Shared SVG paint servers (gradients), referenced by every board on the page. */
function SvgDefs() {
  return (
    <svg class="defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="g-hid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--hid-top)' }} />
          <stop offset="1" style={{ stopColor: 'var(--hid-bot)' }} />
        </linearGradient>
        <linearGradient id="g-gem" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--gem-1)' }} />
          <stop offset="1" style={{ stopColor: 'var(--gem-2)' }} />
        </linearGradient>
        <linearGradient id="g-lock" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--lock-top)' }} />
          <stop offset="1" style={{ stopColor: 'var(--lock-bot)' }} />
        </linearGradient>
        <linearGradient id="g-cta" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--accent-1)' }} />
          <stop offset="1" style={{ stopColor: 'var(--accent-2)' }} />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function App() {
  useSettings();
  const path = usePath();
  const m = matchRoute(path);
  const Comp = m?.def.component ?? MenuScreen;
  return (
    <>
      <SvgDefs />
      <div class="route" key={m?.def.name === 'play' ? 'play' : path}>
        <Comp params={m?.params ?? []} path={path} />
      </div>
    </>
  );
}
