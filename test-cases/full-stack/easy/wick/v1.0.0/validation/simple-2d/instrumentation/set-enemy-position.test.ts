// instrumentation/set-enemy-position — `setEnemyPosition(id, -400, 50)` reads
// back that enemy at (−400, 50) with its heading, age, and hp untouched.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setEnemyPosition`:
// "Moves enemy `id` to `(x, y)`; its heading, age, and health are untouched".
//
// THE POSE. An isolated run, a moth spawned with a posed age and health so
// each has a value a careless move would lose, the move, and the entry
// compared field for field with `x` and `y` alone changed.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertDefined } from "../assert";
import {
  captureStill,
  createHarness,
  enemyById,
  isolate,
  spawnEnemyAt,
  type Harness,
} from "../harness";

const MOVED_TO = { x: -400, y: 50 };
const POSED_AGE = 1.25;
const POSED_HP = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the enemy and nothing else about it", async () => {
  isolate(h);
  const id = spawnEnemyAt(h, "moth", 200, 100);
  h.debug.setEnemyAge(id, POSED_AGE);
  h.debug.setEnemyHp(id, POSED_HP);
  const before = enemyById(h.snapshot(), id);
  assertDefined(before, "the moth before the move");

  h.debug.setEnemyPosition(id, MOVED_TO.x, MOVED_TO.y);
  const after = enemyById(h.snapshot(), id);
  await h.tick(1);
  captureStill(h, "moved");

  assertDeepEqual(after, { ...before, ...MOVED_TO }, "the moth after the move");
});
