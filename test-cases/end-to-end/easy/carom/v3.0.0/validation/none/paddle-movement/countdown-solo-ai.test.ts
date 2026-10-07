// paddle-movement/countdown-solo-ai — the AI paddle moves during the countdown
// in Solo.
//
// specs/balls.md (The paddles during the countdown) and
// specs/modes/single-player.md: the pre-serve hold locks the ball, never the
// paddles, and the AI runs its rule on every `countdown` frame. That rule is
// exact: while the screen is not `playing`, `target = AI_HOME_Y` and
// `deadzone = AI_HOME_DEADZONE`, so a paddle posed far from home during the
// countdown moves toward home at `AI_SPEED` and stops within the deadzone. The
// match is opened on its countdown through the debug surface so the build's own
// countdown is what runs; the AI paddle is then posed near the bottom bound and
// half a second later — with the hold still running — it is read: back within the
// deadzone of home, and the screen still the countdown with the ball still held.
// A build that leaves the AI idle until the serve reads the posed height instead.
//
// THE PADDLE IS POSED WITH BOTH FACULTIES. The AI senses and the AI travels are
// two gates now (`setAiTracking`, `setAiMovement`), and this point is about the
// paddle actually MOVING toward the target the rule names, so both are on. The
// paddle itself is left with the AI: `setPaddleCy` moves it without taking it,
// and a paddle taken by `setPaddleDriven` would be moved by this check rather
// than by the opponent it is measuring.
//
// THE FIELD HOLDS THE HELD BALL AND THE PADDLES. The ball stays because it is
// this point's witness — a countdown is a countdown because the ball is still
// waiting on it, and it is also what the AI is NOT tracking, since a held ball
// is not coming toward it — and the obstacles come off, because the AI's rule
// never reads them.
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
  enableAi,
  isolateBall,
  openCountdown,
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
  await openCountdown(harness, "solo");
  await isolateBall(harness);
  const opened = await harness.snapshot();
  assertEqual(opened.screen, "countdown");
  assertEqual(ball0(opened).held, true);

  await harness.debug.setPaddleCy("right", START_CY);
  await enableAi(harness);
  const posed = await harness.snapshot();
  assertCloseTo(posed.paddles.right.cy, START_CY, 6);
  // Posed, not driven: what moves the paddle from here is the opponent's own
  // rule, and the surface is holding nothing.
  assertEqual(posed.paddles.right.driven, false);
  assertEqual(posed.ai.tracking, true);
  assertEqual(posed.ai.movement, true);

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
