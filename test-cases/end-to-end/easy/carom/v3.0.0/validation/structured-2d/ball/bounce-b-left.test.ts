// ball/bounce-b-left — the ball reflects off obstacle B's left face.
//
// The ball is fired level at the midpoint of that face; the build's own
// collision code reflects it. specs/playfield.md fixes the result exactly: the
// struck face is the left one, so `vx` is reversed, `vy` is left as it
// is, and the ball's center is placed `BALL_R` off the face, at `x0 - BALL_R`. The other
// three faces are the sibling checks, so a build that resolves only some of them
// fails exactly the ones it gets wrong.
//
// The field holds obstacle B and one ball, and nothing else: the other
// obstacle is off the field rather than parked out of the way, so a shot
// that missed the struck face cannot bank off it and read as this rebound.
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
  TICK_HZ,
  type Harness,
} from "../harness";

/** Obstacle B, in the order of `OBSTACLE_CENTERS`: the only one on field. */
const OBSTACLE = 1;
const RECT = OBSTACLES[OBSTACLE];
/** Where the center lands off the struck face. */
const PLACED = RECT.x0 - BALL_R;
/** The approach, in units per second; one frame of it bounds the placement. */
const SPEED = 600;
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

it("banks the ball off obstacle B's left face", async () => {
  const shot = await arrangeFaceShot(harness, OBSTACLE, "left", {
    speed: SPEED,
  });

  const bank = await captureReplay(harness, "bank", async () => {
    const rebound = await driveFaceShot(harness, "left");
    await harness.advance(DEPARTURE_TICKS);
    return rebound;
  });

  assertEqual(bank.hit, true);
  const ball = ball0(bank.snapshot);
  assertCloseTo(ball.vx, -shot.vx, 6);
  assertCloseTo(ball.vy, shot.vy, 6);
  assertLessThanOrEqual(ball.x, PLACED + 1e-6);
  assertGreaterThanOrEqual(ball.x, PLACED - FRAME_TRAVEL);
});
