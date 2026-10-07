// Wick — weapons/projectile-ttl-expiry: a projectile is removed on the tick its
// ttl is due.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Projectiles and
// pierce"): "A projectile's `ttl` is set to its `duration` when it is fired,
// and it is removed on the tick `ttl` is due, whether or not it hit anything."
// `specs/world.md` ("Timers"): "a timer set to `s` seconds is due
// `round(s × TICK_HZ)` ticks after the tick it was set on", and phase 6:
// "Every projectile and zone that existed before this tick counts its `ttl`
// down and is removed when it is due". Ember's level-1 duration is `2.0`, so a
// posed bolt is present on the `119`th tick after the pose and gone on the
// `120`th.
//
// THE POSE. One level-1 Ember bolt posed with zero velocity on an empty
// night, so it hits nothing. Every faculty is held: `effectMotion` so it
// stands still, which changes nothing about its clock ("`ttl` and every re-hit
// entry still count"), and the rest so nothing arrives to be hit. The ttl the
// pose gave it is read first, so a build that posed the wrong duration fails
// on that reading rather than on a tick count it could not have met.
//
// TOLERANCE. `TIMER_TOL` on the posed ttl; none on the tick, which the timer
// rule fixes exactly.

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
  isolate,
  placeProjectile,
  projectileById,
  type Harness,
} from "../harness";

/** Where the bolt sits, in view and clear of the lamplighter. */
const BOLT = { x: 200, y: -80 };

/** Ember's level-1 duration, `2.0` seconds. */
const DURATION = weaponRow("ember", 1).duration!;

/** The tick the bolt's ttl is due: `round(2.0 × 60)` = `120` after the pose. */
const EXPIRY = dueTicks(DURATION);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps a posed ember on the 119th tick and removes it on the 120th", async () => {
  await isolate(h);
  const bolt = await placeProjectile(h, "ember", BOLT.x, BOLT.y, 0, 0, 0);
  assertNear(bolt.ttl, DURATION, TIMER_TOL, "the posed bolt's ttl");
  const posed = await h.snapshot();

  const expired = await captureReplay(h, "expired", async () => {
    const beforeDue = await h.step(EXPIRY - 1);
    const present = projectileById(beforeDue, bolt.id) !== undefined;
    const due = await h.step(1);
    return { beforeDue, present, due };
  });

  assertEqual(
    expired.beforeDue.run.tick - posed.run.tick,
    EXPIRY - 1,
    "ticks stepped to the tick before the ttl is due",
  );
  assertTrue(
    expired.present,
    "the bolt present on the tick before its ttl is due",
  );
  assertEqual(
    expired.due.run.tick - posed.run.tick,
    EXPIRY,
    "ticks stepped to the due tick",
  );
  assertUndefined(
    projectileById(expired.due, bolt.id),
    "the bolt on the tick its ttl is due",
  );
});
