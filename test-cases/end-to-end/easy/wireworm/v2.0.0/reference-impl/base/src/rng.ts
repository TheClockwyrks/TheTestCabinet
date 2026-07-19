// A small, fast, seedable pseudo-random generator (mulberry32). Every source of
// randomness the simulation uses — the starting node scatter, the side the worm
// enters from, and when/where the foes spawn and dart — draws from one instance of
// this, so reseeding it (via the debug API's reset({ seed })) and replaying the
// same calls reproduces the same game exactly. Rendering jitter and audio noise
// are cosmetic and intentionally left on Math.random; they never touch game state.

export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  // Reseed the generator, restarting its stream.
  seed(seed: number): void {
    this.s = seed >>> 0;
  }

  // The next float in [0, 1).
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // A float in [lo, hi).
  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  // An integer in [lo, hi] (inclusive).
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  // True with probability p.
  chance(p: number): boolean {
    return this.next() < p;
  }
}

// A fresh, unpredictable seed for ordinary play (a new scatter each run).
export function randomSeed(): number {
  return (Math.random() * 0x100000000) >>> 0;
}
