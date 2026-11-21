// Lightweight canvas particle layer drawn in board units (follows pan/zoom).

export type ParticleKind = 'sparkle' | 'dust' | 'bloom' | 'ring' | 'bad';

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  kind: ParticleKind;
  rot: number;
  vr: number;
  delay: number;
}

export class Particles {
  private ps: P[] = [];
  private raf = 0;
  private ctx: CanvasRenderingContext2D | null;
  private last = 0;
  view = { k: 1, tx: 0, ty: 0 };
  private w = 0;
  private h = 0;
  private dpr = 1;
  enabled = true;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d');
  }

  resize(w: number, h: number): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
  }

  private colors(): Record<string, string> {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string, f: string) => cs.getPropertyValue(n).trim() || f;
    return {
      g1: v('--gem-1', '#8b5cf6'),
      g2: v('--gem-2', '#22c3b5'),
      a1: v('--accent-1', '#ff7a5c'),
      a2: v('--accent-2', '#ffb340'),
      bad: v('--bad', '#f04f5f'),
      ink: v('--dust', '#c9c1d8'),
    };
  }

  spawn(kind: ParticleKind, x: number, y: number, delay = 0): void {
    if (!this.enabled) return;
    const c = this.colors();
    const add = (p: Partial<P>) =>
      this.ps.push({ x, y, vx: 0, vy: 0, life: 0, max: 600, size: 4, color: c.g1, kind, rot: Math.random() * 6, vr: 0, delay, ...p });
    if (kind === 'sparkle') {
      add({ kind: 'ring', max: 520, size: 18, color: c.g2 });
      const n = 11;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
        const sp = 70 + Math.random() * 90;
        add({ vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20, max: 560 + Math.random() * 320, size: 3 + Math.random() * 4.5, color: [c.g1, c.g2, '#ffffff', c.a2][i % 4], vr: (Math.random() - 0.5) * 10 });
      }
    } else if (kind === 'dust') {
      for (let i = 0; i < 5; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 24 + Math.random() * 30;
        add({ kind: 'dust', vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, max: 380 + Math.random() * 200, size: 1.6 + Math.random() * 2, color: c.ink });
      }
    } else if (kind === 'bloom') {
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 40 + Math.random() * 80;
        add({ kind: 'sparkle', vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, max: 900 + Math.random() * 500, size: 3 + Math.random() * 5, color: [c.g1, c.g2, c.a1, c.a2, '#ffffff'][i % 5], vr: (Math.random() - 0.5) * 8 });
      }
    } else if (kind === 'bad') {
      add({ kind: 'ring', max: 420, size: 16, color: c.bad });
    }
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  private tick = (now: number) => {
    const dt = Math.min(48, now - this.last);
    this.last = now;
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const { k, tx, ty } = this.view;
    ctx.setTransform(this.dpr * k, 0, 0, this.dpr * k, this.dpr * tx, this.dpr * ty);
    const alive: P[] = [];
    for (const p of this.ps) {
      if (p.delay > 0) {
        p.delay -= dt;
        alive.push(p);
        continue;
      }
      p.life += dt;
      if (p.life >= p.max) continue;
      alive.push(p);
      const t = p.life / p.max;
      const s = dt / 1000;
      p.x += p.vx * s;
      p.y += p.vy * s;
      p.vx *= 0.94;
      p.vy = p.vy * 0.94 + 60 * s;
      p.rot += p.vr * s;
      ctx.globalAlpha = Math.max(0, 1 - t * t);
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.color;
      if (p.kind === 'ring') {
        ctx.globalAlpha = (1 - t) * 0.8;
        ctx.lineWidth = 3 * (1 - t) + 0.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size + t * 30, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.kind === 'dust') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 - t * 0.5), 0, Math.PI * 2);
        ctx.fill();
      } else {
        // four-point star
        const r = p.size * (1 - t * 0.4);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const rr = i % 2 === 0 ? r : r * 0.32;
          const a = (i / 8) * Math.PI * 2;
          ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    this.ps = alive;
    if (alive.length) this.raf = requestAnimationFrame(this.tick);
    else {
      this.raf = 0;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  };

  /** Redraw now (after a pan/zoom while particles are alive the loop already redraws). */
  destroy(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.ps = [];
  }

  get size() {
    return { w: this.w, h: this.h };
  }
}
