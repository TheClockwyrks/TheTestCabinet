// hud/score-p2 — player two's score is drawn, right of center.
//
// specs/overview.md: during a match the two scores are drawn near the top of the
// field, player two's right of center. The scores are posed at 7-9 through the
// surface, so the two numbers are distinct and neither is the 0 a fresh match
// draws everywhere, and the next frame's text is read: a run showing `9` as a
// figure of its own, anchored right of `FIELD_CX`. The anchor is mapped through
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
// THE ANCHOR IS THE READING, in this project and in both engine projects alike.
// specs/overview.md fixes the position each score is DRAWN AT, so `textDraws`
// reporting each run as the point its anchor names is the whole of what the
// requirement asks for, and the three projects decide the point one way.

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
 * — `P2 9` — is one of the forms it permits, and the run is SEARCHED for the
 * figure rather than stripped down to its digits: stripping folds `P2 9` into
 * `29` and fails a build that labels its scores. Zero padding reads as the same
 * figure (`09`); a digit standing next to it does not (`19`).
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

afterEach(async () => {
  await h.dispose();
});

it("draws player two's score right of center", async () => {
  await startPlaying(h, "versus");
  await clearField(h);
  await h.debug.setScore(SCORE.p1, SCORE.p2);

  const calls = await h.frameCalls();
  await captureStill(h, "hud");

  const played = await h.snapshot();
  assertEqual(played.screen, "playing");
  const runs = textDraws(calls).filter(
    (run) => shows(run.text, SCORE.p2) && !shows(run.text, SCORE.p1),
  );
  assertGreaterThan(runs.length, 0);
  assertEqual(
    runs.some((run) => run.x > FIELD_CX),
    true,
  );
});
