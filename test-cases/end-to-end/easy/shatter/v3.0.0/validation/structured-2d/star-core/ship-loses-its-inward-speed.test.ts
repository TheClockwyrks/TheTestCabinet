// star-core/ship-loses-its-inward-speed — the slide takes the motion ACROSS the
// surface off entirely, and does not turn it around.
//
// THE RULE. `specs/collision.md`, "The slide along the core", step 2: on contact
// "THE COMPONENT OF THE SHIP'S VELOCITY HEADING INTO THE CORE IS REMOVED, and
// the component along the surface is kept unchanged". This item is the half that
// is removed. The half that is kept is `ship-keeps-its-tangential-speed`, and
// the two are separate points precisely because the commonest wrong models fail
// exactly one each.
//
// WHAT IS READ. The ship's velocity resolved ALONG THE CONTACT NORMAL — the
// direction from the star's centre to the ship, which is the one
// `specs/collision.md` step 1 pushes it out along — on the tick the contact
// resolved. Removed means gone, so what is left along that direction is zero.
//
// WHY THE MAGNITUDE AND NOT THE SIGNED INWARD PART. Because a reflection has to
// fail here, and reading only the part still heading inward would let it pass. A
// build that bounces the ship off the core leaves the same speed along the normal
// with its sign flipped: nothing of it is heading INTO the core any more, so a
// reading of the inward part alone would report `0` and grade a bounce as a
// slide. "Removed" is a statement about the component, not about its sign, and
// the component of a velocity that has been removed has magnitude zero. That is
// what is read, and it is what makes the bounce and the slide different numbers.
//
// EVERY WRONG MODEL READS AS A DIFFERENT NUMBER. The approach arrives with about
// `191` units per second across the surface (see `GRAZE_MISS` in `approach.ts`).
// A build that reflects it reads `+191`, thirty-eight times the bound. A build
// that halves the component rather than removing it reads `96`, nineteen
// times.
// A build that zeroes the WHOLE velocity reads `0` and passes here — correctly:
// it is not wrong about this half, and `ship-keeps-its-tangential-speed` is what
// it fails.
//
// WHAT THIS POINT DOES NOT DECIDE, AND WHY THAT IS RIGHT. A build with no
// boundary at all also reads about `0` here, and passes. That is arithmetic
// rather than luck: a body on a straight line is moving exactly across the
// radius at its closest approach, so a ship nothing turned aside has no radial
// velocity at the reading whatever its course. This item is the second step of a
// slide, and a build that never slides is decided by the first —
// `ship-slides-along-the-core`, which reads that build's closest approach at
// `30` against the `44` the rule fixes and is capped `broken` for it.
//
// WHY 5 UNITS PER SECOND. The figure the review item states. A conforming build
// leaves exactly nothing along the normal — the subtraction is exact — so the
// bound is room for a build's arithmetic and for the sub-tick timing of the
// resolution, and it is a nineteenth of what the smallest wrong model above
// leaves behind. The reference leaves nothing measurable at all.
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
 * How much motion may be left along the contact normal, in units per second.
 *
 * 5, the figure the review item states. See the header: the rule leaves exactly
 * none, and the nearest wrong model leaves `110`.
 */
const RADIAL_TOLERANCE = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the ship no velocity across the core's surface after the contact", async () => {
  startPlaying(h);

  const graze = await grazeTheCore(h);

  const normal = contactNormal(graze);
  const arriving = graze.path[graze.contact - 1];
  const left = graze.path[graze.contact];

  // Positive is outward, negative is into the core.
  const before = arriving.vx * normal.x + arriving.vy * normal.y;
  const after = left.vx * normal.x + left.vy * normal.y;

  // The ship on the core's surface with its inward motion taken off.
  await showTheContact(h, graze);
  captureStill(h, "slide");

  assertLessThanOrEqual(
    Math.abs(after),
    RADIAL_TOLERANCE,
    "the ship's velocity across the core's surface to be removed by the " +
      `contact, leaving at most ${RADIAL_TOLERANCE} units per second along ` +
      "the normal in EITHER direction — removed, not reversed " +
      "(specs/collision.md, the slide, step 2); it arrived with " +
      `${before.toFixed(2)} units per second along the normal and left with ` +
      `${after.toFixed(2)}`,
  );
});
