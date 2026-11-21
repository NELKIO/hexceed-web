// Main-bundle side of the online features: routes, the Settings row for device sync, and the
// background sync start-up. Everything heavy (WebRTC, Nostr, crypto) is behind dynamic imports.

import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { registerRoute } from '../../router';
import { t } from '../../i18n';
import { sfx } from '../../audio/sfx';
import { Sheet, TopBar } from '../components/ui';
import { IconChevron, IconDevices, LogoMark } from '../icons';
import { hasSyncKey } from '../../net/ids';
import { TogetherScreen } from '../screens/Together';

type SyncMod = typeof import('./SyncSheet');
let syncUi: Promise<SyncMod> | null = null;
const loadSyncUi = () => (syncUi ??= import('./SyncSheet'));

function useMod<T>(load: () => Promise<T>): T | null {
  const [m, set] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    void load().then((x) => alive && set(() => x));
    return () => {
      alive = false;
    };
  }, []);
  return m;
}

function SyncAcceptRoute({ params }: { params: string[] }) {
  const m = useMod(loadSyncUi);
  if (!m) {
    return (
      <div class="screen center">
        <div class="screen-inner">
          <TopBar title={t('sync_title')} />
          <div class="loading">
            <LogoMark class="spinner" />
          </div>
        </div>
      </div>
    );
  }
  const C: ComponentType<{ params: string[] }> = m.SyncAccept;
  return <C params={params} />;
}

export function registerOnlineRoutes(): void {
  registerRoute({ name: 'together', pattern: /^\/together\/?$/, component: TogetherScreen });
  registerRoute({ name: 'room', pattern: /^\/room\/([A-Za-z0-9_-]+)\/?$/, component: TogetherScreen });
  // `#sync=KEY` (an invite link from another device)
  registerRoute({ name: 'sync', pattern: /^\/?sync=([A-Za-z0-9-]+)\/?$/i, component: SyncAcceptRoute });
}

/** Start background sync at start-up when this device is linked. */
export function startSyncIfLinked(): void {
  if (!hasSyncKey()) return;
  const go = () => void import('../../net/sync').then((m) => m.getSync()).catch(() => {});
  if ('requestIdleCallback' in window) (window as unknown as { requestIdleCallback: (f: () => void) => void }).requestIdleCallback(go);
  else setTimeout(go, 1200);
}

function SyncSheetBody({ onClose }: { onClose: () => void }) {
  const m = useMod(loadSyncUi);
  if (!m) return <LogoMark class="spinner" />;
  const P = m.SyncPanel;
  return <P onClose={onClose} />;
}

/** Settings row: "Связать устройства". */
export function SyncRow() {
  const [open, setOpen] = useState(false);
  const [linked, setLinked] = useState(hasSyncKey());
  const [sub, setSub] = useState<string>('');
  useEffect(() => {
    if (!linked) return;
    let unsub = () => {};
    let alive = true;
    void loadSyncUi().then(async (ui) => {
      const { getSync } = await import('../../net/sync');
      if (!alive) return;
      const c = getSync();
      setSub(ui.statusText(c.status()));
      unsub = c.subscribe((s) => setSub(ui.statusText(s)));
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [linked]);
  return (
    <>
      <button
        class="srow srow-btn"
        onClick={() => {
          sfx.tick();
          setOpen(true);
        }}
      >
        <span class="s-ic">
          <IconDevices />
        </span>
        <span class="s-text">
          <span class="s-t">{t('sync_link')}</span>
          <span class="s-s">{linked ? sub || t('sync_st_okNever') : t('sync_subOff')}</span>
        </span>
        <span class="s-ctl">
          <IconChevron class="s-chev" />
        </span>
      </button>
      <Sheet
        open={open}
        onClose={() => {
          setOpen(false);
          setLinked(hasSyncKey());
        }}
        label={t('sync_link')}
      >
        {open && (
          <SyncSheetBody
            onClose={() => {
              setOpen(false);
              setLinked(hasSyncKey());
            }}
          />
        )}
      </Sheet>
    </>
  );
}
