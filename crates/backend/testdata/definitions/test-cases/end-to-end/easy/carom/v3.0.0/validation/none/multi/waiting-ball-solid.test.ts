// multi/waiting-ball-solid — a ball waiting on its home point is an immovable
// body, and keeps its place and its hold when something hits it.
//
// A match is opened on its countdown and the field is cleared back to the two
// balls this rule is about, each spawned onto its own home, held, with a full
// timer. ONE of them is then posed into flight aimed straight at the other's home
// point. Posing a ball ends its own hold and nothing else
// (specs/instrumentation.md), so the target is still waiting when the moving ball
// arrives — the crossing takes about half of the hold, so what it meets is a
// waiting ball rather than a launched one.
//
// The third ball is off the field rather than waiting somewhere below the lane,
// and the obstacles come off with it: the rule is about a moving ball and a
// waiting one, and those two are all the field carries.
//
// The two halves of the rule are read on the frame of the contact: the moving
// ball comes back off the target at the speed it arrived with, and the target has
// not moved and is still holding.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { BALL_HOMES } from "../constants";
import {
  captureReplay,
  createMultiHarness,
  openCountdown,
  placeBall,
  type MultiHarness,
} from "../harness";
import { ballAt, isolateBalls } from "./harness";

/** The ball driven at the other, and the ball left waiting on its home. */
const MOVING = 0;
const WAITING = 1;

/** Where the moving ball starts, and how fast it travels, in units per second. */
const START_X = 400;
const APPROACH = 420;

/** How far the target may drift, in logical units, and still count as immovable. */
const STILL_MAX = 1;

/** How far the rebound speed may miss the approach: one percent, rounding room. */
const SPEED_TOLERANCE = APPROACH * 0.01;

/** Frames of the departure recorded after the contact. */
const DEPARTURE_TICKS = 40; // 0.33 s

let h: MultiHarness;

beforeEach(async () => {
  h = await createMultiHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("bounces a moving ball off a waiting one without moving it", async () => {
  await openCountdown(h, "versus");
  await isolateBalls(h, [MOVING, WAITING]);
  // The waiting ball sits on its own home at the field center; the moving one is
  // aimed straight along that line at it.
  await placeBall(
    h,
    { x: START_X, y: BALL_HOMES[WAITING].y, vx: APPROACH },
    MOVING,
  );

  const bounce = await captureReplay(h, "bounce", async () => {
    const met = await h.until((s) => ballAt(s, MOVING).vx < 0, {
      maxFrames: 100,
      poll: 1,
    });
    // Read HERE, on the frame the moving ball turned round: whether the waiting
    // ball moved is a question about that instant, and its own hold runs out
    // shortly afterwards.
    const moving = ballAt(met.snapshot, MOVING);
    const waiting = ballAt(met.snapshot, WAITING);
    await h.advance(DEPARTURE_TICKS);
    return { met, moving, waiting };
  });

  assertEqual(bounce.met.hit, true);
  const { moving, waiting } = bounce;

  // The waiting ball is where it was, motionless, and still counting its own
  // hold down rather than having been knocked into play.
  assertEqual(waiting.held, true);
  assertLessThanOrEqual(Math.abs(waiting.x - BALL_HOMES[WAITING].x), STILL_MAX);
  assertLessThanOrEqual(Math.abs(waiting.y - BALL_HOMES[WAITING].y), STILL_MAX);
  assertLessThanOrEqual(Math.hypot(waiting.vx, waiting.vy), STILL_MAX);

  // The moving ball reflected off it, head on so `vx` simply reversed, and kept
  // the speed it arrived with: a ball bouncing off a waiting one is not a
  // paddle hit.
  assertLessThanOrEqual(Math.abs(moving.vx + APPROACH), SPEED_TOLERANCE);
  assertLessThanOrEqual(Math.abs(moving.speed - APPROACH), SPEED_TOLERANCE);
});
