// multi/scoring-p1 — a ball crossing the RIGHT goal edge scores for player one,
// and the field keeps running.
//
// The field is cleared back to the one ball this point is about, aimed at the
// right goal down an empty lane; the real simulation carries it across the edge
// and the build's own scoring code increments the score, which is read back. The
// other two balls are not parked out of the way — they are off the field
// entirely — so the point that lands is unambiguously the one this check drove.
//
// What differs from a single-ball build is what does NOT happen: nothing freezes.
// The screen is still `playing` on the frame the score turns over, because a
// point takes one ball out of play rather than stopping the field, and there is
// no post-point countdown to return to. The left goal is the sibling
// `multi/scoring-p2` check.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  arrangeGoal,
  captureReplay,
  createMultiHarness,
  startPlaying,
  type MultiHarness,
} from "../harness";
import { ballAt } from "./harness";

/** Frames recorded after the point resolves, so the clip shows a point SCORED. */
const AFTERMATH_TICKS = 60; // 0.5 s

let h: MultiHarness;

beforeEach(async () => {
  h = await createMultiHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("gives player one the point when a ball leaves the right goal", async () => {
  await startPlaying(h);
  await h.debug.setScore(0, 0);
  await arrangeGoal(h, "right");

  const point = await captureReplay(h, "goal", async () => {
    const resolved = await h.until((s) => s.score.p1 + s.score.p2 > 0, {
      maxFrames: 360,
      poll: 1,
    });
    await h.advance(AFTERMATH_TICKS);
    return resolved;
  });

  assertEqual(point.hit, true);
  assertEqual(point.snapshot.score.p1, 1);
  assertEqual(point.snapshot.score.p2, 0);
  // The field carries on: the ball that crossed is the only thing the point
  // changed.
  assertEqual(point.snapshot.screen, "playing");
  assertEqual(ballAt(point.snapshot, 0).held, true);
});
