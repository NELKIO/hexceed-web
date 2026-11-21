// Device sync: merge laws, merge rules, sanitising, encryption + signatures, and the whole sync
// cycle of two devices through a fake NIP-01 relay that keeps replaceable events.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanDoc, emptyDoc, mergeDocs, stableJson, type SyncDoc } from '../src/net/sync-merge';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomDoc(rand: () => number): SyncDoc {
  const d = emptyDoc();
  const ids = ['w1-1', 'w1-2', 'w1-3', 'w2-1', 'w2-2', 's01', 's05'];
  for (const id of ids)
    if (rand() < 0.6) d.best[id] = { stars: 1 + Math.floor(rand() * 3), time: 1000 + Math.floor(rand() * 90000), mistakes: Math.floor(rand() * 5), hints: Math.floor(rand() * 3), at: Math.floor(rand() * 1e6) };
  for (const m of ['basic', 'walls', 'line', 'ring', 'lock']) if (rand() < 0.5) d.seen.push(m);
  for (const day of ['2026-11-01', '2026-11-02', '2026-11-03'])
    if (rand() < 0.5) d.daily[day] = { levelId: rand() < 0.5 ? `daily-${day}` : `daily-${day}-v2`, stars: 1 + Math.floor(rand() * 3), time: 5000 + Math.floor(rand() * 60000), mistakes: Math.floor(rand() * 4) };
  return d;
}

const j = (d: SyncDoc) => stableJson(d);

describe('merge laws', () => {
  it('is commutative, associative and idempotent', () => {
    const rand = rng(42);
    for (let k = 0; k < 200; k++) {
      const a = randomDoc(rand), b = randomDoc(rand), c = randomDoc(rand);
      expect(j(mergeDocs(a, b))).toBe(j(mergeDocs(b, a)));
      expect(j(mergeDocs(mergeDocs(a, b), c))).toBe(j(mergeDocs(a, mergeDocs(b, c))));
      const ab = mergeDocs(a, b);
      expect(j(mergeDocs(ab, ab))).toBe(j(ab));
      expect(j(mergeDocs(ab, a))).toBe(j(ab));
    }
  });
});

describe('merge rules', () => {
  it('per level: max stars, min time, min mistakes (fields independently)', () => {
    const a = { v: 1, best: { L: { stars: 3, time: 90_000, mistakes: 0, hints: 0 } }, seen: ['basic'], daily: {} };
    const b = { v: 1, best: { L: { stars: 1, time: 30_000, mistakes: 4, hints: 2 }, M: { stars: 2, time: 5, mistakes: 1 } }, seen: ['walls', 'basic'], daily: {} };
    const m = mergeDocs(a, b);
    expect(m.best.L).toEqual({ stars: 3, time: 30_000, mistakes: 0, hints: 0 });
    expect(m.best.M).toEqual({ stars: 2, time: 5, mistakes: 1 });
    expect(m.seen).toEqual(['basic', 'walls']);
  });

  it('daily results: union, keeping the best', () => {
    const a = { v: 1, best: {}, seen: [], daily: { '2026-11-20': { levelId: 'daily-2026-11-20', stars: 2, time: 40_000, mistakes: 1 } } };
    const b = { v: 1, best: {}, seen: [], daily: { '2026-11-20': { levelId: 'daily-2026-11-20', stars: 3, time: 50_000, mistakes: 0 }, '2026-11-21': { levelId: 'daily-2026-11-21', stars: 1, time: 9, mistakes: 7 } } };
    const m = mergeDocs(a, b);
    expect(m.daily['2026-11-20']).toEqual({ levelId: 'daily-2026-11-20', stars: 3, time: 40_000, mistakes: 0 });
    expect(Object.keys(m.daily)).toEqual(['2026-11-20', '2026-11-21']);
  });

  it('drops hostile or broken input', () => {
    const evil = JSON.parse('{"v":1,"best":{"__proto__":{"stars":3,"time":1,"mistakes":0},"ok":{"stars":3,"time":1,"mistakes":0},"neg":{"stars":-1,"time":1,"mistakes":0},"nan":{"stars":2,"time":"x","mistakes":0},"big":{"stars":99,"time":1,"mistakes":0}},"seen":["basic",5,null,"constructor"],"daily":{"not-a-date":{"levelId":"x","stars":3,"time":1,"mistakes":0},"2026-01-01":{"stars":3,"time":1,"mistakes":0}}}');
    const d = cleanDoc(evil);
    expect(Object.keys(d.best)).toEqual(['ok']);
    expect(d.seen).toEqual(['basic']);
    expect(d.daily).toEqual({});
    expect(({} as Record<string, unknown>).stars).toBeUndefined();
    expect(cleanDoc(null)).toEqual(emptyDoc());
    expect(cleanDoc([1, 2])).toEqual(emptyDoc());
  });
});

// ------------------------------------------------------------------ crypto + full cycle

