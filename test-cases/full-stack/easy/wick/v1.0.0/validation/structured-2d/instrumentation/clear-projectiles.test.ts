// Wick — instrumentation/clear-projectiles: `clearProjectiles()` with bolts,
// darts, and a sconce live leaves `projectiles` empty and every zone as it
// was.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `clearProjectiles()`: "Removes every projectile." A pose "sets one thing
// and leaves the rest of the game as it stands", so the zones stay.
//
// THE POSE. An isolated run with two ember bolts, two pin darts, a sconce,
// and a puddle, the call, read at the call.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
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

afterEach(() => {
  h.dispose();
});

it("removes every projectile and leaves the zones", async () => {
  isolate(h);
  placeProjectile(h, "ember", 100, 0, 400, 0, 0);
  placeProjectile(h, "ember", -100, 0, -400, 0, 0);
  placeProjectile(h, "pin", 0, 100, 600, 0, 1);
  placeProjectile(h, "pin", 0, -100, 600, 0, 1);
  placeProjectile(h, "sconce", 0, 0, 0, 600, -1);
  placePuddle(h, "oil-splash", 200, 200);
  const before = h.snapshot();
  assertLength(before.run.projectiles, 5, "projectiles before the call");

  h.debug.clearProjectiles();
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "cleared");
  assertDeepEqual(
    after.run.projectiles,
    [],
    "projectiles after clearProjectiles",
  );
  assertDeepEqual(
    after.run.zones,
    before.run.zones,
    "zones after clearProjectiles",
  );
});
