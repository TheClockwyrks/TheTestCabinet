// editor/ring-refused-flange-outside-envelope — a ring whose TOP flange stands
// above the envelope is refused.
//
// specs/structure.md: "A ring placement is refused when ... any of the eight
// flange nodes falls outside the envelope". The ring "occupies eight nodes: the
// bottom flange, the four nodes `(x, y, z)`, `(x + LATTICE_PITCH, y, z)`,
// `(x, y, z + LATTICE_PITCH)`, and `(x + LATTICE_PITCH, y, z + LATTICE_PITCH)`,
// and the top flange, the same four nodes at `y + LATTICE_PITCH`" — so the corner
// alone lying inside the envelope is not enough, and the top flange two units
// above it is the node a build that tests only the picked node lets through.
//
// THE SCENARIO IS THE VERTICAL EDGE OF THAT RULE, the one a horizontal test cannot
// reach. Site 1's envelope is `y 0..16`, so a base corner at `(0, 16, 0)` puts its
// bottom flange exactly on the bound — inside — and its top flange at `y 18`, two
// units outside it. Every other reason the editor could refuse this ring is
// absent: the world is emptied first so no member can make a path between the
// flanges, the corner's `y` is not `0`, its `x` and `z` spans of `0..2` sit well
// inside `x -8..12` and `z -8..12`, and `RING_COST` (`300`) is far inside the
// site's budget of `3000`. So the flange outside the envelope is the only thing
// left that can decide the placement.

import { afterEach, beforeEach, it } from "vitest";
import { assertNull } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/**
 * The base corner: bottom flange on the envelope's `y` bound of `16`, top flange
 * at `y 18`, two units past it (specs/sites.md, site 1).
 */
const CORNER = { x: 0, y: 16, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a ring whose top flange stands above the envelope", async () => {
  await openSite(h, 0);
  await clearAll(h);

  await h.debug.setRing(CORNER.x, CORNER.y, CORNER.z);

  await h.advance(1);
  await h.capture("refused", "The build screen after the refused ring");

  assertNull(
    (await h.snapshot()).structure.ring,
    "the ring after a placement whose top flange falls outside the site's " +
      "envelope (specs/structure.md)",
  );
});
