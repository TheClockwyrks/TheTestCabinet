// presentation/screen-text-is-legible — every screen's text reads against whatever
// the build drew behind it.
//
// THE RULE. `specs/ui.md`: "Every piece of text a screen shows is legible against
// whatever sits behind it at the logical field size, `1280 x 720`. The palette, the
// type, and the layout of each screen are yours." `specs/overview.md` states it once
// more as something a player reads at a glance: "Every readout and every screen's
// text is legible against its background at the logical field size."
//
// WHAT IS READ, RUN BY RUN. Every run of text a screen's frame drew, placed in
// logical field units through the transform in force at the call, the width it
// measured under the font then set, and the alignment that placed it about its anchor
// (`textRuns`, `ink.ts`). For each, two readings of the BUILD's own frame:
//
//   - AROUND IT. A rectangle of samples just outside the run's box, reduced to their
//     MEDIAN. The median rather than the mean because a run drawn beside another
//     element would otherwise carry that element's colour into the background it is
//     measured against; what is wanted is what the run actually sits on.
//   - AND ON IT. The reading inside the run's box that falls FURTHEST from that
//     background. A glyph covers a fraction of its own box — the counters, the gaps
//     between letters and the space above and below the x-height are all background —
//     so the mark itself is the extreme, never the average.
//
// The distance between the two is what the item asserts. Nothing here fixes a colour,
// a face or a size: the requirement is a CONTRAST, and both sides of it are the
// build's own pixels.
//
// WHY EVERY RUN AND NOT A SAMPLE. `specs/ui.md` says every piece of text, and the
// piece a build gets wrong is usually one — a dimmed unselected menu entry, a footer
// hint, a subtitle under a title. So each run is asserted on its own and the failure
// names the screen and the words that failed.
//
// EXCEPT A RUN SOMETHING WAS PAINTED OVER. The rule is that a screen's text reads
// against whatever sits BEHIND it, and a build that dims the field behind a menu by
// filling the whole of it with a translucent scrim has put something in FRONT of
// everything it drew before — the HUD it leaves showing under the pause menu, for
// one. Reading those runs off the finished frame would measure the scrim rather than
// the text, and fail a build for de-emphasising exactly what the screen means to
// de-emphasise. So the runs read are the ones after the last operation that painted
// over the whole field (`lastFullCover`, `ink.ts`), which on a screen that scrims
// nothing is every run it drew.
//
// THE FIVE SCREENS. `specs/ui.md` fixes exactly five, each with text of its own, so
// each is posed with `setScreen` and read on its own frame. Every screen is posed
// over the same emptied, gated field, so a run is read against the screen's own
// background rather than against whatever rocks a live game had left behind it. The
// highlight is put on the first entry, which is where `specs/ui.md` rests it on
// arriving at a menu, so the check reads a menu in the state the specification
// describes.

import { afterEach, beforeEach, it } from "vitest";
import { FIELD_H, FIELD_W } from "../constants";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  clearCalls,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import type { Screen } from "../surface";
import {
  aroundPoints,
  boxPoints,
  furthestFrom,
  lastFullCover,
  medianColor,
  readPainted,
  readPoints,
  textRuns,
  type Painted,
  type TextRun,
} from "./ink";

/** The five screens `specs/ui.md` fixes, in the order it tabulates them. */
const SCREENS: readonly Screen[] = [
  "title",
  "howto",
  "playing",
  "paused",
  "gameover",
];

/**
 * How far a glyph must sit from what is immediately around it, of the 441 an RGB
 * distance can span.
 *
 * The item's own figure, and the highest separation this group asks of anything: text
 * is read as SHAPES rather than as a body's presence, so it needs more contrast than
 * the sixty a body is told from the field by. Eighty of 441 is about a fifth of one
 * channel's span — a mid grey on a dark ground clears it, and a dim grey on a
 * slightly darker one does not.
 */
const MIN_APART = 80;

/**
 * How far outside a run's box the background is sampled, and how far apart those
 * samples are, in logical units.
 *
 * Five units out, which is clear of a glyph's own anti-aliasing at any size a screen
 * would use and still "immediately around" the run at a field `1280` wide.
 */
const AROUND_OUT = 5;
const AROUND_STEP = 6;

/**
 * How far the box a run's glyphs are sampled inside is inset from the box the run
 * measured, as a fraction of each side.
 *
 * A twentieth off each end and a sixth off the top and bottom. A run's measured box
 * is its advance width and its font size, which are a little wider and a good deal
 * taller than the glyphs inside them, and the inset keeps the sampling on the letters
 * rather than on the leading above and below them.
 */
const INSET_X = 0.05;
const INSET_Y = 0.15;

/** How far apart the samples inside a run's box are, in logical units. */
const ON_STEP = 1;

/** Runs too small or too empty to carry a reading at all are not read. */
const MIN_SIDE = 4;

/** The runs of a frame that show a player something, nothing painted over them. */
function shownRuns(harness: Harness): TextRun[] {
  const covered = lastFullCover(harness.calls, FIELD_W, FIELD_H);
  return textRuns(harness).filter(
    (run) =>
      run.at > covered &&
      run.text.trim() !== "" &&
      run.right - run.left >= MIN_SIDE &&
      run.bottom - run.top >= MIN_SIDE,
  );
}

/** How far a run's own mark sits from the pixels immediately around it, of 441. */
function contrastOf(painted: Painted, run: TextRun): number {
  const width = run.right - run.left;
  const height = run.bottom - run.top;
  const box = { x: run.left, y: run.top, w: width, h: height };
  const background = medianColor(
    readPoints(painted, aroundPoints(box, AROUND_OUT, AROUND_STEP)),
  );
  const glyphs = readPoints(
    painted,
    boxPoints(
      {
        x: run.left + width * INSET_X,
        y: run.top + height * INSET_Y,
        w: width * (1 - 2 * INSET_X),
        h: height * (1 - 2 * INSET_Y),
      },
      ON_STEP,
    ),
  );
  return furthestFrom(glyphs, background);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws every run of text on all five screens clear of what it sits on", async () => {
  for (const screen of SCREENS) {
    startPlaying(h);
    h.debug.setScreen(screen);
    h.debug.setMenuIndex(0);
    clearCalls(h);
    await h.advance(1);
    captureStill(h, "screens");

    const painted = readPainted(h);
    const runs = shownRuns(h);

    assertGreaterThan(
      runs.length,
      0,
      `the ${screen} screen: how many runs of text it drew, where every ` +
        "screen shows text of its own (specs/ui.md)",
    );

    for (const run of runs) {
      assertGreaterThan(
        contrastOf(painted, run),
        MIN_APART,
        `the ${screen} screen, ${JSON.stringify(run.text)}: the RGB distance ` +
          "out of 441 between the run's own mark and the pixels immediately " +
          "around it, which every piece of a screen's text must read against " +
          "(specs/ui.md)",
      );
    }
  }
});
