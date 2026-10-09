// Carom — audio/obstacle-bounce: the `obstacle-bounce` cue plays on the frame the
// ball bounces off a mid-field obstacle.
//
// The field is emptied and holds obstacle A and the struck ball alone, so the
// only collision that can happen is the one this point is about: obstacle B is
// REMOVED rather than dodged, and the paddles — the one thing on the field a
// check cannot remove — are driven out of the lane. The ball is then fired level
// with A, straight at its left face, from far enough out to be visibly
// approaching. The real collision reverses its horizontal velocity, and the frame
// that happens on is the frame the cue must carry.
//
// Live play is POSED rather than served into: this point is about the cue on a
// bounce, so the countdown and the serve are no part of it, and `enterPlaying`
// reaches the playing screen without running either.
//
// An obstacle bounce and a paddle hit are different events with different cues,
// and this is the check that says so: the name asserted here is the obstacle's,
// and a build that reuses one blip for every bounce fails it.

import { afterEach, beforeEach, it } from "vitest";
import { CUES, OBSTACLES, OBSTACLE_CENTERS } from "../constants";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  arrangeObstacleBounce,
  captureReplay,
  createHarness,
  driveObstacleBounce,
  enterPlaying,
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
  enterPlaying(h, "versus");
  arrangeObstacleBounce(h, {
    obstacle: 0,
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

  assertEqual(bounce.bounced.hit, true);
  assertDeepEqual(
    bounce.cues.map((cue) => cue.cue),
    [CUES.obstacleBounce],
  );
  assertEqual(bounce.cues[0].frame, bounce.frame);
  assertGreaterThan(bounce.cues[0].gain, 0);
});
