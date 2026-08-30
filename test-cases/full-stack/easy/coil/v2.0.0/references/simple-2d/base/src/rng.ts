// Coil — the seeded generator every draw the game makes runs off.
//
// The one draw Coil makes is the cell each pellet spawns on, and
// `specs/instrumentation.md` requires that reseeding and replaying the same calls
// reproduce the same sequence exactly. The engine supplies no generator, so this
// is the build's own.
//
// mulberry32, chosen because its whole state is a single 32-bit word: the state
// Coil holds is a VALUE that every frame replaces, so a generator that kept its
// state in an object would have to be copied on every draw. One number lives in
// `CoilState.rngState` and each draw returns the next one beside its result, so
// reseeding is assigning that number and nothing else is carried.

/** One draw: the value it produced, and the generator state that follows it. */
export interface Draw {
  readonly value: number;
  readonly state: number;
}

/** The next draw, uniform in `[0, 1)`, from generator state `state`. */
export function nextRandom(state: number): Draw {
  const advanced = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(advanced ^ (advanced >>> 15), 1 | advanced);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: advanced };
}

/** A whole number in `[0, count)`, drawn uniformly. `count` is at least 1. */
export function drawBelow(
  state: number,
  count: number,
): { readonly index: number; readonly state: number } {
  const draw = nextRandom(state);
  return {
    index: Math.min(count - 1, Math.floor(draw.value * count)),
    state: draw.state,
  };
}

/** The state a seed starts the generator at. */
export function seedState(seed: number): number {
  return seed >>> 0;
}
