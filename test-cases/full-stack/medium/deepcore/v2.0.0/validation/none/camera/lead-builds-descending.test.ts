// camera/lead-builds-descending — a sustained descent rides the miner up the
// view.
//
// specs/world.md: while the miner travels downward faster than `CAM_STILL_SPEED`
// the lead's target is `+CAM_LEAD_MAX` (212), and `lead` moves toward it at
// `CAM_LEAD_MAX / CAM_LEAD_RAMP` (106) units per second, never overshooting. So a
// descent that has been running for `t` seconds carries a lead of
// `min(CAM_LEAD_MAX, 106 * t)`, reaching full lead after `CAM_LEAD_RAMP` (2)
// seconds, and the floor of the shaft comes into view early.
//
// A REAL FALL, NOT A POSED ONE. The miner is dropped down a cleared shaft and the
// game's own gravity carries it; the only pose is the velocity it starts with,
// which puts it past the still speed on the first frame so the ramp's clock and
// the drive's clock agree. What is sampled is the lead, which the rule drives off
// TIME rather than off how fast the fall is going, so the acceleration underneath
// it changes nothing.
//
// ISOLATION. An empty mine with no floor between the start and the end of the
// drop, the drill gated so nothing is cut on the way down, and nothing else in
// the world at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertGreaterThan } from "../assert";
import { CAM_LEAD_MAX, CAM_LEAD_RATE, CAM_STILL_SPEED } from "../constants";
import {
  captureReplay,
  createHarness,
  minerXOn,
  minerYOn,
  openScene,
  pinDrill,
  type Harness,
} from "../harness";

/** Where the drop starts. The mine is empty below it for hundreds of rows. */
const COL = 16;
const START_ROW = 12;

/** The downward speed the drop opens at: past the still speed on frame one. */
const START_VY = 300;

/** The sample points, in seconds of sustained descent. */
const SAMPLE_SECONDS = [0.5, 1, 1.5, 2, 2.5];

/** Frames each half-second sample is driven in: a 60 Hz division. */
const FRAMES_PER_SAMPLE = 30;

/**
 * How far a sample may sit from the ramp, in world units.
 *
 * Two frames of ramp at the division above. The specification fixes the RATE and
 * leaves a build free to apply it before or after the frame's motion, so a
 * conformant build can sit up to a frame's worth of ramp either side of the
 * ideal; two frames is that with room to spare, and it is a thirtieth of the
 * range the lead covers, so it separates the stated ramp from any other.
 */
const TOLERANCE = 2 * CAM_LEAD_RATE * (0.5 / FRAMES_PER_SAMPLE) * 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("builds the lead to CAM_LEAD_MAX over CAM_LEAD_RAMP seconds of descent", async () => {
  await openScene(h);
  await pinDrill(h);
  await h.debug.setMinerPosition(minerXOn(COL), minerYOn(START_ROW));
  await h.debug.setMinerVelocity(0, START_VY);

  const samples: { at: number; lead: number; vy: number }[] = [];
  await captureReplay(h, "descend", async () => {
    let driven = 0;
    for (const at of SAMPLE_SECONDS) {
      await h.advanceSeconds(at - driven, FRAMES_PER_SAMPLE);
      driven = at;
      const snapshot = await h.snapshot();
      samples.push({
        at,
        lead: snapshot.camera.lead,
        vy: snapshot.miner.vy,
      });
    }
  });

  for (const sample of samples) {
    // The arrangement's own reading: the fall never left the descending band, so
    // every sample is on the ramp the rule states.
    assertGreaterThan(
      sample.vy,
      CAM_STILL_SPEED,
      `the miner is still descending at ${sample.at}s`,
    );
    const expected = Math.min(CAM_LEAD_MAX, CAM_LEAD_RATE * sample.at);
    assertBetween(
      sample.lead,
      expected - TOLERANCE,
      expected + TOLERANCE,
      `specs/world.md: the lead after ${sample.at}s of descent`,
    );
  }
});
