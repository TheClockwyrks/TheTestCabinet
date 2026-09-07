// Floe — the game's own random source.
//
// Two things in Floe are drawn at random: where each of the sixteen lanes'
// patterns sits along its row when a level is laid out (`specs/ice.md`,
// `specs/water.md`), and which open bay each bonus catch appears in
// (`specs/bays.md`). The specification fixes the distribution of each draw and
// nothing about how it is made, so the host's own `Math.random` is the source,
// behind two helpers so a draw reads the same everywhere it is taken.

/** The next draw in `[0, 1)`. */
export function nextRandom(): number {
  return Math.random();
}

/** A whole draw in `[0, count)`, each index equally likely. */
export function nextIndex(count: number): number {
  return Math.min(count - 1, Math.floor(nextRandom() * count));
}
