// Wick — flare/row-4: row 4 of FLARE_LEVELS is in force at level 4.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Flare"): row 4 of the table has damage `150`,
//     cooldown `50`, and radius `640`; "Every level table has
//     `MAX_WEAPON_LEVEL` (`8`) rows; row `i` is level `i + 1`."
//   - `specs/weapons.md` ("Flare"): "On firing, every enemy within `radius`
//     of the player's center takes `damage` on that tick".
//   - `specs/weapons.md` ("Cooldown timers"): "After firing, the timer is set
//     to the weapon's current cooldown", which "is the table cooldown times
//     `cooldownMul`, floored at `MIN_COOLDOWN` (`0.2`)".
//   - `specs/weapons.md` ("Derived stats"): damage is the "table value ×
//     `damageMul`" and radius the "table value × `areaMul`"; with no passive
//     held every multiplier is `1` (`specs/passives.md`).
//   - `specs/state.md` (`ZoneState`): "`burst` for a Flare burst", and "a
//     burst's [radius] is its Flare `radius`".
//   - `specs/weapons.md` ("Hits and death"): "A hit removes the shape's
//     damage per hit from the enemy's `hp`"; a mothwing has HP `600`
//     (`specs/enemies.md`).
//   - `specs/instrumentation.md`: "`setWeaponCooldown(slot, 0)` makes that
//     the next tick" the weapon fires on.
//
// WHAT IS READ. After the firing tick: the one burst zone's `radius` and
// `damage`, 640 and 150; the mothwing's `hp`, 600 − 150 = 450; and Flare's
// timer, 50.
//
// WHY THE NIGHT IS POSED AS IT IS. Flare alone at level 4, no passive held,
// one mothwing 100 units along +x well inside the row's radius, every switch
// but `weaponFire` off, so the zone the tick creates is the burst alone,
// every figure read is the row's unscaled, and the burst is the only thing
// that can touch the mothwing. A mothwing survives every row, so the damage
// the burst removed is read as a difference rather than as a death.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on each figure: a stated figure, or a
// stated figure times a multiplier of 1, or an exact difference of two stated
// figures, read back.

import { afterEach, beforeEach, it } from "vitest";
import {
  armWeapon,
  captureStill,
  createHarness,
  present,
  type Harness,
} from "../harness";
import {
  assertBurstOfRow,
  assertProbeTook,
  assertTimerOfRow,
  flareRow,
  poseFlare,
  theBurst,
} from "./burst";

/** The level this point holds Flare at. */
const LEVEL = 4;

/** Row 4 of FLARE_LEVELS. */
const ROW = flareRow(LEVEL);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads radius 640 and damage 150, removes 150 from the mothwing, and sets the timer to 50 at level 4", async () => {
  const { slot, probe, posed } = poseFlare(h, LEVEL);
  const mothwing = present(probe, "the posed mothwing's id");
  armWeapon(h, slot);

  const after = await h.tick(1);
  captureStill(h, "row");

  assertBurstOfRow(theBurst(after, "after the firing tick"), ROW, "the burst");
  assertProbeTook(
    posed,
    after,
    mothwing,
    ROW.damage,
    "the mothwing after the burst",
  );
  assertTimerOfRow(after, slot, ROW);
});
