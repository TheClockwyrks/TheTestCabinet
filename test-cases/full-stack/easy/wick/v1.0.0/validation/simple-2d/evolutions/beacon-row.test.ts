// Wick — evolutions/beacon-row: `BEACON_STATS` is in force.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Beacon"), the fixed row `BEACON_STATS`: damage
//     `20`, cooldown `0.25`, speed `500`, radius `10`, pierce `2`, duration
//     `2.0`, amount `1`.
//   - `specs/evolutions.md` ("Beacon"): "Beacon is Ember's bolt: a circle of
//     `radius` fired from the player's center at `speed` toward the nearest
//     enemy on the tick of firing, flying straight and removed after `duration`
//     seconds, with the row's `pierce`. With amount `n`, `n` bolts fire on the
//     same tick ... and Beacon needs at least one enemy to fire."
//   - `specs/evolutions.md` ("Passives still apply"): damage is "the fixed
//     damage times `damageMul`", every radius "the fixed length times
//     `areaMul`", and "Speed, pierce, duration ... are used as written"; with
//     no passive held every multiplier is `1` (`specs/passives.md`).
//   - `specs/weapons.md` ("Projectiles and pierce"): "A projectile's `ttl` is
//     set to its `duration` when it is fired"; `specs/world.md` ("One tick"),
//     phase 6: only a projectile "that existed before this tick" counts its
//     `ttl` down, so the new bolt reads `2.0` after the firing tick.
//   - `specs/weapons.md` ("Cooldown timers"): "After firing, the timer is set
//     to the weapon's current cooldown", floored at `MIN_COOLDOWN` (`0.2`),
//     which `0.25` clears.
//   - `specs/instrumentation.md`: "`setWeaponCooldown(slot, 0)` makes that the
//     next tick" the weapon fires on.
//
// WHAT IS READ. After the firing tick with one moth alive to aim at: the count
// of Beacon bolts, `1`, carrying radius 10, damage 20, a velocity of length
// 500, pierce 2, and `ttl` 2.0; and Beacon's timer, 0.25. Every figure of the
// row is asserted, so a build whose fixed row departs from the specification in
// any column fails.
//
// WHY THE NIGHT IS POSED AS IT IS. Beacon alone with one moth, no passive held,
// every driver switch but `weaponFire` off. The moth stands 150 units out, and
// a bolt is created at the lamplighter's center "first moving on the next tick"
// (`specs/world.md`, phase 6), so a bolt of radius 10 and a moth of radius 10
// cannot overlap on the firing tick and the bolt is still in `projectiles` to
// read; `enemyMotion` off holds the moth where it was posed.
//
// TOLERANCE. `FIGURE_TOLERANCE` on radius, damage, speed, `ttl`, and the timer,
// each a stated figure or a product of stated figures read back as a double.
// None on pierce or the count, whole numbers the row states.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { BEACON_STATS, FIGURE_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  projectilesOf,
  spawnEnemyNear,
  type Harness,
} from "../harness";
import { armEvolved, assertTimerAfterFiring } from "./evolved";

/** Beacon's fixed row. */
const ROW = BEACON_STATS;

/** The one target: a moth, HP 5 and radius 10, 150 units along +x. */
const PROBE = "moth";
const PROBE_DX = 150;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("fires 1 bolt of radius 10, damage 20, speed 500, pierce 2 and ttl 2.0 and sets the timer to 0.25", async () => {
  const { slot } = armEvolved(h, "beacon");
  spawnEnemyNear(h, PROBE, PROBE_DX, 0);

  const after = await h.tick(1);
  captureStill(h, "row");

  const bolts = projectilesOf(after, "beacon");
  assertEqual(bolts.length, ROW.amount, "Beacon bolts after the firing tick");
  for (const bolt of bolts) {
    const which = `bolt ${bolt.id}`;
    assertWithin(bolt.radius, ROW.radius, FIGURE_TOLERANCE, `${which}: radius`);
    assertWithin(bolt.damage, ROW.damage, FIGURE_TOLERANCE, `${which}: damage`);
    assertWithin(
      Math.hypot(bolt.vx, bolt.vy),
      ROW.speed,
      FIGURE_TOLERANCE,
      `${which}: speed, the length of its velocity`,
    );
    assertEqual(bolt.pierce, ROW.pierce, `${which}: pierce`);
    assertWithin(
      bolt.ttl,
      ROW.duration,
      FIGURE_TOLERANCE,
      `${which}: ttl on the tick it was fired`,
    );
  }
  assertTimerAfterFiring(
    after,
    slot,
    ROW.cooldown,
    "Beacon's timer after the firing tick",
  );
});
