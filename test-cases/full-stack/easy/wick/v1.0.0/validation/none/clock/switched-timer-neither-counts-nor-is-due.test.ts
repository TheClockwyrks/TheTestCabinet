// clock/switched-timer-neither-counts-nor-is-due — a timer held by a driver
// switch neither counts down nor is due while the switch is off.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Timers"): "A timer held by
// one of the driver switches `specs/instrumentation.md` names, a weapon's
// cooldown timer while `weaponFire` is off or `spawnTimer` while `spawning`
// is off, neither counts down nor is due until the switch is on again."
// specs/instrumentation.md ("The driver switches"): while `weaponFire` is off,
// "Every cooldown timer holds where it stands and nothing fires or pulses";
// while `spawning` is off, "The timer holds where it stands and no window
// spawn lands"; and "turning one back on resumes that faculty from the next
// tick". A timer at `0` would otherwise be due on every tick
// (specs/world.md: "a timer at `0` stays due on every tick until it is set
// again"), so a `0` under a switch that is off is the sharpest case: it fires
// nothing, spawns nothing, and still reads `0`.
//
// THE DRIVE. Every switch off, Taper held with its timer posed to `0`, the
// spawn timer posed to `0`, and sixty ticks. No zone is created, no enemy
// spawns, and both timers still read `0`. Then the two switches come back on
// and one tick runs: both timers are due on it, so Taper fires and the
// director spawns, which is the control that the posed `0`s were real and
// were held rather than lost.
//
// THE NIGHT. An isolated run with Taper alone. Taper "needs no target", and
// the director's first spawn needs only `aliveCommons` under the window's
// cap, so nothing else is posed.
//
// THE TOLERANCE. None: a held timer "holds where it stands", `0` exactly, and
// the zones and enemies are counts.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  armWeapon,
  captureStill,
  createHarness,
  enable,
  holdWeapon,
  isolate,
  newEnemies,
  newZones,
  weaponIn,
  type Harness,
} from "../harness";

/** The ticks run with both switches off. */
const HELD_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds a due Taper timer and a due spawn timer at 0 across 60 ticks with their switches off", async () => {
  await isolate(h);
  const slot = await holdWeapon(h, "taper");
  await armWeapon(h, slot);
  await h.debug.setSpawnTimer(0);
  const armed = await h.snapshot();
  const held = await h.step(HELD_TICKS);
  await captureStill(h, "held");

  await enable(h, "weaponFire", "spawning");
  const released = await h.step(1);

  assertEqual(
    newZones(armed, held).length,
    0,
    "zones created across 60 ticks with weaponFire off and Taper's timer at 0",
  );
  assertEqual(
    weaponIn(held, "taper")?.cooldown,
    0,
    "Taper's timer after 60 ticks with weaponFire off",
  );
  assertEqual(
    newEnemies(armed, held).length,
    0,
    "enemies spawned across 60 ticks with spawning off and the spawn timer at 0",
  );
  assertEqual(
    held.run.spawnTimer,
    0,
    "the spawn timer after 60 ticks with spawning off",
  );

  assertGreaterThan(
    newZones(held, released).length,
    0,
    "zones created on the first tick with weaponFire back on: the held timer was due",
  );
  assertGreaterThan(
    newEnemies(held, released).length,
    0,
    "enemies spawned on the first tick with spawning back on: the held timer was due",
  );
});
