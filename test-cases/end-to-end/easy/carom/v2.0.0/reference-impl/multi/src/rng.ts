// Carom (Multi-ball) — a tiny seedable pseudo-random generator.
//
// The multi variant launches every ball at a random 360deg angle. The debug and
// automation contract (specs/instrumentation.md) requires that randomness run off a
// seedable generator, so that `reset({ seed })` and the same sequence of calls
// replay identically. This is a mulberry32 generator: fast, deterministic, and good
// enough for launch angles. In normal play it simply advances, so successive matches
// still launch differently.

export class Rng {
  private state: number;

  constructor(seed = 0x9e3779b9) {
    this.state = seed >>> 0;
  }

  // Reseed to make a subsequent sequence reproducible.
  reseed(seed: number): void {
    this.state = seed >>> 0;
  }

  // The next uniform sample in [0, 1).
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
