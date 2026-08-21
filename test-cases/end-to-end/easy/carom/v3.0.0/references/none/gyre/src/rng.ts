// Carom — the game's seeded random generator.
//
// The only randomness Carom uses is the vertical direction of a serve, and
// `specs/instrumentation.md` requires that it run off a SEEDABLE generator so a
// scenario reseeded with `reset({ seed })` and replayed reaches the same state.
//
// The generator's whole state is the one 32-bit integer `CaromState.rngState`,
// which is why it is a declared field rather than a module-level variable: the
// debug API's `reset()` restores the declared fields, and a generator hidden in a
// closure would survive that reset and desynchronize the replay.

/** The mutable slice of the state this module reads and writes. */
export interface RandomSource {
  rngState: number;
}

/**
 * The next draw in `[0, 1)`, advancing the generator.
 *
 * mulberry32: one 32-bit word of state, a good enough distribution for choosing a
 * sign, and — because every step is `Math.imul` and a shift — exactly reproducible
 * in any JavaScript engine, which a seeded replay depends on.
 */
export function nextRandom(source: RandomSource): number {
  source.rngState = (source.rngState + 0x6d2b79f5) | 0;
  let t = source.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** The next draw as a sign, used to pick which way a serve leaves the center. */
export function nextSign(source: RandomSource): 1 | -1 {
  return nextRandom(source) < 0.5 ? -1 : 1;
}
