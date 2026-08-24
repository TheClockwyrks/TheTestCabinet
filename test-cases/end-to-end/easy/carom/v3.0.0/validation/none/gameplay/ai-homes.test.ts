// gameplay/ai-homes — with the ball moving away, the AI paddle returns to
// center and stops within the home deadzone.
//
// specs/modes/single-player.md fixes the AI exactly: when the ball is not
// coming (`vx <= 0`), `target = AI_HOME_Y` and `deadzone = AI_HOME_DEADZONE`;
// `diff = target - cy`; within the deadzone `vy = 0`, otherwise
// `vy = sign(diff) * min(AI_SPEED, |diff| / dt)`. From `cy = 600` with the
// ball heading left the paddle therefore moves up at `AI_SPEED` and stops on
// the first frame its center is within 18 of 360, reporting `vy = 0` from
// then on. It covers the 222 units it needs in 0.4 s; three quarters of a
// second is watched.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertLessThan,
  assertLessThanOrEqual,
} from "../assert";
import { AI_HOME_DEADZONE, AI_HOME_Y, FIELD_CX, FIELD_CY } from "../constants";
import {
  arrangeAiScenario,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";

const START_CY = 600;
/** A ball heading away from the AI, down the lane that clears both obstacles. */
const BALL = { x: FIELD_CX, y: FIELD_CY, vx: -300, vy: 0 };

const RETURN_TICKS = 90; // 0.75 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("returns toward AI_HOME_Y and stops within AI_HOME_DEADZONE of it", async () => {
  await arrangeAiScenario(harness, { paddleCy: START_CY, ball: BALL });

  const home = await captureReplay(harness, "home", async () => {
    await harness.advance(RETURN_TICKS);
    return (await harness.snapshot()).paddles.right;
  });

  assertLessThan(home.cy, START_CY);
  assertLessThanOrEqual(Math.abs(home.cy - AI_HOME_Y), AI_HOME_DEADZONE);
  assertCloseTo(home.vy, 0, 6);
});
