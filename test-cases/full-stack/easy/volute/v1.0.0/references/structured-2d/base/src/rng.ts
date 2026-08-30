// Volute — the game's one seeded generator (specs/instrumentation.md).
//
// EVERY random draw the game makes comes from here: the charges of the cores a
// level opens with, the charge of each emitted core, and the charges the
// injector loads and queues. The whole of the generator's state is a single
// 32-bit number held on the game instance — the one framework object that
// outlives a level transition — so a snapshot reports it, a `reset` sets it from
// the seed it is given, and the same seed with the same calls reaches the same
// state every time.
//
// The algorithm is mulberry32: one word of state, a good enough distribution for
// picking one of five charges, and — the property that matters here — nothing
// hidden outside the word.

/** A drawn value and the generator state that follows it. */
export interface Draw<T> {
  readonly value: T;
  readonly state: number;
}

/** Fold any number into the unsigned 32-bit word the generator carries. */
export function seedState(seed: number): number {
  return Number.isFinite(seed) ? seed >>> 0 : 0;
}

/** The next value in `[0, 1)`, and the state that follows it. */
export function nextFloat(state: number): Draw<number> {
  const a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: a >>> 0 };
}

/** The next whole number in `[0, bound)`, and the state that follows it. */
export function nextInt(state: number, bound: number): Draw<number> {
  if (bound <= 1) return { value: 0, state };
  const drawn = nextFloat(state);
  return {
    value: Math.min(bound - 1, Math.floor(drawn.value * bound)),
    state: drawn.state,
  };
}

/**
 * One member of `choices`, uniformly, and the state that follows it.
 *
 * An empty list is not a legal draw — every caller in this game holds at least
 * one charge — so it throws rather than inventing a value.
 */
export function pick<T>(state: number, choices: readonly T[]): Draw<T> {
  if (choices.length === 0) {
    throw new RangeError("Volute: cannot draw from an empty set");
  }
  const drawn = nextInt(state, choices.length);
  return { value: choices[drawn.value], state: drawn.state };
}
