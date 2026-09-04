// passives/duration-fixed-on-projectiles — a projectile's duration is what its
// table gives, at every passive level. A zone's duration is
// `passives/duration-fixed-on-zones`'.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md`, What passives leave as
// written: "Projectile `speed` and `duration` are used as written for every
// weapon, at every passive level, so a bolt travels the same distance and a
// lantern, puddle, shard, or sconce lasts the same time whatever the passives
// held." `specs/weapons.md` (Derived stats) tabulates the same: "Speed,
// Pierce, Duration | table value, unchanged". Ember's level-1 row gives
// `duration` `2.0` and Oil Splash's gives `2.5`, and each shape carries that
// duration as its `ttl` on the tick it is created: "A projectile's `ttl` is
// set to its `duration` when it is fired" (`specs/weapons.md`, Projectiles and
// pierce), and a puddle "stays where it landed for `duration` seconds"
// (Oil Splash).
//
// WHY THE TICK IT IS CREATED ON IS THE ONE READ. `specs/world.md`, phase 6:
// "Every projectile and zone that existed before this tick counts its `ttl`
// down", and a shape the tick created did not exist before it, so `ttl` reads
// the whole duration.
//
// WHY FOUR PASSIVES ARE HELD. The four whose terms reach a weapon's figures at
// all, each at a level far from `1`, so a build that fed any of them into
// `duration` reports a `ttl` well away from the written figure.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding those four, Ember
// at level 1, and Oil Splash at level 1, with one hound at `FAR_POST` for
// Ember to aim at; Oil Splash "fires whether or not any enemy exists".
// `effectMotion` stays off and every other switch but `weaponFire` stays off,
// so the tick creates the shapes and nothing else.
//
// THE TOLERANCE. `REAL_EPS` on each `ttl`, a table figure set outright.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { EMBER_LEVELS, REAL_EPS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { FAR_POST, fireUnder, SCALERS } from "./firing";

/** The level-1 row whose `duration` is read. */
const BOLT = EMBER_LEVELS[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves a level-1 Ember bolt at ttl 2.0 under Glass 5, Oil 5, Wick 5, and Mirror 2", async () => {
  const firing = await fireUnder(h, {
    passives: SCALERS,
    weapons: [["ember", 1]],
    enemies: [["hound", FAR_POST]],
  });
  captureStill(h, "duration");

  const bolts = firing.projectiles.filter((p) => p.weapon === "ember");
  assertEqual(
    bolts.length,
    1,
    "the bolts the firing tick created with one enemy alive (specs/weapons.md, Ember)",
  );
  assertNear(
    bolts[0].ttl,
    BOLT.duration,
    REAL_EPS,
    "the bolt's ttl on the tick it was fired (specs/passives.md, What passives leave as written)",
  );
});
