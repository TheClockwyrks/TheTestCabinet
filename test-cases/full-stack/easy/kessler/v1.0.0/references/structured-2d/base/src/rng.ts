// Kessler — the seeded pseudo-random stream (specs/pods.md).
//
// One mulberry32 generator serves the whole session, and the pod draws are the
// only thing that consumes it, so the same seed and the same play shed the same
// pods in the same order. Nothing else in the build calls `Math.random`.
//
// The generator's WHOLE state is one number, held on the world's game state
// rather than in a closure, so a reseed is an assignment and the live-object
// state contract (`src/game.ts`) keeps holding everything a frame carries.

/** Whatever holds a stream's state between draws. */
export interface RngBox {
  rngState: number;
}

/** The stream state a fresh seed opens with. */
export function seedRng(seed: number): number {
  return seed >>> 0;
}

/**
 * The stream's next value, a number in `[0, 1)`; each call advances the state
 * held in `box` by one mulberry32 step.
 */
export function nextFloat(box: RngBox): number {
  box.rngState = (box.rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(box.rngState ^ (box.rngState >>> 15), 1 | box.rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
