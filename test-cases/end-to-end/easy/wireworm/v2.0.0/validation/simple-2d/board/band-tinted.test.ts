// Wireworm — board/band-tinted: the player band reads as a distinct floor.
//
// specs/overview.md's legibility table states the requirement in one line — "The
// player band reads as a distinct floor across the full width of the board" —
// and specs/board.md gives the extent it has to hold over: the band is the
// bottom two rows of the grid, rows `BAND_TOP_ROW` (`18`) and `19`, spanning `y`
// in `[BAND_TOP_Y, 720]` (`[656, 720]`) "across the full width of the board".
// It is the one region of the board with a rule of its own: it is where the
// cursor is confined, and a worm segment reaching it is what ends a run.
//
// THE READING IS A COMPARISON, NEVER A COLOUR. specs/overview.md fixes no palette
// and no typeface — "The palette, the type, the glow, and every other aspect of
// the look are yours" — so what is asserted is that the band differs from the
// board directly above it, column by column, on both of its rows. A build with a
// dark board and a bright floor passes; so does one with the opposite; one that
// drew the band exactly like the rest of the board does not.
//
// COLUMN BY COLUMN, because "across the full width" is the half of the sentence a
// band drawn as a strip under the cursor, or one fading out toward the edges,
// would fail. Each band sample is held against the board sample in ITS OWN
// column, so a board with a horizontal gradient behind it reads the same as a
// flat one.
//
// THE CURSOR IS THE ONE THING THAT CANNOT BE POSED AWAY, since it lives in the
// band by definition. It is parked on the band's bottom-left corner — `setCursor`
// applies the real clamp, so `(CURSOR_X_MIN, CURSOR_Y_MAX)` is the far corner of
// the band — which puts its whole box on row `19` at the left edge. Row `18` is
// therefore sampled across the entire width, and row `19` everywhere but the
// column the cursor is standing in.

import { afterEach, beforeEach, it } from "vitest";
import {
  BAND_TOP_ROW,
  BAND_TOP_Y,
  COLS,
  CURSOR_HALF,
  CURSOR_X_MIN,
  CURSOR_Y_MAX,
  ROWS,
  tileCX,
} from "../../src/constants";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  sampleTile,
  startPlaying,
  type Harness,
} from "../harness";

/**
 * How far a band sample must sit from the board sample above it, in RGB distance
 * on the 0–441 scale.
 *
 * The review item asks for a tint "measurably distinct", not for a particular
 * degree of contrast: how the board and its floor look is the build's, and
 * specs/overview.md fixes no colour. So the bar is set at what a measurement can
 * honestly call a difference. Each sample is the mean of five pixels of a flat
 * region, so the noise floor is the canvas's own rounding — under 2 on this
 * scale; 12 is six times that, about seven levels on each channel, which is a
 * tint a player sees as a change of surface rather than as the same surface.
 */
const TINT_MIN = 12;

/**
 * The row of the board each band row is held against: the middle of the play
 * area, well above the band and well below the entry row.
 */
const BOARD_ROW = 10;

/** The two rows the band is made of (specs/board.md). */
const BAND_ROWS = [BAND_TOP_ROW, ROWS - 1] as const;

/** Every column of the grid: "across the full width" read literally. */
const COLUMNS = Array.from({ length: COLS }, (_, i) => i);

/**
 * How far a sampled column has to stand off the cursor's centre to be clear of
 * it, in logical units: its own half-extent plus the half-tile the sample
 * cluster reaches, rounded up to a whole tile.
 */
const CURSOR_CLEARANCE = CURSOR_HALF + 32;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("tints both band rows apart from the board, across the full width", async () => {
  startPlaying(h);
  // The band's far bottom-left corner, so the cursor stands on row 19 alone and
  // in one column of it.
  h.debug.setCursor(CURSOR_X_MIN, CURSOR_Y_MAX);
  await h.advance(1);
  captureStill(h, "band");

  for (const row of BAND_ROWS) {
    for (const c of COLUMNS) {
      // Row 19 carries the cursor; the column it is standing in is the one part
      // of the band this reading cannot own.
      const nearCursor =
        row === ROWS - 1 &&
        Math.abs(tileCX(c) - CURSOR_X_MIN) < CURSOR_CLEARANCE;
      if (nearCursor) continue;

      const tint = colorDistance(
        sampleTile(h, c, row),
        sampleTile(h, c, BOARD_ROW),
      );
      assertGreaterThan(
        tint,
        TINT_MIN,
        `band tile (${c}, ${row}), y in [${BAND_TOP_Y}, 720], against board ` +
          `tile (${c}, ${BOARD_ROW}) in the same column`,
      );
    }
  }
});
