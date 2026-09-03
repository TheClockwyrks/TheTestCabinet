// editor/ring-accepted-one-pitch-above-the-ground — the lowest legal base corner,
// one LATTICE_PITCH up, stands.
//
// specs/structure.md refuses a ring placement when "the base corner's `y` is `0`,
// since the ring sits on a tower, not on the ground" — and only when it is `0`.
// The lattice is "the points whose coordinates are all integer multiples of
// `LATTICE_PITCH` (`2`)" (specs/world.md), so the next base corner up the vertical
// is `y = 2`, and this is the accepting side of that bound. The refusing side is
// its own point.
//
// THE STRUCTURE IS EMPTIED so nothing else can refuse the placement, and what
// stands afterwards is this rule's verdict. The other four ring refusals are all
// satisfied by `(0, 2, 0)` on site 1: the crane has no ring, the eight flange
// nodes span `x 0..2`, `y 2..4`, `z 0..2` and every one lies inside the envelope
// (`x -8..12`, `y 0..16`, `z -8..12`), no member stands so no path can run between
// a flange node and an anchor, and `RING_COST` (`300`) is well inside the site's
// budget of `3000`.
//
// WHAT IS READ IS THE SEATED CORNER: specs/structure.md places the ring "by its
// base corner, a lattice node `(x, y, z)`", and the snapshot reports that corner,
// so a ring that stood somewhere else is not this placement.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { LATTICE_PITCH } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The lowest base corner the editor accepts: one lattice pitch off the ground. */
const CORNER = { x: 0, y: LATTICE_PITCH, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("accepts a ring whose base corner is one LATTICE_PITCH above the ground", async () => {
  await openSite(h, 0);
  await clearAll(h);

  await h.debug.setRing(CORNER.x, CORNER.y, CORNER.z);

  await h.advance(1);
  await h.capture(
    "ring-one-pitch-up",
    "The ring seated at the lowest base corner the editor accepts",
  );

  const { ring } = (await h.snapshot()).structure;
  assertNotNull(
    ring,
    `the ring after a placement whose base corner is at y ${LATTICE_PITCH}, ` +
      "which specs/structure.md refuses only at y 0",
  );
  assertEqual(
    `(${ring?.corner.x}, ${ring?.corner.y}, ${ring?.corner.z})`,
    `(${CORNER.x}, ${CORNER.y}, ${CORNER.z})`,
    "the base corner the ring is seated by (specs/structure.md)",
  );
});
