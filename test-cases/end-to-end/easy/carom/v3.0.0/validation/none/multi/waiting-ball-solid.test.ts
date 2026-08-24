// multi/waiting-ball-solid — a ball waiting on its home point is an immovable
// body, and keeps its place and its hold when something hits it.
//
// A match is opened, which leaves all three balls waiting with a full hold, and
// then ONE of them is posed into flight aimed straight at the next one's home
// point. Posing a ball ends its own hold and nothing else
// (specs/instrumentation.md), so the target is still waiting when the moving ball
// arrives — and the whole contact happens well inside the hold, so what it meets
// is a waiting ball rather than a launched one.
//
// The two halves of the rule are read on the frame of the contact: the moving
// ball comes back off the target at the speed it arrived with, and the target has
// not moved and is still holding.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { BALL_HOMES } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import { readBalls } from "./harness";

/** Where the moving ball starts, and how fast it travels, in units per second. */
const START_X = 400;
const APPROACH = 420;

/** How far the target may drift, in logical units, and still count as immovable. */
const STILL_MAX = 1;

/** How far the rebound speed may miss the approach: one percent, rounding room. */
const SPEED_TOLERANCE = APPROACH * 0.01;

/** Frames of the departure recorded after the contact. */
const DEPARTURE_TICKS = 40; // 0.33 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("bounces a moving ball off a waiting one without moving it", async () => {
  await h.debug.reset();
  await h.debug.startMatch("versus");
  // Ball one waits on its own home at the field center; ball zero is aimed
  // straight along that line at it. Ball two waits well below the lane.
  await h.debug.setBall(0, {
    x: START_X,
    y: BALL_HOMES[1].y,
    vx: APPROACH,
    vy: 0,
    spin: 0,
  });

  const bounce = await captureReplay(h, "bounce", async () => {
    const met = await h.until((s) => readBalls(s)[0].vx < 0, {
      maxFrames: 100,
      poll: 1,
    });
    // Read HERE, on the frame the moving ball turned round: whether the waiting
    // ball moved is a question about that instant, and its own hold runs out
    // shortly afterwards.
    const balls = readBalls(met.snapshot);
    await h.advance(DEPARTURE_TICKS);
    return { met, balls };
  });

  assertEqual(bounce.met.hit, true);
  const [moving, waiting] = bounce.balls;

  // The waiting ball is where it was, motionless, and still counting its own
  // hold down rather than having been knocked into play.
  assertEqual(waiting.held, true);
  assertLessThanOrEqual(Math.abs(waiting.x - BALL_HOMES[1].x), STILL_MAX);
  assertLessThanOrEqual(Math.abs(waiting.y - BALL_HOMES[1].y), STILL_MAX);
  assertLessThanOrEqual(Math.hypot(waiting.vx, waiting.vy), STILL_MAX);

  // The moving ball reflected off it, head on so `vx` simply reversed, and kept
  // the speed it arrived with: a ball bouncing off a waiting one is not a
  // paddle hit.
  assertLessThanOrEqual(Math.abs(moving.vx + APPROACH), SPEED_TOLERANCE);
  assertLessThanOrEqual(Math.abs(moving.speed - APPROACH), SPEED_TOLERANCE);
});
