// Spectra — the game's random draws.
//
// `specs/simulation.md` names the places the game draws at random: which
// formation drone a launch takes and the gap before the next launch, the band
// clock a Flux starts its first window at, and the scatter of each drone-burst.
// Every draw here runs off the host's own generator. Nothing about a draw is part
// of the game's state, and nothing reads one back.

/** A draw in `[0, 1)`. */
export function unit(): number {
  return Math.random();
}

/** A draw in `[low, high)`. */
export function range(low: number, high: number): number {
  return low + unit() * (high - low);
}

/** A whole draw in `[0, count)`; `count` of `0` or less yields `0`. */
export function index(count: number): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.floor(unit() * count));
}

/** A 32-bit word, which is what a burst's own particle simulation scatters from. */
export function word(): number {
  return Math.floor(unit() * 0x100000000) >>> 0;
}
