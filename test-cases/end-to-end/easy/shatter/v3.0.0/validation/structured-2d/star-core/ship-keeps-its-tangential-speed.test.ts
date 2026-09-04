// star-core/ship-keeps-its-tangential-speed — the slide takes nothing off the
// motion ALONG the surface.
//
// THE RULE. `specs/collision.md`, "The slide along the core", step 2: on contact
// "the component of the ship's velocity heading into the core is removed, and
// THE COMPONENT ALONG THE SURFACE IS KEPT UNCHANGED", so "the ship therefore
// grazes around the core's surface and slides free". This item is the half of
// step 2 that is KEPT. The half that is removed is
// `ship-loses-its-inward-speed`, and the two are separate points precisely
// because the commonest wrong models fail exactly one each.
//
// WHAT IS READ. The ship's velocity resolved along the surface — the component
// perpendicular to the contact normal — on the tick the contact resolved,
// against the same component of the velocity it arrived with on the tick before.
// The normal is the direction from the star's centre to the ship at the contact,
// which is the very direction `specs/collision.md` step 1 pushes the ship out
// along, so it is read off the resolved position rather than guessed.
//
// WHY THE READING IS AGAINST THE TICK BEFORE, AND NOT AGAINST THE POSE. Because
// of the drag. `specs/ship.md` bleeds an un-thrusting ship's speed with a `3.0`
// second half-life, and the approach takes a bit over half a second — an
// eleven-percent loss, twice the bound this item allows. Reading the incoming
// velocity one tick before the contact leaves exactly ONE tick of drag between
// the two figures, which is `0.19` percent: a twenty-sixth of the bound, and
// running in the direction that costs a conforming build nothing it has not
// genuinely lost. Nothing else acts on the ship in between — no key is held and
// `specs/gravity.md` never pulls it — so the difference between the two numbers
// is the slide's doing and the drag's alone.
//
// EVERY WRONG MODEL READS AS A DIFFERENT NUMBER. The approach carries about
// `179` units per second along the surface at the contact (see `GRAZE_MISS` in
// `approach.ts`). A build that zeroes the whole velocity on contact reads `0` —
// a hundred percent out. A build that keeps only a fraction of it, as a
// restitution coefficient would, reads that fraction. A build that reflects the
// velocity, or one that does nothing at all, reads the full `179` and passes
// here — correctly: neither is wrong about THIS half, and the reflecting one is
// what `ship-loses-its-inward-speed` is for.
//
// WHY 5 PERCENT. The figure the review item states. The rule is "unchanged", so
// a conforming build has no latitude at all beyond the one tick of drag above
// and its own arithmetic; five percent is nine units per second here, against
// the whole `179` a build that zeroes the velocity loses. The reference spends
// `0.2` percent of it.
//
// THE SHIP IS ALONE. `startPlaying` empties the field and shuts both world
// gates, so the core is the only thing the ship can meet.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { contactNormal, grazeTheCore, showTheContact } from "./approach";

/**
 * How far the kept component may fall from the one the ship arrived with, as a
 * fraction of it.
 *
 * 5 percent, the figure the review item states. See the header: one tick of drag
 * is `0.19` percent of it and the nearest wrong model is a hundred.
 */
const TANGENTIAL_TOLERANCE = 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps the ship's velocity along the core's surface through the contact", async () => {
  startPlaying(h);

  const graze = await grazeTheCore(h);

  // The normal at the contact, and the surface direction across it.
  const normal = contactNormal(graze);
  const along = { x: -normal.y, y: normal.x };

  const arriving = graze.path[graze.contact - 1];
  const left = graze.path[graze.contact];

  const before = Math.abs(arriving.vx * along.x + arriving.vy * along.y);
  const after = Math.abs(left.vx * along.x + left.vy * along.y);

  // The ship on the core's surface, carrying its motion along it.
  await showTheContact(h, graze);
  captureStill(h, "slide");

  assertLessThanOrEqual(
    Math.abs(after - before) / before,
    TANGENTIAL_TOLERANCE,
    "the ship's speed along the core's surface to be unchanged by the " +
      `contact, within ${TANGENTIAL_TOLERANCE * 100} percent ` +
      `(specs/collision.md, the slide, step 2); it arrived carrying ` +
      `${before.toFixed(2)} units per second along the surface and left ` +
      `carrying ${after.toFixed(2)}`,
  );
});
