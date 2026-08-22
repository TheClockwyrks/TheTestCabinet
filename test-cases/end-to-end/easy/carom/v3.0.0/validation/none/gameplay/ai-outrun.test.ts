// gameplay/ai-outrun — the Solo opponent is beatable, not superhuman.
//
// The REAL AI starts pinned at the bottom bound and faces a fast, low shot
// arriving near the top. The ball reaches the goal line before a paddle moving at
// the AI's speed could cover the distance, so a correctly-paced opponent misses
// it. An AI that moves faster than it should blocks it and fails here.

import { afterEach, beforeEach, expect, it } from "vitest";
import { PADDLE_MAX_CY, SPEED_CAP } from "../constants";
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

afterEach(async () => {
  await harness.dispose();
});

it("lets a fast shot placed out of reach get past it", async () => {
  await arrangeAiScenario(harness, SCENARIO);

  const { result } = await captureReplay(harness, "scored", async () => {
    const outcome = await driveAiScenario(harness);
    await harness.advance(AFTERMATH_TICKS);
    return outcome;
  });

  expect(result).toBe("scored");
});
