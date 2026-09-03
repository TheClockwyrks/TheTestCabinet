// Carom — ui/state-matchover: winning a match opens the match-over screen, which
// draws its menu and the final score.
//
// The match is ended for real. The score is posed at 10-0 as a precondition and a
// ball is then driven out of the right goal, so the eleventh point — and the win
// rule that resolves on it (first to WIN_SCORE, by at least WIN_LEAD) — runs
// through the build's own scoring code. Nothing assigns the end state.
//
// The two entries are the case's own, MATCHOVER_ITEMS from
// `validation/constants.ts`,
// and the screen "displays the winning side and the final score" (specs/ui.md):
// the final score here is 11-0, so the frame's text must carry both figures.
// Matching is by substring, because a selected entry is commonly drawn with a
// marker beside it.

import { afterEach, beforeEach, it } from "vitest";
import { MATCHOVER_ITEMS, WIN_SCORE } from "../constants";
import { assertDeepEqual, assertEqual, assertMatches } from "../assert";
import {
  arrangeGoal,
  captureStill,
  createHarness,
  drawnText,
  driveGoal,
  drewText,
  startPlaying,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ends the match on the winning point and draws the match-over menu and score", async () => {
  await startPlaying(h, "versus");
  h.debug.setScore(WIN_SCORE - 1, 0);
  arrangeGoal(h, "right");

  const ended = await driveGoal(h);
  assertEqual(ended.hit, true);

  const over = h.snapshot();
  assertEqual(over.screen, "matchover");
  assertDeepEqual(over.score, { p1: WIN_SCORE, p2: 0 });
  assertEqual(over.winner, "left");

  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "matchover");
  for (const item of MATCHOVER_ITEMS) {
    assertEqual(drewText(h.calls, item), true);
  }
  const copy = drawnText(h.calls).join(" ");
  assertMatches(copy, new RegExp(`\\b${WIN_SCORE}\\b`));
  assertMatches(copy, /\b0\b/);
});
