// lantern/timer-covers-set-and-gap — Lantern's timer covers the set's life and
// the gap after it.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Lantern"): "On firing,
// Lantern's cooldown timer is set to `duration` plus the current cooldown,
// both read on that tick, so the timer is due once the set has been gone for
// the cooldown and one set is in the world at a time." Row 1 of the level
// table gives duration 3.0 and cooldown 3.0, and with no Oil held
// `cooldownMul` is 1 (`specs/passives.md`), so the timer reads 6.0 on the
// firing tick. `specs/world.md` ("Timers"): "a timer set to `s` seconds is due
// `round(s × TICK_HZ)` ticks after the tick it was set on", so
// `round(3.0 × 60)` = 180 ticks after the firing the set's `ttl` is due and
// its lanterns vanish, `round(6.0 × 60)` = 360 ticks after the firing the
// weapon's timer is due and the next set is created, and across the 180 ticks
// between the two the world holds no lantern at all.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with no enemy and no
// passive, Lantern at level 1 armed, `weaponFire` on and every other switch
// off, and every one of the 360 ticks sampled: what is graded is which ticks
// held a lantern zone, so a build whose set outlives its duration, whose gap
// is short or long, or which never fires a second set fails by naming the tick
// that was wrong. `effectMotion` is off, which leaves the set standing while
// "`ttl` and every re-hit entry still count"
// (`specs/instrumentation.md`), so nothing but the two timers decides the
// trace. The second set is identified by id — every zone it holds was created
// after the first firing — so a build that never removed the first set cannot
// pass by presenting it again.
//
// THE TOLERANCE. `REAL_EPS` on the timer read on the firing tick, a sum of two
// table figures; none on either tick, which the timer rule fixes exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { LANTERN_LEVELS, REAL_EPS, ticksOf } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";
import { fireLantern, lanternsCreatedSince, lanternsOf } from "./set";

/** Row 1 of Lantern: one lantern, duration 3.0, cooldown 3.0. */
const LEVEL = 1;
const ROW = LANTERN_LEVELS[LEVEL - 1];

/** What the firing leaves on the timer: `duration` plus the current cooldown. */
const TIMER = ROW.duration + ROW.cooldown;

/** The tick after the firing the set vanishes on: `round(3.0 × 60)` = 180. */
const LIFE = ticksOf(ROW.duration);

/** The tick after the firing the next set appears on: `round(6.0 × 60)` = 360. */
const NEXT = ticksOf(TIMER);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("sets a level-1 firing's timer to 6.0, empties the field on tick 180, and fires the next set on tick 360", async () => {
  const firing = await fireLantern(h, LEVEL);
  assertEqual(
    firing.lanterns.length,
    ROW.amount,
    `the lanterns the first firing created at level ${LEVEL} (specs/weapons.md, Lantern)`,
  );
  assertNear(
    firing.after.run.weapons[firing.slot].cooldown,
    TIMER,
    REAL_EPS,
    `Lantern's timer on the firing tick, its duration plus its cooldown (specs/weapons.md, Lantern)`,
  );

  const trace = await captureReplay(h, "gap", async () => {
    /** Whether tick `i + 1` after the firing held any lantern zone. */
    const held: boolean[] = [];
    let fresh = 0;
    for (let tick = 1; tick <= NEXT; tick += 1) {
      const s = await advanceTicks(h, 1);
      held.push(lanternsOf(s).length > 0);
      if (tick === NEXT) {
        fresh = lanternsCreatedSince(firing.after, s).length;
      }
    }
    return { held, fresh };
  });

  assertEqual(
    trace.held.indexOf(false) + 1,
    LIFE,
    `the first tick after the firing on which the field held no lantern (specs/weapons.md, Lantern), 0 meaning the set never vanished within ${NEXT} ticks`,
  );
  assertEqual(
    trace.held.indexOf(true, LIFE) + 1,
    NEXT,
    `the first tick after the field emptied on which a lantern stood again (specs/weapons.md, Lantern), 0 meaning no second set arrived within ${NEXT} ticks`,
  );
  assertEqual(
    trace.fresh,
    ROW.amount,
    `the lanterns created since the first firing that stood on tick ${NEXT} (specs/weapons.md, Lantern)`,
  );
});
