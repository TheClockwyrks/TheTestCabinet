// Carom — hud/score-p2: player two's score is drawn right of center.
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
 * Group separators a build may draw between a figure's digit triples.
 *
 * An ASCII space is deliberately absent. A frame's separate runs of text are
 * joined with one, so accepting it would read the two figures in `40 130` as the
 * single figure `40130`. `.` is absent for the same kind of reason: it is the
 * decimal point, and a build drawing `1.5` means one and a half.
 */
const GROUP = [",", "'", "\u00A0", "\u202F", "\u2009"];

/**
 * Every conventional rendering of `value`: its bare digits, and — once it is
 * long enough to be grouped — those digits carrying each separator between their
 * triples. A figure of three digits or fewer has exactly one rendering.
 */
function renderings(value: number): readonly string[] {
  const plain = String(value);
  const grouped = GROUP.map((sep) =>
    plain.replace(/\B(?=(\d{3})+(?!\d))/g, sep),
  );
  return [...new Set([plain, ...grouped])];
}

/** `literal` as a pattern that matches itself and nothing else. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether one run of text shows `score` as a figure of its own.
 *
 * specs/overview.md fixes that the two scores are drawn and leaves the
 * scoreboard's presentation to the build, so a figure carrying a label beside it
 * — `P1 7` — is one of the forms it permits, and the run is SEARCHED for the
 * figure rather than stripped down to its digits: stripping folds `P1 7` into
 * `17` and fails a build that labels its scores. Zero padding reads as the same
 * figure (`07`); a digit standing next to it does not (`17`).
 *
 * Digit grouping is presentation as well, so every conventional rendering of the
 * figure is searched for and a grouped figure reads as the one figure it is:
 * `1234`, `1,234`, `1'234`, and the three space separators a locale reaches for
 * (U+00A0, U+202F, U+2009) — which is what `toLocaleString` draws by default. An
 * ASCII space is not one of them, because the frame's runs of text are joined
 * with one and reading it as a separator would fold the two figures in `40 130`
 * into the single figure `40130`. A score short of a thousand has exactly one
 * rendering, so it is searched for as the bare digits it is.
 */
function shows(text: string, score: number): boolean {
  return renderings(score).some((figure) =>
    new RegExp(`(?<![\\d.])0*${escapeRegExp(figure)}(?![\\d.])`).test(text),
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws player two's score right of the field's center", async () => {
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
    (span) => shows(span.text, P2_SCORE) && !shows(span.text, P1_SCORE),
  );
  assertGreaterThan(runs.length, 0);
  assertEqual(
    runs.some((span) => span.x > FIELD_CX),
    true,
  );
});
