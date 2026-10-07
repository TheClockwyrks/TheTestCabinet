// flare/burst-flash — a burst zone lives `FLARE_FLASH` seconds, twenty-four
// ticks, and is gone on the twenty-fourth tick after its firing.
//
// WHERE THE THRESHOLD COMES FROM.
//   - `specs/weapons.md` ("Flare"): "The burst is drawn for `FLARE_FLASH`
//     (`0.4`) seconds", with row 1's radius of 640 from the level table, and
//     a burst's `radius` "is its Flare `radius`" (Shapes and overlap).
//   - `specs/state.md` (`ZoneState`, `ttl`): "a burst `FLARE_FLASH` (`0.4`)",
//     the zone's `ttl` on the tick it appears.
//   - `specs/world.md` ("Timers"): "a timer set to `s` seconds is due
//     `round(s × TICK_HZ)` ticks after the tick it was set on", and "every
//     `ttl` all count this way". `round(0.4 × 60)` is 24.
//   - `specs/world.md` ("One tick"), phase 6: "Every projectile and zone that
//     existed before this tick counts its `ttl` down and is removed when it
//     is due". A zone created on tick `t` therefore counts on ticks `t + 1`
//     to `t + 24` and is removed on `t + 24`, so it is still in `zones` on
//     each of the twenty-three ticks between, reading `TICK_DT` of `ttl` on
//     the last of them.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding no enemy, with
// Flare held at level 1, its timer at 0 and `weaponFire` the one switch on, so
// the first tick fires and every tick after it is the burst ageing and nothing
// else. Flare's timer reads 60 after the firing, far beyond the twenty-four
// ticks driven, so no second burst joins the one being counted, and with the
// field empty no death, drop, or contact falls inside the span.
//
// THE TOLERANCE. `REAL_EPS` on the radius and on the `ttl` read on the firing
// tick, each a stated real; `MOTION_EPS` on the `ttl` read on the
// twenty-third tick after, `TICK_DT` after twenty-three count-downs; the
// presence readings are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import {
  FLARE_FLASH,
  FLARE_LEVELS,
  MOTION_EPS,
  REAL_EPS,
  TICK_DT,
  ticksOf,
} from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  isolate,
  zoneById,
  type Harness,
} from "../harness";
import { armFlare, bursts } from "./burst";

/** The row under test: radius 640. */
const LEVEL = 1;
const ROW = FLARE_LEVELS[LEVEL - 1];

/** The ticks a burst lives after its firing tick: `round(0.4 × 60)`. */
const FLASH_TICKS = ticksOf(FLARE_FLASH);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps the burst for twenty-three ticks after the firing and drops it on the twenty-fourth", async () => {
  isolate(h);
  armFlare(h, LEVEL);

  const flash = await captureReplay(h, "flash", async () => {
    const fired = await advanceTicks(h, 1);
    const created = bursts(fired);
    const id = created[0]?.id;
    const present: boolean[] = [];
    let lastTtl = Number.NaN;
    for (let tick = 1; tick < FLASH_TICKS; tick += 1) {
      const s = await advanceTicks(h, 1);
      const zone = id === undefined ? undefined : zoneById(s, id);
      present.push(zone !== undefined);
      if (zone !== undefined && tick === FLASH_TICKS - 1) {
        lastTtl = zone.ttl ?? Number.NaN;
      }
    }
    const gone = await advanceTicks(h, 1);
    return {
      count: created.length,
      radius: created[0]?.radius ?? Number.NaN,
      firedTtl: created[0]?.ttl ?? Number.NaN,
      present,
      lastTtl,
      onLast: id === undefined ? undefined : zoneById(gone, id),
    };
  });

  assertEqual(flash.count, 1, "the burst zones the firing tick created");
  assertNear(
    flash.radius,
    ROW.radius,
    REAL_EPS,
    "the burst's radius on its firing tick",
  );
  assertNear(
    flash.firedTtl,
    FLARE_FLASH,
    REAL_EPS,
    "the burst's ttl on its firing tick",
  );
  for (let tick = 1; tick < FLASH_TICKS; tick += 1) {
    assertEqual(
      flash.present[tick - 1],
      true,
      `the burst still in zones on the ${tick}th tick after the firing`,
    );
  }
  assertNear(
    flash.lastTtl,
    TICK_DT,
    MOTION_EPS,
    `the burst's ttl on the ${FLASH_TICKS - 1}th tick after the firing`,
  );
  assertEqual(
    flash.onLast,
    undefined,
    `the burst on the ${FLASH_TICKS}th tick after the firing`,
  );
});
