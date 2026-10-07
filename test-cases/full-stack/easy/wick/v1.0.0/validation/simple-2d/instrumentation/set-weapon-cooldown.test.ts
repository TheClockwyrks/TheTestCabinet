// instrumentation/set-weapon-cooldown — `setWeaponCooldown(0, 0.5)` reads
// back cooldown 0.5 on that slot, and with weaponFire on the weapon fires on
// the 30th tick after the call.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md,
// `setWeaponCooldown`: "Sets the cooldown timer of the weapon in `slot`, a
// held slot, to `seconds`, at least `0`". specs/world.md, "Timers": "a timer
// set to `s` seconds is due `round(s × TICK_HZ)` ticks after the tick it was
// set on" (30 for 0.5); specs/weapons.md: "the weapon fires again on the tick
// the timer is due", Taper needing no target, its slash living SLASH_FLASH.
//
// THE POSE. An isolated run keeping its Taper, the pose read back,
// `weaponFire` on, and a trace: no slash through tick 29, a slash on tick 30.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, ticksFor } from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  isolate,
  zonesOfKind,
  type Harness,
} from "../harness";

const POSED_SECONDS = 0.5;
const DUE_TICK = ticksFor(POSED_SECONDS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets the timer and fires the weapon when it is due", async () => {
  isolate(h, { keepTaper: true });
  h.debug.setWeaponCooldown(0, POSED_SECONDS);
  assertWithin(
    h.snapshot().run.weapons[0].cooldown,
    POSED_SECONDS,
    FIGURE_TOLERANCE,
    "the slot's cooldown read back",
  );
  enable(h, "weaponFire");

  const seen = await captureReplay(h, "timed", () =>
    h.trace(DUE_TICK, (s) => zonesOfKind(s, "slash").length > 0),
  );

  assertEqual(seen.length, DUE_TICK, "the tick the slash appeared on");
  assertLength(
    zonesOfKind(seen[DUE_TICK - 2], "slash"),
    0,
    "the slashes a tick before it was due",
  );
  assertEqual(
    zonesOfKind(seen[DUE_TICK - 1], "slash").length > 0,
    true,
    "a slash on the due tick",
  );
});
