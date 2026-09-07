// enemies/drops — one enemy killed by a weapon, shared by the drop checks and
// the kill count in this directory. CASE-PROVIDED.
//
// WHAT EVERY DROP CHECK SHARES. `specs/enemies.md` ("Drops") hangs the drop on
// a death: "A death leaves its drop at the enemy's center on the tick it
// dies", and `specs/weapons.md` ("Hits and death") makes a death the tick's
// own consequence: "On any tick an enemy's `hp` is at or below `0` after the
// hits the enemy dies on that tick: the kill count rises by one, the enemy
// drops what `specs/enemies.md` lists for it". So a drop check needs one
// enemy, one weapon's hit that takes it to `0` or below, and the one tick that
// resolves both. That arrangement is spelled once here and decides nothing:
// the enemy is placed through the real spawn path, the hit comes from a real
// Oil Splash puddle, and the death is the tick's.
//
// WHY AN OIL SPLASH PUDDLE IS THE WEAPON. It is the shortest honest path from
// a posed world to a death: a puddle posed at the enemy's own center overlaps
// it certainly, "pulses first on the next tick" whatever the driver switches
// hold, and "each pulse deals `damage` to every enemy overlapping it"
// (`specs/instrumentation.md`, `spawnPuddle`; `specs/weapons.md`, Oil Splash),
// so exactly one tick separates the pose from the death and nothing has to be
// waited out. Its damage is the level-1 row's `4` — "that row's damage times
// the `damageMul` in force at the call", at level `1` since Oil Splash is not
// held and no Wick is either — so the enemy's `hp` is posed to `4`, or to its
// own `maxHp` where that is lower, and the pulse takes it to `0` or below.
// Which weapon lands the hit is nothing a drop depends on: "Kill count and
// drops apply to every rank alike" (`specs/enemies.md`, The life of an enemy).
//
// WHY `drops` IS TURNED ON. It is the faculty every check that uses this
// helper is about: with it off "A death leaves nothing on the field and makes
// no drop roll" (`specs/instrumentation.md`, the switch table),
// which is what an isolated world holds by default. {@link killWithPuddle}
// turns it back on and leaves the other eight switches off, and a check that
// poses its own world turns it on before calling {@link killOne}.
//
// WHERE THE ENEMY STANDS. `POST` (200) units from the lamplighter's center,
// which is far outside every collection the tick could make: a gem is
// attracted within `pickupRadius` (`48` with no Lure held) and collected
// within `COLLECT_RADIUS` (`8`), and a pickup is collected inside
// `PICKUP_ITEM_RADIUS + PLAYER_RADIUS` (`28`) (`specs/world.md`). So whatever
// the death leaves is still lying where it fell when the snapshot is read.
//
// WHAT ELSE THE TICK MAY LEAVE. A common's death also "rolls for a pickup, as
// that file states", so a common kill may leave a pickup beside its gem; the
// gem checks read gems and say nothing about it. Elites and the Dark "make no
// roll", so what a check reads in `pickups` after one of those deaths is the
// whole of what the death left.

import { fail } from "../assert";
import { ENEMIES, OIL_SPLASH_LEVELS, type EnemyId } from "../constants";
import {
  advanceTicks,
  enable,
  enemyById,
  isolate,
  placeEnemyNear,
  placePuddle,
  type Harness,
  type Point,
  type WickSnapshot,
} from "../harness";

/** How far from the lamplighter the enemy stands, and dies. */
export const POST = 200;

/** A level-1 Oil Splash puddle's damage, `4`, with no Wick held. */
export const PUDDLE_DAMAGE = OIL_SPLASH_LEVELS[0].damage;

/** What one killing tick left. */
export interface Death {
  /** The id the enemy held while it lived. */
  id: number;
  /** The center it stood at on the tick it died. */
  at: Point;
  /** The state before the killing tick. */
  before: WickSnapshot;
  /** The state the killing tick left. */
  after: WickSnapshot;
}

/**
 * Kill one enemy of `type` in the run as it already stands, and read the tick
 * that killed it.
 *
 * Every zone is cleared first, so the puddle that lands the hit is the only
 * shape in the world and a check that kills several in turn is not carrying
 * the last one's puddle into the next death. `enemyMotion` is off in an
 * isolated run, so the enemy dies at the post it was placed on and `at` is
 * the center the drop is required to land on.
 *
 * A build whose enemy survived the hit fails here: the claim each check in
 * this directory makes is about what a death leaves, and there was no death.
 */
export async function killOne(h: Harness, type: EnemyId): Promise<Death> {
  h.debug.clearZones();
  const id = placeEnemyNear(h, type, POST, 0);
  const spawned = enemyById(h.snapshot(), id);
  if (spawned === undefined) fail(`a live enemy with id ${id}`, "none");
  const at: Point = { x: spawned.x, y: spawned.y };

  h.debug.setEnemyHp(id, Math.min(PUDDLE_DAMAGE, ENEMIES[type].hp));
  placePuddle(h, "oil-splash", at.x, at.y);

  const before = h.snapshot();
  const after = await advanceTicks(h, 1);
  if (enemyById(after, id) !== undefined) {
    fail(
      `no live enemy with id ${id}, the ${type} a ${PUDDLE_DAMAGE}-damage pulse took to 0 hp (specs/weapons.md, Hits and death)`,
      "still alive",
    );
  }
  return { id, at, before, after };
}

/**
 * Pose an isolated run with `drops` on — the faculty every check here reads —
 * and kill one enemy of `type` in it. The other eight switches stay off.
 */
export async function killWithPuddle(
  h: Harness,
  type: EnemyId,
): Promise<Death> {
  isolate(h);
  enable(h, "drops");
  return killOne(h, type);
}
