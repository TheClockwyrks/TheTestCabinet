// Wick — instrumentation/clear-zones: `clearZones()` with puddles, a lantern
// set, and a slash live leaves `zones` empty and every projectile as it was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `clearZones()`):
// "Removes every zone, the aura and the lanterns included." Projectiles are a
// separate list the operation does not name, so they are read exactly across
// the call. "Slashes, strikes, bursts, lanterns, and auras are never posed
// directly: each is created by holding its weapon through `setWeapon` and
// running the tick it fires on".
//
// WHY THE WORLD IS POSED AS IT IS. Two puddles are posed, and Lantern and
// Taper are held with their timers due so one tick creates a lantern set and
// a slash for real; `weaponFire` is then held again and a bolt posed beside
// them, so a clear that took the projectiles too is caught.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThan, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  enable,
  holdWeapon,
  isolate,
  placeProjectile,
  placePuddle,
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

it("removes every zone and leaves the projectiles", async () => {
  await isolate(h);
  await placePuddle(h, "oil-splash", 200, 200);
  await placePuddle(h, "oil-splash", -200, 200);
  await holdWeapon(h, "lantern", 1);
  await holdWeapon(h, "taper", 1);
  await enable(h, "weaponFire");
  const fired = await h.step(1);
  await h.debug.setWeaponFire(false);
  assertGreaterThan(
    zonesOfKind(fired, "lantern").length,
    0,
    "lanterns the firing tick created",
  );
  assertGreaterThan(
    zonesOfKind(fired, "slash").length,
    0,
    "slashes the firing tick created",
  );
  assertLength(zonesOfKind(fired, "puddle"), 2, "the posed puddles");
  await placeProjectile(h, "ember", 100, 0, 400, 0, 0);
  const before = await h.snapshot();

  await h.debug.clearZones();
  const after = await h.snapshot();
  await captureStill(h, "cleared");
  assertLength(after.run.zones, 0, "the zones after clearZones()");
  assertDeepEqual(
    after.run.projectiles,
    before.run.projectiles,
    "the projectiles across the clear",
  );
});
