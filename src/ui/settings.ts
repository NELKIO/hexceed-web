import { useEffect, useState } from 'preact/hooks';
import { loadSettings, saveSettings, type Settings } from '../storage';
import { setLang } from '../i18n';
import { setVolume, setVibration } from '../audio/sfx';

let current: Settings = loadSettings();
const subs = new Set<() => void>();
let mql: MediaQueryList | null = null;
const THEME_LIGHT = '#fbf7f1';
const THEME_DARK = '#15131d';

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  saveSettings(current);
  apply();
  subs.forEach((f) => f());
}

export function resolvedTheme(): 'light' | 'dark' {
  if (current.theme !== 'auto') return current.theme;
  return mql?.matches ? 'dark' : 'light';
}

function apply(): void {
  setLang(current.lang);
  setVolume(current.volume);
  setVibration(current.vibration);
  const root = document.documentElement;
  const th = resolvedTheme();
  root.dataset.theme = th;
  root.classList.toggle('cb', current.colorBlind);
  root.classList.toggle('lefty', current.leftHanded);
  // browser chrome colour: per scheme when "auto", the chosen theme's colour otherwise
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    const media = meta.getAttribute('media') ?? '';
    const scheme = current.theme === 'auto' ? (media.includes('dark') ? 'dark' : media.includes('light') ? 'light' : th) : th;
    meta.setAttribute('content', scheme === 'dark' ? THEME_DARK : THEME_LIGHT);
  });
}

export function initSettings(): void {
  try {
    mql = window.matchMedia('(prefers-color-scheme: dark)');
    mql.addEventListener?.('change', () => {
      if (current.theme === 'auto') {
        apply();
        subs.forEach((f) => f());
      }
    });
  } catch {
    mql = null;
  }
  apply();
}

/** Re-render on any settings change (language, theme…). */
export function useSettings(): Settings {
  const [, set] = useState(0);
  useEffect(() => {
    const f = () => set((n) => n + 1);
    subs.add(f);
    return () => void subs.delete(f);
  }, []);
  return current;
}
