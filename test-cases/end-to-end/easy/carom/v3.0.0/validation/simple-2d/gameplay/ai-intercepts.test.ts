// gameplay/ai-intercepts — the Solo opponent is competent.
//
// The REAL AI is handed control of its paddle and faced with a level shot
// arriving 200 units from where its center starts. Under the rule
// (specs/modes/single-player.md) the target is the ball's own height, the
// paddle closes the gap at AI_SPEED in 200 / 560 = 0.36 s, and the shot takes
// (P2_X0 - BALL_R - 640) / 520 = 1.09 s to arrive, so the paddle is waiting on
// the ball's line with most of a second to spare and must block it. Its own
// tracking decides the outcome; nothing here poses the AI's motion.

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

afterEach(() => {
  harness?.dispose();
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
