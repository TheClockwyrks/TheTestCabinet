// instrumentation/remove-weapon-drops-aura — with Halo held and its aura
// live, `removeWeapon` on Halo's slot leaves the aura gone after the next
// playing tick, while the puddles and bolts other weapons produced stay.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `removeWeapon`:
// "Its aura or lantern set is removed on the next `playing` tick under the
// placement rule; the projectiles and other zones it produced stay".
// specs/world.md, phase 5: an aura is "removed on a tick its weapon is no
// longer held".
//
// THE POSE. An isolated run holding Halo, one tick to place the aura, then an
// Oil Splash puddle and an Ember bolt posed. The removal, one tick: no aura,
// the puddle and the bolt still there.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  projectileById,
  zoneById,
  zonesOfKind,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("drops the aura on the next tick and keeps the rest", async () => {
  isolate(h);
  const halo = holdWeapon(h, "halo", 1);
  const placed = await h.tick(1);
  assertLength(
    zonesOfKind(placed, "aura"),
    1,
    "the aura live before the removal",
  );
  const puddle = h.snapshot().run.nextId;
  h.debug.spawnPuddle("oil-splash", 300, 300);
  const bolt = h.snapshot().run.nextId;
  h.debug.spawnProjectile("ember", -300, 0, 0, 0, 0);

  h.debug.removeWeapon(halo);
  const after = await h.tick(1);
  captureStill(h, "dropped");

  assertLength(after.run.weapons, 0, "the weapons after the removal");
  assertLength(zonesOfKind(after, "aura"), 0, "the aura after the next tick");
  assertDefined(zoneById(after, puddle), "the puddle, kept");
  assertDefined(projectileById(after, bolt), "the bolt, kept");
});
