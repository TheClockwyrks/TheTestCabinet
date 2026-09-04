// Spectra — the game's one seeded generator (`specs/simulation.md`).
//
// Every random choice the game makes runs off this generator, and its WHOLE
// state is the single number `rngState` in the game's state. Nothing here holds
// a value between calls, so reseeding and replaying the same calls reproduces
// the same result exactly, which is what `specs/instrumentation.md` requires of
// the deterministic core.
//
// The generator is a 32-bit xorshift. It is not cryptography and does not need
// to be: what it needs is to be reproducible from one number, and to be the same
// sequence in a browser and in a test.

/** The state a run seeded with `seed` starts from. Never zero. */
export function seedState(seed: number): number {
  // A whole 32-bit value, folded so that any seed — including 0 — lands on a
  // usable state, since xorshift is stuck at zero.
  const folded = (Math.trunc(seed) ^ 0x9e3779b9) >>> 0;
  return folded === 0 ? 0x6d2b79f5 : folded;
}

/** The state after one draw. */
export function nextState(state: number): number {
  let x = state >>> 0;
  x ^= x << 13;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;
  x >>>= 0;
  return x === 0 ? 0x6d2b79f5 : x;
}

/** The `[0, 1)` value a state carries. */
export function unit(state: number): number {
  return (state >>> 0) / 0x100000000;
}
