// gameplay/ai-homes — with nothing to defend, the AI returns to its home height.
//
// The REAL AI is handed its paddle, posed well below its home height, with the
// ball travelling AWAY from it. The rule (specs/modes/single-player.md) then has
// `target = AI_HOME_Y` and `deadzone = AI_HOME_DEADZONE`: the paddle moves
// toward AI_HOME_Y at AI_SPEED and stops, with `vy = 0`, on the first frame its
// center is within AI_HOME_DEADZONE of it. Long enough is allowed for that trip
// and more, and the paddle is then read where it settled.

import { afterEach, beforeEach, it } from "vitest";
import {
  AI_HOME_DEADZONE,
  AI_HOME_Y,
  AI_SPEED,
  PADDLE_MAX_CY,
} from "../constants";
import {
  assertCloseTo,
  assertLessThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  arrangeAiHome,
  captureReplay,
  createHarness,
  TICK_HZ,
  type Harness,
} from "../harness";

/** Where the paddle starts: near the bottom bound, far below home. */
const START_CY = PADDLE_MAX_CY - 20;
/** Twice the frames the trip home takes at AI_SPEED. */
const SETTLE_TICKS =
  2 * Math.ceil(((START_CY - AI_HOME_Y) / AI_SPEED) * TICK_HZ);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("returns toward AI_HOME_Y and stops within AI_HOME_DEADZONE of it", async () => {
  await arrangeAiHome(harness, { paddleCy: START_CY });
  assertCloseTo(harness.snapshot().paddles.right.cy, START_CY, 6);

  const settled = await captureReplay(harness, "home", async () => {
    // Every frame's reading, so the approach is seen to be toward home and
    // never past it.
    const heights: number[] = [];
    for (let i = 0; i < SETTLE_TICKS; i += 1) {
      await harness.advance(1);
      heights.push(harness.snapshot().paddles.right.cy);
    }
    return { heights, paddle: harness.snapshot().paddles.right };
  });

  // Toward home on every frame: never away from it.
  let previous = START_CY;
  for (const cy of settled.heights) {
    assertLessThanOrEqual(cy, previous + 1e-6);
    previous = cy;
  }
  // Settled within the home deadzone, stopped.
  assertLessThanOrEqual(
    Math.abs(settled.paddle.cy - AI_HOME_Y),
    AI_HOME_DEADZONE,
  );
  assertCloseTo(settled.paddle.vy, 0, 6);
  // And it really travelled: it is no longer where it was posed.
  assertLessThan(settled.paddle.cy, START_CY - AI_HOME_DEADZONE);
});
