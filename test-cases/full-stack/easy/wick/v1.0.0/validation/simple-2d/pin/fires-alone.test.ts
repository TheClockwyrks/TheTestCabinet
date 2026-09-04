// Wick — pin/fires-alone: Pin fires on its due tick with no enemy alive.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Pin"): "Pin fires whether or not any enemy exists."
//   - `specs/weapons.md` ("Cooldown timers"): "Taper, Lantern, Halo, Oil
//     Splash, Pin, Shard, and Flare need no target and fire the same way", and
//     ("Targeting summary") Pin: "Needs a target | no".
//   - `specs/world.md` ("One tick"), phase 5: "each weapon whose timer is due
//     fires, creating its projectiles and zones"; ("Timers"): "a timer at `0`
//     stays due on every tick until it is set again".
//   - `specs/instrumentation.md` (`setWeaponCooldown`): "`setWeaponCooldown(slot,
//     0)` makes that the next tick"; (`clearEnemies`): "Removes every enemy".
//
// WHAT IS READ. Whether any Pin dart is in `projectiles` after the due tick,
// with the snapshot before it reading no enemy. A build that treats Pin like
// Ember, holding its fire until a target exists, leaves no dart.
//
// WHY THE NIGHT IS POSED AS IT IS. Pin alone at level 1 on an empty field,
// every switch off but `weaponFire`: the empty field IS the scenario, and with
// `spawning` and `events` off no enemy can arrive on the firing tick to give a
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
import { armPin } from "./dart";

/** The level held: any row serves, and row 1 is the acquisition row. */
const LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates Pin darts on the due tick with no enemy alive", async () => {
  const { posed } = armPin(h, LEVEL);
  assertEqual(posed.run.enemies.length, 0, "enemies alive before the due tick");

  const after = await h.tick(1);
  captureStill(h, "alone");

  assertEqual(after.run.enemies.length, 0, "enemies alive on the due tick");
  assertGreaterThan(
    projectilesOf(after, "pin").length,
    0,
    "Pin darts after the due tick on an empty field",
  );
});
