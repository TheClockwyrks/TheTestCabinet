// Wick — instrumentation/spawn-enemy-heading-at-center: a gnat spawned exactly
// at the lamplighter's center while facing left carries the heading `(-1, 0)`.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `spawnEnemy(type, x, y)`): its heading is "the unit vector toward the
// lamplighter's center, or the facing direction when the two coincide".
// specs/weapons.md: "The facing direction is `facing` ... `-x` for `"left"`."
//
// WHY THE WORLD IS POSED AS IT IS. Facing is posed to `left` first, so a build
// that fell back to `+x`, or to a zero or undefined vector, reads differently
// from the one heading the rule fixes.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  facingVector,
  isolate,
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

it("takes the facing direction for a spawn at the lamplighter's center", async () => {
  await isolate(h);
  await h.debug.setFacing("left");
  const posed = await h.snapshot();
  assertEqual(posed.run.player.facing, "left", "facing before the spawn");

  const gnat = await placeEnemy(h, "gnat", posed.run.player.x, posed.run.player.y);
  await captureStill(h, "centered");
  assertDeepEqual(gnat.heading, facingVector("left"), "the coincident spawn's heading");
});
