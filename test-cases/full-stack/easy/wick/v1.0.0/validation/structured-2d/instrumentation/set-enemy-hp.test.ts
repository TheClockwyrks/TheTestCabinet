// Wick — instrumentation/set-enemy-hp: on a hound with `maxHp` 120,
// `setEnemyHp(id, 30)` reads back hp 30 with `maxHp` still 120.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setEnemyHp(id, hp)`: "Sets enemy `id`'s `hp` to `hp`, a real number above
// `0` and at most its `maxHp`". `specs/enemies.md`: a hound's row is 120 hp,
// unscaled at tick 0 (`hpMul(0)` is 1).
//
// THE POSE. An isolated run at tick 0, a hound at (300, 0), the call, read at
// the call.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual } from "../assert";
import { ENEMIES } from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";

const POSED_HP = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("poses hp and leaves maxHp", async () => {
  isolate(h);
  const id = placeEnemy(h, "hound", 300, 0);
  h.debug.setEnemyHp(id, POSED_HP);
  const hound = enemyById(h.snapshot(), id);
  await h.frameDraw();
  captureStill(h, "posed");

  assertDefined(hound, "the hound");
  assertEqual(hound?.hp, POSED_HP, "the hound's hp after setEnemyHp(id, 30)");
  assertEqual(
    hound?.maxHp,
    ENEMIES.hound.hp,
    "the hound's maxHp after the pose",
  );
});
