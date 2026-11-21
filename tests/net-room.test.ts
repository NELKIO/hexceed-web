// Room session over an in-memory transport: handshake, setup, live ops, reconnect + resync,
// lost storage, race progress, third player. Timers are faked; delivery is asynchronous.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Level } from '../src/core/types';
import { RoomSession, type SavedRoom, type ConnectFn } from '../src/net/room';
import type { Transport, TransportHandlers } from '../src/net/transport';

const LEVEL: Level = {
  id: 'room-test',
  cells: [
    { q: 0, r: 0, gem: false, start: true },
    { q: 0, r: -1, gem: true },
    { q: 1, r: -1, gem: false },
    { q: 1, r: 0, gem: false },
    { q: 0, r: 1, gem: true },
    { q: -1, r: 1, gem: false },
    { q: -1, r: 0, gem: false },
  ],
  walls: [],
  fog: false,
};

/** A tiny "network": every endpoint sees every other one while it is online. */
class FakeNet {
  ends = new Map<string, { h: TransportHandlers; online: boolean }>();
  n = 0;
  drop = false;
  connect: ConnectFn = async (_code, h, signal) => {
    const id = 'peer' + ++this.n;
    this.ends.set(id, { h, online: true });
    signal.addEventListener('abort', () => this.ends.delete(id));
    // presence: both sides learn about each other
    queueMicrotask(() => {
      for (const [other, e] of this.ends) {
        if (other === id || !e.online) continue;
        e.h.up(id);
        h.up(other);
      }
    });
    const t: Transport = {
      id,
      send: (peer, packet) => {
        const to = this.ends.get(peer);
        const me = this.ends.get(id);
        if (!to || !to.online || !me?.online || this.drop) return;
        const copy = JSON.parse(JSON.stringify(packet));
        setTimeout(() => to.h.message(id, copy), 5);
      },
      recover: () => {},
      path: (peer) => (this.ends.has(peer) ? 'direct' : null),
      relaysOpen: () => 1,
    };
    return t;
  };
  setOnline(id: string, online: boolean) {
    const e = this.ends.get(id);
    if (!e) return;
    e.online = online;
    for (const [other, o] of this.ends) {
      if (other === id) continue;
      if (online) {
        o.h.up(id);
        e.h.up(other);
      } else {
        o.h.down(id);
        e.h.down(other);
      }
    }
  }
}

function memStore(init: SavedRoom | null = null) {
  let v = init;
  return { load: () => v, save: (x: SavedRoom | null) => void (v = x ? JSON.parse(JSON.stringify(x)) : null), peek: () => v };
}

const settle = () => vi.advanceTimersByTimeAsync(200);

