// cascade/trail-survives-completion — the painted table stays after the cascade.
//
// specs/victory.md: the painted layer "is cleared by a new deal ... and by nothing
// else", and at the end of the cascade "the painted table stays behind that
// message". So the buried table is what a player is left looking at, and a build that
// wipes the layer when the last card retires has thrown away the whole point of the
// ending.
//
// IT IS READ AFTER `cascadeDone`, ON A TABLE THAT HOLDS NOTHING ELSE. Once the
// cascade is done every foundation is empty and no card is in flight, so the only
// thing between the felt and the win message is the paint. The stage is sampled on a
// grid and compared against the same grid read at the start of the cascade, before
// anything had been painted; the cells that have moved are the painted ones.
//
// THE FRACTION ASKED FOR IS A CONSERVATIVE FLOOR, not a measurement of the reference.
// specs/victory.md says the felt "ends buried under overlapping cards" after fifty-two
// cards have each crossed the table, and a single card's swath alone covers several
// percent of the stage. A quarter of the table is far below what any build that keeps
// its stamps can produce, and comfortably above everything the comparison itself can
// account for: the four foundation piles and the one card in flight are on the
// baseline frame and gone by the end, five card footprints in all, and the won
// screen's message is on the end frame and not the baseline. Together those are an
// eighth of the stage, which is why the floor is set at twice that.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  framesFor,
  sampleGrid,
  startCascade,
  type Harness,
} from "../harness";

/** How long the cascade is given to run out, in frames. */
const MAX_FRAMES = framesFor(20);

/** The grid the stage is sampled on: 960 cells, evenly spread. */
const GRID_COLS = 40;
const GRID_ROWS = 24;

/** The whole stage, which is the table the fraction is measured over. */
const TABLE = { x: 0, y: 0, w: STAGE_W, h: STAGE_H };

/**
 * How far a cell's color must move from its bare reading to count as painted, out of
 * the `441` an RGB distance runs to.
 *
 * The figure `trail-persists` and `trail-accumulates` both read at, chosen the same
 * way: a third of the `90` the `presentation` group holds a card face against its
 * table to, so a faint palette is docked there rather than again here.
 */
const PAINTED_DISTANCE = 30;

/** The share of the table that must still be painted once the cascade is done. */
const PAINTED_FRACTION = 0.25;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("leaves the table painted once the cascade is done", async () => {
  startCascade(harness);

  // One frame with the painting gated off, so the baseline is the table as the
  // cascade found it: the felt, the foundations, and the first card away. The gate
  // goes straight back on, and every stamp from the second frame onward is the
  // build's own.
  harness.debug.setTrailPainting(false);
  await harness.advance(1);
  const bare = sampleGrid(harness, TABLE, GRID_COLS, GRID_ROWS);
  harness.debug.setTrailPainting(true);

  await harness.until((seen) => seen.cascadeDone, { maxFrames: MAX_FRAMES });
  const done = sampleGrid(harness, TABLE, GRID_COLS, GRID_ROWS);
  captureStill(harness, "painted");

  const painted = done.filter(
    (cell, at) => colorDistance(cell, bare[at]) >= PAINTED_DISTANCE,
  ).length;

  assertGreaterThanOrEqual(
    painted / done.length,
    PAINTED_FRACTION,
    "the share of the table still painted once the cascade was done",
  );
});
