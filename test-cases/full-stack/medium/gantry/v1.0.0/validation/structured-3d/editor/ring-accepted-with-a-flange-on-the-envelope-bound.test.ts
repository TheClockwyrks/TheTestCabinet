// editor/ring-accepted-with-a-flange-on-the-envelope-bound — a top flange standing
// exactly ON the envelope's upper y bound is inside it, and the ring stands.
//
// specs/world.md states the envelope as "an axis-aligned box, stated as INCLUSIVE
// coordinate ranges on each axis", and specs/structure.md refuses a ring only when
// "any of the eight flange nodes falls OUTSIDE the envelope". A node on the bound
// is not outside it, so this is the accepting side of the rule that refuses a ring
// reaching past the envelope.
//
// THE PLACEMENT IS PUT EXACTLY ON THE BOUND, which is what makes it that edge
// case: site 1's envelope is `x -8..12`, `y 0..16`, `z -8..12`, and the ring
// occupies its base corner's four nodes and "the same four nodes at
// `y + LATTICE_PITCH`", so a base corner at `(0, 14, 0)` puts the bottom flange at
// `y = 14` and the top flange at `y = 16` — the envelope's own maximum, and no
// higher. The eight nodes span `x 0..2`, `y 14..16`, `z 0..2`, every one inside.
//
// THE STRUCTURE IS EMPTIED so nothing else can refuse: the crane has no ring, the
// base corner's `y` is not `0`, no member stands so no path can run between a
// flange node and an anchor, and `RING_COST` (`300`) is well inside the site's
// budget of `3000`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { LATTICE_PITCH } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** Site 1's inclusive y maximum, which the top flange stands exactly on. */
const ENVELOPE_MAX_Y = 16;

/** One lattice pitch below it, so the top flange lands on the bound. */
const CORNER = { x: 0, y: ENVELOPE_MAX_Y - LATTICE_PITCH, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("accepts a ring whose top flange stands exactly on the envelope's y bound", async () => {
  await openSite(h, 0);
  await clearAll(h);

  await h.debug.setRing(CORNER.x, CORNER.y, CORNER.z);

  await h.advance(1);
  await h.capture(
    "ring-on-the-bound",
    "The ring seated with its top flange on the envelope bound",
  );

  const { ring } = (await h.snapshot()).structure;
  assertNotNull(
    ring,
    `the ring after a placement whose top flange stands at y ${ENVELOPE_MAX_Y}, ` +
      "site 1's INCLUSIVE envelope maximum (specs/world.md, specs/structure.md)",
  );
  assertEqual(
    `(${ring?.corner.x}, ${ring?.corner.y}, ${ring?.corner.z})`,
    `(${CORNER.x}, ${CORNER.y}, ${CORNER.z})`,
    "the base corner the ring is seated by (specs/structure.md)",
  );
});
