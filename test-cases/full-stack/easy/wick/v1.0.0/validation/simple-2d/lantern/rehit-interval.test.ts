// Wick — lantern/rehit-interval: a lantern re-hits an enemy it overlaps every
// LANTERN_REHIT, and its hits entry counts the interval down.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Lantern"): "Each lantern is a touching effect with
//     re-hit interval `LANTERN_REHIT` (`0.5`), timed per lantern per enemy";
//     ("Persistent effects"): "A touching effect ... damages an enemy on any
//     tick the two overlap, at most once per re-hit interval per effect per
//     enemy"; row 1 has damage `10`, orbit `90`, and radius `14`.
//   - `specs/state.md` (`EnemyHit`): `cooldown` is "the seconds until this
//     projectile or zone may hit that enemy again, a timer as `specs/world.md`
//     defines one; an entry that is due is dropped. A Shard, a Sconce, and a
//     lantern set it to their weapon's re-hit interval."
//   - `specs/world.md` ("Timers"): "An interval of `s` seconds anywhere in
//     this specification is likewise `round(s × TICK_HZ)` ticks", so `0.5`
//     seconds is 30 ticks, and "On every tick a timer counts down by
//     `TICK_DT`"; ("One tick"), phase 6: "every re-hit entry counts down"
//     before the hits, and "every projectile and zone hits, this tick's new
//     ones included, a new one hitting at the position it was created at",
//     so the lantern hits on the firing tick, its entry is due and dropped on
//     the 30th tick after, and it hits again on that tick.
//   - `specs/weapons.md` ("Shapes and overlap"): "Two circles overlap when
//     the distance between their centers is less than the sum of their
//     radii"; `specs/enemies.md`: a hound has HP `120` and radius `18`, so a
//     hound centered on the lantern's center overlaps it, and its `120` hp
//     outlasts three hits of `10`.
//   - `specs/instrumentation.md` (The driver switches): with `effectMotion`
//     off "every lantern holds its angle. `ttl` and every re-hit entry still
//     count, and hits still resolve."
//
// WHAT IS READ. The hound's hp and the lantern's entry for it after each of
// 61 ticks from the pose: after tick 1, the firing tick, the hound has lost
// `10` and the entry reads `0.5`; through tick 30 the hp is unchanged and the
// entry reads `0.5` less `TICK_DT` per tick; after tick 31 the hound has lost
// `10` more and the entry reads `0.5` again; and after tick 61, `10` more. A
// build re-hitting every tick, never, or a tick early or late moves a removal
// off its tick.
//
// WHY THE NIGHT IS POSED AS IT IS. Lantern alone at level 1 and one hound at
// the point 90 units along +x from the lamplighter's center, where the one
// lantern of a level-1 set starts (`0` degrees), every switch off but
// `weaponFire`: `effectMotion` off holds the lantern on the hound, so the
// overlap holds for every tick read; `enemyMotion` off holds the hound;
// `enemyContact` off keeps it from touching the lamplighter. Lantern's timer
// after the firing is `6.0`, so no second set joins the 61 ticks, and the
// set's `ttl` of `3.0` outlasts them.
//
// TOLERANCE. `FIGURE_TOLERANCE` on each hp reading and on a freshly set
// entry, exact arithmetic on stated figures; `MOTION_TOLERANCE` on an entry
// counted down tick by tick. None on the ticks, which the rule fixes to a
// whole count.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin, fail } from "../assert";
import {
  ENEMIES,
  FIGURE_TOLERANCE,
  LANTERN_REHIT,
  MOTION_TOLERANCE,
  TICK_DT,
  ticksFor,
} from "../constants";
import {
  captureReplay,
  createHarness,
  enemyById,
  pointAt,
  spawnEnemyAt,
  zoneById,
  type Harness,
} from "../harness";
import { armLantern, lanternRow, lanternsOf } from "./orbit";

/** The level this point holds Lantern at: one lantern of damage 10. */
const LEVEL = 1;

/** Row 1 of LANTERN_LEVELS. */
const ROW = lanternRow(LEVEL);

/** The enemy the lantern is held on: HP 120, radius 18. */
const PROBE = "hound";

/** The angle the one lantern of a level-1 set starts at: 0 × 360 / 1. */
const START_ANGLE = 0;

/** The ticks between one hit and the next: round(0.5 × 60). */
const REHIT_TICKS = ticksFor(LANTERN_REHIT);

/** The ticks watched from the pose: the firing hit and two re-hits. */
const WATCH_TICKS = 1 + 2 * REHIT_TICKS;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("hits the hound on tick 1, again on tick 31 and 61, and counts the entry down between", async () => {
  assertEqual(ROW.amount, 1, "the level-1 row's amount");
  const orbit = armLantern(h, LEVEL);
  const start = pointAt(orbit.player, ROW.orbit, START_ANGLE);
  const hound = spawnEnemyAt(h, PROBE, start.x, start.y);
  const placed = enemyById(h.snapshot(), hound);
  if (placed === undefined) fail("the posed hound", "not posed");
  assertEqual(placed.hp, ENEMIES[PROBE].hp, "the posed hound's hp");

  const watched = await captureReplay(h, "rehit", async () => {
    const fired = await h.tick(1);
    const set = lanternsOf(fired);
    assertEqual(set.length, 1, "Lantern lanterns after the firing");
    return {
      id: set[0].id,
      seen: [fired, ...(await h.trace(WATCH_TICKS - 1))],
    };
  });

  const hpOn = (tick: number): number => {
    const hit = enemyById(watched.seen[tick - 1], hound);
    if (hit === undefined) fail(`the hound after tick ${tick}`, "gone");
    return hit.hp;
  };
  const entryOn = (tick: number): number => {
    const lantern = zoneById(watched.seen[tick - 1], watched.id);
    if (lantern === undefined) fail(`the lantern after tick ${tick}`, "gone");
    const entries = lantern.hits.filter((entry) => entry.enemy === hound);
    assertEqual(
      entries.length,
      1,
      `the lantern's hits entries naming the hound after tick ${tick}`,
    );
    return entries[0].cooldown;
  };
  const damage = ROW.damage;

  // Hits land on ticks 1, 31, and 61; between them the hp holds and the
  // entry counts down from 0.5 by TICK_DT a tick.
  for (let tick = 1; tick <= WATCH_TICKS; tick += 1) {
    const hitsSoFar = 1 + Math.floor((tick - 1) / REHIT_TICKS);
    const sinceHit = (tick - 1) % REHIT_TICKS;
    assertWithin(
      hpOn(tick),
      ENEMIES[PROBE].hp - hitsSoFar * damage,
      FIGURE_TOLERANCE,
      `the hound's hp after tick ${tick}, ${hitsSoFar} hit(s) in`,
    );
    if (sinceHit === 0) {
      assertWithin(
        entryOn(tick),
        LANTERN_REHIT,
        FIGURE_TOLERANCE,
        `the lantern's entry for the hound after tick ${tick}, the tick it hit`,
      );
    } else {
      assertWithin(
        entryOn(tick),
        LANTERN_REHIT - sinceHit * TICK_DT,
        MOTION_TOLERANCE,
        `the lantern's entry for the hound after tick ${tick}, ${sinceHit} tick(s) after the hit`,
      );
    }
  }
});
