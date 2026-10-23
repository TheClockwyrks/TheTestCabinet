// gameplay/ai-deadzone — the AI holds still while the ball is inside its
// deadzone.
//
// specs/modes/single-player.md fixes the AI exactly: with `screen` `playing` and
// the ball coming (`vx > 0`), `target = ball.y - ball.vy * AI_REACT` and
// `deadzone = AI_DEADZONE`; then `diff = target - cy`, and `|diff| <= deadzone`
// makes `vy = 0`. So a paddle standing a few units off the target must report
// `vy` 0 and must not move at all.
//
// THE BALL IS POSED WITH `vy` 0, so `target` is exactly the ball's own y and
// stays there for the whole watch: the lag term contributes nothing, and the
// paddle's distance from the target is the offset this check posed and no other
// figure. The ball is far enough from the right paddle that it never arrives
// inside the window, so the scenario the reading is taken over never changes.
//
// AI_DEADZONE is the only one of the five figures the mode specification names
// that no other point reads: `ai-homes` settles inside AI_HOME_DEADZONE, and the
// three interception points all run the paddle at AI_SPEED.
//
// The paddle is read on EVERY frame rather than once at the end, because a
// paddle that jittered off the target and came back would be still at both ends
// of a single reading and visibly wrong in between.
//
// The field holds that one ball and nothing else, the human paddle is parked out
// of the way, and both of the AI's faculties are on — the deadzone is the rule
// the two of them produce when the target is already under the paddle.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertLessThan } from "../assert";
import { AI_DEADZONE, FIELD_CY } from "../constants";
import {
  arrangeAiScenario,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";

/** How far off the target the paddle stands: inside AI_DEADZONE, and not on it. */
const OFFSET = 6;

/** A ball coming at the AI down a level lane, so `target` is its own y. */
const BALL = { x: 600, y: FIELD_CY, vx: 300, vy: 0 };

/** Frames watched: a quarter second, well before the ball reaches the paddle. */
const WATCH_TICKS = 30;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("reports vy 0 and does not move while the target is inside AI_DEADZONE", async () => {
  const startCy = FIELD_CY + OFFSET;
  assertLessThan(Math.abs(startCy - BALL.y), AI_DEADZONE);
  await arrangeAiScenario(harness, { paddleCy: startCy, ball: BALL });

  const watched = await captureReplay(harness, "still", async () => {
    const frames: { cy: number; vy: number }[] = [];
    for (let i = 0; i < WATCH_TICKS; i += 1) {
      await harness.advance(1);
      frames.push((await harness.snapshot()).paddles.right);
    }
    return frames;
  });

  for (const paddle of watched) {
    assertCloseTo(paddle.vy, 0, 6);
    assertCloseTo(paddle.cy, startCy, 6);
  }
});
