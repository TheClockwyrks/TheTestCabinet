// Wick — ember/no-target-restarts: with no enemy alive, Ember's due tick
// fires nothing and sets its timer to its current cooldown.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Cooldown timers"): "A weapon that needs a target
//     and finds no eligible target does not fire on that tick, and its timer
//     is set to its current cooldown as though it had", where "The current
//     cooldown is the table cooldown times `cooldownMul`, floored at
//     `MIN_COOLDOWN`", `1` times the table figure with no Oil held
//     (`specs/passives.md`).
//   - `specs/weapons.md` ("Ember"): "Ember needs at least one enemy to fire",
//     and the level-1 row has cooldown `1.20`.
//   - `specs/instrumentation.md`: "`setWeaponCooldown(slot, 0)` makes that
//     the next tick", so the one tick run is the due tick.
//
// WHAT IS READ. After the due tick with the field empty: the count of Ember
// bolts, `0`, and Ember's timer, `1.2`. A build that fires a bolt at nothing,
// leaves the timer at `0` to try again next tick, or sets it to anything but
// the current cooldown fails.
//
// WHY THE NIGHT IS POSED AS IT IS. Ember alone at level 1 on an empty field,
// every switch off but `weaponFire`, which is the faculty this item is about:
// no enemy, so no target, and nothing else that can create a projectile or
// touch the timer.
//
// TOLERANCE. `FIGURE_TOLERANCE` on the timer, a stated figure read back as a
// double. None on the count, a whole number.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  projectilesOf,
  type Harness,
} from "../harness";
import { armEmber, assertTimerOfRow, emberRow } from "./volley";

/** The level held; any row would do, and its cooldown is the figure read. */
const LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates no bolt on the due tick with no enemy alive and restarts the timer", async () => {
  const volley = armEmber(h, LEVEL, []);
  assertEqual(volley.posed.run.enemies.length, 0, "enemies alive");

  const after = await h.tick(1);
  captureStill(h, "restart");

  assertEqual(
    projectilesOf(after, "ember").length,
    0,
    "Ember bolts after the due tick",
  );
  assertTimerOfRow(after, volley.slot, emberRow(LEVEL));
});