interface Ev {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/** NIP-01 relay keeping the newest replaceable event per (pubkey, kind, d). */
class FakeRelay {
  events: Ev[] = [];
  up = true;
  handle(msg: unknown[], reply: (m: unknown[]) => void) {
    if (msg[0] === 'EVENT') {
      const e = msg[1] as Ev;
      const d = e.tags.find((t) => t[0] === 'd')?.[1];
      const old = this.events.find((x) => x.pubkey === e.pubkey && x.kind === e.kind && x.tags.find((t) => t[0] === 'd')?.[1] === d);
      if (old && (old.created_at > e.created_at || (old.created_at === e.created_at && old.id <= e.id))) return reply(['OK', e.id, false, 'duplicate: have newer']);
      this.events = this.events.filter((x) => x !== old).concat(e);
      reply(['OK', e.id, true, '']);
    } else if (msg[0] === 'REQ') {
      const f = msg[2] as { authors: string[]; kinds: number[] };
      for (const e of this.events) if (f.authors.includes(e.pubkey) && f.kinds.includes(e.kind)) reply(['EVENT', msg[1], e]);
      reply(['EOSE', msg[1]]);
    }
  }
}

const relays = new Map<string, FakeRelay>();

class FakeSocket {
  static OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    const r = relays.get(url);
    setTimeout(() => {
      if (!r?.up) {
        this.onerror?.();
        this.onclose?.();
        return;
      }
      this.readyState = 1;
      this.onopen?.();
    }, 1);
  }
  send(data: string) {
    const r = relays.get(this.url)!;
    r.handle(JSON.parse(data), (m) => setTimeout(() => this.onmessage?.({ data: JSON.stringify(m) }), 1));
  }
  close() {
    this.readyState = 3;
  }
}

class MemStorage {
  m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

const URLS = ['wss://a.test', 'wss://b.test', 'wss://c.test'];

describe('sync over relays', () => {
  const devA = new MemStorage();
  const devB = new MemStorage();
  const use = (s: MemStorage) => vi.stubGlobal('localStorage', s);

  beforeEach(() => {
    for (const u of URLS) relays.set(u, new FakeRelay());
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
    vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('seals and opens a document; rejects forged, foreign and tampered events', async () => {
    const { accountOf, sealDoc, openDoc } = await import('../src/net/sync');
    const acc = await accountOf('ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
    const doc = mergeDocs(randomDoc(rng(1)));
    const e = await sealDoc(acc, doc, 1_700_000_000);
    expect(e.content.startsWith('z1:')).toBe(true);
    expect(e.content).not.toContain('stars');
    const o = await openDoc(acc, e);
    expect(o && 'doc' in o && j(o.doc)).toBe(j(doc));
    // the same key on another device derives the same account
    expect((await accountOf('ABCDEFGHJKLMNPQRSTUVWXYZ23456789')).pubkey).toBe(acc.pubkey);
    const other = await accountOf('BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
    expect(await openDoc(other, e)).toBe(null);
    expect(await openDoc(acc, { ...e, content: e.content.slice(0, -4) + 'AAAA' })).toBe(null); // breaks the id/signature
    expect(await openDoc(acc, { ...e, sig: '0'.repeat(128) })).toBe(null);
  });

  it('two devices link, merge both ways and converge', async () => {
    vi.resetModules();
    use(devA);
    const storage = await import('../src/storage');
    const { createSync } = await import('../src/net/sync');
    storage.recordResult('w1-1', { stars: 3, time: 50_000, mistakes: 0, hints: 0 });
    storage.markSeen(['basic', 'walls']);
    storage.saveDaily('2026-11-20', { levelId: 'daily-2026-11-20', stars: 2, time: 61_000, mistakes: 1, hints: 0 });
    const KEY = 'KX7M2QABCDEFGHJKLMNPQRSTUVWXYZ23';
    const a1 = createSync({ relays: URLS, intervalMs: 1e9 });
    const s1 = await a1.link(KEY);
    expect(s1.state).toBe('ok');
    expect(s1.relays).toBe(3);
    a1.stop();

    // device B: its own progress, then the link
    use(devB);
    storage.recordResult('w1-1', { stars: 2, time: 20_000, mistakes: 2, hints: 1 });
    storage.recordResult('w1-2', { stars: 1, time: 99_000, mistakes: 5, hints: 3 });
    storage.markSeen(['line']);
    const b1 = createSync({ relays: URLS, intervalMs: 1e9 });
    expect((await b1.link('kx7m-2qab-cdef-ghjk-lmnp-qrst-uvwx-yz23')).state).toBe('ok');
    const best = storage.loadBest();
    expect(best['w1-1'].stars).toBe(3);
    expect(best['w1-1'].time).toBe(20_000);
    expect(best['w1-1'].mistakes).toBe(0);
    expect(best['w1-2'].stars).toBe(1);
    expect(storage.loadSeen().sort()).toEqual(['basic', 'line', 'walls']);
    expect(storage.loadDaily()['2026-11-20'].stars).toBe(2);
    b1.stop();

    // back on A: B's progress arrives
    use(devA);
    const a2 = createSync({ relays: URLS, intervalMs: 1e9 });
    expect((await a2.syncNow()).state).toBe('ok');
    expect(storage.loadBest()['w1-2'].stars).toBe(1);
    expect(storage.loadBest()['w1-1'].time).toBe(20_000);
    expect(storage.loadSeen().sort()).toEqual(['basic', 'line', 'walls']);
    const docA = stableJson(storage.exportProgress());
    a2.stop();
    use(devB);
    expect(stableJson(storage.exportProgress())).toBe(docA);

    // a relay that is down does not break anything; unlink keeps local progress
    relays.get(URLS[0])!.up = false;
    const b2 = createSync({ relays: URLS, intervalMs: 1e9 });
    expect((await b2.syncNow()).state).toBe('ok');
    b2.unlink();
    expect(b2.status().state).toBe('off');
    expect(storage.loadBest()['w1-2'].stars).toBe(1);
    b2.stop();
  });
});
