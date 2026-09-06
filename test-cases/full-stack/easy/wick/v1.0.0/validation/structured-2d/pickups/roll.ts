// pickups/roll — a large sample of common kills, shared by the drop-roll rate
// checks in this directory, and the one posed kill the drop checks read.
// CASE-PROVIDED.
//
// WHAT EVERY DROP-ROLL CHECK SHARES. `specs/world.md` ("The drop roll"): "each
// common enemy killed by a weapon rolls for a pickup on the tick it dies ...
// The roll drops bread with probability `BREAD_CHANCE`, and only when it
// dropped no bread it drops a draft with probability `DRAFT_CHANCE`. A kill
// therefore drops at most one of the two, and the pickup lands at the enemy's
// position beside its gem." A rate is a probability, so the rate checks read
// a sample of `DROP_TRIALS` (`4000`) common kills and say something about the
// whole of it; what one kill drops is posed through `setNextDrop`
// (`specs/instrumentation.md`, Drawn outcomes) and read off that kill. This
// module makes both and decides nothing about them.
//
// HOW A KILL IS MADE. The shortest honest path from a posed world to a death
// (the one `enemies/drops` takes for a single kill): a level-1 Oil Splash puddle
// posed on the enemy's own center overlaps it certainly, "pulses first on the
// next tick" whatever the driver switches hold, and "each pulse deals `damage`
// to every enemy overlapping it" (`specs/instrumentation.md`, `spawnPuddle`;
// `specs/weapons.md`, Oil Splash). A moth's `hp` is posed to that row's `4` with
// `setEnemyHp`, so the next tick takes it to `0` and the death, the gem, and the
// roll are all that tick's. A moth is the common read because it is rank
// `common` (`specs/enemies.md`), which is what makes a kill roll at all.
//
// WHY THE KILLS COME IN BATCHES. `BATCH` (`100`) moths are posed and killed
// together on one tick, so the sample costs `DROP_TRIALS / BATCH` (`40`) ticks
// of the real simulation rather than four thousand. Nothing about the roll
// depends on how the kills are divided between ticks: each is a common killed by
// a weapon, and the rolls are the build's own, in whatever order it makes them.
// A caller may pose a narrower or a wider batch.
//
// WHERE THE MOTHS STAND. On a lattice `SPACING` (`200`) units apart, starting
// `FIELD` (`4000`) units from the lamplighter on both axes. That spacing is far
// wider than a level-1 puddle's radius (`50`) plus a moth's (`10`), so each
// puddle overlaps its own moth alone and no kill is another puddle's. The whole
// lattice is far outside `pickupRadius` (`48` with no Lure held) and the
// collection distance `PICKUP_ITEM_RADIUS + PLAYER_RADIUS` (`28`), so nothing a
// kill leaves is attracted or collected and every drop is still lying where it
// fell when the tick's snapshot is read. Every kill of the sample takes its own
// lattice point, so two pickups sharing a center can only be two drops of one
// kill.
//
// WHY `drops` IS TURNED ON. It is the faculty every check here is about: with
// it off a death "leaves nothing on the field and makes no drop roll"
// (`specs/instrumentation.md`, the switch table), which is exactly what an
// isolated world holds by default, so the sample turns it back on and leaves
// the other eight switches off.
//
// WHAT IS CARRIED AWAY, AND WHAT IS SWEPT. Each batch's pickups are copied out
// of the snapshot and the field is then cleared of pickups, gems, and zones
// through the surface's own operations, which collect nothing and score nothing
// (`specs/instrumentation.md`), so the next batch runs against an empty world
// and the snapshot stays small. `despawning` is off throughout, so nothing is
// removed by distance.

import { fail } from "../assert";
import {
  DROP_TRIALS,
  ENEMIES,
  OIL_SPLASH_LEVELS,
  type EnemyId,
  type PickupKind,
} from "../constants";
import {
  advanceTicks,
  enable,
  isolate,
  placeEnemy,
  placePuddle,
  type Harness,
  type Point,
  type SnapshotGem,
  type SnapshotPickup,
  type WickSnapshot,
} from "../harness";

/** A level-1 Oil Splash puddle's damage, `4`, with no Wick held. */
export const PULSE_DAMAGE = OIL_SPLASH_LEVELS[0].damage;

/** How many kills share one tick. */
export const BATCH = 100;

/**
 * How many kills share one tick for a check that would rather spend ticks than
 * field.
 *
 * A tick's work over a posed field grows with the puddles and the moths
 * standing on it at once, and the fixed cost of a tick does not, so the same
 * sample is cheaper in narrower batches over more ticks. Nothing about the roll
 * depends on how the kills are divided between ticks.
 */
export const NARROW_BATCH = 20;

/** How far apart the lattice's points stand, in units. */
export const SPACING = 200;

/** How far the lattice's near corner stands from the lamplighter, in units. */
export const FIELD = 4000;

/** How many lattice points sit in one row. */
export const COLUMNS = 100;

/** One pickup a kill left, as the tick's snapshot reported it. */
export interface Drop {
  kind: PickupKind;
  x: number;
  y: number;
}

