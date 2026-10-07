// Wick — weapons/aim-falls-back-to-facing: aiming at a coincident enemy uses the
// facing direction.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("The nearest enemy"): "A
// direction toward an enemy is the unit vector from the player's center to the
// enemy's center, and when the two centers coincide the facing direction is
// used instead. The facing direction is `facing` from `specs/world.md`: `+x`
// for `"right"` and `-x` for `"left"`." So with the only enemy exactly at the
// lamplighter's center and `facing` `"left"`, an Ember bolt's velocity is along
// `−x`.
//
// THE POSE. `setFacing("left")`, then one hound spawned at the lamplighter's
// center `(0, 0)`. A bolt is created at the player's center and "a new one
// hitting at the position it was created at" (`specs/world.md`, phase 6), so
// it overlaps the hound on its own tick and hits it; Ember is held at level 5,
// whose row carries pierce `1`, so the bolt survives that hit with pierce `0`
// and its velocity is in the snapshot. The hound's `120` hp survives the row's
// `15` damage, so nothing dies and nothing drops. Level 5's amount of `2`
// fires "fewer when fewer enemies exist", so one bolt is created.
// `effectMotion` is held so the velocity is read exactly as the firing set it.
//
// TOLERANCE. `FLOAT_TOL` on the components of the bolt's unit direction; the
// facing direction is exact, and the wrong facing is two units away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertTrue } from "../assert";
import { FLOAT_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  facingVector,
  fireWeapon,
  isolate,
  placeEnemy,
  unitToward,
  type Harness,
} from "../harness";

/** The Ember level whose row carries pierce `1`, so the bolt outlives its first hit. */
const EMBER_LEVEL = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fires an Ember bolt along −x at an enemy on the lamplighter's center, facing left", async () => {
  await isolate(h);
  await h.debug.setFacing("left");
  const at = (await h.snapshot()).run.player;
  assertEqual(at.facing, "left", "the facing posed");
  await placeEnemy(h, "hound", at.x, at.y);

  const fired = await fireWeapon(h, "ember", EMBER_LEVEL);
  await captureStill(h, "facing");

  assertEqual(
    fired.projectiles.length,
    1,
    "Ember bolts the firing tick created with one enemy alive",
  );
  const bolt = fired.projectiles[0]!;
  const heading = unitToward({ x: 0, y: 0 }, { x: bolt.vx, y: bolt.vy });
  assertTrue(heading !== null, "a bolt with a non-zero velocity");
  const wanted = facingVector("left");
  assertNear(heading!.x, wanted.x, FLOAT_TOL, "the bolt's direction, x");
  assertNear(heading!.y, wanted.y, FLOAT_TOL, "the bolt's direction, y");
});
