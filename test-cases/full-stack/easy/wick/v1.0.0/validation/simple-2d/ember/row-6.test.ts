// Wick — ember/row-6: row 6 of EMBER_LEVELS is in force at level 6.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Ember"), the level table: row 6 is damage `15`,
//     cooldown `1.00`, speed `400`, radius `8`, pierce `1`,
//     duration `2.0`, amount `3`; "Every level table has `MAX_WEAPON_LEVEL`
//     (`8`) rows; row `i` is level `i + 1`".
//   - `specs/weapons.md` ("Ember"): "A bolt is a circle of `radius`, fired
//     from the player's center at `speed` in the direction of the nearest
//     enemy's center ... removed after `duration` seconds. Its pierce is the
//     table `pierce`", and "With amount `n`, `n` bolts fire on the same
//     tick, one at each of the `n` nearest distinct enemies".
//   - `specs/weapons.md` ("Derived stats"): damage is "table value ×
//     `damageMul`", radius "table value × `areaMul`", amount "table value +
//     `amountBonus`", and speed, pierce, and duration "table value,
//     unchanged"; with no passive held every multiplier is `1` and the bonus
//     `0` (`specs/passives.md`).
//   - `specs/weapons.md` ("Projectiles and pierce"): "A projectile's `ttl`
//     is set to its `duration` when it is fired"; `specs/world.md` ("One
//     tick"), phase 6: only a projectile "that existed before this tick"
//     counts its `ttl` down, so the new bolt reads `2.0` after the firing
//     tick.
//   - `specs/weapons.md` ("Cooldown timers"): "After firing, the timer is
//     set to the weapon's current cooldown", the table cooldown times
//     `cooldownMul` floored at `MIN_COOLDOWN`, so the timer reads `1.00`
//     after the firing tick. `specs/world.md` ("One tick"), phase 5: the
//     timer counts down and the due weapon fires within the same tick, so
//     the reading after that tick is the freshly set figure.
//
// WHAT IS READ. After the firing tick with three moths alive to aim at: the
// count of Ember bolts, `3`, each carrying radius `8`, damage `15`, a
// velocity of length `400`, pierce `1`, and `ttl` `2.0`; and Ember's timer,
// `1.00`. Every figure of the row is asserted, so a build whose table
// departs from the specification in any column at this level fails.
//
// WHY THE NIGHT IS POSED AS IT IS. Three moths and Ember alone at level 6, every
// switch off but `weaponFire`. The moths are as many as the row's amount, so
// the count read is the row's own and not a shortfall of targets. `enemyMotion`
// off holds them at least `150` units out, so no bolt created at the center
// overlaps one on the firing tick and every bolt is still in `projectiles`
// to read; `effectMotion` off holds each bolt at its launch velocity.
//
// TOLERANCE. `FIGURE_TOLERANCE` on radius, damage, speed, `ttl`, and the
// timer, each a stated figure or a product of stated figures read back as a
// double. None on pierce or the count, whole numbers the row states.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  projectilesOf,
  type Harness,
} from "../harness";
import {
  armEmber,
  assertBoltOfRow,
  assertTimerOfRow,
  emberRow,
  targetsFor,
} from "./volley";

/** The level this point holds Ember at. */
const LEVEL = 6;

/** Row 6 of EMBER_LEVELS, as `constants.ts` restates it from the spec. */
const ROW = emberRow(LEVEL);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("fires 3 bolts of row 6 at level 6 and sets the timer to 1.00", async () => {
  assertEqual(ROW.amount, 3, "the level-6 row's amount");
  const volley = armEmber(h, LEVEL, targetsFor(ROW.amount));

  const after = await h.tick(1);
  captureStill(h, "row");

  const bolts = projectilesOf(after, "ember");
  assertEqual(bolts.length, ROW.amount, "Ember bolts after the firing tick");
  for (const bolt of bolts) assertBoltOfRow(bolt, ROW, `bolt ${bolt.id}`);
  assertTimerOfRow(after, volley.slot, ROW);
});
