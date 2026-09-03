// Wick — instrumentation/clear-zones: `clearZones()` with puddles, a lantern
// set, and a slash live leaves `zones` empty and every projectile as it was.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `clearZones()`: "Removes every zone, the aura and the lanterns included."
// A pose leaves the rest as it stands, so the projectiles stay. "Slashes,
// strikes, bursts, lanterns, and auras are never posed directly: each is
// created by holding its weapon ... and running the tick it fires on".
//
// THE POSE. An isolated run: Taper kept and Lantern held, both armed, one
// tick so a slash and a lantern set exist, `weaponFire` off; two posed
// puddles and a posed bolt; the call, read at the call.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import {
  advanceTicks,
  armWeapon,
  captureStill,
  createHarness,
  disable,
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

afterEach(() => {
  h.dispose();
});

it("removes every zone and leaves the projectiles", async () => {
  isolate(h, { keepTaper: true });
  armWeapon(h, 0);
  armWeapon(h, holdWeapon(h, "lantern"));
  const fired = await advanceTicks(h, 1);
  disable(h, "weaponFire");
  assertLength(zonesOfKind(fired, "slash"), 1, "the slash before the call");
  assertLength(zonesOfKind(fired, "lantern"), 1, "the lantern before the call");
  placePuddle(h, "oil-splash", 200, 200);
  placePuddle(h, "oil-splash", -200, 200);
  placeProjectile(h, "ember", 100, 0, 400, 0, 0);
  const before = h.snapshot();
  assertLength(before.run.zones, 4, "zones before the call");

  h.debug.clearZones();
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "cleared");
  assertDeepEqual(after.run.zones, [], "zones after clearZones");
  assertDeepEqual(
    after.run.projectiles,
    before.run.projectiles,
    "projectiles after clearZones",
  );
});
