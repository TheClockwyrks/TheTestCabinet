// Cascade — the game's random source.
//
// The two draws the game makes are the deal's shuffle (`specs/deal.md`) and a
// launched card's horizontal speed and direction (`specs/victory.md`). The source
// is private to this module: nothing outside it knows how a draw is made, and no
// field of `CascadeState` carries it.

/** The next draw in `[0, 1)`. */
export function nextRandom(): number {
  return Math.random();
}

/** A draw in `[lo, hi)`. */
export function nextRange(lo: number, hi: number): number {
  return lo + nextRandom() * (hi - lo);
}

/** A whole draw in `[0, bound)`. */
export function nextBelow(bound: number): number {
  return Math.floor(nextRandom() * bound);
}

/** A coin flip as a sign. */
export function nextSign(): 1 | -1 {
  return nextRandom() < 0.5 ? -1 : 1;
}

/**
 * `items` shuffled uniformly in place.
 *
 * A Fisher-Yates pass from the back: every one of the `n!` orderings is as
 * likely as any other, which is what `specs/deal.md` asks of a new game.
 */
export function shuffleInPlace<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = nextBelow(i + 1);
    const a = items[i] as T;
    items[i] = items[j] as T;
    items[j] = a;
  }
}
