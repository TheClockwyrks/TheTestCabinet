// Wireworm — the seeded generator every draw of randomness runs off.
//
// `specs/instrumentation.md` requires the whole generator state to live in one
// field of the game's state, so reseeding it and replaying the same calls
// reproduces the same result exactly. That rules out a generator object with a
// private field: these are functions over the state itself, and `rngState` is
// the whole of what they read and write.
//
// The algorithm is mulberry32 — one multiply-xor-shift round over a 32-bit
// counter. It is small, fast, and has a period far longer than a run needs.

/** Anything carrying the generator's state; in practice, `WirewormState`. */
export interface RngHolder {
  rngState: number;
}

/** The next float in `[0, 1)`, advancing the generator. */
export function nextFloat(holder: RngHolder): number {
  holder.rngState = (holder.rngState + 0x6d2b79f5) >>> 0;
  let t = holder.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** A float in `[lo, hi)`. */
export function nextRange(holder: RngHolder, lo: number, hi: number): number {
  return lo + nextFloat(holder) * (hi - lo);
}

/** An integer in `[lo, hi]`, both ends included. */
export function nextInt(holder: RngHolder, lo: number, hi: number): number {
  return lo + Math.floor(nextFloat(holder) * (hi - lo + 1));
}

/** True with probability `p`. */
export function nextChance(holder: RngHolder, p: number): boolean {
  return nextFloat(holder) < p;
}
