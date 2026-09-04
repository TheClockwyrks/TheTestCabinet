// Shatter — saucer/enters-at-an-edge: a saucer comes in at the left edge or the
// right, never out of the middle of the field.
//
// THE RULE. `specs/saucer.md`: "A saucer enters at the left edge or the right,
// chosen at random ... heading into the field from the edge it entered at." What it
// does NOT fix is the exact column an entering craft's centre stands in — a build
// may put the circle's edge on the seam (`SAUCER_R`, `18`), or its centre on it
// (`0`, which wraps to the far side of the seam), or begin it just outside and let
// the wrap bring it in. So the item's bound is a band at each edge rather than a
// column, and forty units is the item's own figure: wide enough for every one of
// those readings, and narrow enough that the two bands together cover one
// sixteenth of the field's width — so a saucer coming in anywhere in the other
// fifteen sixteenths fails.
//
// THE COLUMN IS THE ONE READING THAT MOVES, which is why the arrival is caught the
// close-up way `cadence.ts` describes: the saucer crosses at `SAUCER_SPEED` from
// the moment it enters, so a sweep sampling every tenth of a second reports it
// fourteen units inside the edge it came in at and spends a third of the band on
// its own stride. The two-pass route reads the tick the saucer was FIRST reported
// on, whenever that tick came.
//
// EIGHT SEEDS, BECAUSE THE EDGE IS A COIN. `specs/instrumentation.md` seeds every
// draw in the game from `reset`, so eight games are eight independent draws of the
// entry edge and each has to land in a band. Which edges came up is not asserted:
// how a legal random choice distributes is not something the specification fixes,
// and `entry-row-inside-the-range` and `enters-at-a-random-row` are the items that
// decide the other half of the entry draw.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { closeUpFirstArrival, edgeDistance } from "./cadence";

/** The eight games the eight entry draws are read from. */
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/**
 * How near an edge an entering centre must stand: the item's forty units.
 *
 * See the header — a band rather than a column, because `specs/saucer.md` fixes the
 * edge a saucer enters at and not the column its centre stands in when it does.
 */
const EDGE_BAND = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("brings every arrival in within EDGE_BAND of the left or the right edge", async () => {
  for (const seed of SEEDS) {
    const arrival = await closeUpFirstArrival(h, seed);
    if (seed === SEEDS[0]) await captureStill(h, "entry");

    assertLessThanOrEqual(
      edgeDistance(arrival.saucer.x),
      EDGE_BAND,
      `seed ${seed}: how far inside the nearer edge the saucer's centre first stood (specs/saucer.md)`,
    );
  }
});
