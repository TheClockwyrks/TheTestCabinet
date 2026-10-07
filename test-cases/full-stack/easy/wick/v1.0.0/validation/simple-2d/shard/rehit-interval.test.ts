// Wick — shard/rehit-interval: a shard re-hits the enemy it sits on every
// `SHARD_REHIT`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Shard"): "Its pierce is `INFINITE_PIERCE`, its
//     re-hit interval is `SHARD_REHIT` (`0.5`) per shard per enemy", and row 1
//     carries damage `8`.
//   - `specs/weapons.md` ("Persistent effects"): "A touching effect (each
//     Lantern lantern, each Shard, and each Sconce) damages an enemy on any
//     tick the two overlap, at most once per re-hit interval per effect per
//     enemy."
//   - `specs/weapons.md` ("Projectiles and pierce"): "A projectile with
//     infinite pierce hits a given enemy at most once per its weapon's re-hit
//     interval, timed per projectile and per enemy from the tick of the
//     previous hit."
//   - `specs/world.md` ("Timers"): "An interval of `s` seconds anywhere in this
//     specification is likewise `round(s × TICK_HZ)` ticks", so `0.5` seconds
//     is `30` ticks; ("One tick"), phase 6: "every re-hit entry counts down"
//     before the hits.
//   - `specs/instrumentation.md` (`spawnProjectile`): a posed shard carries the
//     level-1 row while Shard is not held, and first hits on the next tick;
//     (`setEffectMotion`, off) "`ttl` and every re-hit entry still count, and
//     hits still resolve".
//   - `specs/enemies.md`: a hound is a circle of radius `18` with HP `120`.
//
// WHAT IS READ. The hound's `hp` after every one of 61 ticks, with one shard of
// damage `8` posed on its center: `112` from tick 1, `104` from tick 31, and
// `96` on tick 61, each holding through the 29 ticks between. The whole
// schedule is read rather than the three hitting ticks, so a build that re-hits
// on every tick, or one tick early or late, fails on the first tick it departs.
// Three hits take `24` of the hound's `120`, so it never dies and the readings
// run to the end.
//
// WHY THE NIGHT IS POSED AS IT IS. One hound and one shard on its center, on an
// isolated night with every faculty held: `effectMotion` off so the shard stays
// on the hound with its posed zero velocity, `enemyMotion` off so the hound
// stays under it, `enemyContact` off so the hound never touches the
// lamplighter, and the rest off so nothing else lands a hit. The hound stands
// `200` units out, clear of the lamplighter and well inside the view, so no
// bounce and no contact enter the reading.
//
// TOLERANCE. `FIGURE_TOLERANCE` on each `hp` reading, exact arithmetic on
// stated whole figures; none on the tick, which the interval rule fixes to a
// whole count. The alternatives are `8` apart.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
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

/** Where the hound stands, as an offset from the lamplighter's center. */
const HOUND = { x: 200, y: 0 };

/** What one hit removes: row 1's damage, `8`, the row a posed shard carries. */
const DAMAGE = SHARD_LEVELS[0].damage;

/** Ticks from one hit to the next: `round(0.5 × 60)` = `30`. */
const REHIT_TICKS = ticksFor(SHARD_REHIT);

/** The ticks traced: the first hit and two re-hits, `61`. */
const TICKS = 2 * REHIT_TICKS + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lets one shard hit a hound on tick 1 and again on ticks 31 and 61, and on no tick between", async () => {
  isolate(h);
  const hound = spawnEnemyNear(h, "hound", HOUND.x, HOUND.y);
  const placed = present(enemyById(h.snapshot(), hound), "the posed hound");
  spawnProjectileAt(h, "shard", placed.x, placed.y, 0, 0, INFINITE_PIERCE);

  const trace = await captureReplay(h, "rehit", () => h.trace(TICKS));
  assertEqual(trace.length, TICKS, "ticks traced");

  trace.forEach((snapshot, index) => {
    const tick = index + 1;
    const hits = 1 + Math.floor((tick - 1) / REHIT_TICKS);
    const hound_ = present(
      enemyById(snapshot, hound),
      `the hound after tick ${tick}`,
    );
    assertWithin(
      hound_.hp,
      ENEMIES.hound.hp - hits * DAMAGE,
      FIGURE_TOLERANCE,
      `the hound's hp after tick ${tick}, having taken ${hits} hit(s)`,
    );
  });
});
