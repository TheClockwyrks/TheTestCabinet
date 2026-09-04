// Cascade — the seeded generator.
//
// `specs/instrumentation.md` requires that the whole of the game's randomness
// run off one generator seeded from the state's own field, and that the
// generator keep its ENTIRE state in that field, so reseeding and replaying the
// same calls reproduces the same result exactly. Two things draw from it: the
// deal's shuffle (`specs/deal.md`) and a launched card's horizontal velocity
// (`specs/victory.md`).
//
// The generator is mulberry32: one 32-bit word of state, advanced by the same
// arithmetic every draw. `rngState` is that word, so a caller that writes the
// field has reseeded the generator completely and nothing else carries a bit of
// randomness between draws.

/** The carrier of the generator's whole state: the game's own state object. */
export interface Random {
  rngState: number;
}

/** The next draw, uniform in `[0, 1)`, advancing the state in place. */
export function nextRandom(source: Random): number {
  source.rngState = (source.rngState + 0x6d2b79f5) | 0;
  let t = source.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** A draw uniform in `[min, max)`. */
export function nextRange(source: Random, min: number, max: number): number {
  return min + nextRandom(source) * (max - min);
}

/** A draw of `-1` or `1`, each with equal probability. */
export function nextSign(source: Random): number {
  return nextRandom(source) < 0.5 ? -1 : 1;
}

/**
 * A uniform shuffle in place: Fisher-Yates from the last entry down, so every
 * ordering of the entries is as likely as any other.
 */
export function shuffle<T>(source: Random, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(nextRandom(source) * (i + 1));
    const held = items[i];
    items[i] = items[j];
    items[j] = held;
  }
  return items;
}
