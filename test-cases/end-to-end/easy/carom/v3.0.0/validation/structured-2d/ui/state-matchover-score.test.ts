// Carom — ui/state-matchover-score: the match-over screen draws the final score.
//
// specs/ui.md: the match-over screen displays the winning side and the final
// score. The match is ended for real, so the figures the screen shows are the
// ones the build's own scoring left behind rather than any this check assigned.
// The ball is lined up down the middle lane over a field holding nothing but
// that ball — both obstacles are off it, and the two paddles, the one piece of
// furniture no operation removes, are held clear of the lane at PARKED_CY — the
// score is then posed at 10-0 as a precondition, and the shot is driven out of
// the right goal. So the eleventh point, and the win rule that resolves on it
// (first to WIN_SCORE, by at least WIN_LEAD), runs through the build's own
// scoring code. The score is posed AFTER the arrangement, because opening the
// match is itself what sets both scores to 0.
//
// The final score here is 11-0, so the frame's text must carry both figures: 11
// somewhere in it, and 0 as a number of its own. How the screen presents them —
// side by side, labelled, on two lines — is the build's. The frame that is READ
// is advanced with the call list cleared, so what is inspected is one whole
// render of the screen.
//
// SPLIT FROM `ui/state-matchover`, which reads the two menu entries. A build
// that offers the entries but tells the player nothing about how the match ended
// is not the same build as one that shows neither, and a match-over screen
// missing its figures still gets the player back to a match, so this half is the
// cheaper miss.

import { afterEach, beforeEach, it } from "vitest";
import { WIN_SCORE } from "../constants";
import { assertDeepEqual, assertEqual, assertMatches } from "../assert";
import {
  arrangeGoal,
  captureStill,
  createHarness,
  drawnText,
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

it("draws the final score the match ended on", async () => {
  await arrangeGoal(h, "right");
  h.debug.setScore(WIN_SCORE - 1, 0);

  const ended = await driveGoal(h);
  assertEqual(ended.hit, true);

  const over = h.snapshot();
  assertEqual(over.screen, "matchover");
  assertDeepEqual(over.score, { p1: WIN_SCORE, p2: 0 });

  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "score");
  const copy = drawnText(h.calls).join(" ");
  assertMatches(copy, new RegExp(`\\b${WIN_SCORE}\\b`));
  assertMatches(copy, /\b0\b/);
});
