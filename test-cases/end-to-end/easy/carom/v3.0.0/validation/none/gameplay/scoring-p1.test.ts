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
  captureReplay,
  createHarness,
  driveGoal,
  startPlaying,
  type Harness,
} from "../harness";

/**
 * Frames recorded after the point resolves.
 *
 * `driveGoal` returns on the sample where the screen stops being "playing" — the
 * instant the point lands, which is where the reading has to be taken. Stopping
 * the RECORDING there would cut on the goal itself, so a reviewer would see the
 * ball approach the goal line and never see the scoreboard turn over. Half a
 * second of what follows is what makes the clip show a point being SCORED.
 *
 * Driven after the sweep, inside the same recorded section, so the snapshot the
 * assertions read is still the sweep's own.
 */
const AFTERMATH_TICKS = 60; // 0.5 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("gives player one the point when the ball leaves the right goal", async () => {
  await startPlaying(harness);
  await harness.debug.setScore(0, 0);
  await arrangeGoal(harness, "right");

  const point = await captureReplay(harness, "goal", async () => {
    const resolved = await driveGoal(harness);
    await harness.advance(AFTERMATH_TICKS);
    return resolved;
  });

  expect(point.hit).toBe(true);
  expect(point.snapshot.score.p1).toBe(1);
  expect(point.snapshot.score.p2).toBe(0);
  // And the point did not end the match: the screen returns to the countdown
  // for the next serve (specs/balls.md).
  expect(point.snapshot.screen).toBe("countdown");
});
