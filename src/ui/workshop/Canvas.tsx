// The editor's board surface: an SVG with pan / pinch-zoom / wheel-zoom, reporting taps, paint
// strokes and hover in board units. It draws nothing about the level itself (children do).

import type { ComponentChildren } from 'preact';
import { forwardRef } from 'preact/compat';
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'preact/hooks';

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Stroke {
  start(x: number, y: number): void;
  move(x: number, y: number): void;
  end(): void;
  /** A second finger arrived: the stroke was the start of a pinch, undo it. */
  cancel(): void;
}

export interface CanvasHandle {
  fit(): void;
}

interface Props {
  box: Box;
  /** One-finger drag paints (otherwise it pans). */
  paint: Stroke | null;
  onTap(x: number, y: number): void;
  onHover?(p: [number, number] | null): void;
  children: ComponentChildren;
}

const TAP_SLOP = 7;

export const EditorCanvas = forwardRef<CanvasHandle, Props>(function EditorCanvas(props, ref) {
  const wrap = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ k: 0.6, tx: 0, ty: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const userMoved = useRef(false);
  const pr = useRef(props);
  pr.current = props;
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const g = useRef({ mode: 'none' as 'none' | 'tap' | 'pan' | 'paint' | 'pinch', sx: 0, sy: 0, v0: view, d0: 1, m0: [0, 0] as [number, number] });
  const stroking = useRef(false);

  const fitTo = (box: Box) => {
    const el = wrap.current;
    if (!el) return;
    const W = el.clientWidth, H = el.clientHeight;
    if (!W || !H) return;
    // the top keeps room for the floating buttons (undo / redo, fit)
    const pad = 10, top = 52;
    const w = box.maxX - box.minX, h = box.maxY - box.minY;
    const k = Math.min((W - pad * 2) / w, (H - pad - top) / h, 1.5);
    setView({ k, tx: W / 2 - ((box.minX + box.maxX) / 2) * k, ty: top + (H - pad - top) / 2 - ((box.minY + box.maxY) / 2) * k });
  };
  useImperativeHandle(ref, () => ({
    fit() {
      userMoved.current = false;
      fitTo(pr.current.box);
    },
  }));

  // keep the content framed until the user zooms or pans (not in the middle of a stroke)
  const boxKey = `${props.box.minX},${props.box.minY},${props.box.maxX},${props.box.maxY}`;
  useLayoutEffect(() => {
    if (!userMoved.current && !stroking.current) fitTo(props.box);
  }, [boxKey]);
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      if (!userMoved.current) fitTo(pr.current.box);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toBoard = (cx: number, cy: number): [number, number] => {
    const r = wrap.current!.getBoundingClientRect();
    const v = viewRef.current;
    return [(cx - r.left - v.tx) / v.k, (cy - r.top - v.ty) / v.k];
  };
  const local = (cx: number, cy: number): [number, number] => {
    const r = wrap.current!.getBoundingClientRect();
    return [cx - r.left, cy - r.top];
  };
  const clampK = (k: number) => Math.max(0.15, Math.min(3, k));

  const twoInfo = () => {
    const [a, b] = [...ptrs.current.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, m: local((a.x + b.x) / 2, (a.y + b.y) / 2) };
  };

  const down = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    try {
      wrap.current?.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const s = g.current;
    if (ptrs.current.size === 1) {
      s.sx = e.clientX;
      s.sy = e.clientY;
      s.v0 = viewRef.current;
      const paint = pr.current.paint;
      if (paint && e.button === 0) {
        s.mode = 'paint';
        stroking.current = true;
        const [x, y] = toBoard(e.clientX, e.clientY);
        paint.start(x, y);
      } else s.mode = e.button === 1 ? 'pan' : 'tap';
    } else if (ptrs.current.size === 2) {
      if (s.mode === 'paint') {
        pr.current.paint?.cancel();
        stroking.current = false;
      }
      s.mode = 'pinch';
      const t = twoInfo();
      s.d0 = t.d;
      s.m0 = t.m;
      s.v0 = viewRef.current;
    }
  };

  const move = (e: PointerEvent) => {
    const s = g.current;
    if (!ptrs.current.has(e.pointerId)) {
      if (e.pointerType === 'mouse') pr.current.onHover?.(toBoard(e.clientX, e.clientY));
      return;
    }
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (s.mode === 'paint') {
      const [x, y] = toBoard(e.clientX, e.clientY);
      pr.current.paint?.move(x, y);
      if (e.pointerType === 'mouse') pr.current.onHover?.([x, y]);
      return;
    }
    if (s.mode === 'tap' && Math.hypot(e.clientX - s.sx, e.clientY - s.sy) > TAP_SLOP) s.mode = 'pan';
    if (s.mode === 'pan') {
      userMoved.current = true;
      setView({ k: s.v0.k, tx: s.v0.tx + e.clientX - s.sx, ty: s.v0.ty + e.clientY - s.sy });
    } else if (s.mode === 'pinch' && ptrs.current.size >= 2) {
      userMoved.current = true;
      const t = twoInfo();
      const k = clampK((s.v0.k * t.d) / s.d0);
      // the board point under the initial midpoint follows the fingers
      const bx = (s.m0[0] - s.v0.tx) / s.v0.k, by = (s.m0[1] - s.v0.ty) / s.v0.k;
      setView({ k, tx: t.m[0] - bx * k, ty: t.m[1] - by * k });
    } else if (e.pointerType === 'mouse') pr.current.onHover?.(toBoard(e.clientX, e.clientY));
  };

  const up = (e: PointerEvent) => {
    if (!ptrs.current.has(e.pointerId)) return;
    ptrs.current.delete(e.pointerId);
    const s = g.current;
    if (ptrs.current.size > 0) {
      if (s.mode === 'pinch' && ptrs.current.size === 1) {
        // the remaining finger keeps panning from here
        const [p] = [...ptrs.current.values()];
        s.mode = 'pan';
        s.sx = p.x;
        s.sy = p.y;
        s.v0 = viewRef.current;
      }
      return;
    }
    if (s.mode === 'paint') {
      stroking.current = false;
      pr.current.paint?.end();
      if (!userMoved.current) fitTo(pr.current.box);
    } else if (s.mode === 'tap' && e.type === 'pointerup') {
      const [x, y] = toBoard(e.clientX, e.clientY);
      pr.current.onTap(x, y);
    }
    s.mode = 'none';
  };

  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    userMoved.current = true;
    const v = viewRef.current;
    const [mx, my] = local(e.clientX, e.clientY);
    const k = clampK(v.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    const bx = (mx - v.tx) / v.k, by = (my - v.ty) / v.k;
    setView({ k, tx: mx - bx * k, ty: my - by * k });
  };

  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  return (
    <div
      ref={wrap}
      class="ed-canvas"
      onPointerDown={down as never}
      onPointerMove={move as never}
      onPointerUp={up as never}
      onPointerCancel={up as never}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse' && !ptrs.current.size) pr.current.onHover?.(null);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <svg class="ed-svg" width="100%" height="100%">
        <g transform={`translate(${view.tx.toFixed(2)} ${view.ty.toFixed(2)}) scale(${view.k.toFixed(4)})`}>{props.children}</g>
      </svg>
    </div>
  );
});
