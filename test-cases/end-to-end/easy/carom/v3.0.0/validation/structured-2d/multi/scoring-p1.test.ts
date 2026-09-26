// multi/scoring-p1 — a ball crossing the RIGHT goal edge scores for player one,
// and the field keeps running.
//
// One ball is aimed at the right goal down the clear mid-field lane; the real
// simulation carries it across the edge and the build's own scoring code
// increments the score, which is read back. The other two balls and both
// obstacles are off the field, so the point that lands is the one this check
// drove and nothing on the lane can end the flight early. The paddles cannot be
// removed, so both are held out of it.
//
// The score is posed AFTER the arrangement, because reaching a live field runs
// through the title and a `reset` puts both scores back to zero.
//
// THAT THE FIELD DOES NOT STOP is `gameplay/scoring-p1-continues`'s point, and
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

it("gives player one the point when a ball leaves the right goal", async () => {
  await arrangeGoal(h, "right");
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
  assertEqual(point.snapshot.score.p1, 1);
  assertEqual(point.snapshot.score.p2, 0);
});
