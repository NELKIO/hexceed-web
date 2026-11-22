// GameSession implementations (co-op / race) on top of a RoomSession, plus their in-game UI:
// the partner's pointer + ripples on the board, the slim strip under the top bar, result sheets.

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { newGame, type Game } from '../../core/game';
import { CellState } from '../../core/types';
import { t } from '../../i18n';
import { sfx } from '../../audio/sfx';
import { applyOp, contributions, type CoopOp } from '../../net/coop';
import type { GameSetup, RaceProgress, RoomSession, RoomSnapshot } from '../../net/room';
import type { GameSession, RemoteMove, SessionOp } from '../game/session';
import type { WinInfo } from '../game/GameView';
import { OUTLINE_PATH, S, type Layout } from '../game/geometry';
import { fmtTime, Stars } from '../components/ui';
import { IconBulb, IconClock, IconRestart, IconX } from '../icons';
import { ConnBadge, HexDot, PlayerChip, partnerColor, tone, useRoomSnap } from './parts';

type Listener<T> = (v: T) => void;

function emitter<T>() {
  const subs = new Set<Listener<T>>();
  return {
    on(f: Listener<T>) {
      subs.add(f);
      return () => void subs.delete(f);
    },
    emit(v: T) {
      subs.forEach((f) => f(v));
    },
  };
}

function resolvedCount(g: Game): number {
  let n = 0;
  for (let i = 0; i < g.board.n; i++) if (g.state[i] !== CellState.Hidden) n++;
  return n;
}

export interface SessionHooks {
  exit(): void;
  rematch(): void;
}

export function makeSession(room: RoomSession, game: GameSetup, hooks: SessionHooks): GameSession {
  return game.mode === 'coop' ? coopSession(room, game, hooks) : raceSession(room, game, hooks);
}

// ------------------------------------------------------------------ co-op

