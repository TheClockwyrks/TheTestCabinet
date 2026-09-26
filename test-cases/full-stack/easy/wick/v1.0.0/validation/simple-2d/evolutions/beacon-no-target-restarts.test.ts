// Wick — evolutions/beacon-no-target-restarts: with no enemy alive, Beacon's
// due tick fires nothing and sets its timer to its cooldown.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Beacon"): "Beacon needs at least one enemy to
//     fire"; the fixed row has cooldown `0.25`.
//   - `specs/weapons.md` ("Cooldown timers"): "A weapon that needs a target and
//     finds no eligible target does not fire on that tick, and its timer is set
//     to its current cooldown as though it had", the cooldown being "the table
//     cooldown times `cooldownMul`, floored at `MIN_COOLDOWN`", `1` times the
//     fixed figure with no Oil held (`specs/passives.md`).
//   - `specs/instrumentation.md`: "`setWeaponCooldown(slot, 0)` makes that the
//     next tick", so the one tick run is the due tick; (`clearEnemies`):
//     "Removes every enemy".
//
// WHAT IS READ. After the due tick with the field empty: the count of Beacon
// bolts, `0`, and Beacon's timer, 0.25. A build that fires a bolt at nothing,
// leaves the timer at `0` to try again on the next tick, or sets it to anything
// but the cooldown fails.
//
// WHY THE NIGHT IS POSED AS IT IS. Beacon alone on an empty field, every driver
// switch but `weaponFire` off, which is the faculty this item is about: no
// enemy, so no target, and with `spawning` and `events` off none can arrive on
// the due tick to give a target-needing build something to aim at.
//
// TOLERANCE. `FIGURE_TOLERANCE` on the timer, a stated figure read back as a
// double. None on the count.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BEACON_STATS } from "../constants";
import {
  captureStill,
  createHarness,
  projectilesOf,
  type Harness,
} from "../harness";
import { armEvolved, assertTimerAfterFiring } from "./evolved";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates no bolt on the due tick with no enemy alive and restarts the timer at 0.25", async () => {
  const { slot, posed } = armEvolved(h, "beacon");
  assertEqual(posed.run.enemies.length, 0, "enemies alive before the due tick");

  const after = await h.tick(1);
  captureStill(h, "restart");

  assertEqual(after.run.enemies.length, 0, "enemies alive on the due tick");
  assertEqual(
    projectilesOf(after, "beacon").length,
    0,
    "Beacon bolts after the due tick on an empty field",
  );
  assertTimerAfterFiring(
    after,
    slot,
    BEACON_STATS.cooldown,
    "Beacon's timer after the due tick with no target",
  );
});
