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
      lume: v('--lume', '#f4c77a'),
      core: v('--lume-core', '#fff4dc'),
      bad: v('--bad', '#ff6b6b'),
      ink: v('--dust', '#5b616d'),
    };
  }

  spawn(kind: ParticleKind, x: number, y: number, delay = 0): void {
    if (!this.enabled) return;
    const c = this.colors();
    const add = (p: Partial<P>) =>
      this.ps.push({ x, y, vx: 0, vy: 0, life: 0, max: 600, size: 4, color: c.lume, kind, rot: 0, vr: 0, delay, ...p });
    if (kind === 'sparkle') {
      // the light comes on: a few fine motes drift outward (the flash ring itself is CSS)
      const n = 6;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
        const sp = 30 + Math.random() * 26;
        // motes start outside the ring, never on top of the core
        add({ kind: 'dust', x: x + Math.cos(a) * 16, y: y + Math.sin(a) * 16, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, max: 420 + Math.random() * 200, size: 1.1 + Math.random() * 0.9, color: i % 2 ? c.core : c.lume });
      }
    } else if (kind === 'dust') {
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 18 + Math.random() * 20;
        add({ kind: 'dust', vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, max: 320 + Math.random() * 160, size: 1.2 + Math.random() * 1.2, color: c.ink });
      }
    } else if (kind === 'bloom') {
      // win: a thin ring and a few warm motes rising
      add({ kind: 'ring', max: 700, size: 14, color: c.lume });
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
        const sp = 24 + Math.random() * 30;
        add({ kind: 'dust', vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, max: 900 + Math.random() * 400, size: 1.2 + Math.random() * 1, color: i % 2 ? c.core : c.lume });
      }
    } else if (kind === 'bad') {
      add({ kind: 'ring', max: 360, size: 16, color: c.bad });
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
      p.vy = p.vy * 0.94 + (p.kind === 'dust' ? 0 : 60 * s);
      p.rot += p.vr * s;
      ctx.globalAlpha = Math.max(0, 1 - t * t);
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.color;
      if (p.kind === 'ring') {
        ctx.globalAlpha = (1 - t) * 0.7;
        ctx.lineWidth = 1.6 * (1 - t) + 0.4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size + t * 24, 0, Math.PI * 2);
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
