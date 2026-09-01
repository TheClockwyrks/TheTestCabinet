// Wick — instrumentation/set-enemy-hp: on a hound with `maxHp` 120,
// `setEnemyHp(id, 30)` reads back `hp` 30 with `maxHp` still 120.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `setEnemyHp(id, hp)`): "Sets enemy `id`'s `hp` to `hp`, a real number above
// `0` and at most its `maxHp`". specs/enemies.md gives a hound 120 HP, spawned
// unscaled at tick 0 since `hpMul(0)` is 1.
//
// WHY THE WORLD IS POSED AS IT IS. A hound at the run's start, so `maxHp` is
// the table figure; the posed `hp` is a quarter of it, so a build that scaled
// or capped the figure reads differently.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ENEMIES } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  mustEnemy,
  placeEnemy,
  type Harness,
} from "../harness";

const POSED_HP = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("poses an enemy's health, leaving its maximum", async () => {
  await isolate(h);
  const hound = await placeEnemy(h, "hound", 300, 0);
  assertEqual(hound.maxHp, ENEMIES.hound.hp, "the hound's maxHp at tick 0");

  await h.debug.setEnemyHp(hound.id, POSED_HP);
  const after = mustEnemy(await h.snapshot(), hound.id);
  await captureStill(h, "posed");
  assertEqual(after.hp, POSED_HP, "the hound's hp after the pose");
  assertEqual(after.maxHp, ENEMIES.hound.hp, "the hound's maxHp across the pose");
});
