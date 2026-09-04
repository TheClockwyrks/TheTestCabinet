// Wick — instrumentation/enemy-id-unknown-invalid: `setEnemyPosition`,
// `setEnemyHp`, `setEnemyHeading`, `setEnemyAge`, `setEnemyContactCooldown`,
// and `removeEnemy` each throw for an id that names no live enemy, leaving
// the state as it was.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// "Enemies": "An `id` that names no live enemy is invalid for every operation
// below that takes one"; an invalid argument throws.
//
// THE POSE. An isolated run with one moth, so the operations have a live
// enemy to distinguish the unknown id from; the unknown id is one no spawn
// has taken (`nextId` and beyond are never live). Each call, and the whole
// snapshot compared with the one before them.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertThrows } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("throws for an unknown enemy id on every enemy operation", async () => {
  isolate(h);
  placeEnemy(h, "moth", 300, 0);
  const before = h.snapshot();
  const unknown = before.run.nextId + 100;

  assertThrows(
    () => h.debug.setEnemyPosition(unknown, 0, 0),
    "setEnemyPosition with an unknown id",
  );
  assertThrows(
    () => h.debug.setEnemyHp(unknown, 1),
    "setEnemyHp with an unknown id",
  );
  assertThrows(
    () => h.debug.setEnemyHeading(unknown, 1, 0),
    "setEnemyHeading with an unknown id",
  );
  assertThrows(
    () => h.debug.setEnemyAge(unknown, 1),
    "setEnemyAge with an unknown id",
  );
  assertThrows(
    () => h.debug.setEnemyContactCooldown(unknown, 1),
    "setEnemyContactCooldown with an unknown id",
  );
  assertThrows(
    () => h.debug.removeEnemy(unknown),
    "removeEnemy with an unknown id",
  );
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "refused");
  assertDeepEqual(after, before, "snapshot after the refused calls");
});
