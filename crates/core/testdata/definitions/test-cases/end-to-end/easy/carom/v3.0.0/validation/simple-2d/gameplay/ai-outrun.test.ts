// gameplay/ai-outrun — the Solo opponent is beatable, not superhuman.
//
// The REAL AI starts pinned at the bottom bound and faces a fast, low shot
// arriving near the top. The shot reaches the paddle's face in
// (P2_X0 - BALL_R - 700) / 940 = 0.54 s at a height of about 172; to touch it the
// paddle's center must be within PADDLE_HALF + BALL_R = 66 of that, a trip of
// about 427 units from PADDLE_MAX_CY, which at AI_SPEED takes 0.76 s. A paddle
// moving at the rule's speed is about 135 units short when the ball passes, so
// player one scores. An AI that moves faster than it should blocks it.
//
// The field holds that one ball: both obstacles are removed, so nothing can slow
// or turn the shot on its way in, and the human paddle is driven out of the
// lane. Both of the AI's faculties are on, and its paddle is left the AI's.

import { afterEach, beforeEach, it } from "vitest";
import { PADDLE_MAX_CY, SPEED_CAP } from "../constants";
import { assertEqual } from "../assert";
import {
  arrangeAiScenario,
  captureReplay,
  createHarness,
  driveAiScenario,
  type Harness,
} from "../harness";

const SCENARIO = {
  paddleCy: PADDLE_MAX_CY,
  ball: { x: 700, y: 150, vx: SPEED_CAP - 40, vy: 40 },
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

it("lets a fast shot placed out of reach get past it", async () => {
  arrangeAiScenario(harness, SCENARIO);

  const { result } = await captureReplay(harness, "scored", async () => {
    const outcome = await driveAiScenario(harness);
    await harness.advance(AFTERMATH_TICKS);
    return outcome;
  });

  assertEqual(result, "scored");
});
