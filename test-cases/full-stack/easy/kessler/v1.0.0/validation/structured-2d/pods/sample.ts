// pods/sample — the bounded sample the shed-chance item decides by.
//
// specs/pods.md states the pod draw as odds: a destruction sheds "one pod with
// probability `0.25`". A probability is decided by sampling the draw, and
// specs/instrumentation.md's `drawPod` performs that one draw alone, so the
// check makes a bounded run of them and reads the shed count against the odds.
//
// THE BAND IS SIX STANDARD DEVIATIONS EACH WAY. A count of successes in `n`
// independent draws at probability `p` is binomial, mean `n p` and standard
// deviation `sqrt(n p (1 - p))`; a conformant build lands outside six of them
// with a probability far below one in a billion. The sample is sized to the
// alternatives the specification makes meaningful, a draw that never sheds, one
// that sheds every time, and one at even odds, each of which lands outside the
// band almost surely, rather than to tell `0.25` from a nearby figure. Both
// figures are the check's own: the odds it compares against are the
// specification's.

/** Draws made to decide the shed chance: 300 at 0.25 gives a band of 30 to 120 pods. */
export const SHED_DRAWS = 300;

/** How many standard deviations each side of the mean the band spans. */
export const BAND_SIGMAS = 6;

/** The count of successes in `n` draws at probability `p` a build may show. */
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
