// gameplay/serve-after-p2 — after a point is scored ON player two, the next
// serve travels toward player two.
//
// The mirror of `serve-after-p1`, driven out the RIGHT goal so player one
// scores. Kept as its own check so a build that always serves one way fails the
// side it gets wrong rather than averaging out across the two.

import { afterEach, beforeEach, expect, it } from "vitest";
import {
  arrangeGoal,
  createHarness,
  driveGoal,
  startPlaying,
  type Harness,
} from "../harness";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

it("serves toward player two after player one scores", async () => {
  await startPlaying(harness);
  harness.debug.setScore(0, 0);
  arrangeGoal(harness, "right");

  const point = await driveGoal(harness);
  expect(point.hit).toBe(true);
  expect(point.snapshot.score.p1).toBe(1);
  expect(point.snapshot.screen).toBe("countdown");

  harness.debug.serve();
  const launched = await harness.until((s) => s.screen === "playing", {
    maxFrames: 60,
    poll: 1,
  });

  expect(launched.hit).toBe(true);
  // Player two defends the RIGHT edge: the receiver is the player just scored on.
  expect(launched.snapshot.ball.vx).toBeGreaterThan(0);
  expect(harness.assetFailures).toEqual([]);
});
