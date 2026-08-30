// Wireworm — board/band-tinted: the player band reads as a distinct floor.
//
// specs/board.md fixes the band as the bottom two rows of the grid, rows 18 and
// 19, spanning `y` in `[BAND_TOP_Y, 720]` (`[656, 720]`) across the full width of
// the board, and specs/overview.md's legibility table requires that "the player
// band reads as a distinct floor across the full width of the board". The
// palette is entirely the build's, so what is read here is not a colour but a
// DIFFERENCE: at every column of the grid, each of the band's two rows against
// the board's tint directly above it.
//
// EACH BAND ROW IS READ ON ITS OWN, because the requirement is about the band and
// the band is two rows. Averaging the two together would let a build that tinted
// row 19 and left row 18 as bare board clear the bar on the half it drew, and a
// player looking at that picture sees a one-row floor.
//
// ACROSS EVERY COLUMN, because "across the full width" is the half of the
// sentence a band drawn as a strip under the cursor, or one fading out toward the
// edges, would fail. Each band patch is held against the board patch in ITS OWN
// column, so a board with a horizontal gradient behind it reads the same as a
// flat one.
//
// EACH READING IS A PATCH RATHER THAN A POINT, averaged across a rectangle of the
// row and across a strip of the board at the same column. That is what keeps the
// check about the tint: a build that etches a trace grid, or lays a vignette or a
// texture over its board, has no single board colour at a single pixel, and a
// one-pixel sample landing on an etched line would compare a line against a floor
// rather than a floor against a board.
//
// The board is posed EMPTY and quiet, so the only thing between the two patches
// is the ground the build drew. The one thing that cannot be taken off the band
// is the cursor, which lives there (specs/cursor.md); its box straddles both
// rows, so the columns its sprite covers are left out of the reading rather than
// moved out of the way, because the requirement is about the band the cursor
// sits in.
//
// The `none`, `simple-2d` and `structured-2d` suites take the same reading
// against the same figure.

import { afterEach, beforeEach, it } from "vitest";
import {
  BAND_TOP_Y,
  BOARD_Y,
  COLS,
  SPRITE_SIZE,
  STAGE_H,
  TILE,
  tileCX,
} from "../../src/constants";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  startPlaying,
  type Harness,
  type Rgb,
} from "../harness";

/**
 * How far a band row's tint must sit from the board's, in RGB distance on the
 * 0–441 scale, for the two to be "measurably distinct".
 *
 * Deliberately well below the 50 this case reads as one body standing CLEARLY
 * APART from another: the band is a tint in the ground rather than a body over
 * it, and specs/overview.md asks only that it "reads as a distinct floor". 20 is
 * about a twentieth of the scale — a shift a player sees as a change of floor,
 * and one no rounding, rasterization or averaging drift produces on its own,
 * since a build that painted the band and the board the same colour measures 0.
 */
const BAND_DISTINCT_MIN = 20;

/** Every column of the grid: "across the full width" read literally. */
const COLUMNS = Array.from({ length: COLS }, (_, c) => c);

/** How wide each patch is, either side of its column's centre. */
const PATCH_HALF = 8;

/**
 * The two rows the band is made of, each held two units off its own edges so a
 * one-pixel lip or rule at a boundary is not what the reading is made of.
 */
const BAND_ROWS: readonly { row: number; top: number; bottom: number }[] = [
  { row: 18, top: BAND_TOP_Y + 2, bottom: BAND_TOP_Y + TILE - 2 },
  { row: 19, top: BAND_TOP_Y + TILE + 2, bottom: STAGE_H - 2 },
];

/**
 * The strip of the board each patch averages: the board above the band,
 * `[80, 656]`, held six units off each end — clear of the HUD bar's own boundary
 * above and of the band's edge below.
 */
const BOARD_TOP = BOARD_Y + 6;
const BOARD_BOTTOM = BAND_TOP_Y - 6;

/**
 * How far a patch stays clear of the cursor's sprite, in logical units. The
 * cursor rests at the band's centre, so its box straddles both rows.
 */
const CURSOR_CLEARANCE = SPRITE_SIZE / 2 + PATCH_HALF + 4;

/** The mean colour of a rectangle of the rendered stage, in logical units. */
function meanPatch(h: Harness, x: number, top: number, bottom: number): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  let taken = 0;
  for (let sx = x - PATCH_HALF; sx <= x + PATCH_HALF; sx += 2) {
    for (let sy = top; sy <= bottom; sy += 2) {
      const [pr, pg, pb] = h.pixel(sx, sy);
      r += pr;
      g += pg;
      b += pb;
      taken += 1;
    }
  }
  return { r: r / taken, g: g / taken, b: b / taken };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("tints both band rows apart from the board, across the full width", async () => {
  startPlaying(h);
  await h.advance(1);
  captureStill(h, "band");

  const cursorX = h.snapshot().cursor.x;
  for (const c of COLUMNS) {
    const x = tileCX(c);
    // The cursor stands in the band and is drawn there; the columns its sprite
    // covers say nothing about the floor under it.
    if (Math.abs(x - cursorX) < CURSOR_CLEARANCE) continue;

    const board = meanPatch(h, x, BOARD_TOP, BOARD_BOTTOM);
    for (const band of BAND_ROWS) {
      assertGreaterThan(
        colorDistance(meanPatch(h, x, band.top, band.bottom), board),
        BAND_DISTINCT_MIN,
        `band row ${band.row} against the board, both in column ${c} (x ${x})`,
      );
    }
  }
});
