// pickups/all-bread-collected — every bread meeting the condition is collected that tick.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Collection"): "Every bread
// and draft that meets the condition on a tick is collected on that tick", the
// condition being "the distance between its center and the lamplighter's center
// is less than `PICKUP_ITEM_RADIUS` (`16`) plus `PLAYER_RADIUS`". The
// one-at-a-time rule in the sentence after it is a chest's alone. So with two
// breads and a draft posed on the lamplighter's center, all three at distance
// `0`, one tick takes all three, and a build that collects one pickup per tick
// leaves two standing.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing else dropped, and no slot held, so the three pickups
// are the whole of the field and nothing else can remove one. No chest is posed,
// because a chest would open an overlay at the end of the tick and the
// one-per-tick rule that governs chests is `pickups/one-chest-per-tick`'s. Two
// breads rather than one, so the rule is read on a repeated kind as well as
// across kinds. The lamplighter's health is left where a fresh run puts it,
// since what the breads heal is `pickups/bread-heals`'s reading.
//
// THE TOLERANCE. None: the pickups are on the field after the tick or they are
// not.
//
// The other kind is `pickups/all-drafts-collected`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertUndefined } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  pickupById,
  placePickup,
  type Harness,
} from "../harness";

/** How many of the kind lie on the lamplighter's center. */
const POSED = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("collects two bread on one tick", async () => {
  const opened = await isolate(h);
  const at = opened.run.player;
  const posed = [];
  for (let i = 0; i < POSED; i += 1) {
    posed.push(await placePickup(h, "bread", at.x, at.y));
  }
  const before = await h.snapshot();
  assertEqual(before.run.pickups.length, POSED, "the pickups posed");

  const after = await h.step(1);
  await captureStill(h, "all");

  assertEqual(after.run.pickups.length, 0, "the pickups left after one tick");
  posed.forEach((pickup, i) => {
    assertUndefined(
      pickupById(after, pickup.id),
      `the bread posed at index ${i} after the tick`,
    );
  });
});
