// Wick — instrumentation/spawn-projectile-sconce-rejects-zero-velocity:
// `spawnProjectile("sconce", 0, 0, 0, 0, -1)` throws and adds nothing.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `spawnProjectile(...)`): "so a zero velocity is invalid for `sconce`"; "the
// call throws rather than guessing what was meant".
//
// WHY THE WORLD IS POSED AS IT IS. An empty night, so a projectile added in
// spite of the refusal would be the only one.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertRejects } from "../assert";
import { INFINITE_PIERCE } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("throws on a sconce with zero velocity and adds nothing", async () => {
  await isolate(h);
  await assertRejects(
    () => h.debug.spawnProjectile("sconce", 0, 0, 0, 0, INFINITE_PIERCE),
    "spawnProjectile('sconce', 0, 0, 0, 0, -1)",
  );
  const after = await h.snapshot();
  await captureStill(h, "refused");
  assertLength(after.run.projectiles, 0, "the projectiles after the refused call");
});
