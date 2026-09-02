// Wick — weapons/fires-on-first-tick: a weapon fires on the first `playing`
// tick it is held.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Cooldown timers"): "On acquisition the timer is
//     `0`, so a weapon fires on the first `playing` tick it is held; Taper,
//     Lantern, Halo, Oil Splash, Pin, Shard, and Flare need no target and fire
//     the same way".
//   - `specs/state.md` ("The idle run"): "A fresh run is the idle run with
//     Taper at level `1` and cooldown `0` in the first weapon slot."
//   - `specs/world.md` ("Timers"): "a timer at `0` stays due on every tick
//     until it is set again", and ("One tick") phase 5: "each weapon whose
//     timer is due fires, creating its projectiles and zones".
//   - `specs/weapons.md` ("Taper"): a slash is a zone of kind `slash`
//     (`specs/state.md`, `ZoneState.kind`) drawn for `SLASH_FLASH` (`0.1`)
//     seconds, so it is still in `zones` in the snapshot after the tick that
//     created it: "Every projectile and zone that existed before this tick
//     counts its `ttl` down", and the new slash did not.
//
// WHAT IS READ. The zones of kind `slash` after the run's first tick. A fresh
// run's Taper is the acquisition the rule names, so the run is posed with its
// Taper kept and nothing else held, and the one tick run is the first
// `playing` tick. A build whose timer starts at the cooldown rather than `0`
// leaves no slash after that tick.
//
// WHY THE NIGHT IS POSED AS IT IS. Nothing on the field and every switch off
// but `weaponFire`, which is the faculty this item is about: Taper needs no
// target, so the slash's creation reads the same with the field empty, and no
// enemy, director, or motion is on hand to add a zone of its own.
//
// TOLERANCE. None: a slash is either in `zones` after the first tick or it is
// not. The timer read before the tick is the stated `0` exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  zonesOfKind,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates a Taper slash on the first playing tick of a fresh run", async () => {
  const posed = isolate(h, { keepTaper: true });
  assertEqual(posed.run.weapons[0]?.id, "taper", "the fresh run's first slot");
  assertEqual(
    posed.run.weapons[0]?.cooldown,
    0,
    "Taper's cooldown timer on acquisition",
  );
  assertEqual(posed.run.zones.length, 0, "zones before the first tick");
  enable(h, "weaponFire");

  const after = await h.tick(1);
  captureStill(h, "first");

  const slashes = zonesOfKind(after, "slash").filter(
    (zone) => zone.weapon === "taper",
  );
  assertGreaterThan(
    slashes.length,
    0,
    "Taper slashes in zones after the first playing tick",
  );
});
