// Wick — spark/row-5: row 5 of SPARK_LEVELS is in force at level 5.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Spark"), the level table: row 5 is damage `25`,
//     cooldown `1.8`, area `50`, amount `3`; "Every level table has
//     `MAX_WEAPON_LEVEL` (`8`) rows; row `i` is level `i + 1`".
//   - `specs/weapons.md` ("Spark"): "On firing, `amount` strikes land, each on
//     a distinct enemy chosen uniformly at random among the live enemies
//     within `SPARK_RANGE` (`600`) of the player's center", and "A strike
//     deals `damage` to its target and to every other enemy within `area` of
//     the target's center, on the tick it lands".
//   - `specs/weapons.md` ("Shapes and overlap"): "a strike's `radius` is its
//     `area`"; `specs/state.md` (`ZoneState`): a strike's `x`, `y` is "the
//     center of the circle" and `damage` "its damage per hit".
//   - `specs/weapons.md` ("Derived stats"): damage is "table value ×
//     `damageMul`", area "table value × `areaMul`", amount "table value +
//     `amountBonus`", and cooldown "table value × `cooldownMul`, floored at
//     `MIN_COOLDOWN`"; with no passive held every multiplier is `1` and the
//     bonus `0` (`specs/passives.md`).
//   - `specs/weapons.md` ("Hits and death"): "A hit removes the shape's damage
//     per hit from the enemy's `hp`", a real number; a hound has HP `120`
//     (`specs/enemies.md`), so it stands after the strike with its hp lower
//     by exactly `25`.
//   - `specs/weapons.md` ("Cooldown timers"): "After firing, the timer is
//     set to the weapon's current cooldown", so the timer reads `1.8`
//     after the firing tick. `specs/world.md` ("One tick"), phase 5: the
//     timer counts down and the due weapon fires within the same tick, so
//     the reading after that tick is the freshly set figure.
//
// WHAT IS READ. After the firing tick with 3 hounds within range: the
// count of Spark strikes, `3`; on each hound exactly one strike centered
// on its posed center, carrying radius `50` and damage `25`; each hound's
// hp lower by `25`; and Spark's timer, `1.8`. Every figure of the row is
// asserted, so a build whose table departs from the specification in any
// column at this level fails.
//
// WHY THE NIGHT IS POSED AS IT IS. 3 hounds and Spark alone at level 5, every
// switch off but `weaponFire`. The hounds are as many as the row's amount and
// every one is within `SPARK_RANGE`, so the count read is the row's own and the
// random choice has one outcome: every hound struck once. No two stand within
// `70` of each other, beyond any row's area, so each hound's hp after the tick
// is its own strike's doing alone. `enemyMotion` off holds them where they are
// posed, the centers the strikes are matched against.
//
// TOLERANCE. `FIGURE_TOLERANCE` on radius, damage, the hp removed, a strike's
// center, and the timer, each a stated figure or a product of stated figures
// read back as a double. None on the count, a whole number the row states.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  DURABLE,
  armSpark,
  assertTimerOfRow,
  assertVolleyOfRow,
  sparkRow,
  targetsFor,
} from "./strike";

/** The level this point holds Spark at. */
const LEVEL = 5;

/** Row 5 of SPARK_LEVELS, as `constants.ts` restates it from the spec. */
const ROW = sparkRow(LEVEL);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lands 3 strikes of row 5 at level 5 and sets the timer to 1.8", async () => {
  assertEqual(ROW.amount, 3, "the level-5 row's amount");
  const volley = armSpark(h, LEVEL, targetsFor(ROW.amount), DURABLE);

  const after = await h.tick(1);
  captureStill(h, "row");

  assertVolleyOfRow(volley, after, ROW);
  assertTimerOfRow(after, volley.slot, ROW);
});
