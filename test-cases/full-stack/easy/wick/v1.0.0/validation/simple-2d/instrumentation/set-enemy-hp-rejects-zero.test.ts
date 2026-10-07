// Wick — instrumentation/set-enemy-hp-rejects-zero: on a hound with `maxHp`
// 120, `setEnemyHp(id, 0)` throws and leaves `hp` as it was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setEnemyHp(id,
// hp)`): "a real number above `0` and at most its `maxHp`; anything else is
// invalid, since death is decided by the tick"; "the call throws rather than
// guessing what was meant". `hp` at `0` is what a killing tick leaves, not
// what a pose may set. The other bound is the sibling point.
//
// WHY THE WORLD IS POSED AS IT IS. The hound is posed alive at an hp of its
// own, so the low end of the domain, which the tick alone decides and the
// whole snapshot can be read exactly across the refused call.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertThrows } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  spawnEnemyAt,
  type Harness,
} from "../harness";

/** The hp the hound is posed at, well inside the domain the refusal is outside. */
const HELD_HP = 50;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses 0", async () => {
  isolate(h);
  const id = spawnEnemyAt(h, "hound", 300, 0);
  h.debug.setEnemyHp(id, HELD_HP);
  const before = h.snapshot();

  assertThrows(() => h.debug.setEnemyHp(id, 0), "setEnemyHp(id, 0)");
  assertDeepEqual(h.snapshot(), before, "the snapshot after the refusal");

  await h.tick(1);
  captureStill(h, "refused");
});
