// multi/scoring-p1 — a ball crossing the RIGHT goal edge scores for player one,
// and the field keeps running.
//
// The ball is aimed at the right goal down the lane that clears both obstacles;
// the real simulation carries it across the edge and the build's own scoring code
// increments the score, which is read back. The other two balls are parked out of
// the scenario, so the point that lands is the one this check drove.
//
// What differs from a single-ball build is what does NOT happen: nothing freezes.
// The screen is still `playing` on the frame the score turns over, because the
// other balls are still in play and there is no post-point countdown to return
// to. The left goal is the sibling `multi/scoring-p2` check.

import { afterEach, beforeEach, expect, it } from "vitest";
import {
  arrangeGoal,
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { readBalls } from "./harness";

/** Frames recorded after the point resolves, so the clip shows a point SCORED. */
const AFTERMATH_TICKS = 60; // 0.5 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("gives player one the point when a ball leaves the right goal", async () => {
  await startPlaying(h);
  h.debug.setScore(0, 0);
  arrangeGoal(h, "right");

  const point = await captureReplay(h, "goal", async () => {
    const resolved = await h.until((s) => s.score.p1 + s.score.p2 > 0, {
      maxFrames: 360,
      poll: 1,
    });
    await h.advance(AFTERMATH_TICKS);
    return resolved;
  });

  expect(point.hit).toBe(true);
  expect(point.snapshot.score.p1).toBe(1);
  expect(point.snapshot.score.p2).toBe(0);
  // The field carries on: the ball that crossed is the only thing the point
  // changed.
  expect(point.snapshot.screen).toBe("playing");
  expect(readBalls(point.snapshot)[0].held).toBe(true);
});
