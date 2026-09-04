// gravity/pull-magnitude — the well's pull follows the inverse-square law.
//
// `specs/gravity.md` fixes the magnitude exactly:
//
//   d    = the distance from the body's centre to (STAR_X, STAR_Y)
//   dEff = max(d, SOFTEN)
//   aMag = MU / (dEff * dEff)
//
// with `MU` 4 500 000, and tabulates 112.5 at `d = 200`, 200 at `d = 150` and
// 312.5 at `d = 120`. Those are the three distances this item samples, every one
// of them outside the softening radius `SOFTEN` (90), so the cap plays no part
// here at all — `gravity/softening-cap` is the item that owns the cap, and this
// one owns the law.
//
// WHY ONE TICK, AND NOT A FLIGHT. `specs/simulation.md` orders a tick as control
// forces, then the gravity acceleration, then velocity, then position. A body
// posed AT REST therefore holds exactly `aMag * TICK_DT` of velocity after one
// tick and nothing besides: no travel worth speaking of, no second sample of the
// law from a place the first tick carried it to, and no tolerance wide enough to
// hide a wrong exponent. The reading is the ACCELERATION the specification fixes
// rather than a path.
//
// WHY THREE DISTANCES AND NOT ONE. One reading fixes one number, and a build
// with `MU / d` or `MU / d^3` or a constant pull can be tuned to pass any single
// distance. Three readings a factor of `1.67` apart in distance are `2.78` apart
// in acceleration under the stated law, `1.67` apart under `MU / d` and `4.63`
// apart under `MU / d^3`, so each wrong exponent misses at least one of the three
// by far more than the item's five percent — and the failure names which distance
// it missed at.
//
// WHY A BULLET. `specs/gravity.md` lists a bullet the ship fired as a pulled
// body, and `specs/instrumentation.md` places one at rest wherever it is asked
// to. Three of them is inside `MAX_BULLETS` (4), so nothing about the gun's
// on-screen limit is in play, and `specs/collision.md` gives a bullet and the
// ship no interaction at all, so the ship standing at the safe point cannot
// touch the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween } from "../assert";
import { DEG, STAR_X, STAR_Y, TICK_DT } from "../constants";
import {
  captureStill,
  createHarness,
  poseBullet,
  requireBullet,
  startPlaying,
  velocityOf,
  type Harness,
} from "../harness";
import {
  add,
  magnitude,
  pullMagnitude,
  scale,
  unitAt,
  type Vec,
} from "../geometry";

/**
 * The three distances `specs/gravity.md` tabulates, each on a bearing of its own.
 *
 * The bearings only keep the three bullets apart on the field and in the still;
 * nothing about the law depends on them, and `gravity/pull-direction` is the item
 * that reads a bearing. Every one of the three is well outside `CORE_R + BULLET_R`
 * (33), so no bullet is anywhere near being absorbed, and well outside `SOFTEN`
 * (90), so every one is read against the uncapped law.
 */
const SAMPLES: readonly { distance: number; bearing: number }[] = [
  { distance: 200, bearing: 210 * DEG },
  { distance: 150, bearing: 330 * DEG },
  { distance: 120, bearing: 90 * DEG },
];

/**
 * The relative tolerance on each reading: five percent, as the review item states.
 *
 * Generous against the arithmetic, which is exact — a body at rest gains
 * `aMag * TICK_DT` and nothing else — and far tighter than the gap between the
 * stated law and any of its neighbours at these distances.
 */
const TOLERANCE = 0.05;

/** A field position exactly `distance` from the star's centre, on `bearing`. */
function pointAt(distance: number, bearing: number): Vec {
  return add({ x: STAR_X, y: STAR_Y }, scale(unitAt(bearing), distance));
}

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("gives a body at rest MU / d^2 x TICK_DT of velocity over one tick", async () => {
  await startPlaying(harness);

  const placed: { distance: number; id: number }[] = [];
  for (const { distance, bearing } of SAMPLES) {
    const at = pointAt(distance, bearing);
    placed.push({
      distance,
      id: await poseBullet(harness, at.x, at.y, 0, 0),
    });
  }

  await harness.advance(1);
  await captureStill(harness, "sample");

  const snapshot = await harness.snapshot();
  for (const { distance, id } of placed) {
    const gained = magnitude(
      velocityOf(
        requireBullet(
          snapshot,
          id,
          `a bullet at rest ${distance} from the star`,
        ),
      ),
    );
    const expected = pullMagnitude(distance) * TICK_DT;
    assertBetween(
      gained,
      expected * (1 - TOLERANCE),
      expected * (1 + TOLERANCE),
      `d = ${distance}: the speed gained over one tick, MU / d^2 x TICK_DT`,
    );
  }
});
