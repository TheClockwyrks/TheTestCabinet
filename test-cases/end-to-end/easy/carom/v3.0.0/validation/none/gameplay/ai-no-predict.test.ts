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
  createHarness,
  driveAiScenario,
  type Harness,
} from "../harness";

const SCENARIO = {
  paddleCy: FIELD_CY,
  ball: { x: FIELD_CX, y: FIELD_CY, vx: 520, vy: -820 },
};

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

it("is beaten by a shot that banks off a wall on its way in", async () => {
  await arrangeAiScenario(harness, SCENARIO);

  const { result } = await driveAiScenario(harness);

  expect(result).toBe("scored");
});
