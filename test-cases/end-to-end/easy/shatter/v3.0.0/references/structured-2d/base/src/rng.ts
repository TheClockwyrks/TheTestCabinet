// Shatter — the one seeded generator every random draw runs off.
//
// `specs/instrumentation.md` requires a deterministic core: any randomness the
// game uses runs off a generator seeded from the state's generator field, and
// the generator keeps its WHOLE state in that field, so reseeding and replaying
// the same calls reproduces the same result exactly. That is why this is a set
// of functions over `state.rngState` rather than an object with a hidden
// cursor: the generator IS the declared field (`specs/state.md`), so a snapshot
// of the state is a snapshot of the randomness.
//
// The mixer is mulberry32: one 32-bit word of state, a full period over that
// word, and a good spread from small seeds — which matters here, because
// `DEFAULT_SEED` is 1 and a caller reseeds with small integers.

/** Anything carrying the generator's whole state: the game's own state. */
export interface RandomSource {
  rngState: number;
}

/** Point the generator at `seed`. */
export function seedRandom(source: RandomSource, seed: number): void {
  source.rngState = seed | 0;
}

/** The next draw in `[0, 1)`, advancing the generator. */
export function random(source: RandomSource): number {
  source.rngState = (source.rngState + 0x6d2b79f5) | 0;
  let t = source.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** The next draw in `[min, max)`. */
export function randomRange(
  source: RandomSource,
  min: number,
  max: number,
): number {
  return min + random(source) * (max - min);
}

/** The next whole draw in `[min, max]`, both ends included. */
export function randomInt(
  source: RandomSource,
  min: number,
  max: number,
): number {
  return min + Math.floor(random(source) * (max - min + 1));
}

/** A coin: which edge a saucer enters at, and which way its first weave goes. */
export function randomSign(source: RandomSource): number {
  return random(source) < 0.5 ? -1 : 1;
}
