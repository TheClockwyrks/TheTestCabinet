// Wick — instrumentation/set-enemy-position: `setEnemyPosition(id, -400, 50)`
// reads back that enemy at (−400, 50) with its heading, age, and hp
// untouched.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setEnemyPosition(id, x, y)`: "Moves enemy `id` to `(x, y)`; its heading,
// age, and health are untouched."
//
// THE POSE. An isolated run with a moth at (200, 0), its age and hp posed off
// their spawn values so a pose that reset them is caught, the call, read at
// the call: the entry after is the entry before with `x` and `y` replaced.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertDefined } from "../assert";
import {
  captureStill,
  createHarness,
  enemyById,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";

const NEW_X = -400;
const NEW_Y = 50;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves the enemy and leaves its heading, age, and hp", async () => {
  isolate(h);
  const id = placeEnemy(h, "moth", 200, 0);
  h.debug.setEnemyAge(id, 0.25);
  h.debug.setEnemyHp(id, 3);
  const before = enemyById(h.snapshot(), id);
  assertDefined(before, "the moth before the pose");

  h.debug.setEnemyPosition(id, NEW_X, NEW_Y);
  const after = enemyById(h.snapshot(), id);
  await h.frameDraw();
  captureStill(h, "moved");
  assertDefined(after, "the moth after the pose");
  assertDeepEqual(
    after,
    { ...before, x: NEW_X, y: NEW_Y },
    "the moth after setEnemyPosition, against before",
  );
});
