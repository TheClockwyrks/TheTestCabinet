// Wick — evolutions/hail-row: `HAIL_STATS` is in force.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Hail"), the fixed row `HAIL_STATS`: damage `15`,
//     cooldown `0.5`, speed `700`, radius `7`, pierce `3`, duration `1.5`,
//     amount `6`.
//   - `specs/evolutions.md` ("Hail"): "Hail is Pin's dart: a circle of `radius`
//     fired horizontally in the facing direction at `speed`, removed after
//     `duration` seconds, with the row's `pierce`, fired whether or not any
//     enemy exists. Amount `n` darts fire on the same tick".
//   - `specs/evolutions.md` ("Passives still apply"): damage is "the fixed
//     damage times `damageMul`", every radius "the fixed length times
//     `areaMul`", and "Speed, pierce, duration ... are used as written"; with
//     no passive held every multiplier is `1` and `amountBonus` is `0`
//     (`specs/passives.md`).
//   - `specs/weapons.md` ("Projectiles and pierce"): "A projectile's `ttl` is
//     set to its `duration` when it is fired"; `specs/world.md` ("One tick"),
//     phase 6: only a projectile "that existed before this tick" counts its
//     `ttl` down, so a dart reads `1.5` after its firing tick.
//   - `specs/weapons.md` ("Cooldown timers"): "After firing, the timer is set
//     to the weapon's current cooldown", floored at `MIN_COOLDOWN` (`0.2`),
//     which `0.5` clears.
//
// WHAT IS READ. After the firing tick: the count of Hail darts, `6`, each
// carrying radius 7, damage 15, a velocity of length 700, pierce 3, and `ttl`
// 1.5; and Hail's timer, 0.5. Every figure of the row is asserted, so a build
// whose fixed row departs from the specification in any column fails.
//
// WHY THE NIGHT IS POSED AS IT IS. Hail alone, no passive held, nothing on the
// field, every driver switch but `weaponFire` off. Hail needs no target, so the
// empty field costs the reading nothing and no enemy can take a dart's pierce
// or remove it before it is read; `effectMotion` off holds each dart at its
// launch velocity, as phase 6 would anyway before its first move.
//
// TOLERANCE. `FIGURE_TOLERANCE` on radius, damage, speed, `ttl`, and the timer,
// each a stated figure read back as a double. None on pierce or the count,
// whole numbers the row states.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, HAIL_STATS } from "../constants";
import {
  captureStill,
  createHarness,
  projectilesOf,
  type Harness,
} from "../harness";
import { armEvolved, assertTimerAfterFiring } from "./evolved";

/** Hail's fixed row. */
const ROW = HAIL_STATS;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("fires 6 darts of radius 7, damage 15, speed 700, pierce 3 and ttl 1.5 and sets the timer to 0.5", async () => {
  const { slot } = armEvolved(h, "hail", { facing: "right" });

  const after = await h.tick(1);
  captureStill(h, "row");

  const darts = projectilesOf(after, "hail");
  assertEqual(darts.length, ROW.amount, "Hail darts after the firing tick");
  for (const dart of darts) {
    const which = `dart ${dart.id}`;
    assertWithin(dart.radius, ROW.radius, FIGURE_TOLERANCE, `${which}: radius`);
    assertWithin(dart.damage, ROW.damage, FIGURE_TOLERANCE, `${which}: damage`);
    assertWithin(
      Math.hypot(dart.vx, dart.vy),
      ROW.speed,
      FIGURE_TOLERANCE,
      `${which}: speed, the length of its velocity`,
    );
    assertEqual(dart.pierce, ROW.pierce, `${which}: pierce`);
    assertWithin(
      dart.ttl,
      ROW.duration,
      FIGURE_TOLERANCE,
      `${which}: ttl on the tick it was fired`,
    );
  }
  assertTimerAfterFiring(
    after,
    slot,
    ROW.cooldown,
    "Hail's timer after the firing tick",
  );
});
