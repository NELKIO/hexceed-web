// «Мастерская» editor: canvas + tools + live validation, undo / redo, autosave, test, share.

import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { key } from '../../core/hex';
import { cellConstraintsAll } from '../../core/rules';
import { encodeLevel, type LintIssue, MAX_AUTHOR, MAX_TITLE, shareUrl } from '../../core/editor-utils';
import type { Clue, ClueKind, Level } from '../../core/types';
import { validateLevel } from '../../core/validate';
import { goBack, navigate } from '../../router';
import { t } from '../../i18n';
import { sfx } from '../../audio/sfx';
import { BoardLayer, type Highlight } from '../game/BoardLayer';
import { rayPaths } from '../game/view';
import { Sheet, Toggle, TopBar } from '../components/ui';
import { IconBack, IconCheck, IconCopy, IconGem, IconLock, IconPlay, IconRotate, IconShare } from '../icons';
import { mechTitle } from '../mechanics';
import { useSettings } from '../settings';
import { analysisKey, useAnalysis, type Analysis } from './analyze';
import { EditorCanvas, type CanvasHandle, type Stroke } from './Canvas';
import { IcBig, IcClue, IcFit, IcMinus, IcPaint, IcPlus, IcPortal, IcRedo, IcStart, IcThread, IcUndo, IcWall, IcZone } from './icons';
import { wpn, wt, type WKey } from './i18n';
import {
  addHex, addZone, gemCount, hexagonLevel, hexCount, MAX_HEXES, merge, playable, removeHex, removeZonesWith, setAlt, setClue, setFog, setLock, setRot, split, toggleGem,
  syncLinks, toggleLink, togglePortal, toggleStart, toggleWall,
} from './ops';
import { loadAuthor, loadDraft, saveAuthor, saveDraft, type Draft } from './store';
import { boxOf, buildView, Chips, CLUE_KINDS, ClueTile, DIR_KINDS, DirPicker, EdgeHover, edgeAt, hexAt, Marks, Slots, slotsOf } from './view';

type Tool = 'paint' | 'gem' | 'clue' | 'start' | 'lock' | 'wall' | 'portal' | 'link' | 'zone' | 'rot' | 'big';

const TOOLS: { id: Tool; label: WKey; icon: (p: JSX.SVGAttributes<SVGSVGElement>) => JSX.Element }[] = [
  { id: 'paint', label: 'tool_paint', icon: IcPaint },
  { id: 'gem', label: 'tool_gem', icon: IconGem },
  { id: 'clue', label: 'tool_clue', icon: IcClue },
  { id: 'start', label: 'tool_start', icon: IcStart },
  { id: 'lock', label: 'tool_lock', icon: IconLock },
  { id: 'wall', label: 'tool_wall', icon: IcWall },
  { id: 'portal', label: 'tool_portal', icon: IcPortal },
  { id: 'link', label: 'tool_link', icon: IcThread },
  { id: 'zone', label: 'tool_zone', icon: IcZone },
  { id: 'rot', label: 'tool_rot', icon: IconRotate },
  { id: 'big', label: 'tool_big', icon: IcBig },
];

const TIP: Record<Tool, WKey> = {
  paint: 'tip_paint', gem: 'tip_gem', clue: 'tip_clue', start: 'tip_start', lock: 'tip_lock', wall: 'tip_wall', portal: 'tip_portal',
  link: 'tip_link', zone: 'tip_zone', rot: 'tip_rot', big: 'tip_big',
};

/** Undo history and the last tool survive a trip to the test game and back. */
const sessions = new Map<string, { past: Level[]; future: Level[]; tool: Tool }>();

export function lintText(x: LintIssue): string {
  return wt(`lint_${x.key}` as WKey, { n: x.n ?? 0 });
}

export function EditorScreen({ params }: { params: string[] }) {
  useSettings();
  const draft = useMemo(() => loadDraft(params[0]), [params[0]]);
  if (!draft) {
    return (
      <div class="screen">
        <div class="screen-inner">
          <TopBar title={t('levelNotFound')} onBack={() => goBack('/workshop')} />
        </div>
      </div>
    );
  }
  return <Editor key={draft.id} initial={draft} />;
}

