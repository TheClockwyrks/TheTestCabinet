// editor/ring-refused-second — a second ring is refused.
//
// specs/structure.md: "The slew ring is the bearing the arm turns on, and a crane
// has exactly one", and the refusal that keeps it so is the first in the ring's
// list — "A ring placement is refused when ... the crane already has a ring."
// Removal is how a ring is moved: "Removing a member, the ring, or a counterweight
// is always allowed", so a build that let a second placement land would be a build
// whose crane has two bearings, or one that silently moved the first.
//
// THE WORLD IS EMPTIED FIRST so the first ring is seated by nothing but this
// check, and the second corner is chosen so that EVERY OTHER reason to refuse it
// is absent: `(4, 4, 4)` spans `x 4..6`, `y 4..6`, `z 4..6`, all inside site 1's
// envelope of `x -8..12`, `y 0..16`, `z -8..12`; its `y` is not `0`; no member
// exists to make a path between its flanges; and a second `RING_COST` would bring
// the cost to `600` against a budget of `3000`. So the ring already standing is
// the only thing left that can decide the placement — and the reading is where the
// ring stands afterwards, which separates a refusal from a silent move.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNotNull } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The corner the crane's one ring is seated at. */
const FIRST = { x: 0, y: 4, z: 0 };

/** A second corner that breaks no other ring rule on site 1. */
const SECOND = { x: 4, y: 4, z: 4 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a ring placement on a crane that already has one", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setRing(FIRST.x, FIRST.y, FIRST.z);
  assertNotNull(
    (await h.snapshot()).structure.ring,
    "the one ring this check tries to place a second beside",
  );

  await h.debug.setRing(SECOND.x, SECOND.y, SECOND.z);

  await h.advance(1);
  await h.capture("ring", "The crane's one ring after the second was refused");

  assertDeepEqual(
    (await h.snapshot()).structure.ring,
    { corner: FIRST },
    "where the ring stands after a second placement (specs/structure.md)",
  );
});
