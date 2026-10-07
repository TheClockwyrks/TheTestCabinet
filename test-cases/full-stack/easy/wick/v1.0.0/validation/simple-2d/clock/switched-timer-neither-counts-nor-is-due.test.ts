// Wick — clock/switched-timer-neither-counts-nor-is-due: a timer held by a
// driver switch neither counts down nor is due.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/world.md` ("Timers"): "A timer held by one of the driver switches
//     `specs/instrumentation.md` names, a weapon's cooldown timer while
//     `weaponFire` is off or `spawnTimer` while `spawning` is off, neither
//     counts down nor is due until the switch is on again."
//   - `specs/instrumentation.md` ("The driver switches"): `weaponFire` off:
//     "Every cooldown timer holds where it stands and nothing fires or
//     pulses."; `spawning` off: "The timer holds where it stands and no window
//     spawn lands."
//   - `specs/weapons.md` ("Cooldown timers"): a Taper whose timer is `0` and
//     `weaponFire` on would fire on the next tick; `specs/enemies.md` ("The
//     spawn timer"): a `spawnTimer` at `0` with `spawning` on and room under
//     the cap would spawn on the next tick.
//   - `specs/instrumentation.md`: "A pose that creates an entity gives it the
//     next id from `nextId`", and `nextId` "is never reused within a run", so
//     an unchanged `nextId` is a run in which nothing was created.
//
// WHAT IS READ. Taper's timer and the spawn timer are both posed to 0, the
// value at which each would be due, with `weaponFire` and `spawning` off. Sixty
// ticks later both must still read 0, no slash may have been created, and no
// enemy may have spawned; `nextId` unchanged is what says nothing at all was
// created on any of the sixty ticks, since a slash lives only six ticks and
// cannot be read at the end alone.
//
// WHY THE NIGHT IS POSED AS IT IS. The two timers the spec names are the whole
// of the scenario: Taper held alone, the director's timer at 0, every switch
// off. Nothing else is in the night, so anything created would be one of the
// two firings the switches must hold.
//
// TOLERANCE. None: a held timer reads the value it was posed, and the counts
// are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

/** How long the two due timers are watched, in ticks: one second of them. */
const HELD_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds a due Taper timer and a due spawn timer while their switches are off", async () => {
  const posed = isolate(h, { keepTaper: true });
  const slot = 0;
  assertEqual(posed.run.weapons[slot]?.id, "taper", "the weapon held");
  h.debug.setWeaponCooldown(slot, 0);
  h.debug.setSpawnTimer(0);
  const armed = h.snapshot();
  assertEqual(armed.weaponFire, false, "weaponFire");
  assertEqual(armed.spawning, false, "spawning");

  const after = await h.tick(HELD_TICKS);
  captureStill(h, "held");

  assertEqual(
    after.run.weapons[slot]?.cooldown,
    0,
    "Taper's timer after sixty ticks with weaponFire off",
  );
  assertEqual(
    after.run.spawnTimer,
    0,
    "spawnTimer after sixty ticks with spawning off",
  );
  assertEqual(after.run.zones.length, 0, "zones after sixty ticks");
  assertEqual(after.run.enemies.length, 0, "enemies after sixty ticks");
  assertEqual(
    after.run.nextId,
    armed.run.nextId,
    "nextId after sixty ticks: nothing created",
  );
});
