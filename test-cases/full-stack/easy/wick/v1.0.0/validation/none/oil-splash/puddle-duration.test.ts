// Wick — oil-splash/puddle-duration: a puddle vanishes when its duration is
// due.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Oil Splash"): "A
// puddle is a circle of `radius` that stays where it landed for `duration`
// seconds and then vanishes", with row 1's duration `2.5`; ("Derived stats")
// the duration is the "table value, unchanged". A zone's `ttl` is "its seconds
// left" (`specs/state.md`), and phase 6 of `specs/world.md`: "Every projectile
// and zone that existed before this tick counts its `ttl` down and is removed
// when it is due". ("Timers") "a timer set to `s` seconds is due
// `round(s × TICK_HZ)` ticks after the tick it was set on", so a puddle whose
// `ttl` was set on the firing tick reads `2.5` on that tick, is still there
// `149` ticks later with one tick left, and is removed on the `150th`.
//
// WHAT IS READ. The puddle by id: its `ttl` on the firing tick, its presence
// on each of the `149` ticks after, and its absence on the `150th`.
//
// THE POSE. An isolated night with Oil Splash alone at level 1, fired once
// through the shared `fireOil`, then `weaponFire` off so nothing fires again.
// A zone's `ttl` counts under every switch; only the cooldown timers hold. No
// enemy is posed, so the puddle pulses on nothing.
//
// TOLERANCE. `TIMER_TOL` on the `ttl` read straight after the firing, which a
// build sets from the table figure; none on the tick, which the timer rule
// fixes exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNear } from "../assert";
import { dueTicks, TIMER_TOL, weaponRow } from "../constants";
import {
  captureReplay,
  createHarness,
  disable,
  isolate,
  zoneById,
  type Harness,
} from "../harness";
import { fireOil, OIL, puddlesOf } from "./stage";

/** The level fired: row 1, one puddle with duration `2.5`. */
const LEVEL = 1;

/** Row 1's duration, `2.5` seconds. */
const DURATION = weaponRow(OIL, LEVEL).duration ?? NaN;

/** The ticks after the firing on which the puddle is due: `round(2.5 × 60)` = `150`. */
const DUE = dueTicks(DURATION);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads ttl 2.5 on the firing tick, keeps the puddle 149 ticks, and drops it on the 150th", async () => {
  await isolate(h);

  const life = await captureReplay(h, "vanished", async () => {
    const fired = await fireOil(h, LEVEL);
    const puddles = puddlesOf(fired);
    assertEqual(
      puddles.length,
      1,
      "Oil Splash puddles the firing tick created",
    );
    const puddle = puddles[0]!;
    await disable(h, "weaponFire");

    const ticks = await h.stepWatching(DUE);
    const missing: number[] = [];
    for (const [index, snapshot] of ticks.entries()) {
      if (zoneById(snapshot, puddle.id) === undefined) missing.push(index + 1);
    }
    return { ttl: puddle.ttl, stepped: ticks.length, missing };
  });

  assertNear(
    life.ttl ?? NaN,
    DURATION,
    TIMER_TOL,
    "the puddle's ttl on the firing tick",
  );
  assertEqual(life.stepped, DUE, "ticks stepped after the firing");
  assertDeepEqual(
    life.missing,
    [DUE],
    `the ticks after the firing on which the puddle was absent (present through the ${DUE - 1}th, gone on the ${DUE}th)`,
  );
});
