// multi/waiting-ball-solid — a ball waiting on its home point is an immovable
// body, and keeps its place and its hold when something hits it.
//
// The field is posed to hold TWO BALLS, both waiting out a full hold, and then
// ONE of them is taken out of its hold and aimed straight at the other's home
// point. Each operation sets one field (specs/instrumentation.md), so ending the
// mover's hold leaves the target's alone, and the target is still waiting when
// the mover arrives — the whole contact happens well inside the hold, so what it
// meets is a waiting ball rather than a launched one.
//
// The third ball is REMOVED rather than left on a home point out of the lane, and
// so are both obstacles: a waiting ball is exactly the kind of body this check
// would otherwise be measuring against by accident. What is left on the field is
// the mover, the target, and the two paddles the game always has — neither of
// which the mover reaches, since it turns round at the field center.
//
// The two halves of the rule are read on the frame of the contact: the moving
// ball comes back off the target at the speed it arrived with, and the target has
// not moved and is still holding.

import { afterEach, beforeEach, it } from "vitest";
import { BALL_HOMES } from "../constants";
import { assertCloseTo, assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  enterPlaying,
  poseWorld,
  seconds,
  type Harness,
} from "../harness";
import { ballAt, holdTimerOf } from "./harness";

/** Which ball moves, and which waits on its home point in its path. */
const MOVER = 0;
const TARGET = 1;

/** Where the moving ball starts, and how fast it travels, in units per second. */
const START_X = 400;
const APPROACH = 420;

/** A float margin on "keeps its home point": the waiting ball is never moved. */
const STILL_MAX = 1e-6;

/** The review item's margin: one percent of the arrival speed. */
const SPEED_TOLERANCE = APPROACH * 0.01;

/** Frames of the departure recorded after the contact. */
const DEPARTURE_TICKS = 40; // 0.33 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("bounces a moving ball off a waiting one without moving it", async () => {
  enterPlaying(h);
  // Both spawned as a match start leaves them: on their own home points, held,
  // with a full hold timer. `live: false` is what keeps the target waiting.
  poseWorld(h, { balls: [MOVER, TARGET], live: false });
  // The mover alone is taken out of its hold and aimed along the line joining the
  // two home points, straight at the target.
  h.multi.setBallHeld(MOVER, false);
  h.multi.setBallHoldTimer(MOVER, 0);
  h.multi.setBallPosition(MOVER, START_X, BALL_HOMES[TARGET].y);
  h.multi.setBallVelocity(MOVER, APPROACH, 0);
  h.multi.setBallSpin(MOVER, 0);

  const holdBefore = holdTimerOf(h, TARGET);
  const bounce = await captureReplay(h, "bounce", async () => {
    const met = await h.until((s) => ballAt(s, MOVER).vx < 0, {
      maxFrames: 100,
      poll: 1,
    });
    // Read HERE, on the frame the moving ball turned round: whether the waiting
    // ball moved is a question about that instant, and its own hold runs out
    // shortly afterwards.
    const hold = holdTimerOf(h, TARGET);
    await h.advance(DEPARTURE_TICKS);
    return { met, hold };
  });

  assertEqual(bounce.met.hit, true);
  const moving = ballAt(bounce.met.snapshot, MOVER);
  const waiting = ballAt(bounce.met.snapshot, TARGET);

  // The waiting ball is where it was, motionless, and still counting its own
  // hold down rather than having been knocked into play.
  assertEqual(waiting.held, true);
  assertLessThanOrEqual(Math.abs(waiting.x - BALL_HOMES[TARGET].x), STILL_MAX);
  assertLessThanOrEqual(Math.abs(waiting.y - BALL_HOMES[TARGET].y), STILL_MAX);
  assertLessThanOrEqual(Math.hypot(waiting.vx, waiting.vy), STILL_MAX);
  // Its hold timer has counted down by exactly the frames that passed and
  // nothing else: every countdown or playing frame subtracts `dt`
  // (specs/balls.md), and the contact neither resets nor ends it.
  assertCloseTo(bounce.hold, holdBefore - seconds(bounce.met.frames), 6);

  // The moving ball reflected off it, `vx` reversed, and kept the speed it
  // arrived with: a ball bouncing off a waiting one is not a paddle hit.
  assertLessThanOrEqual(Math.abs(moving.vx + APPROACH), SPEED_TOLERANCE);
  assertLessThanOrEqual(Math.abs(moving.speed - APPROACH), SPEED_TOLERANCE);
});
