// Carom — audio/obstacle-bounce: the `obstacle-bounce` cue plays on the frame the
// ball bounces off a mid-field obstacle.
//
// The ball is fired level with obstacle A, straight at its left face, from far
// enough out that nothing else is in the lane. The real collision reverses its
// horizontal velocity, and the frame that happens on is the frame the cue must
// carry.
//
// An obstacle bounce and a paddle hit are different events with different cues,
// and this is the check that says so: the name asserted here is the obstacle's,
// and a build that reuses one blip for every bounce fails it.

import { afterEach, beforeEach, expect, it } from "vitest";
import { CUES, OBSTACLES, OBSTACLE_CENTERS } from "../../src/constants";
import {
  arrangeObstacleBounce,
  createHarness,
  driveObstacleBounce,
  startPlaying,
  watchCues,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays the obstacle-bounce cue on the frame of the bounce", async () => {
  await startPlaying(h, "versus");
  arrangeObstacleBounce(h, {
    faceX: OBSTACLES[0].x0,
    y: OBSTACLE_CENTERS[0].y,
    from: "left",
  });

  const played = watchCues(h);
  const bounced = await driveObstacleBounce(h, "left");
  const frame = h.engine.frame().count;

  expect(bounced.hit).toBe(true);
  expect(played.map((cue) => cue.cue)).toEqual([CUES.obstacleBounce]);
  expect(played[0].frame).toBe(frame);
  expect(played[0].gain).toBeGreaterThan(0);
});
