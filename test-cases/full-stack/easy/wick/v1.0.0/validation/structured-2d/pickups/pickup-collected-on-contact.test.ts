// pickups/pickup-collected-on-contact — a pickup is collected within
// PICKUP_ITEM_RADIUS plus PLAYER_RADIUS, and not beyond it.
//
// WHERE THE THRESHOLD COMES FROM. `specs/world.md` ("Collection"): "A pickup is
// collected on any tick on which the distance between its center and the
// lamplighter's center is less than `PICKUP_ITEM_RADIUS` (`16`) plus
// `PLAYER_RADIUS`, the same distance at every Lure level", with ("The
// lamplighter") "| Collision radius | `PLAYER_RADIUS` | `12` |". The sum is
// `28`, and "less than" makes the boundary strict. So a bread posed
// `INSIDE_DISTANCE` (`27`) units out is collected on the next tick and one
// posed `BOUNDARY_DISTANCE` (`28`) units out is not, since `28` is not less
// than `28`. Both sides of the one boundary are read here because they are the
// one rule, and a build that collects at the wrong distance misses exactly one
// of them.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing else dropped, and no slot held, so no Lure is involved
// and nothing else removes a pickup. The two breads are posed on opposite sides
// of the lamplighter, `+x` and `−x`, so one tick reads both sides of the
// boundary in one world and neither stands where the other does. `bread` is the
// kind read because collecting one leaves the game on `playing`: a chest would
// end the tick on an overlay and stop the second reading. No key is pressed, so
// the lamplighter holds the origin and the distances the rule tests are the
// posed ones, each a difference of two exact numbers along one axis.
//
// THE TOLERANCE. `MOTION_EPS` (`1e-6`) on where the uncollected pickup stayed;
// the removals themselves are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertNear, assertUndefined } from "../assert";
import { MOTION_EPS, PICKUP_ITEM_RADIUS, PLAYER_RADIUS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  pickupById,
  placePickup,
  type Harness,
} from "../harness";

/** The collection distance: "`PICKUP_ITEM_RADIUS` (`16`) plus `PLAYER_RADIUS`" (`28`). */
const CONTACT_DISTANCE = PICKUP_ITEM_RADIUS + PLAYER_RADIUS;

/** One unit inside the boundary, where the rule's "less than" holds. */
const INSIDE_DISTANCE = CONTACT_DISTANCE - 1;

/** Exactly on the boundary, where "less than" does not hold. */
const BOUNDARY_DISTANCE = CONTACT_DISTANCE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("collects the bread 27 units out and leaves the one exactly 28 units out", async () => {
  const opened = isolate(h);
  const at = opened.run.player;
  const inside = placePickup(h, "bread", at.x + INSIDE_DISTANCE, at.y);
  const boundary = placePickup(h, "bread", at.x - BOUNDARY_DISTANCE, at.y);
  const posed = pickupById(h.snapshot(), boundary);
  assertDefined(posed, "the bread posed on the boundary");

  const after = await advanceTicks(h, 1);
  captureStill(h, "contact");

  assertUndefined(
    pickupById(after, inside),
    `the bread ${INSIDE_DISTANCE} units out after the tick (specs/world.md, Collection)`,
  );
  const left = pickupById(after, boundary);
  assertDefined(
    left,
    `the bread exactly ${BOUNDARY_DISTANCE} units out after the tick (specs/world.md, Collection: less than)`,
  );
  assertNear(
    left?.x ?? NaN,
    posed?.x ?? NaN,
    MOTION_EPS,
    "the uncollected bread's x after the tick, in units",
  );
});
