// Fathom — the game's source of random draws.
//
// Every draw the game makes — a predator's or a drifter's choice at a junction,
// and the maze it lays out — is taken through a `Draws` cursor, so the code that
// draws names what it draws from and holds nothing of its own. A cursor is opened
// for the length of ONE transition and handed round inside it; nothing about it
// is carried in `FathomState`, because a draw is not a value the game keeps from
// one frame to the next.

/** A cursor over the game's random source, for a transition that draws. */
export interface Draws {
  /** The next draw in `[0, 1)`. */
  next(): number;
  /** One of `items`, drawn uniformly. `items` is non-empty. */
  pick<T>(items: readonly T[]): T;
}

/**
 * A {@link Draws} cursor over `source`, which is `Math.random` unless a caller
 * hands it something else that returns values in `[0, 1)`.
 */
export function createDraws(source: () => number = Math.random): Draws {
  return {
    next(): number {
      return source();
    },
    pick<T>(items: readonly T[]): T {
      const index = Math.floor(this.next() * items.length);
      // `next` is strictly below 1, so the index is in range; the clamp is for
      // the one case a floating-point product could reach the length exactly.
      return items[Math.min(index, items.length - 1)];
    },
  };
}
