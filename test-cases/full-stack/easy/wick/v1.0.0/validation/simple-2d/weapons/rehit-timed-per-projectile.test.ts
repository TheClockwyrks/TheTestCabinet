// Wick — weapons/rehit-timed-per-projectile: an infinite-pierce projectile's
// re-hit interval is timed per projectile and per enemy.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Projectiles and pierce"): "A projectile with
//     infinite pierce hits a given enemy at most once per its weapon's re-hit
//     interval, timed per projectile and per enemy from the tick of the
//     previous hit."
//   - `specs/weapons.md` ("Shard"): "its re-hit interval is `SHARD_REHIT`
//     (`0.5`) per shard per enemy", level-1 damage `8`; `specs/enemies.md`: a
//     hound has HP `120`.
//   - `specs/world.md` ("Timers"): "An interval of `s` seconds anywhere in this
//     specification is likewise `round(s × TICK_HZ)` ticks", so 0.5 seconds is
//     30 ticks: a shard that hit on tick T hits again on tick T + 30; ("One
//     tick"), phase 6: "every re-hit entry counts down" before the hits.
//   - `specs/instrumentation.md` (`spawnProjectile`): a posed projectile
//     "first hits ... on the next tick".
//
// WHAT IS READ. The hound's hp across 31 ticks after two shards are posed on
// its center: after tick 1 it has lost both shards' 8, sixteen in all, since
// each shard's interval is its own and the second shard is not held back by
// the first's entry; unchanged through tick 30; and after tick 31 it has lost
// sixteen more. A build timing one interval per enemy removes 8 on tick 1; one
// that re-hits early or late moves the second removal off tick 31.
//
// WHY THE NIGHT IS POSED AS IT IS. One hound and two shards on its center, 150
// units from the lamplighter, every switch off: with `effectMotion` off the
// shards neither move nor bounce, and a hound's 120 hp outlasts the four hits.
//
// TOLERANCE. `FIGURE_TOLERANCE` on each hp reading, exact arithmetic on stated
// figures; none on the tick, which the rule fixes to a whole count.

import { afterEach, beforeEach, it } from "vitest";
import { assertWithin } from "../assert";
import {
  ENEMIES,
  FIGURE_TOLERANCE,
  INFINITE_PIERCE,
  SHARD_LEVELS,
  SHARD_REHIT,
  ticksFor,
} from "../constants";
import {
  captureReplay,
  createHarness,
  enemyById,
  isolate,
  present,
  spawnEnemyNear,
  spawnProjectileAt,
  type Harness,
} from "../harness";

/** Where the scene stands: along +x, clear of the lamplighter. */
const DX = 150;

/** How many shards share the hound. */
const SHARDS = 2;

/** What the hound loses on a tick both shards hit it. */
const PER_TICK = SHARDS * SHARD_LEVELS[0].damage;

/** The tick, counted from the pose, on which both shards hit again. */
const REHIT_TICK = 1 + ticksFor(SHARD_REHIT);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("takes both shards' damage on tick 1 and again on tick 31, and nothing between", async () => {
  isolate(h);
  const hound = spawnEnemyNear(h, "hound", DX, 0);
  const placed = present(enemyById(h.snapshot(), hound), "the posed hound");
  for (let i = 0; i < SHARDS; i += 1) {
    spawnProjectileAt(h, "shard", placed.x, placed.y, 0, 0, INFINITE_PIERCE);
  }

  const trace = await captureReplay(h, "two", () => h.trace(REHIT_TICK));

  const hpOn = (tick: number): number => {
    const hit = present(
      enemyById(trace[tick - 1], hound),
      `the hound after tick ${tick}`,
    );
    return hit.hp;
  };
  assertWithin(
    hpOn(1),
    ENEMIES.hound.hp - PER_TICK,
    FIGURE_TOLERANCE,
    "the hound's hp after tick 1, both shards' first hit",
  );
  for (let tick = 2; tick < REHIT_TICK; tick += 1) {
    assertWithin(
      hpOn(tick),
      ENEMIES.hound.hp - PER_TICK,
      FIGURE_TOLERANCE,
      `the hound's hp after tick ${tick}, inside the interval`,
    );
  }
  assertWithin(
    hpOn(REHIT_TICK),
    ENEMIES.hound.hp - 2 * PER_TICK,
    FIGURE_TOLERANCE,
    `the hound's hp after tick ${REHIT_TICK}, both shards' second hit`,
  );
});
