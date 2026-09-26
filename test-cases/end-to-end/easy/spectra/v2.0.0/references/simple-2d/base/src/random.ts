// Spectra — the game's random draws (`specs/simulation.md`).
//
// The game draws at random in four places: which formation drone a launch takes
// and the gap before the next launch, the band clock a Flux starts its first
// window at, and the scatter of each drone-burst. This build also draws which
// slots of a wave's block hold which kind, which the specification leaves to it.
// Every draw runs off the host's own generator: nothing about a draw is part of
// `SpectraState`, and nothing reads one back.

/** One draw in `[0, 1)`. */
export function unit(): number {
  return Math.random();
}
