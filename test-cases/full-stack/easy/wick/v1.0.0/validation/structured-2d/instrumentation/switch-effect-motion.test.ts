// Wick — instrumentation/switch-effect-motion: with `setEffectMotion(false)`,
// a posed bolt holds its position and velocity and a Lantern lantern holds its
// angle across 60 ticks, while `ttl` and every re-hit entry still count and a
// hit on an overlapping enemy still resolves.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, the
// switch table, `effectMotion` off: "Every projectile holds its position and
// velocity, and every lantern holds its angle. `ttl` and every re-hit entry
// still count, and hits still resolve." `specs/world.md`, phase 6: ttl and
// re-hit entries count on every tick, motion runs while the switch is on, and
// "every projectile and zone hits" after. `specs/weapons.md`: a shard is a
// touching effect with re-hit interval `SHARD_REHIT` (0.5) and infinite
// pierce; Lantern's set is created at angle 0 at `orbit` (90) from the
// lamplighter with `ttl` `duration` (3); Ember level 1 has `duration` 2.
//
// THE SCENE. An isolated run: Lantern held and armed, one tick so its set is
// created (Lantern's timer then holds `duration + cooldown`, 6 s, so it cannot
// refire), `weaponFire` back off; a posed Ember bolt at (100, 0) flying +x
// with nothing to hit; a posed shard at (300, 0) on a hound (hp 120) at the
// same point; `effectMotion` off throughout. After one tick the shard's hit
// has landed (hound below 120, an entry at 0.5); after a second the entry has
// counted by `TICK_DT`; after 60 the bolt and the lantern are where they were,
// exact, and the bolt's `ttl` has counted 60 × TICK_DT (`MOTION_EPS`).

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDefined,
  assertEqual,
  assertLength,
  assertLessThan,
  assertNear,
} from "../assert";
import {
  EMBER_LEVELS,
  ENEMIES,
  MOTION_EPS,
  SHARD_REHIT,
  TICK_DT,
} from "../constants";
import {
  advanceTicks,
  armWeapon,
  captureStill,
  createHarness,
  disable,
  enemyById,
  holdWeapon,
  isolate,
  placeEnemy,
  placeProjectile,
  projectileById,
  zonesOfKind,
  type Harness,
} from "../harness";

const HELD_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds effects in place while their timers and hits still run", async () => {
  isolate(h);
  const lantern = holdWeapon(h, "lantern");
  armWeapon(h, lantern);
  const lit = await advanceTicks(h, 1);
  disable(h, "weaponFire");
  assertLength(zonesOfKind(lit, "lantern"), 1, "the lantern set created");
  const [lanternZone] = zonesOfKind(lit, "lantern");

  const bolt = placeProjectile(h, "ember", 100, 0, 400, 0, 0);
  const hound = placeEnemy(h, "hound", 300, 0);
  const shard = placeProjectile(h, "shard", 300, 0, 500, 0, -1);
  const posed = h.snapshot();
  const boltPosed = projectileById(posed, bolt);
  assertDefined(boltPosed, "the posed bolt");

  const one = await advanceTicks(h, 1);
  const hitHound = enemyById(one, hound);
  assertDefined(hitHound, "the hound after the first tick");
  assertLessThan(
    hitHound?.hp ?? Number.NaN,
    ENEMIES.hound.hp,
    "the hound's hp after the shard's hit resolved",
  );
  const entryAtHit = projectileById(one, shard)?.hits.find(
    (hit) => hit.enemy === hound,
  );
  assertDefined(entryAtHit, "the shard's re-hit entry for the hound");
  assertEqual(
    entryAtHit?.cooldown,
    SHARD_REHIT,
    "the re-hit entry's cooldown at the hit",
  );

  const two = await advanceTicks(h, 1);
  const entryLater = projectileById(two, shard)?.hits.find(
    (hit) => hit.enemy === hound,
  );
  assertNear(
    entryLater?.cooldown ?? Number.NaN,
    SHARD_REHIT - TICK_DT,
    MOTION_EPS,
    "the re-hit entry one tick on",
  );

  const held = await advanceTicks(h, HELD_TICKS - 2);
  captureStill(h, "held");
  const boltHeld = projectileById(held, bolt);
  assertDefined(boltHeld, `the bolt after ${HELD_TICKS} ticks`);
  assertEqual(
    boltHeld?.x,
    boltPosed?.x,
    "the bolt's x while effectMotion is off",
  );
  assertEqual(
    boltHeld?.y,
    boltPosed?.y,
    "the bolt's y while effectMotion is off",
  );
  assertEqual(
    boltHeld?.vx,
    boltPosed?.vx,
    "the bolt's vx while effectMotion is off",
  );
  assertEqual(
    boltHeld?.vy,
    boltPosed?.vy,
    "the bolt's vy while effectMotion is off",
  );
  assertNear(
    boltHeld?.ttl ?? Number.NaN,
    EMBER_LEVELS[0].duration - HELD_TICKS * TICK_DT,
    MOTION_EPS,
    `the bolt's ttl after ${HELD_TICKS} ticks`,
  );
  const lanternHeld = zonesOfKind(held, "lantern").find(
    (zone) => zone.id === lanternZone.id,
  );
  assertDefined(lanternHeld, `the lantern after ${HELD_TICKS} ticks`);
  assertEqual(
    lanternHeld?.x,
    lanternZone.x,
    "the lantern's x while effectMotion is off",
  );
  assertEqual(
    lanternHeld?.y,
    lanternZone.y,
    "the lantern's y while effectMotion is off",
  );
});
