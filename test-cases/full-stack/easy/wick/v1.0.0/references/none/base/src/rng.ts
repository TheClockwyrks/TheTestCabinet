// Wick — the seeded random generator (specs/instrumentation.md "Seeded
// randomness").
//
// One generator, whose whole state is a single 32-bit number the snapshot
// reports as `rngState`, so a scenario that reads the state back can replay
// it. Every random choice the game makes draws from it. The generator works
// over a cell that holds the number, so the state lives in the game's state
// and the generator carries nothing of its own.

/** Where the generator's state lives. */
export interface RngCell {
  rngState: number;
}

/** Reduce any seed to the 32-bit state space. */
export function seedState(seed: number): number {
  return Math.floor(seed) >>> 0 || 0;
}

/**
 * Advance `state` once. Returns the new state and a draw uniform on
 * `[0, 1)`.
 */
export function nextRandom(state: number): { state: number; value: number } {
  const advanced = (state + 0x6d2b79f5) >>> 0;
  let t = advanced;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { state: advanced, value };
}

/** A generator over the state the cell `where` names holds. */
export class Rng {
  constructor(private readonly where: () => RngCell) {}

  /** A draw uniform on `[0, 1)`. */
  next(): number {
    const cell = this.where();
    const { state, value } = nextRandom(cell.rngState);
    cell.rngState = state;
    return value;
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
