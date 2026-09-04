// Cascade — the game's one source of randomness.
//
// `specs/instrumentation.md` requires that the whole generator state live in a
// field of the game's state, so reseeding and replaying the same calls
// reproduces the same result exactly. That rules out a closure holding a
// private counter: the generator here is a pure step over one 32-bit number,
// and the caller hands it the object that owns that number.
//
// Two things draw from it and nothing else does: the deal's shuffle
// (`specs/deal.md`) and the victory cascade's launch velocities
// (`specs/victory.md`).

/** Anything carrying the generator's whole state. */
export interface RngState {
  /** The generator's 32-bit state, advanced by every draw. */
  rngState: number;
}

/**
 * mulberry32: a small, fast, seedable generator. Seeding it with a fixed number
 * and replaying the same draws reproduces the same sequence exactly.
 *
 * Advances `holder.rngState` and returns a float in `[0, 1)`.
 */
export function nextFloat(holder: RngState): number {
  const a = (holder.rngState + 0x6d2b79f5) | 0;
  holder.rngState = a;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** A seed as the generator holds it: a 32-bit unsigned number. */
export function toSeed(seed: number): number {
  return Number.isFinite(seed) ? seed >>> 0 : 0;
}

/**
 * Fisher-Yates in place, drawing each index from the supplied generator, so
 * every ordering of the deck is as likely as any other (`specs/deal.md`).
 */
export function shuffle<T>(items: T[], holder: RngState): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(nextFloat(holder) * (i + 1));
    const swap = items[i];
    items[i] = items[j];
    items[j] = swap;
  }
  return items;
}
