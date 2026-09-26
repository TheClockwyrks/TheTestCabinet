// bands/inversion-expires — an inversion ends after its time, and the bands come back.
//
// specs/bands.md, "The spectral inversion": "An inversion lasts `INVERSION_TIME`
// (`5.0`) seconds from the moment it begins, and the game carries the seconds
// remaining… When the remaining time reaches zero the inversion ends, and every
// entity reads as its stored band again."
//
// THE INVERSION IS POSED AT ITS FULL TIME with `setInversion`, which is what "from
// the moment it begins" means for a check that is not grading the trigger — the
// trigger is the `drones` category's — and the game's OWN clock is then run out.
// Nothing about the ending is posed: `setInversion` is called once, at the start.
//
// TWO READINGS BRACKET THE BOUNDARY. {@link SHORT_OF_END} seconds short of
// `INVERSION_TIME` the inversion must still be running, and {@link PAST_END_TICKS}
// frames past it the inversion must be off AND the stored-cyan Shard standing
// under it must read cyan again. The first reading is what makes the second mean
// "ended after its time" rather than "was never running" or "ended early": a build
// that counts down at twice the rate fails the first, and one that never ends the
// inversion fails the second.
//
// Nothing else is on the field and the three world gates are shut, so five seconds
// of game time bring nothing in that could disturb either reading.

import { afterEach, beforeEach, it } from "vitest";
import { INVERSION_TIME } from "../constants";
import { assertEqual, fail } from "../assert";
import {
  LANE_CENTER,
  captureStill,
  createHarness,
  droneById,
  poseDrone,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/** Where the drone stands: mid-field, clear of both HUD strips and of the ship. */
const AT_X = LANE_CENTER;
const AT_Y = 320;

/** The drone's stored band, which it must read as again once the inversion ends. */
const STORED = "cyan" as const;

/**
 * How long before the end the "still running" reading is taken, in seconds.
 *
 * A tenth of `INVERSION_TIME`: late enough that a build counting down at any
 * plausibly wrong rate has already finished, and far enough from the boundary that
 * no rounding of the frame division can put the reading on the wrong side of it.
 */
const SHORT_OF_END = INVERSION_TIME / 10;

/**
 * Frames run past the boundary before the "ended" reading is taken.
 *
 * Two frames of the harness's 100 Hz clock — 0.02 s on a 5 s span — so a build
 * that ends the inversion in the update carrying the remainder to zero and one
 * that ends it in the next both read as ended, and neither is granted anything
 * like a tenth of a second of extra life.
 */
const PAST_END_TICKS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ends INVERSION_TIME after it began and reads the drone on its stored band", async () => {
  startPosed(h);
  const id = poseDrone(h, "shard", AT_X, AT_Y, { band: STORED });
  h.debug.setInversion(INVERSION_TIME);
  assertEqual(
    h.snapshot().inversionActive,
    true,
    "the inversion the scenario posed",
  );

  await h.advance(ticksFor(INVERSION_TIME - SHORT_OF_END));
  assertEqual(
    h.snapshot().inversionActive,
    true,
    `the inversion ${SHORT_OF_END} s short of INVERSION_TIME ` +
      `${INVERSION_TIME}, which it must still be running at (specs/bands.md)`,
  );

  await h.advance(ticksFor(SHORT_OF_END) + PAST_END_TICKS);
  const ended = h.snapshot();
  captureStill(h, "expired");

  assertEqual(
    ended.inversionActive,
    false,
    `the inversion INVERSION_TIME ${INVERSION_TIME} s after it began, plus ` +
      `${PAST_END_TICKS} frames of slack (specs/bands.md)`,
  );
  const drone = droneById(ended, id);
  if (drone === undefined) {
    fail(
      "the posed Shard still on the drone roster (specs/instrumentation.md)",
      "no drone carries the id addDrone appended",
    );
  }
  assertEqual(
    drone.effectiveBand,
    STORED,
    `the band a stored-${STORED} drone reads as once the inversion has ended: ` +
      `its stored band again (specs/bands.md)`,
  );
});
