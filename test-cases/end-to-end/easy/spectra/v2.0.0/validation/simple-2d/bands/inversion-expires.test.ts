// bands/inversion-expires — an inversion ends after its time.
//
// specs/bands.md, "The spectral inversion": "An inversion lasts `INVERSION_TIME`
// (`5.0`) seconds from the moment it begins, and the game carries the seconds
// remaining", and "When the remaining time reaches zero the inversion ends, and
// every entity reads as its stored band again." specs/instrumentation.md reports
// the two readings this point takes: `inversionActive`, derived as
// `inversion > 0`, and a drone's `effectiveBand`.
//
// BOTH READINGS ARE THE SAME REQUIREMENT SEEN TWICE, which is why they are read
// together: the inversion's own countdown reaching zero, and the field reading as
// it did before. A build that clears the flag but leaves the bands swapped has
// not ended the inversion, and one that puts the bands back while the countdown
// runs on has not either.
//
// THE INVERSION IS POSED AT ITS FULL LENGTH and then simply waited out, so the
// duration under test is `INVERSION_TIME` exactly as `setInversion` was handed
// it. What TRIGGERS an inversion is a diving Prism and the `drones` group's
// point; what a REFRESH does to the remaining time is
// `bands.inversion-refreshes`'.
//
// THE WAIT CARRIES ONE FRAME OF MARGIN. The countdown is integrated against the
// delta each frame hands the game (specs/simulation.md), so `INVERSION_TIME` of
// game time arrives as a sum of 600 deltas whose last unit is at the mercy of
// binary floating point; a wait of exactly that could leave a build a
// hundred-trillionth of a second short and read as still running. One extra frame
// of the 120 Hz clock is `0.0083` s, 0.17% of the figure, which no build could
// use to hide a shortened or lengthened inversion.

import { afterEach, beforeEach, it } from "vitest";
import { INVERSION_TIME } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  LANE_CENTER,
  captureStill,
  createHarness,
  droneOf,
  poseDrone,
  seconds,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/** Where the drone stands: well inside the play field (specs/field.md). */
const DRONE_X = LANE_CENTER;
const DRONE_Y = 320;

/** The band the drone stores, which it must read as again once the time is up. */
const STORED_BAND = "cyan" as const;

/** The frames of the 120 Hz clock the inversion is waited out over. */
const MARGIN_TICKS = 1;
const WAIT_TICKS = ticksFor(INVERSION_TIME) + MARGIN_TICKS;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ends the inversion and gives a stored-cyan Shard its band back", async () => {
  startPosed(h);
  h.debug.setInversion(INVERSION_TIME);
  const droneId = poseDrone(h, "shard", DRONE_X, DRONE_Y, {
    band: STORED_BAND,
  });

  await h.advance(WAIT_TICKS);
  captureStill(h, "expired");

  const field = h.snapshot();
  assertEqual(
    field.inversionActive,
    false,
    `whether an inversion is still running ${seconds(WAIT_TICKS)} s after ` +
      `one of INVERSION_TIME ${INVERSION_TIME} s was posed (it reports ` +
      `${field.inversion} s left) — specs/bands.md: an inversion lasts ` +
      "INVERSION_TIME seconds, and when the remaining time reaches zero it ends",
  );
  assertEqual(
    droneOf(field, droneId).effectiveBand,
    STORED_BAND,
    `the effective band of a Shard storing ${STORED_BAND} once that ` +
      "inversion has run out — specs/bands.md: when the inversion ends, every " +
      "entity reads as its stored band again",
  );
});
