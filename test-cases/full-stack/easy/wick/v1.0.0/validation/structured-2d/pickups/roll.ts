// pickups/roll — a handful of drop rolls, shared by the `rollDrop` checks,
// and the one posed kill the drop checks read. CASE-PROVIDED.
//
// WHAT EVERY DROP-ROLL CHECK SHARES. `specs/world.md` ("The drop roll"): "each
// common enemy killed by a weapon rolls for a pickup on the tick it dies ...
// The roll drops bread with probability `BREAD_CHANCE`, and only when it
// dropped no bread it drops a draft with probability `DRAFT_CHANCE`, so a kill
// drops one pickup or none. The pickup lands at the enemy's position beside
// its gem." A rate is a probability, and the surface carries the roll on its
// own: `rollDrop()` "Makes one drop roll exactly as `specs/world.md` states
// under The drop roll and returns what it decided: `bread`, `draft`, or
// `none`. It is a reading of the roll alone" (`specs/instrumentation.md`,
// Drawn outcomes). So the `instrumentation/roll-drop*` checks read a handful of
// such rolls and say what each returned and what the state did across them;
// what one kill drops is posed through `setNextDrop`
// (`specs/instrumentation.md`, Drawn outcomes) and read off that kill. This
// module makes both and decides nothing about them. The probabilities
// themselves are the reviewer's to judge, since a sample a check could afford
// cannot tell `0.02` from its neighbours.
//
// THE SAMPLE. `rollDrops` calls `rollDrop` as many times as the caller names
// over whatever world the caller posed and counts what came back. Nothing is
// posed for the rolls, so each is the build's own; that the calls leave the
// world as it was is the surface's own rule, decided by
// `instrumentation/roll-drop-changes-nothing`.
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

import { fail } from "../assert";
import {
  ENEMIES,
  NEXT_DROPS,
  OIL_SPLASH_LEVELS,
  type EnemyId,
  type NextDrop,
} from "../constants";
import {
  advanceTicks,
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

/** What a sample of rolls decided. */
export interface RollSample {
  /** How many rolls were made. */
  rolls: number;
  /** How many rolls decided each kind. */
  counts: Readonly<Record<NextDrop, number>>;
  /** Every result outside `bread`, `draft`, and `none`, as the surface returned it. */
  others: unknown[];
}

/**
 * Make `rolls` drop rolls through `rollDrop` and hand back what they decided.
 * Nothing is posed for the rolls, so each is the build's own.
 */
export function rollDrops(h: Harness, rolls: number): RollSample {
  const counts: Record<NextDrop, number> = { bread: 0, draft: 0, none: 0 };
  const others: unknown[] = [];
  const kinds: readonly string[] = NEXT_DROPS;
  for (let i = 0; i < rolls; i += 1) {
    const rolled: unknown = h.debug.rollDrop();
    if (typeof rolled === "string" && kinds.includes(rolled)) {
      counts[rolled as NextDrop] += 1;
    } else {
      others.push(rolled);
    }
  }
  return { rolls, counts, others };
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
