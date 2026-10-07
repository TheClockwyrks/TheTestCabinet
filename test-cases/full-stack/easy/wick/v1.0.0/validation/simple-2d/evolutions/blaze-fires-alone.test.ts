// Wick — evolutions/blaze-fires-alone: Blaze fires on its due tick with no
// enemy alive.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Blaze"): "Blaze fires whether or not any enemy
//     exists."
//   - `specs/world.md` ("One tick"), phase 5: "each weapon whose timer is due
//     fires, creating its projectiles and zones"; ("Timers"): "a timer at `0`
//     stays due on every tick until it is set again".
//   - `specs/instrumentation.md` (`setWeaponCooldown`): "`setWeaponCooldown(slot,
//     0)` makes that the next tick"; (`clearEnemies`): "Removes every enemy".
//
// WHAT IS READ. Whether any Blaze puddle is in `zones` after the due tick, with
// the snapshot before it reading no enemy. A build that holds Blaze's fire
// until a target exists, as Beacon must, leaves no puddle.
//
// WHY THE NIGHT IS POSED AS IT IS. Blaze alone on an empty field, every driver
// switch but `weaponFire` off: the empty field is the scenario, and with
// `spawning` and `events` off no enemy can arrive on the due tick to give a
// target-needing build something to aim at.
//
// TOLERANCE. None: a puddle is either in `zones` after the tick or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { armEvolved } from "./evolved";
import { blazePuddles } from "./blaze";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates Blaze puddles on the due tick with no enemy alive", async () => {
  const { posed } = armEvolved(h, "blaze");
  assertEqual(posed.run.enemies.length, 0, "enemies alive before the due tick");

  const after = await h.tick(1);
  captureStill(h, "alone");

  assertEqual(after.run.enemies.length, 0, "enemies alive on the due tick");
  assertGreaterThan(
    blazePuddles(after).length,
    0,
    "Blaze puddles after the due tick on an empty field",
  );
});
