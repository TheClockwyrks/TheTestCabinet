// Wick — instrumentation/set-enemy-hp-above-max-applies: on a hound with
// `maxHp` 120, `setEnemyHp(id, 121)` leaves the hound's health at 121, and
// `setEnemyHp(id, 0)` still throws.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setEnemyHp(id,
// hp)`): "a real number above `0`; `0` and below are invalid, since death is
// decided by the tick. There is no upper bound: an enemy's `maxHp` is scaled by
// the run clock at its spawn, so it is what ordinary play holds the enemy under
// rather than a limit on this pose, and a value above it is applied as it was
// given." The lower bound is a figure the specification fixes and stands; the
// upper one reads a live figure and does not.
//
// WHY THE WORLD IS POSED AS IT IS. The hound is posed alive, so one past the
// hound's `maxHp` and the refused `0` are both read exactly off the same enemy.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertThrows } from "../assert";
import { ENEMIES } from "../constants";
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

it("applies 121 and still throws on 0", async () => {
  isolate(h);
  const id = placeEnemy(h, "hound", 300, 0);

  h.debug.setEnemyHp(id, ENEMIES.hound.hp + 1);
  h.debug.reconcile();
  const after = h.snapshot().run.enemies.find((enemy) => enemy.id === id);
  await h.frameDraw();
  captureStill(h, "posed");

  assertEqual(after?.hp, ENEMIES.hound.hp + 1, "the hound's hp after the pose");
  assertEqual(after?.maxHp, ENEMIES.hound.hp, "the maxHp the pose leaves");

  assertThrows(() => h.debug.setEnemyHp(id, 0), "setEnemyHp(id, 0)");
});
