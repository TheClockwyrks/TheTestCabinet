// Wick — instrumentation/set-enemy-position: `setEnemyPosition(id, -400, 50)`
// reads back that enemy at `(-400, 50)` with its heading, age, and hp
// untouched.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `setEnemyPosition(id, x, y)`): "Moves enemy `id` to `(x, y)`; its heading,
// age, and health are untouched."
//
// WHY THE WORLD IS POSED AS IT IS. The moth is given an age and a health that
// are not a fresh spawn's before the move, so "untouched" is told from "reset";
// no tick runs between the pose and the read, so its heading is the spawn's.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNear } from "../assert";
import { POSITION_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  mustEnemy,
  placeEnemy,
  type Harness,
} from "../harness";

const TO = { x: -400, y: 50 };
const POSED_AGE = 1.5;
const POSED_HP = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the enemy and nothing else about it", async () => {
  await isolate(h);
  const moth = await placeEnemy(h, "moth", 200, 100);
  await h.debug.setEnemyAge(moth.id, POSED_AGE);
  await h.debug.setEnemyHp(moth.id, POSED_HP);
  const before = mustEnemy(await h.snapshot(), moth.id);

  await h.debug.setEnemyPosition(moth.id, TO.x, TO.y);
  const after = mustEnemy(await h.snapshot(), moth.id);
  await captureStill(h, "moved");

  assertNear(after.x, TO.x, POSITION_TOL, "the enemy's x after the move");
  assertNear(after.y, TO.y, POSITION_TOL, "the enemy's y after the move");
  assertDeepEqual(
    after.heading,
    before.heading,
    "the enemy's heading across the move",
  );
  assertEqual(after.age, before.age, "the enemy's age across the move");
  assertEqual(after.hp, before.hp, "the enemy's hp across the move");
  assertEqual(after.maxHp, before.maxHp, "the enemy's maxHp across the move");
});
