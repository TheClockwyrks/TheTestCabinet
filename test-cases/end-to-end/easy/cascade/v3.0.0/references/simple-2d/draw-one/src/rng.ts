// Cascade — the game's random source.
//
// Two draws are made in this game: the shuffle a new deal is dealt from
// (specs/deal.md) and a launched card's horizontal speed and direction
// (specs/victory.md). The source is private to this module: nothing outside it
// knows how a draw is made, and no field of the state carries it, so every
// function here is a plain draw with no state in and none out.

/** The next float in `[0, 1)`. */
export function nextFloat(): number {
  return Math.random();
}

/** The next whole number in `[0, bound)`. */
export function nextInt(bound: number): number {
  return Math.floor(nextFloat() * bound);
}

/** The next float in `[min, max)`. */
export function nextRange(min: number, max: number): number {
  return min + nextFloat() * (max - min);
}

/** `-1` or `1` with equal probability. */
export function nextSign(): number {
  return nextFloat() < 0.5 ? -1 : 1;
}

/**
 * A uniformly shuffled copy of `items`.
 *
 * Fisher-Yates from the last index down, so every ordering is equally likely.
 */
export function shuffle<T>(items: readonly T[]): readonly T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = nextInt(i + 1);
    const swap = out[i];
    out[i] = out[j];
    out[j] = swap;
  }
  return out;
}
