// spark/strike-flash — a strike zone lives `SPARK_FLASH` seconds, twelve
// ticks, and is gone on the twelfth tick after its landing.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Spark"): "The strike is drawn for `SPARK_FLASH`
//     (`0.2`) seconds".
//   - `specs/state.md` (`ZoneState`, `ttl`): "a strike `SPARK_FLASH`
//     (`0.2`)", the zone's `ttl` on the tick it appears.
//   - `specs/world.md` ("Timers"): "a timer set to `s` seconds is due
//     `round(s × TICK_HZ)` ticks after the tick it was set on", and "every
//     `ttl` all count this way". `round(0.2 × 60)` is 12.
//   - `specs/world.md` ("One tick"), phase 6: "Every projectile and zone that
//     existed before this tick counts its `ttl` down and is removed when it
//     is due". A zone created on tick `t` therefore counts on ticks `t + 1`
//     to `t + 12` and is removed on `t + 12`.
//   - `specs/instrumentation.md` ("Snapshot shape"): `zones[].ttl` is the
//     zone's timer, so the strike reads `ttl` 0.2 on its landing tick.
//
// THE DRIVE. An isolated run with one moth at the first post of
// `TARGET_POSTS`, 300 units out, Spark at level 1 armed and `weaponFire` the
// one switch on. The firing tick runs: one strike zone with `ttl` 0.2, on
// the moth, which dies on that tick. Then eleven more ticks, on each of
// which the zone is still in `zones`, and a twelfth, after which it is gone.
// Spark's timer is 2.0 after the firing, so no second strike arrives inside
// the twelve ticks, and no enemy is left for one to land on.
//
// TOLERANCE. `REAL_EPS` on the `ttl` read on the landing tick, one stated
// real; `MOTION_EPS` on the `ttl` read on the eleventh tick after,
// `TICK_DT` after eleven count-downs; the presence readings are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import {
  MOTION_EPS,
  REAL_EPS,
  SPARK_FLASH,
  TICK_DT,
  ticksOf,
} from "../constants";
import {
  advanceTicks,
  armWeapon,
  captureReplay,
  createHarness,
  holdWeapon,
  isolate,
  placeEnemyNear,
  zoneById,
  zonesCreatedSince,
  type Harness,
} from "../harness";
import { TARGET_POSTS } from "./strike";

/** The row under test: level 1. */
const LEVEL = 1;

/** The ticks a strike lives after its landing tick: `round(0.2 × 60)`. */
const FLASH_TICKS = ticksOf(SPARK_FLASH);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps the strike for eleven ticks after the landing and drops it on the twelfth", async () => {
  isolate(h);
  placeEnemyNear(h, "moth", TARGET_POSTS[0].x, TARGET_POSTS[0].y);
  const slot = holdWeapon(h, "spark", LEVEL);
  armWeapon(h, slot);
  const before = h.snapshot();

  const flash = await captureReplay(h, "flash", async () => {
    const fired = await advanceTicks(h, 1);
    const strikes = zonesCreatedSince(before, fired).filter(
      (zone) => zone.kind === "strike",
    );
    const id = strikes[0]?.id;
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
      count: strikes.length,
      landedTtl: strikes[0]?.ttl ?? null,
      present,
      lastTtl,
      onTwelfth: id === undefined ? undefined : zoneById(gone, id),
    };
  });

  assertEqual(flash.count, 1, "the strike zones the firing tick created");
  assertNear(
    flash.landedTtl ?? Number.NaN,
    SPARK_FLASH,
    REAL_EPS,
    "the strike's ttl on its landing tick",
  );
  for (let tick = 1; tick < FLASH_TICKS; tick += 1) {
    assertEqual(
      flash.present[tick - 1],
      true,
      `the strike still in zones on the ${tick}th tick after the landing`,
    );
  }
  assertNear(
    flash.lastTtl,
    TICK_DT,
    MOTION_EPS,
    `the strike's ttl on the ${FLASH_TICKS - 1}th tick after the landing`,
  );
  assertEqual(
    flash.onTwelfth,
    undefined,
    `the strike on the ${FLASH_TICKS}th tick after the landing`,
  );
});
