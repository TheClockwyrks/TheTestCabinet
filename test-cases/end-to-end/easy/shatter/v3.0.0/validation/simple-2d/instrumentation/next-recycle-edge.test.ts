// instrumentation/next-recycle-edge — `setNextRecycleEdge` decides the edge the
// next rock the star takes re-enters at, and the recycle consumes the pose.
//
// THE RULE. `specs/instrumentation.md`, "Posed draws": `setNextRecycleEdge(edge)`
// "poses the edge, `top`, `bottom`, `left`, or `right`, the next rock the star
// recycles re-enters at. The point on that edge is still drawn", reported as
// `nextRecycleEdge`, and the recycle consumes it.
//
// THE SCENARIO IS `rocks/scene.ts`'S SLING: one rock dropped onto the star from
// above, taken at the core, read on the tick it re-enters. Two edges, the left
// and the bottom, on two slings, so a build that ignores the pose and draws —
// which lands on the posed edge a quarter of the time — cannot land on both by
// luck. What is read is the rock's distance from the POSED edge, within the
// hundred units `rocks/recycle-re-enters-from-off-screen` allows a re-entry from
// the seam.
//
// THE POSED EDGE, NOT THE NEAREST ONE. `specs/rocks.md` draws the point uniformly
// along the whole length of the edge and pins no inset for the centre, so a rock
// coming back near a corner may stand nearer the perpendicular edge than the one
// it entered at. Which edge it is nearest is therefore not a reading of the pose;
// how far it stands from the edge that was posed is.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import {
  distanceFromEdge,
  dropOntoTheStar,
  slingIntoTheStar,
  theOneRock,
} from "../rocks/scene";
import type { FieldEdge } from "../surface";

/** The two edges posed, each on its own sling. */
const EDGES: readonly FieldEdge[] = ["left", "bottom"];

/** How far from the seam a re-entering rock may stand: a hundred units. */
const EDGE_REACH = 100;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns the next recycled rock at the posed edge and consumes the pose", async () => {
  for (const [index, edge] of EDGES.entries()) {
    startPlaying(h);
    dropOntoTheStar(h, "large");
    h.debug.setNextRecycleEdge(edge);
    assertEqual(
      h.snapshot().nextRecycleEdge,
      edge,
      `setNextRecycleEdge(${edge}) read back before the recycle ` +
        "(specs/instrumentation.md)",
    );

    const recycle = await slingIntoTheStar(h);
    if (index === 0) captureStill(h, "posed");

    const returned = theOneRock(recycle.at, "the recycled rock");
    assertLessThanOrEqual(
      distanceFromEdge(returned, edge),
      EDGE_REACH,
      `units the re-entering rock stands from the posed ${edge} edge ` +
        "(specs/rocks.md)",
    );
    assertEqual(
      recycle.at.nextRecycleEdge,
      null,
      `nextRecycleEdge once the recycle posed at the ${edge} has consumed it ` +
        "(specs/instrumentation.md)",
    );
  }
});
