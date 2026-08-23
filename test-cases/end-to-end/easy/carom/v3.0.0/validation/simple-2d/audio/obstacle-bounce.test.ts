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
  captureReplay,
  createHarness,
  driveObstacleBounce,
  startPlaying,
  watchCues,
  type Harness,
} from "../harness";

/**
 * Frames of the departing flight recorded after the bounce.
 *
 * The sweep stops on the frame the ball comes off the obstacle, which is also the
 * frame the cue must have played on — so a recording that ended there would hold
 * the approach and the contact and nothing of what the contact produced. The
 * review item promises "the obstacle bounce whose cue is checked", and a bounce a
 * reviewer can hear placed against is one they can see leave the face.
 *
 * Driven after every reading is taken, so nothing recorded here reaches an
 * assertion: the cue list, the frame number and the sweep's own result are all
 * frozen at the instant the sweep stopped.
 */
const DEPARTURE_TICKS = 60; // 0.5 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the obstacle-bounce cue on the frame of the bounce", async () => {
  await startPlaying(h, "versus");
  arrangeObstacleBounce(h, {
    faceX: OBSTACLES[0].x0,
    y: OBSTACLE_CENTERS[0].y,
    from: "left",
  });

  const played = watchCues(h);
  const bounce = await captureReplay(h, "bounce", async () => {
    const bounced = await driveObstacleBounce(h, "left");
    // Read HERE, on the frame the sweep stopped: the frame number and the cues
    // that had sounded by then are exactly what the assertions read before the
    // departing flight below was recorded.
    const measured = {
      bounced,
      frame: h.engine.frame().count,
      cues: [...played],
    };
    await h.advance(DEPARTURE_TICKS);
    return measured;
  });

  expect(bounce.bounced.hit).toBe(true);
  expect(bounce.cues.map((cue) => cue.cue)).toEqual([CUES.obstacleBounce]);
  expect(bounce.cues[0].frame).toBe(bounce.frame);
  expect(bounce.cues[0].gain).toBeGreaterThan(0);
});
