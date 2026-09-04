// multi/match-win — reaching the win score with the required lead ends the match.
//
// The score is posed at one short of the win with the loser two behind, then a
// REAL point is driven across the goal: the win rule resolves through the build's
// own scoring code rather than a fabricated end state, taking the match to the
// narrowest score that satisfies it.
//
// A point in multi does not stop the field, so what ends the match here is the
// win rule alone — the ball is still in play right up to the frame the match-over
// screen replaces it. The field is cleared back to the one ball this check
// drives, so the score that reaches the win is the one this check drove and no
// other ball can add to it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { WIN_LEAD, WIN_SCORE } from "../constants";
import {
  arrangeGoal,
  captureStill,
  createMultiHarness,
  startPlaying,
  type MultiHarness,
} from "../harness";

/** 10-9 here: one point short, with the lead the win rule needs about to land. */
const P1_BEFORE = WIN_SCORE - 1;
const P2_BEFORE = WIN_SCORE - WIN_LEAD;

let h: MultiHarness;

beforeEach(async () => {
  h = await createMultiHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends the match on the winning point and names the winner", async () => {
  await startPlaying(h);
  await h.debug.setScore(P1_BEFORE, P2_BEFORE);
  await arrangeGoal(h, "right");

  const end = await h.until((s) => s.screen === "matchover", {
    maxFrames: 360,
    poll: 6,
  });
  // One frame past the winning point, so what is kept is the match-over screen
  // rather than the last frame of the rally that reached it. The assertions below
  // read `end.snapshot`, taken before this, so the extra frame decides nothing.
  await h.advance(1);
  await captureStill(h, "game-over");

  assertEqual(end.hit, true);
  assertEqual(end.snapshot.winner, "left");
  assertEqual(end.snapshot.score.p1, WIN_SCORE);
  assertEqual(end.snapshot.score.p2, P2_BEFORE);
});
