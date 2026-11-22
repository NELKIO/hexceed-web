// Menu background: a sparse hex lattice drawn in hairlines that fades towards the edges, with two or
// three lights that slowly come on and dim. The lattice is drawn once into an offscreen canvas;
// each frame (~20 fps) only blits it and draws the lights. Static under reduced motion.

import { useEffect, useRef } from 'preact/hooks';

interface Glow {
  x: number;
  y: number;
  t0: number;
  dur: number;
}

const MAX_GLOWS = 0; // background lights off: on the menu only the hero board glows

export function HexBackground({ size = 34 }: { size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    let raf = 0, w = 0, h = 0, dpr = 1, last = 0;
    let inner: [number, number][] = [];
    let lattice: HTMLCanvasElement | null = null;
    const glows: Glow[] = [];
    let nextGlow = 0;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let col = { line: 'rgba(255,255,255,0.055)', lume: '#f4c77a', core: '#fff4dc', dark: true };

    const readColors = () => {
      const cs = getComputedStyle(document.documentElement);
      const v = (n: string, f: string) => cs.getPropertyValue(n).trim() || f;
      col = {
        line: v('--lattice', 'rgba(255,255,255,0.055)'),
        lume: v('--lume', '#f4c77a'),
        core: v('--lume-core', '#fff4dc'),
        dark: document.documentElement.dataset.theme !== 'light',
      };
    };

    const R = size;
    const hexPath = (c: CanvasRenderingContext2D, x: number, y: number, r: number) => {
      c.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        const px = x + r * Math.cos(a), py = y + r * Math.sin(a);
        if (i) c.lineTo(px, py);
        else c.moveTo(px, py);
      }
      c.closePath();
    };

    const build = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = cv.clientWidth;
      h = cv.clientHeight;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      readColors();
      const centers: [number, number][] = [];
      const dx = R * 1.5, dy = R * Math.sqrt(3);
      for (let c = -1; c * dx < w + R * 2; c++)
        for (let r = -1; r * dy < h + R * 2; r++) centers.push([c * dx, r * dy + (c & 1 ? dy / 2 : 0)]);
      // lights only where the lattice is clearly visible (away from the faded edges)
      // …and never behind text or buttons (rects of the menu content, in canvas coordinates)
      const box = cv.getBoundingClientRect();
      const pad = 40 + R;
      const busy = Array.from(document.querySelectorAll('.brand, .menu-actions, .menu-hero, .update-bar')).map((el) => {
        const r = el.getBoundingClientRect();
        return [r.left - box.left - pad, r.top - box.top - pad, r.right - box.left + pad, r.bottom - box.top + pad];
      });
      inner = centers.filter(
        ([x, y]) => x > w * 0.08 && x < w * 0.92 && y > h * 0.05 && y < h * 0.8 && !busy.some(([l, t, r, b]) => x > l && x < r && y > t && y < b),
      );
      lattice = document.createElement('canvas');
      lattice.width = cv.width;
      lattice.height = cv.height;
      const lc = lattice.getContext('2d');
      if (!lc) return;
      lc.setTransform(dpr, 0, 0, dpr, 0, 0);
      lc.lineWidth = 1 / dpr;
      lc.strokeStyle = col.line;
      for (const [x, y] of centers) {
        hexPath(lc, x, y, R * 0.94);
        lc.stroke();
      }
    };

    const draw = (now: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      if (lattice) ctx.drawImage(lattice, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (let k = glows.length - 1; k >= 0; k--) {
        const g = glows[k];
        const p = (now - g.t0) / g.dur;
        if (p >= 1) {
          glows.splice(k, 1);
          continue;
        }
        // ease in, hold, ease out
        const a = Math.min(1, Math.sin(Math.PI * p) * 1.6);
        const grad = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, R * 1.6);
        grad.addColorStop(0, col.lume);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = a * (col.dark ? 0.1 : 0.08);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(g.x, g.y, R * 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = a * 0.4;
        ctx.strokeStyle = col.lume;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(g.x, g.y, R * 0.28, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = a * 0.6;
        ctx.fillStyle = col.dark ? col.core : col.lume;
        ctx.beginPath();
        ctx.arc(g.x, g.y, R * 0.13, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    };

    /** Phones and small windows: the lattice only, no lights (there is no free space for them). */
    const maxGlows = () => (w < 900 ? 0 : MAX_GLOWS);

    const spawn = (now: number) => {
      if (!inner.length || glows.length >= maxGlows()) return;
      const [x, y] = inner[Math.floor(Math.random() * inner.length)];
      if (glows.some((g) => Math.hypot(g.x - x, g.y - y) < R * 4)) return;
      glows.push({ x, y, t0: now, dur: 6000 + Math.random() * 4000 });
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 50) return; // ~20 fps is plenty for a slow background
      last = now;
      if (now > nextGlow) {
        spawn(now);
        nextGlow = now + 2200 + Math.random() * 2600;
      }
      draw(now);
    };

    /** Reduced motion: two lights, fully on, never moving. */
    const still = () => {
      glows.length = 0;
      const t = performance.now();
      for (let k = 0; k < Math.min(2, maxGlows()) && inner.length; k++) {
        const [x, y] = inner[Math.floor(((k + 1) * inner.length) / 3)];
        glows.push({ x, y, t0: t - 5000, dur: 1e9 });
      }
      draw(t);
    };

    build();
    const ro = new ResizeObserver(() => {
      build();
      if (reduced) still();
    });
    ro.observe(cv);
    const mo = new MutationObserver(() => {
      build();
      if (reduced) still();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    if (reduced) still();
    else {
      // one light is already on when the menu opens
      spawn(performance.now() - 2500);
      raf = requestAnimationFrame(loop);
    }
    const vis = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reduced) raf = requestAnimationFrame(loop);
    };
    document.addEventListener('visibilitychange', vis);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);
  return <canvas class="hexbg" ref={ref} aria-hidden="true" />;
}
