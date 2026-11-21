// Seedable PRNG (sfc32) + helpers. Deterministic across browsers and Node.

export interface Rng {
  next(): number; // [0,1)
  int(n: number): number; // 0..n-1
  pick<T>(a: readonly T[]): T;
  shuffle<T>(a: T[]): T[];
  chance(p: number): boolean;
}

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function makeRng(seed: number | string): Rng {
  let s = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
  let a = 0x9e3779b9 ^ s, b = 0x243f6a88 ^ (s * 31), c = 0xb7e15162 ^ (s * 17), d = s ^ 0xdeadbeef;
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const r = (t + d) | 0;
    c = (c + r) | 0;
    return (r >>> 0) / 4294967296;
  };
  for (let i = 0; i < 15; i++) next();
  const rng: Rng = {
    next,
    int: (n) => Math.floor(next() * n),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    shuffle: (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    chance: (p) => next() < p,
  };
  return rng;
}
