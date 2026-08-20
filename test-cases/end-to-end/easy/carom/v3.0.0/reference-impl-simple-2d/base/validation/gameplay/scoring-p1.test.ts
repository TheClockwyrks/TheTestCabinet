// gameplay/scoring-p1 — a ball crossing the RIGHT goal edge scores for player one.
//
// The ball is aimed at the right goal down the lane that clears both obstacles;
// the real simulation carries it across the edge and the build's own scoring code
// increments the score, which is read back. The left goal is the sibling
// `scoring-p2` check, so a build that scores on only one edge fails the side it
// gets wrong rather than passing on an average.

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

it("gives player one the point when the ball leaves the right goal", async () => {
  await startPlaying(harness);
  harness.debug.setScore(0, 0);
  arrangeGoal(harness, "right");

  const point = await driveGoal(harness);

  expect(point.hit).toBe(true);
  expect(point.snapshot.score.p1).toBe(1);
  expect(point.snapshot.score.p2).toBe(0);
});
