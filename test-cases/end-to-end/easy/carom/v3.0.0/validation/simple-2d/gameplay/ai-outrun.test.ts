// gameplay/ai-outrun — the Solo opponent is beatable, not superhuman.
//
// The REAL AI starts pinned at the bottom bound and faces a fast, low shot
// arriving near the top. The ball reaches the goal line before a paddle moving at
// the AI's speed could cover the distance, so a correctly-paced opponent misses
// it. An AI that moves faster than it should blocks it and fails here.

import { afterEach, beforeEach, expect, it } from "vitest";
import { PADDLE_MAX_CY, SPEED_CAP } from "../../src/constants";
import {
  arrangeAiScenario,
  createHarness,
  driveAiScenario,
  type Harness,
} from "../harness";

const SCENARIO = {
  paddleCy: PADDLE_MAX_CY,
  ball: { x: 700, y: 150, vx: SPEED_CAP - 40, vy: 40 },
};

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

it("lets a fast shot placed out of reach get past it", async () => {
  await arrangeAiScenario(harness, SCENARIO);

  const { result } = await driveAiScenario(harness);

  expect(result).toBe("scored");
});
