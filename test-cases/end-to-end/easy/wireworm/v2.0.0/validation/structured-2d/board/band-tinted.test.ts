// Wireworm — board/band-tinted: the player band reads as a distinct floor.
//
// specs/board.md fixes the band as the bottom two rows of the grid, rows 18 and
// 19, spanning `y` in `[BAND_TOP_Y, 720]` (`[656, 720]`) across the full width of
// the board, and specs/overview.md's legibility table requires that "the player
// band reads as a distinct floor across the full width of the board". The
// palette is entirely the build's, so what is read here is not a colour but a
// DIFFERENCE: at each of a set of columns spanning the width, the band's own
// tint against the board's tint directly above it.
//
// Each reading is a PATCH rather than a point, averaged down a strip of the band
// and down a strip of the board at the same columns. That is what keeps the
// check about the tint: a build that etches a trace grid, or lays a vignette or
// a texture over its board, has no single board colour at a single pixel, and a
// one-pixel-wide sample landing on an etched line would compare a line against a
// floor rather than a floor against a board.
//
// The board is posed EMPTY and quiet, so the only thing between the two strips
// is the ground the build drew. The one thing that cannot be taken off the band
// is the cursor, which lives there (specs/cursor.md); the columns its sprite
// covers are left out of the reading rather than moved out of the way, because
// the requirement is about the band the cursor sits in.

import { afterEach, beforeEach, it } from "vitest";
import {
  BAND_TOP_Y,
  BOARD_Y,
  SPRITE_SIZE,
  STAGE_H,
  STAGE_W,
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
 * How far the band's tint must sit from the board's, in RGB distance on the
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

/** How many columns the width is read at, and how wide each patch is. */
const COLUMNS = 25;
const PATCH_HALF = 8;

/** The first and last column centre, kept a patch's width inside the stage. */
const FIRST_X = PATCH_HALF + 4;
const LAST_X = STAGE_W - PATCH_HALF - 4;

/**
 * The strip of the band each patch averages: the whole band, `[656, 720]`, held
 * two units off each edge so a one-pixel lip or rule at the boundary is not what
 * the reading is made of.
 */
const BAND_TOP = BAND_TOP_Y + 2;
const BAND_BOTTOM = STAGE_H - 2;

/**
 * The strip of the board each patch averages: the board above the band,
 * `[80, 656]`, held six units off each end — clear of the HUD bar's own boundary
 * above and of the band's edge below.
 */
const BOARD_TOP = BOARD_Y + 6;
const BOARD_BOTTOM = BAND_TOP_Y - 6;

/** How far a patch stays clear of the cursor's sprite, in logical units. */
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

it("tints the bottom two rows apart from the board across the full width", async () => {
  startPlaying(h);
  await h.advance(1);
  captureStill(h, "band");

  const cursorX = h.snapshot().cursor.x;
  for (let index = 0; index < COLUMNS; index += 1) {
    const x = Math.round(
      FIRST_X + (index * (LAST_X - FIRST_X)) / (COLUMNS - 1),
    );
    // The cursor stands in the band and is drawn there; the columns its sprite
    // covers say nothing about the floor under it.
    if (Math.abs(x - cursorX) < CURSOR_CLEARANCE) continue;

    const band = meanPatch(h, x, BAND_TOP, BAND_BOTTOM);
    const board = meanPatch(h, x, BOARD_TOP, BOARD_BOTTOM);
    assertGreaterThan(
      colorDistance(band, board),
      BAND_DISTINCT_MIN,
      `the band against the board at x ${x}`,
    );
  }
});
