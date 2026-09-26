// Cascade — the game's one source of randomness.
//
// Two things draw from it and nothing else does: the deal's shuffle
// (`specs/deal.md`) and the victory cascade's launch velocities
// (`specs/victory.md`). The source is private to this module: nothing outside it
// knows how a draw is made, and no field of the game's state carries it.

/** A float in `[0, 1)`, drawn afresh on every call. */
export function nextFloat(): number {
  return Math.random();
}

/**
 * Fisher-Yates in place, drawing each index afresh, so every ordering of the
 * deck is as likely as any other (`specs/deal.md`).
 */
export function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(nextFloat() * (i + 1));
    const swap = items[i];
    items[i] = items[j];
    items[j] = swap;
  }
  return items;
}
