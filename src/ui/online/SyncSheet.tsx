// Device sync UI: the sheet behind Settings → "Связать устройства", and the `#sync=KEY` accept screen.
// Loaded lazily together with the sync module.

import '../../styles/online.css';
import { useEffect, useState } from 'preact/hooks';
import { t, type TKey } from '../../i18n';
import { navigate } from '../../router';
import { sfx } from '../../audio/sfx';
import { TopBar } from '../components/ui';
import { IconCopy, IconDevices, IconShare, IconSync } from '../icons';
import { useSettings } from '../settings';
import { formatSyncKey, newSyncKey, parseSyncKey, syncUrl } from '../../net/ids';
import { currentKey, getSync, type SyncStatus } from '../../net/sync';
import { canShare, copyText, relTime, shareLink } from './parts';

function useSyncStatus(): SyncStatus {
  const c = getSync();
  const [s, set] = useState(c.status());
  useEffect(() => {
    set(c.status());
    return c.subscribe(set);
  }, []);
  return s;
}

const STATE_KEY: Record<SyncStatus['state'], TKey> = {
  off: 'sync_st_off',
  syncing: 'sync_st_syncing',
  ok: 'sync_st_ok',
  offline: 'sync_st_offline',
  unreadable: 'sync_st_unreadable',
  outdated: 'sync_st_outdated',
  error: 'sync_st_error',
};

export function statusText(s: SyncStatus): string {
  if (s.state === 'ok') return s.at ? t('sync_st_ok', { when: relTime(s.at) }) : t('sync_st_okNever');
  return t(STATE_KEY[s.state]);
}

/** Contents of the settings sheet. */
export function SyncPanel({ onClose }: { onClose: () => void }) {
  useSettings();
  const s = useSyncStatus();
  const [key, setKey] = useState<string | null>(() => currentKey());
  const [entering, setEntering] = useState(false);
  const [input, setInput] = useState('');
  const [bad, setBad] = useState(false);
  const [copied, setCopied] = useState(false);
  const [askUnlink, setAskUnlink] = useState(false);
  useEffect(() => setKey(currentKey()), [s.state]);

  if (!key) {
    return (
      <div class="sync-sheet">
        <h2>{t('sync_link')}</h2>
        <p>{t('sync_intro')}</p>
        {!entering ? (
          <>
            <button
              class="btn cta wide"
              onClick={() => {
                sfx.tick();
                const k = newSyncKey();
                setKey(k);
                void getSync().link(k);
              }}
            >
              <IconDevices />
              <span>{t('sync_create')}</span>
            </button>
            <button class="btn ghost wide" onClick={() => { sfx.tick(); setEntering(true); }}>
              <span>{t('sync_have')}</span>
            </button>
          </>
        ) : (
          <form
            class="sync-sheet"
            onSubmit={(e) => {
              e.preventDefault();
              const k = parseSyncKey(input);
              if (!k) {
                setBad(true);
                sfx.illegal();
                return;
              }
              sfx.tick();
              setKey(k);
              void getSync().link(k);
            }}
          >
            <input
              class={'key-input code-input' + (bad ? ' bad' : '')}
              placeholder={t('sync_keyPh')}
              value={input}
              autoComplete="off"
              spellcheck={false}
              autoFocus
              onInput={(e) => {
                setInput((e.target as HTMLInputElement).value);
                setBad(false);
              }}
            />
            {bad && <p class="o-err">{t('sync_badKey')}</p>}
            <div class="row">
              <button type="button" class="btn ghost" onClick={() => setEntering(false)}>
                {t('cancel')}
              </button>
              <button type="submit" class="btn cta">
                {t('sync_accept')}
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }

  const url = syncUrl(key);
  return (
    <div class="sync-sheet">
      <h2>{t('sync_title')}</h2>
      <div class={'sync-status ' + s.state} role="status">
        <i />
        <span>{statusText(s)}</span>
      </div>
      <p>{t('sync_linkHint')}</p>
      <div class="sync-link" aria-label={t('sync_key')}>
        {url.replace(key, formatSyncKey(key))}
      </div>
      <div class="row">
        <button
          class="btn ghost"
          onClick={async () => {
            sfx.tick();
            if (await copyText(url)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            }
          }}
        >
          <IconCopy />
          <span>{copied ? t('on_copied') : t('on_copy')}</span>
        </button>
        {canShare() && (
          <button class="btn ghost" onClick={() => { sfx.tick(); void shareLink(url, 'Hexlume'); }}>
            <IconShare />
            <span>{t('share')}</span>
          </button>
        )}
      </div>
      <button class="btn cta wide" disabled={s.state === 'syncing'} onClick={() => { sfx.tick(); void getSync().syncNow(); }}>
        <IconSync />
        <span>{t('sync_now')}</span>
      </button>
      {!askUnlink ? (
        <button class="btn ghost wide" onClick={() => { sfx.tick(); setAskUnlink(true); }}>
          <span>{t('sync_unlink')}</span>
        </button>
      ) : (
        <div class="row">
          <button class="btn ghost" onClick={() => setAskUnlink(false)}>
            {t('cancel')}
          </button>
          <button
            class="btn danger-fill"
            onClick={() => {
              getSync().unlink();
              setKey(null);
              setAskUnlink(false);
              onClose();
            }}
          >
            <span>{t('sync_unlink')}</span>
          </button>
        </div>
      )}
      {askUnlink && <p>{t('sync_unlinkSub')}</p>}
    </div>
  );
}

/** `#sync=KEY`: confirm linking this device. */
export function SyncAccept({ params }: { params: string[] }) {
  useSettings();
  const key = parseSyncKey(params[0] ?? '');
  const s = useSyncStatus();
  const [busy, setBusy] = useState(false);
  const already = !!key && currentKey() === key;
  return (
    <div class="screen">
      <div class="screen-inner">
        <TopBar title={t('sync_title')} onBack={() => navigate('/', true)} />
        <div class="o-card sync-sheet">
          {!key ? (
            <>
              <h2>{t('sync_badKey')}</h2>
              <button class="btn ghost wide" onClick={() => navigate('/settings', true)}>
                {t('settings')}
              </button>
            </>
          ) : already ? (
            <>
              <h2>{t('sync_title')}</h2>
              <div class={'sync-status ' + s.state} role="status">
                <i />
                <span>{statusText(s)}</span>
              </div>
              <button class="btn cta wide" onClick={() => navigate('/settings', true)}>
                {t('settings')}
              </button>
            </>
          ) : (
            <>
              <h2>{t('sync_acceptTitle')}</h2>
              <p>{t('sync_acceptText')}</p>
              <div class="sync-link">{formatSyncKey(key)}</div>
              <div class="row">
                <button class="btn ghost" onClick={() => navigate('/', true)}>
                  {t('cancel')}
                </button>
                <button
                  class="btn cta"
                  disabled={busy}
                  onClick={async () => {
                    sfx.tick();
                    setBusy(true);
                    await getSync().link(key);
                    setBusy(false);
                    navigate('/settings', true);
                  }}
                >
                  <IconDevices />
                  <span>{busy ? t('sync_st_syncing') : t('sync_accept')}</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
