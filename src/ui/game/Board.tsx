// Interactive board: SVG + pan/zoom + pointer gestures + particle canvas.
// The board decides nothing about the game: it reports taps, long-presses, double taps and hover.

import type { ComponentChildren } from 'preact';
import { useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'preact/hooks';
import { forwardRef } from 'preact/compat';
import { BoardLayer, type BoardLayerProps } from './BoardLayer';
import { cellAt, INNER, S, type Layout } from './geometry';
import { toPixel } from '../../core/hex';
import { Particles, type ParticleKind } from './particles';

export interface Badge {
  kind: 'zone' | 'link';
  idx: number;
  x: number;
  y: number;
  r: number;
}

/** A target under the pointer: a cell, a zone/link badge, or nothing. */
export type Target = { t: 'cell'; i: number } | { t: 'badge'; b: Badge } | { t: 'none' };

export interface BoardHandle {
  fit(animate?: boolean): void;
  /** Ease out to the whole board. */
  fitAll(ms?: number): void;
  /** Pan just enough to bring cell i on screen (no-op when it already is). */
  show(i: number): void;
  /** When none of the cells is on screen, pan to the first one. */
  showAny(cells: number[]): void;
  cellEl(i: number): SVGGElement | null;
  spawn(kind: ParticleKind, i: number, delay?: number): void;
  spawnAt(kind: ParticleKind, x: number, y: number, delay?: number): void;
  shake(): void;
  /** Screen rect of the board wrapper. */
  el(): HTMLDivElement | null;
}

interface Props extends Omit<BoardLayerProps, 'press'> {
  press: BoardLayerProps['press'];
  badges: Badge[];
  reducedMotion: boolean;
  /** Extra padding (px) around the fitted board. */
  pad?: number;
  maxCell?: number;
  /** Extra space kept free at the bottom (floating buttons). */
  padBottom?: number;
  /**
   * Cells the camera frames (1 = in sight, e.g. not fogged). The camera fits them plus a one-cell
   * margin and eases along as the set grows — until the user pans or zooms (F / double tap on
   * empty space re-fits and re-enables following).
   */
  focus?: Uint8Array;
  /** Board point to keep in view when the framed area is larger than the screen (last move). */
  anchor?: [number, number] | null;
  /** Cells that must be fully on screen in the initial framing (start / opened / locks). */
  must?: Uint8Array;
  /** Called once when cells in sight first extend beyond the screen (pan hint). */
  onOverflow?(): void;
  onTap(t: Target, e: { mouse: boolean }): void;
  onDoubleTap(t: Target): void;
  onLong(t: Target): void;
  onAlt(t: Target): void;
  onPressStart(t: Target): void;
  onPressEnd(): void;
  onHover(t: Target): void;
  /** Extra SVG drawn above the board, in board units (e.g. the online partner's pointer). */
  overlay?: ComponentChildren;
}

const LONG_MS = 360;

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Bounding box (board units) of the focus cells, or of the whole board. */
function focusBox(L: Layout, focus: Uint8Array | undefined, margin: boolean): Box {
  const full: Box = { minX: L.minX, minY: L.minY, maxX: L.maxX, maxY: L.maxY };
  if (!focus) return full;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < L.hexes.length; i++) {
    if (!focus[i]) continue;
    for (const [q, r] of L.hexes[i]) {
      const [x, y] = toPixel(q, r, S);
      minX = Math.min(minX, x - S);
      maxX = Math.max(maxX, x + S);
      minY = Math.min(minY, y - INNER);
      maxY = Math.max(maxY, y + INNER + 4);
    }
  }
  if (minX === Infinity) return full;
  if (margin) {
    // one cell of margin, but never beyond the board itself
    minX = Math.max(full.minX, minX - S * 1.5);
    maxX = Math.min(full.maxX, maxX + S * 1.5);
    minY = Math.max(full.minY, minY - INNER * 2);
    maxY = Math.min(full.maxY, maxY + INNER * 2);
  }
  return { minX, minY, maxX, maxY };
}

