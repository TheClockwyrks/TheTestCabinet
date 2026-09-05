// floor/grid-visible — the tile grid is on the floor at all times, including with
// nothing built.
//
// THE RULE. specs/overview.md's legibility table: "The tile grid is visible on
// the floor at all times, including with no tower placed." specs/floor.md fixes
// where the lines fall — the floor is `COLS x ROWS` tiles of `TILE` units, so a
// tile boundary sits at every `tileLeft(c)` and every `tileTop(r)`. Put together:
// at a tile boundary the floor looks different from the middle of the tile beside
// it, everywhere on the floor, with nothing standing on it.
//
// HOW IT IS READ. Along a stretch of bare floor, one pixel at the middle of each
// tile and three at each boundary between them — the boundary itself and the
// pixel either side of it, because a one-unit line drawn at a half-unit offset
// lands on either of the two pixels the boundary runs between. The reading for a
// boundary is the largest of those three distances from the tile's own middle.
// Nothing here is compared against a colour: specs/overview.md fixes no palette,
// so what a grid line looks like is the build's and all a check may lean on is
// that the line is not the floor.
//
// WHAT THE PICTURE IS ASKED, AND WHAT IT IS NEVER ASKED. Whether the build drew
// a line where the specification puts a tile boundary, on each axis. How many of
// the boundaries carry one, how strongly they are drawn and what they look like
// are the reviewer's, from the still this point captures — specs/overview.md asks
// for a grid a player can see and fixes no proportion, no palette and no weight,
// so no proportion is a figure a check may hold a build to.
//
// WHY THE STRETCHES ARE POOLED. A build may draw anything it likes on its floor —
// plate texture, lane markings, a vignette, a zone wash — and any of it can sit
// over a stretch of boundaries and hide them. So three spread stretches are read
// on each axis and their boundaries are pooled, and a build whose grid is hidden
// under one stretch of art answers on the other two. A floor with no grid on an
// axis at all carries no line at any of them.
//
// WHY NOTHING IS DRIVEN BEYOND ONE FRAME. The requirement is about a state, not a
// stretch of time: one frame renders the posed floor and the pixels are read off
// it.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { TILE, tileCX, tileCY, tileLeft, tileTop } from "../constants";
import type { Point } from "../geometry";
import {
  captureStill,
  colorDistance,
  createHarness,
  poseTarget,
  poseTower,
  startRun,
  type Harness,
} from "../harness";
import { pixelsAt } from "./read";

/**
 * How far, out of the 441 the RGB cube spans, a pixel at a tile boundary must sit
 * from the middle of the tile beside it for the boundary to count as drawn.
 *
 * A grid line is the faintest thing the specification asks a build to draw: it
 * has to be readable without competing with the towers and the surge on top of
 * it, so a build is right to keep it quiet. 8 is under two per cent of the scale
 * — about the smallest step that reads as a line on a dark ground, and low enough
 * that a deliberately understated grid is not failed for being understated. A
 * floor with no grid at all reads 0.
 */
const LINE_CONTRAST_MIN = 8;

/**
 * How many of an axis's pooled boundaries must carry a line: one.
 *
 * A count rather than a proportion, and the smallest count there is, because it
 * is presence that is being read: the floor either carries lines at its tile
 * boundaries or it does not. A floor drawing no grid at all reads 0.
 */
const BOUNDARIES_DRAWN_MIN = 1;

/** Rows the vertical lines are read across, and the tiles they are read over. */
const SCAN_ROWS: readonly number[] = [4, 12, 30];
const SCAN_COL_FROM = 3;
const SCAN_COL_TO = 16;

/** Columns the horizontal lines are read down, and the tiles they are read over. */
const SCAN_COLS: readonly number[] = [6, 15, 40];
const SCAN_ROW_FROM = 3;
const SCAN_ROW_TO = 14;

/** The boundary itself, and the pixel either side of it. */
const BOUNDARY_WINDOW: readonly number[] = [-1, 0, 1];

