// Room transport (ported from the Food Radar duel transport): Trystero over Nostr relays for a
// direct WebRTC data channel, plus the encrypted Nostr relay path (relay.ts) when WebRTC does not
// come up within ~7 s, drops, or stalls. Both paths carry the same sealed envelopes, so the peer id
// (the per-page Schnorr key) survives a switch in either direction.

import { joinRoom, type Room } from 'trystero';
import { makeCodec, openRelays, type Envelope, type RelayPool } from './relay';
import type { NostrEvent } from './nostr';

export const APP_ID = 'NELKIO/hexceed-web/v1';

/** Nostr relays for WebRTC signalling and the fallback path (the set the Food Radar duels use). */
export const SIGNAL_RELAYS: readonly string[] = Object.freeze([
  'wss://relay.primal.net',
  'wss://bucket.coracle.social',
  'wss://nostr-01.yakihonne.com',
  'wss://relay.ditto.pub',
  'wss://relay.nostr.net',
]);

export const RELAY_FALLBACK_MS = 7000;
const MAX_BYTES = 256 * 1024;

export type Path = 'direct' | 'relay';

export interface TransportHandlers {
  up(peer: string): void;
  down(peer: string): void;
  message(peer: string, packet: unknown): void;
  path(peer: string, path: Path): void;
  error(kind: 'relay' | 'full'): void;
}

export interface Transport {
  /** Own peer id (Schnorr public key, hex). */
  id: string;
  send(peer: string, packet: unknown): void;
  /** The peer went silent although the data channel looks open: also use the relays. */
  recover(peer: string): void;
  path(peer: string): Path | null;
  relaysOpen(): number;
}

export interface ConnectOptions {
  /** Skip WebRTC entirely (debugging, tests, networks that block it). */
  forceRelay?: boolean;
  relays?: readonly string[];
}

