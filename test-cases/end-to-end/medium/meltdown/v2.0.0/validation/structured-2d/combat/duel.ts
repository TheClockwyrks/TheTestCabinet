// Meltdown — one gun, one mark, and nothing else on the floor. GROUP-LOCAL.
//
// Every item in this group asks what an emitter does to a surge unit, and almost
// every one of them wants the same arrangement: a run with a single emitter posed
// at a heat that CANNOT DRIFT, and a mark that cannot walk out of range and cannot
// die of a shot nobody asked about. specs/combat.md scales every shot by the
// emitter's heat at the moment the shot resolves, so a damage, slow or rate
// reading taken while a thermal model moved that heat underneath it would be a
// reading of the heat model rather than of combat — which is what
// `posePinnedTower`'s `setTowerThermal(id, false)` is for
// (specs/instrumentation.md). Pinning also puts the trip out of reach, so a
// scenario may pose heat `100` on a Rime and read its shots without the tower
// going offline mid-drive.
//
// THIS FILE FIXES ARRANGEMENT AND GEOMETRY ALONE. Not one figure a point
// asserts and not one tolerance is decided here. Where a mark stands is
// geometry — it says WHERE a scenario is posed, never how far a build may miss
// by — and the four functions that compute a specification figure
// (`shotDamage`, `fireRateOf`, `slowCeilOf`, `rangeUnitsOf`) are the
// specification's own arithmetic, restated from `constants.ts`, with no slack
// in them at all. `ticksForShots` says where in the fire cycle a drive stops,
// which is geometry of the same kind.
//
// IT LIVES IN THE GROUP RATHER THAN IN `harness.ts` because only this group poses a
// duel. `harness.ts` carries what every group needs — the run, the pinned tower,
// the stationary target — and this file is the one arrangement built out of them
// that the combat items share.
//
// WHY THE GUN SITS AT (12, 24). Far enough from the west edge and the north edge
// that a mark can be posed eleven tiles the other side of it and still land on the
// floor, which `range-from-the-footprint-centre` needs; clear of the left vent's
// corridor (rows 16..19) and the top vent's (columns 22..29) at every footprint
// size up to the Lance's 4x4, so no gun posed here lengthens a route and no mark's
// `remaining` is a number the arrangement moved (specs/floor.md, specs/mazing.md).
//
// WHY EVERY MULTI-SCENARIO POINT RE-POSES THROUGH `poseGun`. A fire accumulator is
// per emitter and carries between frames (specs/combat.md), so a second scenario
// driven onto the residue of a first would resolve a shot early and read a figure
// the check never asked for. `poseGun` opens with `startRun`, which empties the
// tower roster, so each scenario's emitter is a new one with a fire clock at zero.

import {
  RIME_SLOW_CEIL,
  TILE,
  TOWER_DEFS,
  emitterStats,
  footprintCentre,
  heatMultiplier,
  type EmitterDef,
} from "../constants";
import { fail } from "../assert";
import {
  TICK_HZ,
  posePinnedTower,
  poseTargetAt,
  startRun,
  towerById,
  unitById,
  type Harness,
  type MeltdownSnapshot,
  type Point,
  type SurgeType,
  type Tile,
  type TowerSnapshot,
  type TowerType,
  type UnitSnapshot,
} from "../harness";

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

/** That emitter's shots per second at `level` (specs/towers.md). */
export function fireRateOf(type: TowerType, level = 1): number {
  return emitterStats(emitterDefOf(type), level).fireRate;
}

/**
 * The Rime's cold-slow ceiling at `level` (specs/towers.md): `0.55`, `0.68`,
 * `0.80`.
 *
 * `emitterStats` moves the four figures an upgrade moves and no others, so the
 * ceiling is read straight off `RIME_SLOW_CEIL`, which is where the table lives.
 */
export function slowCeilOf(level: number): number {
  return RIME_SLOW_CEIL[level - 1];
}

/** That emitter's range at `level`, as a radius in LOGICAL UNITS. */
export function rangeUnitsOf(type: TowerType, level = 1): number {
  return emitterStats(emitterDefOf(type), level).range * TILE;
}

/** The distance between two logical stage points, in logical units. */
export function unitDistance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Frames of the default clock that carry an emitter through exactly `shots` shots
 * at `fireRate`, and no further.
 *
 * The fire clock resolves a shot each time its accumulator REACHES the interval
 * `1 / fireRate` and takes the interval off (specs/combat.md), so the number of
 * shots a stretch of game time contains is `floor(elapsed * fireRate)` — a quantity
 * that is ambiguous by one at an exact multiple of the interval, where a build's
 * own accumulation of a hundred floating-point deltas may land a whisker either
 * side. This lands the drive half an interval past the last shot it wants, which is
 * the furthest point from both boundaries, so `shots` is what any conforming
 * accumulator produces.
 *
 * This is geometry, not a tolerance: it says where in the fire cycle the drive
 * stops, not how far a build may miss by. A check measuring the FIRE RATE itself
 * states its own tolerance on its own reading.
 */
