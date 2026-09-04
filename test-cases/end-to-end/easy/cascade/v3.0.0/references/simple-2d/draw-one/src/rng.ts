// Cascade — the seeded random generator.
//
// specs/instrumentation.md requires that every draw the game makes runs off a
// generator seeded from a single field of the state and keeps its whole
// generator state in that field, so reseeding and replaying the same calls
// reproduces the same result. That rules out a closure holding a counter: the
// state is a value the engine replaces every frame, so the generator's position
// travels with it, and every function here is pure — a state in, a value and the
// next state out.
//
// The generator is mulberry32: one 32-bit word of state, a full period, and a
// distribution good enough for a shuffle and a launch velocity.

/** A draw: the value, and the generator state to continue from. */
export type Draw<T> = readonly [value: T, state: number];

/**
 * The next float in `[0, 1)`, and the generator state after it.
 */
export function nextFloat(state: number): Draw<number> {
  const next = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(next ^ (next >>> 15), 1 | next);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/** The next whole number in `[0, bound)`, and the generator state after it. */
export function nextInt(state: number, bound: number): Draw<number> {
  const [value, next] = nextFloat(state);
  return [Math.floor(value * bound), next];
}

/** The next float in `[min, max)`, and the generator state after it. */
export function nextRange(
  state: number,
  min: number,
  max: number,
): Draw<number> {
  const [value, next] = nextFloat(state);
  return [min + value * (max - min), next];
}

/** `-1` or `1` with equal probability, and the generator state after it. */
export function nextSign(state: number): Draw<number> {
  const [value, next] = nextFloat(state);
  return [value < 0.5 ? -1 : 1, next];
}

/**
 * A uniformly shuffled copy of `items`, and the generator state after it.
 *
 * Fisher-Yates from the last index down, so every ordering is equally likely.
 */
export function shuffle<T>(
  items: readonly T[],
  state: number,
): Draw<readonly T[]> {
  const out = [...items];
  let rng = state;
  for (let i = out.length - 1; i > 0; i--) {
    const [j, next] = nextInt(rng, i + 1);
    rng = next;
    const swap = out[i];
    out[i] = out[j];
    out[j] = swap;
  }
  return [out, rng];
}
