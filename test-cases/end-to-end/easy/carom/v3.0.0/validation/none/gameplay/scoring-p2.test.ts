// gameplay/scoring-p2 — a ball crossing the LEFT goal edge scores for player two.
//
// The mirror of `scoring-p1`: the ball is aimed at the left goal down the lane
// that clears both obstacles, and the build's own scoring code decides the point.

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

afterEach(() => {
  harness.dispose();
});

it("gives player two the point when the ball leaves the left goal", async () => {
  await startPlaying(harness);
  harness.debug.setScore(0, 0);
  arrangeGoal(harness, "left");

  const point = await captureReplay(harness, "goal", async () => {
    const resolved = await driveGoal(harness);
    await harness.advance(AFTERMATH_TICKS);
    return resolved;
  });

  expect(point.hit).toBe(true);
  expect(point.snapshot.score.p2).toBe(1);
  expect(point.snapshot.score.p1).toBe(0);
});
