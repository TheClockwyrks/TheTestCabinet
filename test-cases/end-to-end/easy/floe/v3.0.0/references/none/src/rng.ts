// Floe — the game's seeded randomness.
//
// `specs/instrumentation.md` asks for a generator whose WHOLE STATE lives in the
// game's own state, so reseeding and replaying the same calls reproduces the same
// result exactly. That rules out `Math.random`, and it rules out a generator with
// a hidden internal buffer: this one is a single 32-bit word, held on the state
// as `rngState` and advanced in place.
//
// Two things are drawn from it (`specs/ice.md`, `specs/water.md`,
// `specs/bays.md`): where each lane's pattern sits along its row when a level is
// laid out, and which open bay each bonus catch appears in.
//
// The generator is mulberry32: one multiply-xorshift round per draw, uniform
// enough for a lane phase and small enough to state in six lines.

/** Anything carrying the generator's whole state. */
export interface Random {
  rngState: number;
}

/** The next draw in `[0, 1)`, advancing the generator in place. */
export function random(source: Random): number {
  source.rngState = (source.rngState + 0x6d2b79f5) >>> 0;
  let t = source.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** A whole number in `[0, bound)`; a bound of `0` or less draws `0`. */
export function randomInt(source: Random, bound: number): number {
  if (bound <= 0) return 0;
  return Math.floor(random(source) * bound) % bound;
}

/** One of `items`, or `null` where there are none. */
export function pick<T>(source: Random, items: readonly T[]): T | null {
  if (items.length === 0) return null;
  return items[randomInt(source, items.length)];
}
