// hud/score-p1 — player one's score is drawn, left of center.
//
// specs/overview.md: during a match the two scores are drawn near the top of the
// field, player one's left of center. The scores are posed at 7-9 through the
// surface, so the two numbers are distinct and neither is the 0 a fresh match
// draws everywhere, and the next frame's text is read: a run showing `7` as a
// figure of its own, anchored left of `FIELD_CX`. The anchor is mapped through
// whatever transform the build drew under (`textDraws`), so a HUD drawn at a
// translated origin reads the same as one drawn in field coordinates.
//
// THE FIELD IS EMPTY. This point is about the two figures the HUD draws, so the
// match is opened, live play is reached, and the world is CLEARED before the
// frame is read. A ball left on a `playing` screen is a body the build's own
// physics is free to move, and one that crossed a goal between the pose and the
// read would leave the build drawing a score this check never set. Both
// obstacles go with it; the paddles are the field furniture no operation
// removes, and neither is touched, since nothing here reads one.
//
// THE ANCHOR IS THE READING, where both engine projects read the run's midpoint.
// A run's measured extent is available only to a harness that asks the page to
// measure every drawn string, which is a round trip into the page per frame
// read, and the `none` harness does not: `textDraws` reports each run as the
// point its anchor names. That point is where the build PLACED the figure, which
// is what "left of center" fixes; the only build the wider reading would catch
// on top of this one is a scoreboard anchored just short of the net and spilling
// across it, and specs/overview.md draws the two scores near the top of the field
// rather than against it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { FIELD_CX } from "../constants";
import {
  captureStill,
  clearField,
  createHarness,
  startPlaying,
  textDraws,
  type Harness,
} from "../harness";

const SCORE = { p1: 7, p2: 9 };

/**
 * Whether one run of text shows `score` as a figure of its own.
 *
 * specs/overview.md fixes that the two scores are drawn and leaves the
 * scoreboard's presentation to the build, so a figure carrying a label beside it
 * — `P1 7` — is one of the forms it permits, and the run is SEARCHED for the
 * figure rather than stripped down to its digits: stripping folds `P1 7` into
 * `17` and fails a build that labels its scores. Zero padding reads as the same
 * figure (`07`); a digit standing next to it does not (`17`).
 */
function shows(text: string, score: number): boolean {
  return new RegExp(`(?:^|\\D)0*${score}(?:\\D|$)`).test(text);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws player one's score left of center", async () => {
  await startPlaying(h, "versus");
  await clearField(h);
  await h.debug.setScore(SCORE.p1, SCORE.p2);

  const calls = await h.frameCalls();
  await captureStill(h, "hud");

  const played = await h.snapshot();
  assertEqual(played.screen, "playing");
  const runs = textDraws(calls).filter(
    (run) => shows(run.text, SCORE.p1) && !shows(run.text, SCORE.p2),
  );
  assertGreaterThan(runs.length, 0);
  assertEqual(
    runs.some((run) => run.x < FIELD_CX),
    true,
  );
});