function coopSession(room: RoomSession, game: GameSetup, hooks: SessionHooks): GameSession {
  const ripples = emitter<{ cell: number; color: string }>();
  const partnerInfo = () => {
    const s = room.snapshot();
    return { name: s.partner?.name ?? '?', color: partnerColor(s) };
  };

  function Overlay({ layout }: { layout: Layout }) {
    const snap = useRoomSnap(room);
    const [cur, setCur] = useState<{ cell: number; at: number }>({ cell: -1, at: 0 });
    const [rip, setRip] = useState<{ cell: number; color: string; key: number }[]>([]);
    const key = useRef(0);
    useEffect(() => room.onCursor((cell) => setCur({ cell, at: Date.now() })), []);
    useEffect(
      () =>
        ripples.on((r) => {
          const k = ++key.current;
          setRip((rs) => [...rs.slice(-6), { ...r, key: k }]);
          setTimeout(() => setRip((rs) => rs.filter((x) => x.key !== k)), 900);
        }),
      [],
    );
    // fade the pointer out after a while without movement
    const [, tick] = useState(0);
    useEffect(() => {
      const id = setInterval(() => tick((n) => n + 1), 2000);
      return () => clearInterval(id);
    }, []);
    const color = partnerColor(snap);
    const show = snap.partner?.online && cur.cell >= 0 && cur.cell < layout.px.length && Date.now() - cur.at < 9000;
    const name = snap.partner?.name ?? '';
    return (
      <g class="partner-layer" style={{ '--pc': tone(color) } as JSX.CSSProperties}>
        {rip.map((r) => {
          const [x, y] = layout.px[r.cell] ?? [0, 0];
          return (
            <g key={r.key} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>
              <path class="p-ripple" d={layout.outline[r.cell] ?? OUTLINE_PATH} style={{ stroke: tone(r.color) }} />
              <path class="p-ripple r2" d={layout.outline[r.cell] ?? OUTLINE_PATH} style={{ stroke: tone(r.color) }} />
            </g>
          );
        })}
        {show && (
          <g class="p-cursor" transform={`translate(${layout.px[cur.cell][0].toFixed(1)} ${layout.px[cur.cell][1].toFixed(1)})`}>
            <path class="p-outline" d={layout.outline[cur.cell] ?? OUTLINE_PATH} />
            <g class="p-chip" transform={`translate(0 ${(-S * 1.02).toFixed(1)})`}>
              <rect x={-(name.length * 4.6 + 10)} y={-11} width={name.length * 9.2 + 20} height={22} rx={11} />
              <text text-anchor="middle" dominant-baseline="central" font-size={13}>
                {name}
              </text>
            </g>
          </g>
        )}
      </g>
    );
  }

  function Strip() {
    const snap = useRoomSnap(room);
    return (
      <div class="o-strip">
        <PlayerChip name={snap.self.name} color={snap.self.color} you />
        <span class="o-amp">+</span>
        {snap.partner ? <PlayerChip name={snap.partner.name} color={partnerColor(snap)} away={!snap.partner.online} /> : <PlayerChip name={t('on_waiting')} color="" waiting />}
        <span class="o-gap" />
        <ConnBadge conn={snap.conn} compact />
      </div>
    );
  }

  function Result({ win }: { win: WinInfo; g: Game }) {
    const snap = useRoomSnap(room);
    const log = room.coopLog();
    const table = contributions(log?.all() ?? []);
    const rows = [
      { id: snap.self.id, name: snap.self.name, color: snap.self.color, you: true },
      ...(snap.partner ? [{ id: snap.partner.id, name: snap.partner.name, color: partnerColor(snap), you: false }] : []),
    ];
    return (
      <div class="res">
        <div class="res-glow" />
        <h2>{t('on_solvedTogether')}</h2>
        <Stars n={win.stars} size={44} animate />
        <div class="res-stats">
          <div>
            <IconClock />
            <b>{fmtTime(win.time)}</b>
            <small>{t('time')}</small>
          </div>
          <div>
            <IconX />
            <b>{win.mistakes}</b>
            <small>{t('mistakes')}</small>
          </div>
          <div>
            <IconBulb />
            <b>{win.hints}</b>
            <small>{t('hintsUsed')}</small>
          </div>
        </div>
        <div class="contrib">
          <div class="ct-head">
            <span />
            <span>{t('on_opens')}</span>
            <span>{t('on_marks')}</span>
            <span>{t('mistakes')}</span>
          </div>
          {rows.map((r) => {
            const c = table[r.id] ?? { opens: 0, marks: 0, mistakes: 0, hints: 0 };
            return (
              <div class="ct-row" key={r.id} style={{ '--pc': tone(r.color) } as JSX.CSSProperties}>
                <span class="ct-name">
                  <HexDot color={r.color} />
                  <span>{r.name}</span>
                  {r.you && <small>{t('on_you')}</small>}
                </span>
                <b>{c.opens}</b>
                <b>{c.marks}</b>
                <b>{c.mistakes}</b>
              </div>
            );
          })}
        </div>
        <button class="btn cta wide big" onClick={() => { sfx.tick(); hooks.exit(); }} autoFocus>
          <span>{t('on_toRoom')}</span>
        </button>
      </div>
    );
  }

  return {
    kind: 'coop',
    restore(g) {
      const log = room.coopLog();
      if (!log) return 0;
      const all = log.all();
      for (const s of all) applyOp(g, s.op);
      return all.length;
    },
    subscribe(g, from, onMove) {
      const log = room.coopLog();
      const deliver = (op: CoopOp, by: string) => {
        const r = applyOp(g, op);
        if (r.invalid) return;
        const p = partnerInfo();
        const own = by === room.selfId;
        const m: RemoteMove = { op: op as SessionOp, name: own ? room.snapshot().self.name : p.name, color: own ? room.snapshot().self.color : p.color, changed: r.changed, opened: r.opened, won: r.won };
        if (r.changed && op.t === 'act') ripples.emit({ cell: op.cell, color: m.color });
        onMove(m);
      };
      // ops that arrived between the replay and this subscription
      if (log) for (const s of log.all().slice(from)) deliver(s.op, s.by);
      return room.onOps((ops) => ops.forEach((s) => deliver(s.op, s.by)));
    },
    local(op) {
      room.coopLocal(op as CoopOp);
    },
    pointer(cell) {
      room.cursor(cell);
    },
    finished() {},
    elapsed() {
      // shared play time: from the start of the game to the last move (same on both devices)
      const ops = room.coopLog()?.all() ?? [];
      if (!ops.length) return null;
      const last = Math.max(...ops.map((o) => o.at));
      return Math.max(0, last - Math.min(game.at, ...ops.map((o) => o.at)));
    },
    exit: hooks.exit,
    Overlay,
    Strip,
    Result,
  };
}

// ------------------------------------------------------------------ race

