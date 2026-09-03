// editor/ring-refused-on-the-ground — a ring whose base corner sits at y 0 is
// refused.
//
// specs/structure.md: a ring placement is refused when "the base corner's `y` is
// `0`, since the ring sits on a tower, not on the ground". This is the refusing
// side of that bound; the lowest legal base corner, one `LATTICE_PITCH` up, is its
// own point.
//
// THE STRUCTURE IS EMPTIED so this rule is the only one that can refuse, and a
// refusal here therefore means the build enforced THIS rule. Of the five ring
// refusals, the other four are all satisfied by `(0, 0, 0)` on site 1: the crane
// has no ring, the eight flange nodes span `x 0..2`, `y 0..2`, `z 0..2` and every
// one of them lies inside the envelope (`x -8..12`, `y 0..16`, `z -8..12`), no
// member stands so no path can run between a flange node and an anchor, and
// `RING_COST` (`300`) is well inside the site's budget of `3000`.

import { afterEach, beforeEach, it } from "vitest";
import { assertNull } from "../assert";
import { createHarness, openSite, type Harness } from "../harness";

/** The base corner on the ground plane, which the editor refuses. */
const CORNER = { x: 0, y: 0, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a ring whose base corner's y is 0", async () => {
  await openSite(h, 0);
  // The precondition is an empty structure and nothing else. A site opened
  // after a reset already carries one (specs/state.md), and `clearStructure`
  // states it rather than leaving it implied; emptying the yard and the tape
  // too would drive surface this requirement does not concern.
  await h.debug.clearStructure();

  await h.debug.setRing(CORNER.x, CORNER.y, CORNER.z);

  await h.advance(1);
  await h.capture(
    "ring-on-the-ground",
    "The build screen after a ring on the ground plane was refused",
  );

  assertNull(
    (await h.snapshot()).structure.ring,
    "the ring after a placement whose base corner sits at y 0, which " +
      "specs/structure.md refuses because the ring sits on a tower",
  );
});
