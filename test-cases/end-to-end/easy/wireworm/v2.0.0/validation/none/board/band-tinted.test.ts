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
import { assertGreaterThan } from "../assert";
import {
  BAND_TOP_Y,
  BOARD_Y,
  COLS,
  SPRITE_SIZE,
  STAGE_H,
  TILE,
  tileCX,
} from "../constants";
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

/**
 * How far apart the samples of a patch are laid, in logical units.
 *
 * A band row's strip is 28 units tall and the board's 564, so the two are walked
 * at different steps to keep both patches to a comparable count of samples: what
 * a patch is for is an average over the ground, and a denser walk of the taller
 * strip would buy nothing but crossings into the page.
 */
const PATCH_STEP_X = 4;
const BAND_STEP_Y = 4;
const BOARD_STEP_Y = 32;

/** Every point of one patch: a rectangle walked at the steps above. */
function patchPoints(
  x: number,
  top: number,
  bottom: number,
  stepY: number,
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (let sx = x - PATCH_HALF; sx <= x + PATCH_HALF; sx += PATCH_STEP_X) {
    for (let sy = top; sy <= bottom; sy += stepY) {
      points.push({ x: sx, y: sy });
    }
  }
  return points;
}

/** The mean of a run of sampled pixels. */
function mean(read: readonly [number, number, number, number][]): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [pr, pg, pb] of read) {
    r += pr;
    g += pg;
    b += pb;
  }
  return { r: r / read.length, g: g / read.length, b: b / read.length };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("tints both band rows apart from the board, across the full width", async () => {
  await startPlaying(h);
  await h.advance(1);
  await captureStill(h, "band");

  const snapshot = await h.snapshot();
  const columns = COLUMNS.filter(
    // The cursor stands in the band and is drawn there; the columns its sprite
    // covers say nothing about the floor under it.
    (c) => Math.abs(tileCX(c) - snapshot.cursor.x) >= CURSOR_CLEARANCE,
  );

  // Every point of every patch in one crossing into the page, so the reading is
  // one picture rather than a walk the build could have drawn a frame under.
  const bandPoints = columns.map((c) =>
    BAND_ROWS.map((band) =>
      patchPoints(tileCX(c), band.top, band.bottom, BAND_STEP_Y),
    ),
  );
  const boardPoints = columns.map((c) =>
    patchPoints(tileCX(c), BOARD_TOP, BOARD_BOTTOM, BOARD_STEP_Y),
  );
  const read = await h.pixels([...bandPoints.flat(2), ...boardPoints.flat()]);

  let taken = 0;
  const bands = bandPoints.map((perRow) =>
    perRow.map((points) => mean(read.slice(taken, (taken += points.length)))),
  );
  const boards = boardPoints.map((points) =>
    mean(read.slice(taken, (taken += points.length))),
  );

  for (const [index, c] of columns.entries()) {
    for (const [row, band] of BAND_ROWS.entries()) {
      assertGreaterThan(
        colorDistance(bands[index][row], boards[index]),
        BAND_DISTINCT_MIN,
        `band row ${band.row} against the board, both in column ${c} ` +
          `(x ${tileCX(c)})`,
      );
    }
  }
});
