// Meltdown — the game's one source of randomness.
//
// specs/instrumentation.md requires the whole generator state to live in the
// state's own field, so reseeding and replaying the same calls reproduces the
// same result exactly. `rngState` is that field, and every draw is a pure
// function from it: the caller keeps the state the draw returns.
//
// The vent each unit enters at is the only thing drawn from it
// (specs/waves.md, The release).

/** One draw: a value in `[0, 1)` and the generator state that follows it. */
export interface Draw {
  readonly value: number;
  readonly state: number;
}

/** A mulberry32 step over a 32-bit state. */
export function nextRandom(state: number): Draw {
  const seeded = (state + 0x6d2b79f5) | 0;
  let t = seeded;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return {
    value: ((t ^ (t >>> 14)) >>> 0) / 4294967296,
    state: seeded >>> 0,
  };
}

/** A draw of one of the two vents, each equally likely. */
export function drawVent(state: number): {
  readonly vent: "left" | "top";
  readonly state: number;
} {
  const draw = nextRandom(state);
  return { vent: draw.value < 0.5 ? "left" : "top", state: draw.state };
}
