// instrumentation/switch-effect-motion — with `setEffectMotion(false)`, a
// posed shard holds its position and velocity and a Lantern lantern holds its
// angle across 60 ticks, while ttl and every re-hit entry still count and a
// hit on an overlapping enemy still resolves.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "The driver
// switches", `effectMotion` off: "Every projectile holds its position and
// velocity, and every lantern holds its angle. `ttl` and every re-hit entry
// still count, and hits still resolve". specs/world.md, phase 6: ttl and the
// re-hit entries count first, motion runs "while `effectMotion` is on", "Then
// every projectile and zone hits". specs/weapons.md: a Shard's re-hit interval
// is SHARD_REHIT (0.5) and its level-1 duration 3.0.
//
// THE POSE. An isolated run holding Lantern, fired by one tick with
// `weaponFire` on so a set exists; then `weaponFire` off again, a shard with
// infinite pierce posed on a hound, and `effectMotion` off. Sixty ticks: the
// shard's position and velocity as posed, the lantern's position as it was,
// the shard's ttl down by 60 TICK_DT, the hound hit, and its re-hit entry
// counting.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDefined,
  assertEqual,
  assertLength,
  assertLessThan,
  assertWithin,
} from "../assert";
import {
  ENEMIES,
  MOTION_TOLERANCE,
  SHARD_LEVELS,
  SHARD_REHIT,
  TICK_DT,
} from "../constants";
import {
  armWeapon,
  captureStill,
  createHarness,
  disable,
  enemyById,
  holdWeapon,
  isolate,
  projectileById,
  spawnEnemyAt,
  zonesOfKind,
  type Harness,
} from "../harness";

const HELD_TICKS = 60;
const SHARD_AT = { x: 300, y: 0 };
const SHARD_V = { x: SHARD_LEVELS[0].speed, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the effects in place while their timers count and hits resolve", async () => {
  isolate(h);
  const lantern = holdWeapon(h, "lantern", 1);
  armWeapon(h, lantern);
  const fired = await h.tick(1);
  disable(h, "weaponFire");
  assertLength(zonesOfKind(fired, "lantern"), 1, "the lantern set fired");
  const lanternBefore = zonesOfKind(fired, "lantern")[0];

  const hound = spawnEnemyAt(h, "hound", SHARD_AT.x, SHARD_AT.y);
  const shard = h.snapshot().run.nextId;
  h.debug.spawnProjectile(
    "shard",
    SHARD_AT.x,
    SHARD_AT.y,
    SHARD_V.x,
    SHARD_V.y,
    -1,
  );

  const first = await h.tick(1);
  const entry = projectileById(first, shard)?.hits[0];
  assertDefined(entry, "the shard's re-hit entry after its first hit");
  assertWithin(
    entry?.cooldown ?? Number.NaN,
    SHARD_REHIT,
    MOTION_TOLERANCE,
    "the entry, set",
  );

  const held = await h.tick(HELD_TICKS - 1);
  captureStill(h, "held");

  const shardAfter = projectileById(held, shard);
  assertDefined(shardAfter, "the shard after 60 held ticks");
  assertEqual(shardAfter?.x, SHARD_AT.x, "the shard's x, held");
  assertEqual(shardAfter?.y, SHARD_AT.y, "the shard's y, held");
  assertEqual(shardAfter?.vx, SHARD_V.x, "the shard's vx, held");
  assertEqual(shardAfter?.vy, SHARD_V.y, "the shard's vy, held");
  assertWithin(
    shardAfter?.ttl ?? Number.NaN,
    SHARD_LEVELS[0].duration - HELD_TICKS * TICK_DT,
    MOTION_TOLERANCE,
    "the shard's ttl, counted while held",
  );
  const lanternAfter = zonesOfKind(held, "lantern")[0];
  assertDefined(lanternAfter, "the lantern after 60 held ticks");
  assertEqual(
    lanternAfter?.x,
    lanternBefore.x,
    "the lantern's x, its angle held",
  );
  assertEqual(
    lanternAfter?.y,
    lanternBefore.y,
    "the lantern's y, its angle held",
  );
  assertLessThan(
    enemyById(held, hound)?.hp ?? Number.NaN,
    ENEMIES.hound.hp,
    "the hound's hp after the shard hit it in place",
  );
  const entryAfter = shardAfter?.hits[0];
  assertDefined(entryAfter, "the shard's re-hit entry, still counting");
  assertLessThan(
    entryAfter?.cooldown ?? Number.NaN,
    SHARD_REHIT,
    "the entry's cooldown, counted down from where it was set",
  );
});
