// screens/title-menu-highlight — the title menu shows which entry confirming
// would take, and the mark moves with the selection.
//
// `specs/ui.md`: "The highlighted entry is drawn distinctly from the others, so
// a player always sees which entry confirming would take." `menuIndex` is the
// entry that highlight rests on, and `specs/instrumentation.md`'s `setMenuIndex`
// "Sets the highlighted entry of whatever menu the current screen shows".
//
// THREE FRAMES OF ONE GAME A TICK APART, THE LAST WITH `menuIndex` MOVED.
// `specs/ui.md` allows the title screen a moving backdrop — "the star and a few
// dimmed drifting rocks" may show behind the menu — so a row's pixels may change
// from one tick to the next with no highlight involved, and a check that read
// two frames a tick apart would count that drift as a highlight. So the first
// two frames are read with the selection HELD, which measures what one tick of
// the build's own backdrop does to each row on its own, and the third with the
// selection MOVED. What is asserted is how much MORE the move repainted than the
// control tick did, so the backdrop is subtracted out rather than mistaken for a
// highlight, and nothing here rests on a second requirement being met first.
//
// BOTH ENTRIES' ROWS MUST CHANGE, and that is the whole of "the difference moves
// with setMenuIndex". Moving the selection from entry 0 to entry 1 takes the
// mark OFF the first row and PUTS it on the second, so both rows are drawn
// differently once it has moved. A build that draws every entry alike fails
// because neither row changes; one that always marks the same entry whatever
// `menuIndex` says fails for the same reason; one that marks the wrong entry
// still moves its mark and is caught instead by `controls/menu-*` and by the
// items that decide where each entry leads.
//
// THE READING IS THE WHOLE ROW, because WHERE a build puts its mark is the
// build's: a marker glyph beside the words, a plate behind them, an underline
// beneath them, or a recolouring of the words themselves are the same
// requirement met four ways, and only a band across the field sees all four.
// The band is set from the gap the build itself left between its two rows, so
// the two bands never overlap and a change on one row is never counted as a
// change on the other.
//
// WHAT THIS DOES NOT DECIDE. That the entries are drawn at all and in order
// (`screens/title-menu-entries`), which entry the keys move the highlight to
// (`controls/menu-*`), and where confirming leads (`screens/play-starts-a-game`,
// `screens/howto-reachable`).

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertGreaterThan, assertGreaterThanOrEqual } from "../assert";
import {
  canvasPixels,
  captureStill,
  clearCalls,
  createHarness,
  resetTo,
  type Harness,
} from "../harness";
import { bandChanged, menuRows } from "./reading";

/** The entry the first frame highlights: `PLAY`, the first of `TITLE_ITEMS`. */
const FIRST = 0;

/** The entry the second frame highlights: `HOW TO PLAY`, the second. */
const SECOND = 1;

/**
 * The sensing floor on a change: how far a reading must move between two frames
 * before the move can be called a redrawing, of the 441 an RGB distance can span.
 *
 * Eight. Below that a sampling cannot tell a redrawing from the rounding of an
 * 8-bit channel and the host's own anti-aliasing; above it nothing is decided
 * about how strongly the two readings differ. Anything the build drew differently
 * clears it, however faintly it drew it.
 */
const CHANGED_DISTANCE = 8;

/**
 * How many pixels of a row the move must repaint, beyond what the control tick
 * repainted on that same row, for the row to have been drawn differently.
 *
 * `specs/ui.md` requires every piece of a screen's text to be legible at the
 * logical field size, `1280 x 720`, so a menu entry's glyphs are of the order of
 * twenty units tall and the smallest mark a build could distinguish an entry
 * with — a single marker glyph of that height — carries something like eighty
 * pixels of ink. Sixty-four is under that and far under the thousands a
 * recoloured run or a plate changes, while ruling out a handful of pixels moving
 * at the edge of a glyph.
 */
const CHANGED_PIXELS = 64;

/**
 * The half-height of the band read for each row, as a fraction of the gap the
 * build left between its two rows.
 *
 * Two fifths of the gap, so the two bands together cover four fifths of the
 * space between the rows and still leave a fifth of it between them: every row
 * is read whole and no change on one row is ever counted on the other. Taken
 * from the build's own spacing rather than fixed, because `specs/ui.md` leaves
 * the layout of each screen to the build.
 */
const BAND_FRACTION = 0.4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the entry menuIndex names differently, and moves that difference with setMenuIndex", async () => {
  // The title screen with the highlight on the first entry.
  resetTo(h);
  h.debug.setMenuIndex(FIRST);
  clearCalls(h);
  await h.advance(1);
  const rows = menuRows(h, TITLE_ITEMS);
  const held = canvasPixels(h);

  // The same screen a tick later with the selection held, so the change between
  // the two is the build's own backdrop and nothing else.
  await h.advance(1);
  const control = canvasPixels(h);

  // And a tick after that with the highlight moved to the second entry.
  h.debug.setMenuIndex(SECOND);
  await h.advance(1);
  const moved = canvasPixels(h);
  captureStill(h, "highlight");

  const gap = rows[SECOND].y - rows[FIRST].y;
  assertGreaterThan(
    gap,
    0,
    "the logical units between the two drawn menu rows — the entries are " +
      "stacked one above the next (specs/ui.md), and a menu whose entries " +
      "share one row can show no selection among them",
  );

  const half = gap * BAND_FRACTION;
  for (const entry of [FIRST, SECOND]) {
    const y = rows[entry].y;
    const backdrop = bandChanged(h, held, control, y, half, CHANGED_DISTANCE);
    const repainted = bandChanged(h, control, moved, y, half, CHANGED_DISTANCE);
    assertGreaterThanOrEqual(
      repainted - backdrop,
      CHANGED_PIXELS,
      `pixels of the row ${JSON.stringify(rows[entry].item)} was drawn on ` +
        `that differ by more than ${String(CHANGED_DISTANCE)} of 441 between ` +
        `menuIndex ${String(FIRST)} and menuIndex ${String(SECOND)}, beyond ` +
        `the ${String(backdrop)} a tick of the build's own backdrop repainted, ` +
        `read ${String(half)} units either side of y ${String(y)} — ` +
        "the highlighted entry is drawn distinctly from the others " +
        "(specs/ui.md), so moving the selection changes how BOTH the entry it " +
        "left and the entry it landed on are drawn",
    );
  }
});
