// presentation/vents-and-exhausts-read-apart — the four openings are told from
// each other and from the wall they are cut into.
//
// THE RULE. `specs/overview.md`'s legibility table: "a vent and an exhaust read
// apart from each other and from the casing". Two readings, and both matter to a
// player for the same reason: `specs/floor.md` fixes which openings the surge
// enters by and which it leaves by, and a player laying a maze has to see at a
// glance which end of a corridor is which. An opening drawn like the wall around
// it cannot be found at all; a vent drawn like an exhaust sends a maze the wrong
// way.
//
// WHERE AN OPENING IS. `specs/floor.md` puts each opening in the casing band,
// aligned to a run of tile rows or columns: the left vent on rows 16 to 19, the
// right exhaust on the same rows, the top vent on columns 22 to 29 and the bottom
// exhaust on the same columns. So an opening's pixels are the band's `CASING`
// depth crossed with that run, and that rectangle is where it is read — never the
// floor beside it, which is ordinary floor (`specs/floor.md`: "An opening's tiles
// are ordinary floor").
//
// HOW AN OPENING'S COLOUR IS TAKEN, AND WHY IT IS NOT AN AVERAGE. Nothing fixes
// what an opening looks like: a slot, a grille, a lit mouth, a hazard chevron are
// all "an opening cut into the casing". So the reading is the pixel in the
// opening's rectangle FURTHEST from the wall around it — what is drawn there at
// all — rather than a mean, which a build that draws a dark mouth with a bright
// lip would fail on the mouth while a player reads the lip. `read.ts` says the
// rest.
//
// WHY THE WALL REFERENCE IS PER-WALL AND LOCAL. A build is free to shade its
// casing, so each opening is held against the band on its OWN wall, read three
// tiles clear of the opening run at either end of it, and reduced by `medoid` so
// a rivet or a seam cannot move it.
//
// WHY EVERY VENT IS HELD AGAINST EVERY EXHAUST. Four pairs, each named, so a
// failure says which vent read as which exhaust. Vents are not held against vents
// and exhausts not against exhausts: they carry the same meaning, and a build that
// draws both vents alike has drawn them correctly.
//
// WHAT IT DOES NOT DECIDE. Where an opening is, which `floor/left-vent-rows` and
// its three siblings own; that the band is unbroken between them, which
// `floor/casing-band` owns; and that an exhaust reads DANGEROUS, which no check
// can decide without fixing a palette and which no item claims.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import {
  BOTTOM_EXHAUST_COLS,
  CASING,
  LEFT_VENT_ROWS,
  PANEL_X,
  RIGHT_EXHAUST_ROWS,
  STAGE_H,
  TOP_VENT_COLS,
  TILE,
  tileLeft,
  tileTop,
} from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  startRun,
  type Harness,
  type Rgb,
} from "../harness";
import { farthest, medoid, readPixels, showRgb, type Point } from "./read";

/**
 * How far two of the three things must sit apart, out of the 441 the RGB cube
 * spans.
 *
 * This group's figure for "plainly apart" (`specs/overview.md`), the same 50 every
 * other point in this group draws its line at, under this engine and under the
 * other two.
 */
const APART_MIN = 50;

/** The depths into the band an opening and the wall are read at, in units. */
const DEPTHS: readonly number[] = [4, CASING / 2, CASING - 4];

/** Where across a rank, as a fraction of the tile, a point is taken. */
const ACROSS: readonly number[] = [0.3, 0.5, 0.7];

/** How many tiles clear of the opening run the wall reference is taken. */
const WALL_GAP = 3;

/** One opening, and the wall it is cut into. */
interface Opening {
  name: string;
  kind: "vent" | "exhaust";
  /** The tile ranks it spans, from `specs/floor.md`. */
  ranks: readonly number[];
  /** The point `depth` into the wall, `along` of the way across rank `n`. */
  at(depth: number, n: number, along: number): Point;
}

