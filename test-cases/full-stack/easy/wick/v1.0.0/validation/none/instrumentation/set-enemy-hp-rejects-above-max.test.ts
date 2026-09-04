// Wick — instrumentation/set-enemy-hp-rejects-above-max: on a hound with
// `maxHp` 120, `setEnemyHp(id, 121)` throws and leaves `hp` as it was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setEnemyHp(id,
// hp)`): "a real number above `0` and at most its `maxHp`; anything else is
// invalid, since death is decided by the tick"; "the call throws rather than
// guessing what was meant". `121` is one past the hound's `maxHp` of `120`.
// The other bound is the sibling point.
//
// WHY THE WORLD IS POSED AS IT IS. The hound is posed alive, so one past the
// hound's maxHp and its `hp` can be read exactly across the refused call.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertRejects } from "../assert";
import { ENEMIES } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  mustEnemy,
  placeEnemy,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("throws on 121, leaving hp as it was", async () => {
  await isolate(h);
  const hound = await placeEnemy(h, "hound", 300, 0);
  assertEqual(hound.maxHp, ENEMIES.hound.hp, "the hound's maxHp");

  await assertRejects(
    () => h.debug.setEnemyHp(hound.id, ENEMIES.hound.hp + 1),
    "setEnemyHp(id, 121)",
  );
  await captureStill(h, "refused");

  const after = mustEnemy(await h.snapshot(), hound.id);
  assertEqual(after.hp, hound.hp, "the hound's hp after the refused call");
});
