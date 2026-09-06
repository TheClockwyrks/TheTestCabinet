// Arc Foundry — a small generator for the wave composer.
//
// A stream whose whole state is one 32-bit number. The wave composer (`src/waves.ts`)
// keys one by the wave's number, so a wave plays the same each time it is reached while
// still varying wave to wave. The press's rolls and the crit roll draw at random on
// their own (`src/sim.ts`).
//
// A stream is a plain record rather than an object with behavior, so a caller either
// keeps one for the length of a computation — a wave's composition — or lifts one out
// of the world, draws, and writes the advanced state back.

/** A generator, held as the one number that is its whole state. */
export interface RngStream {
  state: number;
}

/** A stream from a seed. Any number seeds it; only its low 32 bits are used. */
export function stream(seed: number): RngStream {
  return { state: seed >>> 0 };
}

/** The next value in `[0, 1)`, advancing the stream. */
export function next(rng: RngStream): number {
  rng.state = (rng.state + 0x6d2b79f5) >>> 0;
  let t = rng.state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** The next value in `[min, max)`. */
export function range(rng: RngStream, min: number, max: number): number {
  return min + (max - min) * next(rng);
}

/** The next whole number in `min..maxInclusive`. */
export function int(rng: RngStream, min: number, maxInclusive: number): number {
  return Math.floor(range(rng, min, maxInclusive + 1));
}
