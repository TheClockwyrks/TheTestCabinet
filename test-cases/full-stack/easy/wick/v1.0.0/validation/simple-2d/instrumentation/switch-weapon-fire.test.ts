// instrumentation/switch-weapon-fire — with `setWeaponFire(false)`, Taper's
// cooldown timer holds where it stands and no slash appears over 120 ticks,
// and a Halo aura pulses nothing; with the switch back on the timer counts
// down from where it held.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "The driver
// switches", `weaponFire` off: "Every cooldown timer holds where it stands and
// nothing fires or pulses"; and "Placement is gated by neither `weaponFire`
// nor `effectMotion`", so the aura is still there to not pulse. specs/world.md,
// "Timers": "On every tick a timer counts down by `TICK_DT`", so one tick
// after the switch returns the timer reads its held value less TICK_DT.
//
// THE POSE. An isolated run holding Taper with its timer posed to 1.0 and
// Halo, and a hound inside the aura's radius with contact off. A hundred and
// twenty ticks: the timer reads 1.0, no slash zone, the hound at full health.
// Then the switch on and one tick: the timer reads 1.0 − TICK_DT.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertWithin } from "../assert";
import { ENEMIES, FIGURE_TOLERANCE, TICK_DT } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  enemyById,
  holdWeapon,
  isolate,
  spawnEnemyAt,
  zonesOfKind,
  type Harness,
} from "../harness";

const HELD_TICKS = 120;
const POSED_COOLDOWN = 1.0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the timers and the pulses while off, then counts down from the held value", async () => {
  isolate(h);
  const taper = holdWeapon(h, "taper", 1);
  holdWeapon(h, "halo", 1);
  h.debug.setWeaponCooldown(taper, POSED_COOLDOWN);
  const hound = spawnEnemyAt(h, "hound", 30, 0);

  const held = await h.tick(HELD_TICKS);
  captureStill(h, "held");
  assertWithin(
    held.run.weapons[taper].cooldown,
    POSED_COOLDOWN,
    FIGURE_TOLERANCE,
    "Taper's timer after 120 ticks with weaponFire off",
  );
  assertLength(
    zonesOfKind(held, "slash"),
    0,
    "the slashes with weaponFire off",
  );
  assertLength(zonesOfKind(held, "aura"), 1, "the aura, placed regardless");
  assertEqual(
    enemyById(held, hound)?.hp,
    ENEMIES.hound.hp,
    "the hound inside the aura, unpulsed",
  );

  enable(h, "weaponFire");
  const counting = await h.tick(1);
  assertWithin(
    counting.run.weapons[taper].cooldown,
    POSED_COOLDOWN - TICK_DT,
    FIGURE_TOLERANCE,
    "Taper's timer one tick after weaponFire returned",
  );
});
