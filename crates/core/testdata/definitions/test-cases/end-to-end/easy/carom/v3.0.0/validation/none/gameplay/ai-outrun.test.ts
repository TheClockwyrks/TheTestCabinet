// gameplay/ai-outrun — the Solo opponent is outrun by a shot out of reach.
//
// specs/modes/single-player.md caps the AI at `AI_SPEED` (560 units per
// second). The REAL AI starts pinned at the bottom bound and faces a fast, low
// shot arriving near the top: the ball covers the 505 units to the paddle's
// face in 0.54 s, in which the paddle climbs 300 of the 490 it needs, so under
// the rule the shot gets past and player one scores. An AI that moves faster
// than the rule allows blocks it and fails here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
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

  assertEqual(result, "scored");
});
