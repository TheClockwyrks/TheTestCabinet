// Wick — instrumentation/remove-weapon-drops-aura: with Halo held and its aura
// live, `removeWeapon` on Halo's slot leaves the aura gone after the next
// `playing` tick, while the puddles and bolts other weapons produced stay.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `removeWeapon(slot)`): "Its aura or lantern set is removed on the next
// `playing` tick under the placement rule; the projectiles and other zones it
// produced stay." specs/world.md phase 5: an aura is "removed on a tick its
// weapon is no longer held".
//
// WHY THE WORLD IS POSED AS IT IS. The aura is placed by a real tick first; an
// Oil Splash puddle and an Ember bolt are posed beside it, so what the removal
// takes is read against what it must leave. The aura is read at the pose too,
// since the removal itself takes only the slot.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  placeProjectile,
  placePuddle,
  projectileById,
  zoneById,
  zonesOfKind,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes the aura on the next tick and leaves the other shapes", async () => {
  await isolate(h);
  const slot = await holdWeapon(h, "halo", 1);
  const placed = await h.step(1);
  assertLength(zonesOfKind(placed, "aura"), 1, "the aura before the removal");
  const puddle = await placePuddle(h, "oil-splash", 200, 200);
  const bolt = await placeProjectile(h, "ember", -200, 0, 0, 0, 0);

  await h.debug.removeWeapon(slot);
  const removed = await h.snapshot();
  assertLength(removed.run.weapons, 0, "the weapons after the removal");

  const after = await h.step(1);
  await captureStill(h, "dropped");
  assertLength(zonesOfKind(after, "aura"), 0, "the aura after the next playing tick");
  assertEqual(zoneById(after, puddle.id) !== undefined, true, "the puddle, still there");
  assertEqual(projectileById(after, bolt.id) !== undefined, true, "the bolt, still there");
});
