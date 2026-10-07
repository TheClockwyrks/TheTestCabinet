// halo/row-6 — HALO_LEVELS row 6 is in force at level 6.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Halo") gives the
// row for level 6: damage 5, cooldown 0.80, radius 110. "Every level table
// has `MAX_WEAPON_LEVEL` (`8`) rows; row `i` is level `i + 1`." The same
// file fixes what each column becomes with no passive held
// (`specs/passives.md` makes every multiplier `1` at level 0):
//   - "Damage: table value × `damageMul`" and "Width, Height, Radius, Orbit,
//     Area: table value × `areaMul`" (Derived stats), recomputed for the aura
//     "on every tick from the level, `areaMul`, and `damageMul` in force on
//     that tick" (Halo), so the aura zone reads radius 110 and damage 5;
//   - on a pulse "every enemy whose circle overlaps the aura takes `damage`"
//     (Halo) and "A hit removes the shape's damage per hit from the enemy's
//     `hp`" (Hits and death), so a hound inside the aura loses 5;
//   - "the timer is set to the current cooldown" (Halo), "the table cooldown
//     times `cooldownMul`, floored at `MIN_COOLDOWN` (`0.2`)" (Cooldown
//     timers), so the timer reads 0.80 after the pulse.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with one hound `INSIDE`
// units from the lamplighter, inside the row's radius, Halo held at level 6
// with its timer at 0, `weaponFire` on and every other switch off, so the
// first tick places the aura and pulses once and no passive scales a figure.
// A hound's 120 hp (`specs/enemies.md`) outlasts every row's damage, so the
// removal reads exactly. `enemyContact` and `enemyMotion` are off, so
// nothing but the pulse touches it.
//
// THE TOLERANCE. `REAL_EPS` on the radius, the damage, the hp, and the
// timer, each a table value times a multiplier of `1` or a value set
// outright; the nearest rows differ by at least 1 damage, 0.1 s, or 10
// radius, far outside the bound.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { HALO_LEVELS, REAL_EPS, cooldownOf } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";
import { armHalo, hpOf, INSIDE, theAura } from "./aura";

/** The row under test. */
const LEVEL = 6;
const ROW = HALO_LEVELS[LEVEL - 1];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads radius 110 and damage 5, removes 5 from a hound, and sets the timer to 0.80 at level 6", async () => {
  isolate(h);
  const hound = placeEnemyNear(h, "hound", INSIDE, 0);
  const slot = armHalo(h, LEVEL);
  const before = hpOf(h.snapshot(), hound);

  const pulsed = await advanceTicks(h, 1);
  captureStill(h, "row");

  const aura = theAura(pulsed);
  assertNear(
    aura.radius,
    ROW.radius,
    REAL_EPS,
    `the aura's radius at level ${LEVEL}`,
  );
  assertNear(
    aura.damage,
    ROW.damage,
    REAL_EPS,
    `the aura's damage at level ${LEVEL}`,
  );
  assertNear(
    hpOf(pulsed, hound),
    before - ROW.damage,
    REAL_EPS,
    `the hound's hp after the pulse at level ${LEVEL}, ${ROW.damage} below ${before}`,
  );
  assertNear(
    pulsed.run.weapons[slot].cooldown,
    cooldownOf(ROW.cooldown, 0),
    REAL_EPS,
    `Halo's timer after the pulse at level ${LEVEL}, against row ${LEVEL}'s cooldown with no Oil held`,
  );
});
