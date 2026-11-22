// Softly animated hex field behind the menu: a slow colour wave plus warm lights that come on and fade.

import { useEffect, useRef } from 'preact/hooks';

interface Glow {
  x: number;
  y: number;
  t0: number;
  dur: number;
}

export function HexBackground({ density = 1 }: { density?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    let raf = 0, w = 0, h = 0, dpr = 1, last = 0;
    let centers: [number, number][] = [];
    /** Hexes fully on screen: lit crystals never appear half cut off at an edge. */
    let inner: [number, number][] = [];
    const glows: Glow[] = [];
    let nextGlow = 0;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let col = { a: '#c9c3f5', b: '#ffcfb5', line: 'rgba(80,60,140,0.07)', g1: '#8b5cf6', g2: '#22c3b5', dark: false };

    const readColors = () => {
      const cs = getComputedStyle(document.documentElement);
      const v = (n: string, f: string) => cs.getPropertyValue(n).trim() || f;
      col = {
        a: v('--bgx-a', '#c9c3f5'),
        b: v('--bgx-b', '#ffcfb5'),
        line: v('--bgx-line', 'rgba(80,60,140,0.07)'),
        g1: v('--gem-1', '#8b5cf6'),
        g2: v('--gem-2', '#22c3b5'),
        dark: document.documentElement.dataset.theme === 'dark',
      };
    };

    const R = 30 / density;
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = cv.clientWidth;
      h = cv.clientHeight;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      centers = [];
      const dx = R * 1.5, dy = R * Math.sqrt(3);
      for (let c = -1; c * dx < w + R * 2; c++)
        for (let r = -1; r * dy < h + R * 2; r++) centers.push([c * dx, r * dy + (c & 1 ? dy / 2 : 0)]);
      inner = centers.filter(([x, y]) => x > R && x < w - R && y > R && y < h - R);
      readColors();
    };

    const hexPath = (x: number, y: number, r: number) => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        const px = x + r * Math.cos(a), py = y + r * Math.sin(a);
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.closePath();
    };

    const draw = (now: number) => {
      const t = now / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = 1;
      for (const [x, y] of centers) {
        const wave = 0.5 + 0.5 * Math.sin(t * 0.55 + x * 0.007 - y * 0.005) * Math.cos(t * 0.33 + y * 0.006);
        ctx.globalAlpha = (col.dark ? 0.05 : 0.07) + wave * (col.dark ? 0.12 : 0.2);
        ctx.fillStyle = wave > 0.5 ? col.a : col.b;
        hexPath(x, y, R * 0.9);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = col.line;
        ctx.stroke();
      }
      // lit crystals
      for (let k = glows.length - 1; k >= 0; k--) {
        const g = glows[k];
        const p = (now - g.t0) / g.dur;
        if (p >= 1) {
          glows.splice(k, 1);
          continue;
        }
        const a = Math.sin(Math.PI * p);
        // a warm light comes on in a cell and fades: soft halo + bright core
        const grad = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, R * 1.25);
        grad.addColorStop(0, 'rgba(255,248,225,1)');
        grad.addColorStop(0.3, col.g2);
        grad.addColorStop(0.75, col.g1);
        grad.addColorStop(1, 'rgba(255,180,80,0)');
        ctx.globalAlpha = a * (col.dark ? 0.6 : 0.42);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(g.x, g.y, R * 1.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = a * 0.85;
        ctx.fillStyle = '#fffaf0';
        ctx.beginPath();
        ctx.arc(g.x, g.y, R * 0.16 * (0.7 + 0.3 * a), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 33) return; // ~30 fps is plenty for a background
      last = now;
      if (now > nextGlow && inner.length) {
        const [x, y] = inner[Math.floor(Math.random() * inner.length)];
        glows.push({ x, y, t0: now, dur: 2600 + Math.random() * 1800 });
        nextGlow = now + 500 + Math.random() * 900;
      }
      draw(now);
    };

    resize();
    const ro = new ResizeObserver(() => {
      resize();
      if (reduced) draw(0);
    });
    ro.observe(cv);
    const mo = new MutationObserver(() => {
      readColors();
      if (reduced) draw(0);
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    if (reduced) draw(0);
    else raf = requestAnimationFrame(loop);
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
