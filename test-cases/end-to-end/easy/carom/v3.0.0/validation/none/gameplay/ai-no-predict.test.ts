// gameplay/ai-no-predict — the Solo opponent tracks the ball, not its destination.
//
// The REAL AI faces a fast, steep shot fired up into the top wall: it banks there
// and then comes down to the goal. A reasonable opponent chases the ball itself,
// so it follows the ball up toward the wall and cannot recover to the
// post-bounce arrival in time. An AI that predicts the reflected destination — or
// that simply moves faster than it should — blocks it and fails here.

import { afterEach, beforeEach, expect, it } from "vitest";
import { FIELD_CX, FIELD_CY } from "../../src/constants";
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
  harness.dispose();
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
