// presentation/vents-and-exhausts-read-apart — the four openings are drawn on the
// wall they are cut into.
//
// THE RULE. `specs/overview.md`'s legibility table: "a vent and an exhaust read
// apart from each other and from the casing". What a check can decide of that is
// the second clause, and only as presence: the build drew SOMETHING in each
// opening's rectangle that it did not draw on the plain casing beside it. How far
// a vent reads from an exhaust, and whether an exhaust reads as dangerous, are
// appearance — `specs/overview.md` hands the palette, the type and the glow to
// the build — and the reviewer's presentation rating is what judges them.
//
// WHERE AN OPENING IS. `specs/floor.md` puts each opening in the casing band,
// aligned to a run of tile rows or columns: the left vent on rows 16 to 19, the
// right exhaust on the same rows, the top vent on columns 22 to 29 and the bottom
// exhaust on the same columns. So an opening's pixels are the band's `CASING`
// depth crossed with that run, and that rectangle is where it is read — never the
// floor beside it, which is ordinary floor (`specs/floor.md`: "An opening's tiles
// are ordinary floor").
//
// WHAT THE READING IS HELD AGAINST, AND WHERE THE BAR COMES FROM. Each opening is
// held against the band on its OWN wall, read three tiles clear of the opening run
// at either end of it — a build is free to shade its casing, so a reference taken
// from another wall would be reading that shading. The bar is that wall's own
// variation, measured rather than stated: how far the plain casing points sit from
// what the plain casing mostly reads as is how much the build's art moves the band
// on its own, and what is drawn in the opening has to beat that by `NOISE_MARGIN`.
// A build that lays a flat casing has almost nothing to beat; a build that shades
// its casing heavily has to draw its openings past its own shading, which is the
// same requirement seen from the other side.
//
// HOW AN OPENING'S RECTANGLE IS REDUCED, AND WHY IT IS NOT AN AVERAGE. Nothing
// fixes what an opening looks like: a slot, a grille, a lit mouth, a hazard
// chevron are all "an opening cut into the casing". So the reading is the pixel in
// the rectangle FURTHEST from what the wall reads as — what is drawn there at all
// — rather than a mean, which a build that draws a dark mouth with a bright lip
// would fail on the mouth while a player reads the lip.
//
// WHAT IT DOES NOT DECIDE. Where an opening is, which `floor/left-vent-rows` and
// its three siblings own; and that the band is unbroken between them, which
// `floor/casing-band` owns.

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
} from "../harness";
import { NOISE_MARGIN, medoid, readPixels, showRgb, type Point } from "./read";

/** The depths into the band an opening and the wall are read at, in units. */
const DEPTHS: readonly number[] = [4, CASING / 2, CASING - 4];

/** Where across a rank, as a fraction of the tile, a point is taken. */
const ACROSS: readonly number[] = [0.3, 0.5, 0.7];

/** How many tiles clear of the opening run the wall reference is taken. */
const WALL_GAP = 3;

/** One opening, and the wall it is cut into. */
interface Opening {
  name: string;
  /** The tile ranks it spans, from `specs/floor.md`. */
  ranks: readonly number[];
  /** The point `depth` into the wall, `along` of the way across rank `n`. */
  at(depth: number, n: number, along: number): Point;
}

const OPENINGS: readonly Opening[] = [
  {
    name: "the left vent",
    ranks: LEFT_VENT_ROWS,
    at: (depth, row, along) => ({
      x: depth,
      y: tileTop(row) + along * TILE,
    }),
  },
  {
    name: "the right exhaust",
    ranks: RIGHT_EXHAUST_ROWS,
    at: (depth, row, along) => ({
      x: PANEL_X - depth,
      y: tileTop(row) + along * TILE,
    }),
  },
  {
    name: "the top vent",
    ranks: TOP_VENT_COLS,
    at: (depth, col, along) => ({
      x: tileLeft(col) + along * TILE,
      y: depth,
    }),
  },
  {
    name: "the bottom exhaust",
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
    for (const depth of DEPTHS) {
      for (const along of ACROSS) points.push(opening.at(depth, rank, along));
    }
  }
  return points;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws every opening on the casing it is cut into", async () => {
  await startRun(h);
  await h.advance(1);
  await captureStill(h, "openings");

  for (const opening of OPENINGS) {
    const inside = openingPoints(opening);
    const around = wallPoints(opening);
    const read = await readPixels(h, [...inside, ...around]);
    const casing = read.slice(inside.length);
    const wall = medoid(casing);
    const spread = Math.max(
      ...casing.map((sample) => colorDistance(sample, wall)),
    );
    const drawn = Math.max(
      ...read.slice(0, inside.length).map((s) => colorDistance(s, wall)),
    );

    assertGreaterThanOrEqual(
      drawn,
      spread + NOISE_MARGIN,
      `${opening.name}: something is drawn in its rectangle in the casing ` +
        `band that the plain casing on the same wall (${showRgb(wall)}), ` +
        `${WALL_GAP} tiles clear of it either end, does not carry — further ` +
        `from it than the ${spread} that plain casing varies by on its own ` +
        `(specs/overview.md: a vent and an exhaust read apart from the ` +
        `casing; specs/floor.md puts the opening on those ranks)`,
    );
  }
});
