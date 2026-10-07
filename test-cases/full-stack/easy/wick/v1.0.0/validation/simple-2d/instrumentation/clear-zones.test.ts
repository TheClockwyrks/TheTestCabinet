// instrumentation/clear-zones — `clearZones()` with puddles, a lantern set,
// and a slash live leaves zones empty and every projectile as it was.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `clearZones`:
// "Removes every zone, the aura and the lanterns included".
//
// THE POSE. An isolated run holding Taper and Lantern, both armed, and one
// tick with `weaponFire` on, which creates the slash (alive for SLASH_FLASH)
// and the lantern set; two puddles and a bolt posed; the clear on the same
// tick boundary; the read back without a frame with the projectiles compared
// entry for entry.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThan, assertLength } from "../assert";
import {
  armWeapon,
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
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

it("removes every zone and keeps the projectiles", async () => {
  isolate(h);
  armWeapon(h, holdWeapon(h, "taper", 1));
  armWeapon(h, holdWeapon(h, "lantern", 1));
  const fired = await h.tick(1);
  assertGreaterThan(zonesOfKind(fired, "slash").length, 0, "the slash fired");
  assertGreaterThan(
    zonesOfKind(fired, "lantern").length,
    0,
    "the lantern set fired",
  );
  h.debug.spawnPuddle("oil-splash", 300, 300);
  h.debug.spawnPuddle("blaze", -300, 300);
  h.debug.spawnProjectile("ember", 200, 0, 400, 0, 0);
  const before = h.snapshot();
  assertLength(before.run.projectiles, 1, "the projectiles before the clear");

  h.debug.clearZones();
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "cleared");

  assertLength(s.run.zones, 0, "the zones after the clear");
  assertDeepEqual(
    s.run.projectiles,
    before.run.projectiles,
    "the projectiles across the clear",
  );
});
