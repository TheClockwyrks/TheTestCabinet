// hud/score-p2 — player two's score is drawn, right of center.
//
// specs/overview.md: during a match the two scores are drawn near the top of the
// field, player two's right of center. The scores are posed at 7-9 through the
// surface, so the two numbers are distinct and neither is the 0 a fresh match
// draws everywhere, and the next frame's text is read: a run showing `9` as a
// figure of its own, placed right of `FIELD_CX`. The anchor is mapped through
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
// THE FIGURE'S PLACE IS THE READING, in this project and in both engine projects
// alike. specs/overview.md fixes where each score's FIGURE is drawn, not how
// many runs the scoreboard is: a run showing only this score is read at the
// point its anchor names, and a run carrying both scores — a centred `7     9`
// — is read by where this score's glyphs sit within the run's measured extent,
// which `textDraws` carries from the harness's `measureText` recording. The
// three projects decide the point one way.

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
  type TextDraw,
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

/**
 * Where, in logical x, the glyphs of `score`'s figure sit inside `span`.
 *
 * A run that carries only this score is placed where its anchor is: the point
 * the build placed the figure at. A run that carries both scores — `7     9`
 * centred on the field — places each figure by its glyphs, estimated from the
 * run's measured extent in proportion to the figure's character position: exact
 * for a centred scoreboard whose figures sit at either end, and within a glyph
 * elsewhere. A run showing neither this score, nor a measured extent to place
 * it in, places nothing.
 */
function figureX(
  span: Pick<TextDraw, "text" | "x" | "left" | "right">,
  score: number,
  other: number,
): number | null {
  if (!shows(span.text, score)) return null;
  if (!shows(span.text, other)) return span.x;
  const hit = renderings(score)
    .map((figure) =>
      new RegExp(`(?<![\\d.])0*${escapeRegExp(figure)}(?![\\d.])`).exec(
        span.text,
      ),
    )
    .find((match) => match !== null);
  if (!hit) return null;
  const width = span.right - span.left;
  if (!(width > 0)) return null;
  const centre = (hit.index + hit[0].length / 2) / span.text.length;
  return span.left + width * centre;
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
  const placed = textDraws(calls)
    .map((run) => figureX(run, SCORE.p2, SCORE.p1))
    .filter((x): x is number => x !== null);
  assertGreaterThan(placed.length, 0);
  assertEqual(
    placed.some((x) => x > FIELD_CX),
    true,
  );
});
