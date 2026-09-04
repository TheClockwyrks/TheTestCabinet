// Meltdown — the seeded generator.
//
// The whole of the game's randomness is the vent each released unit enters at
// (specs/waves.md, The release), and it runs off one number held in the state's
// `rngState`, so reseeding and replaying the same calls reproduces the same
// sequence exactly (specs/instrumentation.md, A deterministic core).
//
// The generator is a 32-bit linear congruential one — Numerical Recipes'
// multiplier and increment — chosen because its whole state IS one number, so
// the state field the specification declares holds it with nothing left over.

const MULTIPLIER = 1664525;
const INCREMENT = 1013904223;
const MODULUS = 2 ** 32;

/** The generator's next state, from the one it is in. */
export function nextState(state: number): number {
  return (Math.imul(state >>> 0, MULTIPLIER) + INCREMENT) >>> 0;
}

/** The value a state carries, in `[0, 1)`. */
export function unitValue(state: number): number {
  return (state >>> 0) / MODULUS;
}
