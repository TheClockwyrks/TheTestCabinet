// oil-splash/puddle-duration — a puddle vanishes when its duration is due.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Oil Splash"): "A
// puddle is a circle of `radius` that stays where it landed for `duration`
// seconds and then vanishes", and the level table, row 1, gives duration
// 2.5. `specs/state.md` ("ZoneState"): "`ttl`: the seconds the zone has
// left, a timer as `specs/world.md` defines one ... A zone is removed on the
// tick `ttl` is due ... a puddle [holds] its `duration`." `specs/world.md`
// ("Timers"): "a timer set to `s` seconds is due `round(s × TICK_HZ)` ticks
// after the tick it was set on", which is `round(2.5 × 60)` = 150 ticks after
// the firing tick; and ("One tick"), phase 6: "Every projectile and zone that
// existed before this tick counts its `ttl` down and is removed when it is
// due", so the firing tick itself counts nothing down and the puddle reads
// 2.5 on it, is in `zones` after the 149th tick after it, and is gone after
// the 150th.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with no enemy and no
// passive, Oil Splash at level 1 armed, `weaponFire` on and every other switch
// off. `weaponFire` stays on through the wait, as the game is played; the
// next firing is due 180 ticks after the first, past the 150 this check
// covers, and the puddle is read by its own id in any case. Nothing but its
// `ttl` can remove a puddle: no enemy exists, and no switch removes a zone.
//
// THE TOLERANCE. `REAL_EPS` on the `ttl` read on the firing tick, a table
// figure copied unchanged; none on the ticks, which the timer rule fixes
// exactly.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDefined,
  assertEqual,
  assertNear,
  assertUndefined,
} from "../assert";
import { OIL_SPLASH_LEVELS, REAL_EPS, ticksOf } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  zoneById,
  type Harness,
} from "../harness";
import { fireOilSplash } from "./firing";

/** Level 1 of Oil Splash: duration 2.5. */
const LEVEL = 1;
const DURATION = OIL_SPLASH_LEVELS[LEVEL - 1].duration;

/** The tick the puddle's `ttl` is due on: `round(2.5 × 60)` = 150 after the firing. */
const DUE = ticksOf(DURATION);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads a level-1 puddle's ttl as 2.5 on its firing tick, keeps it through tick 149, and removes it on tick 150", async () => {
  const firing = await fireOilSplash(h, LEVEL);
  const puddle = firing.puddles[0];
  assertDefined(
    puddle,
    "a puddle the firing tick created (specs/weapons.md, Oil Splash)",
  );
  assertNear(
    puddle.ttl ?? NaN,
    DURATION,
    REAL_EPS,
    `the puddle's ttl on its firing tick at level ${LEVEL} (specs/state.md, ZoneState)`,
  );

  const expiry = await captureReplay(h, "vanished", async () => {
    const lastLive = await advanceTicks(h, DUE - 1);
    const live = zoneById(lastLive, puddle.id);
    const due = await advanceTicks(h, 1);
    return {
      live,
      gone: zoneById(due, puddle.id),
      tick: due.run.tick - firing.after.run.tick,
    };
  });

  assertDefined(
    expiry.live,
    `the puddle in zones on tick ${DUE - 1} after the firing (specs/weapons.md, Oil Splash)`,
  );
  assertEqual(expiry.tick, DUE, "the ticks stepped to the due tick");
  assertUndefined(
    expiry.gone,
    `the puddle in zones on tick ${DUE} after the firing, the tick its ttl is due (specs/state.md, ZoneState)`,
  );
});
