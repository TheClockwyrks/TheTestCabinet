// Fathom — the seeded generator every random draw the game makes runs off.
//
// `specs/instrumentation.md` asks for one generator whose whole state the game
// keeps, so reseeding and replaying the same calls reproduces the same result
// exactly. This is mulberry32: one 32-bit word of state, which is the whole of
// it, and a `reseed` that puts a run back where it started.

export class Rng {
  private state = 0;

  constructor(seed: number) {
    this.reseed(seed);
  }

  /** Restarts the sequence from `seed`, discarding everything drawn so far. */
  reseed(seed: number): void {
    this.state = seed >>> 0;
  }

  /** The next draw, in `[0, 1)`. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** A whole number in `[0, bound)`. `bound` is at least `1`. */
  int(bound: number): number {
    return Math.floor(this.next() * bound);
  }

  /** One of `items`, drawn uniformly. `items` is not empty. */
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }
}
