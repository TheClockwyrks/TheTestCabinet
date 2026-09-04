// Wick — instrumentation/switch-weapon-fire: with `setWeaponFire(false)`,
// Taper's cooldown timer holds, no slash appears over 120 ticks, and a Halo
// aura pulses nothing; with the switch back on the timer counts down from
// where it held.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, the
// switch table, `weaponFire` off: "Every cooldown timer holds where it stands
// and nothing fires or pulses"; "Placement is gated by neither `weaponFire`
// nor `effectMotion`", so the aura still exists to not pulse. `specs/world.md`,
// "Timers": a held timer "neither counts down nor is due until the switch is on
// again", and counts by `TICK_DT` a tick once it is.
//
// THE DRIVE. An isolated run with Taper kept and its timer posed to 0.7 s,
// Halo held with a moth 30 units out, inside the level-1 aura of radius 80;
// 120 ticks with the switch off: the timer reads 0.7 exact, no zone of kind
// `slash`, the moth at its full 5 hp. Then the switch on and one tick: the
// timer reads `0.7 − TICK_DT` (`MOTION_EPS`).

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDefined,
  assertEqual,
  assertLength,
  assertNear,
} from "../assert";
import { ENEMIES, MOTION_EPS, TICK_DT } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enable,
  enemyById,
  holdWeapon,
  isolate,
  placeEnemyNear,
  zonesOfKind,
  type Harness,
} from "../harness";

const HELD_TICKS = 120;
const POSED_COOLDOWN = 0.7;
const TAPER_SLOT = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds the timers, fires nothing, pulses nothing, and counts on again", async () => {
  isolate(h, { keepTaper: true });
  h.debug.setWeaponCooldown(TAPER_SLOT, POSED_COOLDOWN);
  holdWeapon(h, "halo");
  const moth = placeEnemyNear(h, "moth", 30, 0);

  const held = await advanceTicks(h, HELD_TICKS);
  captureStill(h, "held");
  assertEqual(
    held.run.weapons[TAPER_SLOT]?.cooldown,
    POSED_COOLDOWN,
    `Taper's timer after ${HELD_TICKS} ticks with weaponFire off`,
  );
  assertLength(zonesOfKind(held, "slash"), 0, "slashes with weaponFire off");
  assertLength(zonesOfKind(held, "aura"), 1, "the aura placement still made");
  const enemy = enemyById(held, moth);
  assertDefined(enemy, "the moth inside the aura");
  assertEqual(
    enemy?.hp,
    ENEMIES.moth.hp,
    "the moth's hp with the aura pulsing nothing",
  );

  enable(h, "weaponFire");
  const counting = await advanceTicks(h, 1);
  assertNear(
    counting.run.weapons[TAPER_SLOT]?.cooldown ?? Number.NaN,
    POSED_COOLDOWN - TICK_DT,
    MOTION_EPS,
    "Taper's timer one tick after weaponFire came on",
  );
});
