// Wick — spark/strike-flash: the strike zone lasts `SPARK_FLASH`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Spark"): "The strike
// is drawn for `SPARK_FLASH` (`0.2`) seconds", and the strike is a zone whose
// `ttl` is its "seconds left" (`specs/state.md`). `specs/world.md` ("Timers"):
// "a timer set to `s` seconds is due `round(s × TICK_HZ)` ticks after the tick
// it was set on", `round(0.2 × 60)` = `12`; and ("One tick", phase 6) "Every
// projectile and zone that existed before this tick counts its `ttl` down and
// is removed when it is due". So the zone reads `ttl` `0.2` on the tick it
// lands, is still in `zones` on the 11th tick after it, with a tick's worth of
// `ttl` left, and is gone on the 12th.
//
// THE POSE. Spark at level 1 fires on an isolated night with a hound at
// `(200, 0)` as its one target, whose `120` hp outlives the `15` so nothing
// else happens on the night; `weaponFire` is turned off after the landing so
// the twelve ticks that follow count the zone's `ttl` and nothing else, since
// a ttl counts whatever the switches hold (`specs/instrumentation.md`, "The
// driver switches"). The replay covers the landing tick and the twelve after
// it.
//
// TOLERANCE. `TIMER_TOL` on the `ttl` the landing tick set; presence on the
// 11th tick and absence on the 12th are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertUndefined } from "../assert";
import { SPARK_FLASH, TICK_HZ, TIMER_TOL } from "../constants";
import {
  captureReplay,
  createHarness,
  disable,
  fireWeapon,
  isolate,
  mustZone,
  placeEnemy,
  zoneById,
  type Harness,
} from "../harness";
import { SPARK, TARGET_RING, strikesOf } from "./stage";

/** The level fired; the flash is the same at every level. */
const LEVEL = 1;

/** The one target. */
const TARGET = { x: TARGET_RING, y: 0 };

/** The ticks after the landing on which the zone is due: `round(0.2 × 60)`. */
const FLASH_TICKS = Math.round(SPARK_FLASH * TICK_HZ);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads ttl 0.2 on the landing tick and is gone on the 12th tick after it", async () => {
  await isolate(h);
  await placeEnemy(h, "hound", TARGET.x, TARGET.y);

  const read = await captureReplay(h, "flash", async () => {
    const firing = await fireWeapon(h, SPARK, LEVEL);
    await disable(h, "weaponFire");
    const strikes = strikesOf(firing.zones);
    assertEqual(
      strikes.length,
      1,
      "the strike the level-1 firing tick created",
    );
    const strike = strikes[0]!;
    const ticks = await h.stepWatching(FLASH_TICKS);
    return { strike, ticks };
  });

  assertNear(
    read.strike.ttl ?? NaN,
    SPARK_FLASH,
    TIMER_TOL,
    "the strike's ttl on the tick it landed",
  );
  const before = read.ticks[FLASH_TICKS - 2]!;
  mustZone(before, read.strike.id);
  const due = read.ticks[FLASH_TICKS - 1]!;
  assertUndefined(
    zoneById(due, read.strike.id),
    `the strike in zones on the ${FLASH_TICKS}th tick after the landing`,
  );
});
