// editor/member-refused-end-outside-envelope — a member with an end outside the
// envelope is refused.
//
// specs/structure.md: a member placement is refused when "either end is outside
// the envelope". specs/world.md says what the envelope is — "an axis-aligned box,
// stated as inclusive coordinate ranges on each axis. Every lattice node used by
// the structure lies inside the envelope" — and specs/sites.md gives site 1,
// First Lift, `y 0..16`.
//
// THE MEMBER STRADDLES THE BOUND, which is what makes the refusal this rule's and
// no other's: `a` at `(0, 16, 0)` lies ON the envelope's inclusive `y` maximum, so
// it is inside, and `b` at `(0, 18, 0)` stands one `LATTICE_PITCH` above it, so it
// is outside. Everything else about the placement is legal — the two ends are
// distinct lattice nodes, the strut is `2` long against `STRUT_MAX_LEN` (`6`), no
// member joins the pair already, and `20` is well inside the budget of `3000`.
//
// THE WORLD IS EMPTIED so no obstacle can reach the segment and no ring stands for
// the arm-to-tower rule to trip on. What is read is that nothing stands — "a
// refused edit changes nothing" — which is the one direction this point decides.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** On the envelope's inclusive `y` maximum, and one lattice pitch above it. */
const A = { x: 0, y: 16, z: 0 };
const B = { x: 0, y: 18, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a member whose far end stands outside the envelope", async () => {
  await openSite(h, 0);
  await clearAll(h);

  await h.debug.addMember(A.x, A.y, A.z, B.x, B.y, B.z, "strut");

  await h.advance(1);
  await h.capture(
    "outside-envelope",
    "The build screen after a member reaching past the envelope was refused",
  );

  assertLength(
    (await h.snapshot()).structure.members,
    0,
    "the members standing after a placement whose far end at y 18 is outside " +
      "site 1's envelope, y 0..16 (specs/structure.md, specs/world.md)",
  );
});
