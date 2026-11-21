import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { IconBack } from '../icons';
import { sfx } from '../../audio/sfx';
import { t } from '../../i18n';

export function TopBar({ title, onBack, right }: { title?: ComponentChildren; onBack?: () => void; right?: ComponentChildren }) {
  return (
    <header class="topbar">
      {onBack && (
        <button
          class="icon-btn"
          aria-label={t('back')}
          onClick={() => {
            sfx.tick();
            onBack();
          }}
        >
          <IconBack />
        </button>
      )}
      <h1>{title}</h1>
      {right}
    </header>
  );
}

/** Bottom sheet with a scrim. Closes on scrim tap / Escape when `onClose` is given. */
export function Sheet({ open, onClose, children, class: cls = '', label }: { open: boolean; onClose?: () => void; children: ComponentChildren; class?: string; label?: string }) {
  const [shown, setShown] = useState(open);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (open) {
      setShown(true);
      setLeaving(false);
    } else if (shown) {
      setLeaving(true);
      const id = setTimeout(() => {
        setShown(false);
        setLeaving(false);
      }, 220);
      return () => clearTimeout(id);
    }
  }, [open]);
  useEffect(() => {
    if (!open || !onClose) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [open, onClose]);
  if (!shown) return null;
  return (
    <div class={'sheet-root' + (leaving ? ' leaving' : '')} role="dialog" aria-modal="true" aria-label={label}>
      <div class="scrim" onClick={() => onClose?.()} />
      <div class={'sheet ' + cls}>
        <div class="grab" />
        {children}
      </div>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: ComponentChildren; icon?: JSX.Element }[]; onChange: (v: T) => void }) {
  const idx = Math.max(0, options.findIndex((o) => o.v === value));
  return (
    <div class="seg" style={{ '--n': options.length, '--i': idx } as JSX.CSSProperties}>
      <div class="seg-thumb" />
      {options.map((o) => (
        <button
          key={o.v}
          class={o.v === value ? 'on' : ''}
          onClick={() => {
            if (o.v !== value) {
              sfx.toggle();
              onChange(o.v);
            }
          }}
        >
          {o.icon}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      class={'toggle' + (on ? ' on' : '')}
      onClick={() => {
        sfx.toggle();
        onChange(!on);
      }}
    >
      <span class="knob" />
    </button>
  );
}

export function Slider({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const last = useRef(0);
  return (
    <input
      class="slider"
      type="range"
      min={0}
      max={100}
      step={1}
      aria-label={label}
      value={Math.round(value * 100)}
      style={{ '--v': `${Math.round(value * 100)}%` } as JSX.CSSProperties}
      onInput={(e) => {
        const v = Number((e.target as HTMLInputElement).value) / 100;
        onChange(v);
        const now = performance.now();
        if (now - last.current > 120) {
          last.current = now;
          sfx.tick();
        }
      }}
    />
  );
}

export function Stars({ n, size = 16, max = 3, animate = false }: { n: number; size?: number; max?: number; animate?: boolean }) {
  return (
    <span class={'stars' + (animate ? ' fly' : '')} aria-label={`${n}/${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <svg key={i} viewBox="0 0 24 24" width={size} height={size} class={i < n ? 'star on' : 'star'} style={{ '--d': i } as JSX.CSSProperties}>
          <path d="M12 2.8l2.75 5.6 6.15.9-4.45 4.33 1.05 6.12L12 16.87l-5.5 2.88 1.05-6.12L3.1 9.3l6.15-.9z" />
        </svg>
      ))}
    </span>
  );
}

export function fmtTime(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const ss = String(s % 60).padStart(2, '0');
  if (h) return `${h}:${String(m % 60).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

export function useReducedMotion(): boolean {
  const [r, set] = useState(() => {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      const m = window.matchMedia('(prefers-reduced-motion: reduce)');
      const f = () => set(m.matches);
      m.addEventListener?.('change', f);
      return () => m.removeEventListener?.('change', f);
    } catch {
      return undefined;
    }
  }, []);
  return r;
}
