// pickups/roll — a large seeded sample of common kills, shared by the four
// drop-roll checks in this directory. CASE-PROVIDED.
//
// WHAT EVERY DROP-ROLL CHECK SHARES. `specs/world.md` ("The drop roll"): "Each
// common enemy killed by a weapon draws from the game's seeded random generator
// on the tick it dies. A first draw, uniform on `[0, 1)`, drops bread when it is
// below `BREAD_CHANCE`. Only when it did not, a second draw drops a draft when
// it is below `DRAFT_CHANCE`. A kill therefore drops at most one of the two, and
// the pickup lands at the enemy's position beside its gem." Nothing about one
// kill is readable: the roll is a probability, so every check here reads a
// sample of `DROP_TRIALS` (`4000`) common kills and says something about the
// whole of it. This module makes that sample and decides nothing about it.
//
// HOW A KILL IS MADE. The shortest honest path from a posed world to a death
// (the one `enemies/drops` takes for a single kill): a level-1 Oil Splash puddle
// posed on the enemy's own center overlaps it certainly, "pulses first on the
// next tick" whatever the driver switches hold, and "each pulse deals `damage`
// to every enemy overlapping it" (`specs/instrumentation.md`, `spawnPuddle`;
// `specs/weapons.md`, Oil Splash). A moth's `hp` is posed to that row's `4` with
// `setEnemyHp`, so the next tick takes it to `0` and the death, the gem, and the
// draw are all that tick's. A moth is the common read because it is rank
// `common` (`specs/enemies.md`), which is what makes a kill draw at all.
//
// WHY THE KILLS COME IN BATCHES. `BATCH` (`100`) moths are posed and killed
// together on one tick, so the sample costs `DROP_TRIALS / BATCH` (`40`) ticks
// of the real simulation rather than four thousand. Nothing about the roll
// depends on how the kills are divided between ticks: each is a common killed by
// a weapon, and the draws are the build's own, in whatever order it makes them.
// A caller may pose a narrower or a wider batch.
//
// WHAT THE GENERATOR IS READ FOR. `rngState` is reported before the first kill
// and after the last, so a check can say how far the sample moved the build's
// own generator. `specs/instrumentation.md` ("A deterministic core"): the game
// "holds one pseudo-random generator, seeded by `reset` and keeping its whole
// state in `rngState`, and every random draw comes from it", and the sample
// makes no other draw — every switch but `drops` is off, no slot is held, and a
// pose "changes the state alone" — so the distance between the two readings is
// exactly the draws the sample's kills made. `drop-at-most-one` reads that
// distance against `advanceRng`, which takes a stated count of draws off the
// same generator.
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
// it off a death "leaves nothing on the field and draws nothing from the
// generator" (`specs/instrumentation.md`, the switch table), which is exactly
// what an isolated world holds by default, so the sample turns it back on and
// leaves the other eight switches off.
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
  type PickupKind,
} from "../constants";
import {
  advanceTicks,
  enable,
  isolate,
  type Harness,
  type Point,
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
  /**
   * `rngState` as the isolated night stood before the first kill, which is
   * where a replay of the sample's draws begins.
   */
  startRng: number;
  /** `rngState` after the last kill's tick, the whole sample's draws behind it. */
  endRng: number;
}

/** The lattice point kill `n` of the sample is made at. */
function post(at: Point, n: number): Point {
  return {
    x: at.x + FIELD + (n % COLUMNS) * SPACING,
    y: at.y + FIELD + Math.floor(n / COLUMNS) * SPACING,
  };
}

/**
 * Kill `trials` moths from a fresh isolated night seeded with `seed`, and hand
 * back every pickup those kills dropped.
 *
 * A build whose moths survived the pulse, or whose kill count did not rise by
 * the batch, fails here: every check that reads this sample is about what a
 * common's death draws, and there were no deaths to draw for.
 *
 * `batch` is how many kills share one tick. It changes nothing about the roll
 * — each kill is still a common killed by a weapon at its own lattice point —
 * so a caller free to spend more ticks may narrow it.
 */
export async function sampleDrops(
  h: Harness,
  seed: number,
  trials: number = DROP_TRIALS,
  batch: number = BATCH,
): Promise<Sample> {
  const posed = isolate(h, { seed });
  const at = posed.run.player;
  enable(h, "drops");
  const drops: Drop[] = [];
  const startRng = posed.rngState;
  let endRng = startRng;
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
    endRng = after.rngState;

    h.debug.clearPickups();
    h.debug.clearGems();
    h.debug.clearZones();
    killed += size;
  }

  return { kills: killed, drops, startRng, endRng };
}

/** How many of `drops` are of kind `kind`. */
export function countOf(drops: readonly Drop[], kind: PickupKind): number {
  return drops.filter((drop) => drop.kind === kind).length;
}
