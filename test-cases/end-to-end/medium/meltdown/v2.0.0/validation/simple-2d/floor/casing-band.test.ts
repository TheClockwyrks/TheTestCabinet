// floor/casing-band — the casing is an 18-unit band on all four sides, drawn
// distinctly from the floor and unbroken between the openings.
//
// THE RULE. specs/floor.md: "The floor is ringed by a solid casing band `CASING`
// (`18`) units thick on all four sides. Its outer edge is the reactor region's
// boundary and its inner edge is the floor's, so the band spans `x` in `[0, 18]`
// and `[968, 986]` and `y` in `[0, 18]` and `[702, 720]` ... It is drawn unbroken
// except at those four openings." Three claims, and the check reads all three off
// the canvas: the band is THERE, along the whole of each of the four walls; it is
// DISTINCT from the floor it rings; and it is EIGHTEEN UNITS THICK rather than a
// hairline or a quarter of the floor.
//
// WHAT IT IS COMPARED AGAINST, AND WHY IT IS NEVER A COLOUR. specs/overview.md
// fixes no palette, so what the casing looks like and what the floor looks like
// are both the build's. Every reading here is therefore a comparison between two
// things the BUILD drew: a point in the band, against the nearest patch of open
// floor on the same line. The floor reference is local — the centre of the second
// tile in from the wall, on the same row or column — because a build is free to
// shade its floor toward the edges, and a single floor colour sampled from the
// middle of the stage would read that shading as a wall.
//
// WHY THE READINGS ARE SINGLE PIXELS. The harness's `sampleColor` averages a
// cluster six units across, which would blur an eighteen-unit band's inner face
// into the floor beside it. `read.ts` says the rest.
//
// HOW THE THICKNESS IS MEASURED. Three depths on each wall bracket the inner
// face: at 9 and at 14 the pixel must still read apart from the floor, and at 21
// it must read as floor. That places the face between 14 and 21 units in, which
// is the 18 the specification fixes with about three units either side — enough
// for the rim a build may draw on the inner face and for the antialiasing of it,
// and nowhere near enough to admit a hairline outline, a band half the stated
// depth, or one that swallows the first rank of tiles.
//
// WHAT IT DOES NOT DECIDE. How far apart a PLAYER needs the wall and the floor to
// read belongs to `presentation/casing-reads-as-a-wall`, and how the openings are
// drawn to `presentation/vents-and-exhausts-read-apart`. The figure here is a low
// bar, and it is here so that "the band is present at this point" means something
// at all: the opening runs are skipped, not inspected.

