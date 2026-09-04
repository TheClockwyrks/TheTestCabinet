// Shatter — the seeded generator every draw the simulation makes comes from.
//
// `specs/simulation.md` fixes two things about it: every listed draw runs off a
// generator seeded from the STATE's generator field, and the generator keeps its
// WHOLE state in that field. The second is what makes a replay exact — there is
// no hidden word of state anywhere, so reseeding and repeating the same calls
// reaches the same result — and it is why every function here takes the holder
// and writes back to it rather than closing over a module-level variable.
//
// mulberry32: one 32-bit word of state, a handful of multiplies, and a stream
// ample for a rock's spawn position, a saucer's row, and a shot's aim error.
//
// Randomness that never touches the simulation does not belong here. The thrust
// flame's flicker is drawn from the simulation clock instead, so nothing the
// renderer does can move the generator and change where the next wave lands.

/** Anything carrying the generator's whole state. The game's state is one. */
export interface RandomSource {
  /** The generator's entire state, as one 32-bit word. */
  rng: number;
}

/**
 * Seed the generator.
 *
 * A zero seed is nudged to `1`, because mulberry32's stream from a zero word is
 * the one degenerate case in its range.
 */
export function seed(source: RandomSource, value: number): void {
  source.rng = value >>> 0 || 1;
}

/** The next float in `[0, 1)`, advancing the generator. */
export function random(source: RandomSource): number {
  source.rng = (source.rng + 0x6d2b79f5) | 0;
  let t = Math.imul(source.rng ^ (source.rng >>> 15), 1 | source.rng);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** A float drawn uniformly from `[min, max)`. */
export function range(source: RandomSource, min: number, max: number): number {
  return min + random(source) * (max - min);
}

/** A whole number drawn uniformly from `[min, max]`, both ends included. */
export function rangeInt(
  source: RandomSource,
  min: number,
  max: number,
): number {
  return Math.floor(range(source, min, max + 1));
}

/** `-1` or `+1`, each half the time. */
export function sign(source: RandomSource): number {
  return random(source) < 0.5 ? -1 : 1;
}
