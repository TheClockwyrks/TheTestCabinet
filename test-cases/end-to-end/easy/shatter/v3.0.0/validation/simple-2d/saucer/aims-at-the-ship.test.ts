// saucer/aims-at-the-ship — the saucer's shots point at the ship.
//
// THE RULE. `specs/saucer.md`: "the saucer fires one saucer bullet AIMED AT THE
// SHIP'S CURRENT POSITION", and "The shot's bearing is the bearing from the
// saucer to the ship, offset by an angle drawn afresh for every shot, uniformly
// from `-SAUCER_AIM_ERROR` to `+SAUCER_AIM_ERROR`". The offset is a zero-mean
// draw, so what the aim itself is can only be read off the AVERAGE of many shots:
// one shot says almost nothing, and sixty say it to within a degree.
//
// WHY THREE DEGREES, AND WHY IT IS DERIVED RATHER THAN OBSERVED. A uniform draw
// over `+/-E` has standard deviation `E / sqrt(3)` = `5.77` degrees, so the mean
// of `n` of them has a standard error of `E / sqrt(3n)` — `0.745` degrees at
// sixty. Three degrees is four standard errors, which a conformant build clears
// about nineteen times in twenty thousand runs, and it is arithmetic on the
// specification's own figure rather than a spread read off a reference build.
// What it catches is a build with a systematic lead: one that aims at where the
// ship WILL be, or at the field's centre, or at the last position it cached,
// reads a mean that does not move as the sample grows.
//
// ONE DIRECTION ONLY. That the per-shot error stays inside its bound is
// `aim-error-within-10-degrees`'s, and that it is redrawn at all is
// `aim-error-varies-per-shot`'s. A build that aims dead-on with no error
// whatsoever passes this one and fails that one, which is exactly right: it has
// the aim and not the scatter.
//
// THE SCENARIO IS IN `aim.ts`: a saucer standing still with its mind and its
// travel off, four hundred units from a ship standing still, both far enough from
// the star that the well cannot turn a round between the gun and the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertLessThanOrEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { SAUCER_AIM_ERROR_DEG, SHOT_COUNT, readAimErrors } from "./aim";

/**
 * The standard error of the mean of `SHOT_COUNT` draws, in degrees: `0.745`.
 *
 * `SAUCER_AIM_ERROR / sqrt(3 * n)` — the standard deviation of one uniform draw
 * over `+/-E` divided by the root of the sample size.
 */
const STANDARD_ERROR = SAUCER_AIM_ERROR_DEG / Math.sqrt(3 * SHOT_COUNT);

/** The item's three degrees, which is four of those. See the header. */
const MEAN_TOLERANCE = 4 * STANDARD_ERROR;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("centres sixty shots on the bearing to the ship", async () => {
  const errors = await readAimErrors(h);
  captureStill(h, "aim");

  assertLength(
    errors,
    SHOT_COUNT,
    "the shots the sixty-shot sweep read (specs/saucer.md)",
  );

  const mean = errors.reduce((sum, error) => sum + error, 0) / errors.length;
  assertLessThanOrEqual(
    Math.abs(mean),
    MEAN_TOLERANCE,
    `the degrees the mean of ${SHOT_COUNT} shots stood off the bearing to ` +
      "the ship (specs/saucer.md)",
  );
});
