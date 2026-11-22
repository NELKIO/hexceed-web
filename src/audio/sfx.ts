// WebAudio-synthesised sounds. No audio files: every sound is built from oscillators and noise
// with a tiny generated reverb so the board feels like wood and glass.

type Ctx = AudioContext;

let ctx: Ctx | null = null;
let master: GainNode | null = null;
let dry: GainNode | null = null;
let wet: GainNode | null = null;
let volume = 0.7;
let vibrate = true;
let noiseBuf: AudioBuffer | null = null;

export function setVolume(v: number): void {
  volume = Math.max(0, Math.min(1, v));
  if (master && ctx) master.gain.setTargetAtTime(volume * volume * 0.9, ctx.currentTime, 0.02);
}

export function setVibration(on: boolean): void {
  vibrate = on;
}

/** Mono decaying-noise impulse (short: building it is cheap, and it is built off the first tap). */
function makeImpulse(c: Ctx, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  return buf;
}

/** Fill the reverb in idle time after audio starts (it used to be a long task on the first tap). */
function buildReverbLater(c: Ctx, conv: ConvolverNode): void {
  const run = () => {
    try {
      conv.buffer = makeImpulse(c, 0.8, 2.6);
    } catch {
      /* no reverb */
    }
  };
  const w = window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 2000 });
  else setTimeout(run, 300);
}

function ensure(): Ctx | null {
  if (volume <= 0) return null;
  if (!ctx) {
    const W = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const C = W.AudioContext ?? W.webkitAudioContext;
    if (!C) return null;
    try {
      ctx = new C();
    } catch {
      return null;
    }
    master = ctx.createGain();
    master.gain.value = volume * volume * 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    master.connect(comp).connect(ctx.destination);
    dry = ctx.createGain();
    dry.gain.value = 1;
    dry.connect(master);
    const conv = ctx.createConvolver();
    wet = ctx.createGain();
    wet.gain.value = 0.4;
    wet.connect(conv).connect(master);
    buildReverbLater(ctx, conv);
    const len = Math.floor(ctx.sampleRate * 0.25);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  return ctx;
}

/** Call from a user gesture (iOS needs it to start audio). */
export function unlockAudio(): void {
  const c = ensure();
  if (!c) return;
  try {
    const b = c.createBuffer(1, 1, 22050);
    const s = c.createBufferSource();
    s.buffer = b;
    s.connect(c.destination);
    s.start(0);
  } catch {
    /* ignore */
  }
}

interface ToneOpts {
  type?: OscillatorType;
  vol?: number;
  attack?: number;
  decay?: number;
  delay?: number;
  slide?: number; // frequency multiplier reached at the end
  reverb?: number; // 0..1 send
  detune?: number;
}

function tone(freq: number, o: ToneOpts = {}): void {
  const c = ensure();
  if (!c || !dry || !wet) return;
  const t0 = c.currentTime + (o.delay ?? 0) + 0.005;
  const dur = o.decay ?? 0.3;
  const osc = c.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (o.detune) osc.detune.value = o.detune;
  if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * o.slide), t0 + dur);
  const g = c.createGain();
  const v = o.vol ?? 0.2;
  const a = o.attack ?? 0.004;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(v, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + dur);
  osc.connect(g);
  g.connect(dry);
  if (o.reverb) {
    const s = c.createGain();
    s.gain.value = o.reverb;
    g.connect(s).connect(wet);
  }
  osc.start(t0);
  osc.stop(t0 + a + dur + 0.05);
}

function noise(o: { vol?: number; decay?: number; delay?: number; freq?: number; q?: number; type?: BiquadFilterType; reverb?: number }): void {
  const c = ensure();
  if (!c || !dry || !wet || !noiseBuf) return;
  const t0 = c.currentTime + (o.delay ?? 0) + 0.005;
  const dur = o.decay ?? 0.05;
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = o.type ?? 'bandpass';
  f.frequency.value = o.freq ?? 2000;
  f.Q.value = o.q ?? 1.2;
  const g = c.createGain();
  g.gain.setValueAtTime(o.vol ?? 0.2, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f).connect(g);
  g.connect(dry);
  if (o.reverb) {
    const r = c.createGain();
    r.gain.value = o.reverb;
    g.connect(r).connect(wet);
  }
  s.start(t0);
  s.stop(t0 + dur + 0.05);
}

// Major pentatonic, semitones from the root.
const PENTA = [0, 2, 4, 7, 9];
const ROOT = 392; // G4
function penta(step: number): number {
  const oct = Math.floor(step / 5);
  const semi = PENTA[((step % 5) + 5) % 5] + 12 * oct;
  return ROOT * Math.pow(2, semi / 12);
}

/** A struck wooden/glass bar: fundamental, inharmonic partials, a soft mallet click. */
function bar(freq: number, vol = 0.22, delay = 0, glass = 0.4): void {
  tone(freq, { vol, decay: 0.42, delay, reverb: 0.25 });
  tone(freq * 3.98, { vol: vol * 0.22, decay: 0.07, delay });
  tone(freq * 2, { vol: vol * glass * 0.4, decay: 0.6, delay, reverb: 0.4 });
  noise({ vol: vol * 0.35, decay: 0.018, delay, freq: freq * 5, q: 2 });
}

function bell(freq: number, vol = 0.16, delay = 0): void {
  const partials: [number, number, number][] = [
    [1, 1, 1.2],
    [2.01, 0.55, 0.9],
    [3.02, 0.3, 0.6],
    [4.24, 0.22, 0.4],
    [5.43, 0.14, 0.3],
  ];
  for (const [m, a, d] of partials) tone(freq * m, { vol: vol * a, decay: d, delay, reverb: 0.55, attack: 0.002 });
}

