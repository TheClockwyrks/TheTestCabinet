// paddle-movement/countdown-solo-ai — the AI paddle moves during the countdown
// in Solo.
//
// specs/balls.md (The paddles during the countdown) and
// specs/modes/single-player.md: the pre-serve hold locks the ball, never the
// paddles, and the AI runs its rule on every `countdown` frame. That rule is
// exact: while the screen is not `playing`, `target = AI_HOME_Y` and
// `deadzone = AI_HOME_DEADZONE`, so a paddle posed far from home during the
// countdown moves toward home at `AI_SPEED` and stops within the deadzone. The
// match is started from the title with the menu keys so the build's own
// countdown is what runs; the AI paddle is then posed near the bottom bound and
// handed back to the real AI, and half a second later — with the hold still
// running — it is read: back within the deadzone of home, and the screen still
// the countdown with the ball still held. A build that leaves the AI idle until
// the serve reads the posed height instead.
//
// From `PADDLE_MAX_CY - 20` (645) the trip home is 285 units, 0.51 s at
// `AI_SPEED`; a quarter of a second more sees it stop, and the whole window
// still ends with a fifth of the countdown to run.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertLessThanOrEqual } from "../assert";
import {
  AI_HOME_DEADZONE,
  AI_HOME_Y,
  AI_SPEED,
  PADDLE_MAX_CY,
} from "../constants";
import {
  ball0,
  captureReplay,
  createHarness,
  startWithKeys,
  TICK_HZ,
  type Harness,
} from "../harness";

/** Where the paddle is posed: near the bottom bound, far below home. */
const START_CY = PADDLE_MAX_CY - 20;
/** Frames watched: the trip home at AI_SPEED, plus 0.25 s to see it stop. */
const SETTLE_TICKS =
  Math.ceil(((START_CY - AI_HOME_Y) / AI_SPEED) * TICK_HZ) + 30;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("returns the AI paddle home while the countdown runs (Solo)", async () => {
  await startWithKeys(harness, "solo");
  const opened = await harness.snapshot();
  assertEqual(opened.screen, "countdown");
  assertEqual(ball0(opened).held, true);

  await harness.debug.setPaddle("right", { cy: START_CY, vy: 0 });
  await harness.debug.setAiControl(true);
  assertCloseTo((await harness.snapshot()).paddles.right.cy, START_CY, 6);

  const settled = await captureReplay(harness, "home", async () => {
    await harness.advance(SETTLE_TICKS);
    return await harness.snapshot();
  });

  // Read with the hold still running: what moved, moved during the countdown.
  assertEqual(settled.screen, "countdown");
  assertEqual(ball0(settled).held, true);
  const paddle = settled.paddles.right;
  assertLessThanOrEqual(Math.abs(paddle.cy - AI_HOME_Y), AI_HOME_DEADZONE);
  assertCloseTo(paddle.vy, 0, 6);
});
