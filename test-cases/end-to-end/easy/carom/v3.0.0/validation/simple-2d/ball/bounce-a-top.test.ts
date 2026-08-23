// ball/bounce-a-top — the ball reflects off obstacle A's top face.
//
// The ball is fired vertically, downward, at the midpoint of that face; the build's own
// collision code reflects it. specs/playfield.md fixes the result exactly: the
// struck face is the top one, so `vy` is reversed, `vx` is left as it
// is, and the ball's center is placed `BALL_R` off the face, at `y0 - BALL_R`. The other
// three faces are the sibling checks, so a build that resolves only some of them
// fails exactly the ones it gets wrong.
//
// Placement is read at the end of the frame of the contact. The frame is cut
// into sub-steps (specs/balls.md), and a sub-step that follows the one that
// struck carries the ball on from the face, so the center is read within one
// frame of travel of the face, on the near side of it.

import { afterEach, beforeEach, expect, it } from "vitest";
import { BALL_R, OBSTACLES } from "../../src/constants";
import {
  arrangeFaceShot,
  ball0,
  captureReplay,
  createHarness,
  driveFaceShot,
  startPlaying,
  TICK_HZ,
  type Harness,
} from "../harness";

const RECT = OBSTACLES[0];
/** Where the center lands off the struck face. */
const PLACED = RECT.y0 - BALL_R;
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

it("banks the ball off obstacle A's top face", async () => {
  await startPlaying(harness);
  const shot = arrangeFaceShot(harness, RECT, "top", {
    speed: SPEED,
    runUp: RUN_UP,
  });

  const bank = await captureReplay(harness, "bank", async () => {
    const rebound = await driveFaceShot(harness, "top");
    await harness.advance(DEPARTURE_TICKS);
    return rebound;
  });

  expect(bank.hit).toBe(true);
  const ball = ball0(bank.snapshot);
  expect(ball.vy).toBeCloseTo(-shot.vy, 6);
  expect(ball.vx).toBeCloseTo(shot.vx, 6);
  expect(ball.y).toBeLessThanOrEqual(PLACED + 1e-6);
  expect(ball.y).toBeGreaterThanOrEqual(PLACED - FRAME_TRAVEL);
});
