// Wick — evolutions/hail-fires-alone: Hail fires on its due tick with no enemy
// alive.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Hail"): a dart is "fired whether or not any enemy
//     exists".
//   - `specs/world.md` ("One tick"), phase 5: "each weapon whose timer is due
//     fires, creating its projectiles and zones"; ("Timers"): "a timer at `0`
//     stays due on every tick until it is set again".
//   - `specs/instrumentation.md` (`setWeaponCooldown`): "`setWeaponCooldown(slot,
//     0)` makes that the next tick"; (`clearEnemies`): "Removes every enemy".
//
// WHAT IS READ. Whether any Hail dart is in `projectiles` after the due tick,
// with the snapshot before it reading no enemy. A build that holds Hail's fire
// until a target exists, as Beacon must, leaves no dart.
//
// WHY THE NIGHT IS POSED AS IT IS. Hail alone on an empty field, every driver
// switch but `weaponFire` off: the empty field is the scenario, and with
// `spawning` and `events` off no enemy can arrive on the due tick to give a
// target-needing build something to aim at.
//
// TOLERANCE. None: a dart is either in `projectiles` after the tick or it is
// not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  projectilesOf,
  type Harness,
} from "../harness";
import { armEvolved } from "./evolved";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates Hail darts on the due tick with no enemy alive", async () => {
  const { posed } = armEvolved(h, "hail", { facing: "right" });
  assertEqual(posed.run.enemies.length, 0, "enemies alive before the due tick");

  const after = await h.tick(1);
  captureStill(h, "alone");

  assertEqual(after.run.enemies.length, 0, "enemies alive on the due tick");
  assertGreaterThan(
    projectilesOf(after, "hail").length,
    0,
    "Hail darts after the due tick on an empty field",
  );
});
