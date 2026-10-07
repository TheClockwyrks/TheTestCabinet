// Wick — flare/fires-alone: Flare fires with no enemy alive.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Flare"): "Flare fires whether or not any enemy
//     exists"; the targeting summary marks Flare as needing no target.
//   - `specs/weapons.md` ("Cooldown timers"): "A weapon that needs a target
//     and finds no eligible target does not fire on that tick"; Flare is named
//     among the weapons that "need no target and fire the same way", and
//     "After firing, the timer is set to the weapon's current cooldown", which
//     "is the table cooldown times `cooldownMul`, floored at `MIN_COOLDOWN`".
//   - `specs/weapons.md` ("Flare"): row 1 of the table has cooldown `60`; with
//     no passive held `cooldownMul` is `1` (`specs/passives.md`).
//   - `specs/state.md` (`ZoneState`): "`burst` for a Flare burst".
//   - `specs/instrumentation.md`: "`setWeaponCooldown(slot, 0)` makes that
//     the next tick" the weapon fires on.
//
// WHAT IS READ. After the due tick on an empty field: exactly one burst zone
// with weapon `flare`, and Flare's timer at 60.
//
// WHY THE NIGHT IS POSED AS IT IS. Flare alone at level 1 on a field holding
// no enemy at all, no passive held, every switch but `weaponFire` off, so
// nothing spawns an enemy for the tick to find, no other weapon adds a zone,
// and the burst either arrives on its own or does not arrive. The timer is
// read beside the zone because a build that treats Flare as needing a target
// leaves the timer at its cooldown with no zone created, and the pair
// separates that from a build that fires.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on the timer, a stated figure times a
// multiplier of 1 read back; none on the zone count.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  armWeapon,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";
import { assertTimerOfRow, flareBursts, flareRow, poseFlare } from "./burst";

/** The level this point holds Flare at: cooldown 60. */
const LEVEL = 1;

/** Row 1 of FLARE_LEVELS. */
const ROW = flareRow(LEVEL);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates the burst and sets the timer to 60 with no enemy alive", async () => {
  const { slot, posed } = poseFlare(h, LEVEL, null);
  assertEqual(posed.run.enemies.length, 0, "enemies before the firing tick");
  armWeapon(h, slot);

  const after = await h.tick(1);
  captureStill(h, "alone");

  assertEqual(
    flareBursts(after).length,
    1,
    "burst zones with weapon flare after the due tick",
  );
  assertTimerOfRow(after, slot, ROW);
});
