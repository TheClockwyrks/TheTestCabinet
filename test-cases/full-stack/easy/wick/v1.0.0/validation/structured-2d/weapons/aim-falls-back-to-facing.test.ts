// weapons/aim-falls-back-to-facing — aiming at a coincident enemy uses the
// facing direction.
//
// THE SPEC LINE. `specs/weapons.md`, "The nearest enemy": "A direction toward
// an enemy is the unit vector from the player's center to the enemy's center,
// and when the two centers coincide the facing direction is used instead. The
// facing direction is `facing` from `specs/world.md`: `+x` for `"right"` and
// `-x` for `"left"`." So with the only enemy exactly at the lamplighter's
// center and `facing` `"left"`, an Ember bolt's velocity is along `−x`.
//
// THE POSE. `setFacing("left")`, then one hound spawned at the lamplighter's
// center. A bolt is created at the player's center and "a new one hitting at
// the position it was created at" (`specs/world.md`, phase 6), so it overlaps
// the hound on its own tick and hits it; Ember is held at level 5, whose row
// carries pierce `1`, so the bolt survives that hit with pierce `0` and its
// velocity is in the snapshot. The hound's `120` hp survives the row's `15`
// damage, so nothing dies and nothing drops. Level 5's amount of `2` fires
// "fewer when fewer enemies exist", so one bolt is created. `effectMotion` is
// held so the velocity is read exactly as the firing set it.
//
// THE TOLERANCE. `REAL_EPS` on the distance between the bolt's unit direction
// and `(−1, 0)`; the facing direction is exact, and the wrong facing is two
// units away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { EMBER_LEVELS, REAL_EPS } from "../constants";
import {
  advanceTicks,
  armWeapon,
  captureStill,
  createHarness,
  distance,
  holdWeapon,
  isolate,
  placeEnemy,
  projectilesCreatedSince,
  unit,
  type Harness,
} from "../harness";

/** The Ember level whose row carries pierce `1`, so the bolt outlives its first hit. */
const EMBER_LEVEL = 5;

/** The facing direction for `"left"`: `−x`. */
const LEFT = { x: -1, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("fires an Ember bolt along −x at an enemy on the lamplighter's center, facing left", async () => {
  if (EMBER_LEVELS[EMBER_LEVEL - 1].pierce < 1) {
    throw new Error("the posed level must carry pierce of at least 1");
  }
  isolate(h);
  h.debug.setFacing("left");
  const at = h.snapshot().run.player;
  assertEqual(
    at.facing,
    "left",
    "the facing posed (specs/instrumentation.md, setFacing)",
  );
  placeEnemy(h, "hound", at.x, at.y);
  const slot = holdWeapon(h, "ember", EMBER_LEVEL);
  armWeapon(h, slot);

  const posed = h.snapshot();
  const fired = await advanceTicks(h, 1);
  captureStill(h, "facing");

  const bolts = projectilesCreatedSince(posed, fired).filter(
    (projectile) => projectile.weapon === "ember",
  );
  assertEqual(
    bolts.length,
    1,
    "Ember bolts the firing tick created with one enemy alive (specs/weapons.md, Ember)",
  );
  const bolt = bolts[0];
  assertNear(
    distance(unit(bolt.vx, bolt.vy), LEFT),
    0,
    REAL_EPS,
    "how far the bolt's direction is from the facing direction −x (specs/weapons.md, The nearest enemy)",
  );
});
