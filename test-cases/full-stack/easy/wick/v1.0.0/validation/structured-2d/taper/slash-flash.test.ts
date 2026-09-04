// Wick — taper/slash-flash: a slash zone lives `SLASH_FLASH` seconds, six
// ticks, and is gone on the sixth tick after its firing.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Taper"): "The slash is drawn for `SLASH_FLASH`
//     (`0.1`) seconds."
//   - `specs/world.md` ("Timers"): "a timer set to `s` seconds is due
//     `round(s × TICK_HZ)` ticks after the tick it was set on", and "every
//     `ttl` all count this way". `round(0.1 × 60)` is 6.
//   - `specs/world.md` ("One tick"), phase 6: "Every projectile and zone that
//     existed before this tick counts its `ttl` down and is removed when it
//     is due". A zone created on tick `t` therefore counts on ticks `t + 1`
//     to `t + 6` and is removed on `t + 6`.
//   - `specs/instrumentation.md` ("Snapshot shape"): `zones[].ttl` is the
//     zone's timer, so the slash reads `ttl` 0.1 on its firing tick.
//
// THE DRIVE. An isolated run with no enemy, Taper at level 1 armed and
// `weaponFire` the one switch on. The firing tick runs: one slash with `ttl`
// 0.1. Then five more ticks, on each of which the slash is still in `zones`,
// and a sixth, after which it is gone. Taper's timer is 1.35 after the
// firing, so no second slash arrives inside the six ticks.
//
// TOLERANCE. `REAL_EPS` on the `ttl` read on the firing tick, one stated
// real; `MOTION_EPS` on the `ttl` read on the fifth tick after, `TICK_DT`
// after five count-downs; the presence readings are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import {
  MOTION_EPS,
  REAL_EPS,
  SLASH_FLASH,
  TICK_DT,
  ticksOf,
} from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  isolate,
  zoneById,
  zonesOfKind,
  type Harness,
} from "../harness";
import { armTaper } from "./slash";

/** The row under test: level 1. */
const LEVEL = 1;

/** The ticks a slash lives after its firing tick: `round(0.1 × 60)`. */
const FLASH_TICKS = ticksOf(SLASH_FLASH);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps the slash for five ticks after the firing and drops it on the sixth", async () => {
  isolate(h);
  armTaper(h, LEVEL);

  const flash = await captureReplay(h, "flash", async () => {
    const fired = await advanceTicks(h, 1);
    const slashes = zonesOfKind(fired, "slash");
    const id = slashes[0]?.id;
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
      count: slashes.length,
      firedTtl: slashes[0]?.ttl ?? null,
      present,
      lastTtl,
      onSixth: id === undefined ? undefined : zoneById(gone, id),
    };
  });

  assertEqual(flash.count, 1, "the slashes the firing tick created");
  assertNear(
    flash.firedTtl ?? Number.NaN,
    SLASH_FLASH,
    REAL_EPS,
    "the slash's ttl on its firing tick",
  );
  for (let tick = 1; tick < FLASH_TICKS; tick += 1) {
    assertEqual(
      flash.present[tick - 1],
      true,
      `the slash still in zones on the ${tick}th tick after the firing`,
    );
  }
  assertNear(
    flash.lastTtl,
    TICK_DT,
    MOTION_EPS,
    `the slash's ttl on the ${FLASH_TICKS - 1}th tick after the firing`,
  );
  assertEqual(
    flash.onSixth,
    undefined,
    `the slash on the ${FLASH_TICKS}th tick after the firing`,
  );
});
