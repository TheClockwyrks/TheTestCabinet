// Wick — evolutions/evolved-timer-zero: an evolved weapon's cooldown timer
// starts at `0`, so it fires on the first `playing` tick it is held.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Opening a chest"),
// rule 1: "The evolved weapon replaces its base in the same slot with a single
// level, its cooldown timer is set to `0` so it fires on the first `playing`
// tick it is held". `specs/world.md` ("Timers"): "a timer at `0` stays due on
// every tick until it is set again", and a timer "held by one of the driver
// switches ... neither counts down nor is due until the switch is on again". So
// on the tick the chest evolves Taper the slot reads cooldown `0`, and the
// first `playing` tick run with `weaponFire` on after the overlay closes is a
// Pyre firing: `PYRE_STATS` gives amount `2` capped at `TAPER_MAX_AMOUNT`, so
// that tick creates two `slash` zones of weapon `pyre`.
//
// THE POSE. An isolated night with Taper at level 8 and Wick 1 held, the chest
// reached the real way through the harness's `openChest` with `weaponFire`
// still off, so the evolution is the only thing the tick does and no Taper
// firing lands first. Then the overlay is closed the way `confirm` closes it
// (`setScreen("playing")` from `chest`), `weaponFire` is turned on, and one
// tick is run. The replay covers the chest tick and the firing tick.
//
// TOLERANCE. `TIMER_TOL` on the timer the evolution set, which a build writes
// rather than integrates; the slash count is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { MAX_WEAPON_LEVEL, TAPER_MAX_AMOUNT, TIMER_TOL } from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  holdPassive,
  holdWeapon,
  isolate,
  newZones,
  openChest,
  type Harness,
} from "../harness";
import { closeChest, slotOf } from "./stage";

/** The slot Taper, and then Pyre, sits in. */
const SLOT = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads cooldown 0 on the evolving tick and fires two Pyre slashes on the first playing tick after", async () => {
  await isolate(h);
  await holdWeapon(h, "taper", MAX_WEAPON_LEVEL, SLOT);
  await holdPassive(h, "wick", 1);

  const drive = await captureReplay(h, "fired", async () => {
    const opened = await openChest(h);
    await closeChest(h, opened);
    await enable(h, "weaponFire");
    const before = await h.snapshot();
    const fired = await h.step(1);
    return { opened, before, fired };
  });

  const evolved = slotOf(drive.opened, SLOT, "on the evolving tick");
  assertEqual(evolved.id, "pyre", "the weapon in the slot after the chest");
  assertNear(
    evolved.cooldown,
    0,
    TIMER_TOL,
    "Pyre's cooldown timer on the tick the chest evolved Taper",
  );

  const slashes = newZones(drive.before, drive.fired).filter(
    (zone) => zone.kind === "slash" && zone.weapon === "pyre",
  );
  assertEqual(
    slashes.length,
    TAPER_MAX_AMOUNT,
    "Pyre slash zones the first playing tick after the overlay created",
  );
});
