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
// "BESIDE" IS READ AS THE GAP BETWEEN THE TWO RUNS. A build that writes the
// label and the digits in one run satisfies it outright, since that run carries
// both. A build that writes them as two runs is read on the EDGE-TO-EDGE gap
// between their glyphs — `0` where the runs overlap — carried with the vertical
// offset between their baselines, so a build that stacks the label above the
// digits reads the same as one that writes them on a line. {@link ADJACENT_MAX}
// is the space one readout puts between its own parts, rather than the space the
// bar puts between two different readouts.
//
// THE POSED FIGURES ARE THE DISTINGUISHING VALUES. The level is posed at `7`,
// which is a digit no other readout on the bar carries: the score is posed at
// `0` and the lives stand at `START_LIVES` (`3`). So a standalone `7` on the bar
// can only be the level, and a standalone `12` can only be `TOTAL_LEVELS` — a
// build that drew the level it was on last, or the total as some other figure,
// reads as a different number rather than as these.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, fail } from "../assert";
import { HUD_H, HUD_LEVEL_LABEL, STAGE_W, TOTAL_LEVELS } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  textDraws,
  type Harness,
  type TextDraw,
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
 * How far apart two runs sit: the edge-to-edge horizontal gap, `0` where their
 * spans overlap, carried with the vertical offset between their baselines.
 */
function gapBetween(a: TextDraw, b: TextDraw): number {
  const across = Math.max(
    0,
    Math.max(a.left, b.left) - Math.min(a.right, b.right),
  );
  return Math.hypot(across, a.y - b.y);
}

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
function names(draw: TextDraw, figure: number): boolean {
  return drawingsOf(figure).some((form) =>
    new RegExp(`(?<![0-9])${form}(?![0-9])`).test(draw.text),
  );
}

/** Whether a run carries HUD_LEVEL_LABEL, however the build cased it. */
function labels(draw: TextDraw): boolean {
  return draw.text.toUpperCase().includes(HUD_LEVEL_LABEL.toUpperCase());
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws the level label with the level beside it and the total on the bar", async () => {
  await startPlaying(h);
  await h.debug.setScore(POSED_SCORE);
  await h.debug.setLevel(POSED_LEVEL);

  const draws = textDraws(await h.frameCalls());
  // The HUD bar carrying the level and the total.
  await captureStill(h, "hud");

  const snapshot = await h.snapshot();
  assertEqual(snapshot.level, POSED_LEVEL, "the posed level landed");
  assertEqual(snapshot.score, POSED_SCORE, "the posed score landed");

  const onBar = draws.filter((draw) => draw.y >= 0 && draw.y <= HUD_H);
  const drawn = JSON.stringify(onBar.map((draw) => draw.text));

  const labelled = onBar.filter(labels);
  assertGreaterThan(
    labelled.length,
    0,
    `a run inside the HUD bar (y in [0, ${HUD_H}]) carrying HUD_LEVEL_LABEL ` +
      `(${JSON.stringify(HUD_LEVEL_LABEL)}) (specs/ui.md: the level readout ` +
      `shows the label, the current level's digits beside it, and ` +
      `TOTAL_LEVELS on the bar as well); the bar's runs were ${drawn}`,
  );

  const beside = onBar.filter(
    (draw) =>
      names(draw, POSED_LEVEL) &&
      (labels(draw) ||
        labelled.some((label) => gapBetween(draw, label) <= ADJACENT_MAX)),
  );
  if (beside.length === 0) {
    fail(
      `the level's digit ${POSED_LEVEL} drawn inside the HUD bar, in the ` +
        `${JSON.stringify(HUD_LEVEL_LABEL)} run itself or within ` +
        `${ADJACENT_MAX} of the ${STAGE_W}-unit bar of it — beside it, ` +
        `however the readout is composed (specs/ui.md)`,
      drawn,
    );
  }

  const total = onBar.filter((draw) => names(draw, TOTAL_LEVELS));
  assertGreaterThan(
    total.length,
    0,
    `a run inside the HUD bar carrying TOTAL_LEVELS (${TOTAL_LEVELS}) ` +
      `(specs/ui.md: the total is on the bar as well); the bar's runs were ` +
      `${drawn}`,
  );
});
