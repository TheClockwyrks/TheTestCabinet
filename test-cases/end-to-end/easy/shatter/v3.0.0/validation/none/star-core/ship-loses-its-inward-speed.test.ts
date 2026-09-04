// star-core/ship-loses-its-inward-speed — the graze takes the whole of what the
// ship was carrying into the star, and nothing more.
//
// THE RULE. `specs/collision.md`, the second step of the slide: "The component of
// the ship's velocity heading into the core is removed, and the component along the
// surface is kept unchanged." This item reads the first half;
// `star-core/ship-keeps-its-tangential-speed` reads the second. Two points, because
// the two wrong models the manifest names fail different halves.
//
// WHY THE BOUND IS TWO-SIDED, AND WHY THAT IS THE WHOLE POINT. "Removed" means
// gone, not turned around. A build that REFLECTS the ship off the core — the
// obvious thing to write, and what a billiard ball does — leaves the same component
// with its sign flipped, so the ship bounces back the way it came instead of
// grazing on around the surface. Measured as a signed component heading INTO the
// core, the specification's slide reads `0`, a reflection reads about `-149` — the
// same speed heading back out — and a build with no core rule at all is still
// carrying about `+83` straight in. A one-sided bound would pass the reflection;
// the two-sided one names it.
//
// AND A BUILD THAT ZEROES THE WHOLE VELOCITY PASSES THIS ITEM, which is right: it
// has removed the inward component. What it has also done is thrown away the
// tangential one, and that is what the companion item reads. Between the two, a
// reviewer can tell which of the wrong models a build implemented.
//
// THE FRAME IS THE BUILD'S OWN, taken a quarter turn from the surface direction the
// companion item uses: the outward direction at the ship's resolved position, which
// `specs/collision.md` pushes the ship out along and removes the component along.
// See `./contact.ts` for why reading it there rather than from a direction this
// check made up is what keeps the reading from grading an implementation.
//
// WHY FIVE UNITS PER SECOND. The item's own figure. A build answering the rule
// leaves exactly `0`, so the bound has only float noise to absorb; five units per
// second is under three percent of the `185` the ship is travelling at when it
// meets the core, and every wrong model above misses it by more than eighty.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { componentAlong } from "../geometry";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import {
  driveIntoTheCore,
  poseTheApproach,
  requireContact,
  SLIDE_TICKS,
} from "./contact";

/** The five units per second the item allows around `0`. See the header. */
const INWARD_TOLERANCE = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves no component of the ship's velocity heading into the core", async () => {
  await startPlaying(h);
  await poseTheApproach(h);

  const passage = await driveIntoTheCore(h, SLIDE_TICKS);
  await captureStill(h, "slide");
  const contact = requireContact(passage, "the inward component");

  const heldBefore = -componentAlong(contact.before.velocity, contact.normal);
  const left = -componentAlong(contact.after.velocity, contact.normal);

  assertLessThanOrEqual(
    Math.abs(left),
    INWARD_TOLERANCE,
    `the component of the ship's velocity heading into the core after a contact it carried ${heldBefore.toFixed(1)} units per second into, which the slide removes (specs/collision.md)`,
  );
});
