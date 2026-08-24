// multi/scoring-p2 — a ball crossing the LEFT goal edge scores for player two,
// and the field keeps running.
//
// The mirror of `multi/scoring-p1`, so a build that scores on only one edge fails
// the side it gets wrong rather than passing on an average. The two balls this
// check is not about are re-parked in the RIGHT goal channel first: the shared
// park is the left one, which is exactly where this scenario sends its ball.
//
// What differs from a single-ball build is what does NOT happen: nothing freezes.
// The screen is still `playing` on the frame the score turns over, because the
// other balls are still in play and there is no post-point countdown to return
// to.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  arrangeGoal,
  captureReplay,
  createHarness,
  parkSpares,
  startPlaying,
  type Harness,
} from "../harness";
import { RIGHT_PARKS, readBalls } from "./harness";

/** Frames recorded after the point resolves, so the clip shows a point SCORED. */
const AFTERMATH_TICKS = 60; // 0.5 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("gives player two the point when a ball leaves the left goal", async () => {
  await startPlaying(h);
  await parkSpares(h, RIGHT_PARKS);
  await h.debug.setScore(0, 0);
  await arrangeGoal(h, "left");

  const point = await captureReplay(h, "goal", async () => {
    const resolved = await h.until((s) => s.score.p1 + s.score.p2 > 0, {
      maxFrames: 360,
      poll: 1,
    });
    await h.advance(AFTERMATH_TICKS);
    return resolved;
  });

  assertEqual(point.hit, true);
  assertEqual(point.snapshot.score.p2, 1);
  assertEqual(point.snapshot.score.p1, 0);
  // The field carries on: the ball that crossed is the only thing the point
  // changed.
  assertEqual(point.snapshot.screen, "playing");
  assertEqual(readBalls(point.snapshot)[0].held, true);
});
