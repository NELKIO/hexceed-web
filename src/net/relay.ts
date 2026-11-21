// Encrypted Nostr relay fallback for rooms (ported from the Food Radar duel relay).
// Every packet is a NIP-01 ephemeral event: AES-GCM encrypted with a key derived from the room code
// and signed with a per-page Schnorr key. The signed sender id stays the same when the transport
// switches between WebRTC and relays, so the room never sees a "new" player on a handover.

import { aesKey, decoder, decrypt, encrypt, fromBase64, hex, keygen, sha256, signEvent, toBase64, utf8, verifyEvent, type NostrEvent } from './nostr';

export const RELAY_KIND = 28791;
const MAX_CONTENT = 60_000;
const MAX_FRAME = 70_000;
const MAX_SKEW_S = 90;

export interface Envelope {
  kind: 'presence' | 'packet';
  /** Recipient codec id, null = everybody. */
  to: string | null;
  /** Trystero user id of the sender when sent over WebRTC (binds the two identities). */
  via?: string | null;
  packet?: unknown;
}

export interface Codec {
  id: string;
  topic: string;
  seal(e: Envelope): Promise<NostrEvent>;
  open(e: unknown): Promise<{ sender: string; payload: Envelope } | null>;
}

export async function makeCodec(code: string, appTag = 'hexlume'): Promise<Codec> {
  const topic = hex(await sha256(`${appTag}:room:topic:1:${code}`));
  const key = await aesKey(await sha256(`${appTag}:room:aes:1:${code}`));
  const pair = keygen();
  const id = hex(pair.publicKey);
  const seen = new Map<string, number>();

  async function seal(message: Envelope): Promise<NostrEvent> {
    const body = await encrypt(key, utf8(JSON.stringify(message)));
    return signEvent(
      { kind: RELAY_KIND, pubkey: id, created_at: Math.floor(Date.now() / 1000), tags: [['x', topic]], content: toBase64(body) },
      pair.secretKey,
    );
  }

  async function open(raw: unknown): Promise<{ sender: string; payload: Envelope } | null> {
    const e = raw as NostrEvent;
    if (
      !e ||
      typeof e !== 'object' ||
      e.kind !== RELAY_KIND ||
      e.pubkey === id ||
      !Number.isSafeInteger(e.created_at) ||
      Math.abs(Date.now() / 1000 - e.created_at) > MAX_SKEW_S ||
      !Array.isArray(e.tags) ||
      e.tags.length !== 1 ||
      !Array.isArray(e.tags[0]) ||
      e.tags[0].length !== 2 ||
      e.tags[0][0] !== 'x' ||
      e.tags[0][1] !== topic ||
      typeof e.content !== 'string' ||
      e.content.length > MAX_CONTENT ||
      seen.has(e.id)
    )
      return null;
    try {
      if (!(await verifyEvent(e))) return null;
      const plain = await decrypt(key, fromBase64(e.content));
      const payload = JSON.parse(decoder.decode(plain)) as Envelope;
      if (!payload || (payload.to !== null && payload.to !== id) || (payload.kind !== 'presence' && payload.kind !== 'packet')) return null;
      if (seen.has(e.id)) return null;
      seen.set(e.id, e.created_at);
      if (seen.size > 1024) seen.delete(seen.keys().next().value as string);
      return { sender: e.pubkey, payload };
    } catch {
      return null;
    }
  }

  return { id, topic, seal, open };
}

export interface RelayPool {
  publish(e: NostrEvent): void;
  /** Number of relays with an open socket. */
  open(): number;
  close(): void;
}

/** One persistent socket per relay, re-opened 5.5 s after a drop. */
export function openRelays(urls: readonly string[], topic: string, receive: (e: unknown) => void, onOpen: () => void, onUnavailable: () => void): RelayPool {
  let closed = false;
  let warned = false;
  const links = new Map<string, WebSocket>();
  const retry = new Set<ReturnType<typeof setTimeout>>();
  const attempted = new Set<string>();
  const sub = 'hx-' + topic.slice(0, 10);
  const available = () => [...links.values()].some((s) => s.readyState === WebSocket.OPEN);

  function connect(url: string) {
    if (closed) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      attempted.add(url);
      return;
    }
    links.set(url, socket);
    socket.onopen = () => {
      warned = false;
      attempted.add(url);
      socket.send(JSON.stringify(['REQ', sub, { kinds: [RELAY_KIND], '#x': [topic], since: Math.floor(Date.now() / 1000) - 20 }]));
      onOpen();
    };
    socket.onmessage = ({ data }) => {
      if (closed || typeof data !== 'string' || data.length > MAX_FRAME) return;
      try {
        const m = JSON.parse(data) as unknown[];
        if (Array.isArray(m) && m[0] === 'EVENT' && m[1] === sub) receive(m[2]);
      } catch {
        /* not NIP-01 */
      }
    };
    socket.onerror = () => {};
    socket.onclose = () => {
      if (closed) return;
      attempted.add(url);
      if (attempted.size >= urls.length && !available() && !warned) {
        warned = true;
        onUnavailable();
      }
      const timer = setTimeout(() => {
        retry.delete(timer);
        connect(url);
      }, 5500);
      retry.add(timer);
    };
  }
  urls.forEach(connect);
  return {
    publish(e) {
      if (closed) return;
      const cmd = JSON.stringify(['EVENT', e]);
      for (const s of links.values()) if (s.readyState === WebSocket.OPEN) s.send(cmd);
    },
    open: () => [...links.values()].filter((s) => s.readyState === WebSocket.OPEN).length,
    close() {
      closed = true;
      for (const t of retry) clearTimeout(t);
      for (const s of links.values()) {
        try {
          s.close();
        } catch {
          /* ignore */
        }
      }
      links.clear();
      retry.clear();
    },
  };
}
