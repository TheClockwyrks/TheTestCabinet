// Carom — the game's seeded random generator.
//
// The only randomness Carom uses is the angle a ball launches on, and
// `specs/instrumentation.md` requires that it run off a SEEDABLE generator so a
// scenario reseeded with `setSeed` and replayed reaches the same state.
//
// The generator's whole state is the one 32-bit integer `CaromState.rngState`,
// and the seed it was last seeded from is `CaromState.seed`. Both are declared
// fields rather than module-level variables: the debug surface's `reset()`
// restores the declared fields, and a generator hidden in a closure would survive
// that reset and desynchronize the replay.

/** The mutable slice of the state this module reads and writes. */
export interface RandomSource {
  /** The seed the generator was last seeded from. */
  seed: number;
  /** The whole state of the generator, as a single number. */
  rngState: number;
}

/**
 * Seed the generator, as `setSeed` does.
 *
 * mulberry32's whole state IS one word, so a seed and the generator's starting
 * state are the same number — which is what `specs/instrumentation.md` means by
 * `rngState` becoming "that generator's starting state".
 */
export function seedRandom(source: RandomSource, seed: number): void {
  source.seed = seed;
  source.rngState = seed;
}

/**
 * The next draw in `[0, 1)`, advancing the generator.
 *
 * mulberry32: one 32-bit word of state, a good enough distribution for an angle,
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

/**
 * The next draw as an angle, uniform over the full circle.
 *
 * This is the whole of a launch's direction (specs/balls.md): every ball leaves
 * its home point on a fresh angle, so the walls and the obstacles rather than a
 * serve rule are what turn a launch into live play.
 */
export function nextAngle(source: RandomSource): number {
  return nextRandom(source) * 2 * Math.PI;
}
