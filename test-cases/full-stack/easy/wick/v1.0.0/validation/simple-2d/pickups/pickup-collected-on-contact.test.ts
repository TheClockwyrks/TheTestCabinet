// pickups/pickup-collected-on-contact — a pickup is collected when the gap to
// the lamplighter's center is less than PICKUP_ITEM_RADIUS plus PLAYER_RADIUS.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Collection"): "A pickup is
// collected on any tick on which the distance between its center and the
// lamplighter's center is less than `PICKUP_ITEM_RADIUS` (`16`) plus
// `PLAYER_RADIUS`, the same distance at every Lure level." `PLAYER_RADIUS` is
// 12 (specs/world.md, "The lamplighter"), so the distance is 28 and the
// comparison is strict: a bread `INSIDE` (27) units out is collected on the
// next tick and one `OUTSIDE` (28) units out, exactly at the sum, is not. The
// rule is read from both sides on the same tick, which is what pins the figure
// rather than the direction of the comparison.
//
// THE WORLD. An isolated `playing` run: nothing alive, nothing else on the
// ground, no weapon and no passive held, every driver switch off, so nothing
// moves the lamplighter or either pickup and nothing else can remove one. Both
// pickups are bread, whose collection changes health rather than the screen, so
// neither collection can end the tick early or open an overlay over the other.
// They lie on opposite sides of the lamplighter, along `+x` and `−x`, so their
// distances are whole numbers rather than hypotenuses and neither can be
// mistaken for the other.
//
// WHAT IS READ. After one tick: the pickup 27 units out gone and the pickup 28
// units out still on the field at the point it was placed.
//
// TOLERANCE. `MOTION_TOLERANCE` (1e-6) on the survivor's coordinates; none on
// the counts. The two probes sit one unit either side of the stated distance,
// six orders above that allowance.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertUndefined, assertWithin } from "../assert";
import {
  MOTION_TOLERANCE,
  PICKUP_ITEM_RADIUS,
  PLAYER_RADIUS,
} from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  spawnPickupAt,
  type Harness,
} from "../harness";
import { pickupById, pickupOf } from "./night";

/** PICKUP_ITEM_RADIUS (16) + PLAYER_RADIUS (12): the collection distance. */
const CONTACT = PICKUP_ITEM_RADIUS + PLAYER_RADIUS;

/** One unit inside the distance, so the tick collects it. */
const INSIDE = CONTACT - 1;

/** Exactly at the distance, which "less than" leaves uncollected. */
const OUTSIDE = CONTACT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("collects the bread 27 units out and leaves the one 28 units out", async () => {
  const posed = isolate(h);
  const { player } = posed.run;
  const near = spawnPickupAt(h, "bread", player.x + INSIDE, player.y);
  const far = spawnPickupAt(h, "bread", player.x - OUTSIDE, player.y);

  const after = await h.tick(1);
  captureStill(h, "contact");

  assertUndefined(
    pickupById(after, near),
    `the bread ${INSIDE} units out, inside the ${CONTACT} the rule allows`,
  );
  assertLength(after.run.pickups, 1, "pickups left after the tick");
  const seen = pickupOf(after, far);
  assertWithin(
    seen.x,
    player.x - OUTSIDE,
    MOTION_TOLERANCE,
    `the x of the bread exactly ${CONTACT} units out`,
  );
  assertWithin(
    seen.y,
    player.y,
    MOTION_TOLERANCE,
    `the y of the bread exactly ${CONTACT} units out`,
  );
});
