// ui/state-matchover — winning a match opens the match-over screen, which
// offers its menu.
//
// The match is ended for real. The score is posed at 10-0 as a precondition and
// a ball is then driven out of the right goal, so the eleventh point, and the
// win rule that resolves on it (first to WIN_SCORE, by at least WIN_LEAD), run
// through the build's own scoring code. Nothing assigns the end state.
//
// `arrangeGoal` empties the field and spawns back the one ball it drives, so a
// scored point is that ball and the goal edge and nothing else: both obstacles
// come OFF the field rather than being reasoned around, and the paddles are
// stood out of the lane. The shot meets nothing on its way in any variant.
//
// The two entries are the case's copy (`MATCHOVER_ITEMS`, specs/ui.md), matched
// by substring because a selected entry is commonly drawn with a marker beside
// it. How the screen presents them is the build's.
//
// THE FINAL SCORE IS `ui/state-matchover-score`'S POINT. A build that offers the
// two entries but tells the player nothing about how the match ended is not the
// same build as one that shows neither, so the two halves are graded apart and
// capped apart.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { MATCHOVER_ITEMS, WIN_SCORE } from "../constants";
import { drewText } from "../case-harness/index";
import {
  arrangeGoal,
  captureStill,
  createHarness,
  driveGoal,
  startPlaying,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends the match on the winning point and draws the match-over menu", async () => {
  await startPlaying(h, "versus");
  await h.debug.setScore(WIN_SCORE - 1, 0);
  await arrangeGoal(h, "right");

  const ended = await driveGoal(h);
  assertEqual(ended.hit, true);

  const over = await h.snapshot();
  assertEqual(over.screen, "matchover");
  assertDeepEqual(over.score, { p1: WIN_SCORE, p2: 0 });
  assertEqual(over.winner, "left");

  const calls = await h.frameCalls();
  await captureStill(h, "matchover");
  for (const item of MATCHOVER_ITEMS) {
    assertEqual(drewText(calls, item), true);
  }
});
