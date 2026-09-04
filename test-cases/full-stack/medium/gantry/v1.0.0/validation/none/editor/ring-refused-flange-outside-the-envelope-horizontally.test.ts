// editor/ring-refused-flange-outside-the-envelope-horizontally — a base corner on
// the envelope's x maximum puts four flange nodes beyond it, and is refused.
//
// specs/structure.md: a ring placement is refused when "any of the eight flange
// nodes falls outside the envelope" — ALL EIGHT, not the base corner alone. The
// ring "occupies eight nodes: the bottom flange, the four nodes `(x, y, z)`,
// `(x + LATTICE_PITCH, y, z)`, `(x, y, z + LATTICE_PITCH)`, and
// `(x + LATTICE_PITCH, y, z + LATTICE_PITCH)`, and the top flange, the same four
// nodes at `y + LATTICE_PITCH`", so a corner sits at the low `x` and low `z` of a
// square that reaches one pitch further on each.
//
// THE CORNER IS PUT ON THE ENVELOPE'S OWN x MAXIMUM, which is the edge case: site
// 1's envelope is `x -8..12`, `y 0..16`, `z -8..12`, so `(12, 4, 0)` is itself
// inside it — a build that checked the base corner alone would accept — while the
// four flange nodes at `x = 14` are one pitch beyond it. THIS IS THE HORIZONTAL
// half of the rule; the vertical half, a top flange above the `y` maximum, is its
// own point.
//
// THE STRUCTURE IS EMPTIED so nothing else can refuse: the crane has no ring, the
// base corner's `y` is `4` rather than `0`, no member stands so no path can run
// between a flange node and an anchor, and `RING_COST` (`300`) is well inside the
// site's budget of `3000`.

import { afterEach, beforeEach, it } from "vitest";
import { assertNull } from "../assert";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** On site 1's inclusive x maximum, so the far flange nodes stand at x 14. */
const CORNER = { x: 12, y: 4, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a ring whose far flange nodes stand outside the envelope in x", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await h.debug.clearStructure();

  await h.debug.setRing(CORNER.x, CORNER.y, CORNER.z);

  await h.advance(1);
  await h.capture(
    "flange-past-x",
    "The build screen after a ring reaching past the envelope in x was refused",
  );

  assertNull(
    (await h.snapshot()).structure.ring,
    "the ring after a placement whose base corner sits on site 1's x maximum " +
      "of 12, putting four flange nodes at x 14, outside the envelope " +
      "(specs/structure.md)",
  );
});
