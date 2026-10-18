// Carom — audio/end-cap: the wall-bounce cue plays on the frame the ball
// reflects off a paddle's end cap.
//
// specs/audio.md gives the `wall-bounce` cue to two events: the top or bottom
// wall, AND a paddle's end cap. `audio/wall-bounce` drives the first; this drives
// the second, because a build that resolves an end cap like a wall in the physics
// and then forgets to sound it fails only this one, which is what says where to
// look.
//
// The ball drops straight down the left paddle's own x span, so the struck face
// is decided by the penetration depths alone (specs/balls.md): the top depth is
// at most one sub-step of travel while the left and right depths are the
// half-span plus BALL_R. The frame the vertical velocity reverses is the frame
// the reflection happened on, and therefore the frame the cue must play on.
//
// The field holds the ball and nothing else — both obstacles are off it — and the
// far paddle is held clear of the lane, so the descent crosses an empty column
// and any cue before the reflection is a build sounding when nothing happened.
// The struck paddle stands still at the field centre.

import { afterEach, beforeEach, it } from "vitest";
import {
  BALL_R,
  CUES,
  FIELD_CY,
  P1_X0,
  P1_X1,
  PADDLE_HALF,
} from "../constants";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  arrangeLiveBall,
  ball0,
  captureReplay,
  createHarness,
  drivePaddle,
  watchCues,
  type Harness,
} from "../harness";

/** The approach, in units per second. */
const SPEED = 400;
/** Where the center rests off the top cap. */
const PLACED = FIELD_CY - PADDLE_HALF - BALL_R;
/** Half a second of approach, so the clip opens on a ball in flight. */
const START_Y = PLACED - SPEED / 2;
/** The middle of the paddle's x span. */
const CAP_X = (P1_X0 + P1_X1) / 2;

/** Frames of the returning flight recorded after the reflection. */
const RETURN_TICKS = 60; // 0.5 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the wall-bounce cue on the frame of the end-cap reflection", async () => {
  await arrangeLiveBall(h, { x: CAP_X, y: START_Y, vx: 0, vy: SPEED });
  // The struck paddle stands still on the lane; `arrangeLiveBall` has already
  // held the far one off it.
  drivePaddle(h, "left", { cy: FIELD_CY, vy: 0 });

  // Subscribed after the scenario is posed, so what is read is the drive alone.
  const played = watchCues(h);
  const bounce = await captureReplay(h, "bounce", async () => {
    const reflected = await h.until((s) => ball0(s).vy < 0, {
      maxFrames: 120,
      poll: 1,
    });
    // Read HERE, on the frame the sweep stopped: the frame number and the cues
    // that had sounded by then are exactly what the assertions read before the
    // returning flight below was recorded.
    const measured = {
      reflected,
      frame: h.engine.frame().count,
      cues: [...played],
    };
    await h.advance(RETURN_TICKS);
    return measured;
  });

  assertEqual(bounce.reflected.hit, true);
  assertDeepEqual(
    bounce.cues.map((cue) => cue.cue),
    [CUES.wallBounce],
  );
  assertEqual(bounce.cues[0].frame, bounce.frame);
  assertGreaterThan(bounce.cues[0].gain, 0);
});
