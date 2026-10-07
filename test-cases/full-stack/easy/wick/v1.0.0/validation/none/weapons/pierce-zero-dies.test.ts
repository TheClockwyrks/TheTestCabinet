// Wick — weapons/pierce-zero-dies: a projectile with pierce 0 is removed by its
// first hit.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Projectiles and
// pierce"): "Every hit lowers its `pierce` by one, and a hit on a projectile
// whose `pierce` is `0` removes it instead, so a projectile with `pierce` `n`
// hits `n + 1` enemies." `specs/instrumentation.md` has a posed projectile
// "first hit ... on the next tick", so a bolt posed on a moth's center with
// pierce `0` hits on the next tick and is gone from that tick's snapshot.
//
// THE POSE. One moth and one level-1 Ember bolt on its center with zero
// velocity and pierce `0`. Every faculty is held: hits resolve whatever the
// switches hold, and nothing else is in the night to hit. The bolt's `10`
// damage takes the moth's `5` hp below zero, which is how the hit is seen — a
// bolt that stayed because it never hit is told apart from one that stayed
// through a hit by the moth still standing.
//
// TOLERANCE. None: the requirement is presence in a list on a fixed tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertUndefined } from "../assert";
import {
  captureStill,
  createHarness,
  enemyById,
  isolate,
  placeEnemy,
  placeProjectile,
  projectileById,
  type Harness,
} from "../harness";

/** Where the moth stands, clear of the lamplighter. */
const MOTH = { x: 200, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes a pierce-0 bolt on the tick of its first hit", async () => {
  await isolate(h);
  const moth = await placeEnemy(h, "moth", MOTH.x, MOTH.y);
  const bolt = await placeProjectile(h, "ember", MOTH.x, MOTH.y, 0, 0, 0);

  const hit = await h.step(1);
  await captureStill(h, "spent");

  assertUndefined(
    enemyById(hit, moth.id),
    "the moth the bolt hit, in the tick's snapshot",
  );
  assertUndefined(
    projectileById(hit, bolt.id),
    "the pierce-0 bolt after its first hit",
  );
});