/** One boundary's reading: the interior it is compared against, and its window. */
interface Boundary {
  name: string;
  interior: Point;
  window: Point[];
}

/** Every internal column boundary of a row's scanned stretch. */
function verticalBoundaries(row: number): Boundary[] {
  const found: Boundary[] = [];
  for (let col = SCAN_COL_FROM + 1; col <= SCAN_COL_TO; col += 1) {
    found.push({
      name: `the boundary before column ${col} on row ${row}`,
      interior: { x: tileCX(col), y: tileCY(row) },
      window: BOUNDARY_WINDOW.map((offset) => ({
        x: tileLeft(col) + offset,
        y: tileCY(row),
      })),
    });
  }
  return found;
}

/** Every internal row boundary of a column's scanned stretch. */
function horizontalBoundaries(col: number): Boundary[] {
  const found: Boundary[] = [];
  for (let row = SCAN_ROW_FROM + 1; row <= SCAN_ROW_TO; row += 1) {
    found.push({
      name: `the boundary above row ${row} on column ${col}`,
      interior: { x: tileCX(col), y: tileCY(row) },
      window: BOUNDARY_WINDOW.map((offset) => ({
        x: tileCX(col),
        y: tileTop(row) + offset,
      })),
    });
  }
  return found;
}

/** How many of `boundaries` carry a line, and the readings behind it. */
function linesDrawn(
  h: Harness,
  boundaries: readonly Boundary[],
): { drawn: number; total: number; readings: number[] } {
  const points: Point[] = [];
  for (const boundary of boundaries) {
    points.push(boundary.interior, ...boundary.window);
  }
  const read = pixelsAt(h, points);
  const stride = 1 + BOUNDARY_WINDOW.length;
  const readings: number[] = [];
  for (let index = 0; index < boundaries.length; index += 1) {
    const base = index * stride;
    const interior = read[base];
    let best = 0;
    for (let offset = 1; offset < stride; offset += 1) {
      best = Math.max(best, colorDistance(read[base + offset], interior));
    }
    readings.push(best);
  }
  return {
    drawn: readings.filter((value) => value >= LINE_CONTRAST_MIN).length,
    total: readings.length,
    readings,
  };
}

/** Both axes of a posed floor, asserted together. */
function assertGridReadable(h: Harness, state: string): void {
  const axes = [
    {
      axis: "vertical lines at the column boundaries",
      boundaries: SCAN_ROWS.flatMap(verticalBoundaries),
      pitch: `every ${TILE} units across`,
    },
    {
      axis: "horizontal lines at the row boundaries",
      boundaries: SCAN_COLS.flatMap(horizontalBoundaries),
      pitch: `every ${TILE} units down`,
    },
  ];

  for (const { axis, boundaries, pitch } of axes) {
    const { drawn, total, readings } = linesDrawn(h, boundaries);
    assertGreaterThanOrEqual(
      drawn,
      BOUNDARIES_DRAWN_MIN,
      `${state}: ${axis}, ${pitch} (specs/floor.md), drawn at ${drawn} of ` +
        `${total} boundaries; the readings were ` +
        `[${readings.map((value) => value.toFixed(1)).join(", ")}] and a ` +
        `boundary counts as drawn at ${LINE_CONTRAST_MIN}`,
    );
  }
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the grid on a floor with nothing built on it", async () => {
  startRun(h);
  await h.advance(1);
  captureStill(h, "grid");

  assertGridReadable(h, "an empty floor");
});

it("still draws the grid with the floor in play", async () => {
  startRun(h);
  // Towers and surge well clear of the stretches read below, so what is measured
  // is the floor's own grid rather than what is standing on it.
  poseTower(h, "arc", 40, 22);
  poseTower(h, "arc", 44, 28);
  poseTarget(h, "mote", 44, 12);
  poseTarget(h, "hulk", 46, 20);
  h.debug.setPhase("wave");
  await h.advance(1);

  assertGridReadable(h, "a floor in play");
});
