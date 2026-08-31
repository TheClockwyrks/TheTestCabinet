// gravity/softening-cap — inside the softening radius the pull stops growing.
//
// `specs/gravity.md` softens the law rather than letting it run away at the core:
// `dEff = max(d, SOFTEN)` with `SOFTEN` 90, so "inside `SOFTEN` the magnitude is
// capped at `MU / (SOFTEN * SOFTEN)`, and a body approaching the core is pulled
// no harder than a body at `d = 90`". The spec's own table gives that cap as
// 555.6, which is 4.63 units per second over one tick of the `TICK_HZ` (120)
// clock.
//
// THE POSE IS THE WHOLE ITEM. A bullet is posed at rest 60 units from the star's
// centre — well inside `SOFTEN`, and well outside `CORE_R + BULLET_R` (33), so it
// is neither absorbed nor carried anywhere in the one tick this reads. Under the
// stated law it gains `MU / SOFTEN^2 x TICK_DT` (4.63); under the same law with
// the softening left out it gains `MU / 60^2 x TICK_DT` (10.42), which is 2.25
// times as much. The two answers are so far apart that the five percent band the
// review item allows cannot contain both, so the failure names which of the two
// models the build implemented rather than merely reporting a number.
//
// WHY ONE TICK FROM REST, as in `gravity/pull-magnitude`: under the tick order
// `specs/simulation.md` fixes, a body at rest holds exactly `aMag * TICK_DT`
// after one tick, so the reading is the capped acceleration itself rather than a
// path a tolerance could absorb.
//
// This item reads the cap alone. The uncapped law at 200, 150 and 120 is
// `gravity/pull-magnitude`'s, and the direction is `gravity/pull-direction`'s.

import { afterEach, beforeEach, it } from "vitest";
import { MU, STAR_X, STAR_Y, TICK_DT } from "../../src/constants";
import { assertBetween } from "../assert";
import {
  bulletById,
  captureStill,
  createHarness,
  poseBullet,
  startPlaying,
  type Harness,
} from "../harness";
import { gainAtRest, magnitude, velocityOf, type Point } from "./law";

/** How far inside `SOFTEN` (90) the sample sits, as the review item states. */
const SAMPLE_DISTANCE = 60;

/** Where that puts it: 60 units straight up the field from the star's centre. */
const SAMPLE: Point = { x: STAR_X, y: STAR_Y - SAMPLE_DISTANCE };

/**
 * The relative tolerance on the reading: five percent, as the review item states.
 *
 * The arithmetic is exact, so this is rounding room. What matters is that it is
 * nowhere near wide enough to reach the unsoftened figure below, which stands 125
 * percent above the capped one.
 */
const TOLERANCE = 0.05;

/** What the stated law gives over one tick at 60 units: the cap, `MU / SOFTEN^2`. */
const CAPPED_GAIN = gainAtRest(SAMPLE);

/** What the law WITHOUT the softening would give, named so a failure says so. */
const UNSOFTENED_GAIN = (MU / (SAMPLE_DISTANCE * SAMPLE_DISTANCE)) * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("caps the pull at MU / SOFTEN^2 for a body inside the softening radius", async () => {
  startPlaying(h);
  const id = poseBullet(h, SAMPLE.x, SAMPLE.y, 0, 0);

  await h.advance(1);
  captureStill(h, "sample");

  const gained = magnitude(
    velocityOf(
      bulletById(
        h.snapshot(),
        id,
        `a bullet at rest ${SAMPLE_DISTANCE} units from the star, inside SOFTEN`,
      ),
    ),
  );
  assertBetween(
    gained,
    CAPPED_GAIN * (1 - TOLERANCE),
    CAPPED_GAIN * (1 + TOLERANCE),
    `the speed gained over one tick at d = ${SAMPLE_DISTANCE}: ` +
      `MU / SOFTEN^2 x TICK_DT (specs/gravity.md), not the unsoftened ` +
      `${UNSOFTENED_GAIN.toFixed(4)}`,
  );
});