export function ticksForShots(shots: number, fireRate: number): number {
  return Math.round(((shots + 0.5) / fireRate) * TICK_HZ);
}

/* -------------------------------------------------------------------------- */
/* Where a scenario stands                                                    */
/* -------------------------------------------------------------------------- */

/** The gun's footprint anchor: quiet at every size up to a 4x4 (see the head). */
export const GUN: Tile = { col: 12, row: 24 };

/** The point a gun of `type` posed at {@link GUN} measures its range from. */
export function gunCentre(type: TowerType): Point {
  return footprintCentre(GUN.col, GUN.row, TOWER_DEFS[type].size);
}

/** The centre of the anchor TILE of a gun posed at {@link GUN}. */
export function gunAnchorCentre(): Point {
  return footprintCentre(GUN.col, GUN.row, 1);
}

/** A point `units` logical units due east of a `type` gun's footprint centre. */
export function eastOfGun(type: TowerType, units: number): Point {
  const centre = gunCentre(type);
  return { x: centre.x + units, y: centre.y };
}

/**
 * How far from the footprint centre a mark stands when the point is not about
 * range at all: three tiles.
 *
 * Geometry, not a tolerance. Three tiles clears the largest footprint on the
 * roster — a 4x4's own half-width is two tiles — so a mark posed here never stands
 * on the gun, and it is well inside the shortest range the roster has (the
 * Stutter's `5.0` tiles), so no point that is about something else reads a range
 * boundary by accident.
 */
export const NEAR_UNITS = 3 * TILE;

/** Hp far past anything a scenario here removes, so nothing dies unasked. */
export const MARK_HP = 10_000;

/* -------------------------------------------------------------------------- */
/* Posing one                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Open an empty run with one emitter of `type` at {@link GUN}, pinned at `heat`
 * and at `level`, and hand back its id.
 *
 * `startRun` empties both rosters and shuts the world gate, so the floor holds this
 * emitter and whatever the caller poses next, and nothing else.
 */
export function poseGun(
  h: Harness,
  type: TowerType,
  heat: number,
  level = 1,
): number {
  startRun(h);
  const id = posePinnedTower(h, type, GUN.col, GUN.row, heat);
  if (level !== 1) h.debug.setTowerLevel(id, level);
  return id;
}

/**
 * A stationary, effectively unkillable mark whose CENTRE sits at an exact logical
 * stage point, and its id.
 *
 * `poseTargetAt` puts a unit at the point, takes its motion off, and gives it the
 * hp asked for; its route is still computed from the tile the point falls in
 * (specs/instrumentation.md), so `remaining` follows the floor.
 */
export function poseMarkAt(
  h: Harness,
  type: SurgeType,
  x: number,
  y: number,
  hp = MARK_HP,
): number {
  return poseTargetAt(h, type, x, y, hp);
}

/** {@link poseMarkAt}, `units` logical units due east of the gun's centre. */
export function poseMarkEast(
  h: Harness,
  gun: TowerType,
  type: SurgeType,
  units: number,
  hp = MARK_HP,
): number {
  const at = eastOfGun(gun, units);
  return poseMarkAt(h, type, at.x, at.y, hp);
}

/* -------------------------------------------------------------------------- */
/* Reading one                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The tower with that id on `snapshot`, or a failure naming the id.
 *
 * `towerById` answers `undefined` for a tower that is not there, which is the
 * honest reading of a roster that does not hold it; every check in this group wants
 * the tower it posed, so what a missing one means is stated once, here.
 */
export function towerOf(snapshot: MeltdownSnapshot, id: number): TowerSnapshot {
  const tower = towerById(snapshot, id);
  if (tower === undefined) {
    return fail(`the tower ${id} still on the floor`, "no such tower");
  }
  return tower;
}

/** The unit with that id on `snapshot`, or a failure naming the id. */
export function unitOf(snapshot: MeltdownSnapshot, id: number): UnitSnapshot {
  const unit = unitById(snapshot, id);
  if (unit === undefined) {
    return fail(`the unit ${id} still on the floor`, "no such unit");
  }
  return unit;
}

/** The gun as the snapshot reports it right now. */
export function readGun(h: Harness, id: number): TowerSnapshot {
  return towerOf(h.snapshot(), id);
}

/** A mark's hp right now. */
export function readHp(h: Harness, id: number): number {
  return unitOf(h.snapshot(), id).hp;
}