const OPENINGS: readonly Opening[] = [
  {
    name: "the left vent",
    kind: "vent",
    ranks: LEFT_VENT_ROWS,
    at: (depth, row, along) => ({
      x: depth,
      y: tileTop(row) + along * TILE,
    }),
  },
  {
    name: "the right exhaust",
    kind: "exhaust",
    ranks: RIGHT_EXHAUST_ROWS,
    at: (depth, row, along) => ({
      x: PANEL_X - depth,
      y: tileTop(row) + along * TILE,
    }),
  },
  {
    name: "the top vent",
    kind: "vent",
    ranks: TOP_VENT_COLS,
    at: (depth, col, along) => ({
      x: tileLeft(col) + along * TILE,
      y: depth,
    }),
  },
  {
    name: "the bottom exhaust",
    kind: "exhaust",
    ranks: BOTTOM_EXHAUST_COLS,
    at: (depth, col, along) => ({
      x: tileLeft(col) + along * TILE,
      y: STAGE_H - depth,
    }),
  },
];

/** Every point inside an opening's rectangle this check reads. */
function openingPoints(opening: Opening): Point[] {
  const points: Point[] = [];
  for (const rank of opening.ranks) {
    for (const depth of DEPTHS) {
      for (const along of ACROSS) points.push(opening.at(depth, rank, along));
    }
  }
  return points;
}

/** The band on the opening's own wall, `WALL_GAP` tiles clear at either end. */
function wallPoints(opening: Opening): Point[] {
  const before = opening.ranks[0] - WALL_GAP;
  const after = opening.ranks[opening.ranks.length - 1] + WALL_GAP;
  const points: Point[] = [];
  for (const rank of [before, after]) {
    for (const depth of DEPTHS) points.push(opening.at(depth, rank, 0.5));
  }
  return points;
}

/** What one opening reads as, and what the wall around it reads as. */
interface Reading {
  opening: Opening;
  colour: Rgb;
  wall: Rgb;
}

/** Read all four openings and the band around each, on the frame as it stands. */
async function readOpenings(h: Harness): Promise<Reading[]> {
  const readings: Reading[] = [];
  for (const opening of OPENINGS) {
    const inside = openingPoints(opening);
    const around = wallPoints(opening);
    const read = await readPixels(h, [...inside, ...around]);
    const wall = medoid(read.slice(inside.length));
    readings.push({
      opening,
      wall,
      colour: farthest(wall, read.slice(0, inside.length)),
    });
  }
  return readings;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws every opening apart from the casing it is cut into", async () => {
  await startRun(h);
  await h.advance(1);
  await captureStill(h, "openings");

  for (const { opening, colour, wall } of await readOpenings(h)) {
    assertGreaterThanOrEqual(
      colorDistance(colour, wall),
      APART_MIN,
      `${opening.name} (${showRgb(colour)}) against the casing on its own ` +
        `wall, ${WALL_GAP} tiles clear of it either end (${showRgb(wall)}) ` +
        `(specs/overview.md: a vent and an exhaust read apart from the casing)`,
    );
  }
});

it("draws a vent apart from an exhaust", async () => {
  await startRun(h);
  await h.advance(1);

  const readings = await readOpenings(h);
  const vents = readings.filter((r) => r.opening.kind === "vent");
  const exhausts = readings.filter((r) => r.opening.kind === "exhaust");

  for (const vent of vents) {
    for (const exhaust of exhausts) {
      assertGreaterThanOrEqual(
        colorDistance(vent.colour, exhaust.colour),
        APART_MIN,
        `${vent.opening.name} (${showRgb(vent.colour)}) against ` +
          `${exhaust.opening.name} (${showRgb(exhaust.colour)}) ` +
          `(specs/overview.md: a vent and an exhaust read apart from each ` +
          `other; specs/floor.md fixes which is which)`,
      );
    }
  }
});
