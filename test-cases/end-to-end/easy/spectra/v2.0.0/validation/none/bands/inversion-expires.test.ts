// bands/inversion-expires — an inversion ends after its time, and the bands come back.
//
// specs/bands.md: "An inversion lasts `INVERSION_TIME` (`5.0`) seconds from the
// moment it begins, and the game carries the seconds remaining… When the
// remaining time reaches zero the inversion ends, and every entity reads as its
// stored band again."
//
// The inversion is posed at its full time with `setInversion`, which is what
// "from the moment it begins" means for a check that is not grading the trigger,
// and the game's own clock is then run out. Two readings bracket the boundary:
// half a second short of `INVERSION_TIME` the inversion is still running, and
// two frames past it the inversion is off AND the stored-cyan Shard standing
// under it reads cyan again. The first reading is what makes the second mean
// "ended after its time" rather than "was never running" or "ended early".
//
// Nothing else is on the field and the wave's three gates are shut, so five
// seconds of game time bring nothing in that could disturb either reading. The
// four and a half seconds before the boundary are covered by `Harness.skip`,
// which runs the same real update off camera, so the picture kept below is the
// field the moment the inversion had ended.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { FORM_CENTER_X, INVERSION_TIME } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  poseDrone,
  requireDrone,
  startPosed,
  type Harness,
} from "../harness";

/** Where the drone stands: mid-field, clear of both HUD strips and of the ship. */
const AT = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * How long before the end the "still running" reading is taken, in seconds.
 *
 * A tenth of `INVERSION_TIME`: late enough that a build counting down at any
 * plausibly wrong rate has already finished, and far enough from the boundary
 * that no rounding of the frame division can put the reading on the wrong side
 * of it.
 */
const SHORT_OF_END = 0.5;

/**
 * Frames run past the boundary before the "ended" reading is taken.
 *
 * Two frames of the harness's 100 Hz clock — 0.02 s on a 5 s span — so a build
 * that ends the inversion in the update that carries the remainder to zero and
 * one that ends it in the next both read as ended, and neither is granted
 * anything like a tenth of a second of extra life.
 */
const PAST_END_FRAMES = 2;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("ends INVERSION_TIME after it began and reads the drone on its stored band", async () => {
  await startPosed(harness);
  const id = await poseDrone(harness, "shard", AT.x, AT.y, { band: "cyan" });
  await harness.debug.setInversion(INVERSION_TIME);
  assertEqual(
    (await harness.snapshot()).inversionActive,
    true,
    "the inversion the scenario posed",
  );

  await harness.skip(INVERSION_TIME - SHORT_OF_END);
  assertEqual(
    (await harness.snapshot()).inversionActive,
    true,
    `the inversion ${SHORT_OF_END} s short of INVERSION_TIME, which it must still be running at`,
  );

  await harness.advance(framesFor(SHORT_OF_END) + PAST_END_FRAMES);
  const ended = await harness.snapshot();
  await captureStill(harness, "expired");

  assertEqual(
    ended.inversionActive,
    false,
    "the inversion INVERSION_TIME after it began (specs/bands.md)",
  );
  assertEqual(
    requireDrone(ended, id, "the stored-cyan drone the inversion ran over")
      .effectiveBand,
    "cyan",
    "the band a stored-cyan drone reads as once the inversion has ended (specs/bands.md)",
  );
});
