// Wireworm — presentation/hud-level: the HUD shows the level and the total.
//
// specs/ui.md's HUD table: the level readout shows "`HUD_LEVEL_LABEL` (`LEVEL`),
// the current level's digits beside it, and `TOTAL_LEVELS` (`12`) on the bar as
// well", and the file says outright that "how the level readout is composed
// around those three parts is yours". specs/board.md puts every readout inside
// the bar's own region, `y` in `[0, HUD_H]` (`[0, 80]`).
//
// SO THE POINT READS THE THREE PARTS AND NOT THE COMPOSITION. A slash, the word
// `OF`, the label stacked above the digits, the label and the digits in one run
// — every one of those satisfies the file, and each would fail a check that
// demanded a particular string. What is required is that the label is on the
// bar, that the current level's digits sit BESIDE it, and that the total is on
// the bar too.
//
// "BESIDE" IS READ AS THE GAP BETWEEN THE TWO RUNS. The label and the digits are
// two runs of text a player reads as one readout, and a build that stacks them
// puts them in the same columns of the bar while a build that writes them in one
// run puts them in the same run. So the reading is the EDGE-TO-EDGE gap between
// their glyphs — `0` where the runs overlap — carried with the vertical offset
// between their baselines, and it must come within {@link ADJACENT_MAX}: the
// space a composition puts between two parts of one readout rather than between
// two different readouts.
//
// THE POSED FIGURES ARE THE DISTINGUISHING VALUES. The level is posed at `7`,
// which is a digit no other readout on the bar carries: the score is posed at
// `0` and the lives stand at `START_LIVES` (`3`). So a standalone `7` on the bar
// can only be the level, and a standalone `12` can only be `TOTAL_LEVELS` — a
// build that drew the level it was on last, or the total as some other figure,
// reads as a different number rather than as these.

import { afterEach, beforeEach, it } from "vitest";
import { HUD_H, HUD_LEVEL_LABEL, TOTAL_LEVELS } from "../constants";
import { assertEqual, assertGreaterThan, fail } from "../assert";
import {
  captureStill,
  createHarness,
  drawnTextSpanForms,
  resetTo,
  startPlaying,
  type Harness,
  type TextSpan,
} from "../harness";

/** The level posed: a digit no other readout on the bar carries. */
const POSED_LEVEL = 7;

/** The score posed alongside it, so no other run on the bar carries a 7. */
const POSED_SCORE = 0;

/**
 * How far the level's digits may sit from the `LEVEL` label and still be read as
 * beside it, in logical units.
 *
 * specs/ui.md asks for the digits "beside it" and fixes no distance, because the
 * composition is the build's: the label may sit to the left of the digits, or
 * above them. So the reading is the EDGE-TO-EDGE gap between the two runs —
 * `0` where they overlap or share a run — carried with the vertical offset
 * between their baselines, and `160` units is five tiles: comfortably more than
 * a label and its digits at any size that fits an `80`-unit bar, and a small
 * fraction of the `1280`-unit bar the three readouts are spread across, so a `7`
 * belonging to some other readout could not be mistaken for this one at that
 * distance. The `none`, `simple-2d` and `structured-2d` suites take the same
 * measure against the same figure.
 */
const ADJACENT_MAX = 160;

/**
 * Every conventional drawing of a whole figure: its plain digits, and the same
 * digits grouped in threes by each separator a build may reach for — `1,234`,
 * `1'234`, and the same with a non-breaking or a thin space. An ASCII space is
 * not among them: the bar's runs are read as the build anchored them, and a run
 * reading `40 130` drew the two figures `40` and `130`, not `40130`. A figure of
 * three digits or fewer has exactly one drawing.
 */
function drawingsOf(figure: number): string[] {
  const plain = String(figure);
  const forms = new Set([plain]);
  for (const separator of [",", "'", "\u00A0", "\u202F", "\u2009"]) {
    forms.add(plain.replace(/\B(?=(\d{3})+(?!\d))/g, separator));
  }
  return [...forms];
}

/**
 * A standalone occurrence of `figure` in a run: not part of a longer number.
 *
 * Every drawing of the figure is looked for, so a build that groups the
 * thousands of a larger one names it as surely as a build that does not, and the
 * digit boundary is held on both sides, so a run showing `150` still does not
 * name `50`.
 */
function names(span: TextSpan, figure: number): boolean {
  return drawingsOf(figure).some((form) =>
    new RegExp(`(?<![0-9])${form}(?![0-9])`).test(span.text),
  );
}

/**
 * How far apart two runs sit: the edge-to-edge horizontal gap, `0` where their
 * spans overlap, carried with the vertical offset between their baselines.
 */
function gapBetween(a: TextSpan, b: TextSpan): number {
  const across = Math.max(
    0,
    Math.max(a.left, b.left) - Math.min(a.right, b.right),
  );
  return Math.hypot(across, a.y - b.y);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the level label with the level beside it and the total on the bar", async () => {
  resetTo(h);
  startPlaying(h);
  h.debug.setScore(POSED_SCORE);
  h.debug.setLevel(POSED_LEVEL);

  h.calls.length = 0;
  await h.advance(1);
  // The bar's calls and the runs they spell, so a label or a figure the build
  // letter-spaced a glyph per call is found in the run it spells.
  const spans = drawnTextSpanForms(h);
  // The HUD bar carrying the level and the total.
  captureStill(h, "hud");

  const snapshot = h.snapshot();
  assertEqual(snapshot.level, POSED_LEVEL, "the posed level landed");
  assertEqual(snapshot.score, POSED_SCORE, "the posed score landed");

  const onBar = spans.filter((span) => span.y >= 0 && span.y <= HUD_H);
  const drawn = JSON.stringify(onBar.map((span) => span.text));

  const labels = onBar.filter((span) =>
    span.text.toUpperCase().includes(HUD_LEVEL_LABEL.toUpperCase()),
  );
  assertGreaterThan(
    labels.length,
    0,
    `a run inside the HUD bar (y in [0, ${HUD_H}]) carrying ` +
      `HUD_LEVEL_LABEL (${JSON.stringify(HUD_LEVEL_LABEL)}) (specs/ui.md: the ` +
      `level readout shows the label, the current level's digits beside it, ` +
      `and TOTAL_LEVELS on the bar as well); the bar's runs were ${drawn}`,
  );

  const beside = onBar.filter(
    (span) =>
      names(span, POSED_LEVEL) &&
      labels.some((label) => gapBetween(span, label) <= ADJACENT_MAX),
  );
  if (beside.length === 0) {
    fail(
      `the level's digit ${POSED_LEVEL} drawn inside the HUD bar within ` +
        `${ADJACENT_MAX} units of the ` +
        `${JSON.stringify(HUD_LEVEL_LABEL)} label — beside it, in the same ` +
        `columns of the bar, however the readout is composed (specs/ui.md)`,
      drawn,
    );
  }

  const total = onBar.filter((span) => names(span, TOTAL_LEVELS));
  assertGreaterThan(
    total.length,
    0,
    `a run inside the HUD bar carrying TOTAL_LEVELS (${TOTAL_LEVELS}) ` +
      `(specs/ui.md: the total is on the bar as well); the bar's runs were ` +
      `${drawn}`,
  );
});
