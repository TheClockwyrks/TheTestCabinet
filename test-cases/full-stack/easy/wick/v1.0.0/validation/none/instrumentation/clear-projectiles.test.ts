// Wick — instrumentation/clear-projectiles: `clearProjectiles()` with bolts,
// darts, and a sconce live leaves `projectiles` empty and every zone as it was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `clearProjectiles()`): "Removes every projectile." Zones are a separate
// list the operation does not name, so they are read exactly across the call.
//
// WHY THE WORLD IS POSED AS IT IS. Three projectile weapons, one of them the
// sconce whose acceleration a build might keep apart, and a puddle zone beside
// them, so a clear that took the zones too is caught.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import { INFINITE_PIERCE } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  placeProjectile,
  placePuddle,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes every projectile and leaves the zones", async () => {
  await isolate(h);
  await placeProjectile(h, "ember", 100, 0, 400, 0, 0);
  await placeProjectile(h, "ember", -100, 0, -400, 0, 0);
  await placeProjectile(h, "pin", 0, 100, 600, 0, 1);
  await placeProjectile(h, "sconce", 0, -100, 0, 600, INFINITE_PIERCE);
  await placePuddle(h, "oil-splash", 200, 200);
  const before = await h.snapshot();
  assertLength(before.run.projectiles, 4, "the projectiles before the clear");

  await h.debug.clearProjectiles();
  const after = await h.snapshot();
  await captureStill(h, "cleared");
  assertLength(
    after.run.projectiles,
    0,
    "the projectiles after clearProjectiles()",
  );
  assertDeepEqual(
    after.run.zones,
    before.run.zones,
    "the zones across the clear",
  );
});
