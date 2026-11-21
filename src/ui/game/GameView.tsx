// The game screen: board, top bar (back, title, crystal counter, mistakes), bottom bar
// (explainer, restart, hint, mode switch), hints, explainer cards, win sequence.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { act, activeConstraints, chordMoves, isLocked, knownVals, lockRemaining, stars as starsOf, type Action, type Game } from '../../core/game';
import { CellState, type Level } from '../../core/types';
import type { Constraint } from '../../core/rules';
import { t } from '../../i18n';
import { buzz, sfx } from '../../audio/sfx';
import { loadProgress, loadSeen, markSeen, recordResult, saveProgress, type Best } from '../../storage';
import { goBack } from '../../router';
import { nextDeduction, preloadSolver } from '../engine';
import { GameBoard, type BoardHandle, type Target } from './Board';
import type { Highlight } from './BoardLayer';
import { layoutBoard } from './geometry';
import { cellProps, clueNow, newFx, precompute, srcActive, srcCells, srcDone, srcKey, syncRotation, visibility, type Src } from './view';
import { canRotate, dangerOf, levelHasPhases, newGameV2, phaseOf, portalsOf, rotateGame } from './compat';
import { explain } from './explain';
import { Explainer } from './Explainer';
import { levelMechanics, toExplain, type Mech } from '../mechanics';
import { fmtTime, Sheet, Stars, useReducedMotion } from '../components/ui';
import { IconBack, IconBulb, IconClock, IconGem, IconHelp, IconOpen, IconRestart, IconRotate, IconShare, IconSkull, IconX } from '../icons';
import { useSettings } from '../settings';
import type { GameSession, RemoteMove } from './session';

export interface WinInfo {
  stars: number;
  time: number;
  mistakes: number;
  hints: number;
  newBest: boolean;
  prev?: Best;
}

export interface GameViewProps {
  level: Level;
  storeKey: string;
  title: string;
  subtitle?: string;
  backTo: string;
  saveLevel?: boolean;
  next?: { label: string; go: () => void } | null;
  onWin?: (w: WinInfo) => void;
  shareText?: (w: WinInfo) => string;
  /** Online co-op / race: the game reports to the session instead of storing results. */
  session?: GameSession;
}

type Mode = 'open' | 'gem';
interface Pin {
  src: Src;
  tint: number;
}
interface HintState {
  cell: number;
  gem: boolean;
  reasons: Constraint[];
  text: string;
}
interface Toast {
  text: string;
  kind: 'hint' | 'info' | 'lock';
  key: number;
}

