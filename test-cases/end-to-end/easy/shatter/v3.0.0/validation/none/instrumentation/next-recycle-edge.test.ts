// instrumentation/next-recycle-edge — `setNextRecycleEdge` decides the edge the
// next rock the star takes re-enters at, and the recycle consumes the pose.
//
// THE RULE. `specs/instrumentation.md`, "Posed draws": `setNextRecycleEdge(edge)`
// "poses the edge, `top`, `bottom`, `left`, or `right`, the next rock the star
// recycles re-enters at. The point on that edge is still drawn", reported as
// `nextRecycleEdge`, and the recycle consumes it.
//
// THE SCENARIO IS `rocks/scene.ts`'S SLING: one rock dropped onto the star from
// above, taken at the core, read on the tick it re-enters. Two edges, the left and
// the bottom, on two slings, so a build that ignores the pose and draws — which
// lands on the posed edge a quarter of the time — cannot land on both by luck. The
// edge the rock stands nearest is read the way `rocks/recycle-re-enters-from-off-
// screen` reads it, and it must be the posed one within the hundred units that
// item allows a re-entry from the seam.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type FieldEdge,
  type Harness,
} from "../harness";
import {
  FALL_FROM,
  FALL_SPEED,
  nearestEdge,
  poseRockAt,
  slingIntoTheStar,
  theOneRock,
} from "../rocks/scene";

/** The two edges posed, each on its own sling. */
const EDGES: readonly FieldEdge[] = ["left", "bottom"];

/** How far from the seam a re-entering rock may stand: a hundred units. */
const EDGE_REACH = 100;

/** The name `nearestEdge` gives each edge. */
const EDGE_NAMES: Readonly<Record<FieldEdge, string>> = {
  top: "the top edge",
  bottom: "the bottom edge",
  left: "the left edge",
  right: "the right edge",
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns the next recycled rock at the posed edge and consumes the pose", async () => {
  for (const [index, edge] of EDGES.entries()) {
    await startPlaying(h);
    await poseRockAt(h, "large", FALL_FROM, { x: 0, y: FALL_SPEED });
    await h.debug.setNextRecycleEdge(edge);
    assertEqual(
      (await h.snapshot()).nextRecycleEdge,
      edge,
      `setNextRecycleEdge(${edge}) read back before the recycle (specs/instrumentation.md)`,
    );

    const recycle = await slingIntoTheStar(h);
    if (index === 0) await captureStill(h, "posed");

    const returned = theOneRock(recycle.at, "the recycled rock");
    const nearest = nearestEdge(returned);
    assertEqual(
      nearest.name,
      EDGE_NAMES[edge],
      `the edge the rock posed to re-enter at the ${edge} stood nearest (specs/instrumentation.md)`,
    );
    assertLessThanOrEqual(
      nearest.distance,
      EDGE_REACH,
      `units the re-entering rock stands from the posed ${edge} edge (specs/rocks.md)`,
    );
    assertEqual(
      recycle.at.nextRecycleEdge,
      null,
      `nextRecycleEdge once the recycle posed at the ${edge} has consumed it (specs/instrumentation.md)`,
    );
  }
});
