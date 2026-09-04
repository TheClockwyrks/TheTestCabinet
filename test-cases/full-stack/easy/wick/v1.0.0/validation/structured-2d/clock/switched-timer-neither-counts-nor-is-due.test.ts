// Wick — clock/switched-timer-neither-counts-nor-is-due: a timer held by a
// switch neither counts nor is due.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/world.md` ("Timers"): "A timer held by one of the driver
//     switches `specs/instrumentation.md` names, a weapon's cooldown timer
//     while `weaponFire` is off or `spawnTimer` while `spawning` is off,
//     neither counts down nor is due until the switch is on again."
//   - `specs/instrumentation.md` ("The driver switches"), `weaponFire` off:
//     "Every cooldown timer holds where it stands and nothing fires or
//     pulses." `spawning` off: "The timer holds where it stands and no window
//     spawn lands."
//   - `specs/instrumentation.md` (`setWeaponCooldown`, `setSpawnTimer`): each
//     sets its timer to the seconds given, `0` included. A timer at `0` would
//     be due on every tick were it counting (`specs/world.md`, "a timer at `0`
//     stays due on every tick until it is set again").
//
// THE DRIVE. An isolated run keeping Taper, every switch off. Taper's timer
// and the director's timer are both posed to `0`, the value at which a
// counting timer is due at once, and sixty ticks run. Taper fires no slash
// and its timer still reads `0`; the director spawns nothing and its timer
// still reads `0`. A build whose switch holds the count but not the dueness
// fires or spawns on the first tick; a build whose switch holds nothing does
// too.
//
// TOLERANCE. None: the zeros are the posed values, and the counts of slashes
// and enemies are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TICK_HZ } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  zonesOfKind,
  type Harness,
} from "../harness";

/** Ticks the held timers are watched for: a second. */
const HELD_TICKS = TICK_HZ;

/** Taper's slot in a fresh run: the first. */
const TAPER_SLOT = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds a due Taper timer under weaponFire off and a due spawn timer under spawning off", async () => {
  isolate(h, { keepTaper: true });
  h.debug.setWeaponCooldown(TAPER_SLOT, 0);
  h.debug.setSpawnTimer(0);

  const after = await advanceTicks(h, HELD_TICKS);
  captureStill(h, "held");

  assertEqual(
    zonesOfKind(after, "slash").length,
    0,
    `the slashes Taper fired across ${HELD_TICKS} ticks with weaponFire off`,
  );
  assertEqual(
    after.run.weapons[TAPER_SLOT]?.cooldown,
    0,
    `Taper's timer after ${HELD_TICKS} ticks with weaponFire off`,
  );
  assertEqual(
    after.run.enemies.length,
    0,
    `the enemies the director spawned across ${HELD_TICKS} ticks with spawning off`,
  );
  assertEqual(
    after.run.spawnTimer,
    0,
    `spawnTimer after ${HELD_TICKS} ticks with spawning off`,
  );
});
