// Wick — sconce/rehit-interval: a sconce re-hits an enemy it overlaps every
// SCONCE_REHIT, and its hits entry counts the interval down.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Sconce"): "its re-hit interval is `SCONCE_REHIT`
//     (`0.5`) per sconce per enemy"; the level-1 row has damage `12` and
//     radius `12`.
//   - `specs/weapons.md` ("Persistent effects"): "A touching effect (each
//     Lantern lantern, each Shard, and each Sconce) damages an enemy on any
//     tick the two overlap, at most once per re-hit interval per effect per
//     enemy".
//   - `specs/state.md` (`EnemyHit`): `cooldown` is "the seconds until this
//     projectile or zone may hit that enemy again, a timer as `specs/world.md`
//     defines one; an entry that is due is dropped. A Shard, a Sconce, and a
//     lantern set it to their weapon's re-hit interval."
//   - `specs/world.md` ("Timers"): "An interval of `s` seconds anywhere in
//     this specification is likewise `round(s × TICK_HZ)` ticks", so `0.5`
//     seconds is 30 ticks, and "On every tick a timer counts down by
//     `TICK_DT`"; ("One tick"), phase 6: "every re-hit entry counts down"
//     before the hits, so the entry set on the first tick is due and dropped
//     on the 30th tick after it, and the sconce hits again on that tick.
//   - `specs/weapons.md` ("Shapes and overlap"): "Two circles overlap when the
//     distance between their centers is less than the sum of their radii";
//     `specs/enemies.md`: a hound has HP `120` and radius `18`, so a sconce
//     posed on the hound's center overlaps it, and `120` hp outlasts three
//     hits of `12`.
//   - `specs/instrumentation.md` (`spawnProjectile`): a posed projectile's
//     "`radius` is the weapon's table radius at the level held, or at level
//     `1` ... when the weapon is not held", its `damage` "that row's damage
//     times the `damageMul` in force", its `ttl` "that row's duration", and
//     "A `sconce` takes acceleration `−SCONCE_DECEL` along the unit vector of
//     `(vx, vy)`, so a zero velocity is invalid for `sconce`".
//   - `specs/instrumentation.md` (The driver switches): with `effectMotion`
//     off "every projectile holds its position and velocity ... `ttl` and
//     every re-hit entry still count, and hits still resolve".
//
// WHAT IS READ. The hound's hp and the sconce's entry for it after each of 61
// ticks from the pose: after tick 1 the hound has lost `12` and the entry
// reads `0.5`; through tick 30 the hp is unchanged and the entry reads `0.5`
// less `TICK_DT` per tick; after tick 31 the hound has lost `12` more and the
// entry reads `0.5` again; and after tick 61, `12` more. A build re-hitting
// every tick, never, or a tick early or late fails.
//
// WHY THE NIGHT IS POSED AS IT IS. No weapon held and no director, one hound
// and one sconce posed on the hound's center, every switch off:
// `effectMotion` off holds the sconce on the hound, so the overlap holds for
// every tick read and no deceleration carries it away; `weaponFire` off keeps
// any timer from producing a second effect; `enemyMotion` off holds the hound;
// `enemyContact` off keeps it from touching the lamplighter. The posed sconce
// carries the level-1 row, whose `ttl` of `2.5` seconds is 150 ticks and
// outlasts the 61 watched. Its velocity is the level-1 speed along `+x`, a
// direction the reading does not depend on, since a zero velocity is invalid
// for a sconce.
//
// TOLERANCE. `FIGURE_TOLERANCE` on each hp reading and on a freshly set entry,
// exact arithmetic on stated figures; `MOTION_TOLERANCE` on an entry counted
// down tick by tick. None on the ticks, which the rule fixes to a whole count.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin, fail } from "../assert";
import {
  ENEMIES,
  FIGURE_TOLERANCE,
  INFINITE_PIERCE,
  MOTION_TOLERANCE,
  SCONCE_REHIT,
  TICK_DT,
  ticksFor,
} from "../constants";
import {
  captureReplay,
  createHarness,
  enemyById,
  isolate,
  projectileById,
  spawnEnemyNear,
  spawnProjectileAt,
  type Harness,
} from "../harness";
import { sconceRow } from "./boomerang";

/** The enemy the sconce is held on: HP 120, radius 18. */
const PROBE = "hound";

/** The level-1 row a posed sconce takes with Sconce not held: damage 12. */
const ROW = sconceRow(1);

/** Where the hound stands, as an offset from the lamplighter's center. */
const HOUND_AT = { x: 200, y: 0 };

/** The ticks between one hit and the next: round(0.5 × 60). */
const REHIT_TICKS = ticksFor(SCONCE_REHIT);

/** The ticks watched from the pose: the first hit and two re-hits. */
const WATCH_TICKS = 1 + 2 * REHIT_TICKS;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("hits the hound on tick 1, again on tick 31 and 61, and counts the entry down between", async () => {
  isolate(h);
  const hound = spawnEnemyNear(h, PROBE, HOUND_AT.x, HOUND_AT.y);
  const placed = enemyById(h.snapshot(), hound);
  if (placed === undefined) fail("the posed hound", "not posed");
  assertEqual(placed.hp, ENEMIES[PROBE].hp, "the posed hound's hp");
  const sconce = spawnProjectileAt(
    h,
    "sconce",
    placed.x,
    placed.y,
    ROW.speed,
    0,
    INFINITE_PIERCE,
  );

  const seen = await captureReplay(h, "rehit", () => h.trace(WATCH_TICKS));

  const hpOn = (tick: number): number => {
    const hit = enemyById(seen[tick - 1], hound);
    if (hit === undefined) fail(`the hound after tick ${tick}`, "gone");
    return hit.hp;
  };
  const entryOn = (tick: number): number => {
    const live = projectileById(seen[tick - 1], sconce);
    if (live === undefined) fail(`the sconce after tick ${tick}`, "gone");
    const entries = live.hits.filter((entry) => entry.enemy === hound);
    assertEqual(
      entries.length,
      1,
      `the sconce's hits entries naming the hound after tick ${tick}`,
    );
    return entries[0].cooldown;
  };

  // Hits land on ticks 1, 31, and 61; between them the hp holds and the entry
  // counts down from 0.5 by TICK_DT a tick.
  for (let tick = 1; tick <= WATCH_TICKS; tick += 1) {
    const hitsSoFar = 1 + Math.floor((tick - 1) / REHIT_TICKS);
    const sinceHit = (tick - 1) % REHIT_TICKS;
    assertWithin(
      hpOn(tick),
      ENEMIES[PROBE].hp - hitsSoFar * ROW.damage,
      FIGURE_TOLERANCE,
      `the hound's hp after tick ${tick}, ${hitsSoFar} hit(s) in`,
    );
    if (sinceHit === 0) {
      assertWithin(
        entryOn(tick),
        SCONCE_REHIT,
        FIGURE_TOLERANCE,
        `the sconce's entry for the hound after tick ${tick}, the tick it hit`,
      );
    } else {
      assertWithin(
        entryOn(tick),
        SCONCE_REHIT - sinceHit * TICK_DT,
        MOTION_TOLERANCE,
        `the sconce's entry for the hound after tick ${tick}, ${sinceHit} tick(s) after the hit`,
      );
    }
  }
});
