// pods/sample — the bounded sample the two probability items decide by.
//
// specs/pods.md states the pod draw as odds: a destruction sheds "one pod with
// probability `0.25`", and a shed pod's kind is drawn "with the probabilities"
// of the kind table. A probability is decided by sampling the draw, and
// specs/instrumentation.md's `drawPod` performs that one draw alone, so a
// check makes a bounded run of them and reads the counts against the odds.
//
// THE BAND IS SIX STANDARD DEVIATIONS EACH WAY. A count of successes in `n`
// independent draws at probability `p` is binomial, mean `n p` and standard
// deviation `sqrt(n p (1 - p))`; a conformant build lands outside six of them
// with a probability far below one in a billion, while a build at the wrong
// odds lands outside them almost surely at these sample sizes. Both figures are
// the check's own: the odds it compares against are the specification's.

/** Draws made to decide the shed chance: 8000 at 0.25 gives a band of 0.221 to 0.279. */
export const SHED_DRAWS = 8000;

/**
 * Draws made to decide the kind table: 16000 shed about 4000 pods, enough for
 * every kind's band to exclude its neighbors' probabilities.
 */
export const KIND_DRAWS = 16000;

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
