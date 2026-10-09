// gameplay/match-win — reaching the win score with the required lead ends the match.
//
// The score is posed at one short of the win with the loser two behind, then a
// REAL point is driven across the goal: the win rule resolves through the build's
// own scoring code rather than a fabricated end state, taking the match to the
// narrowest score that satisfies it.
//
// The point runs down an isolated lane. `arrangeGoal` empties the field and
// spawns back the one ball it fires, so both obstacles are gone rather than
// dodged, and it drives both paddles out of the mid-field lane — the paddles are
// the one thing on the field a check cannot remove.

import { afterEach, beforeEach, it } from "vitest";
import { WIN_LEAD, WIN_SCORE } from "../constants";
import { assertEqual } from "../assert";
import {
  arrangeGoal,
  captureStill,
  createHarness,
  driveGoal,
  enterPlaying,
  type Harness,
} from "../harness";

/** 10-9 here: one point short, with the lead the win rule needs about to land. */
const P1_BEFORE = WIN_SCORE - 1;
const P2_BEFORE = WIN_SCORE - WIN_LEAD;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("ends the match on the winning point and names the winner", async () => {
  enterPlaying(harness);
  harness.debug.setScore(P1_BEFORE, P2_BEFORE);
  arrangeGoal(harness, "right");

  const end = await driveGoal(harness);
  // One frame past the winning point, so what is kept is the match-over screen
  // rather than the last frame of the rally that reached it. The assertions below
  // read `end.snapshot`, taken before this, so the extra frame decides nothing.
  await harness.advance(1);
  captureStill(harness, "game-over");

  assertEqual(end.hit, true);
  assertEqual(end.snapshot.screen, "matchover");
  assertEqual(end.snapshot.winner, "left");
  assertEqual(end.snapshot.score.p1, WIN_SCORE);
  assertEqual(end.snapshot.score.p2, P2_BEFORE);
});
