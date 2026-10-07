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
// wrong as one that launches the wrong number. Neither is read per gap. A
// per-gap tolerance tighter than a frame would be measuring the validator's own
// step rather than the build's clock, and the mean over the hold's sixteen gaps
// is the honest figure precisely BECAUSE the remainder is carried.
//
// STEPPED AT `CADENCE_HZ`, NOT AT THE GROUP'S FRAME. Where a launch falls in
// game time is not a frame-rate quantity: the clock adds each frame's delta and
// carries what it does not spend, so the k-th card leaves at
// `k * LAUNCH_INTERVAL` however the interval was divided. A frame decides only
// which frame a launch is OBSERVED on, and both of this hold's observations are
// within a frame of the launch itself — the first card is read at the end of the
// cascade's first frame, `1 / 40` s after the clock opened, and the seventeenth
// on the first frame ending past `2.88` s, which is `2.9` s. Sixteen gaps over
// that span read `0.1797` s, `0.31` ms under the interval, and the allowance
// below is eleven times that.
//
// AND THE COARSER FRAME IS WHAT MAKES THE CARRY READABLE. Stepped at the group's
// `1 / 240` s the interval is `43.2` frames, so a build that ZEROED its clock
// where the specification subtracts the interval would launch every forty-fourth
// frame: a cadence `1.9` percent wide, hiding inside the two percent this point
// allows, and a count three seconds cannot tell from seventeen. At `1 / 40` s
// the interval is `7.2` frames, so that same build launches every eighth — a
// `0.2` s cadence, eleven percent wide, and fifteen cards over the hold rather
// than seventeen. A build that counts frames instead of adding the delta parts
// from the requirement by more again.
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
import { cadenceFrames, createCadenceHarness, watchLaunches } from "./flight";

/** How long the cascade is watched for, in seconds. */
const HOLD_SECONDS = 3;

/** That hold, in whole frames of the clock this check steps. */
const HOLD_FRAMES = cadenceFrames(HOLD_SECONDS);

/**
 * The cards `HOLD_SECONDS` of a running cascade launches.
 *
 * specs/victory.md's own count: the clock opens holding the interval, so the
 * first card leaves on the first frame and one more leaves every interval after
 * it. The hold ends `0.12` s after the seventeenth card's interval and `0.06` s
 * before the eighteenth's, so the count is two frames and more clear of either
 * neighbour.
 */
const EXPECTED_LAUNCHES = Math.floor(HOLD_SECONDS / LAUNCH_INTERVAL) + 1;

/**
 * How far the mean gap may sit from the interval, in seconds.
 *
 * Two percent of the interval, which is the figure this point is stated at.
 * Which frame a launch is observed on accounts for `0.31` ms of that, a twelfth,
 * and the rest is room for the build's own drift.
 */
const GAP_TOLERANCE = 0.02 * LAUNCH_INTERVAL;

let harness: Harness;

beforeEach(async () => {
  harness = await createCadenceHarness();
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
