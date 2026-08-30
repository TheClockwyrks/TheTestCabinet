// Shatter — the seeded generator every random draw runs off.
//
// `specs/simulation.md` requires the generator to keep its WHOLE state in the
// game state's own field, so reseeding and replaying the same calls reproduces
// the same result exactly. That is why every function here takes the holder and
// writes `rngState` back rather than closing over a counter of its own.
//
// The algorithm is mulberry32: one 32-bit word of state, advanced by a fixed
// increment and avalanched into a uniform double in [0, 1).

/** Anything carrying the generator's whole state — the game state, in play. */
export interface RngHolder {
  rngState: number;
}

/** The next uniform draw in `[0, 1)`, advancing the holder's state. */
export function nextFloat(holder: RngHolder): number {
  holder.rngState = (holder.rngState + 0x6d2b79f5) >>> 0;
  let t = holder.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** A uniform draw over `[min, max)`. */
export function nextRange(holder: RngHolder, min: number, max: number): number {
  return min + nextFloat(holder) * (max - min);
}

/** A uniform draw over the whole numbers `[0, count)`. */
export function nextIndex(holder: RngHolder, count: number): number {
  return Math.min(count - 1, Math.floor(nextFloat(holder) * count));
}

/** A uniform draw over the full turn, in radians. */
export function nextAngle(holder: RngHolder): number {
  return nextFloat(holder) * Math.PI * 2;
}

/** `+1` or `-1`, drawn evenly. */
export function nextSign(holder: RngHolder): number {
  return nextFloat(holder) < 0.5 ? -1 : 1;
}
