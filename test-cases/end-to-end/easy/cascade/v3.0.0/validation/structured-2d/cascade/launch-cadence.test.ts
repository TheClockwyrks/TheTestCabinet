// cascade/launch-cadence — a card launches every LAUNCH_INTERVAL seconds.
//
// specs/victory.md fixes the launch clock exactly: it holds `LAUNCH_INTERVAL`
// when the cascade begins, so the first card launches on the cascade's first
// frame; each frame adds the frame's delta; and while the clock holds at least
// the interval a card launches and the interval is SUBTRACTED from it. The
// remainder is carried, so after `t` seconds of a running cascade exactly
// `floor(t / LAUNCH_INTERVAL) + 1` cards have launched and the mean gap between
// successive launches is the interval itself.
//
// Both halves of that sentence are this one requirement, and both are read here:
// a build that launches the right number of cards at a drifting cadence is as
// wrong as one that launches the wrong number. Neither is read per gap. This
// group steps frames of 1/240 s, so an individual gap is quantised to a frame
// and lands on 43 or 44 of them either side of the interval's 43.2; a per-gap
// tolerance tighter than a frame would be measuring the validator's own step
// rather than the build's clock. The mean over sixteen gaps is the honest
// figure, and it is honest precisely BECAUSE the remainder is carried.
//
// The cascade is entered through the game's own win path, because the launch
// clock is started by the win (specs/victory.md) and no operation on the surface
// sets a cascade running. The painted layer is turned off for the reason the
// whole group turns it off: what is being read is the cadence, and a full-screen
// layer blitted every frame would spend the recording's budget on pixels rather
// than on the launches the recording is evidence of.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import { LAUNCH_INTERVAL } from "../constants";
import { captureReplay, startCascade, type Harness } from "../harness";
import { createFlightHarness, flightFrames, watchLaunches } from "./flight";

/** How long the cascade is watched for, in seconds. */
const HOLD_SECONDS = 3;

/** That hold, in whole frames of this group's clock. */
const HOLD_FRAMES = flightFrames(HOLD_SECONDS);

/**
 * The cards `HOLD_SECONDS` of a running cascade launches.
 *
 * specs/victory.md's own count: the clock opens holding the interval, so the
 * first card leaves on the first frame and one more leaves every interval after
 * it.
 */
const EXPECTED_LAUNCHES = Math.floor(HOLD_SECONDS / LAUNCH_INTERVAL) + 1;

/**
 * How far the mean gap may sit from the interval, in seconds.
 *
 * Two percent of the interval, which is the figure this point is stated at. The
 * quantisation this group's own clock imposes is far inside it: a launch lands
 * on a frame boundary, so the mean over the sixteen gaps carries at most half a
 * frame of error, `1 / 480` s spread over sixteen gaps, under a thousandth of
 * the allowance.
 */
const GAP_TOLERANCE = 0.02 * LAUNCH_INTERVAL;

let harness: Harness;

beforeEach(async () => {
  harness = await createFlightHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("launches one card every launch interval", async () => {
  startCascade(harness);
  harness.debug.setTrailPainting(false);

  const launches = await captureReplay(harness, "launches", () =>
    watchLaunches(harness, HOLD_FRAMES),
  );

  assertEqual(
    launches.length,
    EXPECTED_LAUNCHES,
    `cards launched over ${HOLD_SECONDS} s`,
  );

  const span = launches[launches.length - 1].at - launches[0].at;
  const mean = span / (launches.length - 1);
  assertBetween(
    mean,
    LAUNCH_INTERVAL - GAP_TOLERANCE,
    LAUNCH_INTERVAL + GAP_TOLERANCE,
    "the mean gap between successive launches, in seconds",
  );
});
