// weapons/fires-on-first-tick — a weapon fires on the first tick it is held.
//
// THE SPEC LINE. `specs/weapons.md`, "Cooldown timers": "On acquisition the
// timer is `0`, so a weapon fires on the first `playing` tick it is held;
// Taper, Lantern, Halo, Oil Splash, Pin, Shard, and Flare need no target and
// fire the same way". `specs/instrumentation.md` has the fresh run
// `setScreen("playing")` begins carry "Taper at level `1` and cooldown `0` in
// the first weapon slot", and `specs/world.md`, "Timers", makes a timer at `0`
// "due on every tick until it is set again" — so the run's first `playing`
// tick creates a Taper slash, and there is nothing to wait for.
//
// WHAT IS READ. `specs/weapons.md`, "Taper", makes a slash a zone of kind
// `slash` that "is drawn for `SLASH_FLASH` (`0.1`) seconds", so the tick that
// fires leaves the zone in `zones` with a fresh id. The reading is the zones
// the first tick created, the entries whose id is at least the `nextId` the run
// held before the tick, and the verdict is that at least one of them is a Taper
// slash. How the slash is placed and sized is `taper/`'s.
//
// THE POSE. The fresh run keeps the Taper it starts with, and everything else
// is held: no spawns, no events, no motion, no contact, no effect motion, so
// the only thing the first tick can do is count the one timer and fire the one
// weapon. `weaponFire` alone is on, because that is the faculty the requirement
// is about ("The timers count and the weapons fire on the ticks the
// `weaponFire` switch ... is on"). Taper needs no target, so no enemy is posed.
//
// THE TOLERANCE. None: the requirement is a count of zones on a fixed tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enable,
  heldWeapon,
  isolate,
  zonesCreatedSince,
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
  const opened = isolate(h, { keepTaper: true });
  enable(h, "weaponFire");

  // The precondition the specification states for the fresh run: Taper held
  // with its timer at `0`. A build that opens a run without it fails here, on
  // the surface's own terms.
  const taper = heldWeapon(opened, "taper");
  assertEqual(
    taper?.id,
    "taper",
    "the weapon a fresh run holds in its first slot (specs/instrumentation.md, setScreen)",
  );
  assertEqual(
    taper?.cooldown,
    0,
    "Taper's cooldown timer on acquisition (specs/weapons.md, Cooldown timers)",
  );
  assertEqual(opened.run.tick, 0, "the run clock before the first tick");

  const first = await advanceTicks(h, 1);
  captureStill(h, "first");

  assertEqual(first.run.tick, 1, "the run clock after the first tick");
  const slashes = zonesCreatedSince(opened, first).filter(
    (zone) => zone.kind === "slash" && zone.weapon === "taper",
  );
  assertGreaterThan(
    slashes.length,
    0,
    "Taper slash zones the run's first playing tick created (specs/weapons.md, Cooldown timers)",
  );
});
