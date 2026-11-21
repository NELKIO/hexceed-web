// A two-player room on top of a Transport: identity (nickname, colour, stable client id), host /
// guest roles, the current game (co-op op log or race progress), presence, liveness and resync.
// The transport is injected, so the whole session runs against an in-memory pair in tests.

import type { Level } from '../core/types';
import { CoopLog, isStamped, type CoopOp, type Stamped, type Vec } from './coop';
import { cleanColor, cleanName, type Profile } from './ids';
import type { Path, Transport, TransportHandlers } from './transport';

export const PROTOCOL = 1;
/** No packet from the partner for this long: "reconnecting" (and the relays are switched on). */
export const SILENT_MS = 12_000;
export const PING_MS = 4_000;
const OPS_PER_PACKET = 150;

export type Mode = 'coop' | 'race';
export type PuzzleSource = { k: 'campaign'; id: string } | { k: 'daily'; date: string } | { k: 'endless'; diff: string; seed: string };

export interface GameSetup {
  gid: string;
  mode: Mode;
  /** The full level, so both players get identical boards whatever version each one runs. */
  level: Level;
  src: PuzzleSource;
  at: number;
}

export interface RaceProgress {
  /** Hexes resolved by the player (start hexes excluded). */
  done: number;
  total: number;
  mistakes: number;
  /** Finish time (play time in ms), 0 while playing. */
  fin: number;
}

/** What the host is currently picking in the lobby (shown live to the guest). */
export interface HostChoice {
  mode: Mode;
  src: { k: 'campaign'; id: string } | { k: 'daily' } | { k: 'endless'; diff: string };
}

export type ConnState = 'connecting' | 'waiting' | 'direct' | 'relay' | 'reconnecting' | 'offline';

export interface Partner {
  id: string;
  name: string;
  color: string;
  online: boolean;
  /** Said goodbye (closed the room). */
  left: boolean;
}

export interface RoomSnapshot {
  code: string;
  role: 'host' | 'guest';
  self: Profile & { id: string };
  partner: Partner | null;
  conn: ConnState;
  game: GameSetup | null;
  race: { mine: RaceProgress | null; theirs: RaceProgress | null };
  choice: HostChoice | null;
  /** A third player tried to join a full room / this browser was turned away. */
  full: boolean;
  /** Bumps on every change (cheap equality for UI hooks). */
  rev: number;
}

export type ConnectFn = (code: string, handlers: TransportHandlers, signal: AbortSignal) => Promise<Transport | null>;

export interface RoomStore {
  load(): SavedRoom | null;
  save(v: SavedRoom | null): void;
}

export interface SavedRoom {
  game: GameSetup | null;
  ops: Stamped[];
  mine: RaceProgress | null;
  theirs: RaceProgress | null;
  partner: { id: string; name: string; color: string } | null;
  choice?: HostChoice | null;
}

type Msg =
  | { t: 'hello'; v: number; id: string; name: string; color: string; role: 'host' | 'guest'; gid: string | null; ack?: boolean }
  | { t: 'setup'; game: GameSetup }
  | { t: 'ops'; gid: string; ops: Stamped[] }
  | { t: 'vec'; gid: string; vec: Vec; reply?: boolean }
  | { t: 'ping'; gid: string | null; vec?: Vec }
  | { t: 'cur'; gid: string; cell: number }
  | { t: 'prog'; gid: string; p: RaceProgress }
  | { t: 'choice'; choice: HostChoice | null }
  | { t: 'rematch' }
  | { t: 'bye' }
  | { t: 'full' };

const isStr = (x: unknown, max = 200): x is string => typeof x === 'string' && x.length <= max;
const isInt = (x: unknown): x is number => Number.isSafeInteger(x);

function isVec(v: unknown): v is Vec {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const e = Object.entries(v as Record<string, unknown>);
  return e.length <= 16 && e.every(([k, n]) => k.length <= 40 && isInt(n) && n >= 0);
}

