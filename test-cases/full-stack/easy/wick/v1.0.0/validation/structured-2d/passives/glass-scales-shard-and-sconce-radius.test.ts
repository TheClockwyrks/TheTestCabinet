// passives/glass-scales-shard-and-sconce-radius — Glass scales a shard's and a
// sconce's radius.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md`, Area, gives the row
// "Shard, Sconce | bolt `radius`" over "The scaled length is the table value
// times `areaMul`, and a projectile's collision radius is a scaled length like
// any other", and `areaMul` is `1 + 0.1 × glass`, so `1.2` at Glass 2. Shard's
// level-1 row gives `radius` `8` and Sconce's gives `12`
// (`specs/weapons.md`), so the shard reads `9.6` and the sconce `14.4`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Glass 2, Shard at
// level 1, and Sconce at level 1, with one hound at `FAR_POST`, the enemy
// Sconce "needs at least one enemy to fire" at; Shard "fires whether or not
// any enemy exists". `effectMotion` stays off, so neither projectile travels,
// neither bounces, and neither reaches the hound nine hundred units away.
// Every other switch but `weaponFire` stays off, so the tick creates the two
// shapes and nothing else.
//
// THE TOLERANCE. `REAL_EPS` on each radius, one table figure times one
// multiplier; the unscaled figures, `8` and `12`, are more than a unit away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { REAL_EPS, SCONCE_LEVELS, SHARD_LEVELS, areaMul } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { FAR_POST, fireUnder } from "./firing";

/** The Glass level held: `areaMul` `1.2`. */
const GLASS = 2;

/** The radius Shard's level-1 `8` becomes under Glass 2: `9.6`. */
const SHARD = SHARD_LEVELS[0].radius * areaMul(GLASS);

/** The radius Sconce's level-1 `12` becomes under Glass 2: `14.4`. */
const SCONCE = SCONCE_LEVELS[0].radius * areaMul(GLASS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("gives a level-1 shard radius 9.6 and a level-1 sconce radius 14.4 under Glass 2", async () => {
  const firing = await fireUnder(h, {
    passives: [["glass", GLASS]],
    weapons: [
      ["shard", 1],
      ["sconce", 1],
    ],
    enemies: [["hound", FAR_POST]],
  });
  captureStill(h, "shard");

  const shards = firing.projectiles.filter((p) => p.weapon === "shard");
  const sconces = firing.projectiles.filter((p) => p.weapon === "sconce");
  assertEqual(
    shards.length,
    SHARD_LEVELS[0].amount,
    "the shards the firing tick created (specs/weapons.md, Shard)",
  );
  assertEqual(
    sconces.length,
    SCONCE_LEVELS[0].amount,
    "the sconces the firing tick launched (specs/weapons.md, Sconce)",
  );
  assertNear(
    shards[0].radius,
    SHARD,
    REAL_EPS,
    "the shard's radius under Glass 2 (specs/passives.md, Area)",
  );
  assertNear(
    sconces[0].radius,
    SCONCE,
    REAL_EPS,
    "the sconce's radius under Glass 2 (specs/passives.md, Area)",
  );
});
