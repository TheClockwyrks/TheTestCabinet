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
// lands on the posed edge a quarter of the time — cannot land on both by luck. What
// is read is the rock's distance from the POSED edge, within the hundred units
// `rocks/recycle-re-enters-from-off-screen` allows a re-entry from the seam.
//
// THE POSED EDGE, NOT THE NEAREST ONE. `specs/rocks.md` draws the point uniformly
// along the whole length of the edge and pins no inset for the centre, so a rock
// coming back near a corner may stand nearer the perpendicular edge than the one it
// entered at. Which edge it is nearest is therefore not a reading of the pose; how
// far it stands from the edge that was posed is.
//
// AND THE POSE IS READ FROM THE SEAM AND THE HEADING TOGETHER, because the field is
// a torus and its four edges are two seams (`specs/field.md`, "The wrap"): a rock
// re-placed on the right edge reports `x = 0` and one re-placed on the bottom
// reports `y = 0`, the wrap having brought `FIELD_W` and `FIELD_H` back into range,
// so ON the seam a distance alone cannot tell the posed edge from the one facing it.
// What can is the direction the rock came in travelling — `specs/rocks.md` has every re-entry
// "heading inward into the field", and inward from the bottom is upward while inward
// from the top is downward. The pair still names one edge in four, so the two slings
// still cost a build that ignores the pose fifteen chances in sixteen.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { componentAlong } from "../geometry";
import {
  captureStill,
  createHarness,
  startPlaying,
  velocityOf,
  type FieldEdge,
  type Harness,
} from "../harness";
import {
  FALL_FROM,
  FALL_SPEED,
  distanceFromEdge,
  inwardFrom,
  poseRockAt,
  slingIntoTheStar,
  theOneRock,
} from "../rocks/scene";

/** The two edges posed, each on its own sling. */
const EDGES: readonly FieldEdge[] = ["left", "bottom"];

/** How far from the seam a re-entering rock may stand: a hundred units. */
const EDGE_REACH = 100;

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
    assertLessThanOrEqual(
      distanceFromEdge(returned, edge),
      EDGE_REACH,
      `units the re-entering rock stands inside the field from the posed ${edge} edge (specs/rocks.md, specs/field.md)`,
    );
    assertGreaterThan(
      componentAlong(velocityOf(returned), inwardFrom(edge)),
      0,
      `units per second the re-entering rock is heading into the field from the posed ${edge} edge, which is what tells that edge from the one facing it across the same seam (specs/rocks.md, specs/field.md)`,
    );
    assertEqual(
      recycle.at.nextRecycleEdge,
      null,
      `nextRecycleEdge once the recycle posed at the ${edge} has consumed it (specs/instrumentation.md)`,
    );
  }
});
