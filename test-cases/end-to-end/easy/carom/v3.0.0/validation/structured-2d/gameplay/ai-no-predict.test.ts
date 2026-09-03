// gameplay/ai-no-predict — the Solo opponent tracks the ball, not its destination.
//
// The REAL AI faces a fast, steep shot fired up into the top wall: it banks
// there at 0.43 s and comes down to cross the paddle's face at about 553, at
// 1.09 s. The rule's target is `ball.y - ball.vy * AI_REACT`, the ball's lagged
// line, so the paddle first follows the ball up the field and only turns down
// after the bank; from there it cannot cover the distance at AI_SPEED, and
// under the rule it is over 120 units from the ball's line when the ball
// passes, far more than the 66 a contact needs. An AI that predicts the
// reflected destination, or that moves faster than it should, blocks it.

import { afterEach, beforeEach, it } from "vitest";
import { FIELD_CX, FIELD_CY } from "../constants";
import { assertEqual } from "../assert";
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

afterEach(() => {
  harness?.dispose();
});

it("is beaten by a shot that banks off a wall on its way in", async () => {
  await arrangeAiScenario(harness, SCENARIO);

  const { result } = await captureReplay(harness, "scored", async () => {
    const outcome = await driveAiScenario(harness);
    await harness.advance(AFTERMATH_TICKS);
    return outcome;
  });

  assertEqual(result, "scored");
});
