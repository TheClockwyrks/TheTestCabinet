// Carom — the game's seeded random generator.
//
// The only randomness Carom uses is the vertical direction of a serve, and
// specs/instrumentation.md requires that it run off a SEEDABLE generator so a
// scenario reseeded with `setSeed` and replayed reaches the same state.
//
// The generator's whole state is the one 32-bit integer `CaromState.rngState`,
// which is why it is a declared field rather than a module-level variable: the
// debug surface's `reset` restores the declared fields, and a generator hidden in
// a closure would survive that reset and desynchronize the replay. `seed` records
// what it was last seeded from, which is the value `setSeed` was given.
//
// A draw is a function of that integer alone and returns the value drawn BESIDE
// the generator's next state, `[value, next]`. The caller stores `next` where the
// old state was; nothing here holds or advances anything of its own.

/** The generator's starting state for a seed: the seed as one 32-bit word. */
export function seedState(seed: number): number {
  return seed | 0;
}

/**
 * The next draw in `[0, 1)`, and the generator state that follows `state`.
 *
 * mulberry32: one 32-bit word of state, a good enough distribution for choosing a
 * sign, and — because every step is `Math.imul` and a shift — exactly reproducible
 * in any JavaScript engine, which a seeded replay depends on.
 */
export function nextRandom(state: number): readonly [number, number] {
  const next = (state + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/** The next draw as a sign, used to pick which way a serve leaves the center. */
export function nextSign(state: number): readonly [1 | -1, number] {
  const [value, next] = nextRandom(state);
  return [value < 0.5 ? -1 : 1, next];
}
