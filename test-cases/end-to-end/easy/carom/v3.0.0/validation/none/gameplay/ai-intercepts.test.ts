// gameplay/ai-intercepts — the Solo opponent is competent.
//
// The REAL AI is handed control of its paddle and faced with a shot arriving a
// moderate distance from where it starts: a noticeable but coverable gap at its
// own movement speed. Its own tracking decides the outcome — nothing here poses
// the AI's motion — and a reachable shot must be blocked.

import { afterEach, beforeEach, expect, it } from "vitest";
import {
  arrangeAiScenario,
  createHarness,
  driveAiScenario,
  type Harness,
} from "../harness";

/** ~200 px off the AI paddle's start, level enough to be run down in time. */
const SCENARIO = { paddleCy: 200, ball: { x: 640, y: 400, vx: 520 } };

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

it("tracks down a reachable shot and blocks it", async () => {
  await arrangeAiScenario(harness, SCENARIO);

  const { result } = await driveAiScenario(harness);

  expect(result).toBe("blocked");
});
