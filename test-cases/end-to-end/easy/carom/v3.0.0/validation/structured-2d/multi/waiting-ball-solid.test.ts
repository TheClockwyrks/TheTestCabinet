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
// not moved and is still holding. That its hold TIMER was untouched is read
// through the launch that timer times: the target leaves on the frame its own
// full hold elapses, counted from the frame the match opened, so a contact that
// reset its hold would land the launch late and one that ended it would land it
// early.

import { afterEach, beforeEach, it } from "vitest";
import { BALL_HOMES } from "../../src/constants";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { captureReplay, createHarness, type Harness } from "../harness";
import {
  HOLD_TICKS,
  HOLD_TOLERANCE_TICKS,
  driveLaunch,
  readBalls,
} from "./harness";

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
  h.debug.reset();
  await h.advance(1);
  h.debug.startMatch("versus");
  // The frame that opens the match world: a level transition is honored at the
  // end of the next advanced frame, and every pose below acts on the open match.
  await h.advance(1);
  // The frame the match opened on: the holds run from here, and the launch the
  // final assertion counts to is measured against it.
  const openedAt = h.engine.frame().count;
  // Ball one waits on its own home at the field center; ball zero is aimed
  // straight along that line at it. Ball two waits well below the lane.
  h.debug.setBall(0, {
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
    Math.abs(h.engine.frame().count - openedAt - HOLD_TICKS),
    HOLD_TOLERANCE_TICKS,
  );
});