function isProgress(p: unknown): p is RaceProgress {
  if (!p || typeof p !== 'object') return false;
  const x = p as Record<string, unknown>;
  return isInt(x.done) && isInt(x.total) && isInt(x.mistakes) && isInt(x.fin) && x.done >= 0 && x.total >= 0 && x.fin >= 0;
}

/** Light structural check of a level received from the peer (the board builder does the rest). */
export function isLevelShape(l: unknown): l is Level {
  if (!l || typeof l !== 'object') return false;
  const x = l as Record<string, unknown>;
  if (!isStr(x.id, 120) || !Array.isArray(x.cells) || x.cells.length < 1 || x.cells.length > 2000 || !Array.isArray(x.walls)) return false;
  return x.cells.every((c) => {
    const y = c as Record<string, unknown>;
    return !!y && typeof y === 'object' && isInt(y.q) && isInt(y.r) && typeof y.gem === 'boolean';
  });
}

function isSource(s: unknown): s is PuzzleSource {
  if (!s || typeof s !== 'object') return false;
  const x = s as Record<string, unknown>;
  if (x.k === 'campaign') return isStr(x.id, 120);
  if (x.k === 'daily') return isStr(x.date, 20);
  if (x.k === 'endless') return isStr(x.diff, 20) && isStr(x.seed, 40);
  return false;
}

function isChoice(c: unknown): c is HostChoice {
  if (!c || typeof c !== 'object') return false;
  const x = c as Record<string, unknown>;
  if (x.mode !== 'coop' && x.mode !== 'race') return false;
  const s = x.src as Record<string, unknown> | undefined;
  if (!s || typeof s !== 'object') return false;
  return (s.k === 'campaign' && isStr(s.id, 120)) || s.k === 'daily' || (s.k === 'endless' && isStr(s.diff, 20));
}

function isSetup(g: unknown): g is GameSetup {
  if (!g || typeof g !== 'object') return false;
  const x = g as Record<string, unknown>;
  return isStr(x.gid, 40) && (x.mode === 'coop' || x.mode === 'race') && isLevelShape(x.level) && isSource(x.src) && isInt(x.at);
}

export function parseMsg(raw: unknown): Msg | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  switch (m.t) {
    case 'hello':
      return isInt(m.v) && isStr(m.id, 40) && typeof m.name === 'string' && (m.role === 'host' || m.role === 'guest') && (m.gid === null || isStr(m.gid, 40))
        ? (m as unknown as Msg)
        : null;
    case 'setup':
      return isSetup(m.game) ? (m as unknown as Msg) : null;
    case 'ops':
      return isStr(m.gid, 40) && Array.isArray(m.ops) && m.ops.length <= 2000 ? { t: 'ops', gid: m.gid, ops: m.ops.filter(isStamped) } : null;
    case 'vec':
      return isStr(m.gid, 40) && isVec(m.vec) ? (m as unknown as Msg) : null;
    case 'ping':
      return (m.gid === null || isStr(m.gid, 40)) && (m.vec === undefined || isVec(m.vec)) ? (m as unknown as Msg) : null;
    case 'cur':
      return isStr(m.gid, 40) && isInt(m.cell) ? (m as unknown as Msg) : null;
    case 'prog':
      return isStr(m.gid, 40) && isProgress(m.p) ? (m as unknown as Msg) : null;
    case 'choice':
      return m.choice === null || isChoice(m.choice) ? (m as unknown as Msg) : null;
    case 'rematch':
    case 'bye':
    case 'full':
      return { t: m.t } as Msg;
    default:
      return null;
  }
}

function randomId(): string {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('');
}

export interface RoomOptions {
  code: string;
  role: 'host' | 'guest';
  selfId: string;
  profile: Profile;
  connect: ConnectFn;
  store?: RoomStore;
  now?: () => number;
}

