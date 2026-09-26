// instrumentation/crowded-field — the one field the roster checks pose.
//
// Eight of this group's points ask the same question in different directions:
// what an operation that empties or removes ONE roster does to the other three.
// specs/instrumentation.md gives each of them exactly that scope —
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
// (guides/authoring/writing-debug-apis-and-validators.md). Nothing here asserts
// an outcome either: the shot that leaves a burst is the build's own contact and
// band rules resolving, and this file only reports that the scenario the caller
// asked for was reached.
//
// WHY A BURST HAS TO BE POPPED. There is no operation that adds one: "A burst is
// an outcome of a drone being destroyed" (specs/instrumentation.md, The bursts).
// The only way a check about `clearBursts` or `removeBurst` can have a burst to
// act on is to destroy a drone and read the roster the build filled, so a
// matching shot into a Shard — the plainest destroying case specs/bands.md names
// — is what puts one there.
//
// AND WHY THREE DRONES STAND. They are not props held out of the way: they are
// what `clearDrones` and `removeDrone` act on, and what the other six points
// read to decide that an operation aimed at one roster left the drones alone.
// Each one is inside the requirement every check here decides.

import {
  PLAYER_BULLET_HALF,
  PLAYER_BULLET_SPEED,
  SHARD_HALF,
} from "../constants";
import { fail } from "../assert";
import {
  droneById,
  poseDrone,
  poseEnemyBullet,
  posePlayerBullet,
  startPosed,
  ticksFor,
  type Band,
  type DroneSnapshot,
  type Harness,
  type SpectraSnapshot,
} from "../harness";

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
 * How close two centres come for a player bullet and a Shard to touch, in
 * logical units.
 *
 * specs/simulation.md decides a contact as an overlap of two circles of the
 * half-extents their own specs state: `SHARD_HALF` (`14`, specs/drones.md) and
 * `PLAYER_BULLET_HALF` (`6`, specs/ship.md).
 */
const TOUCHING = SHARD_HALF + PLAYER_BULLET_HALF;

/**
 * How far below its target a popping shot starts, in logical units.
 *
 * Three times the contact reach, so the bullet is placed in flight rather than
 * already in contact and still has only a short climb into a target that is
 * holding still.
 */
const SHOT_BELOW = 3 * TOUCHING;

/**
 * Frames a popping shot is allowed.
 *
 * The climb from `SHOT_BELOW` to the edge of the contact reach at
 * `PLAYER_BULLET_SPEED` (`760`, specs/ship.md) is `40` units, which is six
 * frames of the suite's 100 Hz clock. Four times that leaves ample slack for
 * whichever sub-step a build resolves the contact on, and still ends the sweep
 * short of the target rather than at the top of the field.
 */
const SHOT_FRAMES = 4 * ticksFor((SHOT_BELOW - TOUCHING) / PLAYER_BULLET_SPEED);

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

  startPosed(h);

  const drones: number[] = [];
  for (const at of STANDING) {
    drones.push(poseDrone(h, "shard", at.x, at.y, { band: "cyan" }));
  }

  const bursts: number[] = [];
  for (let i = 0; i < wanted; i += 1) {
    const at = POP_AT[i];
    const before = new Set(h.snapshot().bursts.map((burst) => burst.id));
    const target = poseDrone(h, "shard", at.x, at.y, { band: "cyan" });
    posePlayerBullet(h, at.x, at.y + SHOT_BELOW, "cyan");
    const shot = await h.until((s) => droneById(s, target) === undefined, {
      maxFrames: SHOT_FRAMES,
    });
    if (!shot.hit) {
      fail(
        `the cyan shot fired into the cyan Shard at (${at.x}, ${at.y}) to ` +
          `destroy it inside ${SHOT_FRAMES} frames (specs/bands.md) — this ` +
          `scenario cannot be posed without the kill`,
        `the Shard was still standing after ${SHOT_FRAMES} frames`,
      );
    }
    const added = shot.snapshot.bursts.filter((burst) => !before.has(burst.id));
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

  const friendly = FRIENDLY_AT.map((at) =>
    posePlayerBullet(h, at.x, at.y, FRIENDLY_BAND),
  );
  const enemy = ENEMY_AT.map((at) =>
    poseEnemyBullet(h, at.x, at.y, ENEMY_BAND),
  );

  return { drones, friendly, enemy, bursts };
}

/**
 * A roster in id order, so two readings of it are compared as SETS of entries.
 *
 * specs/instrumentation.md says only that a roster is reported "in roster
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
 * The drone carrying `id`, or the failure that no drone does.
 *
 * The shared harness reads a roster without asserting anything — "a reading that
 * is not there comes back `undefined`, and what that means is the check's to
 * state" — and what it means in this group is that the entity a check is about
 * is missing, so it is stated once here rather than at every reading.
 */
export function requireDrone(
  snapshot: SpectraSnapshot,
  id: number,
  what: string,
): DroneSnapshot {
  const found = droneById(snapshot, id);
  if (found === undefined) {
    fail(`${what} (id ${id}) on the field`, "no drone carrying that id");
  }
  return found;
}