let streak = 0;
let lastOpen = 0;
let lastGem = 0;
let gemStreak = 0;

export const sfx = {
  /** Opening an empty hex; pitch climbs while you keep opening quickly. */
  open(): void {
    const now = performance.now();
    streak = now - lastOpen < 1400 ? Math.min(streak + 1, 11) : 0;
    lastOpen = now;
    bar(penta(streak), 0.2);
  },
  /** Opening in a cascade (chord, lock): one soft note per cell. */
  cascade(i: number): void {
    bar(penta(4 + (i % 8)), 0.12, i * 0.055, 0.6);
  },
  /** A light comes on: a soft warm swell with a little shimmer (pitch climbs in quick runs). */
  gem(): void {
    const now = performance.now();
    gemStreak = now - lastGem < 1600 ? Math.min(gemStreak + 1, 6) : 0;
    lastGem = now;
    const f = penta(5 + gemStreak);
    tone(f, { vol: 0.16, attack: 0.035, decay: 0.55, reverb: 0.5 });
    tone(f * 2, { vol: 0.05, type: 'triangle', attack: 0.05, decay: 0.45, reverb: 0.6 });
    tone(f * 3.01, { vol: 0.025, attack: 0.08, decay: 0.35, delay: 0.03, reverb: 0.7, detune: 6 });
    noise({ vol: 0.025, decay: 0.3, freq: 6500, q: 0.6, reverb: 0.6, delay: 0.02 });
  },
  mistake(): void {
    tone(150, { vol: 0.55, decay: 0.26, slide: 0.42, type: 'sine' });
    tone(97, { vol: 0.18, decay: 0.2, type: 'triangle', slide: 0.7 });
    noise({ vol: 0.3, decay: 0.12, freq: 260, q: 0.7, type: 'lowpass' });
  },
  illegal(): void {
    tone(330, { vol: 0.06, decay: 0.08, type: 'triangle' });
    tone(311, { vol: 0.05, decay: 0.08, type: 'triangle', delay: 0.07 });
  },
  unlock(): void {
    noise({ vol: 0.22, decay: 0.012, freq: 3600, q: 3 });
    noise({ vol: 0.18, decay: 0.016, freq: 2600, q: 3, delay: 0.08 });
    tone(620, { vol: 0.08, decay: 0.16, delay: 0.09, slide: 1.5, reverb: 0.3 });
    bell(penta(12), 0.07, 0.16);
  },
  hint(): void {
    for (let i = 0; i < 6; i++) tone(penta(9 + i) * 1.0, { vol: 0.045, decay: 0.35, delay: i * 0.045, reverb: 0.8, attack: 0.02 });
    noise({ vol: 0.03, decay: 0.4, freq: 8000, q: 0.5, reverb: 0.8 });
  },
  spin(): void {
    noise({ vol: 0.12, decay: 0.014, freq: 3000, q: 4 });
    tone(880, { vol: 0.04, decay: 0.08, slide: 1.25 });
  },
  pin(on: boolean): void {
    tone(on ? 1175 : 880, { vol: 0.05, decay: 0.09, type: 'sine', slide: on ? 1.12 : 0.9 });
  },
  tick(): void {
    tone(1400, { vol: 0.05, decay: 0.03, type: 'triangle' });
  },
  toggle(): void {
    noise({ vol: 0.09, decay: 0.012, freq: 2400, q: 3 });
    tone(740, { vol: 0.05, decay: 0.06 });
  },
  /** Hexes coming out of the fog: a soft airy swell. */
  condense(): void {
    noise({ vol: 0.05, decay: 0.35, freq: 1800, q: 0.6, reverb: 0.7 });
    tone(penta(8), { vol: 0.035, decay: 0.4, attack: 0.08, reverb: 0.8 });
  },
  rotate(): void {
    noise({ vol: 0.09, decay: 0.18, freq: 900, q: 0.8, reverb: 0.3 });
    tone(330, { vol: 0.07, decay: 0.22, slide: 1.5, type: 'triangle' });
    noise({ vol: 0.14, decay: 0.012, freq: 3200, q: 3, delay: 0.2 });
  },
  rewind(): void {
    for (let i = 0; i < 4; i++) tone(penta(9 - i * 2), { vol: 0.06, decay: 0.12, delay: i * 0.07, type: 'triangle' });
  },
  star(i: number): void {
    bell(penta(10 + i * 2), 0.12);
  },
  /** Warm rising arpeggio, then a soft glowing chord. */
  win(): void {
    const seq = [0, 2, 3, 5, 7, 8, 10];
    seq.forEach((s, i) => {
      tone(penta(s), { vol: 0.12, type: 'triangle', attack: 0.012, decay: 0.5, delay: i * 0.085, reverb: 0.45 });
      tone(penta(s) * 2, { vol: 0.03, attack: 0.02, decay: 0.3, delay: i * 0.085, reverb: 0.5 });
    });
    const t = seq.length * 0.085 + 0.04;
    [10, 12, 14].forEach((s, k) => tone(penta(s), { vol: 0.07, attack: 0.09, decay: 1.1, delay: t + k * 0.02, reverb: 0.8 }));
  },
};

/** Haptic feedback (Android; silently ignored elsewhere). */
export function buzz(pattern: number | number[] = 10): void {
  if (!vibrate) return;
  try {
    const n = navigator as Navigator & { userActivation?: { hasBeenActive: boolean } };
    if (n.userActivation && !n.userActivation.hasBeenActive) return;
    n.vibrate?.(pattern);
  } catch {
    /* ignore */
  }
}
