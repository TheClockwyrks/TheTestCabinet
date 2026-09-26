// instrumentation/crowded-field — the one field the roster checks pose.
//
// Eight of this group's points ask the same question in different directions:
// what an operation that empties or removes ONE roster does to the other three.
// `specs/instrumentation.md` gives each of them exactly that scope —
// `clearDrones()` "Removes every drone, leaving the bullets and bursts standing",
// `clearPlayerBullets()` "Removes every one of the player's bullets, leaving the
// enemy bullets, the drones, and the bursts standing", and so on — and none of
// those readings means anything on a field where the rosters that must survive
// were empty to begin with. So they all start from one crowded field, and it is
// built here rather than nine times over.
//
// WHAT THIS FILE FIXES AND WHAT IT DOES NOT. Placements only: where a drone
// stands, where a shot starts, where a bullet hangs. Every tolerance, every
// bound and every verdict stays in the check that asserts it, because a
// threshold buried in a helper hides what a point is really holding a build to
// (`guides/authoring/writing-debug-apis-and-validators.md`). Nothing here
// asserts an outcome either: the shot that leaves a burst is the build's own
// contact and band rules resolving, and this file only reports that the
// scenario the caller asked for was reached.
//
// WHY A BURST HAS TO BE POPPED. There is no operation that adds one: "A burst is
// an outcome of a drone being destroyed" (`specs/instrumentation.md`, The
// bursts). The only way a check about `clearBursts` or `removeBurst` can have a
// burst to act on is to destroy a drone and read the roster the build filled, so
// a matching shot into a Shard — the plainest destroying case `specs/bands.md`
// names — is what puts one there.
//
// AND WHY THREE DRONES STAND. They are not props held out of the way: they are
// what `clearDrones` and `removeDrone` act on, and what the other six points
// read to decide that an operation aimed at one roster left the drones alone.
// Each one is inside the requirement every check here decides.

import { fail } from "../assert";
import {
  lastBullet,
  poseDrone,
  shootDrone,
  startPosed,
  type Harness,
} from "../harness";
import type { Band } from "../constants";

/**
 * Where the drones that no operation below removes stand.
 *
 * Three of them, spread across the upper play field: clear of the top HUD strip
 * (`FIELD_TOP` 64), clear of the ship's lane (`SHIP_Y` 600), clear of the
 * columns the shots climb, and far enough apart that no drone is inside any
 * other's contact reach.
 */
const STANDING: readonly { x: number; y: number }[] = [
  { x: 300, y: 200 },
  { x: 500, y: 240 },
  { x: 1080, y: 200 },
];

/**
 * Where a drone is popped, one entry per burst the caller asks for.
 *
 * Below the formation grid's lowest row and its full sway (`y` 332 + 20) and
 * above the ship's lane, in columns nothing else stands in, so the shot that
 * pops it passes nothing on its way up.
 */
const POP_AT: readonly { x: number; y: number }[] = [
  { x: 900, y: 460 },
  { x: 1180, y: 460 },
];

/**
 * How far below its target a popping shot starts, in logical units.
 *
 * A Shard's contact reach is `SHARD_HALF` (14) plus `PLAYER_BULLET_HALF` (6),
 * which is 20 units of centre separation, so 60 puts the bullet in flight rather
 * than already in contact and still leaves it a short climb into a target that
 * is holding still.
 */
const SHOT_BELOW = 60;

/**
 * Frames a popping shot is allowed.
 *
 * At `PLAYER_BULLET_SPEED` (760) a bullet covers 7.6 units per frame of the
 * suite's 100 Hz clock, so it enters the 20-unit reach after 40 units — six
 * frames. Twenty-five leaves the build nineteen frames of slack for whichever
 * frame it resolves the contact on, and still ends the sweep short of the target
 * rather than at the top of the field.
 */
const SHOT_FRAMES = 25;

/** Where the player's bullets hang, well clear of the ship and of every drone. */
const FRIENDLY_AT: readonly { x: number; y: number }[] = [
  { x: 80, y: 600 },
  { x: 160, y: 560 },
];

/** Where the enemy's bullets hang, in the same clear corner. */
const ENEMY_AT: readonly { x: number; y: number }[] = [
  { x: 1150, y: 120 },
  { x: 1220, y: 160 },
];

/** The band each posed bullet carries. A bullet's band is fixed for its life. */
const FRIENDLY_BAND: Band = "cyan";
const ENEMY_BAND: Band = "magenta";

