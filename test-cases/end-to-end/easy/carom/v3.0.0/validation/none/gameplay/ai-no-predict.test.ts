// gameplay/ai-no-predict — the Solo opponent tracks the ball, not its
// destination.
//
// specs/modes/single-player.md: the AI's target is the ball's present position
// offset by its present velocity, `ball.y - ball.vy * AI_REACT`, never where a
// banking flight will arrive. The REAL AI faces a fast, steep shot fired up
// into the top wall: it banks there at 0.43 s and comes down to the goal at
// 1.09 s. Under the rule the paddle follows the ball up to about y = 120 and
// then chases it down at `AI_SPEED`, reaching about y = 425 when the ball
// arrives at 553: the shot gets past and player one scores. An AI that aims at
// the reflected destination, or that moves faster than the rule allows, blocks
// it and fails here.

import { afterEach, beforeEach, expect, it } from "vitest";
import { FIELD_CX, FIELD_CY } from "../constants";
import {
  arrangeAiScenario,
  captureReplay,
  createHarness,
  driveAiScenario,
  type Harness,
} from "../harness";

const SCENARIO = {
  paddleCy: FIELD_CY,
  ball: { x: FIELD_CX, y: FIELD_CY, vx: 520, vy: -820 },
};

/**
 * Frames recorded after the shot resolves.
 *
 * `driveAiScenario` returns on the instant the outcome is decided — the frame the
 * ball comes back off the AI paddle, or the frame the score changes — which is
 * exactly where the verdict has to be read. It is the wrong place to stop
 * RECORDING: a block is only legible once the return is under way, and a point is
 * only legible once the scoreboard has turned over. Half a second of what follows
 * is what turns the clip from an approach into an outcome.
 */
const AFTERMATH_TICKS = 60; // 0.5 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("is beaten by a shot that banks off a wall on its way in", async () => {
  await arrangeAiScenario(harness, SCENARIO);

  const { result } = await captureReplay(harness, "scored", async () => {
    const outcome = await driveAiScenario(harness);
    await harness.advance(AFTERMATH_TICKS);
    return outcome;
  });

  expect(result).toBe("scored");
});
