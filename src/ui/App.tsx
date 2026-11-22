import { Component, type ComponentChildren } from 'preact';
import { goBack, matchRoute, navigate, usePath } from '../router';
import { saveProgress } from '../storage';
import { hideNotice, useNotice } from './notice';
import { t } from '../i18n';
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
        {/* lit cell: bright centre fading to a deeper amber rim */}
        <radialGradient id="g-gem" cx="0.5" cy="0.46" r="0.62">
          <stop offset="0" style={{ stopColor: 'var(--lit-c)' }} />
          <stop offset="0.55" style={{ stopColor: 'var(--lit-m)' }} />
          <stop offset="1" style={{ stopColor: 'var(--lit-e)' }} />
        </radialGradient>
        {/* colour-blind mode: closed cells carry a fine hatch, so they differ by pattern too */}
        <pattern id="p-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="7" height="7" fill="none" />
          <line x1="0" y1="0" x2="0" y2="7" style={{ stroke: 'var(--hid-edge)', strokeWidth: 2.2 }} />
        </pattern>
                <radialGradient id="pc-core" cx="0.42" cy="0.4" r="0.6">
          <stop offset="0" style={{ stopColor: '#fffdf4' }} />
          <stop offset="0.7" style={{ stopColor: 'var(--core-e)' }} />
          <stop offset="1" style={{ stopColor: 'var(--core-e)' }} />
        </radialGradient>
        <radialGradient id="pc-aura" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" style={{ stopColor: '#fffcef', stopOpacity: 1 }} />
          <stop offset="0.38" style={{ stopColor: '#fff1c4', stopOpacity: 0.9 }} />
          <stop offset="0.72" style={{ stopColor: 'var(--glow-1)', stopOpacity: 0.3 }} />
          <stop offset="1" style={{ stopColor: 'var(--glow-1)', stopOpacity: 0 }} />
        </radialGradient>
        <radialGradient id="pc-halo" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.35" style={{ stopColor: 'var(--glow-1)', stopOpacity: 0.55 }} />
          <stop offset="0.7" style={{ stopColor: 'var(--glow-2)', stopOpacity: 0.16 }} />
          <stop offset="1" style={{ stopColor: 'var(--glow-2)', stopOpacity: 0 }} />
        </radialGradient>
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

/** Storage key of the level a game route plays (to reset a broken save). */
function saveKeyOf(path: string): string | null {
  let m = /^\/play\/([^/]+)/.exec(path);
  if (m) return decodeURIComponent(m[1]);
  if (/^\/daily/.test(path)) {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `daily-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  m = /^\/endless\/([a-z]+)\/([^/]+)/.exec(path);
  return m ? `endless-${m[1]}-${decodeURIComponent(m[2])}` : null;
}

/** Any render error shows a calm way out instead of a blank page. */
class ErrorBoundary extends Component<{ path: string; children: ComponentChildren }, { err: unknown }> {
  state = { err: null as unknown };
  static getDerivedStateFromError(err: unknown) {
    return { err };
  }
  componentDidCatch(err: unknown) {
    console.error('[hexlume] screen crashed', err);
  }
  componentDidUpdate(prev: { path: string }) {
    if (prev.path !== this.props.path && this.state.err) this.setState({ err: null });
  }
  render() {
    if (!this.state.err) return this.props.children;
    const key = saveKeyOf(this.props.path);
    return (
      <div class="screen center crash">
        <div class="screen-inner">
          <div class="crash-box">
            <h2>{t('errTitle')}</h2>
            {key && <p>{t('errText')}</p>}
            {key && (
              <button
                class="btn cta"
                onClick={() => {
                  saveProgress(key, null);
                  this.setState({ err: null });
                }}
              >
                {t('errReset')}
              </button>
            )}
            <button
              class="btn ghost"
              onClick={() => {
                this.setState({ err: null });
                if (this.props.path === '/') location.reload();
                else navigate('/', true);
              }}
            >
              {t('toMenu')}
            </button>
          </div>
        </div>
      </div>
    );
  }
}

function GlobalNotice() {
  const n = useNotice();
  if (!n) return null;
  return (
    <div class="gnotice" key={n.key} role="status" onClick={() => hideNotice()}>
      <span>{n.text}</span>
      {n.action && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            n.action!.run();
            hideNotice();
          }}
        >
          {n.action.label}
        </button>
      )}
    </div>
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
        <ErrorBoundary path={path}>
          <Comp params={m?.params ?? []} path={path} />
        </ErrorBoundary>
      </div>
      <GlobalNotice />
    </>
  );
}

export { goBack };
