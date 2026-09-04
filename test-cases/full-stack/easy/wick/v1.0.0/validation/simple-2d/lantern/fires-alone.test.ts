// Wick — lantern/fires-alone: Lantern fires with no enemy alive.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Cooldown timers"): "On acquisition the timer is
//     `0`, so a weapon fires on the first `playing` tick it is held; Taper,
//     Lantern, Halo, Oil Splash, Pin, Shard, and Flare need no target and
//     fire the same way", and "A weapon that needs a target and finds no
//     eligible target does not fire on that tick", a rule Lantern is outside.
//   - `specs/weapons.md` ("Lantern"), the targeting summary: Lantern's
//     "needs target" column is "no", and "On firing, `amount` lanterns
//     appear on a circle of radius `orbit` around the player's center".
//   - `specs/instrumentation.md`: "`setWeaponCooldown(slot, 0)` makes that
//     the next tick" the weapon fires on.
//
// WHAT IS READ. After the due tick with no enemy alive: at least one Lantern
// lantern in `zones`. The set's count and figures are the row points'
// concern; this point decides that the firing happened at all.
//
// WHY THE NIGHT IS POSED AS IT IS. Lantern alone at level 1, no enemy posed
// and every switch off but `weaponFire`, so the field is empty on the due
// tick and nothing can spawn onto it: the firing read is one made with no
// target.
//
// TOLERANCE. None: the reading is the presence of a zone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { armLantern, lanternsOf } from "./orbit";

/** The level this point holds Lantern at. */
const LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates a set on the due tick with no enemy alive", async () => {
  const orbit = armLantern(h, LEVEL);
  assertEqual(
    orbit.posed.run.enemies.length,
    0,
    "enemies alive before the due tick",
  );

  const after = await h.tick(1);
  captureStill(h, "alone");

  assertEqual(after.run.enemies.length, 0, "enemies alive on the due tick");
  assertGreaterThan(
    lanternsOf(after).length,
    0,
    "Lantern lanterns after the due tick with no enemy alive",
  );
});
