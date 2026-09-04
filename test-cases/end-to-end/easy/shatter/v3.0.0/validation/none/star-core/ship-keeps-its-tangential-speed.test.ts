// star-core/ship-keeps-its-tangential-speed — the graze costs the ship nothing it
// was carrying along the surface.
//
// THE RULE. `specs/collision.md`, the second step of the slide: "The component of
// the ship's velocity heading into the core is removed, and the component along the
// surface is kept unchanged." This item reads the second half of that sentence, and
// `star-core/ship-loses-its-inward-speed` reads the first. They are separate points
// because the two wrong models the manifest names fail different halves: a build
// that ZEROES the whole velocity removes the inward component correctly and loses
// the tangential one, and a build that REFLECTS keeps the tangential one and turns
// the inward one around. Read together they would grade the same, and a reviewer
// would not learn which of the two the build implemented.
//
// WHY THE APPROACH IS OFF-CENTRE. A head-on approach has no component along the
// surface, so "kept" and "zeroed" read the same `0` and the item decides nothing.
// `./contact.ts` flies the ship past the star's centre at an impact parameter of
// `26` of the `44` at which the core touches it, which leaves `59` percent of its
// speed along the surface at the contact — a substantial number, and a different one
// from the `81` percent heading into the core, so the two halves of the rule cannot
// be confused for one another either.
//
// THE FRAME IS THE BUILD'S OWN. The surface direction is a quarter turn from the
// outward direction at the ship's resolved position, and `specs/collision.md`
// pushes the ship out ALONG that outward direction — so whatever position a build
// measured the contact from, the ray it pushed along is the one the resolved
// position stands on, and reading the frame there rather than from a direction this
// check made up is what keeps it from grading an implementation. The same frame is
// used for the velocity before the contact and the velocity after it, so what is
// compared is two components in one basis.
//
// WHY FIVE PERCENT. The item's own figure, and it has one thing to absorb: the drag
// `specs/ship.md` applies on the contact's own tick, which multiplies the whole
// velocity by `0.5 ^ (TICK_DT / 3.0)` and so takes `0.19` percent off the component
// being compared. Five percent is twenty-six times that and still nowhere near the
// hundred percent a build that zeroes the velocity loses. A build whose drag figure
// is wrong is graded by `flight/drag-halves-in-three-seconds`, not here.

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

/** The five percent the item allows. See the header for what it absorbs. */
const TANGENTIAL_TOLERANCE = 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the component along the core's surface as it found it", async () => {
  await startPlaying(h);
  await poseTheApproach(h);

  const passage = await driveIntoTheCore(h, SLIDE_TICKS);
  await captureStill(h, "slide");
  const contact = requireContact(passage, "the tangential component");

  const carried = componentAlong(contact.before.velocity, contact.tangent);
  const kept = componentAlong(contact.after.velocity, contact.tangent);

  assertLessThanOrEqual(
    Math.abs(kept - carried),
    Math.abs(carried) * TANGENTIAL_TOLERANCE,
    `how far the contact moved the ${carried.toFixed(1)} units per second the ship carried along the core's surface, which it keeps unchanged (specs/collision.md)`,
  );
});