export class RoomSession {
  readonly code: string;
  readonly role: 'host' | 'guest';
  readonly selfId: string;
  private profile: Profile;
  private now: () => number;
  private store?: RoomStore;
  private abort = new AbortController();
  private transport: Transport | null = null;
  private failed = false;

  private partner: Partner | null = null;
  /** Transport peer currently bound to the partner. */
  private peer: string | null = null;
  private lastSeen = 0;
  private game: GameSetup | null = null;
  private log: CoopLog | null = null;
  private mine: RaceProgress | null = null;
  private theirs: RaceProgress | null = null;
  private choice: HostChoice | null = null;
  private full = false;
  private rev = 0;
  private snap: RoomSnapshot | null = null;

  private outOps: Stamped[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private curTimer: ReturnType<typeof setTimeout> | null = null;
  private curPending: { cell: number } | null = null;
  private curLast = 0;
  private progTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private tick: ReturnType<typeof setInterval>;
  private lastPing = 0;

  private subs = new Set<() => void>();
  private opSubs = new Set<(ops: Stamped[]) => void>();
  private curSubs = new Set<(cell: number) => void>();
  private rematchSubs = new Set<() => void>();
  private gameSubs = new Set<(g: GameSetup) => void>();

  constructor(o: RoomOptions) {
    this.code = o.code;
    this.role = o.role;
    this.selfId = o.selfId;
    this.profile = { name: cleanName(o.profile.name) || '?', color: cleanColor(o.profile.color) };
    this.now = o.now ?? Date.now;
    this.store = o.store;
    const saved = o.store?.load();
    if (saved && (saved.game === null || isSetup(saved.game))) {
      this.game = saved.game;
      if (this.game?.mode === 'coop') this.log = new CoopLog(this.selfId, Array.isArray(saved.ops) ? saved.ops : []);
      this.mine = isProgress(saved.mine) ? saved.mine : null;
      this.theirs = isProgress(saved.theirs) ? saved.theirs : null;
      if (saved.partner && isStr(saved.partner.id, 40)) this.partner = { id: saved.partner.id, name: cleanName(saved.partner.name) || '?', color: cleanColor(saved.partner.color), online: false, left: false };
      if (saved.choice && isChoice(saved.choice)) this.choice = saved.choice;
    }
    const handlers: TransportHandlers = {
      up: (peer) => this.send(peer, this.hello(false)),
      down: (peer) => {
        if (peer === this.peer) this.lastSeen = Math.min(this.lastSeen, this.now() - SILENT_MS);
        this.changed();
      },
      message: (peer, packet) => this.onPacket(peer, packet),
      path: () => this.changed(),
      error: (kind) => {
        if (kind === 'full') this.full = true;
        if (kind === 'relay') this.failed = true;
        this.changed();
      },
    };
    void o
      .connect(o.code, handlers, this.abort.signal)
      .then((t) => {
        this.transport = t;
        if (!t) this.failed = true;
        this.changed();
      })
      .catch((e) => {
        console.warn('room connect failed', e);
        this.failed = true;
        this.changed();
      });
    this.tick = setInterval(() => this.onTick(), 1000);
  }

  // ---------------------------------------------------------------- public API

  snapshot(): RoomSnapshot {
    if (this.snap && this.snap.rev === this.rev) {
      // conn depends on time; refresh it lazily
      const conn = this.conn();
      if (conn === this.snap.conn && (!this.partner || this.partner.online === this.isOnline())) return this.snap;
    }
    const online = this.isOnline();
    this.snap = {
      code: this.code,
      role: this.role,
      self: { id: this.selfId, ...this.profile },
      partner: this.partner ? { ...this.partner, online } : null,
      conn: this.conn(),
      game: this.game,
      race: { mine: this.mine, theirs: this.theirs },
      choice: this.choice,
      full: this.full,
      rev: this.rev,
    };
    return this.snap;
  }

  subscribe(f: () => void): () => void {
    this.subs.add(f);
    return () => void this.subs.delete(f);
  }

  /** Remote co-op ops, already appended to the log (apply them to the board). */
  onOps(f: (ops: Stamped[]) => void): () => void {
    this.opSubs.add(f);
    return () => void this.opSubs.delete(f);
  }

  onCursor(f: (cell: number) => void): () => void {
    this.curSubs.add(f);
    return () => void this.curSubs.delete(f);
  }

  /** Host: the guest asked for a rematch. */
  onRematch(f: () => void): () => void {
    this.rematchSubs.add(f);
    return () => void this.rematchSubs.delete(f);
  }

  /** A new game started (by this host or received from the host). */
  onGame(f: (g: GameSetup) => void): () => void {
    this.gameSubs.add(f);
    return () => void this.gameSubs.delete(f);
  }

  coopLog(): CoopLog | null {
    return this.log;
  }

  /** Host: start a game (co-op or race) on a level. */
  start(s: { mode: Mode; level: Level; src: PuzzleSource }): GameSetup | null {
    if (this.role !== 'host') return null;
    const game: GameSetup = { gid: randomId(), mode: s.mode, level: s.level, src: s.src, at: this.now() };
    this.adopt(game);
    if (this.peer) this.send(this.peer, { t: 'setup', game });
    return game;
  }

  /** A co-op op made on this device (the caller has already applied it to its board). */
  coopLocal(op: CoopOp): Stamped | null {
    if (!this.log || !this.game || this.game.mode !== 'coop') return null;
    const s = this.log.local(op, this.now());
    this.outOps.push(s);
    this.scheduleFlush();
    this.scheduleSave();
    this.changed();
    return s;
  }

  raceProgress(p: RaceProgress): void {
    if (!this.game || this.game.mode !== 'race') return;
    const prev = this.mine;
    this.mine = p;
    this.scheduleSave();
    if (!this.progTimer) {
      const send = () => {
        this.progTimer = null;
        if (this.peer && this.game && this.mine) this.send(this.peer, { t: 'prog', gid: this.game.gid, p: this.mine });
      };
      // a finish goes out at once, progress at most ~3 times a second
      if (p.fin && !prev?.fin) send();
      else this.progTimer = setTimeout(send, this.path() === 'relay' ? 900 : 300);
    }
    this.changed();
  }

  cursor(cell: number): void {
    if (!this.game || !this.peer) return;
    this.curPending = { cell };
    if (this.curTimer) return;
    const gap = this.path() === 'relay' ? 700 : 50;
    const wait = Math.max(0, this.curLast + gap - this.now());
    this.curTimer = setTimeout(() => {
      this.curTimer = null;
      const c = this.curPending;
      this.curPending = null;
      if (!c || !this.game || !this.peer) return;
      this.curLast = this.now();
      this.send(this.peer, { t: 'cur', gid: this.game.gid, cell: c.cell });
    }, wait);
  }

  setProfile(p: Profile): void {
    this.profile = { name: cleanName(p.name) || this.profile.name, color: cleanColor(p.color) };
    if (this.peer) this.send(this.peer, this.hello(true));
    this.changed();
  }

  setChoice(c: HostChoice | null): void {
    if (this.role !== 'host') return;
    this.choice = c;
    if (this.peer) this.send(this.peer, { t: 'choice', choice: c });
    this.scheduleSave();
    this.changed();
  }

  requestRematch(): void {
    if (this.role === 'host') this.rematchSubs.forEach((f) => f());
    else if (this.peer) this.send(this.peer, { t: 'rematch' });
  }

  close(): void {
    if (this.peer) this.send(this.peer, { t: 'bye' });
    this.persist();
    clearInterval(this.tick);
    for (const t of [this.flushTimer, this.curTimer, this.progTimer, this.saveTimer]) if (t) clearTimeout(t);
    this.abort.abort();
    this.subs.clear();
    this.opSubs.clear();
    this.curSubs.clear();
    this.rematchSubs.clear();
    this.gameSubs.clear();
  }

  // ---------------------------------------------------------------- internals

  private isOnline(): boolean {
    return !!this.partner && !this.partner.left && !!this.peer && this.now() - this.lastSeen < SILENT_MS;
  }

  private path(): Path | null {
    return this.peer && this.transport ? this.transport.path(this.peer) : null;
  }

  private conn(): ConnState {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
    if (!this.transport) return this.failed ? 'offline' : 'connecting';
    if (!this.partner || this.partner.left || !this.peer) return this.partner && !this.partner.left ? 'reconnecting' : this.failed ? 'offline' : 'waiting';
    if (!this.isOnline()) return 'reconnecting';
    return this.path() ?? 'relay';
  }

  private changed() {
    this.rev++;
    this.subs.forEach((f) => f());
  }

  private send(peer: string, m: Msg) {
    this.transport?.send(peer, m);
  }

  private hello(ack: boolean): Msg {
    return { t: 'hello', v: PROTOCOL, id: this.selfId, name: this.profile.name, color: this.profile.color, role: this.role, gid: this.game?.gid ?? null, ack };
  }

  private adopt(game: GameSetup) {
    if (this.game?.gid === game.gid) return;
    this.game = game;
    this.log = game.mode === 'coop' ? new CoopLog(this.selfId) : null;
    this.mine = null;
    this.theirs = null;
    this.outOps = [];
    this.persist();
    this.gameSubs.forEach((f) => f(game));
    this.changed();
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, this.path() === 'relay' ? 150 : 16);
  }

