// Interactive board: SVG + pan/zoom + pointer gestures + particle canvas.
// The board decides nothing about the game: it reports taps, long-presses, double taps and hover.

import type { ComponentChildren } from 'preact';
import { useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'preact/hooks';
import { forwardRef } from 'preact/compat';
import { BoardLayer, type BoardLayerProps } from './BoardLayer';
import { cellAt, S } from './geometry';
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
  const pr = useRef(props);
  pr.current = props;
  const anim = useRef(0);

  const apply = () => {
    const v = view.current;
    g.current?.setAttribute('transform', `translate(${v.tx.toFixed(2)} ${v.ty.toFixed(2)}) scale(${v.k.toFixed(4)})`);
    if (parts.current) parts.current.view = { ...v };
  };

  const computeFit = () => {
    const el = wrap.current;
    if (!el) return null;
    const W = el.clientWidth, H = el.clientHeight;
    const L = pr.current.layout;
    const pad = pr.current.pad ?? 18;
    const maxCell = pr.current.maxCell ?? 54;
    const pb = pr.current.padBottom ?? 0;
    const k = Math.min((W - pad * 2) / L.w, (H - pad * 2 - pb) / L.h, maxCell / S);
    const tx = W / 2 - (L.minX + L.w / 2) * k;
    const ty = (H - pb) / 2 - (L.minY + L.h / 2) * k;
    return { k, tx, ty };
  };

  const animateTo = (to: { k: number; tx: number; ty: number }, ms = 280) => {
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
      const e = 1 - Math.pow(1 - t, 3);
      view.current = { k: from.k + (to.k - from.k) * e, tx: from.tx + (to.tx - from.tx) * e, ty: from.ty + (to.ty - from.ty) * e };
      apply();
      if (t < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  };

  const fit = (animate = true) => {
    const f = computeFit();
    if (!f) return;
    fitView.current = f;
    userMoved.current = false;
    animateTo(f, animate ? 280 : 0);
  };

  useImperativeHandle(ref, () => ({
    fit,
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
      if (!userMoved.current) fit(false);
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
    fit(false);
  }, [props.layout]);

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
    const clampView = () => {
      const v = view.current;
      const L = pr.current.layout;
      const W = el.clientWidth, H = el.clientHeight;
      const f = fitView.current;
      v.k = Math.max(f.k * 0.7, Math.min(v.k, Math.max(f.k * 4, 2.4)));
      const cx = (L.minX + L.w / 2) * v.k + v.tx;
      const cy = (L.minY + L.h / 2) * v.k + v.ty;
      const mx = Math.max(W / 2, (L.w * v.k) / 2), my = Math.max(H / 2, (L.h * v.k) / 2);
      if (cx < W / 2 - mx) v.tx += W / 2 - mx - cx;
      if (cx > W / 2 + mx) v.tx -= cx - (W / 2 + mx);
      if (cy < H / 2 - my) v.ty += H / 2 - my - cy;
      if (cy > H / 2 + my) v.ty -= cy - (H / 2 + my);
    };

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2 && e.button !== 1) return;
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
        userMoved.current = true;
        clampView();
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
        clampView();
        v.tx = mx - bx * v.k;
        v.ty = my - by * v.k;
        userMoved.current = true;
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
      clampView();
      v.tx = p.x - bx * v.k;
      v.ty = p.y - by * v.k;
      userMoved.current = true;
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
    el.addEventListener('pointerleave', leave);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('contextmenu', ctx);
    return () => {
      clearTimeout(pressTimer);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
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
    </div>
  );
});
