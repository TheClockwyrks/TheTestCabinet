// Wick — lantern/duration: a set's lanterns vanish on the tick their ttl is due.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Lantern"): "each is a
// zone with `ttl` set to `duration`" and "The lanterns vanish on the tick their
// `ttl` is due"; row 1 of `LANTERN_LEVELS` carries duration `3.0`, "table
// value, unchanged" by any passive. `specs/world.md` ("Timers"): "a timer set
// to `s` seconds is due `round(s × TICK_HZ)` ticks after the tick it was set
// on", `round(3.0 × 60)` = `180`; and ("One tick", phase 6) "Every projectile
// and zone that existed before this tick counts its `ttl` down and is removed
// when it is due". So the lantern reads `ttl` `3.0` on the tick it fires, is
// still in `zones` on the 179th tick after it, with a tick's worth of `ttl`
// left, and is gone on the 180th.
//
// THE POSE. Lantern at level 1 fires on an isolated night with nothing else in
// it (`lantern/stage.ts`); `weaponFire` is turned off after the firing so the
// ticks that follow count the zone's `ttl` and nothing else, since a ttl
// counts whatever the switches hold (`specs/instrumentation.md`, "The driver
// switches"). The replay covers the 180 ticks after the firing.
//
// TOLERANCE. `TIMER_TOL` on the `ttl` the firing tick set; presence on the
// 179th tick and absence on the 180th are exact.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertNear,
  assertTrue,
  assertUndefined,
} from "../assert";
import { TIMER_TOL, dueTicks, weaponRow } from "../constants";
import {
  captureReplay,
  createHarness,
  disable,
  fireWeapon,
  isolate,
  zoneById,
  type Harness,
} from "../harness";
import { lanternsOf } from "./stage";

/** The level fired: one lantern of duration `3.0`. */
const LEVEL = 1;

/** Lantern's level-1 duration, `3.0` seconds. */
const DURATION = weaponRow("lantern", LEVEL).duration!;

/** The tick after the firing on which the ttl is due: `round(3.0 × 60)` = `180`. */
const EXPIRY = dueTicks(DURATION);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps a level-1 lantern on the 179th tick after the firing and removes it on the 180th", async () => {
  await isolate(h);
  const firing = await fireWeapon(h, "lantern", LEVEL);
  await disable(h, "weaponFire");
  const lanterns = lanternsOf(firing);
  assertEqual(
    lanterns.length,
    1,
    "the lantern the level-1 firing tick created",
  );
  const lantern = lanterns[0]!;
  assertNear(
    lantern.ttl ?? NaN,
    DURATION,
    TIMER_TOL,
    "the lantern's ttl on the tick it was created",
  );

  const vanished = await captureReplay(h, "vanished", async () => {
    const beforeDue = await h.step(EXPIRY - 1);
    const present = zoneById(beforeDue, lantern.id) !== undefined;
    const due = await h.step(1);
    return { beforeDue, present, due };
  });

  assertEqual(
    vanished.beforeDue.run.tick - firing.after.run.tick,
    EXPIRY - 1,
    "ticks stepped to the tick before the ttl is due",
  );
  assertTrue(
    vanished.present,
    `the lantern present on the ${EXPIRY - 1}th tick after the firing`,
  );
  assertEqual(
    vanished.due.run.tick - firing.after.run.tick,
    EXPIRY,
    "ticks stepped to the due tick",
  );
  assertUndefined(
    zoneById(vanished.due, lantern.id),
    `the lantern in zones on the ${EXPIRY}th tick after the firing`,
  );
});
