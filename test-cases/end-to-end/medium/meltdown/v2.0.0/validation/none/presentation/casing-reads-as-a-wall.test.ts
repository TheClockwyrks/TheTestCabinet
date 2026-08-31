// presentation/casing-reads-as-a-wall — the casing reads as the wall that
// encloses the reactor, told from what lies on either side of it.
//
// THE RULE. `specs/overview.md`'s legibility table: "The casing and its openings —
// The casing reads as a solid wall enclosing the floor". A wall that ENCLOSES is
// read by its two edges, so the item is two readings: the band against the floor
// it rings, and the band against the space beyond the stage. A casing drawn in the
// floor's own colour encloses nothing a player can see, and one drawn in the
// colour of the void outside leaves the reactor with no outer edge at all.
//
// WHERE THE SPACE OUTSIDE THE STAGE IS. `specs/floor.md` puts the casing's outer
// edge on the reactor region's boundary, which on the left and the top is the edge
// of the `1280 x 720` stage itself, so at the stage's own size there is nothing
// outside it to read. `specs/overview.md` says where that space appears: "Fitting
// it to the browser window is the runtime's work: the uniform scale ... the
// letterboxed centering", and "The letterbox bars around the stage carry the
// stage's background color." So the second reading is taken in a window WIDER than
// the stage, where the fit leaves a bar either side, and it is those bars that are
// read — the space outside the stage, in the colour the specification puts there.
//
// WHY BOTH READINGS ARE COMPARISONS AND NEITHER IS A COLOUR. `specs/overview.md`
// fixes no palette: the casing, the floor and the background are all the build's.
// Every figure below is therefore a DISTANCE between two things the same build
// drew, out of the 441 the RGB cube spans.
//
// WHY THE FLOOR REFERENCE IS LOCAL. A build is free to shade its floor toward the
// walls, so the floor a band point is held against is the nearest open tile CENTRE
// on that point's own line — two tiles in, clear of the reference's own edge
// treatment and off the grid line `specs/floor.md` puts on every tile boundary.
//
// WHY THE OPENING RANKS ARE SKIPPED. `specs/floor.md`: the band is "drawn unbroken
// except at those four openings", and what an opening looks like is
// `presentation/vents-and-exhausts-read-apart`'s item. A rank that is an opening
// is not wall, so it is not read here.
//
// WHAT IT DOES NOT DECIDE. That the band is 18 units thick, present along every
// rank, and inside the reactor region is `floor/casing-band`, which reads the same
// geometry to a deliberately low bar. This item owns the STRENGTH of the read and
// nothing else.

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
  STAGE_W,
  TOP_VENT_COLS,
  tileCX,
  tileCY,
} from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  startRun,
  type Harness,
  type Rgb,
} from "../harness";
import { medoid, readPixels, showRgb, type Point } from "./read";

/**
 * How far the band must sit from what lies beside it, out of the 441 the RGB cube
 * spans.
 *
 * This group's figure for "plainly apart" (`specs/overview.md`), the same one it
 * holds a tower against the floor and a flyer against a walker to. 60 is about a
 * seventh of the scale — a different shade at a glance under any palette — and it
 * is well above the 25 a build's own floor art moves a patch by, so a plate
 * texture or a vignette toward the wall cannot pass as an enclosure and cannot
 * fail one.
 */
const APART_MIN = 60;

/** How deep into the band a point is read, from its outer face inward. */
const BAND_DEPTH = CASING / 2;

/** How far in from the wall the floor reference is taken, in tiles. */
const FLOOR_TILES_IN = 2;

/** The window the second reading runs in: wider than the stage, so it letterboxes. */
const WIDE_CSS_WIDTH = 1600;
const WIDE_CSS_HEIGHT = STAGE_H;
const WIDE_DPR = 1;

/**
 * How far into a letterbox bar, as a fraction of its width, the space outside the
 * stage is read.
 *
 * A third and two thirds of the way across, never at the bar's own edges: the
 * outer edge is the canvas boundary and the inner one abuts the stage, and a
 * point on either could be caught by the rounding of a scaled edge rather than
 * reading the bar.
 */
const BAR_FRACTIONS: readonly number[] = [1 / 3, 2 / 3];

/** Where down the bars they are read: three ranks spread over the height. */
const BAR_HEIGHT_FRACTIONS: readonly number[] = [0.25, 0.5, 0.75];

/** One of the four walls, and how to read it. */
interface Wall {
  name: string;
  /** The ranks along it that are wall rather than opening, spread out. */
  ranks: number[];
  /** The point `BAND_DEPTH` units into the wall at rank `n`. */
  at(n: number): Point;
  /** The nearest open floor on rank `n`'s own line. */
  floorAt(n: number): Point;
}

/** Six ranks spread over `count`, skipping every rank in `openings`. */
function spreadRanks(count: number, openings: readonly number[]): number[] {
  const ranks: number[] = [];
  for (let n = 0; n < 6; n += 1) {
    let rank = Math.round(((n + 0.5) * count) / 6);
    while (openings.includes(rank)) rank += 1;
    if (rank < count && !ranks.includes(rank)) ranks.push(rank);
  }
  return ranks;
}

