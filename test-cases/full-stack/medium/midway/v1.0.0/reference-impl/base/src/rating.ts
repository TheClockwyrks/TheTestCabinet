// Midway — the reputation loop (specs/flow.md; DESIGN.md §4). Small but load-bearing:
// it closes the feedback loop. The park's rating target is a weighted blend of the
// crowd's average happiness, cleanliness (low litter), and ride variety*reliability; the
// live rating eases toward that target; and the gate's arrival rate is derived from the
// rating. Happy park -> higher rating -> more arrivals -> a bigger park that stays happy
// (and the reverse just as readily). Pure functions over 0..100 scalars.

import { TUNE } from "./constants";

// cleanliness = 100*(1 - avgLitter): a spotless park reads 100, a filthy one 0.
export function cleanlinessFrom(avgLitter: number): number {
  return 100 * (1 - clamp01(avgLitter));
}

// variety by distinct connected ride kinds: 0,1,2,3+ -> the tuned ladder.
export function varietyScore(distinctRideKinds: number): number {
  const ladder = TUNE.rating.varietyLadder;
  return ladder[Math.min(distinctRideKinds, ladder.length - 1)]!;
}

// reliability drops with broken rides: 100 when all rides run, 0 when all are broken; a
// park with no rides yet is treated as reliable (nothing is broken).
export function reliabilityFrom(totalRides: number, brokenRides: number): number {
  if (totalRides <= 0) return 100;
  return 100 * (1 - brokenRides / totalRides);
}

// The rating the park is currently "worth" (specs/flow.md §4 weighting). variety and
// reliability are both 0..100, so their product is normalized back to a 0..100 band.
export function computeRatingTarget(
  avgHappiness: number,
  cleanliness: number,
  variety: number,
  reliability: number,
): number {
  const r = TUNE.rating;
  const target = r.wHappy * avgHappiness + r.wClean * cleanliness + r.wVariety * ((variety * reliability) / 100);
  return Math.max(0, Math.min(100, target));
}

// Ease the live rating toward its target at ~`ease` points per day (dtDays = dt/daySeconds).
export function easeRating(rating: number, target: number, dtDays: number): number {
  const step = TUNE.rating.ease * dtDays;
  if (rating < target) return Math.min(target, rating + step);
  if (rating > target) return Math.max(target, rating - step);
  return rating;
}

// Guests/day drawn to the gate for a given rating: none below the cutoff, then a lerp
// from the low anchor to the high anchor across the rating band (specs/flow.md §4).
export function arrivalRateFor(rating: number): number {
  const r = TUNE.rating;
  if (rating < r.arrivalCutoff) return 0;
  const t = Math.max(0, Math.min(1, (rating - r.ratingLo) / (r.ratingHi - r.ratingLo)));
  return r.arrivalMin + t * (r.arrivalMax - r.arrivalMin);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
