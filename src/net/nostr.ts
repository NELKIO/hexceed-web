// Minimal Nostr (NIP-01) event helpers: hashing, Schnorr signing / verification, base64.
// Schnorr comes from @noble/secp256k1 (the same library Trystero's Nostr strategy uses), so it is
// shared with the WebRTC chunk and only loaded together with the online features.

import { schnorr } from '@noble/secp256k1';

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export type UnsignedEvent = Omit<NostrEvent, 'id' | 'sig'>;

const encoder = new TextEncoder();
export const decoder = new TextDecoder();

export const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
export const fromHex = (s: string): Uint8Array => Uint8Array.from(s.match(/../g) ?? [], (p) => parseInt(p, 16));

export async function sha256(data: string | Uint8Array): Promise<Uint8Array> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

export const utf8 = (s: string): Uint8Array => encoder.encode(s);

const canonical = (e: UnsignedEvent): string => JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]);

export function keygen(): { secretKey: Uint8Array; publicKey: Uint8Array } {
  const { secretKey, publicKey } = schnorr.keygen();
  return { secretKey, publicKey };
}

export function publicKeyOf(secret: Uint8Array): string {
  return hex(schnorr.getPublicKey(secret));
}

export async function signEvent(e: UnsignedEvent, secret: Uint8Array): Promise<NostrEvent> {
  const digest = await sha256(canonical(e));
  const sig = await schnorr.signAsync(digest, secret);
  return { ...e, id: hex(digest), sig: hex(sig) };
}

const HEX64 = /^[a-f\d]{64}$/;
const HEX128 = /^[a-f\d]{128}$/;

/** Shape check of an untrusted value (no signature check). */
export function isEventShape(e: unknown): e is NostrEvent {
  if (!e || typeof e !== 'object') return false;
  const x = e as Record<string, unknown>;
  return (
    typeof x.id === 'string' &&
    HEX64.test(x.id) &&
    typeof x.pubkey === 'string' &&
    HEX64.test(x.pubkey) &&
    typeof x.sig === 'string' &&
    HEX128.test(x.sig) &&
    Number.isSafeInteger(x.created_at) &&
    Number.isSafeInteger(x.kind) &&
    typeof x.content === 'string' &&
    Array.isArray(x.tags) &&
    x.tags.every((t) => Array.isArray(t) && t.every((s) => typeof s === 'string'))
  );
}

export async function verifyEvent(e: NostrEvent): Promise<boolean> {
  try {
    if (!isEventShape(e)) return false;
    const digest = await sha256(canonical(e));
    if (hex(digest) !== e.id) return false;
    return await schnorr.verifyAsync(fromHex(e.sig), digest, fromHex(e.pubkey));
  } catch {
    return false;
  }
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export async function aesKey(secret: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', secret as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encrypt(key: CryptoKey, plain: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain as BufferSource));
  const out = new Uint8Array(12 + sealed.length);
  out.set(iv);
  out.set(sealed, 12);
  return out;
}

export async function decrypt(key: CryptoKey, body: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: body.subarray(0, 12) as BufferSource }, key, body.subarray(12) as BufferSource));
}

/** deflate-raw through the Compression Streams API; null when the browser has none. */
export async function deflate(bytes: Uint8Array, limit = 4_000_000): Promise<Uint8Array | null> {
  let cs: CompressionStream;
  try {
    cs = new CompressionStream('deflate-raw');
  } catch {
    return null;
  }
  return pipe(bytes, cs, limit);
}

export async function inflate(bytes: Uint8Array, limit = 4_000_000): Promise<Uint8Array> {
  return pipe(bytes, new DecompressionStream('deflate-raw'), limit);
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, limit: number): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error('too large');
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
