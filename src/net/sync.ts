// Device sync over public Nostr relays (ported from the Food Radar profile sync).
//
// The account is a random 32-letter key the player carries to another device (as a `#sync=KEY`
// link). From it every device derives the same Schnorr signing key and the same AES-GCM key. The
// merged progress document (sync-merge.ts) is deflated, encrypted and published as one replaceable
// NIP-78 event (kind 30078, d = "hexlume-progress"). Relays see only an opaque blob under a
// pseudonymous key; only the key holder can read it, and only the key holder can replace it.

import { exportProgress, importProgress, onProgressChange } from '../storage';
import { parseSyncKey } from './ids';
import { aesKey, decoder, decrypt, deflate, encrypt, fromBase64, inflate, publicKeyOf, sha256, signEvent, toBase64, utf8, verifyEvent, type NostrEvent } from './nostr';
import { DOC_VERSION, mergeDocs, stableJson, type SyncDoc } from './sync-merge';

export const SYNC_KIND = 30078;
export const SYNC_TAG = 'hexlume-progress';
/** Relays that keep app data (the Food Radar set). */
export const SYNC_RELAYS: readonly string[] = Object.freeze([
  'wss://relay.primal.net',
  'wss://nostr-01.yakihonne.com',
  'wss://relay.ditto.pub',
  'wss://relay.nostr.net',
  'wss://nostr.mom',
  'wss://relay.snort.social',
  'wss://nos.lol',
  'wss://relay.damus.io',
]);
const MAX_DOC_BYTES = 1_000_000;
const MAX_EVENT_CHARS = 200_000;
const MAX_READ_CHARS = 3 + Math.ceil((MAX_DOC_BYTES + 28) / 3) * 4;
const STATE_KEY = 'hexlume:sync';

export interface Account {
  pubkey: string;
  secret: Uint8Array;
  aes: CryptoKey;
}

export async function accountOf(key: string): Promise<Account> {
  let secret = await sha256('hexlume:sync:sign:1:' + key);
  let pubkey: string | null = null;
  // a hash outside the curve order is astronomically unlikely; rehash if it ever happens
  for (let k = 0; !pubkey && k < 8; k++) {
    try {
      pubkey = publicKeyOf(secret);
    } catch {
      secret = await sha256(secret);
    }
  }
  if (!pubkey) throw new Error('bad key');
  const aes = await aesKey(await sha256('hexlume:sync:aes:1:' + key));
  return { pubkey, secret, aes };
}

export async function sealDoc(acc: Account, doc: SyncDoc, createdAt: number): Promise<NostrEvent> {
  const plain = utf8(JSON.stringify(doc));
  if (plain.length > MAX_DOC_BYTES) throw new Error('document too large');
  const packed = await deflate(plain, MAX_DOC_BYTES);
  const body = await encrypt(acc.aes, packed ?? plain);
  const content = (packed ? 'z1:' : 'p1:') + toBase64(body);
  if (content.length > MAX_EVENT_CHARS) throw new Error('document too large');
  return signEvent({ kind: SYNC_KIND, pubkey: acc.pubkey, created_at: createdAt, tags: [['d', SYNC_TAG]], content }, acc.secret);
}

export type Opened = { doc: SyncDoc; raw: unknown } | { unreadable: true } | null;

/** null: not ours / forged. unreadable: genuinely ours but cannot be read (must not be overwritten). */
export async function openDoc(acc: Account, e: unknown): Promise<Opened> {
  const ev = e as NostrEvent;
  if (
    !ev ||
    ev.kind !== SYNC_KIND ||
    ev.pubkey !== acc.pubkey ||
    !Array.isArray(ev.tags) ||
    !ev.tags.some((t) => Array.isArray(t) && t[0] === 'd' && t[1] === SYNC_TAG) ||
    typeof ev.content !== 'string' ||
    !(await verifyEvent(ev))
  )
    return null;
  try {
    const mode = ev.content.slice(0, 3);
    if (ev.content.length > MAX_READ_CHARS || (mode !== 'z1:' && mode !== 'p1:')) return { unreadable: true };
    const packed = await decrypt(acc.aes, fromBase64(ev.content.slice(3)));
    const plain = mode === 'z1:' ? await inflate(packed, MAX_DOC_BYTES) : packed;
    const raw = JSON.parse(decoder.decode(plain)) as unknown;
    const v = (raw as { v?: unknown })?.v;
    if (!Number.isSafeInteger(v) || (v as number) < 1) return { unreadable: true };
    return { doc: mergeDocs(raw), raw };
  } catch {
    return { unreadable: true };
  }
}

// ------------------------------------------------------------------ relay I/O

type Reply = unknown[];

