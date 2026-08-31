// screens/title-menu-highlight — the highlighted entry is drawn distinctly, and
// the distinction follows `menuIndex`.
//
// THE RULE. `specs/ui.md`: "the highlighted entry is drawn distinctly from the
// others, so a player always sees which entry confirming would take".
// `specs/instrumentation.md` reports which entry that is as `menuIndex` and gives
// `setMenuIndex` to move it. So the requirement has two halves that are really
// one: the row the highlight is ON is painted differently from the way the SAME
// row is painted when the highlight is elsewhere.
//
// WHY THE SAME ROW IS COMPARED WITH ITSELF, AND NEVER THE TWO ROWS WITH EACH
// OTHER. `PLAY` and `HOW TO PLAY` are different words of different lengths, so two
// rows of a menu differ at thousands of pixels whether or not either is
// highlighted; a check comparing them would pass on a build with no highlight at
// all. Each row is therefore read twice — once holding the highlight, once not —
// and it is the CHANGE that is graded. That is also what makes this the item's own
// requirement rather than a second reading of `screens/title-menu-entries`: the
// copy is not compared here at all.
//
// AND BOTH ROWS ARE GRADED, because "the highlight moves" is the thing a player
// depends on. A build that drew a permanent mark on the first entry changes
// nothing when the selection moves; a build that drew a fixed marker somewhere off
// the menu changes neither row. Each of those fails a half, and the failure names
// the row.
//
// THE CONTROL FRAME. `specs/ui.md` allows the title screen a moving backdrop —
// "the star and a few dimmed drifting rocks may show behind the menu" — so a row's
// pixels may change from one tick to the next with no highlight involved. Three
// frames are therefore read a tick apart: the first two with the selection HELD,
// which measures what one tick of the build's own animation does to each row on
// its own, and the third with the selection MOVED. What is asserted is the
// difference between the two, so a build's backdrop is subtracted out rather than
// mistaken for a highlight.
//
// THE BOUNDS. A pixel counts as repainted when its colour moved by more than
// `SAMPLE_DELTA` of the `441` an RGB distance can span, and the move must repaint
// more than `MIN_REPAINT` pixels of the row beyond what the control tick did. No
// palette is asserted and no mark is required: a build that highlights by colour,
// by weight, by a bar behind the entry, by an arrow beside it or by any two of
// those passes alike, which is what `specs/overview.md` leaving the look to the
// build requires of this check.
//
// WHAT THIS ITEM DOES NOT DECIDE. That the entries are drawn at all or in order,
// which is `screens/title-menu-entries`, nor that a KEY moves the highlight, which
// is `controls/menu-up-arrow` and its four siblings — the selection is moved here
// through `setMenuIndex`, so what is graded is the drawing and not the input.

import { afterEach, beforeEach, it } from "vitest";
import { FIELD_W, TITLE_ITEMS } from "../../src/constants";
import { assertEqual, assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { changedPixels, entryRow, readBand, textRuns, type Band } from "./menu";

/**
 * How far a pixel's colour must move to count as repainted, of the `441` an RGB
 * distance can span.
 *
 * Far above what re-drawing identical text can do to an anti-aliased edge — that
 * is a fraction of a level — and far below the contrast between a highlighted
 * entry and an un-highlighted one, which a player has to read at a glance.
 */
const SAMPLE_DELTA = 16;

/**
 * How many pixels of a row the highlight must repaint, over and above what the
 * control tick repainted on that same row.
 *
 * Derived from legibility rather than from any palette. `specs/ui.md` requires
 * every piece of screen text to be legible at the logical field size,
 * `1280 x 720`; a capital drawn legibly at that size is some twenty units across
 * and thirty tall, so the shortest of the two entries puts several hundred pixels
 * of ink on its row. Two hundred is therefore under one legible letter's worth: a
 * build repainting less than that has not made a distinction a player can see,
 * and a build that re-colours, re-weights or backs the entry repaints many times
 * it.
 */
const MIN_REPAINT = 200;

/** The two entries `specs/ui.md` fixes for the title menu. */
const ENTRIES = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * The full-width strip of the field one menu row occupies.
 *
 * Full width on purpose: `specs/ui.md` fixes no layout, so a build may say
 * "selected" with a bar across the field, with a caret out to the left of the
 * word, or with the word itself — and every one of those is on the row. The strip
 * is half the spacing between the two rows either side of the row's own baseline,
 * so the two strips meet and never overlap, and what is read of one row is never
 * the other row's doing.
 */
function rowBand(centre: number, half: number): Band {
  return { left: 0, top: centre - half, right: FIELD_W, bottom: centre + half };
}

it("draws the selected title entry differently, and moves that difference with menuIndex", async () => {
  assertEqual(
    TITLE_ITEMS.length,
    ENTRIES,
    "the title entries specs/ui.md fixes, which the two rows read here are",
  );

  h.debug.reset();
  h.debug.setMenuIndex(0);
  h.clearCalls();
  await h.advance(1);

  assertEqual(h.snapshot().screen, "title", "the screen the menu was read on");
  assertEqual(
    h.snapshot().menuIndex,
    0,
    "the entry setMenuIndex posed the highlight on",
  );

  // Where the build put each row, read off the frame that has just been drawn.
  const runs = textRuns(h, h.calls);
  const first = entryRow(runs, TITLE_ITEMS, 0);
  const second = entryRow(runs, TITLE_ITEMS, 1);
  const firstY = (first.top + first.bottom) / 2;
  const secondY = (second.top + second.bottom) / 2;
  const half = Math.abs(secondY - firstY) / 2;
  assertGreaterThan(
    half,
    0,
    "the spacing between the two rows of a menu whose entries specs/ui.md " +
      "stacks one above the next, in logical units",
  );
  const rows = [rowBand(firstY, half), rowBand(secondY, half)];

  // Three frames a tick apart. The first two hold the selection, so the change
  // between them is the build's own backdrop and nothing else; the third moves it.
  const held = rows.map((band) => readBand(h, band));
  await h.advance(1);
  const control = rows.map((band) => readBand(h, band));
  h.debug.setMenuIndex(1);
  await h.advance(1);
  const moved = rows.map((band) => readBand(h, band));
  captureStill(h, "highlight");

  assertEqual(
    h.snapshot().menuIndex,
    1,
    "the entry setMenuIndex moved the highlight to",
  );

  for (const [index, item] of TITLE_ITEMS.entries()) {
    const backdrop = changedPixels(held[index], control[index], SAMPLE_DELTA);
    const repainted = changedPixels(control[index], moved[index], SAMPLE_DELTA);
    assertGreaterThan(
      repainted - backdrop,
      MIN_REPAINT,
      `pixels of the ${JSON.stringify(item)} row the highlight moving off or ` +
        `onto it repainted, beyond the ${backdrop} a tick of the build's own ` +
        `backdrop repainted (specs/ui.md)`,
    );
  }
});
