// multi/match-win — reaching the win score with the required lead ends the match.
//
// The score is posed at one short of the win with the loser two behind, then a
// REAL point is driven across the goal: the win rule resolves through the build's
// own scoring code rather than a fabricated end state, taking the match to the
// narrowest score that satisfies it.
//
// A point in multi does not stop the field, so what ends the match here is the
// win rule alone — the ball is still in play right up to the frame the
// match-over screen replaces it. The two balls this check is not about are off
// the field entirely, along with both obstacles, so the score that reaches the
// win is the one this check drove.
//
// The score is posed AFTER the arrangement, because reaching a live field runs
// through the title and a `reset` puts both scores back to zero.

import { afterEach, beforeEach, it } from "vitest";
import { WIN_LEAD, WIN_SCORE } from "../constants";
import { assertEqual } from "../assert";
import {
  arrangeGoal,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";

/** 10-9 here: one point short, with the lead the win rule needs about to land. */
const P1_BEFORE = WIN_SCORE - 1;
const P2_BEFORE = WIN_SCORE - WIN_LEAD;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ends the match on the winning point and names the winner", async () => {
  await arrangeGoal(h, "right");
  h.debug.setScore(P1_BEFORE, P2_BEFORE);

  const end = await h.until((s) => s.screen === "matchover", {
    maxFrames: 360,
    poll: 6,
  });
  // One frame past the winning point, so what is kept is the match-over screen
  // rather than the last frame of the rally that reached it. The assertions below
  // read `end.snapshot`, taken before this, so the extra frame decides nothing.
  await h.advance(1);
  captureStill(h, "game-over");

  assertEqual(end.hit, true);
  assertEqual(end.snapshot.winner, "left");
  assertEqual(end.snapshot.score.p1, WIN_SCORE);
  assertEqual(end.snapshot.score.p2, P2_BEFORE);
});
