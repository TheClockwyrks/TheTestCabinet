// Spectra — the game's random draws.
//
// `specs/simulation.md` names the places the game draws at random: which
// formation drone a launch takes and the gap before the next launch, the band
// clock a Flux starts its first window at, the scatter of each drone-burst, and
// under Overload the band an escort arrives on. Every draw here runs off the
// host's own generator. Nothing about a draw is part of the game's state, and
// nothing reads one back.

/** The next float in `[0, 1)`. */
export function nextFloat(): number {
  return Math.random();
}

/** A float in `[lo, hi)`. */
export function nextRange(lo: number, hi: number): number {
  return lo + nextFloat() * (hi - lo);
}

/** An integer in `[lo, hi]`, both ends included. */
export function nextInt(lo: number, hi: number): number {
  return lo + Math.floor(nextFloat() * (hi - lo + 1));
}

/** A whole word for a burst's own particle simulation to scatter from. */
export function nextWord(): number {
  return nextInt(1, 0x7fffffff);
}

/** One entry of `items`, drawn uniformly; `undefined` where there are none. */
export function pick<T>(items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[nextInt(0, items.length - 1)];
}
