// instrumentation/next-saucer-edge — `setNextSaucerEdge` decides the edge the
// next arrival enters at, and the arrival consumes the pose.
//
// THE RULE. `specs/instrumentation.md`, "Posed draws": `setNextSaucerEdge(edge)`
// "poses the edge, `left` or `right`, the next saucer the game's own cadence
// brings in enters at", reported as `nextSaucerEdge`; "a pose stands until the
// draw it names is made, which consumes it and returns its field to `null`".
//
// BOTH EDGES, because a build that ignores the pose and draws lands on the posed
// edge half the time: asked for each edge in turn, it has to be right twice. The
// arrival is caught on the tick it is first reported, the close-up way
// `../saucer/cadence.ts` describes, and read for three things: the pose read
// back before the arrival, the column the craft came in on, and the field empty
// after.
//
// THE COLUMN'S BAND is `saucer/enters-at-an-edge`'s forty units, for the reason
// that item gives: `specs/saucer.md` fixes the edge and not the column the centre
// stands in when it enters.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { FIELD_W } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { closeUpArrival, openSaucerGame } from "../saucer/cadence";
import type { SaucerEdge } from "../surface";

/** The two edges, each posed on a fresh game. */
const EDGES: readonly SaucerEdge[] = ["right", "left"];

/** How near the posed edge an entering centre must stand: forty units. */
const EDGE_BAND = 40;

/** How far inside `edge` a centre stands, across the seam. */
function insideEdge(x: number, edge: SaucerEdge): number {
  const fromEdge = edge === "left" ? x : FIELD_W - x;
  return Math.min(fromEdge, FIELD_W - fromEdge);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("brings the next arrival in at the posed edge and consumes the pose", async () => {
  for (const [index, edge] of EDGES.entries()) {
    openSaucerGame(h);
    h.debug.setNextSaucerEdge(edge);
    assertEqual(
      h.snapshot().nextSaucerEdge,
      edge,
      `setNextSaucerEdge(${edge}) read back before the arrival ` +
        "(specs/instrumentation.md)",
    );

    const arrival = await closeUpArrival(h, null);
    if (index === 0) captureStill(h, "posed");

    assertLessThanOrEqual(
      insideEdge(arrival.saucer.x, edge),
      EDGE_BAND,
      `how far inside the posed ${edge} edge the saucer's centre first stood ` +
        "(specs/instrumentation.md)",
    );
    assertEqual(
      arrival.snapshot.nextSaucerEdge,
      null,
      `nextSaucerEdge once the arrival posed at the ${edge} has consumed it ` +
        "(specs/instrumentation.md)",
    );
  }
});
