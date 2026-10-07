// Wick — weapons/fires-on-first-tick: a weapon fires on the first tick it is held.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Cooldown timers"): "On
// acquisition the timer is `0`, so a weapon fires on the first `playing` tick it
// is held; Taper, Lantern, Halo, Oil Splash, Pin, Shard, and Flare need no
// target and fire the same way". `specs/progression.md` starts a run with "Taper
// at level `1` in the first weapon slot", `specs/instrumentation.md` has
// `setWeapon` zero the cooldown timer of a slot whose `id` changes, and
// `specs/world.md` ("Timers") makes a timer at `0` "due on every tick until it
// is set again". So the run's first `playing` tick
// creates a Taper slash, and there is nothing to wait for.
//
// WHAT IS READ. `specs/weapons.md` ("Taper") makes a slash a zone of kind
// `slash` that "is drawn for `SLASH_FLASH` (`0.1`) seconds", so the tick that
// fires leaves the zone in `snapshot().run.zones` with a fresh id. The reading
// is the zones the first tick created — the entries whose id is at least the
// `nextId` the run held before the tick — and the verdict is that at least one
// of them is a Taper slash. HOW the slash is placed and sized is `taper/`'s.
//
// THE POSE. The isolated night is given the Taper a run starts with, and
// everything else is held: no spawns, no events, no motion, no contact, no effect motion, so
// the only thing the first tick can do is count the one timer and fire the one
// weapon. `weaponFire` alone is on, because that is the faculty the
// requirement is about ("The timers count and the weapons fire on the ticks
// the `weaponFire` switch ... is on"). Taper needs no target, so no enemy is
// posed.
//
// TOLERANCE. None: the requirement is a count of zones on a fixed tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  newZones,
  weaponIn,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates a Taper slash on the first playing tick of a fresh run", async () => {
  const opened = await isolate(h, { taper: true, on: ["weaponFire"] });
  // The precondition this check rests on: Taper held with its timer at `0`,
  // which is what `setWeapon` leaves on a slot whose `id` changed. A build
  // whose surface leaves it elsewhere fails here, on the surface's own terms.
  const taper = weaponIn(opened, "taper");
  assertEqual(taper?.id, "taper", "the weapon held in slot 0");
  assertEqual(taper?.cooldown, 0, "Taper's cooldown timer on acquisition");
  assertEqual(opened.run.tick, 0, "the run clock before the first tick");

  const first = await h.step(1);
  await captureStill(h, "first");

  assertEqual(first.run.tick, 1, "the run clock after the first tick");
  const slashes = newZones(opened, first).filter(
    (zone) => zone.kind === "slash" && zone.weapon === "taper",
  );
  assertGreaterThan(
    slashes.length,
    0,
    "Taper slash zones the run's first playing tick created",
  );
});
