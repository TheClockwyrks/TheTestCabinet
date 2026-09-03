// Wick — oil-splash/puddle-duration: a puddle holds its `duration` as its
// ttl and vanishes on the tick that ttl is due.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Oil Splash"): "A puddle is a circle of `radius`
//     that stays where it landed for `duration` seconds and then vanishes";
//     row 1: "| 1 | 4 | 3.0 | 50 | 2.5 | 1 |", duration 2.5.
//   - `specs/state.md` (`ZoneState`, `ttl`): "the seconds the zone has left, a
//     timer as `specs/world.md` defines one ... A zone is removed on the tick
//     `ttl` is due ... a puddle [holds] its `duration`."
//   - `specs/world.md` ("Timers"): "a timer set to `s` seconds is due
//     `round(s × TICK_HZ)` ticks after the tick it was set on", so a ttl of
//     2.5 is due 150 ticks after the firing tick.
//   - `specs/world.md` ("One tick", phase 6): "Every projectile and zone that
//     existed before this tick counts its `ttl` down and is removed when it is
//     due", so the puddle stands through the 149th tick after its firing and
//     is gone on the 150th.
//
// WHAT IS READ. The puddle's `ttl` on its firing tick, 2.5; then the zone is
// followed by id across the 150 ticks after: present after each of the first
// 149, absent after the 150th.
//
// WHY THE NIGHT IS POSED AS IT IS. Oil Splash alone at level 1 with every
// switch but `weaponFire` off, and nothing on the field, so the one puddle is
// the only zone and nothing else is created or removed. Oil Splash's timer is
// 3 after the firing, 180 ticks, so no second puddle arrives inside the 150.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on the ttl reading, a stated figure
// read back; none on the tick count, which the spec states exactly through
// `round`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDefined,
  assertLessThan,
  assertUndefined,
  assertWithin,
} from "../assert";
import { FIGURE_TOLERANCE, ticksFor } from "../constants";
import {
  captureReplay,
  createHarness,
  present,
  zoneById,
  type Harness,
} from "../harness";
import { armOilSplash, fireOnce, oilRow } from "./puddle";

/** The level held, and the row whose duration is read. */
const LEVEL = 1;
const ROW = oilRow(LEVEL);

/** Ticks from the firing to the removal: round(2.5 × 60) = 150. */
const LIFE_TICKS = ticksFor(ROW.duration);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads ttl 2.5 on the firing tick and is gone on the 150th tick after", async () => {
  assertLessThan(
    LIFE_TICKS,
    ticksFor(ROW.cooldown),
    "the puddle's life against Oil Splash's cooldown, so no second firing joins the trace",
  );
  const { slot } = armOilSplash(h, LEVEL);

  const outcome = await captureReplay(h, "vanished", async () => {
    const { created } = await fireOnce(h, slot);
    const following = await h.trace(LIFE_TICKS);
    return { created, following };
  });

  const puddle = present(
    outcome.created[0],
    "a puddle created on the firing tick",
  );
  assertWithin(
    puddle.ttl ?? Number.NaN,
    ROW.duration,
    FIGURE_TOLERANCE,
    "the puddle's ttl on its firing tick",
  );
  for (let tick = 1; tick < LIFE_TICKS; tick += 1) {
    assertDefined(
      zoneById(outcome.following[tick - 1], puddle.id),
      `the puddle on the tick ${tick} after its firing`,
    );
  }
  assertUndefined(
    zoneById(outcome.following[LIFE_TICKS - 1], puddle.id),
    `the puddle on the tick ${LIFE_TICKS} after its firing`,
  );
});
