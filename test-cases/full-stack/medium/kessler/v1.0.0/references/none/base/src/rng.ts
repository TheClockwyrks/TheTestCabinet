// Kessler — the seeded pseudo-random stream (specs/pods.md).
//
// One mulberry32 generator serves the whole session, and the pod draws are the
// only thing that consumes it, so the same seed and the same play shed the same
// pods in the same order. Nothing else in the build calls `Math.random`.

/** A generator of numbers in `[0, 1)`; each call consumes one draw. */
export type Rng = () => number;

/** A mulberry32 generator over `seed`, yielding numbers in `[0, 1)`. */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
