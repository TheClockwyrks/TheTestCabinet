// Wick — instrumentation/set-enemy-hp-rejects-zero: on a hound with `maxHp`
// 120, `setEnemyHp(id, 0)` throws and leaves `hp` as it was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setEnemyHp(id,
// hp)`): "a real number above `0` and at most its `maxHp`; anything else is
// invalid, since death is decided by the tick"; "the call throws rather than
// guessing what was meant". `hp` at `0` is what a killing tick leaves, not
// what a pose may set. The other bound is the sibling point.
//
// WHY THE WORLD IS POSED AS IT IS. The hound is posed alive, so the low end of
// the domain, which the tick alone decides and its `hp` can be read exactly
// across the refused call.

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

it("throws on 0, leaving hp as it was", async () => {
  await isolate(h);
  const hound = await placeEnemy(h, "hound", 300, 0);
  assertEqual(hound.maxHp, ENEMIES.hound.hp, "the hound's maxHp");

  await assertRejects(
    () => h.debug.setEnemyHp(hound.id, 0),
    "setEnemyHp(id, 0)",
  );
  await captureStill(h, "refused");

  const after = mustEnemy(await h.snapshot(), hound.id);
  assertEqual(after.hp, hound.hp, "the hound's hp after the refused call");
});
