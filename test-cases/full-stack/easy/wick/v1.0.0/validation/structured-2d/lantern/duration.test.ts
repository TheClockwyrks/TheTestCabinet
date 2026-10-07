// lantern/duration — a set's lanterns vanish on the tick their ttl is due.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Lantern"): "each is a
// zone with `ttl` set to `duration`", and "The lanterns vanish on the tick
// their `ttl` is due." Row 1 of the level table gives duration 3.0.
// `specs/state.md` ("ZoneState"): "`ttl`: the seconds the zone has left, a
// timer as `specs/world.md` defines one ... A zone is removed on the tick
// `ttl` is due ... a Lantern lantern holds the set's `duration`."
// `specs/world.md` ("Timers"): "a timer set to `s` seconds is due
// `round(s × TICK_HZ)` ticks after the tick it was set on", which is
// `round(3.0 × 60)` = 180 ticks after the firing tick; and ("One tick"),
// phase 6: "Every projectile and zone that existed before this tick counts its
// `ttl` down and is removed when it is due", so the firing tick itself counts
// nothing down and the lantern reads 3.0 on it, is in `zones` after the 179th
// tick after it, and is gone after the 180th.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with no enemy and no
// passive, Lantern at level 1 armed, `weaponFire` on and every other switch
// off. Nothing but its `ttl` can remove the lantern: no enemy exists, no
// switch removes a zone, and `effectMotion` off leaves the set standing where
// it was created while "`ttl` and every re-hit entry still count"
// (`specs/instrumentation.md`). `weaponFire` stays on through the wait, as the
// game is played; the next firing is due 360 ticks after this one, past the
// 180 this check covers, and the lantern is read by its own id in any case.
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
import { LANTERN_LEVELS, REAL_EPS, ticksOf } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  zoneById,
  type Harness,
} from "../harness";
import { fireLantern } from "./set";

/** Row 1 of Lantern: one lantern, duration 3.0. */
const LEVEL = 1;
const DURATION = LANTERN_LEVELS[LEVEL - 1].duration;

/** The tick the ttl is due on: `round(3.0 × 60)` = 180 after the firing. */
const DUE = ticksOf(DURATION);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads a level-1 lantern's ttl as 3.0 on its firing tick, keeps it through tick 179, and removes it on tick 180", async () => {
  const firing = await fireLantern(h, LEVEL);
  const lantern = firing.lanterns[0];
  assertDefined(
    lantern,
    "a lantern the firing tick created (specs/weapons.md, Lantern)",
  );
  assertNear(
    lantern.ttl ?? Number.NaN,
    DURATION,
    REAL_EPS,
    `the lantern's ttl on its firing tick at level ${LEVEL} (specs/state.md, ZoneState)`,
  );

  const expiry = await captureReplay(h, "vanished", async () => {
    const lastLive = await advanceTicks(h, DUE - 1);
    const live = zoneById(lastLive, lantern.id);
    const due = await advanceTicks(h, 1);
    return {
      live,
      gone: zoneById(due, lantern.id),
      tick: due.run.tick - firing.after.run.tick,
    };
  });

  assertDefined(
    expiry.live,
    `the lantern in zones on tick ${DUE - 1} after the firing (specs/weapons.md, Lantern)`,
  );
  assertEqual(expiry.tick, DUE, "the ticks stepped to the due tick");
  assertUndefined(
    expiry.gone,
    `the lantern in zones on tick ${DUE} after the firing, the tick its ttl is due (specs/weapons.md, Lantern)`,
  );
});
