// cascade/launch-cadence — a card launches every 0.18 s.
//
// specs/victory.md fixes the launch clock exactly: it holds `LAUNCH_INTERVAL`
// (0.18) when the cascade begins, each frame it adds the frame's delta, and
// while it holds at least `LAUNCH_INTERVAL` and cards remain, `LAUNCH_INTERVAL`
// is SUBTRACTED from it and the next card launches. The remainder is carried, so
// "after `t` seconds of a running cascade exactly `floor(t / LAUNCH_INTERVAL) + 1`
// cards have launched, capped at fifty-two, and the mean gap between successive
// launches is `LAUNCH_INTERVAL`".
//
// THE COUNT AND THE MEAN ARE WHAT THE RULE GUARANTEES, and they are the whole of
// what this point reads. Nothing here asserts that at most one card launches in a
// frame: the carry means a frame long enough to cover several intervals launches
// several cards, so such a reading would fail a conformant build on any coarse
// frame while passing vacuously on a fine one.
//
// ONE DRIVE OF EXACTLY THE WINDOW, SAMPLED EVERY FRAME. The window is advanced
// frame by frame and the frame each launch landed on is recorded from the
// snapshots, so both readings come out of the same three seconds: the count is
// the count at the end of the window, and never at wherever a sweep for a
// launch happened to stop, so a build launching too slowly cannot satisfy the
// count by being read late.
//
// The mean is taken over the gaps between the first and the last launch inside
// the window, which is the honest figure for a rule that carries its remainder:
// a per-gap tolerance tighter than one frame would measure the suite's own step
// rather than the build.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { LAUNCH_INTERVAL } from "../constants";
import {
  type Harness,
  captureReplay,
  createHarness,
  framesFor,
  seconds,
} from "../harness";
import { frameSamples, openCascade } from "./flight";

/** The window the count is taken over, in seconds of game time. */
const WINDOW = 3;

/** That window, in frames of the suite's own 1/240 s step. */
const WINDOW_FRAMES = framesFor(WINDOW);

/**
 * What `specs/victory.md` says has launched by the end of that window:
 * `floor(t / LAUNCH_INTERVAL) + 1`, which is 17 at three seconds.
 */
const EXPECTED_LAUNCHES = Math.floor(WINDOW / LAUNCH_INTERVAL) + 1;

/**
 * How far the mean gap may sit from `LAUNCH_INTERVAL`: two percent, 3.6 ms.
 *
 * The suite advances in frames of 1/240 s (4.17 ms), so a launch can only land
 * on a frame boundary and a single gap is quantised to that. The MEAN over
 * sixteen gaps is not: a rule that carries its remainder averages out to the
 * interval itself, and two percent is comfortable room over the rounding while
 * still catching a build whose interval is a tenth out.
 */
const MEAN_TOLERANCE = LAUNCH_INTERVAL * 0.02;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("launches a card every LAUNCH_INTERVAL, carrying the remainder", async () => {
  await openCascade(harness);
  const opening = await harness.snapshot();

  const samples = await captureReplay(harness, "launches", () =>
    frameSamples(harness, WINDOW_FRAMES),
  );

  // The frame of the window each launch landed on, 1-based. A frame that covered
  // more than one interval launched more than one card and contributes that many
  // entries, which is the carry doing exactly what the specification says.
  const launchFrames: number[] = [];
  let counted = opening.launched;
  for (const [index, sample] of samples.entries()) {
    for (; counted < sample.launched; counted += 1)
      launchFrames.push(index + 1);
  }

  assertEqual(
    counted,
    EXPECTED_LAUNCHES,
    `cards launched over ${WINDOW} s of a running cascade`,
  );

  assertGreaterThan(
    launchFrames.length,
    1,
    "launches inside the window, so there is a gap to average",
  );
  const first = launchFrames[0];
  const last = launchFrames[launchFrames.length - 1];
  const meanGap = seconds(last - first) / (launchFrames.length - 1);
  assertLessThanOrEqual(
    Math.abs(meanGap - LAUNCH_INTERVAL),
    MEAN_TOLERANCE,
    `the mean gap between successive launches to be LAUNCH_INTERVAL (${LAUNCH_INTERVAL} s), and it was ${meanGap}`,
  );
});
