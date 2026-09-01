// pickups/pickup-collected-on-contact — a pickup is collected within
// PICKUP_ITEM_RADIUS plus PLAYER_RADIUS, and not beyond it.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Collection"): "A pickup is
// collected on any tick on which the distance between its center and the
// lamplighter's center is less than `PICKUP_ITEM_RADIUS` (`16`) plus
// `PLAYER_RADIUS`, the same distance at every Lure level", with
// "Collision radius | `PLAYER_RADIUS` | `12`" under "The lamplighter". The sum
// is `28`, and "less than" makes the boundary strict. So a bread posed
// `INSIDE_DISTANCE` (`27`) units out is collected on the next tick and one
// posed `BOUNDARY_DISTANCE` (`28`) units out is not: `28` is not less than `28`.
// Both sides of the one boundary are read here, because both are the same rule
// and a build that collects at the wrong distance misses exactly one of them.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing else dropped, and no slot held, so no Lure is involved
// and nothing else removes a pickup. The two breads are posed on opposite sides
// of the lamplighter, `+x` and `−x`, so one tick reads both sides of the
// boundary in one world and neither stands where the other does. `bread` is the
// kind read because collecting one leaves the game on `playing`: a chest would
// end the tick on an overlay and stop the second reading. No key is pressed, so
// the lamplighter holds the origin and the distances the rule tests are the
// posed ones.
//
// THE TOLERANCE. `POSITION_TOL` (`1e-6`) on where the uncollected pickup stayed;
// the removals themselves are exact. The boundary distance is a sum of two whole
// figures posed along one axis, so the distance the rule tests is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertNear, assertUndefined } from "../assert";
import { PICKUP_ITEM_RADIUS, PLAYER_RADIUS, POSITION_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  pickupById,
  placePickup,
  type Harness,
} from "../harness";

/** The collection distance: "`PICKUP_ITEM_RADIUS` (`16`) plus `PLAYER_RADIUS`" (`28`). */
const CONTACT_DISTANCE = PICKUP_ITEM_RADIUS + PLAYER_RADIUS;

/** One unit inside the boundary, so the rule's "less than" holds. */
const INSIDE_DISTANCE = CONTACT_DISTANCE - 1;

/** Exactly on the boundary, where "less than" does not hold. */
const BOUNDARY_DISTANCE = CONTACT_DISTANCE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("collects the bread 27 units out and leaves the one exactly 28 units out", async () => {
  const opened = await isolate(h);
  const at = opened.run.player;
  const inside = await placePickup(h, "bread", at.x + INSIDE_DISTANCE, at.y);
  const boundary = await placePickup(
    h,
    "bread",
    at.x - BOUNDARY_DISTANCE,
    at.y,
  );

  const after = await h.step(1);
  await captureStill(h, "contact");

  assertUndefined(
    pickupById(after, inside.id),
    `the bread ${INSIDE_DISTANCE} units out after the tick`,
  );
  const left = pickupById(after, boundary.id);
  assertDefined(
    left,
    `the bread ${BOUNDARY_DISTANCE} units out after the tick`,
  );
  assertNear(
    left!.x,
    boundary.x,
    POSITION_TOL,
    "the uncollected bread's x after the tick",
  );
});
