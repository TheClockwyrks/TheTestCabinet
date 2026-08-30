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
// "BESIDE" IS READ AS OVERLAPPING COLUMNS. The label and the digits are two runs
// of text a player reads as one readout, and a build that stacks them puts them
// in the same columns of the bar while a build that writes them in one run puts
// them in the same run. So the digits' run must overlap the label's horizontal
// span, or come within `ADJACENT_MAX` of it — a gap no wider than a couple of
// characters, which is the space a composition puts between two parts of one
// readout rather than between two different readouts. Both runs are inside the
// bar, which is `HUD_H` (`80`) tall, so no vertical bound need be stated beyond
// that.
//
// THE POSED FIGURES ARE THE DISTINGUISHING VALUES. The level is posed at `7`,
// which is a digit no other readout on the bar carries: the score is posed at
// `0` and the lives stand at `START_LIVES` (`3`). So a standalone `7` on the bar
// can only be the level, and a standalone `12` can only be `TOTAL_LEVELS` — a
// build that drew the level it was on last, or the total as some other figure,
// reads as a different number rather than as these.

import { afterEach, beforeEach, it } from "vitest";
import { HUD_H, HUD_LEVEL_LABEL, TOTAL_LEVELS } from "../../src/constants";
import { assertEqual, assertGreaterThan, fail } from "../assert";
import {
  captureStill,
  createHarness,
  drawnTextSpans,
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
 * How far the level's digits may sit from the label and still read as beside
 * it, in logical units.
 *
 * `64` is two tiles, which at the sizes a HUD is set in is a couple of
 * characters: the space one readout puts between its own parts. The three
 * readouts themselves are spread across a `1280`-unit bar, so a gap this small
 * cannot reach from one readout to another.
 */
const ADJACENT_MAX = 64;

/** A standalone occurrence of `figure` in a run: not part of a longer number. */
function names(span: TextSpan, figure: number): boolean {
  return new RegExp(`(?<![0-9])${figure}(?![0-9])`).test(span.text);
}

/** How far apart two runs sit horizontally: `0` where their spans overlap. */
function gap(a: TextSpan, b: TextSpan): number {
  return Math.max(0, a.left - b.right, b.left - a.right);
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
  const spans = drawnTextSpans(h);
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
      labels.some((label) => gap(span, label) <= ADJACENT_MAX),
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
