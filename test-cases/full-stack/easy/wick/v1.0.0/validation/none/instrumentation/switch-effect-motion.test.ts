// Wick — instrumentation/switch-effect-motion: with `setEffectMotion(false)`,
// a posed bolt holds its position and velocity and a Lantern lantern holds its
// angle across 60 ticks, while `ttl` and every re-hit entry still count and a
// hit on an overlapping enemy still resolves.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "The driver
// switches"): "`setEffectMotion(on)` | `effectMotion` | Projectiles integrate,
// lanterns revolve ... | Every projectile holds its position and velocity, and
// every lantern holds its angle. `ttl` and every re-hit entry still count, and
// hits still resolve." specs/world.md — "One tick", phase 6: every shape
// "counts its `ttl` down ... every re-hit entry counts down. Then, while
// `effectMotion` is on, every remaining projectile moves ... Then every
// projectile and zone hits". A `ttl` counts by `TICK_DT` per tick, read to
// `TIMER_TOL`; the held position, velocity, and lantern position are read
// exactly. A lantern's damage per hit is its table damage (specs/weapons.md),
// and a hit "removes the shape's damage per hit from the enemy's `hp`".
//
// WHY THE WORLD IS POSED AS IT IS. A lantern set is fired for real (the one
// way a lantern exists), then `weaponFire` is held again so nothing fires
// twice; a bolt is posed off on its own, with no enemy to hit, so it must
// simply hold; a hound is posed on the lantern so a hit resolves and a re-hit
// entry exists to count. Everything else is held.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLessThan,
  assertNear,
  assertNotNull,
} from "../assert";
import { LANTERN_REHIT, TICK_DT, TIMER_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  hitEntry,
  isolate,
  mustEnemy,
  mustProjectile,
  mustZone,
  placeEnemy,
  placeProjectile,
  type Harness,
} from "../harness";

const HELD_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds every effect in place while off, timers and hits still running", async () => {
  await isolate(h);
  const firing = await fireWeapon(h, "lantern", 1);
  await h.debug.setWeaponFire(false);
  assertEqual(firing.zones.length, 1, "the lantern the firing tick created");
  const lantern = firing.zones[0]!;
  const bolt = await placeProjectile(h, "ember", 400, 100, 400, 0, 0);
  const hound = await placeEnemy(h, "hound", lantern.x, lantern.y);
  const before = await h.snapshot();

  const held = await h.step(HELD_TICKS);
  await captureStill(h, "held");

  const boltNow = mustProjectile(held, bolt.id);
  assertEqual(boltNow.x, bolt.x, `the bolt's x after ${HELD_TICKS} held ticks`);
  assertEqual(boltNow.y, bolt.y, `the bolt's y after ${HELD_TICKS} held ticks`);
  assertEqual(
    boltNow.vx,
    bolt.vx,
    `the bolt's vx after ${HELD_TICKS} held ticks`,
  );
  assertEqual(
    boltNow.vy,
    bolt.vy,
    `the bolt's vy after ${HELD_TICKS} held ticks`,
  );
  assertNear(
    boltNow.ttl,
    bolt.ttl - HELD_TICKS * TICK_DT,
    TIMER_TOL,
    `the bolt's ttl counted over ${HELD_TICKS} held ticks`,
  );

  const lanternNow = mustZone(held, lantern.id);
  assertDeepEqual(
    { x: lanternNow.x, y: lanternNow.y },
    { x: lantern.x, y: lantern.y },
    `the lantern's position after ${HELD_TICKS} held ticks`,
  );
  assertNotNull(lanternNow.ttl, "the lantern's ttl");
  assertNear(
    lanternNow.ttl ?? NaN,
    (mustZone(before, lantern.id).ttl ?? NaN) - HELD_TICKS * TICK_DT,
    TIMER_TOL,
    `the lantern's ttl counted over ${HELD_TICKS} held ticks`,
  );

  const houndNow = mustEnemy(held, hound.id);
  assertLessThan(
    houndNow.hp,
    hound.hp,
    "the hound's hp after the lantern's hits resolved",
  );
  const entry = hitEntry(lanternNow, hound.id);
  assertNotNull(entry ?? null, "the lantern's re-hit entry for the hound");
  assertLessThan(
    entry?.cooldown ?? NaN,
    LANTERN_REHIT,
    "the re-hit entry's cooldown, counting",
  );
});