function Editor({ initial }: { initial: Draft }) {
  const id = initial.id;
  const [draft, setDraft] = useState(initial);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const level = draft.level;
  const levelRef = useRef(level);
  levelRef.current = level;
  const H = useMemo(() => {
    let s = sessions.get(id);
    if (!s) sessions.set(id, (s = { past: [], future: [], tool: 'paint' }));
    return s;
  }, [id]);
  const [tool, setToolState] = useState<Tool>(H.tool);
  const [sel, setSel] = useState<number[]>([]);
  const [lockN, setLockN] = useState(1);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const [showUnknown, setShowUnknown] = useState(false);
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null);
  const [sheet, setSheet] = useState<'none' | 'settings' | 'share' | 'reset'>('none');
  const [, setTick] = useState(0);
  const canvas = useRef<CanvasHandle>(null);
  const toastTimer = useRef(0);

  const say = (text: string) => {
    clearTimeout(toastTimer.current);
    setToast({ text, key: Date.now() });
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  };

  // ------------------------------------------------------------ autosave
  useEffect(() => {
    const tm = setTimeout(() => saveDraft(draft), 250);
    return () => clearTimeout(tm);
  }, [draft]);
  useEffect(() => () => void saveDraft(draftRef.current), []);

  // ------------------------------------------------------------ history
  const setLevel = (raw: Level) => {
    const next = syncLinks(raw);
    levelRef.current = next;
    setDraft((d) => ({ ...d, level: next, updated: Date.now() }));
  };
  const commit = (next: Level | null): boolean => {
    if (!next) return false;
    H.past.push(levelRef.current);
    if (H.past.length > 200) H.past.shift();
    H.future = [];
    setLevel(next);
    return true;
  };
  const undo = () => {
    const p = H.past.pop();
    if (!p) return;
    sfx.tick();
    H.future.push(levelRef.current);
    setLevel(p);
    setSel([]);
  };
  const redo = () => {
    const f = H.future.pop();
    if (!f) return;
    sfx.tick();
    H.past.push(levelRef.current);
    setLevel(f);
    setSel([]);
  };
  const setTool = (tl: Tool) => {
    H.tool = tl;
    setToolState(tl);
    setSel([]);
    setHover(null);
  };

  // ------------------------------------------------------------ derived
  const view = useMemo(() => buildView(level), [level]);
  const index = useMemo(() => {
    const m = new Map<string, number>();
    level.cells.forEach((c, i) => {
      m.set(key(c.q, c.r), i);
      for (const [q, r] of c.extra ?? []) m.set(key(q, r), i);
    });
    return m;
  }, [level]);
  const slots = useMemo(() => slotsOf(level, index), [level, index]);
  const box = useMemo(() => boxOf(index, slots), [index, slots]);
  const analysis = useAnalysis(level);
  const gems = gemCount(level);
  const n = level.cells.length;
  const selOk = sel.filter((i) => i < n);

  // remember the verdict for the list of levels
  useEffect(() => {
    if (analysis.state !== 'ok' && analysis.state !== 'stuck') return;
    const hash = analysisKey(level);
    const check = { hash, solved: analysis.state === 'ok', diff: analysis.state === 'ok' ? analysis.diff : 0 };
    setDraft((d) => (d.check?.hash === hash && d.check.solved === check.solved ? d : { ...d, check }));
  }, [analysis]);
  useEffect(() => setShowUnknown(false), [analysis.state]);

  // ------------------------------------------------------------ input
  const unit = (x: number, y: number) => {
    const [q, r] = hexAt(x, y);
    return index.get(key(q, r)) ?? -1;
  };

  const tap = (x: number, y: number) => {
    const L = levelRef.current;
    const i = unit(x, y);
    switch (tool) {
      case 'gem':
        if (i >= 0 && commit(toggleGem(L, i))) L.cells[i].gem ? sfx.open() : sfx.gem();
        break;
      case 'clue':
      case 'rot':
        if (i >= 0) sfx.tick();
        setSel(i >= 0 ? [i] : []);
        break;
      case 'start':
        if (i < 0) break;
        if (L.cells[i].gem) say(wt('startOnlySafe'));
        else if (commit(toggleStart(L, i))) sfx.tick();
        break;
      case 'lock': {
        if (i < 0) {
          setSel([]);
          break;
        }
        const c = L.cells[i];
        if (c.gem) {
          say(wt('lockOnlySafe'));
          break;
        }
        const nn = Math.max(1, Math.min(lockN, Math.max(1, gems)));
        if (c.lock === nn) {
          commit(setLock(L, i, undefined));
          setSel([]);
        } else {
          commit(setLock(L, i, nn));
          setSel([i]);
        }
        sfx.tick();
        break;
      }
      case 'wall':
      case 'portal': {
        const e = edgeAt(index, x, y);
        if (!e) break;
        commit(tool === 'wall' ? toggleWall(L, e[0], e[1], e[2]) : togglePortal(L, e[0], e[1], e[2]));
        sfx.tick();
        break;
      }
      case 'link':
        if (i < 0) setSel([]);
        else if (selOk.length === 1 && selOk[0] !== i) {
          commit(toggleLink(L, selOk[0], i));
          sfx.toggle();
          setSel([]);
        } else {
          sfx.tick();
          setSel(selOk[0] === i ? [] : [i]);
        }
        break;
      case 'zone':
      case 'big':
        if (i < 0) break;
        sfx.tick();
        setSel(selOk.includes(i) ? selOk.filter((j) => j !== i) : [...selOk, i]);
        break;
      case 'paint':
        break;
    }
  };

  // paint strokes: the first hex decides add or remove; one history entry per stroke
  const stroke = useRef<{ base: Level; add: boolean; done: Set<string> } | null>(null);
  const paintAt = (x: number, y: number) => {
    const s = stroke.current;
    if (!s) return;
    const [q, r] = hexAt(x, y);
    const k = key(q, r);
    if (s.done.has(k)) return;
    s.done.add(k);
    const L = levelRef.current;
    const next = s.add ? addHex(L, q, r) : removeHex(L, q, r);
    if (!next) {
      if (s.add && hexCount(L) >= MAX_HEXES) say(wt('tooManyHexes', { n: MAX_HEXES }));
      return;
    }
    // only paint next to the board (a stray far tap on an empty canvas is ignored)
    if (s.add && L.cells.length && !nearBoard(L, q, r)) return;
    setLevel(next);
    if (s.add) sfx.open();
    else sfx.tick();
  };
  const paint: Stroke | null =
    tool === 'paint'
      ? {
          start(x, y) {
            const [q, r] = hexAt(x, y);
            stroke.current = { base: levelRef.current, add: !index.has(key(q, r)), done: new Set() };
            paintAt(x, y);
          },
          move: paintAt,
          end() {
            const s = stroke.current;
            stroke.current = null;
            if (s && s.base !== levelRef.current) {
              H.past.push(s.base);
              H.future = [];
              setTick((v) => v + 1);
            }
          },
          cancel() {
            const s = stroke.current;
            stroke.current = null;
            if (s && s.base !== levelRef.current) setLevel(s.base);
          },
        }
      : null;

  // keyboard: undo / redo, Escape clears the selection, F fits
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    if (sheet !== 'none') return;
    const tg = e.target as HTMLElement | null;
    if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA')) return;
    const k = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if ((e.metaKey || e.ctrlKey) && k === 'y') {
      e.preventDefault();
      redo();
    } else if (e.metaKey || e.ctrlKey || e.altKey) return;
    else if (k === 'escape') setSel([]);
    else if (k === 'f') canvas.current?.fit();
    else if (/^[0-9]$/.test(k)) {
      const tl = TOOLS[(Number(k) + 9) % 10];
      if (tl) setTool(tl.id);
    }
  };
  useEffect(() => {
    const f = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, []);

  // ------------------------------------------------------------ actions
  const playOk = () => !!validateLevel(playable(level, 'ws-' + id));
  const test = () => {
    if (!playOk()) {
      const issue = analysis.state === 'lint' ? analysis.issues[0] : null;
      say(issue ? lintText(issue) : wt('test_invalid'));
      return;
    }
    sfx.tick();
    saveDraft(draftRef.current);
    navigate('/workshop/test/' + id);
  };

  // ------------------------------------------------------------ highlights
  const highlights: Highlight[] = [];
  if (view) {
    if (analysis.state === 'stuck') {
      const fr = new Set(analysis.frontier);
      if (showUnknown) highlights.push({ cells: analysis.unknown.filter((i) => !fr.has(i)), src: -1, tint: 2, key: 'unk' });
      highlights.push({ cells: analysis.frontier, src: -1, tint: 8, key: 'fr' });
    }
    if (analysis.state === 'lint') {
      const cells = [...new Set(analysis.issues.flatMap((x) => x.cells))].filter((i) => i < n);
      if (cells.length) highlights.push({ cells, src: -1, tint: 2, key: 'lint' });
    }
    if (tool === 'clue' && selOk.length === 1) {
      const i = selOk[0];
      const cov = new Set<number>();
      try {
        for (const c of cellConstraintsAll(view.board, i)) for (const j of c.cells) cov.add(j);
      } catch {
        /* ignore */
      }
      cov.delete(i);
      highlights.push({ cells: [...cov], src: i, tint: 9, key: 'cov', rays: rayPaths(view.g, view.layout, i) });
    } else if (selOk.length) highlights.push({ cells: selOk, src: tool === 'link' ? selOk[0] : -1, tint: 1, key: 'sel' });
  }
  const edgeTool = tool === 'wall' || tool === 'portal';
  const hoverEdge = edgeTool && hover ? edgeAt(index, hover[0], hover[1]) : null;
  const hoverCell = !edgeTool && hover && tool !== 'paint' ? unit(hover[0], hover[1]) : -1;
  const paintHover = tool === 'paint' && hover ? hexAt(hover[0], hover[1]) : null;

  const title = draft.title || wt('ws_untitled');
  return (
    <div class="editor">
      <header class="g-top ed-top">
        <button class="icon-btn" aria-label={t('back')} onClick={() => { sfx.tick(); saveDraft(draftRef.current); goBack('/workshop'); }}>
          <IconBack />
        </button>
        <button class="g-title ed-title" onClick={() => { sfx.tick(); setSheet('settings'); }} aria-label={wt('settings')}>
          <span class="g-name">{title}</span>
          <span class="g-sub">
            {wpn(hexCount(level), 'pl_cell')} · {wpn(gems, 'pl_light')}
          </span>
        </button>
        <button class="icon-btn ed-share" aria-label={wt('share')} title={wt('share')} onClick={() => { sfx.tick(); setSheet('share'); }}>
          <IconShare />
        </button>
        <button class="btn cta ed-test" onClick={test}>
          <IconPlay />
          <span>{wt('test')}</span>
        </button>
      </header>

      <Status a={analysis} showUnknown={showUnknown} onWhere={() => { sfx.tick(); setShowUnknown((v) => !v); }} />

      <div class="ed-board">
        <EditorCanvas ref={canvas} box={box} paint={paint} onTap={tap} onHover={setHover}>
          {tool === 'paint' && <Slots slots={slots} />}
          {view && (
            <BoardLayer
              board={view.board}
              layout={view.layout}
              cells={view.cells}
              zoneValues={view.pre.zoneValues}
              zoneDone={[]}
              linkDone={[]}
              highlights={highlights}
              hintCell={-1}
              hover={hoverCell}
              press={null}
              staticWalls={view.pre.staticWalls}
              portals={view.portals}
            />
          )}
          {view && <Marks level={level} layout={view.layout} />}
          <EdgeHover edge={hoverEdge} />
          {paintHover && <PaintHover q={paintHover[0]} r={paintHover[1]} remove={index.has(key(paintHover[0], paintHover[1]))} />}
        </EditorCanvas>
        <div class="ed-hist">
          <button class="icon-btn" aria-label={wt('undo')} title={wt('undo') + ' (Ctrl+Z)'} disabled={!H.past.length} onClick={undo}>
            <IcUndo />
          </button>
          <button class="icon-btn" aria-label={wt('redo')} title={wt('redo') + ' (Ctrl+Shift+Z)'} disabled={!H.future.length} onClick={redo}>
            <IcRedo />
          </button>
        </div>
        <button class="icon-btn ed-fit" aria-label={wt('fit')} title={wt('fit') + ' (F)'} onClick={() => { sfx.tick(); canvas.current?.fit(); }}>
          <IcFit />
        </button>
        {toast && (
          <div class="toast info" key={toast.key} role="status" onClick={() => setToast(null)}>
            <span>{toast.text}</span>
          </div>
        )}
      </div>

      <footer class="ed-bottom">
        <div class="ed-opts">
          <Options
            tool={tool}
            level={level}
            sel={selOk}
            setSel={setSel}
            commit={commit}
            say={say}
            lockN={Math.max(1, Math.min(lockN, Math.max(1, gems)))}
            setLockN={setLockN}
          />
        </div>
        <nav class="ed-tools" aria-label={wt('tools')}>
          {TOOLS.map((tl) => (
            <button key={tl.id} class={'ed-tool' + (tool === tl.id ? ' on' : '')} aria-pressed={tool === tl.id} onClick={() => { sfx.tick(); setTool(tl.id); }}>
              <tl.icon />
              <span>{wt(tl.label)}</span>
            </button>
          ))}
        </nav>
      </footer>

      <SettingsSheet
        open={sheet === 'settings'}
        draft={draft}
        onClose={() => setSheet('none')}
        onTitle={(v) => setDraft((d) => ({ ...d, title: v, updated: Date.now() }))}
        onFog={(on) => commit(setFog(level, on))}
        onReset={() => {
          // one sheet at a time: each owns a history entry (system back closes it)
          setSheet('none');
          setTimeout(() => setSheet('reset'), 260);
        }}
      />
      <Sheet open={sheet === 'reset'} onClose={() => setSheet('none')} class="confirm" label={wt('resetQ')}>
        <h2>{wt('resetQ')}</h2>
        <div class="ed-sizes">
          {[3, 4, 5, 6].map((rings) => (
            <button
              key={rings}
              class="btn ghost ed-size"
              onClick={() => {
                commit(hexagonLevel(rings));
                setSel([]);
                setSheet('none');
                setTimeout(() => canvas.current?.fit(), 30);
              }}
            >
              <b class="mono">{3 * rings * (rings - 1) + 1}</b>
              <span>{wpn(3 * rings * (rings - 1) + 1, 'pl_cell').replace(/^\d+ /, '')}</span>
            </button>
          ))}
        </div>
        <button class="btn ghost" onClick={() => setSheet('none')}>{t('cancel')}</button>
      </Sheet>
      <ShareSheet open={sheet === 'share'} draft={draft} analysis={analysis} onClose={() => setSheet('none')} onDraft={(f) => setDraft(f)} />
    </div>
  );
}

