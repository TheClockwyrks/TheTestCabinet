// Deepcore — the game's private random source.
//
// The mine is generated fresh for each expedition (specs/world.md), and the small
// jitters that keep the world alive (particle offsets) draw from the same source. It
// is a tiny 32-bit mixing generator: fast, well-distributed enough for scattering
// rock, and laid from the page's own randomness unless a caller lays it itself,
// which the unit tests do to pin a layout.

/** A fresh 32-bit state word off the page's own randomness. */
export function randomState(): number {
  return Math.floor(Math.random() * 0x1_0000_0000) >>> 0;
}

export class Rng {
  private state: number;

  constructor(state: number = randomState()) {
    this.state = state >>> 0;
  }

  /** A float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** A float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** An integer in [min, maxInclusive]. */
  int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Uniformly pick one item. */
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** Weighted pick: `items[i]` chosen with probability `weights[i] / sum(weights)`. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i]!;
      if (r <= 0) return items[i]!;
    }
    return items[items.length - 1]!;
  }
}
