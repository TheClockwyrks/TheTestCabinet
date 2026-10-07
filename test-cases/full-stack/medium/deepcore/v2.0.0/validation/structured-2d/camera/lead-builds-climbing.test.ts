// camera/lead-builds-climbing — a sustained climb rides the miner down the view,
// symmetrically.
//
// specs/world.md: `leadTarget` is `sign(vy) * CAM_LEAD_MAX` once the miner is
// past `CAM_STILL_SPEED`, and the lead moves toward it at the same
// `CAM_LEAD_MAX / CAM_LEAD_RAMP` (106) units per second whichever way it is
// going. A climb therefore carries `-min(CAM_LEAD_MAX, 106 * t)` after `t`
// seconds and reaches `-CAM_LEAD_MAX` (-212) after `CAM_LEAD_RAMP` (2) seconds,
// so the ceiling comes into view early on the way up.
//
// A REAL CLIMB, NOT A POSED ONE. The jetpack key goes down through the engine's
// own input and the game's own thrust carries the miner up a cleared shaft; the
// only pose is the upward speed it opens at, which puts it past the still speed
// on the first frame so the ramp's clock and the drive's clock agree.
//
// ISOLATION. An empty mine, the climb started deep enough that it never reaches
// the surface inside the span, and the drill gated so the held key cannot cut.

import { afterEach, beforeEach, it } from "vitest";
import { CAM_LEAD_MAX, CAM_STILL_SPEED } from "../constants";
import { assertBetween, assertLessThan } from "../assert";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  minerXOn,
  minerYOn,
  openScene,
  pinDrill,
  type Harness,
} from "../harness";
import { CAM_LEAD_RATE } from "./lead";

/** Where the climb starts: deep enough that the span never leaves the mine. */
const COL = 16;
const START_ROW = 120;

/** The upward speed the climb opens at: past the still speed on frame one. */
const START_VY = -300;

/** The sample points, in seconds of sustained climb. */
const SAMPLE_SECONDS = [0.5, 1, 1.5, 2, 2.5];

/** Frames each half-second sample is driven in: a 60 Hz division. */
const FRAMES_PER_SAMPLE = 30;

/** Two frames of ramp at that division, either side. See the descending check. */
const TOLERANCE = 2 * CAM_LEAD_RATE * (0.5 / FRAMES_PER_SAMPLE) * 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("builds the lead to -CAM_LEAD_MAX over CAM_LEAD_RAMP seconds of climb", async () => {
  openScene(h);
  pinDrill(h);
  h.debug.setMinerPosition(minerXOn(COL), minerYOn(START_ROW));
  h.debug.setMinerVelocity(0, START_VY);

  const samples: { at: number; lead: number; vy: number }[] = [];
  await captureReplay(h, "ascend", async () => {
    h.hold(ACTION_KEY.up);
    try {
      let driven = 0;
      for (const at of SAMPLE_SECONDS) {
        await h.advanceSeconds(at - driven, FRAMES_PER_SAMPLE);
        driven = at;
        const snapshot = h.snapshot();
        samples.push({ at, lead: snapshot.camera.lead, vy: snapshot.miner.vy });
      }
    } finally {
      h.release(ACTION_KEY.up);
    }
  });

  for (const sample of samples) {
    // The arrangement's own reading: the thrust held the climb the whole way, so
    // every sample is on the ramp the rule states.
    assertLessThan(
      sample.vy,
      -CAM_STILL_SPEED,
      `the miner is still climbing at ${sample.at}s`,
    );
    const expected = -Math.min(CAM_LEAD_MAX, CAM_LEAD_RATE * sample.at);
    assertBetween(
      sample.lead,
      expected - TOLERANCE,
      expected + TOLERANCE,
      `specs/world.md: the lead after ${sample.at}s of climb`,
    );
  }
});
