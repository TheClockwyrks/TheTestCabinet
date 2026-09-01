// Wick — sconce/row-3: row 3 of SCONCE_LEVELS is in force at level 3.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Sconce"), the level table: row 3 is damage
//     `16`, cooldown `2.0`, speed `600`, radius `12`, duration
//     `2.5`, amount `2`; "Every level table has `MAX_WEAPON_LEVEL` (`8`)
//     rows; row `i` is level `i + 1`".
//   - `specs/weapons.md` ("Sconce"): "A sconce is a circle of `radius`,
//     launched from the player's center at `speed` along the launch direction
//     `d` ... Its pierce is `INFINITE_PIERCE` ... and it is removed after
//     `duration` seconds", and "Amount `n` launches `n` sconces on the same
//     tick".
//   - `specs/weapons.md` ("Derived stats"): damage is "table value ×
//     `damageMul`", radius "table value × `areaMul`", amount "table value +
//     `amountBonus`", and speed and duration "table value, unchanged"; with no
//     passive held every multiplier is `1` and the bonus `0`
//     (`specs/passives.md`).
//   - `specs/weapons.md` ("Projectiles and pierce"): "A projectile's `ttl` is
//     set to its `duration` when it is fired"; `specs/world.md` ("One tick"),
//     phase 6: only a projectile "that existed before this tick" counts its
//     `ttl` down, so a new sconce reads `2.5` after the firing tick.
//   - `specs/weapons.md` ("Cooldown timers"): "After firing, the timer is set
//     to the weapon's current cooldown", the table cooldown times
//     `cooldownMul` floored at `MIN_COOLDOWN`, so the timer reads `2.0` after
//     the firing tick. `specs/world.md` ("One tick"), phase 5: the timer
//     counts down and the due weapon fires within the same tick, so the
//     reading after that tick is the freshly set figure.
//
// WHAT IS READ. After the firing tick with 2 moths alive to aim at: the count
// of Sconce projectiles, `2`, each carrying radius `12`, damage `16`, a
// velocity of length `600`, pierce `-1`, and `ttl` `2.5`; and Sconce's
// timer, `2.0`. Every figure of the row is asserted, so a build whose table
// departs from the specification in any column at this level fails.
//
// WHY THE NIGHT IS POSED AS IT IS. 2 moths and Sconce alone at level
// 3, every switch off but `weaponFire`. "Sconce needs at least one enemy to
// fire", so a target is posed; the moths stand at distinct distances from
// `500` units out, so the nearest is unambiguous and no sconce created at the
// lamplighter's center overlaps one on the firing tick, which leaves every
// sconce in `projectiles` to read. `enemyMotion` off holds each moth where it
// was posed; `effectMotion` off holds each sconce at its launch velocity.
//
// TOLERANCE. `FIGURE_TOLERANCE` on radius, damage, speed, `ttl`, and the
// timer, each a stated figure or a product of stated figures read back as a
// double. None on pierce or the count, whole numbers the specification states.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  projectilesOf,
  type Harness,
} from "../harness";
import {
  armSconce,
  assertSconceOfRow,
  assertTimerOfRow,
  sconceRow,
  targetsFor,
} from "./boomerang";

/** The level this point holds Sconce at. */
const LEVEL = 3;

/** Row 3 of SCONCE_LEVELS, as `constants.ts` restates it from the spec. */
const ROW = sconceRow(LEVEL);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("launches 2 sconces of row 3 at level 3 and sets the timer to 2.0", async () => {
  assertEqual(ROW.amount, 2, "the level-3 row's amount");
  const volley = armSconce(h, LEVEL, targetsFor(ROW.amount));

  const after = await h.tick(1);
  captureStill(h, "row");

  const sconces = projectilesOf(after, "sconce");
  assertEqual(
    sconces.length,
    ROW.amount,
    "Sconce projectiles after the firing tick",
  );
  for (const sconce of sconces) {
    assertSconceOfRow(sconce, ROW, `sconce ${sconce.id}`);
  }
  assertTimerOfRow(after, volley.slot, ROW);
});