function talk(url: string, message: unknown, finished: (r: Reply, got: unknown[]) => boolean | undefined, timeoutMs: number, frameLimit: number): Promise<{ ok: boolean; got: unknown[] }> {
  return new Promise((resolve) => {
    const got: unknown[] = [];
    let socket: WebSocket | null = null;
    let done = false;
    const end = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        /* closed */
      }
      resolve({ ok, got });
    };
    const timer = setTimeout(() => end(false), timeoutMs);
    try {
      socket = new WebSocket(url);
    } catch {
      end(false);
      return;
    }
    socket.onopen = () => {
      try {
        socket!.send(JSON.stringify(message));
      } catch {
        end(false);
      }
    };
    socket.onerror = () => end(false);
    socket.onclose = () => end(false);
    socket.onmessage = ({ data }) => {
      if (typeof data !== 'string') return;
      if (data.length > frameLimit) return end(false);
      let r: unknown;
      try {
        r = JSON.parse(data);
      } catch {
        return;
      }
      if (!Array.isArray(r)) return;
      const v = finished(r, got);
      if (v !== undefined) end(v);
    };
  });
}

export async function fetchEvents(acc: Account, relays: readonly string[] = SYNC_RELAYS, timeoutMs = 7000) {
  const sub = 'hx' + acc.pubkey.slice(0, 8);
  const filter = { kinds: [SYNC_KIND], authors: [acc.pubkey], '#d': [SYNC_TAG], limit: 3 };
  return Promise.all(
    relays.map((url) =>
      talk(
        url,
        ['REQ', sub, filter],
        (r, got) => {
          if (r[0] === 'EVENT' && r[1] === sub) got.push(r[2]);
          if ((r[0] === 'EOSE' || r[0] === 'CLOSED') && r[1] === sub) return r[0] === 'EOSE';
          return undefined;
        },
        timeoutMs,
        2 * MAX_DOC_BYTES,
      ).then((res) => ({ url, ...res })),
    ),
  );
}

export async function publishEvent(e: NostrEvent, relays: readonly string[] = SYNC_RELAYS, timeoutMs = 7000): Promise<number> {
  const replies = await Promise.all(
    relays.map((url) => talk(url, ['EVENT', e], (r) => (r[0] === 'OK' && r[1] === e.id ? r[2] === true : undefined), timeoutMs, MAX_EVENT_CHARS + 4096)),
  );
  return replies.filter((r) => r.ok).length;
}

// ------------------------------------------------------------------ persisted state

export type SyncState = 'off' | 'syncing' | 'ok' | 'offline' | 'unreadable' | 'outdated' | 'error';

export interface SyncStatus {
  state: SyncState;
  at: number | null;
  relays: number;
}

interface Stored {
  key: string;
  at?: number | null;
  relays?: number;
}

function loadStored(): Stored | null {
  try {
    const v = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null') as Stored | null;
    return v && typeof v.key === 'string' && parseSyncKey(v.key) ? v : null;
  } catch {
    return null;
  }
}

function saveStored(v: Stored | null): void {
  try {
    if (v) localStorage.setItem(STATE_KEY, JSON.stringify(v));
    else localStorage.removeItem(STATE_KEY);
  } catch {
    /* ignore */
  }
}

export function currentKey(): string | null {
  return loadStored()?.key ?? null;
}

// ------------------------------------------------------------------ controller

export interface SyncController {
  status(): SyncStatus;
  subscribe(f: (s: SyncStatus) => void): () => void;
  link(key: string): Promise<SyncStatus>;
  unlink(): void;
  syncNow(): Promise<SyncStatus>;
  stop(): void;
}

export interface SyncOptions {
  relays?: readonly string[];
  debounceMs?: number;
  intervalMs?: number;
  now?: () => number;
}

let singleton: SyncController | null = null;

/** The app-wide controller (started on first use; runs while a key is stored). */
export function getSync(): SyncController {
  return (singleton ??= createSync());
}

