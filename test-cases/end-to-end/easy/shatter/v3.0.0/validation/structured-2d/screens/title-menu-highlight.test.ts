// screens/title-menu-highlight — the title menu shows which entry confirming
// would take, and the mark moves with the selection.
//
// `specs/ui.md`: "The highlighted entry is drawn distinctly from the others, so
// a player always sees which entry confirming would take." `menuIndex` is the
// entry that highlight rests on, and `specs/instrumentation.md`'s `setMenuIndex`
// "Sets the highlighted entry of whatever menu the current screen shows".
//
// TWO FRAMES OF THE SAME GAME AT THE SAME INSTANT, DIFFERING ONLY IN
// `menuIndex`. Each is drawn on a HARNESS OF ITS OWN, freshly built and given a
// `reset(DEFAULT_SEED)` and one `setMenuIndex` before its single frame. Two
// harnesses rather than two passes over one, because both must stand at the same
// point of the game's own clock and carry the same generator: `specs/ui.md`
// allows "the star and a few dimmed drifting rocks" behind the title menu, and a
// check that compared two frames a tick apart would read that drift as a
// highlight. A fresh harness has run no frame, whatever the build's `reset`
// does with `simTime`, and the shared seed makes what is behind the menu the
// same in both. So EVERY pixel that differs between the two frames differs
// because of the selection, and nothing here rests on a second requirement being
// met first.
//
// BOTH ENTRIES' ROWS MUST CHANGE, and that is the whole of "the difference moves
// with setMenuIndex". Moving the selection from entry 0 to entry 1 takes the
// mark OFF the first row and PUTS it on the second, so both rows are drawn
// differently in the two frames. A build that draws every entry alike fails
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
import { DEFAULT_SEED, TITLE_ITEMS } from "../../src/constants";
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
 * How far apart two colours must be, out of the `441` an RGB difference runs to,
 * for a pixel to count as drawn differently.
 *
 * The bound the rest of this case uses for a mark a player can see: `60` of
 * `441` is what `presentation/*` requires between a body and the field behind
 * it, and a highlight that must show "a player always sees which entry
 * confirming would take" (`specs/ui.md`) is a mark of at least that standing.
 * Well above any anti-aliasing difference, which moves a pixel a few units at
 * most.
 */
const CHANGED_DISTANCE = 60;

/**
 * How many pixels of a row must change for the row to have been drawn
 * differently.
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

/** The harness whose title screen has the highlight on the first entry. */
let h: Harness;

/** The harness whose title screen has it on the second, at the same instant. */
let moved: Harness;

beforeEach(async () => {
  h = await createHarness();
  moved = await createHarness();
});

afterEach(() => {
  h?.dispose();
  moved?.dispose();
});

it("draws the entry menuIndex names differently, and moves that difference with setMenuIndex", async () => {
  // The title screen with the highlight on the first entry.
  resetTo(h, DEFAULT_SEED);
  h.debug.setMenuIndex(FIRST);
  clearCalls(h);
  await h.advance(1);
  const rows = menuRows(h, TITLE_ITEMS);
  const onFirst = canvasPixels(h);

  // The same screen of the same game at the same instant, with the highlight on
  // the second entry and nothing else changed.
  resetTo(moved, DEFAULT_SEED);
  moved.debug.setMenuIndex(SECOND);
  clearCalls(moved);
  await moved.advance(1);
  const onSecond = canvasPixels(moved);
  captureStill(moved, "highlight");

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
    assertGreaterThanOrEqual(
      bandChanged(h, onFirst, onSecond, rows[entry].y, half, CHANGED_DISTANCE),
      CHANGED_PIXELS,
      `pixels of the row ${JSON.stringify(rows[entry].item)} was drawn on ` +
        `that differ by more than ${String(CHANGED_DISTANCE)} of 441 between ` +
        `menuIndex ${String(FIRST)} and menuIndex ${String(SECOND)}, read ` +
        `${String(half)} units either side of y ${String(rows[entry].y)} — ` +
        "the highlighted entry is drawn distinctly from the others " +
        "(specs/ui.md), so moving the selection changes how BOTH the entry it " +
        "left and the entry it landed on are drawn",
    );
  }
});
