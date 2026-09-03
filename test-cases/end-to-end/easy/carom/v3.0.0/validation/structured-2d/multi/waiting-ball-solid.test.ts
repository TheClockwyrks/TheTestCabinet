// multi/waiting-ball-solid — a ball waiting on its home point is an immovable
// body, and keeps its place and its hold when something hits it.
//
// The field is posed with the PAIR this point is about and nothing else: two
// balls spawned onto their home points at one instant, each with a full hold, and
// no obstacle anywhere. One of them is then put into flight aimed straight at the
// other's home point. Only the moving ball's own hold is ended
// (specs/instrumentation.md: each operation sets one field), so the target is
// still waiting when it arrives — and the whole contact happens well inside the
// hold, so what it meets is a waiting ball rather than a launched one.
//
// The two paddles cannot be removed, so both are held out of the lane the moving
// ball travels along and comes back down.
//
// The two halves of the rule are read on the frame of the contact: the moving
// ball comes back off the target at the speed it arrived with, and the target has
// not moved and is still holding. That its hold TIMER was untouched is read
// through the launch that timer times: the target leaves on the frame its own
// full hold elapses, counted from the frame the pair was spawned, so a contact
// that reset its hold would land the launch late and one that ended it would land
// it early.

import { afterEach, beforeEach, it } from "vitest";
import { BALL_HOMES } from "../constants";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  isolateField,
  openCountdown,
  parkPaddles,
  type Harness,
} from "../harness";
import {
  HOLD_TICKS,
  HOLD_TOLERANCE_TICKS,
  ballAt,
  driveLaunch,
  multiOps,
} from "./harness";

/** How many balls this point is about: the one moving, and the one waiting. */
const PAIR = 2;

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
  await openCountdown(h, "versus");
  isolateField(h, { balls: PAIR });
  parkPaddles(h);
  // The instant the pair was spawned: both holds run from here, and the launch
  // the final assertion counts to is measured against it.
  const spawnedAt = h.engine.frame().count;

  // Ball one waits on its own home at the field center; ball zero is put into
  // flight straight along that line at it, one atomic pose at a time.
  const ops = multiOps(h);
  ops.setBallHeld(0, false);
  ops.setBallPosition(0, START_X, BALL_HOMES[1].y);
  ops.setBallVelocity(0, APPROACH, 0);
  ops.setBallSpin(0, 0);

  const bounce = await captureReplay(h, "bounce", async () => {
    const met = await h.until((s) => ballAt(s, 0).vx < 0, {
      maxFrames: 100,
      poll: 1,
    });
    // Read HERE, on the frame the moving ball turned round: whether the waiting
    // ball moved is a question about that instant, and its own hold runs out
    // shortly afterwards.
    const pair = [ballAt(met.snapshot, 0), ballAt(met.snapshot, 1)];
    await h.advance(DEPARTURE_TICKS);
    return { met, pair };
  });

  assertEqual(bounce.met.hit, true);
  const [moving, waiting] = bounce.pair;

  // The waiting ball is where it was, motionless, and still holding rather than
  // having been knocked into play.
  assertEqual(waiting.held, true);
  assertLessThanOrEqual(Math.abs(waiting.x - BALL_HOMES[1].x), STILL_MAX);
  assertLessThanOrEqual(Math.abs(waiting.y - BALL_HOMES[1].y), STILL_MAX);
  assertLessThanOrEqual(Math.hypot(waiting.vx, waiting.vy), STILL_MAX);

  // The moving ball reflected off it, `vx` reversed, and kept the speed it
  // arrived with: a ball bouncing off a waiting one is not a paddle hit.
  assertLessThanOrEqual(Math.abs(moving.vx + APPROACH), SPEED_TOLERANCE);
  assertLessThanOrEqual(Math.abs(moving.speed - APPROACH), SPEED_TOLERANCE);

  // Its hold timer has counted down through the contact and nothing else: every
  // countdown or playing frame subtracts `dt` (specs/balls.md), so the ball
  // leaves on the frame the full hold elapses — the contact neither reset nor
  // ended it.
  const relaunch = await driveLaunch(h, 1);
  assertEqual(relaunch.hit, true);
  assertLessThanOrEqual(
    Math.abs(h.engine.frame().count - spawnedAt - HOLD_TICKS),
    HOLD_TOLERANCE_TICKS,
  );
});
