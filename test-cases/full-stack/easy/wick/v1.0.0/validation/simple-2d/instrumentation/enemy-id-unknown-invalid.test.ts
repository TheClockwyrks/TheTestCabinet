// instrumentation/enemy-id-unknown-invalid — `setEnemyPosition`, `setEnemyHp`,
// `setEnemyHeading`, `setEnemyAge`, `setEnemyContactCooldown`, and
// `removeEnemy` each throw when given an id that names no live enemy, leaving
// the state as it was.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "Enemies": "An `id`
// that names no live enemy is invalid for every operation below that takes
// one"; an invalid argument "throws rather than guessing what was meant".
//
// THE POSE. An isolated run with one moth, so the operations have a live
// enemy to be told apart from; an id one past the next to be assigned, which
// nothing holds; each refused call and the whole snapshot against the
// reading before.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertThrows } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  spawnEnemyAt,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses an unknown id on every enemy operation", async () => {
  isolate(h);
  spawnEnemyAt(h, "moth", 300, 0);
  const before = h.snapshot();
  const unknown = before.run.nextId + 1;

  const calls: readonly [string, () => void][] = [
    ["setEnemyPosition", () => h.debug.setEnemyPosition(unknown, 0, 0)],
    ["setEnemyHp", () => h.debug.setEnemyHp(unknown, 1)],
    ["setEnemyHeading", () => h.debug.setEnemyHeading(unknown, 1, 0)],
    ["setEnemyAge", () => h.debug.setEnemyAge(unknown, 1)],
    [
      "setEnemyContactCooldown",
      () => h.debug.setEnemyContactCooldown(unknown, 1),
    ],
    ["removeEnemy", () => h.debug.removeEnemy(unknown)],
  ];
  for (const [name, call] of calls) {
    assertThrows(call, `${name} with an id that names no live enemy`);
    assertDeepEqual(
      h.snapshot(),
      before,
      `the snapshot after ${name} was refused`,
    );
  }
  await h.tick(1);
  captureStill(h, "refused");
});
