// passives/speed-fixed — a projectile's speed is what its table gives, at
// every passive level.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md`, What passives leave as
// written: "Every figure a passive does not name above is used exactly as its
// table or constant states it. Projectile `speed` and `duration` are used as
// written for every weapon, at every passive level". `specs/weapons.md`
// (Derived stats) tabulates the same: "Speed, Pierce, Duration | table value,
// unchanged". Ember's level-1 row gives `speed` `400`, and the bolt is "fired
// from the player's center at `speed`" (`specs/weapons.md`, Ember), so the
// magnitude of its velocity is exactly `400` units per second.
//
// WHY FOUR PASSIVES ARE HELD. The four whose terms reach a weapon's figures at
// all: Glass 5 (`areaMul` `1.5`), Oil 5 (`cooldownMul` `0.6`), Wick 5
// (`damageMul` `1.5`), and Mirror 2 (`amountBonus` `2`), each at a level far
// from `1`, so a build that fed any of them into `speed` reports a magnitude
// well away from `400`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding those four and
// Ember at level 1, with one hound at `FAR_POST`, the enemy Ember "needs at
// least one enemy to fire" at. One enemy makes one bolt whatever the amount:
// "one at each of the `n` nearest distinct enemies, fewer when fewer enemies
// exist". `effectMotion` stays off, so the velocity read is the one the firing
// gave it, before any integration; every other switch but `weaponFire` stays
// off.
//
// THE TOLERANCE. `MOTION_EPS` on the magnitude, the length of a unit vector
// scaled by `400`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { EMBER_LEVELS, MOTION_EPS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { FAR_POST, fireUnder, SCALERS } from "./firing";

/** Ember's level-1 row, whose `speed` is `400`. */
const ROW = EMBER_LEVELS[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves a level-1 Ember bolt at 400 units per second under Glass 5, Oil 5, Wick 5, and Mirror 2", async () => {
  const firing = await fireUnder(h, {
    passives: SCALERS,
    weapons: [["ember", 1]],
    enemies: [["hound", FAR_POST]],
  });
  captureStill(h, "speed");

  const bolts = firing.projectiles.filter((p) => p.weapon === "ember");
  assertEqual(
    bolts.length,
    1,
    "the bolts the firing tick created with one enemy alive (specs/weapons.md, Ember)",
  );
  assertNear(
    Math.hypot(bolts[0].vx, bolts[0].vy),
    ROW.speed,
    MOTION_EPS,
    "the bolt's speed, the magnitude of its velocity (specs/passives.md, What passives leave as written)",
  );
});
