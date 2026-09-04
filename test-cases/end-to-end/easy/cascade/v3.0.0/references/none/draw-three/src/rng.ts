// Cascade — the game's seeded random generator.
//
// specs/instrumentation.md requires that every piece of randomness the game uses
// run off a generator seeded from the state's own field, so a scenario reseeded
// with `reset({ seed })` and replayed reaches the same state. Two things draw
// from it: the deal's shuffle and the cascade's launch velocities.
//
// The generator's whole state is the one 32-bit integer `CascadeState.rngState`,
// which is why it is a declared field rather than a module-level variable: the
// debug surface's `reset()` restores the declared fields, and a generator hidden
// in a closure would survive that reset and desynchronize the replay.

/** The mutable slice of the state this module reads and writes. */
export interface RandomSource {
  rngState: number;
}

/**
 * The next draw in `[0, 1)`, advancing the generator.
 *
 * mulberry32: one 32-bit word of state, a good enough distribution for a shuffle,
 * and — because every step is `Math.imul` and a shift — exactly reproducible in
 * any JavaScript engine, which a seeded replay depends on.
 */
export function nextRandom(source: RandomSource): number {
  source.rngState = (source.rngState + 0x6d2b79f5) | 0;
  let t = source.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** The next draw scaled into `[min, max)`. */
export function nextBetween(
  source: RandomSource,
  min: number,
  max: number,
): number {
  return min + nextRandom(source) * (max - min);
}

/** The next draw as a sign, with the two outcomes equally likely. */
export function nextSign(source: RandomSource): 1 | -1 {
  return nextRandom(source) < 0.5 ? -1 : 1;
}

/**
 * Fisher-Yates, in place, drawing each index from the generator.
 *
 * Uniform over every ordering of the array, which is what specs/deal.md asks of
 * the shuffle a new game deals from.
 */
export function shuffle<T>(items: T[], source: RandomSource): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(nextRandom(source) * (i + 1));
    const held = items[i];
    items[i] = items[j];
    items[j] = held;
  }
  return items;
}