/** Smallest comfortable hex circumradius (px) when the board is wider than the screen. */
function minCellPx(): number {
  try {
    const coarse = matchMedia('(pointer: coarse)').matches;
    if (coarse || Math.min(innerWidth, innerHeight) < 520) return 25;
  } catch {
    /* ignore */
  }
  return 22;
}

/** Bounding box of the "must see" cells (start / opened / locks), or null. */
function mustBox(L: Layout, must: Uint8Array | undefined): Box | null {
  if (!must) return null;
  const B = focusBox(L, must, false);
  let any = false;
  for (let i = 0; i < must.length; i++) if (must[i]) any = true;
  return any ? B : null;
}

const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));

export const GameBoard = forwardRef<BoardHandle, Props>(function GameBoard(props, ref) {
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const g = useRef<SVGGElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const parts = useRef<Particles | null>(null);
  const view = useRef({ k: 1, tx: 0, ty: 0 });
  const fitView = useRef({ k: 1, tx: 0, ty: 0 });
  const userMoved = useRef(false);
  const cellEls = useRef<(SVGGElement | null)[]>([]);
  const edges = useRef<HTMLDivElement>(null);
  const pr = useRef(props);
  pr.current = props;
  const anim = useRef(0);

  /** Subtle edge fades where cells in sight continue beyond the screen. */
  const edgeHints = () => {
    const el = wrap.current, box = edges.current;
    if (!el || !box) return;
    const v = view.current;
    const B = focusBox(pr.current.layout, pr.current.focus, false);
    const W = el.clientWidth, H = el.clientHeight;
    const on = [B.minX * v.k + v.tx < -6, B.maxX * v.k + v.tx > W + 6, B.minY * v.k + v.ty < -6, B.maxY * v.k + v.ty > H + 6];
    for (let k = 0; k < 4; k++) (box.children[k] as HTMLElement | undefined)?.classList.toggle('on', on[k]);
    if (!overflowed.current && on.some(Boolean) && pr.current.onOverflow) {
      overflowed.current = true;
      pr.current.onOverflow();
    }
  };
  const overflowed = useRef(false);

  const apply = () => {
    const v = view.current;
    g.current?.setAttribute('transform', `translate(${v.tx.toFixed(2)} ${v.ty.toFixed(2)}) scale(${v.k.toFixed(4)})`);
    if (parts.current) parts.current.view = { ...v };
    edgeHints();
  };

  /**
   * Camera framing.
   * - Frames the cells in sight (+ one cell of margin), never larger than `maxCell`.
   * - Portrait phones fit the WIDTH (hexes >= ~27 px) and scroll vertically; elsewhere both axes fit.
   * - Hard rule for the initial framing: start / opened cells and locks (`must`) are fully on screen
   *   (the zoom drops below the comfort minimum if that is the only way).
   * - Later framings (fog lifting) keep the current spot unless the last move would be off screen.
   */
  const computeFit = (initial = false) => {
    const el = wrap.current;
    if (!el) return null;
    const W = el.clientWidth, H = el.clientHeight;
    if (!W || !H) return null;
    const L = pr.current.layout;
    const pad = pr.current.pad ?? 14;
    const maxCell = pr.current.maxCell ?? 54;
    const pb = pr.current.padBottom ?? 0;
    const Hh = H - pb;
    const portrait = Hh > W * 1.15;
    const B = focusBox(L, pr.current.focus, true);
    if (portrait) {
      // portrait phones: fit the cells in sight edge to edge horizontally (no side margin)
      const B0 = focusBox(L, pr.current.focus, false);
      B.minX = B0.minX - S * 0.15;
      B.maxX = B0.maxX + S * 0.15;
    }
    const bw = B.maxX - B.minX, bh = B.maxY - B.minY;
    const kMin = Math.min(minCellPx(), maxCell) / S;
    const kW = (W - pad * 2) / bw, kH = (Hh - pad * 2) / bh;
    let k = Math.min(portrait ? kW : Math.min(kW, kH), maxCell / S);
    if (k < kMin) k = kMin;
    const M = initial ? mustBox(L, pr.current.must) : null;
    if (M) {
      const km = Math.min((W - pad * 2) / (M.maxX - M.minX + 8), (Hh - pad * 2) / (M.maxY - M.minY + 8));
      if (k > km) k = km;
    }
    const halfW = (W / 2 - pad) / k, halfH = (Hh / 2 - pad) / k;
    let cx = (B.minX + B.maxX) / 2, cy = (B.minY + B.maxY) / 2;
    const overX = bw / 2 > halfW, overY = bh / 2 > halfH;
    if (overX || overY) {
      const v = view.current;
      const centre: [number, number] = [(W / 2 - v.tx) / v.k, (Hh / 2 - v.ty) / v.k];
      let ref: [number, number] = centre;
      if (initial) ref = M ? [(M.minX + M.maxX) / 2, (M.minY + M.maxY) / 2] : pr.current.anchor ?? [cx, cy];
      else {
        const an = pr.current.anchor;
        if (an) {
          // follow the latest move only when it would end up off screen
          const sx = (an[0] - centre[0]) * k + W / 2, sy = (an[1] - centre[1]) * k + Hh / 2;
          const m = S * k * 1.2;
          if (sx < m || sx > W - m || sy < m || sy > Hh - m) ref = an;
        }
      }
      if (overX) cx = clamp(ref[0], B.minX + halfW, B.maxX - halfW);
      if (overY) cy = clamp(ref[1], B.minY + halfH, B.maxY - halfH);
      if (M) {
        // hard: the must-see box stays inside the screen
        cx = clamp(cx, M.maxX + 4 - halfW, M.minX - 4 + halfW);
        cy = clamp(cy, M.maxY + 4 - halfH, M.minY - 4 + halfH);
      }
    }
    return { k, tx: W / 2 - cx * k, ty: Hh / 2 - cy * k };
  };

  /** Whole board on screen (end of a level). */
  const fitAll = (ms = 600) => {
    const el = wrap.current;
    if (!el) return;
    const L = pr.current.layout;
    const pad = 16;
    const W = el.clientWidth, H = el.clientHeight;
    const k = Math.min((W - pad * 2) / L.w, (H - pad * 2) / L.h, (pr.current.maxCell ?? 54) / S);
    animateTo({ k, tx: W / 2 - (L.minX + L.w / 2) * k, ty: H / 2 - (L.minY + L.h / 2) * k }, ms, true);
  };

  /** Zoom that shows the whole board (lower zoom limit). */
  const fullK = () => {
    const el = wrap.current;
    const L = pr.current.layout;
    if (!el) return 1;
    return Math.min((el.clientWidth - 24) / L.w, (el.clientHeight - 24) / L.h);
  };

  const animateTo = (to: { k: number; tx: number; ty: number }, ms = 280, soft = false) => {
    cancelAnimationFrame(anim.current);
    if (pr.current.reducedMotion || ms <= 0) {
      view.current = { ...to };
      apply();
      return;
    }
    const from = { ...view.current };
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      const e = soft ? (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2) : 1 - Math.pow(1 - t, 3);
      view.current = { k: from.k + (to.k - from.k) * e, tx: from.tx + (to.tx - from.tx) * e, ty: from.ty + (to.ty - from.ty) * e };
      apply();
      if (t < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  };

  const fit = (animate = true, initial = false) => {
    const f = computeFit(initial);
    if (!f) return;
    fitView.current = f;
    userMoved.current = false;
    animateTo(f, animate ? 320 : 0);
  };

  /**
   * Follow the fog lifting: ease to the new framing. A pan does not stop this (the next move that
   * lifts fog brings the camera along again); a pinch / wheel zoom in the last 3 s does.
   */
  const lastZoom = useRef(0);
  const follow = () => {
    if (userMoved.current && performance.now() - lastZoom.current < 3000) return;
    userMoved.current = false;
    const f = computeFit();
    if (!f) return;
    fitView.current = f;
    const v = view.current;
    if (Math.abs(f.k - v.k) < 0.002 && Math.abs(f.tx - v.tx) < 1 && Math.abs(f.ty - v.ty) < 1) return;
    animateTo(f, 750, true);
  };
  const userTook = (zoom = false) => {
    userMoved.current = true;
    if (zoom) lastZoom.current = performance.now();
    cancelAnimationFrame(anim.current);
  };

  useImperativeHandle(ref, () => ({
    fit,
    fitAll,
    show: (i) => {
      const el = wrap.current;
      const p = pr.current.layout.px[i];
      if (!el || !p) return;
      const v = view.current;
      const W = el.clientWidth, H = el.clientHeight;
      const m = S * v.k * 1.4;
      const sx = p[0] * v.k + v.tx, sy = p[1] * v.k + v.ty;
      let dx = 0, dy = 0;
      if (sx < m) dx = m - sx;
      else if (sx > W - m) dx = W - m - sx;
      if (sy < m) dy = m - sy;
      else if (sy > H - m) dy = H - m - sy;
      if (dx || dy) animateTo({ k: v.k, tx: v.tx + dx, ty: v.ty + dy }, 420, true);
    },
    showAny: (cells) => {
      const el = wrap.current;
      if (!el || !cells.length) return;
      const v = view.current;
      const W = el.clientWidth, H = el.clientHeight;
      const on = cells.some((i) => {
        const p = pr.current.layout.px[i];
        if (!p) return false;
        const sx = p[0] * v.k + v.tx, sy = p[1] * v.k + v.ty;
        return sx > 0 && sx < W && sy > 0 && sy < H;
      });
      if (on) return;
      const p = pr.current.layout.px[cells[0]];
      if (p) animateTo({ k: v.k, tx: W / 2 - p[0] * v.k, ty: H / 2 - p[1] * v.k }, 500, true);
    },
    cellEl: (i) => cellEls.current[i] ?? null,
    spawn: (kind, i, delay = 0) => {
      const p = pr.current.layout.px[i];
      if (p) parts.current?.spawn(kind, p[0], p[1], delay);
    },
    spawnAt: (kind, x, y, delay = 0) => parts.current?.spawn(kind, x, y, delay),
    shake: () => {
      if (pr.current.reducedMotion) return;
      svg.current?.animate(
        [
          { transform: 'translate(0,0)' },
          { transform: 'translate(-5px,1px)' },
          { transform: 'translate(4px,-1px)' },
          { transform: 'translate(-2px,0)' },
          { transform: 'translate(0,0)' },
        ],
        { duration: 280, easing: 'ease-out' },
      );
    },
    el: () => wrap.current,
  }));

  // particles + resize
  useLayoutEffect(() => {
    const p = new Particles(canvas.current!);
    parts.current = p;
    p.enabled = !pr.current.reducedMotion;
    const measure = () => {
      const el = wrap.current;
      if (!el) return;
      p.resize(el.clientWidth, el.clientHeight);
      if (!userMoved.current) fit(false, true);
      else apply();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap.current!);
    return () => {
      ro.disconnect();
      p.destroy();
      cancelAnimationFrame(anim.current);
    };
  }, []);

  useEffect(() => {
    if (parts.current) parts.current.enabled = !props.reducedMotion;
  }, [props.reducedMotion]);

  // refit when the level changes
  useEffect(() => {
    fit(false, true);
  }, [props.layout]);

  // the framed area changed (fog lifted): ease along
  const firstFocus = useRef(true);
  useEffect(() => {
    if (firstFocus.current) {
      firstFocus.current = false;
      return;
    }
    follow();
  }, [props.focus]);

  // ---------------------------------------------------------------- gestures
  useEffect(() => {
    const el = wrap.current!;
    const pts = new Map<number, { x: number; y: number; sx: number; sy: number; type: string }>();
    let mode: 'idle' | 'press' | 'pan' | 'pinch' = 'idle';
    let pressTarget: Target = { t: 'none' };
    let pressTimer = 0;
    let fired = false;
    let pinch0 = { d: 1, mx: 0, my: 0, k: 1, tx: 0, ty: 0 };
    let lastTap = { t: 0, x: 0, y: 0, key: '' };
    let hoverKey = '';

    const local = (e: PointerEvent | WheelEvent | MouseEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const hit = (x: number, y: number): Target => {
      const v = view.current;
      const bx = (x - v.tx) / v.k, by = (y - v.ty) / v.k;
      for (const b of pr.current.badges) if (Math.hypot(bx - b.x, by - b.y) <= b.r) return { t: 'badge', b };
      const i = cellAt(pr.current.board, pr.current.layout, bx, by);
      return i >= 0 ? { t: 'cell', i } : { t: 'none' };
    };
    const tkey = (t: Target) => (t.t === 'cell' ? 'c' + t.i : t.t === 'badge' ? t.b.kind + t.b.idx : '');
    const endPress = () => {
      clearTimeout(pressTimer);
      if (mode === 'press') pr.current.onPressEnd();
    };
    const clampK = () => {
      const v = view.current;
      const f = fitView.current;
      v.k = Math.max(Math.min(f.k, fullK()) * 0.8, Math.min(v.k, Math.max(f.k * 4, 2.4)));
    };
    /** Panning stays on the board: an axis that fits is locked (centred), one that overflows
     *  can move until its edge reaches the screen edge. */
    const clampPan = () => {
      const v = view.current;
      const L = pr.current.layout;
      const pad = 12;
      const axis = (t: number, min: number, max: number, size: number) => {
        const len = (max - min) * v.k;
        if (len <= size - pad * 2) return size / 2 - ((min + max) / 2) * v.k;
        return clamp(t, size - pad - max * v.k, pad - min * v.k);
      };
      v.tx = axis(v.tx, L.minX, L.maxX, el.clientWidth);
      v.ty = axis(v.ty, L.minY, L.maxY, el.clientHeight);
    };

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2 && e.button !== 1) return;
      // a primary pointer starts a fresh gesture: drop pointers whose "up" never arrived (a sheet
      // opened mid-press, capture lost…), otherwise every later tap would look like a pinch
      if (e.isPrimary && pts.size) {
        pts.clear();
        endPress();
        mode = 'idle';
      }
      const p = local(e);
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (e.pointerType === 'mouse' && e.button === 2) {
        pr.current.onAlt(hit(p.x, p.y));
        return;
      }
      pts.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y, type: e.pointerType });
      if (e.pointerType === 'mouse' && e.button === 1) {
        mode = 'pan';
        return;
      }
      if (pts.size === 1) {
        mode = 'press';
        fired = false;
        pressTarget = hit(p.x, p.y);
        pr.current.onPressStart(pressTarget);
        clearTimeout(pressTimer);
        pressTimer = window.setTimeout(() => {
          if (mode !== 'press') return;
          fired = true;
          pr.current.onLong(pressTarget);
        }, LONG_MS);
      } else if (pts.size === 2) {
        endPress();
        mode = 'pinch';
        const [a, b] = [...pts.values()];
        pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, ...view.current };
      }
    };

    const move = (e: PointerEvent) => {
      const p = local(e);
      if (e.pointerType === 'mouse' && !pts.has(e.pointerId)) {
        const t = hit(p.x, p.y);
        const k = tkey(t);
        if (k !== hoverKey) {
          hoverKey = k;
          pr.current.onHover(t);
        }
        return;
      }
      const pt = pts.get(e.pointerId);
      if (!pt) return;
      const dx = p.x - pt.x, dy = p.y - pt.y;
      pt.x = p.x;
      pt.y = p.y;
      if (mode === 'press') {
        const moved = Math.hypot(p.x - pt.sx, p.y - pt.sy);
        if (moved > (e.pointerType === 'mouse' ? 6 : 10)) {
          endPress();
          mode = 'pan';
        } else return;
      }
      if (mode === 'pan') {
        view.current.tx += dx;
        view.current.ty += dy;
        userTook();
        clampPan();
        apply();
      } else if (mode === 'pinch' && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const k = pinch0.k * (d / pinch0.d);
        const v = view.current;
        // keep the board point under the initial midpoint under the current midpoint
        const bx = (pinch0.mx - pinch0.tx) / pinch0.k, by = (pinch0.my - pinch0.ty) / pinch0.k;
        v.k = k;
        clampK();
        v.tx = mx - bx * v.k;
        v.ty = my - by * v.k;
        clampPan();
        userTook(true);
        apply();
      }
    };

    const up = (e: PointerEvent) => {
      const pt = pts.get(e.pointerId);
      if (!pt) return;
      pts.delete(e.pointerId);
      if (mode === 'press') {
        endPress();
        mode = 'idle';
        if (!fired) {
          const now = performance.now();
          const k = tkey(pressTarget);
          const isDouble = now - lastTap.t < 330 && k === lastTap.key && Math.hypot(pt.x - lastTap.x, pt.y - lastTap.y) < 24;
          if (isDouble) {
            lastTap = { t: 0, x: 0, y: 0, key: '' };
            if (pressTarget.t === 'none') fit(true);
            else pr.current.onDoubleTap(pressTarget);
          } else {
            lastTap = { t: now, x: pt.x, y: pt.y, key: k };
            pr.current.onTap(pressTarget, { mouse: e.pointerType === 'mouse' });
          }
        }
      } else if (mode === 'pinch') {
        if (pts.size === 1) {
          mode = 'pan';
          const [rest] = [...pts.values()];
          rest.sx = rest.x;
          rest.sy = rest.y;
        } else if (pts.size === 0) mode = 'idle';
      } else if (pts.size === 0) mode = 'idle';
    };

    const cancel = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      endPress();
      if (pts.size === 0) mode = 'idle';
    };

    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      const v = view.current;
      const bx = (p.x - v.tx) / v.k, by = (p.y - v.ty) / v.k;
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0016));
      v.k *= f;
      clampK();
      v.tx = p.x - bx * v.k;
      v.ty = p.y - by * v.k;
      clampPan();
      userTook(true);
      apply();
    };

    const leave = () => {
      if (hoverKey !== '') {
        hoverKey = '';
        pr.current.onHover({ t: 'none' });
      }
    };
    const ctx = (e: Event) => e.preventDefault();

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('lostpointercapture', cancel);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('contextmenu', ctx);
    return () => {
      clearTimeout(pressTimer);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      el.removeEventListener('lostpointercapture', cancel);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('contextmenu', ctx);
    };
  }, []);

  // register cell elements for imperative effects
  const cells = props.cells.map((c) => (c.refCb ? c : { ...c, refCb: regRef }));
  function regRef(i: number, el: SVGGElement | null) {
    cellEls.current[i] = el;
  }

  return (
    <div class="board-wrap" ref={wrap}>
      <svg class="board-svg" ref={svg}>
        <g ref={g}>
          <BoardLayer {...props} cells={cells} />
          {props.overlay}
        </g>
      </svg>
      <canvas class="fx-canvas" ref={canvas} />
      <div class="edge-hints" ref={edges} aria-hidden="true">
        <i class="eh l" />
        <i class="eh r" />
        <i class="eh t" />
        <i class="eh b" />
      </div>
    </div>
  );
});
