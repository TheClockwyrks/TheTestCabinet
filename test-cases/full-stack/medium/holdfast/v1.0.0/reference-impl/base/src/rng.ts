// Holdfast — a tiny deterministic PRNG (mulberry32), the same generator the valence
// reference uses. The base map is generated from MODE.mapSeed and combat/threat rolls
// draw from a seeded stream, so the reference map, the proof captures, and the headless
// balance harness (sim/) are all reproducible run to run.
export class RNG {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  // Next float in [0, 1).
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Uniform float in [min, max).
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  // Integer in [0, n) (n outcomes: 0 .. n-1).
  int(n: number): number {
    return Math.floor(this.next() * n) % Math.max(1, n);
  }

  // Integer in [min, maxInclusive].
  between(min: number, maxInclusive: number): number {
    return min + Math.floor(this.next() * (maxInclusive - min + 1));
  }

  // True with probability p (p<=0 → never, p>=1 → always).
  chance(p: number): boolean {
    return this.next() < p;
  }

  // A uniformly-chosen element of a non-empty array.
  pick<T>(items: T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }
}