/** What a sample of kills left behind. */
export interface Sample {
  /** How many commons the sample killed. */
  kills: number;
  /** Every pickup those kills dropped, in the order the ticks reported them. */
  drops: Drop[];
}

/** The lattice point kill `n` of the sample is made at. */
function post(at: Point, n: number): Point {
  return {
    x: at.x + FIELD + (n % COLUMNS) * SPACING,
    y: at.y + FIELD + Math.floor(n / COLUMNS) * SPACING,
  };
}

/**
 * Kill `trials` moths from a fresh isolated night, and hand back every pickup
 * those kills dropped.
 *
 * A build whose moths survived the pulse, or whose kill count did not rise by
 * the batch, fails here: every check that reads this sample is about what a
 * common's death rolls, and there were no deaths to roll for.
 *
 * `batch` is how many kills share one tick. It changes nothing about the roll
 * — each kill is still a common killed by a weapon at its own lattice point —
 * so a caller free to spend more ticks may narrow it.
 */
export async function sampleDrops(
  h: Harness,
  trials: number = DROP_TRIALS,
  batch: number = BATCH,
): Promise<Sample> {
  const posed = isolate(h);
  const at = posed.run.player;
  enable(h, "drops");
  const drops: Drop[] = [];
  let killed = 0;

  while (killed < trials) {
    const size = Math.min(batch, trials - killed);
    for (let n = 0; n < size; n += 1) {
      const where = post(at, killed + n);
      h.debug.spawnEnemy("moth", where.x, where.y);
    }
    const standing = h.snapshot();
    if (standing.run.enemies.length !== size) {
      fail(
        `${size} moths alive after ${size} calls to spawnEnemy (specs/instrumentation.md)`,
        standing.run.enemies.length,
      );
    }
    for (const moth of standing.run.enemies) {
      h.debug.setEnemyHp(moth.id, Math.min(PULSE_DAMAGE, ENEMIES.moth.hp));
      h.debug.spawnPuddle("oil-splash", moth.x, moth.y);
    }

    const after = await advanceTicks(h, 1);
    if (after.run.enemies.length !== 0) {
      fail(
        `no moth alive after a ${PULSE_DAMAGE}-damage pulse on each of ${size} moths at ${PULSE_DAMAGE} hp (specs/weapons.md, Hits and death)`,
        `${after.run.enemies.length} still alive`,
      );
    }
    if (after.run.kills !== standing.run.kills + size) {
      fail(
        `${standing.run.kills + size} kills after the tick that killed ${size} moths (specs/enemies.md, The life of an enemy)`,
        after.run.kills,
      );
    }
    for (const pickup of after.run.pickups) {
      drops.push({ kind: pickup.kind, x: pickup.x, y: pickup.y });
    }

    h.debug.clearPickups();
    h.debug.clearGems();
    h.debug.clearZones();
    killed += size;
  }

  return { kills: killed, drops };
}

/** How many of `drops` are of kind `kind`. */
export function countOf(drops: readonly Drop[], kind: PickupKind): number {
  return drops.filter((drop) => drop.kind === kind).length;
}

/** What one kill left on the field, read on the tick it died. */
export interface Kill {
  /** Where the enemy stood when it died. */
  at: Point;
  /** The gems on the field after the tick of death. */
  gems: SnapshotGem[];
  /** The pickups on the field after the tick of death. */
  pickups: SnapshotPickup[];
  /** The whole state after the tick of death. */
  after: WickSnapshot;
}

/**
 * Kill one enemy of `type` posed `(dx, dy)` from the lamplighter's center, the
 * way the sample kills its moths: a level-1 Oil Splash puddle on its center
 * and its `hp` posed to that pulse's damage, so the next tick is the tick of
 * death. The world is the caller's: whatever it posed, `drops` included,
 * stands. Fails when the enemy survived the pulse or the kill did not count.
 */
export async function killOne(
  h: Harness,
  type: EnemyId,
  dx: number,
  dy: number,
): Promise<Kill> {
  const center = h.snapshot().run.player;
  const at = { x: center.x + dx, y: center.y + dy };
  const id = placeEnemy(h, type, at.x, at.y);
  h.debug.setEnemyHp(id, Math.min(PULSE_DAMAGE, ENEMIES[type].hp));
  placePuddle(h, "oil-splash", at.x, at.y);
  const before = h.snapshot();
  const after = await advanceTicks(h, 1);
  if (after.run.enemies.some((enemy) => enemy.id === id)) {
    fail(
      `${type} ${id} dead after a ${PULSE_DAMAGE}-damage pulse at ${PULSE_DAMAGE} hp (specs/weapons.md, Hits and death)`,
      "still alive",
    );
  }
  if (after.run.kills !== before.run.kills + 1) {
    fail(
      `${before.run.kills + 1} kills after the tick that killed ${type} ${id} (specs/enemies.md, The life of an enemy)`,
      after.run.kills,
    );
  }
  return { at, gems: after.run.gems, pickups: after.run.pickups, after };
}
