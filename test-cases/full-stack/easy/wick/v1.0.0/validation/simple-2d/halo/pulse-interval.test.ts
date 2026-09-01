// Wick — halo/pulse-interval: Halo pulses again on the tick its timer is due,
// once every cooldown, and on no tick between.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Halo"): "It is a pulsing effect whose interval is
//     its cooldown: on each tick the cooldown timer is due it pulses, every
//     enemy whose circle overlaps the aura takes `damage`, and the timer is set
//     to the current cooldown." Level 1 has damage `3` and cooldown `1.00`.
//   - `specs/weapons.md` ("Cooldown timers"): "The current cooldown is the
//     table cooldown times `cooldownMul`, floored at `MIN_COOLDOWN`", `1.00`
//     with no Oil held (`specs/passives.md`).
//   - `specs/world.md` ("Timers"): "a timer set to `s` seconds is due
//     `round(s × TICK_HZ)` ticks after the tick it was set on", so a timer set
//     to `1.00` on the first pulse's tick is due 60 ticks later, on tick 61.
//   - `specs/weapons.md` ("Persistent effects"): "A pulsing effect (the Halo
//     aura and Oil Splash puddles) damages every enemy overlapping it on each
//     pulse tick, and the interval is the time between pulses."
//   - `specs/weapons.md` ("Hits and death"): "On any tick an enemy's `hp` is at
//     or below `0` after the hits the enemy dies on that tick"; a moth has HP
//     `5` (`specs/enemies.md`).
//
//   - `specs/instrumentation.md`: "`setWeaponCooldown(slot, 0)` makes that
//     the next tick" the weapon fires on, so the first pulse is posed onto
//     tick 1 and the point rests on the interval alone.
//
// WHAT IS READ. Tick by tick over 61 ticks: the moth's `hp` and Halo's timer.
// On tick 1 the moth reads 5 − 3 = 2 and the timer 1.00; on ticks 2 to 60 the
// moth stands at exactly 2; on tick 61 the pulse lands again, which takes the
// moth to −1 and so out of `enemies` on that tick, and the timer reads 1.00
// again. The second pulse is read as the moth gone, since nothing else on the
// posed night can remove it.
//
// WHY THE NIGHT IS POSED AS IT IS. Halo alone at level 1 and one moth 40 units
// along +x, inside the level-1 radius of 80; every switch off but
// `weaponFire`, so nothing moves the moth, nothing touches it, no director
// removes it, and the pulses are the only thing that can change it.
//
// TOLERANCE. `FIGURE_TOLERANCE` on each hp and timer reading, stated figures
// read back as doubles. None on the ticks: the timer rule fixes the second
// pulse to a whole count, and a build a tick out has broken the stated rule.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ticksFor } from "../constants";
import {
  captureReplay,
  armWeapon,
  createHarness,
  enemyById,
  present,
  type Harness,
} from "../harness";
import {
  assertProbeTook,
  assertProbeUnhurt,
  assertTimerOfRow,
  haloRow,
  poseHalo,
} from "./aura";

/** The level this point holds Halo at. */
const LEVEL = 1;

/** Row 1 of HALO_LEVELS: damage 3, cooldown 1.00. */
const ROW = haloRow(LEVEL);

/** The ticks between one pulse and the next: round(1.00 × 60). */
const PERIOD_TICKS = ticksFor(ROW.cooldown);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("pulses on tick 1 and again on tick 61, with the timer at 1.00 after each", async () => {
  const { slot, probe, posed } = poseHalo(h, LEVEL);
  const moth = present(probe, "the posed moth's id");
  armWeapon(h, slot);

  const trace = await captureReplay(h, "pulses", () =>
    h.trace(PERIOD_TICKS + 1),
  );

  // The first pulse, on the first tick.
  const first = trace[0];
  assertProbeTook(posed, first, moth, ROW.damage, "the moth after tick 1");
  assertTimerOfRow(first, slot, ROW, "Halo's timer after the first pulse");

  // Nothing between.
  for (let index = 1; index < PERIOD_TICKS; index += 1) {
    assertProbeUnhurt(
      first,
      trace[index],
      moth,
      `the moth on tick ${index + 1}`,
    );
  }

  // The second pulse, on the tick the timer is due.
  const second = trace[PERIOD_TICKS];
  assertEqual(
    enemyById(second, moth),
    undefined,
    `the moth on tick ${PERIOD_TICKS + 1}, taken from 2 to −1 by the second pulse`,
  );
  assertTimerOfRow(second, slot, ROW, "Halo's timer after the second pulse");
});
