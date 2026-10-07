// Wick — evolutions/corona-pulse-interval: Corona pulses again on the tick its
// timer is due, once every 0.5 seconds, and on no tick between.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Corona"): "Corona pulses on its first tick and on
//     every tick its cooldown timer is due; each pulse deals `damage` to every
//     enemy whose circle overlaps the aura"; the fixed row is `CORONA_STATS`,
//     "where the cooldown is the pulse interval": `0.5`, with damage `12` and
//     radius `150`.
//   - `specs/evolutions.md` ("Passives still apply"): cooldown is "the fixed
//     cooldown times `cooldownMul`, floored at `MIN_COOLDOWN` (`0.2`)", `0.5`
//     with no Oil held (`specs/passives.md`).
//   - `specs/world.md` ("Timers"): "a timer set to `s` seconds is due
//     `round(s × TICK_HZ)` ticks after the tick it was set on", so a timer set
//     to `0.5` on the first pulse's tick is due 30 ticks later, on tick 31.
//   - `specs/weapons.md` ("Shapes and overlap"): a hound of radius `18`
//     standing 40 units out is inside an aura of 150; `specs/enemies.md`: a
//     hound has HP `120`, so it outlasts the two pulses of 12 and each pulse
//     shows as a fall in its `hp`.
//   - `specs/instrumentation.md`: "`setWeaponCooldown(slot, 0)` makes that the
//     next tick" the weapon fires on, so the first pulse is posed onto tick 1
//     and the point rests on the interval alone.
//
// WHAT IS READ. The hound's `hp` after each of 31 ticks, as the list of ticks on
// which it fell: exactly 1 and 31. A build pulsing every tick, never again, or
// a tick early or late produces a different list.
//
// WHY THE NIGHT IS POSED AS IT IS. Corona alone and one hound 40 units along
// `+x`, inside the fixed radius; every driver switch off but `weaponFire`, so
// nothing moves the hound, nothing touches it, no director removes it, and the
// pulses are the only thing that can change it.
//
// TOLERANCE. `FIGURE_TOLERANCE` on the hp read after the last tick, exact
// arithmetic on stated figures. None on the ticks: the timer rule fixes the
// second pulse to a whole count, and a build a tick out has broken the stated
// rule.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertWithin } from "../assert";
import {
  CORONA_STATS,
  ENEMIES,
  FIGURE_TOLERANCE,
  ticksFor,
} from "../constants";
import {
  captureReplay,
  createHarness,
  enemyById,
  present,
  spawnEnemyNear,
  type Harness,
} from "../harness";
import { armEvolved } from "./evolved";
import { PROBE_DX } from "./corona";

/** The probe: a hound, HP 120 and radius 18, which outlasts two pulses. */
const PROBE = "hound";

/** The ticks between one pulse and the next: round(0.5 × 60). */
const PERIOD_TICKS = ticksFor(CORONA_STATS.cooldown);

/** The ticks watched from the pose: the first pulse and the second. */
const WATCH_TICKS = 1 + PERIOD_TICKS;

/** The ticks a pulse is due on: 1 and 31. */
const EXPECTED = [1, 1 + PERIOD_TICKS];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("damages the hound on ticks 1 and 31 and on no tick between", async () => {
  armEvolved(h, "corona");
  const hound = spawnEnemyNear(h, PROBE, PROBE_DX, 0);

  const seen = await captureReplay(h, "pulses", () => h.trace(WATCH_TICKS));

  const falls: number[] = [];
  let held = ENEMIES[PROBE].hp;
  seen.forEach((snapshot, index) => {
    const tick = index + 1;
    const now = present(
      enemyById(snapshot, hound),
      `the hound after tick ${tick}`,
    );
    if (now.hp < held) falls.push(tick);
    held = now.hp;
  });

  assertDeepEqual(falls, EXPECTED, "the ticks on which the hound's hp fell");
  assertWithin(
    held,
    ENEMIES[PROBE].hp - EXPECTED.length * CORONA_STATS.damage,
    FIGURE_TOLERANCE,
    `the hound's hp after tick ${WATCH_TICKS}, two pulses of 12 in`,
  );
});
