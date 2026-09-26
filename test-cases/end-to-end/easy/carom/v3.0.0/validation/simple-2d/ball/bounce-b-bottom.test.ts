// ball/bounce-b-bottom — the ball reflects off obstacle B's bottom face.
//
// The ball is fired vertically, upward, at the midpoint of that face; the build's own
// collision code reflects it. specs/playfield.md fixes the result exactly: the
// struck face is the bottom one, so `vy` is reversed, `vx` is left as it
// is, and the ball's center is placed `BALL_R` off the face, at `y1 + BALL_R`. The other
// three faces are the sibling checks, so a build that resolves only some of them
// fails exactly the ones it gets wrong.
//
// The field holds that ball and that one obstacle and nothing else. The world
// is cleared and only the struck obstacle is spawned back, so the bank the
// assertions read is a bank off the face the point names: the other obstacle is
// not standing somewhere the flight might reach it, it is gone. The paddles are
// field furniture the game always has, so both are driven out of the lane
// instead.
//
// Placement is read at the end of the frame of the contact. The frame is cut
// into sub-steps (specs/balls.md), and a sub-step that follows the one that
// struck carries the ball on from the face, so the center is read within one
// frame of travel of the face, on the near side of it.

import { afterEach, beforeEach, it } from "vitest";
import { BALL_R, OBSTACLES } from "../constants";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import {
  arrangeFaceShot,
  ball0,
  captureReplay,
  createHarness,
  driveFaceShot,
  enterPlaying,
  TICK_HZ,
  type Harness,
} from "../harness";

/** Which obstacle the shot is at, in the order of `OBSTACLE_CENTERS`. */
const OBSTACLE = 1;
const RECT = OBSTACLES[OBSTACLE];
/** Where the center lands off the struck face. */
const PLACED = RECT.y1 + BALL_R;
/** The approach, in units per second; one frame of it bounds the placement. */
const SPEED = 600;
/** Short of the face by this much: a vertical shot starts inside the field. */
const RUN_UP = 100;
const FRAME_TRAVEL = SPEED / TICK_HZ;

/**
 * Frames of the departing flight recorded after the rebound, inside the same
 * recorded section, so the rebound the assertions read is still the sweep's own
 * frame while the clip shows the bank leaving the face.
 */
const DEPARTURE_TICKS = 60; // 0.5 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("banks the ball off obstacle B's bottom face", async () => {
  enterPlaying(harness);
  const shot = arrangeFaceShot(harness, OBSTACLE, "bottom", {
    speed: SPEED,
    runUp: RUN_UP,
  });

  const bank = await captureReplay(harness, "bank", async () => {
    const rebound = await driveFaceShot(harness, "bottom");
    await harness.advance(DEPARTURE_TICKS);
    return rebound;
  });

  assertEqual(bank.hit, true);
  const ball = ball0(bank.snapshot);
  assertCloseTo(ball.vy, -shot.vy, 6);
  assertCloseTo(ball.vx, shot.vx, 6);
  assertGreaterThanOrEqual(ball.y, PLACED - 1e-6);
  assertLessThanOrEqual(ball.y, PLACED + FRAME_TRAVEL);
});
