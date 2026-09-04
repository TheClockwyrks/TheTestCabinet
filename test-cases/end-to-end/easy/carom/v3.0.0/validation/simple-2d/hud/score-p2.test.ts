// Carom — hud/score-p2: player two's score is drawn right of center.
//
// During a match the two scores are drawn, player one's left of the field's
// center and player two's right of it (specs/overview.md); where and how is the
// build's. So the scores are posed at 7-9 through `setScore` and a frame of the
// live match is rendered, and the frame's text draws are read back, each placed
// in logical units through the transform and alignment the build drew it with.
// The score must be drawn as a run whose digits read as that score — a label
// around it and zero padding (`07`) are fine, the other score's digit in the
// same run is not — with the run's midpoint on its side of the field's center.
//
// The match is posed straight onto `playing` with `enterPlaying`, which serves
// nothing and takes no paddle: this point is about a drawn figure, so it needs a
// live match and nothing that happens inside one.
//
// The field is emptied. The requirement concerns a run of text, which no ball and
// no obstacle draws, and a ball left standing on a `playing` screen is a body the
// build's own physics is free to move — one that scored would replace the very
// figures this frame is read for. `clearWorld` removes them outright rather than
// parking them somewhere harmless. The paddles are the field furniture no
// operation removes, and neither is touched: nothing here reads one.

import { afterEach, beforeEach, it } from "vitest";
import { FIELD_CX } from "../constants";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  drawnTextSpans,
  enterPlaying,
  poseWorld,
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

it("draws player two's score right of the field's center", async () => {
  enterPlaying(h, "versus");
  poseWorld(h, { balls: [], obstacles: [] });
  h.debug.setScore(P1_SCORE, P2_SCORE);
  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "hud");

  assertEqual(h.snapshot().screen, "playing");
  assertDeepEqual(h.snapshot().score, { p1: P1_SCORE, p2: P2_SCORE });
  const runs = drawnTextSpans(h).filter(
    (span) => shows(span.text, P2_SCORE) && !shows(span.text, P1_SCORE),
  );
  assertGreaterThan(runs.length, 0);
  assertEqual(
    runs.some((span) => (span.left + span.right) / 2 > FIELD_CX),
    true,
  );
});
