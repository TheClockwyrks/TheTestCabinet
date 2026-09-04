// saucer/aim-error-varies-per-shot — the offset is drawn again for every shot.
//
// THE RULE. `specs/saucer.md`: the bearing is "offset by an angle DRAWN AFRESH
// FOR EVERY SHOT", and it says outright what follows — "Successive shots at a
// stationary ship therefore differ." So this item reads the SPREAD of sixty shots
// at a ship that has not moved: how far apart the widest two of them are.
//
// WHY FOUR DEGREES. A fifth of the twenty-degree range the draw covers, and a
// bound that separates the two wrong models from the right one by a mile. Sixty
// draws from `+/-10` degrees span `19.7` degrees on average and span less than
// four about once in every `10^40` runs, so nothing conformant is anywhere near
// it. A build that aims dead-on spans `0`; a build that draws one offset and
// reuses it spans `0`; a build that alternates two fixed offsets spans whatever
// those two are and is the only wrong model this bound has to be chosen against —
// which is why it is a fifth of the range and not a hundredth.
//
// ONE DIRECTION ONLY, AND IT IS THE ONE THE OTHER TWO CANNOT SEE. A build with no
// error at all passes `aims-at-the-ship` perfectly and passes
// `aim-error-within-10-degrees` trivially; this is the item it fails.
//
// THE SPREAD, NOT A DEVIATION. The widest two shots of the sixty is a reading a
// reviewer can check by eye against the picture, and it needs no assumption about
// the shape of the distribution — which matters, because the specification fixes
// the range the offset is drawn from and leaves the build to draw it.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLength } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { SAUCER_AIM_ERROR_DEG, SHOT_COUNT, readAimErrors } from "./aim";

/** A fifth of the range the offset is drawn from: four degrees. See the header. */
const SPREAD_NEEDED = (2 * SAUCER_AIM_ERROR_DEG) / 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("spreads sixty shots at a still ship over more than four degrees", async () => {
  const errors = await readAimErrors(h);
  captureStill(h, "scatter");

  assertLength(
    errors,
    SHOT_COUNT,
    "the shots the sixty-shot sweep read (specs/saucer.md)",
  );

  assertGreaterThan(
    Math.max(...errors) - Math.min(...errors),
    SPREAD_NEEDED,
    `the degrees between the widest two of ${SHOT_COUNT} shots at a ship ` +
      "that never moved (specs/saucer.md)",
  );
});
