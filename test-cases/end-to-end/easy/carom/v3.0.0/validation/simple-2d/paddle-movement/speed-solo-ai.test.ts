// paddle-movement/speed-solo-ai — the AI paddle's chase speed.
//
// The REAL AI is handed control of its paddle and given a ball far down the field
// to chase, and the distance it covers over a short window while chasing at full
// speed is measured back into a speed. Nothing poses the AI's motion: its own
// tracking, at its own pace, is what is measured.
//
// The bound is a band rather than a figure. The AI eases off as it nears its
// target and its speed is deliberately below the human's so it stays beatable, so
// what a check can honestly require is that it chases at a competent,
// non-trivial rate AND stays slower than a player.

import { afterEach, beforeEach, expect, it } from "vitest";
import { PADDLE_SPEED } from "../../src/constants";
import {
  arrangeAiChase,
  createHarness,
  driveAiChaseSpeed,
  type Harness,
} from "../harness";

/** The old browser suite's floor: a competent, non-trivial chase, in px/s. */
const CHASE_FLOOR = 250;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

it("chases the ball competently, and slower than a human paddle", async () => {
  await arrangeAiChase(harness);

  const chase = await driveAiChaseSpeed(harness);

  expect(chase.speed).toBeGreaterThan(CHASE_FLOOR);
  expect(chase.speed).toBeLessThan(PADDLE_SPEED);
});
