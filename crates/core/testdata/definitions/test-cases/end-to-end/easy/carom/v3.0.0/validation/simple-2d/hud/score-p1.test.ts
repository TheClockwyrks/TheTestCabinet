// Carom — hud/score-p1: player one's score is drawn left of center.
//
// During a match the two scores are drawn, player one's left of the field's
// center and player two's right of it (specs/overview.md); where and how is the
// build's. So the scores are posed at 7-9 through `setScore` and a frame of the
// live match is rendered, and the frame's text draws are read back, each placed
// in logical units through the transform and alignment the build drew it with.
// The score must be drawn as a run whose digits read as that score — a label
// around it and zero padding (`07`) are fine — with the figure on its side of
// the field's center. specs/overview.md fixes where each score's FIGURE is
// drawn, not how many runs the scoreboard is nor how they are aligned, so every
// run is read by where this score's GLYPHS sit within the run's measured
// extent, which every harness records (`measureText`): a run that is the figure
// alone, and a centred `7     9` carrying both, alike. The anchor a build names
// is not the reading, because `textAlign` decides which part of the run lands
// on it. All three projects decide the point this way.
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
  type TextSpan,
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
 * Where `score` is shown in one run of text as a figure of its own, and
 * `null` where the run does not show it.
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
function figureMatch(text: string, score: number): RegExpExecArray | null {
  for (const figure of renderings(score)) {
    const hit = new RegExp(
      `(?<![\\d.])0*${escapeRegExp(figure)}(?![\\d.])`,
    ).exec(text);
    if (hit !== null) return hit;
  }
  return null;
}

/**
 * Where, in logical x, the glyphs of `score`'s figure sit inside `span`.
 *
 * The reading is the GLYPHS, never the anchor. A build names one point per run
 * and `textAlign` decides which part of the run lands on it, so the same drawn
 * figure reads at three different places through `x` alone: a `7` right-aligned
 * on the center line is drawn wholly left of it, and one left-aligned a unit
 * short of it is drawn wholly right of it. The run's measured extent is where
 * the glyphs landed, so the figure is placed inside that extent in proportion
 * to its character position — exact for a run that is the figure alone, and for
 * a centred `7     9` whose figures sit at either end, and within a glyph
 * elsewhere.
 *
 * A run not showing the figure places nothing. A run the harness recorded no
 * width for — a case that asked for no `measureText` — has no extent to place a
 * figure inside, and stands as the point its anchor names.
 */
function figureX(
  span: Pick<TextSpan, "text" | "x" | "left" | "right">,
  score: number,
): number | null {
  const hit = figureMatch(span.text, score);
  if (hit === null) return null;
  const width = span.right - span.left;
  if (!(width > 0)) return span.x;
  const centre = (hit.index + hit[0].length / 2) / span.text.length;
  return span.left + width * centre;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws player one's score left of the field's center", async () => {
  enterPlaying(h, "versus");
  poseWorld(h, { balls: [], obstacles: [] });
  h.debug.setScore(P1_SCORE, P2_SCORE);
  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "hud");

  assertEqual(h.snapshot().screen, "playing");
  assertDeepEqual(h.snapshot().score, { p1: P1_SCORE, p2: P2_SCORE });
  const placed = drawnTextSpans(h)
    .map((span) => figureX(span, P1_SCORE))
    .filter((x): x is number => x !== null);
  assertGreaterThan(placed.length, 0);
  assertEqual(
    placed.some((x) => x < FIELD_CX),
    true,
  );
});
