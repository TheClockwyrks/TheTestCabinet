// Fathom — the game's one source of randomness.
//
// Every draw the game makes — predator and drifter wander, the bonus-drifter
// cadence — runs off one of these, and the whole of its state is the single
// integer below, so reseeding and replaying the same calls reproduces the same
// result exactly (`specs/instrumentation.md`).

/**
 * A seedable generator producing values in `[0, 1)`. The algorithm is
 * mulberry32: one 32-bit word of state, advanced by a fixed increment and
 * avalanched into the returned value.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** The next value in `[0, 1)`. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** A whole number in `[0, count)`. `count` is at least 1. */
  int(count: number): number {
    return Math.min(count - 1, Math.floor(this.next() * count));
  }

  /** One item of a non-empty list, drawn uniformly. */
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  /** Restart the sequence from `seed`, discarding everything drawn so far. */
  reseed(seed: number): void {
    this.state = seed >>> 0;
  }
}
