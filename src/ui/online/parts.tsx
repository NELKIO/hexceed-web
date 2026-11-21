// Small shared pieces of the online UI.

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { t, type TKey } from '../../i18n';
import { sfx } from '../../audio/sfx';
import { getLang } from '../../i18n';
import { cleanName, MAX_NAME, PLAYER_COLORS, type Profile } from '../../net/ids';
import type { ConnState, RoomSession, RoomSnapshot } from '../../net/room';

export function useRoomSnap(room: RoomSession): RoomSnapshot {
  const [snap, set] = useState(() => room.snapshot());
  useEffect(() => {
    set(room.snapshot());
    return room.subscribe(() => set(room.snapshot()));
  }, [room]);
  return snap;
}

const CONN_KEY: Record<ConnState, TKey> = {
  connecting: 'on_st_connecting',
  waiting: 'on_st_waiting',
  direct: 'on_st_direct',
  relay: 'on_st_relay',
  reconnecting: 'on_st_reconnecting',
  offline: 'on_st_offline',
};

export function ConnBadge({ conn, compact = false }: { conn: ConnState; compact?: boolean }) {
  return (
    <span class={'conn conn-' + conn + (compact ? ' compact' : '')} title={t(CONN_KEY[conn])} role="status" aria-label={t(CONN_KEY[conn])}>
      <i />
      {!compact && <span>{t(CONN_KEY[conn])}</span>}
    </span>
  );
}

/** Partner colour as shown on this device: never the same as ours. */
export function partnerColor(snap: RoomSnapshot): string {
  const c = snap.partner?.color ?? PLAYER_COLORS[1];
  if (c !== snap.self.color) return c;
  const k = PLAYER_COLORS.indexOf(c as (typeof PLAYER_COLORS)[number]);
  return PLAYER_COLORS[(k + 1) % PLAYER_COLORS.length];
}

export function HexDot({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <svg class="hexdot" viewBox="0 0 20 22" width={size} height={size * 1.1} aria-hidden="true">
      <path d="M10 1 L19 6 L19 16 L10 21 L1 16 L1 6 Z" fill={color} />
    </svg>
  );
}

export function PlayerChip({ name, color, you, away, waiting }: { name: string; color: string; you?: boolean; away?: boolean; waiting?: boolean }) {
  return (
    <span class={'pchip' + (away ? ' away' : '') + (waiting ? ' waiting' : '')} style={{ '--pc': color } as JSX.CSSProperties}>
      <HexDot color={waiting ? 'var(--dim)' : color} />
      <span class="pc-name">{name}</span>
      {you && <small>{t('on_you')}</small>}
      {away && <small>{t('on_away')}</small>}
    </span>
  );
}

export function ProfileEditor({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const [name, setName] = useState(profile.name);
  useEffect(() => setName(profile.name), [profile.name]);
  const commit = () => {
    const n = cleanName(name);
    if (n && n !== profile.name) onChange({ ...profile, name: n });
    else setName(profile.name);
  };
  return (
    <div class="profile" style={{ '--pc': profile.color } as JSX.CSSProperties}>
      <div class="pf-avatar">
        <HexDot color={profile.color} size={34} />
        <b>{(profile.name || '?').slice(0, 1).toUpperCase()}</b>
      </div>
      <div class="pf-main">
        <label class="pf-label" for="pf-name">
          {t('on_name')}
        </label>
        <input
          id="pf-name"
          class="pf-name"
          value={name}
          maxLength={MAX_NAME}
          autoComplete="nickname"
          spellcheck={false}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
        <div class="pf-colors" role="radiogroup" aria-label={t('on_color')}>
          {PLAYER_COLORS.map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={c === profile.color}
              aria-label={c}
              class={'pf-color' + (c === profile.color ? ' on' : '')}
              style={{ '--c': c } as JSX.CSSProperties}
              onClick={() => {
                sfx.toggle();
                onChange({ name: cleanName(name) || profile.name, color: c });
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function canShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

export async function shareLink(url: string, text: string): Promise<void> {
  try {
    await navigator.share({ title: 'Hexlume', text, url });
  } catch {
    /* cancelled */
  }
}

export function relTime(at: number | null): string {
  if (!at) return '';
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 45) return t('sync_justNow');
  try {
    const d = new Date(at);
    const sameDay = new Date().toDateString() === d.toDateString();
    return sameDay ? d.toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString(getLang(), { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}