/** Every entity the field was posed with, by the roster it stands on. */
export interface CrowdedField {
  /** The drones still standing: nothing below removes one. */
  drones: number[];
  /** The player's bullets, in the order they were placed. */
  friendly: number[];
  /** The enemy's bullets, in the order they were placed. */
  enemy: number[];
  /** The bursts a pop left playing, in the order they were popped. */
  bursts: number[];
}

/**
 * Pose an empty, quiet, live wave and then fill all four of its rosters.
 *
 * In order: {@link startPosed}'s empty field, the standing drones, one popped
 * drone per burst asked for, and two bullets of each kind. The bullets go on
 * LAST, after every shot has resolved, so the roster a check reads holds exactly
 * what was placed on it and not the remains of a shot.
 *
 * No frame runs after the last placement, so a check that reads the field
 * immediately reads it exactly as it was posed.
 */
export async function poseCrowdedField(
  h: Harness,
  options: { bursts?: number } = {},
): Promise<CrowdedField> {
  const wanted = options.bursts ?? 1;
  if (wanted > POP_AT.length) {
    throw new RangeError(
      `poseCrowdedField knows ${POP_AT.length} places to pop a drone, not ${wanted}`,
    );
  }

  await startPosed(h);

  const drones: number[] = [];
  for (const at of STANDING) {
    drones.push(await poseDrone(h, "shard", at.x, at.y, { band: "cyan" }));
  }

  const bursts: number[] = [];
  for (let i = 0; i < wanted; i += 1) {
    const at = POP_AT[i];
    const before = new Set((await h.snapshot()).bursts.map((b) => b.id));
    const target = await poseDrone(h, "shard", at.x, at.y, { band: "cyan" });
    const shot = await shootDrone(h, target, "cyan", {
      below: SHOT_BELOW,
      maxFrames: SHOT_FRAMES,
    });
    if (!shot.hit) {
      fail(
        `the shot fired into the Shard at (${at.x}, ${at.y}) to resolve inside ` +
          `${SHOT_FRAMES} frames — this scenario cannot be posed without it`,
        `the bullet was still in flight after ${SHOT_FRAMES} frames`,
      );
    }
    const added = shot.snapshot.bursts.filter((b) => !before.has(b.id));
    if (added.length !== 1) {
      fail(
        `exactly one burst playing after a matching shot destroyed the Shard ` +
          `at (${at.x}, ${at.y}) (specs/assets.md) — this scenario cannot be ` +
          `posed without a burst on the roster`,
        `${added.length} new bursts`,
      );
    }
    bursts.push(added[0].id);
  }

  const friendly: number[] = [];
  for (const at of FRIENDLY_AT) {
    await h.debug.addPlayerBullet(at.x, at.y, FRIENDLY_BAND);
    friendly.push(await placedBullet(h, `addPlayerBullet(${at.x}, ${at.y})`));
  }

  const enemy: number[] = [];
  for (const at of ENEMY_AT) {
    await h.debug.addEnemyBullet(at.x, at.y, ENEMY_BAND);
    enemy.push(await placedBullet(h, `addEnemyBullet(${at.x}, ${at.y})`));
  }

  return { drones, friendly, enemy, bursts };
}

/**
 * A roster in id order, so two readings of it are compared as SETS of entries.
 *
 * `specs/instrumentation.md` says only that a roster is reported "in roster
 * order", and fixes no order of its own — so a check holding the survivors of a
 * removal to being untouched compares which entries stand and what each of them
 * holds, and not where in the array a build kept them.
 */
export function sortedById<T extends { id: number }>(
  entries: readonly T[],
): T[] {
  return [...entries].sort((a, b) => a.id - b.id);
}

/**
 * The id of the bullet the last `add` appended, read off the roster's end.
 *
 * `specs/instrumentation.md` (Identity): "An entity added through this surface
 * is appended to its roster, so it is the last entry and its id is read from
 * there." `instrumentation/entity-ids` is the point that grades the rule; here
 * it is how a placement is addressed at all.
 */
async function placedBullet(h: Harness, what: string): Promise<number> {
  const added = lastBullet(await h.snapshot());
  if (added === undefined) {
    fail(
      `${what} to append a bullet to the roster (specs/instrumentation.md)`,
      "the bullet roster was empty after the add",
    );
  }
  return added.id;
}
