// Kessler — the seeded pseudo-random stream (specs/pods.md).
//
// One mulberry32 generator serves the whole session, and the pod draws are the
// only thing that consumes it, so the same seed and the same play shed the same
// pods in the same order. Nothing else in the build calls `Math.random`.
//
// Because the engine holds the game's state by value, the stream's whole state
// is one number a `KesslerState` carries, stepped by the pure `stepRng` below;
// `mulberry32` wraps the same step as a closure for callers (and tests) that
// want a plain draw-by-draw generator.

/** A generator of numbers in `[0, 1)`; each call consumes one draw. */
export type Rng = () => number;

/** The stream state a seed opens: the seed as an unsigned 32-bit integer. */
export function seedRngState(seed: number): number {
  return seed >>> 0;
}

/** One mulberry32 draw: the value in `[0, 1)` and the state that follows. */
export function stepRng(state: number): { value: number; state: number } {
  const next = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(next ^ (next >>> 15), 1 | next);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: next };
}

/** A mulberry32 generator over `seed`, yielding numbers in `[0, 1)`. */
export function mulberry32(seed: number): Rng {
  let state = seedRngState(seed);
  return () => {
    const step = stepRng(state);
    state = step.state;
    return step.value;
  };
}
