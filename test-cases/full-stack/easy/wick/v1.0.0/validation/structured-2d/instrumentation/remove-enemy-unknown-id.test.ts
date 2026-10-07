// Wick — instrumentation/remove-enemy-unknown-id: `removeEnemy` throws when
// given an id that names no live enemy, leaving the state as it was.
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

it("throws for an id that names no live enemy", async () => {
  isolate(h);
  placeEnemy(h, "moth", 300, 0);
  const before = h.snapshot();
  const unknown = before.run.nextId + 1000;

  assertThrows(
    () => h.debug.removeEnemy(unknown),
    "removeEnemy(id) with an unknown id",
  );
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "refused");

  assertDeepEqual(after, before, "the snapshot after the refused call");
});
