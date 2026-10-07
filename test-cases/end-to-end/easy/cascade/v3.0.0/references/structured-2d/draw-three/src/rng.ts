// Cascade — the game's random source.
//
// Two things draw from it: the deal's shuffle (`specs/deal.md`) and a launched
// card's horizontal velocity (`specs/victory.md`). The source is private to this
// module: nothing outside it knows how a draw is made, and no field of the game's
// state carries it.

/** The next draw, uniform in `[0, 1)`. */
export function nextRandom(): number {
  return Math.random();
}

/** A draw uniform in `[min, max)`. */
export function nextRange(min: number, max: number): number {
  return min + nextRandom() * (max - min);
}

/** A draw of `-1` or `1`, each with equal probability. */
export function nextSign(): number {
  return nextRandom() < 0.5 ? -1 : 1;
}

/**
 * A uniform shuffle in place: Fisher-Yates from the last entry down, so every
 * ordering of the entries is as likely as any other.
 */
export function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(nextRandom() * (i + 1));
    const held = items[i];
    items[i] = items[j];
    items[j] = held;
  }
  return items;
}
