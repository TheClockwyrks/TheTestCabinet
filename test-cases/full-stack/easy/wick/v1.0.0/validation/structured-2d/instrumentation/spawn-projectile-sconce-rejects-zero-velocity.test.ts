// Wick — instrumentation/spawn-projectile-sconce-rejects-zero-velocity:
// `spawnProjectile('sconce', 0, 0, 0, 0, -1)` throws and adds nothing.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `spawnProjectile(...)`: "A `sconce` takes acceleration `−SCONCE_DECEL` along
// the unit vector of `(vx, vy)`, so a zero velocity is invalid for `sconce`";
// an invalid argument throws.
//
// THE POSE. An isolated run, the call, and the whole snapshot compared with
// the one before it (so `nextId` is unmoved too).

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertThrows } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("throws for a sconce at zero velocity and adds nothing", async () => {
  const before = isolate(h);
  assertThrows(
    () => h.debug.spawnProjectile("sconce", 0, 0, 0, 0, -1),
    "spawnProjectile('sconce', 0, 0, 0, 0, -1)",
  );
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "refused");
  assertDeepEqual(
    after.run.projectiles,
    [],
    "projectiles after the refused call",
  );
  assertDeepEqual(after, before, "snapshot after the refused call");
});
