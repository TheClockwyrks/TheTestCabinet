// lantern/rehit-interval — one lantern re-hits one enemy every LANTERN_REHIT.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Lantern"): "Each
// lantern is a touching effect with re-hit interval `LANTERN_REHIT` (`0.5`),
// timed per lantern per enemy." ("Persistent effects"): "A touching effect
// (each Lantern lantern, each Shard, and each Sconce) damages an enemy on any
// tick the two overlap, at most once per re-hit interval per effect per
// enemy." `specs/world.md` ("Timers"): "An interval of `s` seconds anywhere in
// this specification is likewise `round(s × TICK_HZ)` ticks", so the interval
// is `round(0.5 × 60)` = 30 ticks. `specs/state.md` ("EnemyHit"):
// "`cooldown`: the seconds until this projectile or zone may hit that enemy
// again, a timer as `specs/world.md` defines one; an entry that is due is
// dropped. A Shard, a Sconce, and a lantern set it to their weapon's re-hit
// interval." Row 1 of the level table gives damage 10, and with no Wick held
// `damageMul` is 1 (`specs/passives.md`), so each hit removes 10
// (`specs/weapons.md`, Hits and death).
//
// So, counting from the tick the hound is posed under the standing lantern: it
// is hit on tick 1 and its `hp` falls by 10; the entry the hit wrote reads 0.5
// on that tick, since phase 6 of `specs/world.md` ("One tick") counts the
// entries down BEFORE the hits resolve and the entry did not yet exist; the
// entry counts down one `TICK_DT` a tick, so it reads 0.5 − 15 × TICK_DT = 0.25
// after tick 16; nothing is hit on any tick through tick 30; and on tick 31
// the entry is due, is dropped, and the lantern hits again, taking the `hp`
// down another 10.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding nothing but
// Lantern at level 1, whose set is one lantern with a 3.0-second life
// (180 ticks), comfortably past the 31 ticks read here. The hound is posed at
// the lantern's own center, read off the snapshot, so the two circles overlap
// at distance 0 whatever radii the build gave them, and a posed enemy "first
// moves, first hits, and first pulses on the next tick"
// (`specs/instrumentation.md`) — so the lantern's first opportunity against
// it is tick 1. `effectMotion` is OFF, as the review item states, which holds
// the lantern's angle over the hound while "`ttl` and every re-hit entry still
// count, and hits still resolve" (`specs/instrumentation.md`); `enemyMotion`
// keeps the hound under it, `enemyContact` keeps contact damage out, and
// `weaponFire` is turned off after the firing so no second set arrives. A
// hound is the enemy because its 120 base `hp` (`specs/enemies.md`) survives
// both hits, so the second is read as a fall in `hp` rather than as a death;
// its `hp` is read off the snapshot rather than assumed, since a spawn's
// `maxHp` is scaled by the run clock.
//
// THE TOLERANCE. `REAL_EPS` on each `hp`, a table damage subtracted once or
// twice from the posed value; `MOTION_EPS` on the entry's cooldown, which the
// build counts down one `TICK_DT` at a time. None on the ticks, which the
// interval rule fixes exactly. The nearest wrong reading — a hit one tick
// early or late, or an interval timed per enemy rather than per lantern —
// differs by a whole 10 of damage.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertNear } from "../assert";
import {
  LANTERN_LEVELS,
  LANTERN_REHIT,
  MOTION_EPS,
  REAL_EPS,
  TICK_DT,
  ticksOf,
} from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  disable,
  enemyById,
  placeEnemy,
  zoneById,
  type Harness,
  type WickSnapshot,
} from "../harness";
import { fireLantern } from "./set";

/** Row 1 of Lantern: one lantern, damage 10, duration 3.0 (180 ticks). */
const LEVEL = 1;
const ROW = LANTERN_LEVELS[LEVEL - 1];

/** Ticks between one lantern's hits on one enemy: `round(0.5 × 60)` = 30. */
const INTERVAL = ticksOf(LANTERN_REHIT);

/** The tick the entry's count-down is read on, mid-interval. */
const MIDWAY = 16;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** The seconds the lantern's re-hit entry for `enemy` reads, or `NaN`. */
function entryCooldown(s: WickSnapshot, zone: number, enemy: number): number {
  const hit = zoneById(s, zone)?.hits.find((entry) => entry.enemy === enemy);
  return hit === undefined ? Number.NaN : hit.cooldown;
}

it("hits a hound under a level-1 lantern on tick 1 and again on tick 31, counting the entry down between", async () => {
  const firing = await fireLantern(h, LEVEL);
  const lantern = firing.lanterns[0];
  assertDefined(
    lantern,
    "a lantern the firing tick created (specs/weapons.md, Lantern)",
  );
  disable(h, "weaponFire");

  const hound = placeEnemy(h, "hound", lantern.x, lantern.y);
  const posed = enemyById(h.snapshot(), hound);
  assertDefined(
    posed,
    "the hound in enemies after the pose (specs/instrumentation.md, spawnEnemy)",
  );
  const full = posed?.hp ?? Number.NaN;

  const trace = await captureReplay(h, "rehit", async () => {
    const first = await advanceTicks(h, 1);
    const midway = await advanceTicks(h, MIDWAY - 1);
    const between = await advanceTicks(h, INTERVAL - MIDWAY);
    const second = await advanceTicks(h, 1);
    return {
      firstHp: enemyById(first, hound)?.hp ?? Number.NaN,
      firstEntry: entryCooldown(first, lantern.id, hound),
      midwayEntry: entryCooldown(midway, lantern.id, hound),
      betweenHp: enemyById(between, hound)?.hp ?? Number.NaN,
      secondHp: enemyById(second, hound)?.hp ?? Number.NaN,
    };
  });

  assertNear(
    trace.firstHp,
    full - ROW.damage,
    REAL_EPS,
    `the hound's hp after tick 1 under the lantern, one hit of ${ROW.damage} from ${full} (specs/weapons.md, Persistent effects)`,
  );
  assertNear(
    trace.firstEntry,
    LANTERN_REHIT,
    REAL_EPS,
    `the lantern's re-hit entry for the hound after tick 1 (specs/state.md, EnemyHit)`,
  );
  assertNear(
    trace.midwayEntry,
    LANTERN_REHIT - (MIDWAY - 1) * TICK_DT,
    MOTION_EPS,
    `the lantern's re-hit entry for the hound after tick ${MIDWAY}, counted down ${MIDWAY - 1} ticks (specs/state.md, EnemyHit)`,
  );
  assertNear(
    trace.betweenHp,
    full - ROW.damage,
    REAL_EPS,
    `the hound's hp after tick ${INTERVAL}, no second hit before the interval is due (specs/weapons.md, Lantern)`,
  );
  assertNear(
    trace.secondHp,
    full - 2 * ROW.damage,
    REAL_EPS,
    `the hound's hp after tick ${INTERVAL + 1}, the lantern's re-hit (specs/weapons.md, Lantern)`,
  );
});
