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
// "BESIDE" IS READ FROM WHERE THE TWO RUNS WERE ANCHORED. A build that writes
// the label and the digits in one run satisfies it outright, since that run
// carries both. A build that writes them as two runs anchors the second within
// {@link ADJACENT_MAX} of the first — the space one readout puts between its own
// parts, rather than the space the bar puts between two different readouts.
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
 * How far the level's digits may be anchored from the label and still read as
 * beside it, in logical units.
 *
 * `200` is under a sixth of the `1280`-unit bar, and it has to cover the label's
 * own width as well as the gap after it, since what this engine reads of a run
 * is the point it was anchored at rather than the box it filled. `LEVEL` set
 * large enough to read across a room is some `160` units wide, so a readout that
 * writes the label and then the digits anchors them about that far apart — and
 * the three readouts of a bar this wide sit much further apart than that.
 */
const ADJACENT_MAX = 200;

/** A standalone occurrence of `figure` in a run: not part of a longer number. */
function names(draw: TextDraw, figure: number): boolean {
  return new RegExp(`(?<![0-9])${figure}(?![0-9])`).test(draw.text);
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
        labelled.some((label) => Math.abs(draw.x - label.x) <= ADJACENT_MAX)),
  );
  if (beside.length === 0) {
    fail(
      `the level's digit ${POSED_LEVEL} drawn inside the HUD bar, in the ` +
        `${JSON.stringify(HUD_LEVEL_LABEL)} run itself or anchored within ` +
        `${ADJACENT_MAX} of the ${STAGE_W}-unit bar from it — beside it, ` +
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