describe('room session', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pairs host and guest, sends the level and keeps co-op logs in sync', async () => {
    const net = new FakeNet();
    const host = new RoomSession({ code: 'ABCDEF', role: 'host', selfId: 'h', profile: { name: 'Лиса', color: '#ff6f61' }, connect: net.connect });
    const guest = new RoomSession({ code: 'ABCDEF', role: 'guest', selfId: 'g', profile: { name: 'Ёж', color: '#16b3a3' }, connect: net.connect });
    await settle();
    expect(host.snapshot().partner?.name).toBe('Ёж');
    expect(guest.snapshot().partner?.name).toBe('Лиса');
    expect(host.snapshot().conn).toBe('direct');

    const started: string[] = [];
    guest.onGame((g) => started.push(g.gid));
    const game = host.start({ mode: 'coop', level: LEVEL, src: { k: 'campaign', id: 'room-test' } })!;
    await settle();
    expect(started).toEqual([game.gid]);
    expect(guest.snapshot().game?.level).toEqual(LEVEL);

    const seen: string[] = [];
    host.onOps((ops) => ops.forEach((s) => seen.push(`${s.by}${s.seq}`)));
    guest.coopLocal({ t: 'act', cell: 2, a: 'reveal' });
    guest.coopLocal({ t: 'act', cell: 1, a: 'mark' });
    host.coopLocal({ t: 'rot' });
    await settle();
    expect(seen).toEqual(['g1', 'g2']);
    expect(host.coopLog()!.vector()).toEqual({ g: 2, h: 1 });
    expect(guest.coopLog()!.vector()).toEqual({ g: 2, h: 1 });
    host.close();
    guest.close();
  });

  it('resyncs after a reload: ops made while the partner was away arrive, nothing twice', async () => {
    const net = new FakeNet();
    const hs = memStore();
    const gs = memStore();
    const host = new RoomSession({ code: 'ABCDEF', role: 'host', selfId: 'h', profile: { name: 'A', color: '#ff6f61' }, connect: net.connect, store: hs });
    let guest = new RoomSession({ code: 'ABCDEF', role: 'guest', selfId: 'g', profile: { name: 'B', color: '#16b3a3' }, connect: net.connect, store: gs });
    await settle();
    host.start({ mode: 'coop', level: LEVEL, src: { k: 'campaign', id: 'x' } });
    await settle();
    guest.coopLocal({ t: 'act', cell: 2, a: 'reveal' });
    await settle();
    await vi.advanceTimersByTimeAsync(500); // persisted
    guest.close(); // page reload
    host.coopLocal({ t: 'act', cell: 3, a: 'reveal' });
    host.coopLocal({ t: 'miss', cell: 4 });
    await settle();
    expect(host.snapshot().partner?.left).toBe(true);

    guest = new RoomSession({ code: 'ABCDEF', role: 'guest', selfId: 'g', profile: { name: 'B', color: '#16b3a3' }, connect: net.connect, store: gs });
    expect(guest.coopLog()!.vector()).toEqual({ g: 1 }); // restored from storage
    const fresh: string[] = [];
    guest.onOps((ops) => ops.forEach((s) => fresh.push(`${s.by}${s.seq}`)));
    await settle();
    expect(fresh).toEqual(['h1', 'h2']);
    expect(guest.coopLog()!.vector()).toEqual({ g: 1, h: 2 });
    expect(host.snapshot().partner?.online).toBe(true);
    host.close();
    guest.close();
  });

  it('a guest that lost its storage gets the whole game back, including its own moves', async () => {
    const net = new FakeNet();
    const host = new RoomSession({ code: 'ABCDEF', role: 'host', selfId: 'h', profile: { name: 'A', color: '#ff6f61' }, connect: net.connect });
    let guest = new RoomSession({ code: 'ABCDEF', role: 'guest', selfId: 'g', profile: { name: 'B', color: '#16b3a3' }, connect: net.connect });
    await settle();
    const game = host.start({ mode: 'coop', level: LEVEL, src: { k: 'campaign', id: 'x' } })!;
    await settle();
    guest.coopLocal({ t: 'act', cell: 2, a: 'reveal' });
    host.coopLocal({ t: 'act', cell: 3, a: 'reveal' });
    await settle();
    guest.close();
    guest = new RoomSession({ code: 'ABCDEF', role: 'guest', selfId: 'g', profile: { name: 'B', color: '#16b3a3' }, connect: net.connect });
    await settle();
    expect(guest.snapshot().game?.gid).toBe(game.gid);
    expect(guest.coopLog()!.vector()).toEqual({ g: 1, h: 1 });
    // its next own op continues the sequence (no seq reuse)
    expect(guest.coopLocal({ t: 'rot' })!.seq).toBe(2);
    host.close();
    guest.close();
  });

  it('heals a lossy link with the periodic ping (anti-entropy)', async () => {
    const net = new FakeNet();
    const host = new RoomSession({ code: 'ABCDEF', role: 'host', selfId: 'h', profile: { name: 'A', color: '#ff6f61' }, connect: net.connect });
    const guest = new RoomSession({ code: 'ABCDEF', role: 'guest', selfId: 'g', profile: { name: 'B', color: '#16b3a3' }, connect: net.connect });
    await settle();
    host.start({ mode: 'coop', level: LEVEL, src: { k: 'campaign', id: 'x' } });
    await settle();
    net.drop = true;
    host.coopLocal({ t: 'act', cell: 3, a: 'reveal' });
    guest.coopLocal({ t: 'act', cell: 5, a: 'reveal' });
    await settle();
    expect(guest.coopLog()!.vector()).toEqual({ g: 1 });
    net.drop = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(guest.coopLog()!.vector()).toEqual({ g: 1, h: 1 });
    expect(host.coopLog()!.vector()).toEqual({ g: 1, h: 1 });
    host.close();
    guest.close();
  });

  it('marks a silent partner as reconnecting, then online again', async () => {
    const net = new FakeNet();
    const host = new RoomSession({ code: 'ABCDEF', role: 'host', selfId: 'h', profile: { name: 'A', color: '#ff6f61' }, connect: net.connect });
    const guest = new RoomSession({ code: 'ABCDEF', role: 'guest', selfId: 'g', profile: { name: 'B', color: '#16b3a3' }, connect: net.connect });
    await settle();
    net.drop = true;
    await vi.advanceTimersByTimeAsync(13_000);
    expect(host.snapshot().conn).toBe('reconnecting');
    expect(host.snapshot().partner?.online).toBe(false);
    net.drop = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(host.snapshot().conn).toBe('direct');
    host.close();
    guest.close();
  });

  it('race: progress and finish times reach the opponent', async () => {
    const net = new FakeNet();
    const host = new RoomSession({ code: 'ABCDEF', role: 'host', selfId: 'h', profile: { name: 'A', color: '#ff6f61' }, connect: net.connect });
    const guest = new RoomSession({ code: 'ABCDEF', role: 'guest', selfId: 'g', profile: { name: 'B', color: '#16b3a3' }, connect: net.connect });
    await settle();
    host.start({ mode: 'race', level: LEVEL, src: { k: 'endless', diff: 'easy', seed: 'abc' } });
    await settle();
    guest.raceProgress({ done: 2, total: 6, mistakes: 1, fin: 0 });
    await vi.advanceTimersByTimeAsync(500);
    expect(host.snapshot().race.theirs).toEqual({ done: 2, total: 6, mistakes: 1, fin: 0 });
    host.raceProgress({ done: 6, total: 6, mistakes: 0, fin: 41_000 });
    await settle();
    expect(guest.snapshot().race.theirs?.fin).toBe(41_000);
    // guest asks for a rematch, the host hears it
    let asked = 0;
    host.onRematch(() => asked++);
    guest.requestRematch();
    await settle();
    expect(asked).toBe(1);
    host.close();
    guest.close();
  });

  it('turns a third player away', async () => {
    const net = new FakeNet();
    const host = new RoomSession({ code: 'ABCDEF', role: 'host', selfId: 'h', profile: { name: 'A', color: '#ff6f61' }, connect: net.connect });
    const guest = new RoomSession({ code: 'ABCDEF', role: 'guest', selfId: 'g', profile: { name: 'B', color: '#16b3a3' }, connect: net.connect });
    await settle();
    const third = new RoomSession({ code: 'ABCDEF', role: 'guest', selfId: 'x', profile: { name: 'C', color: '#4f7cff' }, connect: net.connect });
    await settle();
    expect(third.snapshot().full).toBe(true);
    expect(host.snapshot().partner?.id).toBe('g');
    host.close();
    guest.close();
    third.close();
  });

  it('ignores malformed packets', async () => {
    const net = new FakeNet();
    const host = new RoomSession({ code: 'ABCDEF', role: 'host', selfId: 'h', profile: { name: 'A', color: '#ff6f61' }, connect: net.connect });
    const guest = new RoomSession({ code: 'ABCDEF', role: 'guest', selfId: 'g', profile: { name: 'B', color: '#16b3a3' }, connect: net.connect });
    await settle();
    const hostPeer = [...net.ends.keys()][0];
    const guestEnd = [...net.ends.values()][1];
    for (const junk of [null, 5, 'x', { t: 'setup', game: { gid: 'a', mode: 'coop', level: { id: 1 } } }, { t: 'ops', gid: 'z', ops: 'no' }, { t: 'hello', v: 1 }])
      guestEnd.h.message(hostPeer, junk);
    await settle();
    expect(guest.snapshot().game).toBe(null);
    host.close();
    guest.close();
  });
});