export function createSync(opts: SyncOptions = {}): SyncController {
  const relays = opts.relays ?? SYNC_RELAYS;
  const now = opts.now ?? Date.now;
  const st = loadStored();
  let status: SyncStatus = { state: st ? 'ok' : 'off', at: st?.at ?? null, relays: st?.relays ?? 0 };
  const subs = new Set<(s: SyncStatus) => void>();
  let account: Account | null = null;
  let accountKey: string | null = null;
  let latestCreated = 0;
  let written = '';
  let running: Promise<SyncStatus> | null = null;
  let followUp: Promise<SyncStatus> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const set = (s: Partial<SyncStatus>) => {
    status = { ...status, ...s };
    subs.forEach((f) => f(status));
  };

  async function accountFor(k: string): Promise<Account> {
    if (accountKey !== k || !account) {
      account = await accountOf(k);
      accountKey = k;
      latestCreated = 0;
    }
    return account;
  }

  async function run(): Promise<SyncStatus> {
    const k = currentKey();
    if (!k) {
      set({ state: 'off' });
      return status;
    }
    set({ state: 'syncing' });
    try {
      const acc = await accountFor(k);
      const replies = await fetchEvents(acc, relays);
      const reachable = replies.filter((r) => r.ok).map((r) => r.url);
      const opened: { url: string; created: number; doc: SyncDoc }[] = [];
      let unreadable = false;
      let newer = false;
      for (const r of replies)
        for (const e of r.got) {
          const o = await openDoc(acc, e);
          if (!o) continue;
          if ('unreadable' in o) unreadable = true;
          else {
            opened.push({ url: r.url, created: (e as NostrEvent).created_at, doc: o.doc });
            if (o.doc.v > DOC_VERSION) newer = true;
          }
        }
      if (currentKey() !== k) return status;
      if (!reachable.length) {
        set({ state: 'offline', relays: 0 });
        return status;
      }
      latestCreated = Math.max(latestCreated, ...opened.map((o) => o.created));
      // merge into the local progress in one write
      const local = mergeDocs({ v: DOC_VERSION, ...exportProgress() });
      const merged = mergeDocs(local, ...opened.map((o) => o.doc));
      const mergedLocal = { ...merged, v: DOC_VERSION };
      if (stableJson(mergedLocal) !== stableJson(local)) {
        written = stableJson(mergedLocal);
        importProgress({ best: merged.best, seen: merged.seen as ProgressSeen, daily: merged.daily });
      }
      if (unreadable || newer) {
        // never overwrite a document this version cannot fully read
        set({ state: unreadable ? 'unreadable' : 'outdated', relays: reachable.length, at: now() });
        return status;
      }
      const doc: SyncDoc = { ...merged, v: DOC_VERSION };
      const text = stableJson(doc);
      const holding = new Set(opened.filter((o) => stableJson(o.doc) === text).map((o) => o.url));
      let published = holding.size;
      if (holding.size < Math.min(3, reachable.length)) {
        // never behind what a relay holds, otherwise the relay keeps the older event
        const nowS = Math.floor(now() / 1000);
        const tries = [Math.max(nowS, Math.min(latestCreated + 1, nowS + 600))];
        if (latestCreated && tries[0] !== latestCreated + 1) tries.push(latestCreated + 1);
        for (const createdAt of tries) {
          const ok = await publishEvent(await sealDoc(acc, doc, createdAt), reachable);
          if (ok) {
            latestCreated = Math.max(latestCreated, createdAt);
            published = Math.max(published, ok);
            break;
          }
        }
      }
      if (currentKey() !== k) return status;
      if (published) {
        const at = now();
        saveStored({ key: k, at, relays: published });
        set({ state: 'ok', at, relays: published });
      } else set({ state: 'offline', relays: 0 });
    } catch (e) {
      console.warn('sync failed', e);
      set({ state: 'error' });
    }
    return status;
  }

  function syncNow(): Promise<SyncStatus> {
    if (running) {
      followUp ??= running.then(() => {
        followUp = null;
        return syncNow();
      });
      return followUp;
    }
    running = run().finally(() => {
      running = null;
    });
    return running;
  }

  function schedule(ms = opts.debounceMs ?? 2500) {
    if (timer) clearTimeout(timer);
    timer = null;
    if (currentKey()) timer = setTimeout(() => void syncNow(), ms);
  }

  const unsub = onProgressChange(() => {
    if (!currentKey()) return;
    const cur = stableJson(mergeDocs({ v: DOC_VERSION, ...exportProgress() }));
    if (cur !== written) schedule();
  });
  const onVis = () => {
    if (!document.hidden) schedule(300);
  };
  const onFocus = () => schedule(300);
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('focus', onFocus);
  window.addEventListener('online', onFocus);
  const ticker = setInterval(() => {
    if (!document.hidden && currentKey()) void syncNow();
  }, opts.intervalMs ?? 90_000);
  if (st) schedule(800);

  return {
    status: () => status,
    subscribe(f) {
      subs.add(f);
      return () => void subs.delete(f);
    },
    async link(input) {
      const k = parseSyncKey(input);
      if (!k) return status;
      saveStored({ key: k, at: null, relays: 0 });
      set({ state: 'syncing', at: null, relays: 0 });
      return syncNow();
    },
    unlink() {
      if (timer) clearTimeout(timer);
      saveStored(null);
      account = null;
      accountKey = null;
      set({ state: 'off', at: null, relays: 0 });
    },
    syncNow,
    stop() {
      if (timer) clearTimeout(timer);
      clearInterval(ticker);
      unsub();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      subs.clear();
    },
  };
}

type ProgressSeen = ReturnType<typeof exportProgress>['seen'];