function nearBoard(L: Level, q: number, r: number): boolean {
  for (const c of L.cells)
    for (const [hq, hr] of [[c.q, c.r] as [number, number], ...(c.extra ?? [])]) {
      const dq = hq - q, dr = hr - r;
      if ((Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2 <= 1) return true;
    }
  return false;
}

function PaintHover({ q, r, remove }: { q: number; r: number; remove: boolean }) {
  const x = 40 * 1.5 * q, y = 40 * Math.sqrt(3) * (r + q / 2);
  return (
    <g class={'ed-paint-hover' + (remove ? ' remove' : '')} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>
      {remove ? <path d="M-9,0 H9" /> : <path d="M-9,0 H9 M0,-9 V9" />}
    </g>
  );
}

// ------------------------------------------------------------------ status line

function Status({ a, showUnknown, onWhere }: { a: Analysis; showUnknown: boolean; onWhere: () => void }) {
  let cls = 'pending', text = wt('st_pending');
  let meta: string | null = null;
  if (a.state === 'ok') {
    cls = 'ok';
    text = wt('st_ok');
    meta = wt('st_diff', { d: a.diff });
  } else if (a.state === 'stuck') {
    cls = 'stuck';
    text = wt('st_stuck');
  } else if (a.state === 'lint') {
    cls = 'bad';
    text = lintText(a.issues[0]);
  } else if (a.state === 'timeout') {
    cls = 'bad';
    text = wt('st_timeout');
  } else if (a.state === 'error') {
    cls = 'bad';
    text = wt('st_error');
  }
  const warn = (a.state === 'ok' || a.state === 'stuck') && a.warn.length ? lintText(a.warn[0]) : null;
  return (
    <div class={'ed-status ' + cls} role="status" aria-live="polite">
      <span class="es-mark" aria-hidden="true">
        <i />
      </span>
      <span class="es-text">
        <span>{text}</span>
        {meta && <span class="es-meta"> · {meta}</span>}
        {warn && <span class="es-warn"> · {warn}</span>}
      </span>
      {a.state === 'stuck' && (
        <button class={'es-btn' + (showUnknown ? ' on' : '')} onClick={onWhere}>
          {showUnknown ? wt('st_whereOn', { n: a.unknown.length }) : wt('st_where')}
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ tool options

interface OptProps {
  tool: Tool;
  level: Level;
  sel: number[];
  setSel: (s: number[]) => void;
  commit: (l: Level | null) => boolean;
  say: (s: string) => void;
  lockN: number;
  setLockN: (n: number) => void;
}

function Tip({ k }: { k: WKey }) {
  return <p class="ed-tip">{wt(k)}</p>;
}

function Options(p: OptProps) {
  const { tool, level, sel, commit } = p;
  const one = sel.length === 1 ? sel[0] : -1;
  const gems = gemCount(level);
  switch (tool) {
    case 'clue':
      return one >= 0 ? <ClueEditor level={level} i={one} commit={commit} /> : <Tip k="tip_clue" />;
    case 'rot':
      return one >= 0 ? <RotEditor level={level} i={one} commit={commit} say={p.say} /> : <Tip k="tip_rot" />;
    case 'lock': {
      const cur = one >= 0 ? level.cells[one]?.lock : undefined;
      const val = cur ?? p.lockN;
      const set = (v: number) => {
        const nv = Math.max(1, Math.min(Math.max(1, gems), v));
        sfx.tick();
        p.setLockN(nv);
        if (cur) commit(setLock(level, one, nv));
      };
      return (
        <div class="ed-row">
          <Tip k="tip_lock" />
          <div class="ed-stepper" role="group" aria-label={wt('lockAfter')}>
            <button class="icon-btn" aria-label="−" disabled={val <= 1} onClick={() => set(val - 1)}>
              <IcMinus />
            </button>
            <b class="mono">{val}</b>
            <button class="icon-btn" aria-label="+" disabled={val >= Math.max(1, gems)} onClick={() => set(val + 1)}>
              <IcPlus />
            </button>
          </div>
        </div>
      );
    }
    case 'link':
      return <Tip k={sel.length === 1 ? 'tip_linkSecond' : 'tip_link'} />;
    case 'zone': {
      const inZone = sel.some((i) => level.zones?.some((z) => z.cells.includes(i)));
      return (
        <div class="ed-row">
          <Tip k="tip_zone" />
          <div class="ed-actions">
            <button class="btn ghost sm" disabled={!sel.length} onClick={() => { if (p.commit(addZone(level, sel))) { sfx.toggle(); p.setSel([]); } }}>
              {wt('zoneMake')}
              {sel.length ? <b class="mono"> {sel.length}</b> : null}
            </button>
            <button class="btn ghost sm" disabled={!inZone} onClick={() => { if (p.commit(removeZonesWith(level, sel))) { sfx.tick(); p.setSel([]); } }}>
              {wt('zoneRemove')}
            </button>
          </div>
        </div>
      );
    }
    case 'big': {
      const hasBig = sel.some((i) => level.cells[i]?.extra?.length);
      return (
        <div class="ed-row">
          <Tip k="tip_big" />
          <div class="ed-actions">
            <button
              class="btn ghost sm"
              disabled={sel.length < 2}
              onClick={() => {
                const r = merge(level, sel);
                if (typeof r === 'string') p.say(wt(r));
                else {
                  p.commit(r);
                  sfx.toggle();
                  p.setSel([]);
                }
              }}
            >
              {wt('bigMerge')}
              {sel.length > 1 ? <b class="mono"> {sel.length}</b> : null}
            </button>
            <button
              class="btn ghost sm"
              disabled={!hasBig}
              onClick={() => {
                let l: Level | null = level;
                // split from the highest index so earlier indexes stay valid
                for (const i of [...sel].sort((a, b) => b - a)) if (l?.cells[i]?.extra?.length) l = split(l, i);
                if (p.commit(l)) {
                  sfx.tick();
                  p.setSel([]);
                }
              }}
            >
              {wt('bigSplit')}
            </button>
          </div>
        </div>
      );
    }
    default:
      return <Tip k={TIP[tool]} />;
  }
}

function defaultDirs(k: ClueKind, prev?: number[]): number[] | undefined {
  if (!DIR_KINDS.has(k)) return undefined;
  if (k === 'swirl') return [prev?.[0] ?? 0];
  return prev?.length ? prev.slice() : [0];
}

function ClueEditor({ level, i, commit }: { level: Level; i: number; commit: (l: Level | null) => boolean }) {
  const c = level.cells[i];
  if (!c) return null;
  const big = !!c.extra?.length;
  const cur: Clue | null = c.clue ?? (c.gem ? null : { k: 'num' });
  const set = (cl: Clue | undefined) => commit(setClue(level, i, cl));
  const kinds = CLUE_KINDS.filter((k) => !(c.gem && k === 'blank'));
  const pick = (k: ClueKind | 'none') => {
    sfx.toggle();
    if (k === 'none') return set(undefined);
    const nc: Clue = { k };
    const dirs = defaultDirs(k, cur?.dirs);
    if (dirs) nc.dirs = dirs;
    if (cur?.mod && (k === 'num' || (k === 'line' && dirs?.length === 1))) nc.mod = cur.mod;
    if (k === 'dot' && cur?.corner) nc.corner = true;
    if (k === 'swirl' && cur?.ccw) nc.ccw = true;
    set(nc);
  };
  const upd = (patch: Partial<Clue>) => {
    if (!cur) return;
    const nc: Clue = { ...cur, ...patch };
    for (const k of Object.keys(nc) as (keyof Clue)[]) if (nc[k] === undefined || nc[k] === false) delete nc[k];
    if (nc.k === 'line' && (nc.dirs?.length ?? 1) !== 1) delete nc.mod;
    set(nc);
  };
  const modable = !!cur && !big && (cur.k === 'num' || (cur.k === 'line' && (cur.dirs?.length ?? 1) === 1));
  const name = (k: ClueKind) => t(mechTitle(k === 'num' ? 'basic' : k));
  return (
    <div class="ed-clue">
      <div class="ed-kinds" role="radiogroup">
        {c.gem && (
          <button class={'ed-kind' + (!cur ? ' on' : '')} role="radio" aria-checked={!cur} onClick={() => pick('none')}>
            <ClueTile clue={null} gem />
            <span>{wt('noClue')}</span>
          </button>
        )}
        {kinds.map((k) => {
          const on = cur?.k === k;
          const sample: Clue = { k, ...(DIR_KINDS.has(k) ? { dirs: k === 'cone' || k === 'triangle' ? [5] : [1] } : {}) };
          return (
            <button key={k} class={'ed-kind' + (on ? ' on' : '')} role="radio" aria-checked={on} disabled={big && k !== 'num' && k !== 'blank'} onClick={() => !on && pick(k)}>
              <ClueTile clue={sample} gem={c.gem} />
              <span>{name(k)}</span>
            </button>
          );
        })}
      </div>
      {cur && (DIR_KINDS.has(cur.k) || modable) && (
        <div class="ed-params">
          {DIR_KINDS.has(cur.k) && (
            <DirPicker
              dirs={cur.dirs ?? [0]}
              corners={cur.k === 'cone' || cur.k === 'triangle' || (cur.k === 'dot' && !!cur.corner)}
              single={cur.k === 'swirl'}
              onChange={(d) => upd({ dirs: d })}
            />
          )}
          <div class="ed-pcol">
            {modable && (
              <Chips
                value={cur.mod ?? 'none'}
                options={[
                  { v: 'none', label: wt('modNone') },
                  { v: 'together', label: wt('modTogether') },
                  { v: 'apart', label: wt('modApart') },
                ]}
                onChange={(v) => upd({ mod: v === 'none' ? undefined : (v as 'together' | 'apart') })}
              />
            )}
            {cur.k === 'dot' && (
              <label class="ed-check">
                <Toggle on={!!cur.corner} onChange={(v) => upd({ corner: v })} label={wt('dotCorner')} />
                <span>{wt('dotCorner')}</span>
              </label>
            )}
            {cur.k === 'swirl' && (
              <label class="ed-check">
                <Toggle on={!!cur.ccw} onChange={(v) => upd({ ccw: v })} label={wt('ccw')} />
                <span>{wt('ccw')}</span>
              </label>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const ROTS: { v: string; rot: number[] | undefined; label: WKey }[] = [
  { v: 'none', rot: undefined, label: 'rotNone' },
  { v: '2', rot: [0, 3], label: 'rot2' },
  { v: '3', rot: [0, 2, 4], label: 'rot3' },
  { v: '6', rot: [0, 1, 2, 3, 4, 5], label: 'rot6' },
];
const ALTS: ('none' | ClueKind)[] = ['none', 'blank', 'parity', 'num', 'radius', 'ring', 'eye', 'island'];

function RotEditor({ level, i, commit, say }: { level: Level; i: number; commit: (l: Level | null) => boolean; say: (s: string) => void }) {
  const c = level.cells[i];
  if (!c) return null;
  if (c.extra?.length) return <p class="ed-tip">{wt('bigOnlyNum')}</p>;
  const rv = ROTS.find((r) => JSON.stringify(r.rot) === JSON.stringify(c.rot))?.v ?? 'none';
  const av = c.alt?.length === 1 ? c.alt[0].k : 'none';
  const name = (k: ClueKind) => t(mechTitle(k === 'num' ? 'basic' : k));
  return (
    <div class="ed-rot">
      <div class="ed-prow">
        <span class="ed-plabel">{wt('rotLabel')}</span>
        <Chips value={rv} options={ROTS.map((r) => ({ v: r.v, label: wt(r.label) }))} onChange={(v) => commit(setRot(level, i, ROTS.find((r) => r.v === v)!.rot))} />
      </div>
      <div class="ed-prow">
        <span class="ed-plabel">{wt('altLabel')}</span>
        <Chips
          value={av}
          options={ALTS.filter((k) => !(c.gem && k === 'blank')).map((k) => ({ v: k, label: k === 'none' ? wt('altNone') : name(k) }))}
          onChange={(v) => {
            if (!commit(setAlt(level, i, v === 'none' ? undefined : [{ k: v as ClueKind }]))) say(wt('lint_invalid'));
          }}
        />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ sheets

function SettingsSheet({ open, draft, onClose, onTitle, onFog, onReset }: { open: boolean; draft: Draft; onClose: () => void; onTitle: (v: string) => void; onFog: (on: boolean) => void; onReset: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} class="ed-sheet" label={wt('settings')}>
      <h2>{wt('settings')}</h2>
      <label class="ed-field">
        <span class="label">{wt('ws_name')}</span>
        <input class="ed-input" value={draft.title} maxLength={MAX_TITLE} placeholder={wt('ws_namePh')} onInput={(e) => onTitle((e.target as HTMLInputElement).value)} />
      </label>
      <div class="sgroup">
        <div class="srow">
          <span class="s-text">
            <span class="s-t">{wt('fog')}</span>
            <span class="s-s">{wt('fogSub')}</span>
          </span>
          <span class="s-ctl">
            <Toggle on={draft.level.fog !== false} onChange={onFog} label={wt('fog')} />
          </span>
        </div>
      </div>
      <div class="row">
        <button class="btn ghost" onClick={onReset}>{wt('reset')}</button>
        <button class="btn cta" onClick={onClose}>{t('gotIt')}</button>
      </div>
    </Sheet>
  );
}

function ShareSheet({ open, draft, analysis, onClose, onDraft }: { open: boolean; draft: Draft; analysis: Analysis; onClose: () => void; onDraft: (f: (d: Draft) => Draft) => void }) {
  const [author, setAuthor] = useState(loadAuthor);
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const ok = analysis.state === 'ok';
  const diff = ok ? analysis.diff : 0;
  useEffect(() => {
    if (!open || !ok) {
      setCode(null);
      return undefined;
    }
    let alive = true;
    const tm = setTimeout(() => {
      const lv = playable(draft.level, 'shared', draft.title.trim() || undefined);
      void encodeLevel(lv, { title: draft.title, author, diff }).then((c) => {
        if (!alive) return;
        setCode(c);
        const hash = analysisKey(draft.level);
        onDraft((d) => (d.code === c ? d : { ...d, code: c, codeHash: hash }));
      });
    }, 120);
    return () => {
      alive = false;
      clearTimeout(tm);
    };
  }, [open, ok, draft.title, author, analysisKey(draft.level)]);
  useEffect(() => setCopied(false), [code]);
  const url = code ? shareUrl(code) : '';
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      sfx.toggle();
    } catch {
      /* the field is selectable as a fallback */
    }
  };
  const send = async () => {
    try {
      await navigator.share({ title: 'Hexlume', text: wt('share_text', { name: draft.title || wt('ws_untitled') }), url });
    } catch {
      /* cancelled */
    }
  };
  return (
    <Sheet open={open} onClose={onClose} class="ed-sheet" label={wt('share_title')}>
      <h2>{wt('share_title')}</h2>
      <label class="ed-field">
        <span class="label">{wt('ws_name')}</span>
        <input class="ed-input" value={draft.title} maxLength={MAX_TITLE} placeholder={wt('ws_namePh')} onInput={(e) => onDraft((d) => ({ ...d, title: (e.target as HTMLInputElement).value, updated: Date.now() }))} />
      </label>
      <label class="ed-field">
        <span class="label">{wt('ws_author')}</span>
        <input
          class="ed-input"
          value={author}
          maxLength={MAX_AUTHOR}
          placeholder={wt('ws_authorPh')}
          onInput={(e) => {
            const v = (e.target as HTMLInputElement).value;
            setAuthor(v);
            saveAuthor(v);
          }}
        />
      </label>
      {!ok ? (
        <p class="ed-note">{analysis.state === 'pending' ? wt('st_pending') : wt('share_needOk')}</p>
      ) : (
        <>
          <div class="ed-link">
            <input class="ed-input mono" readOnly value={url || '…'} onFocus={(e) => (e.target as HTMLInputElement).select()} aria-label="URL" />
            <span class="ed-link-meta">
              {wt('st_diff', { d: diff })}
              {code ? ` · ${wt('share_len', { n: url.length })}` : ''}
            </span>
          </div>
          <div class="row">
            <button class={canShare ? 'btn ghost' : 'btn cta'} disabled={!code} onClick={copy}>
              {copied ? <IconCheck /> : <IconCopy />}
              <span>{copied ? wt('share_copied') : wt('share_copy')}</span>
            </button>
            {canShare && (
              <button class="btn cta" disabled={!code} onClick={send}>
                <IconShare />
                <span>{wt('share_send')}</span>
              </button>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
}
