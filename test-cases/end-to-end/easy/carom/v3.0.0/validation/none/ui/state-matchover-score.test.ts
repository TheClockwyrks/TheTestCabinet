// ui/state-matchover-score — the match-over screen shows the final score.
//
// specs/ui.md: the match-over screen displays the winning side and the final
// score. The match is ended for real, so the figures the screen shows are the
// ones the build's own scoring left behind rather than any this check assigned:
// the score is posed at 10-0 as a precondition and a ball is then driven out of
// the right goal, so the eleventh point, and the win rule that resolves on it
// (first to WIN_SCORE, by at least WIN_LEAD), run through the build's own code.
//
// `arrangeGoal` empties the field and spawns back the one ball it drives, so a
// scored point is that ball and the goal edge and nothing else: both obstacles
// come OFF the field rather than being reasoned around, and the paddles are
// stood out of the lane. The shot meets nothing on its way in any variant.
//
// The final score is read as the two numbers drawn: `11` somewhere in the
// frame's text, and `0` as a number of its own. How the screen presents them —
// side by side, labelled, on two lines — is the build's.
//
// SPLIT FROM `ui/state-matchover`, which reads the two menu entries. A build
// that offers the entries but tells the player nothing about how the match ended
// is not the same build as one that shows neither, and a match-over screen
// missing its figures still gets the player back to a match, so this half is the
// cheaper miss.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertMatches } from "../assert";
import { WIN_SCORE } from "../constants";
import {
  arrangeGoal,
  captureStill,
  createHarness,
  drawnText,
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

it("draws the final score the match ended on", async () => {
  await startPlaying(h, "versus");
  await h.debug.setScore(WIN_SCORE - 1, 0);
  await arrangeGoal(h, "right");

  const ended = await driveGoal(h);
  assertEqual(ended.hit, true);

  const over = await h.snapshot();
  assertEqual(over.screen, "matchover");
  assertDeepEqual(over.score, { p1: WIN_SCORE, p2: 0 });

  const calls = await h.frameCalls();
  await captureStill(h, "score");
  const text = drawnText(calls).join(" ");
  assertMatches(text, new RegExp(`\\b${WIN_SCORE}\\b`));
  assertMatches(text, /\b0\b/);
});
