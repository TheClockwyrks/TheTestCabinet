// Wick — instrumentation/enemy-id-unknown-invalid: `setEnemyPosition`,
// `setEnemyHp`, `setEnemyHeading`, `setEnemyAge`, `setEnemyContactCooldown`,
// and `removeEnemy` each throw when given an id that names no live enemy,
// leaving the state as it was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Enemies"): "An
// `id` that names no live enemy is invalid for every operation below that
// takes one"; "the call throws rather than guessing what was meant". The
// comparison across each refused call is exact equality of the state a pose
// governs.
//
// WHY THE WORLD IS POSED AS IT IS. One moth is alive, so a build that answered
// the unknown id by touching "the enemy" it does hold would change it; the id
// used is one the run has never assigned, well past `nextId`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertRejects } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  posedState,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("throws on an id that names no live enemy, leaving the state as it was", async () => {
  await isolate(h);
  await placeEnemy(h, "moth", 200, 0);
  const before = await h.snapshot();
  const unknown = before.run.nextId + 1000;

  const calls: { name: string; run: () => Promise<void> }[] = [
    {
      name: "setEnemyPosition",
      run: () => h.debug.setEnemyPosition(unknown, 0, 0),
    },
    { name: "setEnemyHp", run: () => h.debug.setEnemyHp(unknown, 1) },
    {
      name: "setEnemyHeading",
      run: () => h.debug.setEnemyHeading(unknown, 1, 0),
    },
    { name: "setEnemyAge", run: () => h.debug.setEnemyAge(unknown, 1) },
    {
      name: "setEnemyContactCooldown",
      run: () => h.debug.setEnemyContactCooldown(unknown, 1),
    },
    { name: "removeEnemy", run: () => h.debug.removeEnemy(unknown) },
  ];
  for (const { name, run } of calls) {
    await assertRejects(run, `${name} with an unknown id`);
    assertDeepEqual(
      posedState(await h.snapshot()),
      posedState(before),
      `the state across the refused ${name}`,
    );
  }
  await captureStill(h, "refused");
});
