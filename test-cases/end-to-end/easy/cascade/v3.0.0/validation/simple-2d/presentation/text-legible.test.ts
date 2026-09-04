// presentation/text-legible — text reads against whatever it sits on.
//
// THE RULE. specs/overview.md's legibility table, the row "Text": "Every screen's
// text, and the label of every HUD control, is legible against its background at
// the logical stage size", which specs/screens.md repeats for the screens: "Every
// piece of text a screen shows is legible against whatever sits behind it at the
// logical stage size."
//
// WHAT IT DECIDES, AND WHAT IT LEAVES ALONE. The CONTRAST of the strings a build
// draws, and nothing about which strings those are: that the title screen shows
// `TITLE_TEXT`, its tagline and its two items is `screens.title-shows-title`,
// `screens.title-shows-tagline` and `screens.title-shows-items`, and the HUD's
// labels are `presentation/hud-labels-drawn`. Deciding the same fact in two
// groups would dock one defect twice, so this point reads every run of text the
// build drew, whichever it is, and asks only whether a player can read it.
//
// THE TWO SCENES ARE THE ONES THE REVIEW ITEM NAMES: the title screen, which is
// where the game opens and the one screen made almost entirely of text, and the
// HUD strip during play, whose labels are the only text on the live table. Every
// run of text on the first, and every run inside the strip specs/table.md fixes
// on the second, has to read.
//
// HOW A RUN'S CONTRAST IS MEASURED. Inside the run's own box and nowhere else,
// because what a build draws a string ON is the build's — felt on one screen, a
// control's panel on another, and specs/overview.md fixes neither. The colour the
// box is mostly painted in is what the run sits on, since glyphs cover a minority
// of a line of text at any size, and the sample furthest from it is the ink.
// `presentation/reading.ts` carries the reading and why the box is shaped the way
// it is; a build that drew a string in the colour behind it reads `0` here,
// whatever that colour was.
//
// THE PALETTE AND THE TYPE ARE THE BUILD'S: specs/overview.md fixes no colour and
// no typeface, so nothing here knows a hex value or a font, and what is measured
// is the distance between two things the build itself painted.
//
// A SCREEN THAT DRAWS NO TEXT AT ALL PASSES HERE, and that is the same division
// again rather than a hole: there is nothing to be illegible, and the strings a
// build owes are owed to `screens.title-shows-title`,
// `screens.title-shows-tagline`, `screens.title-shows-items` and
// `presentation/hud-labels-drawn`, every one of which fails a build that drew
// none of them. This point is the contrast those points do not read.
//
// THE WORLD IT POSES. The title screen over an emptied table, and then an empty
// table in play. Nothing is posed onto either, so every run of text the two
// frames draw is the build's own screen copy: specs/screens.md lets the table
// "show behind the screen, dimmed or otherwise quieted", and a card left standing
// there would have put a rank and a suit among the runs this point reads.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { HUD_H, HUD_Y } from "../constants";
import {
  captureStill,
  createHarness,
  drawFrame,
  drawnTextSpans,
  openTable,
  type Harness,
  type TextSpan,
} from "../harness";
import { spanContrast } from "./reading";

/**
 * How far a run of text must read from what it was drawn on, in RGB distance out
 * of `441`.
 *
 * The review item's own figure. specs/overview.md requires every string to be
 * "legible against its background at the logical stage size" and fixes no colour,
 * so the bar is what a measurement can honestly call readable rather than a
 * shade against a shade: `60` is about a seventh of the scale — a mid grey on a
 * black, and well under the contrast any pair of colours chosen to be read
 * manages. The `none` and `structured-2d` suites hold the same requirement to the
 * same figure.
 */
const LEGIBLE_MIN = 60;

/** Runs with nothing in them are not text a player reads. */
function drawnRuns(spans: readonly TextSpan[]): TextSpan[] {
  return spans.filter(
    (span) => span.text.trim() !== "" && span.right > span.left,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws every title-screen string and every HUD label against a background it reads on", async () => {
  h.debug.reset();
  h.debug.clearTable();
  h.debug.setScreen("title");
  const title = drawnRuns(drawnTextSpans(h, await drawFrame(h)));
  captureStill(h, "text");

  for (const span of title) {
    assertGreaterThanOrEqual(
      spanContrast(h, span),
      LEGIBLE_MIN,
      `the contrast of ${JSON.stringify(span.text)}, drawn on the title ` +
        `screen at (${span.x.toFixed(0)}, ${span.y.toFixed(0)}), against what ` +
        "the build drew it on, out of 441 (specs/overview.md: every screen's " +
        "text is legible against its background at the logical stage size)",
    );
  }

  openTable(h);
  const hud = drawnRuns(drawnTextSpans(h, await drawFrame(h))).filter(
    (span) => span.y >= HUD_Y && span.y <= HUD_Y + HUD_H,
  );

  for (const span of hud) {
    assertGreaterThanOrEqual(
      spanContrast(h, span),
      LEGIBLE_MIN,
      `the contrast of ${JSON.stringify(span.text)}, drawn in the HUD strip ` +
        `at (${span.x.toFixed(0)}, ${span.y.toFixed(0)}), against what the ` +
        "build drew it on, out of 441 (specs/overview.md: the label of every " +
        "HUD control is legible against its background at the logical stage " +
        "size)",
    );
  }
});
