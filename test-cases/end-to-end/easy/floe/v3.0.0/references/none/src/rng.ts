// Floe — the game's own random source.
//
// Two things are drawn at random (`specs/ice.md`, `specs/water.md`,
// `specs/bays.md`): where each lane's pattern sits along its row when a level is
// laid out, and which open bay each bonus catch appears in. The specification
// fixes the distribution of each draw and nothing about how it is made, so the
// host's own `Math.random` is the source, held behind three small helpers so a
// draw reads the same everywhere it is taken.

/** The next draw in `[0, 1)`. */
export function random(): number {
  return Math.random();
}

/** A whole number in `[0, bound)`, uniform; a bound of `0` or less draws `0`. */
export function randomInt(bound: number): number {
  if (bound <= 0) return 0;
  return Math.floor(random() * bound) % bound;
}

/** One of `items`, each equally likely, or `null` where there are none. */
export function pick<T>(items: readonly T[]): T | null {
  if (items.length === 0) return null;
  return items[randomInt(items.length)];
}
