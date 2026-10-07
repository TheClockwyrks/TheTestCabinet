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

it("refuses an id that names no live enemy", async () => {
  isolate(h);
  spawnEnemyAt(h, "moth", 300, 0);
  const before = h.snapshot();
  const unknown = before.run.nextId + 1000;

  assertThrows(
    () => h.debug.setEnemyHeading(unknown, 1, 0),
    "setEnemyHeading(id, 1, 0) with an id that names no live enemy",
  );
  assertDeepEqual(
    h.snapshot(),
    before,
    "the snapshot after setEnemyHeading was refused",
  );

  await h.tick(1);
  captureStill(h, "refused");
});
