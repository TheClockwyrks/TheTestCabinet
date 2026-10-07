// halo/pulse-interval — Halo pulses every cooldown, and on no tick between.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Halo"): "It is a
// pulsing effect whose interval is its cooldown: on each tick the cooldown
// timer is due it pulses, every enemy whose circle overlaps the aura takes
// `damage`, and the timer is set to the current cooldown. Halo pulses on the
// first `playing` tick it is held." Row 1 gives cooldown 1.00 and damage 3,
// and with no Oil held `cooldownMul` is 1 (`specs/passives.md`), so the timer
// reads 1 after each pulse. `specs/world.md` ("Timers"): "a timer set to `s`
// seconds is due `round(s × TICK_HZ)` ticks after the tick it was set on",
// `round(1 × 60)` = 60, so the pulse on tick 1 is followed by one on tick 61
// and by none on ticks 2 through 60. ("Persistent effects"): a pulsing
// effect "damages every enemy overlapping it on each pulse tick".
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with one hound `INSIDE`
// units from the lamplighter, Halo held at level 1 with its timer at 0, and
// `weaponFire` the one switch on. The enemy with plenty of health is a hound:
// a moth's 5 hp does not outlast two pulses of 3, and a hound's 120
// (`specs/enemies.md`) reads both pulses as exact removals. `enemyContact`
// and `enemyMotion` are off, so nothing but a pulse touches it. Ticks 2
// through 60 are stepped one at a time, so a pulse on any of them is seen.
//
// THE TOLERANCE. `REAL_EPS` on each hp reading and on the timer, a table
// figure set outright; the tick is fixed exactly by the timer rule.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNear } from "../assert";
import { HALO_LEVELS, REAL_EPS, cooldownOf, ticksOf } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";
import { armHalo, hpOf, INSIDE, wasHit } from "./aura";

/** Row 1 of `HALO_LEVELS`. */
const ROW = HALO_LEVELS[0];

/** The timer after a pulse at level 1 with no Oil held: 1. */
const COOLDOWN = cooldownOf(ROW.cooldown, 0);

/** Ticks after a pulse on which the next is due: `round(1 × 60)` = 60. */
const PERIOD = ticksOf(COOLDOWN);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("pulses on tick 1 and again on tick 61, with the timer at 1 after each", async () => {
  isolate(h);
  const hound = placeEnemyNear(h, "hound", INSIDE, 0);
  const slot = armHalo(h, 1);
  const posed = hpOf(h.snapshot(), hound);

  const pulses = await captureReplay(h, "pulses", async () => {
    const first = await advanceTicks(h, 1);
    const afterFirst = hpOf(first, hound);
    const firstTimer = first.run.weapons[slot].cooldown;

    // The ticks between: one at a time, so a pulse on any of them is seen.
    const early: number[] = [];
    let hp = afterFirst;
    for (let tick = 2; tick <= PERIOD; tick += 1) {
      const s = await advanceTicks(h, 1);
      if (wasHit(s, hound, hp)) early.push(tick);
      hp = hpOf(s, hound);
    }

    const due = await advanceTicks(h, 1);
    return {
      afterFirst,
      firstTimer,
      early,
      afterDue: hpOf(due, hound),
      dueTimer: due.run.weapons[slot].cooldown,
      dueTick: due.run.tick,
    };
  });

  assertNear(
    pulses.afterFirst,
    posed - ROW.damage,
    REAL_EPS,
    `the hound's hp after tick 1, one pulse of ${ROW.damage} below ${posed} (specs/weapons.md, Halo)`,
  );
  assertNear(
    pulses.firstTimer,
    COOLDOWN,
    REAL_EPS,
    "Halo's timer after the pulse on tick 1 (specs/weapons.md, Halo)",
  );
  assertDeepEqual(
    pulses.early,
    [],
    `the ticks from 2 to ${PERIOD} on which the hound was hit (specs/world.md, Timers)`,
  );
  assertNear(
    pulses.afterDue,
    posed - 2 * ROW.damage,
    REAL_EPS,
    `the hound's hp after tick ${pulses.dueTick}, two pulses of ${ROW.damage} below ${posed} (specs/weapons.md, Halo)`,
  );
  assertNear(
    pulses.dueTimer,
    COOLDOWN,
    REAL_EPS,
    `Halo's timer after the pulse on tick ${pulses.dueTick} (specs/weapons.md, Halo)`,
  );
});
