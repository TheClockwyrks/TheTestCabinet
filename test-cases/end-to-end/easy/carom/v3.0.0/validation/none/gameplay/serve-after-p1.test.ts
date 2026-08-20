// gameplay/serve-after-p1 — after a point is scored ON player one, the next
// serve travels toward player one.
//
// The point is a real one: the ball is aimed down the clear lane at the LEFT
// goal and the build's own simulation carries it out, scoring for player two.
// The serve that follows is then expired and its direction read on the launch
// frame. Nothing is posed about the serve itself, and the score is asserted
// alongside the direction so a build that never scored the point cannot pass by
// serving left out of a countdown it never left.

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

it("serves toward player one after player two scores", async () => {
  await startPlaying(harness);
  harness.debug.setScore(0, 0);
  arrangeGoal(harness, "left");

  const point = await driveGoal(harness);
  expect(point.hit).toBe(true);
  expect(point.snapshot.score.p2).toBe(1);
  expect(point.snapshot.screen).toBe("countdown");

  harness.debug.serve();
  const launched = await harness.until((s) => s.screen === "playing", {
    maxFrames: 60,
    poll: 1,
  });

  expect(launched.hit).toBe(true);
  // Player one defends the LEFT edge: the receiver is the player just scored on.
  expect(launched.snapshot.ball.vx).toBeLessThan(0);
  expect(harness.assetFailures).toEqual([]);
});
