// Coil — the seeded generator every draw the game makes runs off.
//
// The one draw Coil makes is the cell each pellet spawns on, and
// `specs/instrumentation.md` requires that reseeding and replaying the same calls
// reproduce the same sequence exactly. So the generator keeps its whole state in
// one number, and reseeding is building a new one: there is nothing else to carry.
//
// mulberry32, chosen because its state is a single 32-bit word and its output is
// uniform enough for picking a cell out of a list. No engine supplies a seeded
// generator, so this is the build's own.

export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** The next draw, uniform in `[0, 1)`. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** A whole number in `[0, count)`, drawn uniformly. `count` is at least 1. */
  below(count: number): number {
    return Math.min(count - 1, Math.floor(this.next() * count));
  }
}
