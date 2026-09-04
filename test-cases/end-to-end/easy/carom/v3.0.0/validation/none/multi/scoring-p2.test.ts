// multi/scoring-p2 — a ball crossing the LEFT goal edge scores for player two,
// and the field keeps running.
//
// The mirror of `multi/scoring-p1`, so a build that scores on only one edge fails
// the side it gets wrong rather than passing on an average. The field is cleared
// back to the one ball this point is about, which is what makes the two checks
// exact mirrors: with nothing else on the field there is no corner for the other
// balls to be tucked into, and so no side of the field that a park would have
// made special.
//
// THAT THE FIELD DOES NOT STOP is `gameplay/scoring-p2-continues`'s point, and
// that the SCORED BALL goes home and holds is `multi-ball/independent-respawn`'s.
// A build that freezes the other two balls on every point is playing base with
// three balls rather than multi, which is a different fault from one that never
// scores at all — so the increment is graded here and the rest beside it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  arrangeGoal,
  captureReplay,
  createMultiHarness,
  startPlaying,
  type MultiHarness,
} from "../harness";

/** Frames recorded after the point resolves, so the clip shows a point SCORED. */
const AFTERMATH_TICKS = 60; // 0.5 s

let h: MultiHarness;

beforeEach(async () => {
  h = await createMultiHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("gives player two the point when a ball leaves the left goal", async () => {
  await startPlaying(h);
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
});
