// Wick — spark/strike-flash: a strike zone holds `SPARK_FLASH` as its ttl and
// is removed on the tick that ttl is due.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Spark"): "The strike is drawn for `SPARK_FLASH`
//     (`0.2`) seconds".
//   - `specs/state.md` (`ZoneState`, `ttl`): "the seconds the zone has left, a
//     timer as `specs/world.md` defines one ... A zone is removed on the tick
//     `ttl` is due. ... a strike `SPARK_FLASH` (`0.2`)".
//   - `specs/world.md` ("Timers"): "a timer set to `s` seconds is due
//     `round(s × TICK_HZ)` ticks after the tick it was set on", so a ttl of
//     0.2 is due 12 ticks after the landing tick.
//   - `specs/world.md` ("One tick", phase 6): "Every projectile and zone that
//     existed before this tick counts its `ttl` down and is removed when it is
//     due", so the strike stands through the 11th tick after its landing and
//     is gone on the 12th.
//
// WHAT IS READ. The strike's `ttl` on its landing tick, 0.2; then the zone is
// followed by id across the twelve ticks after: present after each of the
// first eleven, absent after the twelfth.
//
// WHY THE NIGHT IS POSED AS IT IS. One moth within range and Spark alone at
// level 1, every switch but `weaponFire` off, so the one strike is the only
// zone and nothing else is created or removed. Spark's timer is 2.0 after the
// landing, so no second strike arrives inside the twelve ticks. The moth dies
// on the landing tick (HP 5 against 15) and drops a gem far outside
// `PICKUP_RADIUS`, which touches no zone.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on the ttl reading, a stated figure
// read back; none on the tick count, which the spec states exactly through
// `round`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDefined,
  assertEqual,
  assertUndefined,
  assertWithin,
} from "../assert";
import { FIGURE_TOLERANCE, SPARK_FLASH, ticksFor } from "../constants";
import {
  captureReplay,
  createHarness,
  zoneById,
  type Harness,
} from "../harness";
import { armSpark, strikesIn, targetsFor } from "./strike";

/** The level held: amount 1, one strike. */
const LEVEL = 1;

/** Ticks from the landing to the removal: round(0.2 × 60) = 12. */
const FLASH_TICKS = ticksFor(SPARK_FLASH);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads ttl 0.2 on the landing tick and is gone on the 12th tick after", async () => {
  armSpark(h, LEVEL, targetsFor(1));

  const outcome = await captureReplay(h, "flash", async () => {
    const landed = await h.tick(1);
    const strikes = strikesIn(landed);
    const id = strikes[0]?.id;
    const following = await h.trace(FLASH_TICKS);
    return { landed, strikes, id, following };
  });

  assertEqual(outcome.strikes.length, 1, "strikes on the landing tick");
  const strike = outcome.strikes[0];
  assertWithin(
    strike.ttl ?? Number.NaN,
    SPARK_FLASH,
    FIGURE_TOLERANCE,
    "the strike's ttl on its landing tick",
  );
  assertDefined(outcome.id, "the strike's id");
  for (let tick = 1; tick < FLASH_TICKS; tick += 1) {
    assertDefined(
      zoneById(outcome.following[tick - 1], outcome.id),
      `the strike on the tick ${tick} after its landing`,
    );
  }
  assertUndefined(
    zoneById(outcome.following[FLASH_TICKS - 1], outcome.id),
    `the strike on the tick ${FLASH_TICKS} after its landing`,
  );
});
