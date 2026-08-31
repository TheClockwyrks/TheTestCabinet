// presentation/build-zone-drawn — a restricted mode shows what it restricts.
//
// THE RULE. specs/overview.md's legibility table: "A mode that restricts building
// draws the zone it restricts building to." specs/modes.md says which mode and
// which tiles: Bottleneck "restricts building to a marked central zone,
// `BOTTLENECK_ZONE`: columns `13` through `36` and rows `8` through `27`, both
// ends included", and "the floor outside the zone stays open for the surge to
// walk". So the zone is not a wall and not a different kind of floor — it is a
// MARK on the floor, and what a player must be able to see is where it stops.
//
// WHERE THE READING IS TAKEN, AND WHY IT IS TAKEN AT THE EDGE. Across the zone's
// own boundary, on four stretches of each of its four sides. A build may mark the
// zone by washing its area, by drawing a border round it, by hatching it, or by
// dimming everything outside it, and every one of those puts something plainly
// different from the bare floor within a few units of the boundary. Reading the
// middle of the zone instead would pass the wash and fail the border, and the
// specification asks for neither in particular.
//
// WHAT IS COMPARED, AND WHY IT IS NEVER A COLOUR. specs/overview.md fixes no
// palette. Each scan is compared against the bare floor on its OWN line, two
// tiles outside the zone, so a build free to shade or texture its floor is
// measured against the floor it drew there. A build that washes the WHOLE floor
// uniformly reads zero everywhere, because its zone edge is then no different
// from the floor beside it — which is the right verdict, since such a build has
// drawn no zone.
//
// WHY THE FIGURE IS 50 AND NOT LOWER. specs/overview.md also requires the tile
// grid to be visible on the floor at all times, so every scan crosses a grid
// line. `floor.grid-visible` puts a line at eight of 441 above the floor,
// deliberately quiet; the bar here is more than six times that, so the grid the
// specification requires cannot be mistaken for the zone it also requires.
//
// WHAT IT DOES NOT DECIDE. WHICH tiles the zone covers, and that a footprint with
// one tile outside it is refused, are `modes.bottleneck-zone` and
// `building.preview-outside-the-zone`. That a refused footprint reads refused is
// `valid-and-invalid-previews-read-apart`.

import { afterEach, beforeEach, it } from "vitest";
import {
  BOTTLENECK_ZONE,
  tileCX,
  tileCY,
  tileLeft,
  tileTop,
} from "../../src/constants";
import { assertGreaterThanOrEqual } from "../assert";
import type { Point } from "../geometry";
import {
  captureStill,
  colorDistance,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { pixelAt, showRgb } from "./read";

/**
 * How far, out of the 441 the RGB cube spans, the mark at the zone's edge must
 * sit from the bare floor outside it.
 *
 * The suite's figure for two things a player tells apart at a glance, and the
 * same 50 every other point in this group draws its line at.
 */
const APART_MIN = 50;

/**
 * How far either side of the boundary a scan looks, in units.
 *
 * Eight units is under half a tile (specs/floor.md fixes `TILE` at 19), so a scan
 * stays inside the rank of tiles on either side of the boundary and cannot reach
 * a second tile's worth of whatever a build drew. It is wide enough for a border
 * of any ordinary weight laid on either side of the line, and for a wash read a
 * few units in from it.
 */
const SCAN_REACH = 8;

/** How far outside the zone the bare-floor reference sits, in tiles. */
const FLOOR_REFERENCE_TILES = 2;

/**
 * Where along each side the scans are taken.
 *
 * Four stretches per side, kept off the corners so each scan crosses one boundary
 * rather than two, and kept off the vent and exhaust runs specs/floor.md fixes,
 * so nothing a build may draw to hint a corridor is read as the zone.
 */
const ALONG_ROWS: readonly number[] = [10, 13, 23, 26];
const ALONG_COLS: readonly number[] = [15, 18, 32, 35];

/** One side of the zone: the scans across it, and the floor outside it. */
interface Side {
  name: string;
  along: readonly number[];
  /** The scan point `offset` units across the boundary at `n` along the side. */
  scan(offset: number, n: number): Point;
  /** Bare floor outside the zone, on `n`'s own line. */
  floorAt(n: number): Point;
}

const SIDES: readonly Side[] = [
  {
    name: "the zone's left edge",
    along: ALONG_ROWS,
    scan: (offset, row) => ({
      x: tileLeft(BOTTLENECK_ZONE.col0) + offset,
      y: tileCY(row),
    }),
    floorAt: (row) => ({
      x: tileCX(BOTTLENECK_ZONE.col0 - FLOOR_REFERENCE_TILES),
      y: tileCY(row),
    }),
  },
  {
    name: "the zone's right edge",
    along: ALONG_ROWS,
    scan: (offset, row) => ({
      x: tileLeft(BOTTLENECK_ZONE.col1 + 1) + offset,
      y: tileCY(row),
    }),
    floorAt: (row) => ({
      x: tileCX(BOTTLENECK_ZONE.col1 + FLOOR_REFERENCE_TILES),
      y: tileCY(row),
    }),
  },
  {
    name: "the zone's top edge",
    along: ALONG_COLS,
    scan: (offset, col) => ({
      x: tileCX(col),
      y: tileTop(BOTTLENECK_ZONE.row0) + offset,
    }),
    floorAt: (col) => ({
      x: tileCX(col),
      y: tileCY(BOTTLENECK_ZONE.row0 - FLOOR_REFERENCE_TILES),
    }),
  },
  {
    name: "the zone's bottom edge",
    along: ALONG_COLS,
    scan: (offset, col) => ({
      x: tileCX(col),
      y: tileTop(BOTTLENECK_ZONE.row1 + 1) + offset,
    }),
    floorAt: (col) => ({
      x: tileCX(col),
      y: tileCY(BOTTLENECK_ZONE.row1 + FLOOR_REFERENCE_TILES),
    }),
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("marks the buildable zone apart from the floor outside it", async () => {
  startRun(h, "bottleneck");
  await h.advance(1);
  captureStill(h, "zone");

  for (const side of SIDES) {
    for (const n of side.along) {
      const beside = side.floorAt(n);
      const floor = pixelAt(h, beside.x, beside.y);
      let best = 0;
      for (let offset = -SCAN_REACH; offset <= SCAN_REACH; offset += 1) {
        const at = side.scan(offset, n);
        best = Math.max(best, colorDistance(pixelAt(h, at.x, at.y), floor));
      }
      assertGreaterThanOrEqual(
        best,
        APART_MIN,
        `${side.name} at ${n}, scanned ${SCAN_REACH} units either side of it: ` +
          `the furthest anything drawn there sits from the bare floor two ` +
          `tiles outside the zone (${showRgb(floor)}), out of 441 ` +
          `(specs/overview.md: a mode that restricts building draws the zone ` +
          `it restricts building to; specs/modes.md: Bottleneck's zone is ` +
          `columns ${BOTTLENECK_ZONE.col0} to ${BOTTLENECK_ZONE.col1} and ` +
          `rows ${BOTTLENECK_ZONE.row0} to ${BOTTLENECK_ZONE.row1})`,
      );
    }
  }
});
