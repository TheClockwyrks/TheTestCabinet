// Wick — the game's private random source.
//
// Every random choice the game makes, where the debug surface has posed no
// outcome for it, draws from here. Nothing about the source is declared
// state: a scenario that needs a particular outcome poses it through the
// surface's Drawn outcomes operations rather than steering the draws.

/** A source of draws uniform on `[0, 1)`; `Math.random` unless one is given. */
export type Source = () => number;

/** The draws the game makes over a source. */
export class Rng {
  constructor(private readonly source: Source = Math.random) {}

  /** A draw uniform on `[0, 1)`. */
  next(): number {
    return this.source();
  }

  /** A whole number uniform on `[0, n)`. */
  index(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** One element of `items`, uniformly. */
  pick<T>(items: readonly T[]): T {
    return items[this.index(items.length)];
  }

  /**
   * `count` distinct elements of `items`, drawn uniformly without
   * replacement, in the order they were drawn. All of them when `items` is
   * smaller than `count`.
   */
  sample<T>(items: readonly T[], count: number): T[] {
    const pool = items.slice();
    const drawn: T[] = [];
    const wanted = Math.min(count, pool.length);
    for (let i = 0; i < wanted; i += 1) {
      const j = i + this.index(pool.length - i);
      const item = pool[j];
      pool[j] = pool[i];
      pool[i] = item;
      drawn.push(item);
    }
    return drawn;
  }
}
