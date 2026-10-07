// Shatter — saucer/enters-at-an-edge: a saucer comes in at the left edge or the
// right, never out of the middle of the field.
//
// THE RULE. `specs/saucer.md`: "A saucer enters at the left edge or the right, each
// with probability `1/2` ... heading into the field from the edge it entered at."
// What it does NOT fix is the exact column an entering craft's centre stands in — a
// build may put the circle's edge on the seam (`SAUCER_R`, `18`), or its centre on
// it (`0`, which wraps to the far side of the seam), or begin it just outside and
// let the wrap bring it in. So the item's bound is a band at each edge rather than
// a column, and forty units is the item's own figure: wide enough for every one of
// those readings, and narrow enough that the two bands together cover one
// sixteenth of the field's width — so a saucer coming in anywhere in the other
// fifteen sixteenths fails.
//
// THE EDGE IS POSED, NOT DRAWN. `specs/instrumentation.md` gives the surface
// `setNextSaucerEdge`, which sets the outcome the entry draw would decide, so each
// edge is asked for by name and the arrival is read against the edge it was asked
// for. Two arrivals per edge, four in all, and every one has to land in its band.
//
// THE COLUMN IS THE ONE READING THAT MOVES, which is why the arrival is caught the
// close-up way `cadence.ts` describes: the saucer crosses at `SAUCER_SPEED` from
// the moment it enters, so a sweep sampling every tenth of a second reports it
// fourteen units inside the edge it came in at and spends a third of the band on
// its own stride. The due is posed short and the arrival is read on the tick it
// is FIRST reported.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { FIELD_W } from "../constants";
import {
  captureStill,
  createHarness,
  type Harness,
  type SaucerEdge,
} from "../harness";
import { closeUpArrival, openSaucerGame } from "./cadence";

/** The four entries: each edge twice, so no edge is read on a single arrival. */
const ENTRIES: readonly SaucerEdge[] = ["left", "right", "right", "left"];

/**
 * How near the posed edge an entering centre must stand: the item's forty units.
 *
 * See the header — a band rather than a column, because `specs/saucer.md` fixes the
 * edge a saucer enters at and not the column its centre stands in when it does.
 */
const EDGE_BAND = 40;

/** How far inside `edge` a centre stands, across the seam. */
function insideEdge(x: number, edge: SaucerEdge): number {
  const fromEdge = edge === "left" ? x : FIELD_W - x;
  // A centre that began just outside the seam wraps to the far side of it.
  return Math.min(fromEdge, FIELD_W - fromEdge);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("brings every arrival in within EDGE_BAND of the edge it enters at", async () => {
  for (const [index, edge] of ENTRIES.entries()) {
    // A fresh game for each, so the cadence's first arrival is the one read.
    await openSaucerGame(h);
    await h.debug.setNextSaucerEdge(edge);
    const arrival = await closeUpArrival(h, null);
    if (index === 0) await captureStill(h, "entry");

    assertLessThanOrEqual(
      insideEdge(arrival.saucer.x, edge),
      EDGE_BAND,
      `arrival ${index + 1}, posed to enter at the ${edge}: how far inside that edge the saucer's centre first stood (specs/saucer.md)`,
    );
  }
});