  private flush() {
    const ops = this.outOps;
    this.outOps = [];
    if (!ops.length || !this.peer || !this.game) return; // the log keeps them; anti-entropy resends
    this.sendOps(this.peer, ops);
  }

  private sendOps(peer: string, ops: Stamped[]) {
    if (!this.game) return;
    for (let k = 0; k < ops.length; k += OPS_PER_PACKET) this.send(peer, { t: 'ops', gid: this.game.gid, ops: ops.slice(k, k + OPS_PER_PACKET) });
  }

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persist();
    }, 400);
  }

  private persist() {
    this.store?.save({
      game: this.game,
      ops: this.log?.all() ?? [],
      mine: this.mine,
      theirs: this.theirs,
      partner: this.partner ? { id: this.partner.id, name: this.partner.name, color: this.partner.color } : null,
      choice: this.choice,
    });
  }

  private onTick() {
    const now = this.now();
    if (this.peer && now - this.lastPing >= PING_MS) {
      this.lastPing = now;
      this.send(this.peer, { t: 'ping', gid: this.game?.gid ?? null, vec: this.log?.vector() });
    }
    if (this.peer && this.partner && !this.partner.left && now - this.lastSeen >= SILENT_MS) this.transport?.recover(this.peer);
    // the "online" flag is time based: let the UI notice transitions
    const s = this.snap;
    if (s && (s.conn !== this.conn() || (s.partner?.online ?? false) !== this.isOnline())) this.changed();
  }

  private onPacket(peer: string, raw: unknown) {
    const m = parseMsg(raw);
    if (!m) return;
    if (m.t === 'hello') return this.onHello(peer, m);
    if (m.t === 'full') {
      // the host already plays with someone else
      this.full = true;
      if (peer === this.peer) {
        this.peer = null;
        this.partner = null;
      }
      this.changed();
      return;
    }
    if (peer !== this.peer) {
      // an unknown peer (e.g. our partner after a reload, before its hello arrived): ask who it is
      this.send(peer, this.hello(false));
      return;
    }
    const wasOnline = this.isOnline();
    this.lastSeen = this.now();
    if (this.partner?.left) this.partner.left = false;
    switch (m.t) {
      case 'setup':
        if (this.role === 'guest') {
          this.adopt(m.game);
          this.send(peer, { t: 'vec', gid: m.game.gid, vec: this.log?.vector() ?? {} });
          if (this.mine && m.game.mode === 'race') this.send(peer, { t: 'prog', gid: m.game.gid, p: this.mine });
        }
        break;
      case 'ops':
        if (this.log && this.game?.gid === m.gid) this.receiveOps(peer, m.ops);
        break;
      case 'vec':
        if (this.log && this.game?.gid === m.gid) {
          const miss = this.log.missing(m.vec);
          if (miss.length) this.sendOps(peer, miss);
          // they hold ops we lack: ask once
          if (!m.reply && Object.entries(m.vec).some(([by, n]) => n > this.log!.seq(by))) this.send(peer, { t: 'vec', gid: m.gid, vec: this.log.vector(), reply: true });
        }
        break;
      case 'ping':
        if (this.game && m.gid !== this.game.gid && this.role === 'host') this.sendGame(peer);
        else if (this.log && this.game && m.gid === this.game.gid && m.vec && !this.log.covers(m.vec)) this.sendOps(peer, this.log.missing(m.vec));
        break;
      case 'cur':
        if (this.game?.gid === m.gid) this.curSubs.forEach((f) => f(m.cell));
        break;
      case 'prog':
        if (this.game?.gid === m.gid && this.game.mode === 'race') {
          this.theirs = m.p;
          this.scheduleSave();
        }
        break;
      case 'choice':
        if (this.role === 'guest') {
          this.choice = m.choice;
          this.scheduleSave();
        }
        break;
      case 'rematch':
        if (this.role === 'host') this.rematchSubs.forEach((f) => f());
        break;
      case 'bye':
        if (this.partner) this.partner.left = true;
        this.lastSeen = 0;
        break;
    }
    if (!wasOnline || m.t !== 'ping') this.changed();
  }

  private receiveOps(peer: string, ops: Stamped[]) {
    const log = this.log!;
    const fresh = log.receive(ops);
    if (fresh.length) {
      this.opSubs.forEach((f) => f(fresh));
      this.scheduleSave();
    }
    if (log.hasGaps() && this.game) this.send(peer, { t: 'vec', gid: this.game.gid, vec: log.vector() });
  }

  private sendGame(peer: string) {
    if (!this.game) return;
    this.send(peer, { t: 'setup', game: this.game });
    if (this.log) this.sendOps(peer, this.log.all());
    if (this.mine) this.send(peer, { t: 'prog', gid: this.game.gid, p: this.mine });
  }

  private onHello(peer: string, m: Extract<Msg, { t: 'hello' }>) {
    if (m.id === this.selfId) return; // another tab of this browser
    if (m.role === this.role) return; // two hosts (or two guests) cannot pair
    const now = this.now();
    const known = this.partner?.id === m.id;
    if (!known && this.partner && !this.partner.left && this.isOnline()) {
      // a third player: the room is taken
      this.send(peer, { t: 'full' });
      return;
    }
    if (!known && this.role === 'guest' && this.game && this.partner && m.gid !== this.game.gid) {
      // a different host: forget the old game, wait for its setup
      this.game = null;
      this.log = null;
    }
    const rebound = this.peer !== peer;
    this.peer = peer;
    this.lastSeen = now;
    this.partner = { id: m.id, name: cleanName(m.name) || '?', color: cleanColor(m.color), online: true, left: false };
    this.full = false;
    if (!m.ack || rebound) this.send(peer, this.hello(true));
    // bring the partner up to date
    if (this.game) {
      if (m.gid !== this.game.gid) {
        if (this.role === 'host') this.sendGame(peer);
      } else {
        if (this.log) this.send(peer, { t: 'vec', gid: this.game.gid, vec: this.log.vector() });
        if (this.mine) this.send(peer, { t: 'prog', gid: this.game.gid, p: this.mine });
      }
    }
    if (this.role === 'host' && this.choice && (rebound || !known)) this.send(peer, { t: 'choice', choice: this.choice });
    this.scheduleSave();
    this.changed();
  }
}
