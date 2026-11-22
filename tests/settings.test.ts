import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSettings } from '../src/storage';

function readSettings(saved: unknown) {
  const data = new Map([['hexlume:settings', JSON.stringify(saved)]]);
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null });
  return loadSettings();
}

afterEach(() => vi.unstubAllGlobals());

describe('theme migration', () => {
  it('uses light for a fresh install and for the ambiguous old dark default', () => {
    expect(readSettings({}).theme).toBe('light');
    expect(readSettings({ theme: 'dark', volume: 0.4 })).toMatchObject({ theme: 'light', volume: 0.4 });
  });

  it('keeps the old system preference and a new explicit night preference', () => {
    expect(readSettings({ theme: 'auto' }).theme).toBe('auto');
    expect(readSettings({ theme: 'dark', themeChosen: true }).theme).toBe('dark');
  });
});
