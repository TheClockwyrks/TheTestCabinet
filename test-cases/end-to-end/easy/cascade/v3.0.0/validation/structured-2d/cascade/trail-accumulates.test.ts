// cascade/trail-accumulates — the painted area grows while cards are flying.
//
// specs/victory.md: the painted layer "is never cleared while the cascade runs ...
// the painted area grows for as long as cards are flying, and the felt ends buried
// under overlapping cards". `trail-persists` decides that ONE stamp survives; this
// decides that the stamps pile up, which is what tells a persistent layer apart
// from one that holds the last few frames.
//
// HOW MUCH OF THE TABLE IS PAINTED IS READ AGAINST THE TABLE'S OWN BARE FRAME. The
// stage is sampled on a grid before anything has been painted, and again after one
// second and after four; a cell counts as painted when its colour has moved from
// what the SAME cell read bare. Nothing here knows what colour the build's felt or
// its cards are, which is the only way to read a painted fraction on a case that
// fixes no palette.
//
// The table is cleared and the launching is off, so what paints is the three cards
// this point poses and nothing else, and the three are aimed so that a layer that
// does NOT accumulate reads as a SMALLER number rather than as a coin flip. They
// start far apart and converge, so at one second they stand at three separate
// places and at four they are stacked on one; a build that keeps only the current
// frame's cards therefore paints three footprints early and barely one late, while
// a build that keeps its stamps has painted three whole swept paths by then. All
// three are still over the table at four seconds, so neither reading is short a
// card.
//
// THE FOUR SECONDS ARE STEPPED AT `RUNOUT_HZ`, AND THE DRAW LOG IS OFF. Nothing
// here is quantised to a frame: the readings are two moments of GAME time, and
// where the three cards meet is fixed by `x += vx * dt` at a `vx` the flight never
// changes (specs/victory.md), so they converge on the same point however the four
// seconds are divided. A stamp is a whole card's footprint besides, and consecutive
// stamps overlap deeply at thirty: the fastest a card moves between two frames is
// downward, where `GRAVITY` (`1800`) brings a card dropped from `TOP_ROW_Y` to about
// `vy = 1420` by `FLOOR_Y` (specs/victory.md) and so some fifty units a frame against
// `CARD_H` of a hundred and forty, while `vx` from `[180, 420]` never reaches
// fifteen. So the swept path is the same path either way — while four seconds at
// `CASCADE_HZ` is nine hundred and sixty renders of a table under a growing pile
// of stamps. And the reading is PIXELS
// from first to last, so recording every operation of those frames buys this point
// nothing. See {@link RUNOUT_HZ}, whose argument this is.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import {
  captureStill,
  card,
  colorDistance,
  KING,
  type Harness,
  type Rgb,
} from "../harness";
import {
  createRunoutHarness,
  openFlight,
  poseFlight,
  runoutFrames,
  sampleGrid,
} from "./flight";

/**
 * The three cards put in flight.
 *
 * Drifting slowly, from three heights and from three places, and aimed at one
 * point: `x` advances by `vx * t` and nothing in the five per-frame steps changes
 * `vx` (specs/victory.md), so all three left corners stand on `590` at four
 * seconds, and gravity has each of them working along the floor by then. At one
 * second they are three separate cards, four hundred units apart.
 */
const FLYERS = [
  { x: 100, y: 100, vx: 122.5, vy: -200, card: card("spades", KING) },
  { x: 900, y: 200, vx: -77.5, vy: 100, card: card("hearts", KING) },
  { x: 590, y: 50, vx: 0, vy: 0, card: card("diamonds", KING) },
];

/** The two moments the table is read at, in frames of the run-out clock. */
const EARLY_FRAMES = runoutFrames(1);
const LATE_FRAMES = runoutFrames(4);

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

/** How many cells have moved from what the same cell read on the bare table. */
function paintedCells(bare: readonly Rgb[], now: readonly Rgb[]): number {
  return now.filter((cell, at) => colorDistance(cell, bare[at]) > 0).length;
}

let harness: Harness;

beforeEach(async () => {
  harness = await createRunoutHarness({ recordDrawCalls: false });
});

afterEach(() => {
  harness?.dispose();
});

it("paints more of the table as the cards go on flying", async () => {
  openFlight(harness);
  harness.debug.setTrailPainting(true);

  await harness.advance(1);
  const bare = sampleGrid(harness, TABLE, GRID_COLS, GRID_ROWS);

  for (const flyer of FLYERS) poseFlight(harness, flyer);

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
    late,
    early,
    `cells of the ${GRID_COLS} by ${GRID_ROWS} grid painted after four seconds, ` +
      `against the ${early} painted after one`,
  );
});
