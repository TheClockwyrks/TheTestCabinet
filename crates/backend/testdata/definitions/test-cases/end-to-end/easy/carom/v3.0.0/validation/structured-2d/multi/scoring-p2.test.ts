// multi/scoring-p2 — a ball crossing the LEFT goal edge scores for player two,
// and the field keeps running.
//
// The mirror of `multi/scoring-p1`, so a build that scores on only one edge fails
// the side it gets wrong rather than passing on an average. Nothing has to be
// moved out of the way for it: the other two balls and both obstacles are off
// the field entirely rather than parked in a goal channel, so the goal this
// check drives its ball out of is empty whichever edge it is.
//
// The score is posed AFTER the arrangement, because reaching a live field runs
// through the title and a `reset` puts both scores back to zero.
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
  await arrangeGoal(h, "left");
  h.debug.setScore(0, 0);

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
