// passives/duration-fixed-on-zones — a zone's duration is what its table gives,
// at every passive level. A projectile's duration is
// `passives/duration-fixed-on-projectiles`'.
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
import { assertGreaterThanOrEqual, assertNear } from "../assert";
import { OIL_SPLASH_LEVELS, REAL_EPS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { fireUnder, SCALERS } from "./firing";

/** The level-1 row whose `duration` is read. */
const PUDDLE = OIL_SPLASH_LEVELS[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves a level-1 Oil Splash puddle at ttl 2.5 under Glass 5, Oil 5, Wick 5, and Mirror 2", async () => {
  const firing = await fireUnder(h, {
    passives: SCALERS,
    weapons: [["oil-splash", 1]],
  });
  captureStill(h, "duration");

  const puddles = firing.zones.filter((zone) => zone.kind === "puddle");
  assertGreaterThanOrEqual(
    puddles.length,
    PUDDLE.amount,
    "the puddles the firing tick created, the row's own amount at least (specs/weapons.md, Oil Splash)",
  );
  puddles.forEach((puddle, i) => {
    assertNear(
      puddle.ttl ?? NaN,
      PUDDLE.duration,
      REAL_EPS,
      `puddle ${i}: ttl on the tick it landed (specs/passives.md, What passives leave as written)`,
    );
  });
});
