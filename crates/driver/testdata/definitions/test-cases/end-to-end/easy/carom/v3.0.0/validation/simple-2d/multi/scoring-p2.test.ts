// multi/scoring-p2 — a ball crossing the LEFT goal edge scores for player two,
// and the field keeps running.
//
// The mirror of `multi/scoring-p1`, so a build that scores on only one edge fails
// the side it gets wrong rather than passing on an average. There is nothing to
// move out of the left goal channel first: the two balls this check is not about
// are REMOVED from the field along with both obstacles, so the only thing that
// can cross an edge here is the ball this check drove.
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
  createHarness,
  enterPlaying,
  type Harness,
} from "../harness";

/** Frames recorded after the point resolves, so the clip shows a point SCORED. */
const AFTERMATH_TICKS = 60; // 0.5 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives player two the point when a ball leaves the left goal", async () => {
  enterPlaying(h);
  arrangeGoal(h, "left");

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
