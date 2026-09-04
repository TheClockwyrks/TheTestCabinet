// Wick — instrumentation/spawn-enemy-heading-at-center: a gnat spawned exactly
// at the lamplighter's center while facing left carries the heading (−1, 0).
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `spawnEnemy(type, x, y)`: "the unit vector toward the lamplighter's center,
// or the facing direction when the two coincide"; `specs/weapons.md`: "The
// facing direction is ... `−x` for `"left"`".
//
// THE POSE. An isolated run, `setFacing("left")`, the spawn at (0, 0), read at
// the call. Exact: a unit axis.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  enemyById,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("takes the facing direction for a coincident spawn", async () => {
  isolate(h);
  h.debug.setFacing("left");
  const id = placeEnemyNear(h, "gnat", 0, 0);
  const gnat = enemyById(h.snapshot(), id);
  await h.frameDraw();
  captureStill(h, "centered");

  assertDefined(gnat, "the spawned gnat");
  if (gnat === undefined) return;
  assertEqual(gnat.x, 0, "its x, the lamplighter's");
  assertEqual(gnat.y, 0, "its y, the lamplighter's");
  assertEqual(
    gnat.heading.x,
    -1,
    "heading.x of a coincident spawn facing left",
  );
  assertEqual(gnat.heading.y, 0, "heading.y of a coincident spawn facing left");
});
