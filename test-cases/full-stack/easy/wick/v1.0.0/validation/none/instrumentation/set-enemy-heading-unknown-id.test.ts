// Wick — instrumentation/set-enemy-heading-unknown-id: `setEnemyHeading`
// throws when given an id that names no live enemy, leaving the state as it
// was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Enemies"): "An
// `id` that names no live enemy is invalid for every operation below that
// takes one"; "the call throws rather than guessing what was meant". The
// comparison across the refused call is exact equality of the state a pose
// governs. Every other operation that takes an enemy id is a point of its own.
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

it("throws on an id that names no live enemy", async () => {
  await isolate(h);
  await placeEnemy(h, "moth", 200, 0);
  const before = await h.snapshot();
  const unknown = before.run.nextId + 1000;

  await assertRejects(
    () => h.debug.setEnemyHeading(unknown, 1, 0),
    "setEnemyHeading(id, 1, 0) with an unknown id",
  );
  await captureStill(h, "refused");

  assertDeepEqual(
    posedState(await h.snapshot()),
    posedState(before),
    "the state across the refused setEnemyHeading",
  );
});
