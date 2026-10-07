// pickups/draft-attracts-all — a draft attracts every gem on the field.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Pickups") lists what a draft
// does: "Every gem on the field becomes attracted", and ("Attraction and
// flight") repeats it: "A draft attracts every gem on the field at once, as the
// pickups section below states." No distance qualifies it, and the collection
// condition that takes the draft is the fixed one: "the distance between its
// center and the lamplighter's center is less than `PICKUP_ITEM_RADIUS` (`16`)
// plus `PLAYER_RADIUS`". So a draft posed on the lamplighter's center is
// collected by the next tick, and gems posed `500`, `1500`, and `3000` units
// out, each far beyond `PICKUP_RADIUS` (`48`), all read `attracted` `true`
// after that tick. A build that attracts only the gems within some radius
// misses the farther ones.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing else dropped, and no slot held, so nothing but the
// draft can latch a gem and no Lure widens the radius that would otherwise do
// it. The three distances are the specification's own scale of "on the field":
// the nearest is ten times the pickup radius, the farthest is two and a half
// times `DESPAWN_DISTANCE` (`1200`). They are posed on three different bearings
// so no gem lies on another's flight line. Each is placed by `spawnGem`, which
// "Places one unattracted gem", so every latch this check reads is the draft's.
//
// THE TOLERANCE. None on `attracted`, a boolean, or on the pickup count.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual } from "../assert";
import { PICKUP_RADIUS } from "../constants";
import {
  captureStill,
  collectPickup,
  createHarness,
  gemById,
  isolate,
  placeGem,
  type Harness,
} from "../harness";

/** Three distances, each far outside `PICKUP_RADIUS` (`48`), on three bearings. */
const GEMS = [
  { tier: "small" as const, dx: 500, dy: 0 },
  { tier: "medium" as const, dx: 0, dy: 1500 },
  { tier: "large" as const, dx: -3000, dy: 0 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("latches every gem on the field on the tick that collects a draft", async () => {
  const opened = await isolate(h);
  assertEqual(
    opened.run.pickupRadius,
    PICKUP_RADIUS,
    "the pickup radius with no Lure held",
  );
  const at = opened.run.player;
  const posed = [];
  for (const gem of GEMS) {
    const placed = await placeGem(h, gem.tier, at.x + gem.dx, at.y + gem.dy);
    assertEqual(placed.attracted, false, "the posed gem's attracted flag");
    posed.push(placed);
  }

  const after = await collectPickup(h, "draft");
  await captureStill(h, "draft");

  assertEqual(after.run.pickups.length, 0, "the pickups left after the tick");
  posed.forEach((gem, i) => {
    const seen = gemById(after, gem.id);
    assertDefined(seen, `the gem posed at index ${i} after the draft's tick`);
    assertEqual(
      seen!.attracted,
      true,
      `the attracted flag of the gem posed at index ${i}`,
    );
  });
});
