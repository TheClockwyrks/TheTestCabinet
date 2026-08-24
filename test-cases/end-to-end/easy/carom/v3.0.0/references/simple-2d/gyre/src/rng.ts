// Carom — the game's seeded random generator.
//
// The only randomness Carom uses is the vertical direction of a serve, and
// `specs/instrumentation.md` requires that it run off a SEEDABLE generator so a
// scenario reseeded with `reset({ seed })` and replayed reaches the same state.
//
// The generator's whole state is the one 32-bit integer `CaromState.rngState`,
// which is why it is a declared field rather than a module-level variable: the
// debug surface's `reset()` restores the declared fields, and a generator hidden
// in a closure would survive that reset and desynchronize the replay.
//
// A draw is a pure function of that integer: it returns the value drawn AND the
// generator's next state as a pair, and the caller carries the next state
// forward in the state it builds. Nothing here is advanced in place, because
// nothing in this build holds a writable state.

/** What one draw yields: the value, and the generator state to draw from next. */
export type Draw<T> = readonly [value: T, nextState: number];

/**
 * The next draw in `[0, 1)`, with the generator state that follows it.
 *
 * mulberry32: one 32-bit word of state, a good enough distribution for choosing a
 * sign, and — because every step is `Math.imul` and a shift — exactly reproducible
 * in any JavaScript engine, which a seeded replay depends on.
 */
export function nextRandom(rngState: number): Draw<number> {
  const next = (rngState + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/** The next draw as a sign, used to pick which way a serve leaves the center. */
export function nextSign(rngState: number): Draw<1 | -1> {
  const [value, next] = nextRandom(rngState);
  return [value < 0.5 ? -1 : 1, next];
}
