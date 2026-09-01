// Spectra — the one crowded field the roster points pose. CASE-PROVIDED.
//
// Eight of this group's points ask the same question in different directions:
// what an operation that empties or removes ONE roster does to the other three.
// specs/instrumentation.md gives each of them exactly that scope — `clearDrones()`
// "Removes every drone, leaving the bullets and bursts standing",
// `clearPlayerBullets()` "Removes every one of the player's bullets, leaving the
// enemy bullets, the drones, and the bursts standing", and so on — and none of
// those readings means anything on a field whose surviving rosters were empty to
// begin with. So they all start from one crowded field, built here rather than
// eight times over.
//
// WHAT THIS FILE FIXES AND WHAT IT DOES NOT. Placements only: where a drone
// stands, where a bullet hangs. Every tolerance and every verdict stays in the
// validator that asserts it, because a threshold buried in a helper hides what a
// point is really holding a build to
// (guides/authoring/writing-debug-apis-and-validators.md). Nothing here asserts an
// outcome either.
//
// WHY THE BURSTS ARE EARNED. There is no operation that adds one: "A burst is an
// outcome of a drone being destroyed" (specs/instrumentation.md, The bursts), so
// `./bursts.ts` pops a Shard with a matching shot per burst asked for and hands
// back what the kills left playing. It clears the drones and the player's bullets
// behind itself, which is why the standing drones and the bullets below are placed
// AFTER it: the rosters a validator reads then hold exactly what was put on them.
//
// NO FRAME RUNS AFTER THE LAST PLACEMENT, so a validator that reads the field
// immediately reads it exactly as it was posed.

import {
  lastBullet,
  poseDrone,
  startPosed,
  type Band,
  type Harness,
} from "../harness";
import { poseBursts } from "./bursts";

/**
 * Where the drones that no operation below removes stand, in logical units.
 *
 * Three of them, spread across the upper play field: clear of the top HUD strip
 * (`FIELD_TOP` `64`), clear of the ship's lane (`SHIP_Y` `600`), and far enough
 * apart that no drone is inside any other's contact reach (specs/field.md).
 */
const STANDING: readonly { x: number; y: number }[] = [
  { x: 300, y: 200 },
  { x: 500, y: 240 },
  { x: 1080, y: 200 },
];

/** Where the player's bullets hang, well clear of the ship and of every drone. */
const FRIENDLY_AT: readonly { x: number; y: number }[] = [
  { x: 80, y: 600 },
  { x: 160, y: 560 },
];

/** Where the enemy bullets hang, in a clear corner of their own. */
const ENEMY_AT: readonly { x: number; y: number }[] = [
  { x: 1150, y: 120 },
  { x: 1220, y: 160 },
];

/** The band each posed bullet carries. A bullet's band is fixed for its life. */
const FRIENDLY_BAND: Band = "cyan";
const ENEMY_BAND: Band = "magenta";

/** Every entity the field was posed with, by the roster it stands on. */
export interface CrowdedField {
  /** The drones still standing: nothing the callers do removes one of these. */
  drones: number[];
  /** The player's bullets, in the order they were placed. */
  friendly: number[];
  /** The enemy bullets, in the order they were placed. */
  enemy: number[];
  /** The bursts the kills left playing, in the order they were popped. */
  bursts: number[];
}

/**
 * Pose an empty, quiet, live wave and then fill all four of its rosters.
 *
 * In order: {@link startPosed}'s empty field, one popped Shard per burst asked
 * for, the standing drones, and two bullets of each kind. Every standing drone is
 * a Shard with all three faculties off, so nothing on the field moves, oscillates
 * or fires between a caller's two readings.
 */
export async function poseCrowdedField(
  h: Harness,
  options: { bursts?: number } = {},
): Promise<CrowdedField> {
  startPosed(h);

  const bursts = await poseBursts(h, options.bursts ?? 1);

  const drones = STANDING.map((at) =>
    poseDrone(h, "shard", at.x, at.y, { band: "cyan" }),
  );

  const friendly = FRIENDLY_AT.map((at) => {
    h.debug.addPlayerBullet(at.x, at.y, FRIENDLY_BAND);
    return lastBullet(h.snapshot()).id;
  });

  const enemy = ENEMY_AT.map((at) => {
    h.debug.addEnemyBullet(at.x, at.y, ENEMY_BAND);
    return lastBullet(h.snapshot()).id;
  });

  return { drones, friendly, enemy, bursts };
}

/**
 * A roster in id order, so two readings of it are compared as SETS of entries.
 *
 * specs/instrumentation.md says only that a roster is reported "in roster order",
 * and fixes no order of its own — so a validator holding the survivors of a
 * removal to being untouched compares which entries stand and what each of them
 * holds, and not where in the array a build kept them.
 */
export function sortedById<T extends { id: number }>(
  entries: readonly T[],
): T[] {
  return [...entries].sort((a, b) => a.id - b.id);
}
