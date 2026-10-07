// Wick — weapons/rehit-timed-per-projectile: a re-hit interval is timed per
// projectile.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Projectiles and
// pierce"): "A projectile with infinite pierce hits a given enemy at most once
// per its weapon's re-hit interval, timed per projectile and per enemy from the
// tick of the previous hit." Under "Shard": "its re-hit interval is
// `SHARD_REHIT` (`0.5`) per shard per enemy", and a shard's level-1 row carries
// damage `8`. `specs/world.md` ("Timers") makes an interval of `0.5` seconds
// `round(0.5 × 60)` = `30` ticks, and phase 6 counts every re-hit entry down
// before the hits. So two shards on one hound each hit on the tick after the
// pose, taking `16` together, take nothing on the `29` ticks after, and each
// hit again on the `30`th tick after the first hit.
//
// THE POSE. One hound and two shards posed on its center with zero velocity
// and pierce `-1`. Two shards, so a build that times the interval per enemy
// rather than per projectile lets only the first of them hit and reads `112`
// where `104` is due; both on one center, so they are due on the same tick
// and the second reading is one figure. Every faculty is held: `effectMotion`
// so the shards stay on the hound rather than bouncing off, `enemyMotion` so
// the hound stays under them, and the rest so nothing else lands.
//
// TOLERANCE. `FLOAT_TOL` on the hound's hp: every figure is a whole number
// and the alternatives are `8` away.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import {
  ENEMIES,
  FLOAT_TOL,
  INFINITE_PIERCE,
  SHARD_REHIT,
  dueTicks,
  weaponRow,
} from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  mustEnemy,
  placeEnemy,
  placeProjectile,
  type Harness,
} from "../harness";

/** Where the hound stands, clear of the lamplighter. */
const HOUND = { x: 200, y: 0 };

/** A shard's level-1 damage, `8`. */
const SHARD_DAMAGE = weaponRow("shard", 1).damage;

/** Ticks from one hit to the next: `round(0.5 × 60)` = `30`. */
const REHIT_TICKS = dueTicks(SHARD_REHIT);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lets two shards on one hound each hit on the next tick and again 30 ticks later", async () => {
  await isolate(h);
  const hound = await placeEnemy(h, "hound", HOUND.x, HOUND.y);
  await placeProjectile(h, "shard", HOUND.x, HOUND.y, 0, 0, INFINITE_PIERCE);
  await placeProjectile(h, "shard", HOUND.x, HOUND.y, 0, 0, INFINITE_PIERCE);

  const two = await captureReplay(h, "two", async () => {
    const first = await h.step(1);
    const between = await h.step(REHIT_TICKS - 1);
    const second = await h.step(1);
    return {
      first: mustEnemy(first, hound.id).hp,
      between: mustEnemy(between, hound.id).hp,
      second: mustEnemy(second, hound.id).hp,
    };
  });

  assertNear(
    two.first,
    ENEMIES.hound.hp - 2 * SHARD_DAMAGE,
    FLOAT_TOL,
    "the hound's hp on the tick after the pose",
  );
  assertNear(
    two.between,
    ENEMIES.hound.hp - 2 * SHARD_DAMAGE,
    FLOAT_TOL,
    `the hound's hp ${REHIT_TICKS - 1} ticks after the first hits`,
  );
  assertNear(
    two.second,
    ENEMIES.hound.hp - 4 * SHARD_DAMAGE,
    FLOAT_TOL,
    `the hound's hp ${REHIT_TICKS} ticks after the first hits`,
  );
});