function raceSession(room: RoomSession, game: GameSetup, hooks: SessionHooks): GameSession {
  let base = 0;
  try {
    base = resolvedCount(newGame(game.level));
  } catch {
    base = 0;
  }
  const progressOf = (g: Game, fin = 0): RaceProgress => ({
    done: Math.max(0, resolvedCount(g) - base),
    total: Math.max(1, g.board.n - base),
    mistakes: g.mistakes,
    fin: Math.round(fin),
  });
  let finished = 0;

  function Bar({ p, color }: { p: RaceProgress | null; color: string }) {
    const pct = p ? Math.round((p.done / Math.max(1, p.total)) * 100) : 0;
    return (
      <span class="o-bar" style={{ '--pc': tone(color) } as JSX.CSSProperties} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: pct + '%' }} />
      </span>
    );
  }

  function Strip() {
    const snap = useRoomSnap(room);
    const th = snap.race.theirs;
    const color = partnerColor(snap);
    return (
      <div class="o-strip race">
        {snap.partner ? <PlayerChip name={snap.partner.name} color={color} away={!snap.partner.online} /> : <PlayerChip name={t('on_waiting')} color="" waiting />}
        <Bar p={th} color={color} />
        <span class="o-meta">
          {th?.fin ? (
            <b class="o-fin">{t('on_finishedAt', { time: fmtTime(th.fin) })}</b>
          ) : (
            <span>{th ? Math.round((th.done / Math.max(1, th.total)) * 100) : 0}%</span>
          )}
          <span class={'o-miss' + (th?.mistakes ? ' has' : '')}>
            <IconX />
            {th?.mistakes ?? 0}
          </span>
        </span>
        <ConnBadge conn={snap.conn} compact />
      </div>
    );
  }

  function verdict(snap: RoomSnapshot): 'won' | 'lost' | 'draw' | 'first' | null {
    const me = snap.race.mine, th = snap.race.theirs;
    if (!me?.fin) return null;
    if (!th?.fin) return 'first';
    if (me.fin < th.fin || (me.fin === th.fin && me.mistakes < th.mistakes)) return 'won';
    if (me.fin === th.fin && me.mistakes === th.mistakes) return 'draw';
    return 'lost';
  }

  function Result({ win }: { win: WinInfo; g: Game }) {
    const snap = useRoomSnap(room);
    const [asked, setAsked] = useState(false);
    const v = verdict(snap);
    const me = snap.race.mine, th = snap.race.theirs;
    const pName = snap.partner?.name ?? '?';
    const color = partnerColor(snap);
    useEffect(() => {
      if (v === 'won') sfx.win();
    }, [v]);
    const head = v === 'won' ? t('on_youWon') : v === 'lost' ? t('on_theyWon', { name: pName }) : v === 'draw' ? t('on_draw') : t('on_youFirst');
    return (
      <div class={'res race-res' + (v === 'lost' ? ' lost' : '')}>
        <div class="res-glow" />
        <h2>{head}</h2>
        {v === 'first' && <p class="race-wait">{t('on_waitFinish', { name: pName })}</p>}
        <div class="race-rows">
          <div class={'race-row' + (v === 'won' || v === 'first' ? ' best' : '')} style={{ '--pc': tone(snap.self.color) } as JSX.CSSProperties}>
            <span class="ct-name">
              <HexDot color={snap.self.color} />
              <span>{snap.self.name}</span>
              <small>{t('on_you')}</small>
            </span>
            <b>{fmtTime(me?.fin || win.time)}</b>
            <span class="o-miss has">
              <IconX />
              {win.mistakes}
            </span>
          </div>
          <div class={'race-row' + (v === 'lost' ? ' best' : '')} style={{ '--pc': tone(color) } as JSX.CSSProperties}>
            <span class="ct-name">
              <HexDot color={color} />
              <span>{pName}</span>
            </span>
            {th?.fin ? <b>{fmtTime(th.fin)}</b> : <Bar p={th} color={color} />}
            <span class={'o-miss' + (th?.mistakes ? ' has' : '')}>
              <IconX />
              {th?.mistakes ?? 0}
            </span>
          </div>
        </div>
        <button
          class="btn cta wide big"
          disabled={asked}
          onClick={() => {
            sfx.tick();
            if (snap.role === 'guest') setAsked(true);
            hooks.rematch();
          }}
        >
          <IconRestart />
          <span>{asked ? t('on_rematchAsked') : t('on_rematch')}</span>
        </button>
        <div class="row">
          <button class="btn ghost" onClick={() => { sfx.tick(); hooks.exit(); }}>
            <span>{t('on_toRoom')}</span>
          </button>
        </div>
      </div>
    );
  }

  return {
    kind: 'race',
    begin(g) {
      const mine = room.snapshot().race.mine;
      if (g.finishedAt && mine?.fin) return;
      room.raceProgress(progressOf(g, mine?.fin ?? 0));
    },
    local(_op, g) {
      if (!finished) room.raceProgress(progressOf(g));
    },
    pointer() {},
    finished(w, g) {
      finished = w.time;
      room.raceProgress(progressOf(g, w.time));
    },
    exit: hooks.exit,
    Strip,
    Result,
  };
}
