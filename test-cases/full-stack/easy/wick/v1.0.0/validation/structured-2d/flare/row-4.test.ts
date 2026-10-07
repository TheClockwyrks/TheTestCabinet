// flare/row-4 — FLARE_LEVELS row 4 is in force at level 4.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Flare") gives the row
// for level 4: damage 150, cooldown 50, radius 640. "Every level
// table has `MAX_WEAPON_LEVEL` (`8`) rows; row `i` is level `i + 1`." The
// same file fixes what each column becomes with no passive held
// (`specs/passives.md` makes every multiplier `1` at level 0):
//   - "Damage: table value × `damageMul`" and "Width, Height, Radius, Orbit,
//     Area: table value × `areaMul`" (Derived stats), and a burst's `radius`
//     "is its Flare `radius`" (`specs/state.md`, `ZoneState`), so the burst
//     zone reads radius 640 and damage 150;
//   - "every enemy within `radius` of the player's center takes `damage` on
//     that tick" (Flare) and "A hit removes the shape's damage per hit from
//     the enemy's `hp`" (Hits and death), so an owl inside the burst loses
//     150;
//   - "After firing, the timer is set to the weapon's current cooldown", "the
//     table cooldown times `cooldownMul`, floored at `MIN_COOLDOWN` (`0.2`)"
//     (Cooldown timers), so the timer reads 50 after the firing.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with one owl `INSIDE`
// units from the lamplighter, inside the row's radius, Flare held at level
// 4 with its timer at 0, `weaponFire` on and every other switch off, so the
// first tick fires once and no passive scales a figure. An owl's 2000 hp
// (`specs/enemies.md`, which spawns each elite "with exactly the HP in its
// row") outlasts every row's damage, so the removal reads exactly.
// `enemyContact` and `enemyMotion` are off, so nothing but the burst touches
// it, and `spawning` and `events` are off, so no other enemy arrives.
//
// THE TOLERANCE. `REAL_EPS` on the radius, the damage, the hp, and the timer,
// each a table value times a multiplier of `1` or a value set outright; the
// nearest other row differs by at least 50 damage or 5 s of cooldown, far
// outside the bound.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { FLARE_LEVELS, REAL_EPS, cooldownOf } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";
import { armFlare, hpOf, INSIDE, theBurst } from "./burst";

/** The row under test. */
const LEVEL = 4;
const ROW = FLARE_LEVELS[LEVEL - 1];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads radius 640 and damage 150, removes 150 from an owl, and sets the timer to 50 at level 4", async () => {
  isolate(h);
  const owl = placeEnemyNear(h, "owl", INSIDE, 0);
  const slot = armFlare(h, LEVEL);
  const before = hpOf(h.snapshot(), owl);

  const fired = await advanceTicks(h, 1);
  captureStill(h, "row");

  const burst = theBurst(fired);
  assertNear(
    burst.radius,
    ROW.radius,
    REAL_EPS,
    `the burst's radius at level ${LEVEL}`,
  );
  assertNear(
    burst.damage,
    ROW.damage,
    REAL_EPS,
    `the burst's damage at level ${LEVEL}`,
  );
  assertNear(
    hpOf(fired, owl),
    before - ROW.damage,
    REAL_EPS,
    `the owl's hp after the burst at level ${LEVEL}, ${ROW.damage} below ${before}`,
  );
  assertNear(
    fired.run.weapons[slot].cooldown,
    cooldownOf(ROW.cooldown, 0),
    REAL_EPS,
    `Flare's timer after the firing at level ${LEVEL}, against row ${LEVEL}'s cooldown with no Oil held`,
  );
});
