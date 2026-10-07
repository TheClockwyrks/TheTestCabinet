// instrumentation/set-enemy-hp — on a hound with maxHp 120,
// `setEnemyHp(id, 30)` reads back hp 30 with maxHp still 120.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setEnemyHp`: "Sets
// enemy `id`'s `hp` to `hp`, a real number above `0` and at most its `maxHp`".
// specs/enemies.md: the hound's row hp is 120, unscaled at tick 0 since
// hpMul(0) is 1, and `maxHp` "is set once, at spawn".
//
// THE POSE. An isolated run at tick 0, a hound, the pose, the read back.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ENEMIES } from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  isolate,
  spawnEnemyAt,
  type Harness,
} from "../harness";

const POSED_HP = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets hp and leaves maxHp", async () => {
  isolate(h);
  const id = spawnEnemyAt(h, "hound", 300, 0);
  assertEqual(
    enemyById(h.snapshot(), id)?.maxHp,
    ENEMIES.hound.hp,
    "the hound's maxHp",
  );

  h.debug.setEnemyHp(id, POSED_HP);
  const hound = enemyById(h.snapshot(), id);
  await h.tick(1);
  captureStill(h, "posed");

  assertEqual(hound?.hp, POSED_HP, "hp read back");
  assertEqual(hound?.maxHp, ENEMIES.hound.hp, "maxHp across the pose");
});
