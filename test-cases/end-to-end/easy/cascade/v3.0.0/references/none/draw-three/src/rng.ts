// Cascade — the game's random source.
//
// Two things draw from it: the deal's shuffle (specs/deal.md) and the cascade's
// launch velocities (specs/victory.md). The source is private to this module:
// nothing outside it knows how a draw is made, and no field of the game's state
// carries it.

/** The next draw in `[0, 1)`. */
export function nextRandom(): number {
  return Math.random();
}

/** The next draw scaled into `[min, max)`. */
export function nextBetween(min: number, max: number): number {
  return min + nextRandom() * (max - min);
}

/** The next draw as a sign, with the two outcomes equally likely. */
export function nextSign(): 1 | -1 {
  return nextRandom() < 0.5 ? -1 : 1;
}

/**
 * Fisher-Yates, in place, drawing each index afresh.
 *
 * Uniform over every ordering of the array, which is what specs/deal.md asks of
 * the shuffle a new game deals from.
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