const WALLS: readonly Wall[] = [
  {
    name: "the left wall",
    ranks: spreadRanks(ROWS, LEFT_VENT_ROWS),
    at: (row) => ({ x: BAND_DEPTH, y: tileCY(row) }),
    floorAt: (row) => ({ x: tileCX(FLOOR_TILES_IN), y: tileCY(row) }),
  },
  {
    name: "the right wall",
    ranks: spreadRanks(ROWS, RIGHT_EXHAUST_ROWS),
    at: (row) => ({ x: PANEL_X - BAND_DEPTH, y: tileCY(row) }),
    floorAt: (row) => ({
      x: tileCX(COLS - 1 - FLOOR_TILES_IN),
      y: tileCY(row),
    }),
  },
  {
    name: "the top wall",
    ranks: spreadRanks(COLS, TOP_VENT_COLS),
    at: (col) => ({ x: tileCX(col), y: BAND_DEPTH }),
    floorAt: (col) => ({ x: tileCX(col), y: tileCY(FLOOR_TILES_IN) }),
  },
  {
    name: "the bottom wall",
    ranks: spreadRanks(COLS, BOTTOM_EXHAUST_COLS),
    at: (col) => ({ x: tileCX(col), y: STAGE_H - BAND_DEPTH }),
    floorAt: (col) => ({
      x: tileCX(col),
      y: tileCY(ROWS - 1 - FLOOR_TILES_IN),
    }),
  },
];

let harnesses: Harness[] = [];

async function open(options?: {
  cssWidth: number;
  cssHeight: number;
  dpr: number;
}): Promise<Harness> {
  const h = await createHarness(options);
  harnesses.push(h);
  return h;
}

beforeEach(() => {
  harnesses = [];
});

afterEach(async () => {
  for (const h of harnesses) await h.dispose();
  harnesses = [];
});

it("draws the casing apart from the floor it rings", async () => {
  const h = await open();
  await startRun(h);
  await h.advance(1);
  await captureStill(h, "casing");

  for (const wall of WALLS) {
    const points: Point[] = [];
    for (const rank of wall.ranks)
      points.push(wall.at(rank), wall.floorAt(rank));
    const read = await readPixels(h, points);

    for (const [index, rank] of wall.ranks.entries()) {
      const band = read[index * 2];
      const floor = read[index * 2 + 1];
      assertGreaterThanOrEqual(
        colorDistance(band, floor),
        APART_MIN,
        `${wall.name} at rank ${rank}: the band (${showRgb(band)}) against ` +
          `the floor ${FLOOR_TILES_IN} tiles inside it (${showRgb(floor)}) ` +
          `(specs/overview.md: the casing reads as a solid wall enclosing ` +
          `the floor)`,
      );
    }
  }
});

it("draws the casing apart from the space outside the stage", async () => {
  const h = await open({
    cssWidth: WIDE_CSS_WIDTH,
    cssHeight: WIDE_CSS_HEIGHT,
    dpr: WIDE_DPR,
  });
  await startRun(h);
  await h.advance(1);

  // The band itself, read through the fit the specification requires, on every
  // wall at once: the colour most of the casing shows.
  const bandPoints: Point[] = [];
  for (const wall of WALLS) {
    for (const rank of wall.ranks) bandPoints.push(wall.at(rank));
  }
  const band = medoid(await readPixels(h, bandPoints));

  // And the two bars, addressed in the canvas's own backing store, since they
  // are outside the stage and so have no logical coordinate at all.
  const view = h.viewport();
  const store = await h.surface();
  const bars: { name: string; colour: Rgb }[] = [];
  for (const [name, base] of [
    ["the bar to the left of the stage", 0],
    ["the bar to the right of the stage", view.offsetX + STAGE_W * view.scale],
  ] as const) {
    const samples: Rgb[] = [];
    for (const across of BAR_FRACTIONS) {
      for (const down of BAR_HEIGHT_FRACTIONS) {
        const [r, g, b] = await h.devicePixel(
          Math.round(base + view.offsetX * across),
          Math.round(store.height * down),
        );
        samples.push({ r, g, b });
      }
    }
    bars.push({ name, colour: medoid(samples) });
  }

  for (const bar of bars) {
    assertGreaterThanOrEqual(
      colorDistance(band, bar.colour),
      APART_MIN,
      `the casing (${showRgb(band)}) against ${bar.name} ` +
        `(${showRgb(bar.colour)}), in a ${WIDE_CSS_WIDTH}x${WIDE_CSS_HEIGHT} ` +
        `window where the fit leaves ${Math.round(view.offsetX)} units of ` +
        `letterbox either side (specs/overview.md: the casing reads as a wall ` +
        `enclosing the floor, and the bars carry the stage's background)`,
    );
  }
});
