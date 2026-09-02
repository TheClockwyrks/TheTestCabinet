// instrumentation/spawn-projectile-sconce-rejects-zero-velocity —
// `spawnProjectile('sconce', 0, 0, 0, 0, -1)` throws and adds nothing.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `spawnProjectile`:
// "A `sconce` takes acceleration `−SCONCE_DECEL` along the unit vector of
// `(vx, vy)`, so a zero velocity is invalid for `sconce`"; an invalid argument
// "throws rather than guessing what was meant".
//
// THE POSE. An isolated run, the refused call, and the whole snapshot against
// the reading before.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength, assertThrows } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a sconce with no direction", async () => {
  const before = isolate(h);

  assertThrows(
    () => h.debug.spawnProjectile("sconce", 0, 0, 0, 0, -1),
    "spawnProjectile('sconce', 0, 0, 0, 0, -1)",
  );
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "refused");

  assertLength(s.run.projectiles, 0, "the projectiles after the refused pose");
  assertDeepEqual(s, before, "the snapshot across the refused pose");
});
