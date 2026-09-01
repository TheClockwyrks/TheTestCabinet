// Wick — instrumentation/set-weapon-cooldown: `setWeaponCooldown(0, 0.5)`
// reads back cooldown 0.5 on that slot, and with `weaponFire` on the weapon
// fires on the 30th tick after the call.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `setWeaponCooldown(slot, seconds)`): "Sets the cooldown timer of the weapon
// in `slot`, a held slot, to `seconds`, at least `0`." specs/world.md —
// "Timers": "a timer set to `s` seconds is due `round(s × TICK_HZ)` ticks
// after the tick it was set on"; `round(0.5 × 60)` is 30. specs/weapons.md:
// "the weapon fires again on the tick the timer is due"; Pin "fires whether or
// not any enemy exists".
//
// WHY THE WORLD IS POSED AS IT IS. Pin is held alone on an isolated night, so
// the only projectiles that can appear are its darts; the frames are stepped
// one at a time so the tick of the firing is read exactly, and none before it
// may have fired.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { dueTicks } from "../constants";
import {
  captureReplay,
  createHarness,
  holdWeapon,
  isolate,
  type Harness,
} from "../harness";

const POSED_SECONDS = 0.5;
const DUE_TICK = dueTicks(POSED_SECONDS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("poses a weapon's timer, and the weapon fires when it is due", async () => {
  await isolate(h);
  const slot = await holdWeapon(h, "pin", 1);
  await h.debug.setWeaponCooldown(slot, POSED_SECONDS);
  const posed = await h.snapshot();
  assertEqual(posed.run.weapons[slot]?.cooldown, POSED_SECONDS, "the timer after the pose");
  await h.debug.setWeaponFire(true);

  const seen = await captureReplay(h, "timed", () => h.stepWatching(DUE_TICK + 1));

  for (let frame = 1; frame < DUE_TICK; frame += 1) {
    assertLength(
      seen[frame - 1]!.run.projectiles,
      0,
      `projectiles on tick ${frame}, before the timer is due`,
    );
  }
  assertGreaterThan(
    seen[DUE_TICK - 1]!.run.projectiles.length,
    0,
    `projectiles on tick ${DUE_TICK}, when the timer is due`,
  );
});
