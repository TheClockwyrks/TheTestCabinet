// Carom — ui/state-matchover: winning a match opens the match-over screen, which
// draws its menu.
//
// The match is ended for real. The ball is lined up down the middle lane over a
// field holding nothing but that ball — both obstacles are off it, and the two
// paddles, the one piece of furniture no operation removes, are held clear of the
// lane at PARKED_CY — the score is then posed at 10-0 as a precondition, and the
// shot is driven out of the right goal. So the eleventh point, and the win rule
// that resolves on it (first to WIN_SCORE, by at least WIN_LEAD), runs through
// the build's own scoring code. Nothing assigns the end state. The score is posed
// AFTER the arrangement, because opening the match is itself what sets both
// scores to 0.
//
// The two entries are the case's own, MATCHOVER_ITEMS from
// `validation/constants.ts`. Matching is by substring, because a selected entry
// is commonly drawn with a marker beside it.//
// THE FINAL SCORE IS `ui/state-matchover-score`'S POINT. A build that offers the
// two entries but tells the player nothing about how the match ended is not the
// same build as one that shows neither, so the two halves are graded apart and
// capped apart. The frame that is READ is advanced with
// the call list cleared, so what is inspected is one whole render of the screen.

import { afterEach, beforeEach, it } from "vitest";
import { MATCHOVER_ITEMS, WIN_SCORE } from "../constants";
import { assertDeepEqual, assertEqual } from "../assert";
import { drewText } from "../case-harness/text";
import {
  arrangeGoal,
  captureStill,
  createHarness,
  driveGoal,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ends the match on the winning point and draws the match-over menu", async () => {
  await arrangeGoal(h, "right");
  h.debug.setScore(WIN_SCORE - 1, 0);

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
});
