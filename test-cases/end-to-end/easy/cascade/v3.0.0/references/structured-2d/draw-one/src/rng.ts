// Cascade — the game's random source.
//
// Two things in this game are random: the shuffle a new deal is dealt from and
// the horizontal speed a card launches with in the victory cascade
// (specs/deal.md, specs/victory.md). The source is private to this module:
// nothing outside it knows how a draw is made, and no field of `CascadeState`
// carries it.

/** The next draw in `[0, 1)`. */
export function nextRandom(): number {
  return Math.random();
}

/** The given items reordered by Fisher-Yates, as a new array. */
export function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(nextRandom() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
