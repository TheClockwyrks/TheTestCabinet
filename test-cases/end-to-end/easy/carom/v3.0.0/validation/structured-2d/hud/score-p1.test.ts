// Carom — hud/score-p1: player one's score is drawn left of center.
//
// During a match the two scores are drawn, player one's left of the field's
// center and player two's right of it (specs/overview.md); where and how is the
// build's. So the scores are posed at 7-9 through `setScore` and a frame of the
// live match is rendered, and the frame's text draws are read back, each placed
// in logical units through the transform and alignment the build drew it with.
// The score must be drawn as a run whose digits read as that score — a label
// around it and zero padding (`07`) are fine, the other score's digit in the
// same run is not — anchored on its side of the field's center. The anchor is
// the point the build PLACED the figure at, which is what specs/overview.md
// fixes, and it is the point all three projects read.
//
// THE FIELD IS EMPTY. This point is about the two figures the HUD draws, so the
// countdown is opened, the field is CLEARED, and `playing` is posed over it. An
// absent ball takes no part in a frame (specs/instrumentation.md), so no shot can
// cross a goal between the pose and the read and leave the build drawing a score
// this check never set. Neither paddle is taken from the player: nothing here
// presses a movement key, and a driven paddle would be scenery this point does
// not need.

import { afterEach, beforeEach, it } from "vitest";
import { FIELD_CX } from "../constants";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  clearField,
  createHarness,
  drawnTextSpans,
  openCountdown,
  type Harness,
} from "../harness";

const P1_SCORE = 7;
const P2_SCORE = 9;

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

afterEach(() => {
  h?.dispose();
});

it("draws player one's score left of the field's center", async () => {
  await openCountdown(h, "versus");
  clearField(h);
  h.debug.setScreen("playing");
  await h.advance(1);
  assertEqual(h.snapshot().screen, "playing");

  h.debug.setScore(P1_SCORE, P2_SCORE);
  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "hud");

  assertDeepEqual(h.snapshot().score, { p1: P1_SCORE, p2: P2_SCORE });
  const runs = drawnTextSpans(h).filter(
    (span) => shows(span.text, P1_SCORE) && !shows(span.text, P2_SCORE),
  );
  assertGreaterThan(runs.length, 0);
  assertEqual(
    runs.some((span) => span.x < FIELD_CX),
    true,
  );
});
