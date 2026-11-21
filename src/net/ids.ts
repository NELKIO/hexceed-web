// Small helpers that the main bundle may use without pulling in any networking code:
// room codes, invite links, the device id, player profile (nickname + colour) and sync keys.

/** Uppercase letters and digits without the ambiguous 0/O/1/I. 32 symbols = 5 bits each. */
export const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** 6 symbols = 30 bits: short enough to dictate, long enough that strangers never collide. */
export const ROOM_CODE_LENGTH = 6;
export const SYNC_KEY_LENGTH = 32;

function randomBytes(n: number): Uint8Array {
  const a = new Uint8Array(n);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(a);
  else for (let i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256);
  return a;
}

function randomCode(len: number): string {
  return Array.from(randomBytes(len), (b) => ALPHABET[b & 31]).join('');
}

export function newRoomCode(): string {
  return randomCode(ROOM_CODE_LENGTH);
}

/** Uppercase, drop separators, map look-alikes (O→0 is not in the alphabet, so O stays invalid). */
function clean(s: string): string {
  return s.toUpperCase().replace(/[\s\-_.]/g, '');
}

export function isRoomCode(s: string): boolean {
  return s.length === ROOM_CODE_LENGTH && [...s].every((c) => ALPHABET.includes(c));
}

/** A code from what the player typed or pasted: a bare code, `#/room/CODE` or a full invite URL. */
export function parseRoomInput(input: string): string | null {
  const text = String(input ?? '').trim();
  const m = /(?:^|#|\/)room\/([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/.exec(text);
  const code = clean(m ? m[1] : text);
  return isRoomCode(code) ? code : null;
}

export function formatRoomCode(code: string): string {
  return code.length === 6 ? code.slice(0, 3) + '-' + code.slice(3) : code;
}

function appBase(): string {
  try {
    return location.origin + (import.meta.env?.BASE_URL ?? '/');
  } catch {
    return 'https://nelkio.github.io/hexceed-web/';
  }
}

export function inviteUrl(code: string): string {
  return `${appBase()}#/room/${code}`;
}

// ------------------------------------------------------------------ sync keys

export function newSyncKey(): string {
  return randomCode(SYNC_KEY_LENGTH);
}

/** A key from a bare key (with or without dashes) or a link containing `#sync=KEY`. */
export function parseSyncKey(input: string): string | null {
  const text = String(input ?? '').trim();
  const m = /(?:^|#|&|\/)sync=([^&\s]+)/i.exec(text);
  const key = clean(m ? m[1] : text);
  return key.length === SYNC_KEY_LENGTH && [...key].every((c) => ALPHABET.includes(c)) ? key : null;
}

export function formatSyncKey(key: string): string {
  return (key.match(/.{1,4}/g) ?? [key]).join('-');
}

export function syncUrl(key: string): string {
  return `${appBase()}#sync=${key}`;
}

// ------------------------------------------------------------------ device id + profile

const P = 'hexlume:net:';

function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(P + k);
  } catch {
    return null;
  }
}

function lsSet(k: string, v: string | null): void {
  try {
    if (v == null) localStorage.removeItem(P + k);
    else localStorage.setItem(P + k, v);
  } catch {
    /* ignore */
  }
}

let memId: string | null = null;
/** Stable per-browser id (not secret): lets a reloaded page be recognised as the same player. */
export function clientId(): string {
  const s = lsGet('id') ?? memId;
  if (s && /^[a-z0-9]{12,32}$/.test(s)) return s;
  const id = Array.from(randomBytes(8), (b) => b.toString(16).padStart(2, '0')).join('');
  memId = id;
  lsSet('id', id);
  return id;
}

export const PLAYER_COLORS = ['#ff6f61', '#8b5cf6', '#16b3a3', '#f59e0b', '#ec5f97', '#4f7cff'] as const;