export async function connectRoom(code: string, handlers: TransportHandlers, signal: AbortSignal, opts: ConnectOptions = {}): Promise<Transport | null> {
  const urls = opts.relays ?? SIGNAL_RELAYS;
  const codec = await makeCodec(code);
  if (signal.aborted) return null;
  let room: Room | null = null;
  if (!opts.forceRelay && typeof RTCPeerConnection === 'function' && typeof (Promise as unknown as { withResolvers?: unknown }).withResolvers === 'function') {
    try {
      room = joinRoom(
        {
          appId: APP_ID,
          identity: 'none',
          password: code,
          maxUsers: 3,
          maxReceiveBytes: MAX_BYTES,
          relayConfig: { urls: [...urls], warnOnRelayFailure: false },
        },
        'room-' + code,
      );
    } catch (e) {
      console.warn('webrtc unavailable', e);
      room = null;
    }
  }
  const action = room?.makeAction<NostrEvent>('hx');
  const self: Promise<string | null> = room ? room.getSelf().then((s) => s.userId).catch(() => null) : Promise.resolve(null);
  const connected = new Set<string>();
  const direct = new Map<string, string>(); // codec id -> trystero user id
  const stalled = new Set<string>();
  const rawPeers = new Set<string>();
  const pending = new Set<Promise<void>>();
  let relays: RelayPool | null = null;
  let lastAd = 0;

  function enableRelays() {
    if (relays || signal.aborted) return;
    relays = openRelays(urls, codec.topic, (e) => void accept(e), () => void advertiseRelays(), () => handlers.error('relay'));
  }

  async function advertiseRelays(force = false) {
    if (!relays || signal.aborted || (direct.size && !force) || Date.now() - lastAd < 900) return;
    lastAd = Date.now();
    const e = await codec.seal({ kind: 'presence', to: null });
    relays?.publish(e);
  }

  async function advertiseDirect(userId: string) {
    if (!action) return;
    const e = await codec.seal({ kind: 'presence', to: null, via: await self });
    if (!signal.aborted) await action.send(e, { target: userId }).catch(() => {});
  }

  async function accept(raw: unknown, rawId: string | null = null) {
    const v = await codec.open(raw);
    if (!v || signal.aborted) return;
    const { sender, payload } = v;
    if (rawId && (payload.via !== rawId || !rawPeers.has(rawId))) return;
    const first = !connected.has(sender);
    const learnedDirect = !!rawId && !direct.has(sender);
    if (rawId) {
      const recovered = stalled.delete(sender);
      direct.set(sender, rawId);
      if (learnedDirect) void advertiseDirect(rawId);
      if (learnedDirect || recovered) handlers.path(sender, 'direct');
    } else if (first || !direct.has(sender) || stalled.has(sender)) handlers.path(sender, 'relay');
    if (first) {
      connected.add(sender);
      handlers.up(sender);
      if (!rawId) void advertiseRelays(true);
    }
    if (payload.kind === 'packet' && payload.to === codec.id) handlers.message(sender, payload.packet);
  }

  async function deliver(peer: string, packet: unknown) {
    const rawId = direct.get(peer);
    const env: Envelope = { kind: 'packet', to: peer, packet };
    if (rawId) env.via = await self;
    const e = await codec.seal(env);
    if (rawId && stalled.has(peer)) relays?.publish(e);
    if (rawId && action) {
      try {
        await action.send(e, { target: rawId });
        return;
      } catch {
        enableRelays();
      }
    }
    relays?.publish(e);
  }

  action?.onReceive(({ byteLength }) => byteLength <= MAX_BYTES);
  action?.onMessage((e, { userId }) => void accept(e, userId));
  room?.onUserJoin(
    ({ userId }) => {
      rawPeers.add(userId);
      void advertiseDirect(userId);
    },
    { replay: true },
  );
  room?.onUserLeave(({ userId }) => {
    rawPeers.delete(userId);
    for (const [peer, id] of direct) {
      if (id !== userId) continue;
      direct.delete(peer);
      stalled.delete(peer);
      connected.delete(peer);
      handlers.down(peer);
      enableRelays();
      void advertiseRelays(true);
    }
  });
  room?.onError((err) => {
    if (err.code === 'relay-failed') enableRelays();
    if (err.code === 'room-full' && room && !Object.keys(room.getUsers()).length) handlers.error('full');
  });
  const fallback = setTimeout(() => {
    if (!direct.size) enableRelays();
  }, room ? RELAY_FALLBACK_MS : 0);
  const pulse = setInterval(() => {
    for (const userId of rawPeers) {
      const established = [...direct].some(([peer, id]) => id === userId && !stalled.has(peer));
      if (!established) void advertiseDirect(userId);
    }
    if (!direct.size || stalled.size) void advertiseRelays(stalled.size > 0);
  }, 4500);
  signal.addEventListener(
    'abort',
    () => {
      clearTimeout(fallback);
      clearInterval(pulse);
      // give a final "bye" packet a chance to reach an open data channel
      const grace = new Promise((r) => setTimeout(r, 250));
      void Promise.race([Promise.allSettled([...pending]), grace])
        .then(() => {
          relays?.close();
          return room?.leave();
        })
        .catch(() => {});
    },
    { once: true },
  );
  return {
    id: codec.id,
    recover(peer) {
      if (!peer || signal.aborted) return;
      if (direct.has(peer) && !stalled.has(peer)) stalled.add(peer);
      enableRelays();
      void advertiseRelays(true);
    },
    path(peer) {
      if (!connected.has(peer)) return null;
      return direct.has(peer) && !stalled.has(peer) ? 'direct' : 'relay';
    },
    relaysOpen: () => relays?.open() ?? 0,
    send(peer, packet) {
      if (signal.aborted) return;
      const d = deliver(peer, packet).catch(() => {});
      pending.add(d);
      void d.finally(() => pending.delete(d));
    },
  };
}
