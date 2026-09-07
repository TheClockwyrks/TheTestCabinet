// Fathom — the game's source of random draws.
//
// Every draw the game makes — a predator's or a drifter's choice at a junction —
// comes through one of these, so the code that draws names what it draws from
// and holds nothing of its own.

export class Rng {
  /**
   * Draws over `source`, which is `Math.random` unless a caller hands it
   * something else that returns values in `[0, 1)`.
   */
  constructor(private readonly source: () => number = Math.random) {}

  /** The next draw, in `[0, 1)`. */
  next(): number {
    return this.source();
  }

  /** A whole number in `[0, count)`. `count` is at least `1`. */
  int(count: number): number {
    return Math.min(count - 1, Math.floor(this.next() * count));
  }

  /** One of `items`, drawn uniformly. `items` is not empty. */
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }
}
