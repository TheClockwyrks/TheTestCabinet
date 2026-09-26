// Wick — instrumentation/switch-weapon-fire: with `setWeaponFire(false)`,
// Taper's cooldown timer holds where it stands and no slash appears over 120
// ticks, and a Halo aura pulses nothing; with the switch back on the timer
// counts down from where it held.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "The driver
// switches"): "`setWeaponFire(on)` | `weaponFire` | Cooldown timers count down
// and due weapons fire or pulse. | Every cooldown timer holds where it stands
// and nothing fires or pulses." specs/world.md — "Timers": a timer "while
// `weaponFire` is off ... neither counts down nor is due until the switch is on
// again"; a timer counts down "by `TICK_DT`" per tick, so 30 ticks after the
// switch returns a timer of 1.0 reads 0.5, to `TIMER_TOL`. The held timer is
// read exactly. A slash is a zone of kind `slash` (specs/state.md).
//
// WHY THE WORLD IS POSED AS IT IS. Taper with its timer posed to 1.0 and Halo
// held, a moth inside the aura's radius so a pulse would show on its `hp`;
// placement runs whatever the switch, so the aura exists, and every other
// faculty is held so the moth stays put and nothing else damages it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNear } from "../assert";
import { TICK_DT, TIMER_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  mustEnemy,
  placeEnemy,
  zonesOfKind,
  type Harness,
} from "../harness";

const POSED_COOLDOWN = 1.0;
const HELD_TICKS = 120;
const RESUMED_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the timers and the firing while off, and counts from there once on", async () => {
  await isolate(h);
  const taper = await holdWeapon(h, "taper", 1);
  await h.debug.setWeaponCooldown(taper, POSED_COOLDOWN);
  await holdWeapon(h, "halo", 1);
  const moth = await placeEnemy(h, "moth", 30, 0);

  const held = await h.step(HELD_TICKS);
  await captureStill(h, "held");
  assertEqual(
    held.run.weapons[taper]?.cooldown,
    POSED_COOLDOWN,
    `Taper's timer after ${HELD_TICKS} held ticks`,
  );
  assertLength(
    zonesOfKind(held, "slash"),
    0,
    `slashes over ${HELD_TICKS} held ticks`,
  );
  assertLength(
    zonesOfKind(held, "aura"),
    1,
    "the Halo aura, placed whatever the switch",
  );
  assertEqual(
    mustEnemy(held, moth.id).hp,
    moth.hp,
    "the moth's hp with the aura pulsing nothing",
  );

  await h.debug.setWeaponFire(true);
  const resumed = await h.step(RESUMED_TICKS);
  assertNear(
    resumed.run.weapons[taper]?.cooldown ?? NaN,
    POSED_COOLDOWN - RESUMED_TICKS * TICK_DT,
    TIMER_TOL,
    `Taper's timer ${RESUMED_TICKS} ticks after the switch returned`,
  );
});