const NAMES = {
  ru: ['Лисичка', 'Ёжик', 'Совёнок', 'Котик', 'Панда', 'Енотик', 'Пингвин', 'Зайка', 'Белочка', 'Хомяк', 'Медвежонок', 'Лемур', 'Выдра', 'Колибри', 'Мишка', 'Сурикат'],
  en: ['Fox', 'Hedgehog', 'Owlet', 'Kitty', 'Panda', 'Raccoon', 'Penguin', 'Bunny', 'Squirrel', 'Hamster', 'Cub', 'Lemur', 'Otter', 'Hummingbird', 'Teddy', 'Meerkat'],
};
const ADJ = {
  ru: ['Сонный', 'Смелый', 'Хитрый', 'Тихий', 'Весёлый', 'Мудрый', 'Быстрый', 'Ясный'],
  en: ['Sleepy', 'Brave', 'Clever', 'Quiet', 'Merry', 'Wise', 'Swift', 'Bright'],
};

export function randomName(lang: 'ru' | 'en'): string {
  const b = randomBytes(2);
  const n = NAMES[lang][b[0] % NAMES[lang].length];
  if (lang === 'en') return `${ADJ.en[b[1] % ADJ.en.length]} ${n}`;
  return n;
}

export interface Profile {
  name: string;
  color: string;
}

export const MAX_NAME = 18;

export function cleanName(s: unknown): string {
  return String(s ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME);
}

export function cleanColor(c: unknown): string {
  return typeof c === 'string' && (PLAYER_COLORS as readonly string[]).includes(c) ? c : PLAYER_COLORS[0];
}

export function loadProfile(lang: 'ru' | 'en'): Profile {
  try {
    const raw = lsGet('profile');
    if (raw) {
      const p = JSON.parse(raw) as Partial<Profile>;
      const name = cleanName(p.name);
      if (name) return { name, color: cleanColor(p.color) };
    }
  } catch {
    /* fall through */
  }
  const p: Profile = { name: randomName(lang), color: PLAYER_COLORS[randomBytes(1)[0] % PLAYER_COLORS.length] };
  saveProfile(p);
  return p;
}

export function saveProfile(p: Profile): void {
  lsSet('profile', JSON.stringify({ name: cleanName(p.name), color: cleanColor(p.color) }));
}

// ------------------------------------------------------------------ rooms this browser knows

export interface RoomRecord {
  code: string;
  role: 'host' | 'guest';
  at: number;
}

export function loadRoomRecord(code: string): RoomRecord | null {
  try {
    const raw = lsGet('room:' + code);
    if (!raw) return null;
    const r = JSON.parse(raw) as RoomRecord;
    return r && (r.role === 'host' || r.role === 'guest') ? { code, role: r.role, at: Number(r.at) || 0 } : null;
  } catch {
    return null;
  }
}

export function saveRoomRecord(r: RoomRecord): void {
  lsSet('room:' + r.code, JSON.stringify(r));
  // keep the last few rooms only
  try {
    const keys: { k: string; at: number }[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(P + 'room:')) continue;
      const v = JSON.parse(localStorage.getItem(k) ?? '{}') as { at?: number };
      keys.push({ k, at: Number(v.at) || 0 });
    }
    keys.sort((a, b) => b.at - a.at);
    for (const { k } of keys.slice(8)) {
      localStorage.removeItem(k);
      localStorage.removeItem(k.replace(P + 'room:', P + 'game:'));
    }
  } catch {
    /* ignore */
  }
}

/** Most recent room (for a "back to the room" shortcut). */
export function lastRoom(): RoomRecord | null {
  let best: RoomRecord | null = null;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(P + 'room:')) continue;
      const r = loadRoomRecord(k.slice((P + 'room:').length));
      if (r && (!best || r.at > best.at)) best = r;
    }
  } catch {
    /* ignore */
  }
  return best;
}

/** Raw per-room game persistence (used by the room session; kept here so cleanup is in one place). */
export function loadRoomGame<T>(code: string): T | null {
  try {
    const raw = lsGet('game:' + code);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveRoomGame(code: string, v: unknown): void {
  lsSet('game:' + code, v == null ? null : JSON.stringify(v));
}

/** Is a sync key stored? (cheap check at start-up, before the sync module is loaded) */
export function hasSyncKey(): boolean {
  try {
    const raw = localStorage.getItem('hexlume:sync');
    if (!raw) return false;
    const v = JSON.parse(raw) as { key?: unknown };
    return typeof v?.key === 'string' && !!parseSyncKey(v.key);
  } catch {
    return false;
  }
}
