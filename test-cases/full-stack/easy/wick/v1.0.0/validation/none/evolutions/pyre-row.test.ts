// Wick — evolutions/pyre-row: `PYRE_STATS` is in force.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Pyre"): "Pyre is
// Taper's slash on both sides of the player on every firing: two rectangles of
// `width × height` ... Its amount is `2` plus `amountBonus`, capped at
// `TAPER_MAX_AMOUNT` (`2`)", and "The fixed row is `PYRE_STATS`": damage `60`,
// cooldown `1.2`, width `200`, height `60`, amount `2`. ("Passives still
// apply"): "damage is the fixed damage times `damageMul`; cooldown is the fixed
// cooldown times `cooldownMul`, floored at `MIN_COOLDOWN` (`0.2`); every width,
// height, radius, and orbit is the fixed length times `areaMul`", and with no
// passive held all three multipliers are `1` (`specs/passives.md`).
// `specs/weapons.md` ("Cooldown timers"): "After firing, the timer is set to
// the weapon's current cooldown". So the firing tick creates two `slash` zones
// of weapon `pyre`, each reading width `200`, height `60`, and damage `60`, and
// the slot reads `1.2` after it.
//
// THE POSE. An isolated night with facing posed right and Pyre held at level 1
// through `setWeapon` — an evolved weapon "has a single level" — fired through
// the shared `fireWeapon` (held, due, `weaponFire` on, one tick). No enemy is
// posed: Pyre needs no target, and the reading is the shapes the tick created,
// told by id from the `nextId` the run held before it.
//
// TOLERANCE. `POSITION_TOL` on the width and the height, each a fixed figure
// times `1`; `FLOAT_TOL` on the damage; `TIMER_TOL` on the timer the firing
// set. The slash count is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import {
  FLOAT_TOL,
  POSITION_TOL,
  TAPER_MAX_AMOUNT,
  TIMER_TOL,
  weaponRow,
} from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  type Harness,
} from "../harness";
import { zonesFired } from "./stage";

/** Pyre's fixed row, `PYRE_STATS`. */
const ROW = weaponRow("pyre");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates two slash zones of width 200 and height 60 with damage 60 and sets the timer to 1.2", async () => {
  await isolate(h);
  await h.debug.setFacing("right");

  const firing = await fireWeapon(h, "pyre", 1);
  await captureStill(h, "row");

  const slashes = zonesFired(firing, "pyre", "slash");
  assertEqual(
    slashes.length,
    TAPER_MAX_AMOUNT,
    "Pyre slash zones the firing tick created",
  );
  for (const slash of slashes) {
    assertNear(
      slash.width ?? NaN,
      ROW.width ?? NaN,
      POSITION_TOL,
      `slash ${slash.id}'s width`,
    );
    assertNear(
      slash.height ?? NaN,
      ROW.height ?? NaN,
      POSITION_TOL,
      `slash ${slash.id}'s height`,
    );
    assertNear(
      slash.damage,
      ROW.damage,
      FLOAT_TOL,
      `slash ${slash.id}'s damage`,
    );
  }
  const slot = firing.after.run.weapons?.[firing.slot];
  assertEqual(slot?.id, "pyre", "the weapon in the slot that fired");
  assertNear(
    slot?.cooldown ?? NaN,
    ROW.cooldown ?? NaN,
    TIMER_TOL,
    "Pyre's timer after the firing",
  );
});
