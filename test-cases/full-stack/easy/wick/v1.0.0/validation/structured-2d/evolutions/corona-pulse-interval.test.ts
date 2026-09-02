// evolutions/corona-pulse-interval — Corona pulses every 0.5 seconds, and on
// no tick between.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Corona"): "Corona
// pulses on its first tick and on every tick its cooldown timer is due", with
// `CORONA_STATS` "where the cooldown is the pulse interval" giving cooldown
// 0.5 and damage 12. With no Oil held `cooldownMul` is 1 (`specs/passives.md`),
// so the timer reads 0.5 after each pulse, and `specs/world.md` ("Timers"): "a
// timer set to `s` seconds is due `round(s × TICK_HZ)` ticks after the tick it
// was set on", `round(0.5 × 60)` = 30. So the pulse on tick 1 is followed by
// one on tick 31 and by none on ticks 2 through 30.
//
// WHY THE ENEMY IS A HOUND. Two pulses of 12 come to 24, which a hound's 120
// base `hp` (`specs/enemies.md`) outlasts, so both pulses are read as exact
// removals rather than as a death; a moth's 5 `hp` would not survive the
// first. It stands `INSIDE` (120) units out, inside the 168 at which its
// circle and the aura's overlap (`specs/weapons.md`, Shapes and overlap), and
// `enemyMotion` is off so it stays there.
//
// WHY THE TICKS BETWEEN ARE STEPPED ONE AT A TIME. A pulse on any of them is a
// deviation, and stepping tick by tick names which one it was.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding nothing but Corona
// and that hound, `weaponFire` the one switch on so the aura pulses on its own
// schedule, everything else off so nothing spawns, moves or hits.
//
// THE TOLERANCE. `REAL_EPS` on each `hp` reading and on the timer, a row
// figure set outright; none on the ticks, which the timer rule fixes exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNear } from "../assert";
import { CORONA_STATS, ENEMIES, REAL_EPS, ticksOf } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";
import { INSIDE, holdCorona, hpOf, wasHit } from "./evolved";

/** Ticks after a pulse on which the next is due: `round(0.5 × 60)` = 30. */
const PERIOD = ticksOf(CORONA_STATS.cooldown);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("pulses on tick 1 and again on tick 31, with the timer at 0.5 after each", async () => {
  if (!(ENEMIES.hound.hp > 2 * CORONA_STATS.damage)) {
    throw new Error("the enemy must outlast two pulses");
  }

  isolate(h);
  const hound = placeEnemyNear(h, "hound", INSIDE, 0);
  const slot = holdCorona(h);
  const full = hpOf(h.snapshot(), hound);

  const pulses = await captureReplay(h, "pulses", async () => {
    const first = await advanceTicks(h, 1);
    const afterFirst = hpOf(first, hound);
    const firstTimer = first.run.weapons[slot]?.cooldown ?? Number.NaN;

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
      dueTimer: due.run.weapons[slot]?.cooldown ?? Number.NaN,
      dueTick: due.run.tick,
    };
  });

  assertNear(
    pulses.afterFirst,
    full - CORONA_STATS.damage,
    REAL_EPS,
    `the hound's hp after tick 1, one pulse of ${CORONA_STATS.damage} below ${full} (specs/evolutions.md, Corona)`,
  );
  assertNear(
    pulses.firstTimer,
    CORONA_STATS.cooldown,
    REAL_EPS,
    "Corona's timer after the pulse on tick 1 (specs/evolutions.md, CORONA_STATS)",
  );
  assertDeepEqual(
    pulses.early,
    [],
    `the ticks from 2 to ${PERIOD} on which the hound was hit (specs/world.md, Timers)`,
  );
  assertNear(
    pulses.afterDue,
    full - 2 * CORONA_STATS.damage,
    REAL_EPS,
    `the hound's hp after tick ${pulses.dueTick}, two pulses of ${CORONA_STATS.damage} below ${full} (specs/evolutions.md, Corona)`,
  );
  assertNear(
    pulses.dueTimer,
    CORONA_STATS.cooldown,
    REAL_EPS,
    `Corona's timer after the pulse on tick ${pulses.dueTick} (specs/evolutions.md, CORONA_STATS)`,
  );
});
