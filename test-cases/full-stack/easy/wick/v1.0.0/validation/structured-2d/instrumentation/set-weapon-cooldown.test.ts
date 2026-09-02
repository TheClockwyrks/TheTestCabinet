// Wick — instrumentation/set-weapon-cooldown: `setWeaponCooldown(0, 0.5)`
// reads back cooldown 0.5 on that slot, and with `weaponFire` on the weapon
// fires on the 30th tick after the call.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setWeaponCooldown(slot, seconds)`: "Sets the cooldown timer of the weapon
// in `slot` ... to `seconds`". `specs/world.md`, "Timers": "a timer set to `s`
// seconds is due `round(s × TICK_HZ)` ticks after the tick it was set on" —
// 30 for 0.5 s; `specs/weapons.md`: a due Taper fires a slash, a zone of kind
// `slash` present on the tick it fires.
//
// THE DRIVE. An isolated run with Taper kept, the pose read at the call,
// `weaponFire` on: no slash through 29 ticks, a slash on the 30th.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { ticksOf } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  enable,
  isolate,
  zonesOfKind,
  type Harness,
} from "../harness";

const POSED_SECONDS = 0.5;
const DUE_TICKS = ticksOf(POSED_SECONDS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("poses the timer and the weapon fires when it is due", async () => {
  isolate(h, { keepTaper: true });
  h.debug.setWeaponCooldown(0, POSED_SECONDS);
  assertEqual(
    h.snapshot().run.weapons[0]?.cooldown,
    POSED_SECONDS,
    "Taper's timer after the pose",
  );
  enable(h, "weaponFire");

  const { early, due } = await captureReplay(h, "timed", async () => {
    const early = await advanceTicks(h, DUE_TICKS - 1);
    const due = await advanceTicks(h, 1);
    return { early, due };
  });

  assertLength(
    zonesOfKind(early, "slash"),
    0,
    `slashes after ${DUE_TICKS - 1} ticks`,
  );
  assertEqual(
    zonesOfKind(due, "slash").length > 0,
    true,
    `a slash on the ${DUE_TICKS}th tick`,
  );
});
