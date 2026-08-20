// gameplay/scoring-p2 — a ball crossing the LEFT goal edge scores for player two.
//
// The mirror of `scoring-p1`: the ball is aimed at the left goal down the lane
// that clears both obstacles, and the build's own scoring code decides the point.

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

it("gives player two the point when the ball leaves the left goal", async () => {
  await startPlaying(harness);
  harness.debug.setScore(0, 0);
  arrangeGoal(harness, "left");

  const point = await driveGoal(harness);

  expect(point.hit).toBe(true);
  expect(point.snapshot.score.p2).toBe(1);
  expect(point.snapshot.score.p1).toBe(0);
});