export function GameView(props: GameViewProps) {
  const { level } = props;
  const settings = useSettings();
  const reduced = useReducedMotion();
  const boardRef = useRef<BoardHandle>(null);

  // ---------------------------------------------------------------- game + static data
  const session = props.session;
  const coop = session?.kind === 'coop';
  // online games are always "gentle": a rewind or restart cannot be shared fairly
  const mistakeMode = session ? 'gentle' : settings.mistakeMode;
  const init = useMemo(() => {
    const g = newGameV2(level, mistakeMode);
    const fx = newFx(g.board.n);
    const layout = layoutBoard(g.board);
    const pre = precompute(g.board, layout);
    let elapsed = 0;
    let replayed = 0;
    const saved = coop ? null : loadProgress(props.storeKey);
    if (coop && session?.restore) replayed = session.restore(g);
    if (saved && saved.state.length === g.board.n && !level.cells.some((c, i) => saved.state[i] === CellState.Marked && !c.gem)) {
      let marked = 0;
      saved.state.forEach((s, i) => {
        g.state[i] = s;
        if (s === CellState.Marked) marked++;
      });
      g.marked = marked;
      if (saved.phase && 'phase' in g) (g as unknown as { phase: number }).phase = saved.phase;
      g.mistakes = saved.mistakes | 0;
      g.hintsUsed = saved.hintsUsed | 0;
      g.moves = saved.moves | 0;
      elapsed = saved.elapsed || 0;
    }
    // rotation counters from the stored phase; deal-in wave from the board centre
    syncRotation(g, pre, fx);
    const cx = layout.minX + layout.w / 2, cy = layout.minY + layout.h / 2;
    for (let i = 0; i < g.board.n; i++) {
      fx.enter[i] = 'deal';
      fx.delay[i] = Math.round(Math.hypot(layout.px[i][0] - cx, layout.px[i][1] - cy) * 1.5);
    }
    return { g, fx, layout, pre, elapsed, replayed, vis: visibility(g), phased: levelHasPhases(level), portals: portalsOf(level) };
  }, [level]);
  const g: Game = init.g;
  const { fx, layout, pre } = init;
  if (import.meta.env.DEV) (window as unknown as { __hx: unknown }).__hx = { g };

  const [, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  const [mode, setMode] = useState<Mode>('open');
  const [pins, setPins] = useState<Pin[]>([]);
  const [hold, setHold] = useState<Src | null>(null);
  const [hover, setHover] = useState<{ src: Src | null; cell: number }>({ src: null, cell: -1 });
  const [press, setPress] = useState<{ cell: number; toGem: boolean; key: number } | null>(null);
  const [hint, setHint] = useState<HintState | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [explainer, setExplainer] = useState<{ mechs: Mech[]; open: boolean; teach: boolean }>({ mechs: [], open: false, teach: false });
  const [confirm, setConfirm] = useState(false);
  const [win, setWin] = useState<WinInfo | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [flash, setFlash] = useState(0);
  const [counterPulse, setCounterPulse] = useState(0);
  const pressKey = useRef(0);
  const visRef = useRef<Uint8Array>(init.vis);
  const [rotPulse, setRotPulse] = useState(0);
  const doRotateRef = useRef<(auto?: boolean) => void>(() => {});
  const hoverCell = useRef(-1);
  const lastTap = useRef<{ cell: number; kind: string }>({ cell: -1, kind: '' });
  const toastTimer = useRef(0);
  const clock = useRef({ base: init.elapsed, since: performance.now() });
  const busy = useRef(false);

  const modeRef = useRef(mode);
  modeRef.current = mode;

  // after the deal-in, new faces mount without the wave
  useEffect(() => {
    const id = setTimeout(() => fx.enter.fill('none'), 50);
    preloadSolver();
    return () => clearTimeout(id);
  }, [init]);

  // explainer cards on first encounter
  useEffect(() => {
    const m = toExplain(level, loadSeen());
    if (m.length) {
      const id = setTimeout(() => setExplainer({ mechs: m, open: true, teach: true }), reduced ? 50 : 650);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [level]);

  // play clock: pauses while the tab is hidden
  const elapsed = () => clock.current.base + (clock.current.since ? performance.now() - clock.current.since : 0);
  useEffect(() => {
    const vis = () => {
      const c = clock.current;
      if (document.hidden) {
        if (c.since) c.base += performance.now() - c.since;
        c.since = 0;
        persist();
      } else if (!c.since && !g.finishedAt) c.since = performance.now();
    };
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  }, [init]);

  const persist = () => {
    if (g.finishedAt || coop) return; // co-op: the session keeps the shared history
    const touched = g.moves > 0 || g.mistakes > 0 || g.hintsUsed > 0 || phaseOf(g) > 0;
    if (!touched) return;
    saveProgress(props.storeKey, {
      state: Array.from(g.state),
      phase: phaseOf(g),
      mistakes: g.mistakes,
      hintsUsed: g.hintsUsed,
      moves: g.moves,
      elapsed: elapsed(),
      level: props.saveLevel ? level : undefined,
      at: Date.now(),
    });
  };

  const showToast = (text: string, kind: Toast['kind'] = 'info', ms = 4200) => {
    clearTimeout(toastTimer.current);
    setToast({ text, kind, key: Date.now() });
    toastTimer.current = window.setTimeout(() => setToast(null), ms);
  };

  // ---------------------------------------------------------------- effects on cells
  const animateCell = (i: number, frames: Keyframe[], opts: KeyframeAnimationOptions) => {
    if (reduced) return;
    const el = boardRef.current?.cellEl(i);
    el?.animate(frames, opts);
  };

  const wiggle = (i: number) =>
    animateCell(i, [{ transform: 'rotate(0)' }, { transform: 'rotate(-7deg)' }, { transform: 'rotate(6deg)' }, { transform: 'rotate(-3deg)' }, { transform: 'rotate(0)' }], { duration: 420, easing: 'ease-out' });

  const lockedFeedback = (i: number) => {
    wiggle(i);
    sfx.illegal();
    buzz(6);
    showToast(t('lockedCell', { n: lockRemaining(g, i) }), 'lock', 2200);
  };

  const mistake = (i: number) => {
    sfx.mistake();
    buzz([28, 40, 28]);
    animateCell(
      i,
      [
        { transform: 'translate(0,0)' },
        { transform: 'translate(-7px,0) rotate(-4deg)' },
        { transform: 'translate(6px,0) rotate(3deg)' },
        { transform: 'translate(-4px,0) rotate(-2deg)' },
        { transform: 'translate(2px,0)' },
        { transform: 'translate(0,0)' },
      ],
      { duration: 460, easing: 'ease-out' },
    );
    boardRef.current?.shake();
    boardRef.current?.spawn('bad', i);
    setFlash((f) => f + 1);
  };

  /** Cells that just came out of the fog condense in, in a wave from `origin`. */
  const condense = (origin: number, baseDelay = 120) => {
    const vis = visibility(g);
    const prev = visRef.current;
    const [x0, y0] = layout.px[origin] ?? [0, 0];
    let any = false;
    for (let i = 0; i < g.board.n; i++) {
      if (vis[i] && !prev[i] && g.state[i] === CellState.Hidden) {
        fx.enter[i] = 'condense';
        fx.delay[i] = baseDelay + Math.round(Math.hypot(layout.px[i][0] - x0, layout.px[i][1] - y0) * 1.6);
        any = true;
      }
    }
    visRef.current = vis;
    if (any) setTimeout(() => sfx.condense(), baseDelay);
  };

  const afterChange = (won: boolean, lastCell: number) => {
    condense(lastCell);
    const vals = knownVals(g);
    setPins((ps) => ps.filter((p) => srcActive(g, pre, p.src) && !srcDone(g, pre, p.src, vals)));
    if (hint && g.state[hint.cell] !== CellState.Hidden) {
      setHint(null);
      if (toast?.kind === 'hint') setToast(null);
    }
    if (won) onWin(lastCell);
    else persist();
    bump();
  };

  const openedLocks = (opened: number[], baseDelay: number) => {
    opened.forEach((j, k) => {
      fx.enter[j] = 'unlock';
      fx.delay[j] = baseDelay + k * 110;
      boardRef.current?.spawn('dust', j, baseDelay + k * 110);
    });
    if (opened.length) setTimeout(() => sfx.unlock(), baseDelay);
  };

  const doAct = (i: number, a: Action) => {
    if (g.finishedAt || i < 0) return;
    if (g.state[i] !== CellState.Hidden) return;
    if (isLocked(g, i)) return lockedFeedback(i);
    if (!visRef.current[i]) return;
    const before = Uint8Array.from(g.state);
    const r = act(g, i, a);
    if (!r.ok) {
      if (r.illegal) return;
      session?.local({ t: 'miss', cell: i }, g);
      mistake(i);
      afterMistake(before, i);
      return;
    }
    session?.local({ t: 'act', cell: i, a }, g);
    fx.enter[i] = a === 'mark' ? 'pop' : 'flip';
    fx.delay[i] = 0;
    if (a === 'mark') {
      sfx.gem();
      buzz(9);
      boardRef.current?.spawn('sparkle', i);
      setCounterPulse((c) => c + 1);
    } else {
      sfx.open();
      boardRef.current?.spawn('dust', i);
    }
    openedLocks(r.opened, 260);
    afterChange(r.won, i);
  };

  /** Mistake modes: classic may rewind moves, hardcore restarts (by the core, or here as a fallback). */
  const afterMistake = (before: Uint8Array, i: number) => {
    const mode = mistakeMode;
    const rewound: number[] = [];
    for (let j = 0; j < g.board.n; j++) if (before[j] !== CellState.Hidden && g.state[j] === CellState.Hidden) rewound.push(j);
    let marked = 0;
    for (let j = 0; j < g.board.n; j++) if (g.state[j] === CellState.Marked) marked++;
    g.marked = marked;
    if (mode === 'hardcore') {
      showToast(t('hardReset'), 'info', 2200);
      setTimeout(() => restart(true), 650);
      return;
    }
    if (rewound.length) {
      const [x0, y0] = layout.px[i];
      rewound
        .sort((a, b) => Math.hypot(layout.px[b][0] - x0, layout.px[b][1] - y0) - Math.hypot(layout.px[a][0] - x0, layout.px[a][1] - y0))
        .forEach((j, k) => {
          fx.enter[j] = 'rewind';
          fx.delay[j] = 250 + k * 90;
        });
      setTimeout(() => sfx.rewind(), 250);
      showToast(t('rewound', { n: rewound.length }), 'info', 2400);
      visRef.current = visibility(g);
    } else if (mode === 'classic' && dangerOf(g) > 0) {
      showToast(t('danger', { n: dangerOf(g) }), 'info', 2200);
    }
    persist();
    bump();
  };

  // ---------------------------------------------------------------- phases
  const doRotate = (auto = false) => {
    if (g.finishedAt || !rotateGame(g)) return;
    session?.local({ t: 'rot' }, g);
    const turned = syncRotation(g, pre, fx);
    if (turned || init.phased) {
      sfx.rotate();
      if (!auto) buzz(8);
    }
    setRotPulse((n) => n + 1);
    condense(-1, 200);
    const vals = knownVals(g);
    setPins((ps) => ps.filter((p) => srcActive(g, pre, p.src) && !srcDone(g, pre, p.src, vals)));
    persist();
    bump();
  };
  useEffect(() => {
    if (!init.phased || !settings.autoRotate || !canRotate() || session) return;
    const id = setInterval(() => {
      if (!document.hidden) doRotateRef.current(true);
    }, settings.autoRotate * 1000);
    return () => clearInterval(id);
  }, [init, settings.autoRotate]);

  const chord = (i: number) => {
    if (g.finishedAt) return;
    const moves = chordMoves(g, i);
    if (!moves.length) {
      wiggle(i);
      sfx.tick();
      return;
    }
    const [x0, y0] = layout.px[i];
    moves.sort((a, b) => Math.hypot(layout.px[a.cell][0] - x0, layout.px[a.cell][1] - y0) - Math.hypot(layout.px[b.cell][0] - x0, layout.px[b.cell][1] - y0));
    let won = false, last = i, k = 0, gems = 0;
    const opened: number[] = [];
    for (const m of moves) {
      if (g.state[m.cell] !== CellState.Hidden || isLocked(g, m.cell)) continue;
      const r = act(g, m.cell, m.action);
      if (!r.ok) {
        if (!r.illegal) {
          session?.local({ t: 'miss', cell: m.cell }, g);
          mistake(m.cell);
          afterMistake(Uint8Array.from(g.state), m.cell);
          return;
        }
        continue;
      }
      session?.local({ t: 'act', cell: m.cell, a: m.action }, g);
      const delay = k * 70;
      fx.enter[m.cell] = m.action === 'mark' ? 'pop' : 'flip';
      fx.delay[m.cell] = delay;
      if (m.action === 'mark') {
        gems++;
        boardRef.current?.spawn('sparkle', m.cell, delay);
        setTimeout(() => sfx.gem(), delay);
      } else {
        sfx.cascade(k);
        boardRef.current?.spawn('dust', m.cell, delay);
      }
      opened.push(...r.opened);
      won = won || r.won;
      last = m.cell;
      k++;
    }
    if (gems) setCounterPulse((c) => c + 1);
    buzz(8);
    openedLocks(opened, k * 70 + 200);
    afterChange(won, last);
  };

  const togglePin = (src: Src) => {
    if (!srcActive(g, pre, src)) return;
    setPins((ps) => {
      const k = srcKey(src);
      if (ps.some((p) => srcKey(p.src) === k)) {
        sfx.pin(false);
        return ps.filter((p) => srcKey(p.src) !== k);
      }
      const used = new Set(ps.map((p) => p.tint));
      let tint = 0;
      while (used.has(tint) && tint < 3) tint++;
      sfx.pin(true);
      const next = [...ps, { src, tint }];
      return next.length > 4 ? next.slice(1) : next;
    });
  };

  const opposite = (): Action => (modeRef.current === 'open' ? 'mark' : 'reveal');
  const primary = (): Action => (modeRef.current === 'open' ? 'reveal' : 'mark');

  const targetSrc = (tg: Target): Src | null => {
    if (tg.t === 'badge') return tg.b.kind === 'zone' ? { t: 'zone', z: tg.b.idx } : { t: 'link', l: tg.b.idx };
    if (tg.t === 'cell' && g.state[tg.i] !== CellState.Hidden) {
      const c = clueNow(g, pre, tg.i);
      if (c && c.k !== 'blank') return { t: 'cell', i: tg.i };
    }
    return null;
  };

  // ---------------------------------------------------------------- hint
  const doHint = async () => {
    if (g.finishedAt || busy.current) return;
    if (hint && g.state[hint.cell] === CellState.Hidden) {
      showToast(hint.text, 'hint', 6500);
      sfx.hint();
      return;
    }
    busy.current = true;
    const vals = knownVals(g);
    const d = await nextDeduction(g.board, vals, activeConstraints(g));
    busy.current = false;
    if (!d || g.state[d.cell] !== CellState.Hidden) {
      showToast(t('noHint'), 'info');
      return;
    }
    g.hintsUsed++;
    session?.local({ t: 'hint', cell: d.cell }, g);
    const text = explain(g, d, vals);
    setHint({ cell: d.cell, gem: d.gem, reasons: d.reasons, text });
    showToast(text, 'hint', 7000);
    sfx.hint();
    buzz(6);
    if (d.reasons.some((c) => c.src.type === 'global')) setCounterPulse((c) => c + 1);
    persist();
    bump();
  };

  // ---------------------------------------------------------------- win
  const onWin = (lastCell: number) => {
    const time = session?.elapsed?.(g) ?? elapsed();
    clock.current.since = 0;
    clock.current.base = time;
    const s = starsOf(g);
    // online results do not count as personal bests
    const rec = session ? { newBest: false, prev: undefined } : recordResult(props.storeKey, { stars: s, time, mistakes: g.mistakes, hints: g.hintsUsed });
    if (!coop) saveProgress(props.storeKey, null);
    const info: WinInfo = { stars: s, time, mistakes: g.mistakes, hints: g.hintsUsed, newBest: rec.newBest, prev: rec.prev };
    setWin(info);
    setHint(null);
    setPins([]);
    setToast(null);
    props.onWin?.(info);
    session?.finished(info, g);
    // bloom wave from the last cell
    const [x0, y0] = layout.px[lastCell] ?? [0, 0];
    let maxD = 0;
    setTimeout(() => sfx.win(), 180);
    buzz([12, 60, 12, 60, 30]);
    for (let i = 0; i < g.board.n; i++) {
      const d = Math.hypot(layout.px[i][0] - x0, layout.px[i][1] - y0) * 2.2 + 220;
      maxD = Math.max(maxD, d);
      animateCell(
        i,
        [
          { transform: 'scale(1)', filter: 'brightness(1)' },
          { transform: 'scale(1.13)', filter: 'brightness(1.18)', offset: 0.35 },
          { transform: 'scale(0.97)', offset: 0.7 },
          { transform: 'scale(1)', filter: 'brightness(1)' },
        ],
        { duration: 620, delay: d, easing: 'cubic-bezier(.3,.7,.3,1)' },
      );
      if (level.cells[i].gem) boardRef.current?.spawn('bloom', i, d + 100);
    }
    setTimeout(() => setShowResult(true), reduced ? 300 : Math.min(2200, maxD + 650));
  };

  const restart = (quiet = false) => {
    saveProgress(props.storeKey, null);
    setConfirm(false);
    setWin(null);
    setShowResult(false);
    setHint(null);
    setPins([]);
    setToast(null);
    const ng = newGameV2(level, mistakeMode);
    g.state.set(ng.state);
    if ('phase' in g) (g as unknown as { phase: number }).phase = 0;
    g.mistakes = 0;
    g.hintsUsed = 0;
    g.marked = 0;
    g.moves = 0;
    g.finishedAt = 0;
    clock.current = { base: 0, since: performance.now() };
    const cx = layout.minX + layout.w / 2, cy = layout.minY + layout.h / 2;
    for (let i = 0; i < g.board.n; i++) {
      fx.rotTurns[i] = 0;
      fx.rotOff[i] = 0;
      fx.enter[i] = 'deal';
      fx.delay[i] = Math.round(Math.hypot(layout.px[i][0] - cx, layout.px[i][1] - cy) * 1.2);
    }
    if (!quiet) sfx.toggle();
    visRef.current = visibility(g);
    bump();
    setTimeout(() => fx.enter.fill('none'), 50);
    boardRef.current?.fit(true);
  };

  // ---------------------------------------------------------------- board callbacks
  const onTap = (tg: Target) => {
    if (tg.t === 'badge') {
      lastTap.current = { cell: -1, kind: 'pin' };
      return togglePin(targetSrc(tg)!);
    }
    if (tg.t !== 'cell') return;
    const i = tg.i;
    const st = g.state[i];
    if (st === CellState.Hidden) {
      if (!visRef.current[i]) return;
      lastTap.current = { cell: i, kind: 'act' };
      if (isLocked(g, i)) return lockedFeedback(i);
      return doAct(i, primary());
    }
    const src = targetSrc(tg);
    if (src) {
      lastTap.current = { cell: i, kind: 'pin' };
      togglePin(src);
    }
  };
  const onDoubleTap = (tg: Target) => {
    if (tg.t === 'cell' && lastTap.current.cell === tg.i && lastTap.current.kind === 'pin') {
      const src = targetSrc(tg);
      if (src) togglePin(src);
      lastTap.current = { cell: -1, kind: '' };
      return chord(tg.i);
    }
    onTap(tg);
  };
  const onLong = (tg: Target) => {
    setPress(null);
    if (tg.t !== 'cell') return;
    const i = tg.i;
    if (g.state[i] !== CellState.Hidden || !visRef.current[i]) return;
    if (isLocked(g, i)) return lockedFeedback(i);
    buzz(12);
    doAct(i, opposite());
  };
  const onAlt = (tg: Target) => {
    if (tg.t !== 'cell') return;
    const i = tg.i;
    if (g.state[i] === CellState.Hidden) {
      if (!visRef.current[i]) return;
      if (isLocked(g, i)) return lockedFeedback(i);
      return doAct(i, opposite());
    }
    chord(i);
  };
  const onPressStart = (tg: Target) => {
    if (tg.t === 'cell') session?.pointer(tg.i);
    if (g.finishedAt) return;
    if (tg.t === 'cell' && g.state[tg.i] === CellState.Hidden && visRef.current[tg.i] && !isLocked(g, tg.i)) {
      setPress({ cell: tg.i, toGem: modeRef.current === 'open', key: ++pressKey.current });
      return;
    }
    const src = targetSrc(tg);
    if (src) setHold(src);
  };
  const onPressEnd = () => {
    setPress(null);
    setHold(null);
  };
  const onHover = (tg: Target) => {
    const src = targetSrc(tg);
    const cell = tg.t === 'cell' && g.state[tg.i] === CellState.Hidden && visRef.current[tg.i] && !isLocked(g, tg.i) ? tg.i : -1;
    hoverCell.current = tg.t === 'cell' ? tg.i : -1;
    session?.pointer(hoverCell.current);
    setHover({ src, cell });
  };

  // ---------------------------------------------------------------- online session
  const exit = () => (session ? session.exit() : goBack(props.backTo));

  /** Visuals of a partner's move (the session has already applied it to `g`). */
  const remoteRef = useRef<(m: RemoteMove) => void>(() => {});
  remoteRef.current = (m: RemoteMove) => {
    const op = m.op;
    if (!m.changed) return;
    if (op.t === 'act') {
      const i = op.cell;
      fx.enter[i] = op.a === 'mark' ? 'pop' : 'flip';
      fx.delay[i] = 0;
      if (op.a === 'mark') {
        sfx.gem();
        boardRef.current?.spawn('sparkle', i);
        setCounterPulse((c) => c + 1);
      } else {
        sfx.open();
        boardRef.current?.spawn('dust', i);
      }
      openedLocks(m.opened, 260);
      afterChange(m.won, i);
    } else if (op.t === 'miss') {
      wiggle(op.cell);
      sfx.illegal();
      bump();
    } else if (op.t === 'rot') {
      syncRotation(g, pre, fx);
      sfx.rotate();
      setRotPulse((n) => n + 1);
      condense(-1, 200);
      const vals = knownVals(g);
      setPins((ps) => ps.filter((p) => srcActive(g, pre, p.src) && !srcDone(g, pre, p.src, vals)));
      bump();
    } else if (op.t === 'hint') {
      const cell = op.cell;
      const vals = knownVals(g);
      sfx.hint();
      bump();
      void nextDeduction(g.board, vals, activeConstraints(g)).then((d) => {
        if (g.state[cell] !== CellState.Hidden || g.finishedAt) return;
        const text = d && d.cell === cell ? explain(g, d, vals) : '';
        setHint({ cell, gem: d?.cell === cell ? d.gem : level.cells[cell].gem, reasons: d && d.cell === cell ? d.reasons : [], text: text || t('coopHintNoText', { name: m.name }) });
        showToast(text ? t('coopHint', { name: m.name, text }) : t('coopHintNoText', { name: m.name }), 'hint', 6500);
      });
    }
  };
  useEffect(() => {
    if (!session) return undefined;
    session.begin?.(g);
    // re-entering a shared board that was solved meanwhile: celebrate here too
    if (coop && g.finishedAt && !win) setTimeout(() => onWin(Math.floor(g.board.n / 2)), reduced ? 0 : 500);
    if (!session.subscribe) return undefined;
    return session.subscribe(g, init.replayed, (m) => remoteRef.current(m));
  }, [init]);

  // ---------------------------------------------------------------- keyboard
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (confirm || explainer.open || showResult) return;
    const k = e.key.toLowerCase();
    const i = hoverCell.current;
    if (k === ' ' || k === 'z') {
      e.preventDefault();
      if (i < 0) return;
      if (g.state[i] === CellState.Hidden) doAct(i, 'reveal');
      else chord(i);
    } else if (k === 'x') {
      if (i >= 0) doAct(i, 'mark');
    } else if (k === 'h') doHint();
    else if (k === 'r' && !session) setConfirm(true);
    else if (k === 'm') toggleMode();
    else if (k === 't' && init.phased) doRotate();
    else if (k === 'f') boardRef.current?.fit(true);
    else if (k === 'escape') exit();
  };
  useEffect(() => {
    const f = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, []);

  const toggleMode = () => {
    sfx.toggle();
    buzz(5);
    setMode((m) => (m === 'open' ? 'gem' : 'open'));
  };

  // ---------------------------------------------------------------- derived render data
  const vals = knownVals(g);
  doRotateRef.current = doRotate;
  const cells = cellProps(g, pre, layout, fx, vals, visRef.current);
  const danger = mistakeMode === 'classic' ? dangerOf(g) : 0;
  const badgeOf = (s: Src): [number, number] | undefined => {
    if (s.t === 'cell') return undefined;
    const b = pre.badges.find((x) => x.kind === (s.t === 'zone' ? 'zone' : 'link') && x.idx === (s.t === 'zone' ? s.z : s.l));
    return b ? [b.x, b.y] : undefined;
  };
  const highlights: Highlight[] = [];
  for (const p of pins) {
    if (!srcActive(g, pre, p.src) || srcDone(g, pre, p.src, vals)) continue;
    highlights.push({ cells: srcCells(g, pre, p.src), src: p.src.t === 'cell' ? p.src.i : -1, srcPoint: badgeOf(p.src), tint: p.tint, key: 'p' + srcKey(p.src) });
  }
  if (hint && !win) {
    hint.reasons.forEach((c, k) => {
      if (c.src.type === 'global') return;
      const src: Src = c.src.type === 'cell' ? { t: 'cell', i: c.src.cell } : c.src.type === 'zone' ? { t: 'zone', z: c.src.zone } : { t: 'link', l: c.src.link };
      highlights.push({ cells: c.cells.filter((j) => vals[j] === -1), src: c.src.type === 'cell' ? c.src.cell : -1, srcPoint: badgeOf(src), tint: 8, key: 'h' + k });
    });
  }
  const transient = hold ?? hover.src;
  if (transient && srcActive(g, pre, transient)) {
    highlights.push({ cells: srcCells(g, pre, transient), src: transient.t === 'cell' ? transient.i : -1, srcPoint: badgeOf(transient), tint: 9, key: 't' + srcKey(transient) });
  }
  const zoneDone = (level.zones ?? []).map((_, z) => srcDone(g, pre, { t: 'zone', z }, vals));
  const linkDone = (level.links ?? []).map((_, l) => srcDone(g, pre, { t: 'link', l }, vals));
  const left = g.board.totalGems - g.marked;
  const mechs = useMemo(() => levelMechanics(level), [level]);

  const share = async () => {
    if (!win || !props.shareText) return;
    const text = props.shareText(win);
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        showToast(t('shareCopied'), 'info', 1600);
      }
    } catch {
      /* cancelled */
    }
  };

  useEffect(() => {
    if (!showResult || !win) return;
    const ids = [0, 1, 2].filter((k) => k < win.stars).map((k) => setTimeout(() => sfx.star(k), 380 + k * 200));
    return () => ids.forEach(clearTimeout);
  }, [showResult]);

  return (
    <div class={'game' + (settings.leftHanded ? ' lefty' : '') + (win ? ' won' : '') + (init.phased ? ' phased' : '')}>
      <header class="g-top">
        <button class="icon-btn" aria-label={t('back')} onClick={() => { sfx.tick(); persist(); exit(); }}>
          <IconBack />
        </button>
        <div class="g-title">
          <div class="g-name">{props.title}</div>
          {props.subtitle && <div class="g-sub">{props.subtitle}</div>}
        </div>
        <div
          class={'g-mistakes' + (g.mistakes ? ' has' : '') + (danger ? ' danger' : '')}
          key={'m' + g.mistakes}
          title={danger ? t('danger', { n: danger }) : t('mistakes')}
          aria-label={`${t('mistakes')}: ${g.mistakes}`}
        >
          {mistakeMode === 'hardcore' ? <IconSkull /> : <IconX />}
          <b>{g.mistakes}</b>
          {danger > 0 && <i class="danger-n">{danger}</i>}
        </div>
        <div class={'g-counter' + (left === 0 ? ' zero' : '')} key={'c' + counterPulse} title={t('gemsLeft')} aria-label={`${t('gemsLeft')}: ${left}`}>
          <IconGem />
          <b>{left}</b>
        </div>
      </header>
      {session?.Strip && <session.Strip g={g} />}

      <div class="g-board">
        <GameBoard
          ref={boardRef}
          board={g.board}
          layout={layout}
          cells={cells}
          zoneValues={pre.zoneValues}
          zoneDone={zoneDone}
          linkDone={linkDone}
          highlights={highlights}
          hintCell={hint && !win ? hint.cell : -1}
          hover={win ? -1 : hover.cell}
          press={press}
          staticWalls={pre.staticWalls}
          portals={init.portals}
          padBottom={init.phased ? 60 : 0}
          badges={pre.badges}
          reducedMotion={reduced}
          onTap={onTap}
          onDoubleTap={onDoubleTap}
          onLong={onLong}
          onAlt={onAlt}
          onPressStart={onPressStart}
          onPressEnd={onPressEnd}
          onHover={onHover}
          overlay={session?.Overlay ? <session.Overlay layout={layout} /> : undefined}
        />
        {flash > 0 && <div class="flash" key={flash} />}
        {init.phased && canRotate() && !win && (
          <button class="rotate-fab" onClick={() => doRotate()} aria-label={t('rotate')} title={`${t('rotate')} (T)`}>
            <span class="rf-ic" key={rotPulse}>
              <IconRotate />
            </span>
            <span>{t('rotate')}</span>
          </button>
        )}
        {toast && (
          <div class={'toast ' + toast.kind} key={toast.key} onClick={() => setToast(null)} role="status">
            {toast.kind === 'hint' && <IconBulb />}
            <span>{toast.text}</span>
          </div>
        )}
      </div>

      <footer class="g-bottom">
        <div class="g-tools">
          <button class="tool" aria-label={t('explainers')} onClick={() => { sfx.tick(); setExplainer({ mechs, open: true, teach: false }); }}>
            <IconHelp />
          </button>
          {!session && (
            <button class="tool" aria-label={t('restart')} onClick={() => { sfx.tick(); setConfirm(true); }}>
              <IconRestart />
            </button>
          )}
          <button class={'tool hint' + (hint ? ' active' : '')} aria-label={t('hint')} onClick={doHint} disabled={!!win}>
            <IconBulb />
            {g.hintsUsed > 0 && <i class="badge">{g.hintsUsed}</i>}
          </button>
        </div>
        <ModeSwitch mode={mode} onToggle={toggleMode} />
      </footer>

      <Explainer
        mechs={explainer.mechs}
        open={explainer.open}
        onClose={() => {
          if (explainer.teach) markSeen(explainer.mechs);
          setExplainer((e) => ({ ...e, open: false }));
        }}
      />

      <Sheet open={confirm} onClose={() => setConfirm(false)} class="confirm" label={t('restartQ')}>
        <h2>{t('restartQ')}</h2>
        <div class="row">
          <button class="btn ghost" onClick={() => setConfirm(false)}>{t('cancel')}</button>
          <button class="btn cta" onClick={() => restart()} autoFocus>
            <IconRestart />
            <span>{t('restartYes')}</span>
          </button>
        </div>
      </Sheet>

      <Sheet open={showResult && !!win} class="result" label={t('solved')}>
        {win && session?.Result && <session.Result win={win} g={g} />}
        {win && !session?.Result && (
          <div class="res">
            <div class="res-glow" />
            <h2>{win.stars === 3 ? t('perfect') : t('solved')}</h2>
            <Stars n={win.stars} size={52} animate />
            <div class="res-stats">
              <div>
                <IconClock />
                <b>{fmtTime(win.time)}</b>
                <small>{win.newBest ? t('newBest') : win.prev ? `${t('bestTime')} ${fmtTime(win.prev.time)}` : t('time')}</small>
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
            <button
              class="btn cta wide big"
              onClick={() => {
                sfx.tick();
                if (props.next) props.next.go();
                else goBack(props.backTo);
              }}
              autoFocus
            >
              <span>{props.next ? props.next.label : props.backTo === '/' ? t('toMenu') : t('toMap')}</span>
            </button>
            <div class="row">
              <button class="btn ghost" onClick={() => restart()}>
                <IconRestart />
                <span>{t('again')}</span>
              </button>
              {props.shareText ? (
                <button class="btn ghost" onClick={share}>
                  <IconShare />
                  <span>{t('share')}</span>
                </button>
              ) : props.next ? (
                <button class="btn ghost" onClick={() => goBack(props.backTo)}>
                  <IconBack />
                  <span>{props.backTo === '/' ? t('toMenu') : t('toMap')}</span>
                </button>
              ) : null}
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}

function ModeSwitch({ mode, onToggle }: { mode: Mode; onToggle: () => void }) {
  return (
    <button class={'modesw ' + mode} onClick={onToggle} role="switch" aria-checked={mode === 'gem'} aria-label={`${t('modeOpen')} / ${t('modeGem')}`}>
      <span class="ms-thumb" />
      <span class={'ms-opt' + (mode === 'open' ? ' on' : '')}>
        <IconOpen />
        <span>{t('modeOpen')}</span>
      </span>
      <span class={'ms-opt' + (mode === 'gem' ? ' on' : '')}>
        <IconGem />
        <span>{t('modeGem')}</span>
      </span>
    </button>
  );
}

export type { JSX };
