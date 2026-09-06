// cascade/trail-accumulates — the painted area grows while cards are flying.
//
// specs/victory.md: the painted layer "is never cleared while the cascade runs ... the
// painted area grows for as long as cards are flying, and the felt ends buried under
// overlapping cards". `trail-persists` decides that ONE stamp survives; this decides
// that the stamps pile up, which is what tells a persistent layer apart from one that
// holds the last few frames.
//
// HOW MUCH OF THE TABLE IS PAINTED IS READ AGAINST THE TABLE'S OWN BARE FRAME. The
// stage is sampled on a grid before anything has been painted, and again after one
// second and after four; a cell counts as painted when its color has moved from what
// the SAME cell read bare. Nothing here knows what color the build's felt or its
// cards are, which is the only way to read a painted fraction on a case that fixes no
// palette.
//
// THE GROWTH ASKED FOR IS MORE THAN THE CARDS THEMSELVES CAN ACCOUNT FOR. Both
// readings are taken from a frame that also has three cards drawn in it, and a card
// in flight is not paint; three card footprints cover a known share of the grid, so
// a later reading that beats the earlier one by less than that has shown nothing but
// three cards in different places. Asking for more than that share is what makes this
// a reading of the LAYER: a build that holds only the newest frame's stamps reads the
// same handful of cells at both moments and cannot clear it.
//
// The table is cleared and the launching is off, so what paints is the three cards
// this point poses and nothing else. Their speeds are inside the range a launch draws
// from and are chosen so all three are still over the table at four seconds, which is
// what makes the later reading the larger one: a card that had drifted off would stop
// adding to the paint.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { CARD_H, CARD_W, STAGE_H, STAGE_W } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  framesFor,
  sampleGrid,
  type Harness,
  type Rgb,
} from "../harness";
import { openFlight, poseFlyer } from "./flight";

/**
 * The three cards put in flight.
 *
 * Drifting slowly, in both directions, from three heights, so each works its way
 * along the floor rather than off a side edge: after four seconds their left corners
 * stand at about 580, 240 and 1180, all of them still on the table.
 */
const FLYERS = [
  { x: 100, y: 100, vx: 120, vy: -200, card: "KS" },
  { x: 600, y: 200, vx: -90, vy: 100, card: "KH" },
  { x: 900, y: 50, vx: 70, vy: 0, card: "KD" },
];

/** The two moments the table is read at, in frames. */
const EARLY_FRAMES = framesFor(1);
const LATE_FRAMES = framesFor(4);

/** The grid the stage is sampled on: 960 cells, evenly spread. */
const GRID_COLS = 40;
const GRID_ROWS = 24;

/** The whole stage, which is the table the fraction is measured over. */
const TABLE = { x: 0, y: 0, w: STAGE_W, h: STAGE_H };

/*
 * A cell counts as painted when it reads DIFFERENTLY from its own bare reading,
 * and nothing more is measured. The case fixes no palette, so how far a stamp
 * reads from the felt is the reviewer's; each cell
 * is compared against itself, so any difference at all is paint.
 */

/**
 * The cells three cards in flight can cover, which is what the growth must beat.
 *
 * Both readings carry the same three cards, drawn wherever the flight has taken them,
 * and those cards are not paint. Their footprints are `CARD_W` by `CARD_H` out of the
 * stage (specs/table.md), so this is the largest number of grid cells they can move
 * between one reading and the other.
 */
const FLYER_CELLS = Math.ceil(
  ((FLYERS.length * CARD_W * CARD_H) / (STAGE_W * STAGE_H)) *
    GRID_COLS *
    GRID_ROWS,
);

/** How many cells have moved from what the same cell read on the bare table. */
function paintedCells(bare: readonly Rgb[], now: readonly Rgb[]): number {
  return now.filter((cell, at) => colorDistance(cell, bare[at]) > 0).length;
}

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("paints more of the table as the cards go on flying", async () => {
  openFlight(harness);
  harness.debug.setTrailPainting(true);

  await harness.advance(1);
  const bare = sampleGrid(harness, TABLE, GRID_COLS, GRID_ROWS);

  for (const flyer of FLYERS) poseFlyer(harness, flyer);

  await harness.advance(EARLY_FRAMES);
  const early = paintedCells(
    bare,
    sampleGrid(harness, TABLE, GRID_COLS, GRID_ROWS),
  );
  captureStill(harness, "one-second");

  await harness.advance(LATE_FRAMES - EARLY_FRAMES);
  const late = paintedCells(
    bare,
    sampleGrid(harness, TABLE, GRID_COLS, GRID_ROWS),
  );
  captureStill(harness, "four-seconds");

  assertGreaterThan(
    late - early,
    FLYER_CELLS,
    `the cells of the ${GRID_COLS} by ${GRID_ROWS} grid that four seconds of ` +
      `painting added to the ${early} standing after one`,
  );
});