import { afterEach, beforeEach, it } from "vitest";
import {
  BOTTOM_EXHAUST_COLS,
  CASING,
  COLS,
  LEFT_VENT_ROWS,
  PANEL_X,
  RIGHT_EXHAUST_ROWS,
  ROWS,
  STAGE_H,
  TOP_VENT_COLS,
  tileCX,
  tileCY,
} from "../../src/constants";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import type { Point } from "../geometry";
import {
  captureStill,
  colorDistance,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { pixelsAt, showRgb } from "./read";

/**
 * How far, out of the 441 the RGB cube spans, a point in the band must sit from
 * the floor beside it to count as wall rather than floor.
 *
 * A LOW BAR ON PURPOSE. This check is about the band's geometry, and the figure
 * exists only so that "the band is drawn here" is a reading rather than a guess:
 * `presentation/casing-reads-as-a-wall` owns what a player needs. 30 is under a
 * tenth of the scale — a shade a build could not reach by accident and could not
 * pass by drawing nothing — and it is comfortably above the 25 a point still
 * reading as floor is allowed, so no point can satisfy both.
 */
const WALL_DISTINCT_MIN = 30;

/**
 * How far a point on the floor may sit from the floor reference beside it and
 * still read as floor, out of 441.
 *
 * The two points are on the same line and 25 units apart, so this is the drift a
 * build's own floor art may carry over that distance: a plate texture, lane
 * shading, a vignette toward the wall. 25 is the same allowance `presentation`
 * grants a background sampled through whatever a build lays over it, and it is
 * below `WALL_DISTINCT_MIN`, so the bracket has no gap a reading can hide in.
 */
const FLOOR_MATCH_MAX = 25;

/** The two depths inside the band, and the one just past it, in logical units. */
const INSIDE_DEPTHS: readonly number[] = [CASING / 2, CASING - 4];
const PAST_DEPTH = CASING + 3;

/** Where along each wall the thickness is bracketed: three spread ranks. */
const THICKNESS_ROWS: readonly number[] = [4, 10, 28];
const THICKNESS_COLS: readonly number[] = [4, 12, 40];

/**
 * One of the four walls: how to address a depth into it, where the floor beside
 * it is, and which ranks along it are opening rather than wall.
 *
 * A depth is measured from the wall's OUTER face — the reactor region's boundary
 * (specs/floor.md) — inward, so the same three depths read the same way on all
 * four sides.
 */
interface Wall {
  name: string;
  /** Every rank along the wall that is wall rather than opening. */
  ranks: number[];
  /** Ranks along the wall the thickness is bracketed at. */
  brackets: readonly number[];
  /** The point `depth` units into the wall, at rank `n`. */
  at(depth: number, n: number): Point;
  /** The nearest open floor on rank `n`'s own line: the second tile in. */
  floorAt(n: number): Point;
}

/** Every rank `0..count - 1` that is not in `openings`. */
function wallRanks(count: number, openings: readonly number[]): number[] {
  const ranks: number[] = [];
  for (let n = 0; n < count; n += 1) {
    if (!openings.includes(n)) ranks.push(n);
  }
  return ranks;
}

const WALLS: readonly Wall[] = [
  {
    name: "the left wall",
    ranks: wallRanks(ROWS, LEFT_VENT_ROWS),
    brackets: THICKNESS_ROWS,
    at: (depth, row) => ({ x: depth, y: tileCY(row) }),
    floorAt: (row) => ({ x: tileCX(1), y: tileCY(row) }),
  },
  {
    name: "the right wall",
    ranks: wallRanks(ROWS, RIGHT_EXHAUST_ROWS),
    brackets: THICKNESS_ROWS,
    at: (depth, row) => ({ x: PANEL_X - depth, y: tileCY(row) }),
    floorAt: (row) => ({ x: tileCX(COLS - 2), y: tileCY(row) }),
  },
  {
    name: "the top wall",
    ranks: wallRanks(COLS, TOP_VENT_COLS),
    brackets: THICKNESS_COLS,
    at: (depth, col) => ({ x: tileCX(col), y: depth }),
    floorAt: (col) => ({ x: tileCX(col), y: tileCY(1) }),
  },
  {
    name: "the bottom wall",
    ranks: wallRanks(COLS, BOTTOM_EXHAUST_COLS),
    brackets: THICKNESS_COLS,
    at: (depth, col) => ({ x: tileCX(col), y: STAGE_H - depth }),
    floorAt: (col) => ({ x: tileCX(col), y: tileCY(ROWS - 2) }),
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("rings the floor with an unbroken band on all four sides", async () => {
  startRun(h);
  await h.advance(1);
  captureStill(h, "casing");

  for (const wall of WALLS) {
    // The band at its mid-depth, all the way along, beside the floor on each
    // rank's own line.
    const points: Point[] = [];
    for (const rank of wall.ranks) {
      points.push(wall.at(CASING / 2, rank), wall.floorAt(rank));
    }
    const read = pixelsAt(h, points);

    for (const [index, rank] of wall.ranks.entries()) {
      const band = read[index * 2];
      const floor = read[index * 2 + 1];
      assertGreaterThanOrEqual(
        colorDistance(band, floor),
        WALL_DISTINCT_MIN,
        `${wall.name} at rank ${rank}, ${CASING / 2} units in: the band ` +
          `(${showRgb(band)}) reads apart from the floor beside it ` +
          `(${showRgb(floor)}), so the wall is unbroken here (specs/floor.md)`,
      );
    }
  }
});

it("draws the band eighteen units thick on all four sides", async () => {
  startRun(h);
  await h.advance(1);

  for (const wall of WALLS) {
    const points: Point[] = [];
    for (const rank of wall.brackets) {
      for (const depth of INSIDE_DEPTHS) points.push(wall.at(depth, rank));
      points.push(wall.at(PAST_DEPTH, rank), wall.floorAt(rank));
    }
    const read = pixelsAt(h, points);
    const stride = INSIDE_DEPTHS.length + 2;

    for (const [index, rank] of wall.brackets.entries()) {
      const base = index * stride;
      const past = read[base + INSIDE_DEPTHS.length];
      const floor = read[base + INSIDE_DEPTHS.length + 1];

      for (const [depthIndex, depth] of INSIDE_DEPTHS.entries()) {
        const inside = read[base + depthIndex];
        assertGreaterThanOrEqual(
          colorDistance(inside, floor),
          WALL_DISTINCT_MIN,
          `${wall.name} at rank ${rank}, ${depth} units in: still band ` +
            `(${showRgb(inside)}) rather than floor (${showRgb(floor)}), so ` +
            `the wall is at least ${depth} units thick (specs/floor.md: ${CASING})`,
        );
      }

      assertLessThanOrEqual(
        colorDistance(past, floor),
        FLOOR_MATCH_MAX,
        `${wall.name} at rank ${rank}, ${PAST_DEPTH} units in: open floor ` +
          `(${showRgb(past)}) rather than band, beside the floor reference ` +
          `(${showRgb(floor)}), so the wall is no thicker than ${PAST_DEPTH} ` +
          `units (specs/floor.md: ${CASING})`,
      );
    }
  }
});
