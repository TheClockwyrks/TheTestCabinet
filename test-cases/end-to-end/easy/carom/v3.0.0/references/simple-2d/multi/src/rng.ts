// Carom — the game's seeded random generator.
//
// The only randomness Carom uses is the angle a ball launches on, and
// `specs/instrumentation.md` requires that it run off a SEEDABLE generator so a
// scenario reseeded with `reset({ seed })` and replayed reaches the same state.
//
// The generator's whole state is the one 32-bit integer `CaromState.rngState`,
// which is why it is a declared field rather than a module-level variable: the
// debug API's `reset()` restores the declared fields, and a generator hidden in a
// closure would survive that reset and desynchronize the replay.
//
// Because the state is a value, a draw is a function of the generator's state
// that returns the draw AND the generator's next state, as a pair. The caller
// threads the second element into the state it builds, the same way `update`
// threads every other field, and a draw that is never threaded is a draw that
// never happened.

/** A draw: the value drawn, and the generator state the next draw starts from. */
export type Draw = readonly [value: number, nextRngState: number];

/**
 * The next draw in `[0, 1)`, and the state after it.
 *
 * mulberry32: one 32-bit word of state, a good enough distribution for an angle,
 * and — because every step is `Math.imul` and a shift — exactly reproducible in
 * any JavaScript engine, which a seeded replay depends on.
 */
export function nextRandom(rngState: number): Draw {
  const next = (rngState + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/**
 * The next draw as an angle, uniform over the full circle, and the state after
 * it.
 *
 * This is the whole of a launch's direction (specs/balls.md): every ball leaves
 * its home point on a fresh angle, so the walls and the obstacles rather than a
 * serve rule are what turn a launch into live play.
 */
export function nextAngle(rngState: number): Draw {
  const [value, next] = nextRandom(rngState);
  return [value * 2 * Math.PI, next];
}
