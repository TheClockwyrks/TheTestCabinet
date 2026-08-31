// Meltdown — where this group poses a floor, and the specification arithmetic a
// gate is read against. GROUP-LOCAL.
//
// The `instrumentation` items are about the SURFACE rather than about any one
// system: what it carries, what it reads back, what it isolates, and what each
// faculty gate holds. Almost every one of them therefore wants the same, dullest
// possible floor — one emitter and one mark standing where nothing else in the
// game can reach them — so that the only thing moving across a window is the
// faculty the item is about.
//
// THIS FILE FIXES ARRANGEMENT AND GEOMETRY ALONE. Not one figure an item asserts
// and not one tolerance is decided here. Where the gun stands, where the mark
// stands and where a walker starts say WHERE a scenario is posed, never how far a
// build may miss a figure by; the three functions that compute a specification
// figure (`emitterDefOf`, `fireRateOf`, `shotDamage`) are the specification's own
// arithmetic restated from `src/constants.ts`, with no slack in them at all; and
// `ticksForShots` says where in the fire cycle a drive stops, which is geometry of
// the same kind.
//
// IT LIVES IN THE GROUP RATHER THAN IN `harness.ts` because only these items pose
// a floor to read a gate on. `harness.ts` carries what every group needs — the
// run, the posed tower, the idle tower, the pinned tower, the stationary target —
// and this file is the one arrangement built out of them that the
// `instrumentation` items share.
//
// WHY THE QUIET CORNER. specs/floor.md puts the left vent and the right exhaust on
// rows `16` through `19` and the top vent and the bottom exhaust on columns `22`
// through `29`, so those two straight corridors are the routes the game reports as
// `paths.left.length` and `paths.top.length`. Every anchor here is clear of both
// at every footprint size on the roster, so a tower posed by this group never
// lengthens a route and no reading of `paths` is a number the arrangement moved
// (specs/mazing.md).

import { fail } from "../assert";
import {
  TOWER_DEFS,
  emitterStats,
  heatMultiplier,
  type EmitterDef,
} from "../../src/constants";
import { tileCentre, type Point, type Tile } from "../geometry";
import {
  TICK_HZ,
  poseWalker,
  type Harness,
  type SurgeType,
  type TowerType,
  type VentName,
  lastUnit,
} from "../harness";

/* -------------------------------------------------------------------------- */
/* Where a scenario stands                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The gun's footprint anchor.
 *
 * Rows `8`..`11` and columns `8`..`11` at the largest footprint on the roster,
 * the Lance's 4x4 — clear of the left corridor's rows `16`..`19` and the top
 * corridor's columns `22`..`29`, and clear of the casing on every side. A tower
 * posed here therefore stands in OPEN AIR: every perimeter edge-tile of its
 * footprint faces floor rather than another tower, which is the arrangement
 * `specs/heat.md`'s air-cooling term is stated for.
 */
export const GUN: Tile = { col: 8, row: 8 };

/**
 * The mark's tile: off the gun's footprint at every size, and inside every
 * emitter's range from `GUN`.
 *
 * From a 2x2 gun's footprint centre it is `3.54` tiles away and from a 4x4 gun's
 * `2.55`, both comfortably inside the shortest range on the roster — the
 * Stutter's `5.0` tiles (specs/towers.md) — so a scenario posed here is never
 * reading a range boundary by accident. `combat/` is what decides range.
 */
export const MARK: Tile = { col: 12, row: 9 };

/** The centre of {@link MARK}, in logical stage units. */
export function markCentre(): Point {
  return tileCentre(MARK.col, MARK.row);
}

/**
 * Where a walker is posed when an item wants one crossing OPEN FLOOR: five tiles
 * into the left corridor.
 *
 * A unit that entered at the left vent is assigned the right exhaust for its
 * whole life (specs/floor.md), and on an empty floor the cheapest route from here
 * is the straight run east along row `17`. So a window's travel is a walk in one
 * direction with no turn in it, which is what makes two windows of the same
 * length comparable.
 */
export const WALK: Tile = { col: 5, row: 17 };

/**
 * A wall across the left corridor: two 2x2 anchors that between them block
 * columns `20` and `21` on rows `16` through `19`.
 *
 * Every open route from the left vent to the right exhaust runs through those
 * rows, so this wall is what forces a detour and lengthens both the vent route
 * and a walker's own `remaining`. It seals nothing: the floor above and below the
 * corridor is untouched, so a route around it always exists (specs/mazing.md, The
 * floor can never be sealed).
 */
export const WALL: readonly Tile[] = [
  { col: 20, row: 16 },
  { col: 20, row: 18 },
];

/** The type every wall segment is built from: the smallest footprint, 2x2. */
export const WALL_TYPE: TowerType = "arc";

/* -------------------------------------------------------------------------- */
/* Posing one                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One unit of `type` walking under its own power from `vent`, its centre placed
 * on the centre of tile `(col, row)`, and its id.
 *
 * Nothing is posed beyond the entry and the position: its motion is on, and its
 * route is recomputed from the tile the position falls in
 * (specs/instrumentation.md), so the walk is the game's own.
 */
export function poseWalkerOn(
  h: Harness,
  type: SurgeType,
  col: number,
  row: number,
  vent: VentName = "left",
): number {
  const id = poseWalker(h, type, vent);
  const at = tileCentre(col, row);
  h.debug.setUnitPosition(id, at.x, at.y);
  return id;
}

/** The id the surge roster's last entry carries (specs/instrumentation.md). */
export function lastUnitId(h: Harness): number {
  return lastUnit(h.snapshot()).id;
}

/* -------------------------------------------------------------------------- */
/* The specification's own arithmetic                                         */
/* -------------------------------------------------------------------------- */

/** The emitter specs/towers.md tabulates under `type`, narrowed. */
export function emitterDefOf(type: TowerType): EmitterDef {
  const def = TOWER_DEFS[type];
  if (def.kind !== "emitter") {
    fail("one of the six emitters (specs/towers.md)", type);
  }
  return def;
}

/** That emitter's shots per second at `level` (specs/towers.md). */
export function fireRateOf(type: TowerType, level = 1): number {
  return emitterStats(emitterDefOf(type), level).fireRate;
}

/**
 * The hp one shot from a level-`level` `type` at `heat` must remove:
 * `baseDamage(level) * heatMultiplier(H, redline)`, which specs/combat.md states
 * for every emitter with no exception.
 */
export function shotDamage(
  type: TowerType,
  level: number,
  heat: number,
): number {
  const def = emitterDefOf(type);
  return (
    emitterStats(def, level).baseDamage * heatMultiplier(heat, def.redline)
  );
}

/**
 * Frames of the default clock that carry an emitter through exactly `shots`
 * shots at `fireRate`, and no further.
 *
 * The fire clock resolves a shot each time its accumulator REACHES the interval
 * `1 / fireRate` and takes the interval off (specs/combat.md), so the number of
 * shots a stretch of game time contains is `floor(elapsed * fireRate)` — a
 * quantity that is ambiguous by one at an exact multiple of the interval, where a
 * build's own accumulation of a hundred floating-point deltas may land a whisker
 * either side. This lands the drive half an interval past the last shot it wants,
 * which is the furthest point from both boundaries, so `shots` is what any
 * conforming accumulator produces.
 *
 * Geometry, not a tolerance: it says where in the fire cycle the drive stops, not
 * how far a build may miss by.
 */
export function ticksForShots(shots: number, fireRate: number): number {
  return Math.round(((shots + 0.5) / fireRate) * TICK_HZ);
}
