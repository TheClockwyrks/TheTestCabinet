// Meltdown — surge/sample: the bounded sample the vent-odds item decides by.
// GROUP-LOCAL.
//
// `specs/waves.md` states the vent draw as odds: "the two vents equally likely".
// A probability is decided by sampling the draw, and `drawVent` on the surface
// of `specs/instrumentation.md` "performs one vent draw exactly as the release
// performs it" and nothing else, so a check makes a bounded run of them and reads
// the count of one vent against the odds.
//
// THE BAND IS SIX STANDARD DEVIATIONS EACH WAY. A count of one outcome in `n`
// independent draws at probability `p` is binomial, mean `n p` and standard
// deviation `sqrt(n p (1 - p))`; a conformant build lands outside six of them
// with a probability far below one in a billion, while a build at the wrong odds
// lands outside them almost surely at this sample size. The width is the
// check's own; the odds it compares against are the specification's.

/**
 * Draws made to decide the vent odds: 4000 at 0.5 gives a band of 1810 to 2190
 * for either vent, which a draw at 0.4 or 0.6 misses by more than six of its own
 * standard deviations.
 */
export const VENT_DRAWS = 4000;

/** How many standard deviations each side of the mean the band spans. */
export const BAND_SIGMAS = 6;

/** The count of one outcome in `n` draws at probability `p` a build may show. */
export function binomialBand(
  n: number,
  p: number,
): { low: number; high: number } {
  const mean = n * p;
  const sigma = Math.sqrt(n * p * (1 - p));
  return {
    low: Math.floor(mean - BAND_SIGMAS * sigma),
    high: Math.ceil(mean + BAND_SIGMAS * sigma),
  };
}
