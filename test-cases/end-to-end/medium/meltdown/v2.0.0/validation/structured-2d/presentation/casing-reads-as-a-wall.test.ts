// presentation/casing-reads-as-a-wall — the casing reads as a solid wall.
//
// THE RULE. specs/overview.md's legibility table: "The casing reads as a solid
// wall enclosing the floor." specs/floor.md is what makes it a wall — it is
// impassable, no surge unit crosses it, and no tower footprint covers any part of
// it — so what a player has to read at a glance is where the floor they build and
// fight on ends. That is two edges, not one: the casing has floor on its inside
// and, at any window the stage does not exactly fit, the space outside the stage
// on its outside.
//
// THE SPACE OUTSIDE THE STAGE. Under this engine that space is whatever the
// runtime paints where the stage is not, which is the build's own exported
// `BACKGROUND` (specs/overview.md), and the harness's `clearColor()` is that
// colour rasterized through the same canvas the pixels are sampled from. So the
// outer comparison is exact and needs no resized window: a build whose casing is
// its background has drawn a wall a player cannot see the outer edge of, whatever
// size the window is.
//
// WHAT IS COMPARED, AND WHY IT IS NEVER A COLOUR. specs/overview.md fixes no
// palette. Both readings are comparisons between two things the BUILD drew (or,
// outside, chose): a point in the band against the floor on that point's own line
// and against the colour the stage sits on. The floor reference is LOCAL — the
// centre of the second tile in on the same row or column — because a build is
// free to shade its floor toward the edges, and a floor colour taken from the
// middle of the stage would read that shading as a wall.
//
// WHERE THE READINGS ARE TAKEN. At the band's mid-depth, nine units in, on ranks
// spread along each of the four walls, and never on an opening: specs/floor.md
// says the band is drawn unbroken EXCEPT at the four openings, and what an
// opening looks like is `vents-and-exhausts-read-apart`'s requirement, not this
// one. Each reading is a small cluster rather than one pixel, so a rivet, a bolt
// or a seam a build drew on its wall cannot decide it.
//
// WHAT IT DOES NOT DECIDE. That the band is eighteen units thick, present along
// every rank and unbroken between the openings is `floor.casing-band`, which
// reads the same geometry at a much lower bar and says so. This point owns only
// how far apart a PLAYER needs the wall and the floor to read.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
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
} from "../constants";
import {
  captureStill,
  clearColor,
  colorDistance,
  createHarness,
  startRun,
  type Harness,
  type Point,
  type Rgb,
} from "../harness";
import { pixelAt, showRgb, spotColor } from "./read";

/**
 * How far, out of the 441 the RGB cube spans, the casing must sit from what is on
 * either side of it.
 *
 * The group's figure for two things a player tells apart at a glance, and the
 * same 50 every other point in this group draws its line at. `floor.casing-band`
 * reads the same band against the floor at a deliberately low bar, because what
 * it is deciding is where the band IS; the figure a player needs is this one.
 */
const APART_MIN = 50;

/** Where in the band a reading is taken, in units from the wall's outer face. */
const BAND_DEPTH = CASING / 2;

/** How far in from the wall the floor reference sits, in tiles. */
const FLOOR_REFERENCE_TILE = 1;

/** How many ranks along each wall are read. */
const RANKS = 6;

/** One of the four walls: where to read it, and where the floor beside it is. */
interface Wall {
  name: string;
  /** Ranks along the wall that are wall rather than opening. */
  ranks: number[];
  /** The point `BAND_DEPTH` units into the wall, at rank `n`. */
  at(n: number): Point;
  /** The nearest open floor on rank `n`'s own line. */
  floorAt(n: number): Point;
}

/** Ranks spread along a wall of `count`, skipping its opening. */
function spreadRanks(count: number, openings: readonly number[]): number[] {
  const ranks: number[] = [];
  for (let i = 0; i < RANKS; i += 1) {
    const rank = Math.round(((i + 0.5) / RANKS) * (count - 1));
    if (!openings.includes(rank) && !ranks.includes(rank)) ranks.push(rank);
  }
  return ranks;
}

const WALLS: readonly Wall[] = [
  {
    name: "the left wall",
    ranks: spreadRanks(ROWS, LEFT_VENT_ROWS),
    at: (row) => ({ x: BAND_DEPTH, y: tileCY(row) }),
    floorAt: (row) => ({ x: tileCX(FLOOR_REFERENCE_TILE), y: tileCY(row) }),
  },
  {
    name: "the right wall",
    ranks: spreadRanks(ROWS, RIGHT_EXHAUST_ROWS),
    at: (row) => ({ x: PANEL_X - BAND_DEPTH, y: tileCY(row) }),
    floorAt: (row) => ({
      x: tileCX(COLS - 1 - FLOOR_REFERENCE_TILE),
      y: tileCY(row),
    }),
  },
  {
    name: "the top wall",
    ranks: spreadRanks(COLS, TOP_VENT_COLS),
    at: (col) => ({ x: tileCX(col), y: BAND_DEPTH }),
    floorAt: (col) => ({ x: tileCX(col), y: tileCY(FLOOR_REFERENCE_TILE) }),
  },
  {
    name: "the bottom wall",
    ranks: spreadRanks(COLS, BOTTOM_EXHAUST_COLS),
    at: (col) => ({ x: tileCX(col), y: STAGE_H - BAND_DEPTH }),
    floorAt: (col) => ({
      x: tileCX(col),
      y: tileCY(ROWS - 1 - FLOOR_REFERENCE_TILE),
    }),
  },
];

/** Every reading of the band, with the floor on that reading's own line. */
function readWalls(h: Harness): {
  wall: string;
  rank: number;
  band: Rgb;
  floor: Rgb;
}[] {
  return WALLS.flatMap((wall) =>
    wall.ranks.map((rank) => {
      const at = wall.at(rank);
      const beside = wall.floorAt(rank);
      return {
        wall: wall.name,
        rank,
        band: spotColor(h, at.x, at.y),
        floor: pixelAt(h, beside.x, beside.y),
      };
    }),
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the casing plainly apart from the floor it rings", async () => {
  startRun(h);
  await h.advance(1);
  captureStill(h, "casing");

  for (const { wall, rank, band, floor } of readWalls(h)) {
    assertGreaterThanOrEqual(
      colorDistance(band, floor),
      APART_MIN,
      `${wall} at rank ${rank}, ${BAND_DEPTH} units in (${showRgb(band)}), ` +
        `against the floor beside it (${showRgb(floor)}), out of 441 ` +
        `(specs/overview.md: the casing reads as a solid wall enclosing the ` +
        `floor)`,
    );
  }
});

it("draws the casing plainly apart from the space outside the stage", async () => {
  startRun(h);
  await h.advance(1);
  const outside = clearColor();

  for (const { wall, rank, band } of readWalls(h)) {
    assertGreaterThanOrEqual(
      colorDistance(band, outside),
      APART_MIN,
      `${wall} at rank ${rank}, ${BAND_DEPTH} units in (${showRgb(band)}), ` +
        `against the space outside the stage (${showRgb(outside)}, the ` +
        `build's own BACKGROUND), out of 441 (specs/overview.md: the casing ` +
        `reads as a solid wall enclosing the floor)`,
    );
  }
});
