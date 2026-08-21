// gameplay/ai-intercepts — the Solo opponent is competent.
//
// The REAL AI is handed control of its paddle and faced with a shot arriving a
// moderate distance from where it starts: a noticeable but coverable gap at its
// own movement speed. Its own tracking decides the outcome — nothing here poses
// the AI's motion — and a reachable shot must be blocked.

import { afterEach, beforeEach, expect, it } from "vitest";
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
  harness.dispose();
});

it("tracks down a reachable shot and blocks it", async () => {
  await arrangeAiScenario(harness, SCENARIO);

  const { result } = await captureReplay(harness, "block", async () => {
    const outcome = await driveAiScenario(harness);
    await harness.advance(AFTERMATH_TICKS);
    return outcome;
  });

  expect(result).toBe("blocked");
});
