// gameplay/ai-intercepts — the Solo opponent blocks a reachable shot.
//
// specs/modes/single-player.md fixes the AI exactly: with the ball coming,
// `target = ball.y - ball.vy * AI_REACT`, and beyond `AI_DEADZONE` the paddle
// moves at `AI_SPEED` toward it. The REAL AI is handed its paddle 200 units
// above a level shot that takes 1.09 s to arrive; at 560 units per second the
// paddle is on the target in 0.34 s, so the rule blocks the shot: the ball
// comes back off the paddle and player one does not score. Nothing poses the
// AI's motion; its own tracking decides the outcome.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  arrangeAiScenario,
  captureReplay,
  createHarness,
  driveAiScenario,
  type Harness,
} from "../harness";

/** ~200 px off the AI paddle's start, level enough to be run down in time. */
const SCENARIO = { paddleCy: 200, ball: { x: 640, y: 400, vx: 520 } };

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

it("tracks down a reachable shot and blocks it", async () => {
  await arrangeAiScenario(harness, SCENARIO);

  const { result } = await captureReplay(harness, "block", async () => {
    const outcome = await driveAiScenario(harness);
    await harness.advance(AFTERMATH_TICKS);
    return outcome;
  });

  assertEqual(result, "blocked");
});
