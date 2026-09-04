// Spectra — the one seeded generator every random choice runs off.
//
// `specs/simulation.md` requires that the wave's layout, the choice of which
// drone dives next, the gap before the next dive, a Flux's starting phase and the
// scatter of each drone-burst all come from ONE generator whose whole state lives
// in the game's state. That is why this is a pair of free functions over a number
// rather than a closure: the state carries `rngState`, and every draw both reads
// it and writes it back, so `reset({ seed })` and a replay of the same calls
// reproduce a run exactly.
//
// The algorithm is mulberry32: one 32-bit word of state, a good enough
// distribution for a game, and identical arithmetic on every engine.

/** A generator's whole state: one unsigned 32-bit word. */
export type RngState = number;

/** The state a seed arms. */
export function seedRng(seed: number): RngState {
  return seed >>> 0;
}

/** One draw in `[0, 1)`, and the state that follows it. */
export function nextUnit(state: RngState): { value: number; state: RngState } {
  const s = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: s >>> 0 };
}

/**
 * A tiny cursor over one generator state, for a caller that needs several draws
 * in a row.
 *
 * `state` is public and is what the caller writes back into the game's state
 * when it is done, so no draw is ever lost.
 */
export class Rng {
  constructor(public state: RngState) {}

  /** A draw in `[0, 1)`. */
  unit(): number {
    const next = nextUnit(this.state);
    this.state = next.state;
    return next.value;
  }

  /** A draw in `[low, high)`. */
  range(low: number, high: number): number {
    return low + this.unit() * (high - low);
  }

  /** A whole draw in `[0, count)`; `count` of `0` or less yields `0`. */
  index(count: number): number {
    if (count <= 0) return 0;
    return Math.min(count - 1, Math.floor(this.unit() * count));
  }

  /** A 32-bit word, which is what a burst's own simulation is seeded from. */
  word(): number {
    return Math.floor(this.unit() * 0x100000000) >>> 0;
  }
}
