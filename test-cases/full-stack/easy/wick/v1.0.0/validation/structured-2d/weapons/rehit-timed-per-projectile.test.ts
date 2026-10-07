// weapons/rehit-timed-per-projectile — a re-hit interval is timed per
// projectile.
//
// THE SPEC LINE. `specs/weapons.md`, "Projectiles and pierce": "A projectile
// with infinite pierce hits a given enemy at most once per its weapon's re-hit
// interval, timed per projectile and per enemy from the tick of the previous
// hit." A shard's pierce is `INFINITE_PIERCE` and its interval `SHARD_REHIT`
// (`0.5`), which is `round(0.5 × 60)` = `30` ticks (`specs/world.md`, Timers).
// So two shards standing on one hound EACH hit it on their first tick, the
// hound losing both shards' damage, `2 × 8` = `16`, on that tick, and each hits
// again `30` ticks later, on tick `31`, and on no tick between. A build that
// timed the interval per enemy, or per weapon, lands one shard's `8` on tick
// `1` instead of two.
//
// THE POSE. One hound at `(200, 0)`, `120` hp, and two shards posed at its
// center with zero velocity and pierce `-1`: each overlaps the hound at
// distance `0`, and a posed projectile "first hits ... on the next tick"
// (`specs/instrumentation.md`). `effectMotion` is held so neither shard moves
// while "every re-hit entry still count[s], and hits still resolve",
// `enemyMotion` so the hound stays under them, `enemyContact` so no contact
// damage enters; nothing else runs. The hound's `120` hp takes the four hits
// to `88`.
//
// WHAT IS READ. The hound's hp after tick `1`, after tick `30`, and after
// tick `31`: `104`, still `104`, then `88`.
//
// THE TOLERANCE. `REAL_EPS` on each hp, a few subtractions of small reals;
// the nearest wrong figure, one shard's hit instead of two, is `8` away.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import {
  INFINITE_PIERCE,
  REAL_EPS,
  SHARD_LEVELS,
  SHARD_REHIT,
  ticksOf,
} from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  enemyById,
  isolate,
  placeEnemyNear,
  placeProjectile,
  type Harness,
} from "../harness";

/** Where the hound stands and both shards are posed. */
const AT = { x: 200, y: 0 };

/** How many shards stand on the hound. */
const SHARDS = 2;

/** Ticks between one shard's hits on one enemy: `round(0.5 × 60)` = `30`. */
const INTERVAL = ticksOf(SHARD_REHIT);

/** What both shards remove together on a tick they both hit: `2 × 8`. */
const PER_ROUND = SHARDS * SHARD_LEVELS[0].damage;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lands both shards' hits on tick 1 and again on tick 31, with none between", async () => {
  isolate(h);
  const hound = placeEnemyNear(h, "hound", AT.x, AT.y);
  const before = enemyById(h.snapshot(), hound);
  if (before === undefined) throw new Error("the posed hound is missing");
  for (let i = 0; i < SHARDS; i += 1) {
    placeProjectile(h, "shard", before.x, before.y, 0, 0, INFINITE_PIERCE);
  }

  const trace = await captureReplay(h, "two", async () => {
    const first = await advanceTicks(h, 1);
    const between = await advanceTicks(h, INTERVAL - 1);
    const second = await advanceTicks(h, 1);
    return {
      first: enemyById(first, hound)?.hp ?? NaN,
      between: enemyById(between, hound)?.hp ?? NaN,
      second: enemyById(second, hound)?.hp ?? NaN,
    };
  });

  assertNear(
    trace.first,
    before.hp - PER_ROUND,
    REAL_EPS,
    `the hound's hp after tick 1 under two shards, both hits of ${SHARD_LEVELS[0].damage} from ${before.hp} (specs/weapons.md, Projectiles and pierce)`,
  );
  assertNear(
    trace.between,
    before.hp - PER_ROUND,
    REAL_EPS,
    `the hound's hp after tick ${INTERVAL}, no hit between the first and the re-hit (specs/weapons.md, Projectiles and pierce)`,
  );
  assertNear(
    trace.second,
    before.hp - 2 * PER_ROUND,
    REAL_EPS,
    `the hound's hp after tick ${INTERVAL + 1}, both shards' re-hits (specs/weapons.md, Projectiles and pierce)`,
  );
});
