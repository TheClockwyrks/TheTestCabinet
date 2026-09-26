// instrumentation/clear-projectiles — `clearProjectiles()` with bolts, darts,
// and a sconce live leaves projectiles empty and every zone as it was.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `clearProjectiles`:
// "Removes every projectile".
//
// THE POSE. An isolated run with two bolts, two darts, a sconce, and a puddle
// zone; the clear; the read back without a frame with the zones compared
// entry for entry.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes every projectile and keeps the zones", async () => {
  isolate(h);
  h.debug.spawnProjectile("ember", 100, 0, 400, 0, 0);
  h.debug.spawnProjectile("ember", -100, 0, -400, 0, 0);
  h.debug.spawnProjectile("pin", 0, 100, 600, 0, 1);
  h.debug.spawnProjectile("pin", 0, -100, 600, 0, 1);
  h.debug.spawnProjectile("sconce", 0, 200, 0, 600, -1);
  h.debug.spawnPuddle("oil-splash", 300, 300);
  const before = h.snapshot();
  assertLength(before.run.projectiles, 5, "the projectiles before the clear");
  assertLength(before.run.zones, 1, "the zones before the clear");

  h.debug.clearProjectiles();
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "cleared");

  assertLength(s.run.projectiles, 0, "the projectiles after the clear");
  assertDeepEqual(s.run.zones, before.run.zones, "the zones across the clear");
});
