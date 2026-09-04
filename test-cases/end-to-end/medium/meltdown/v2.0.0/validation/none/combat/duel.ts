// Meltdown — one gun, one mark, and nothing else on the floor. GROUP-LOCAL.
//
// Every item in this group asks what an emitter does to a surge unit, and every
// one of them wants the same arrangement: a run with a single emitter posed at a
// heat that CANNOT DRIFT, and a target that cannot walk out of range and cannot
// die of a shot nobody asked about. `specs/combat.md` scales every shot by the
// emitter's heat at the moment the shot resolves, so a damage, slow or rate
// reading taken while a thermal model moved that heat underneath it would be a
// reading of the heat model rather than of combat — which is what
// `posePinnedTower`'s `setTowerThermal(id, false)` is for
// (`specs/instrumentation.md`). Pinning also puts the trip out of reach, so a
// scenario may pose heat `100` on a Rime and read its shots without the tower
// going offline mid-drive.
//
// THIS FILE FIXES ARRANGEMENT AND GEOMETRY ALONE. Not one figure a point asserts
// and not one tolerance is decided here. Where a mark stands is geometry — it
// says WHERE a scenario is posed, never how far a build may miss by — and the
// three functions that compute a specification figure (`shotDamage`,
// `fireRateOf`, `slowCeilOf`) are the specification's own arithmetic, restated
// from `constants.ts`, with no slack in them at all.
//
// WHY THE GUN SITS AT (12, 24). Far enough from the west edge and the north edge
// that a mark can be posed eleven tiles the other side of it and still land on
// the floor, which `range-from-the-footprint-centre` needs; clear of the left
// vent's corridor (rows 16..19) and the top vent's (columns 22..29) at every
// footprint size up to the Lance's 4x4, so no gun posed here lengthens a route
// and no mark's `remaining` is a number the arrangement moved
// (`specs/floor.md`, `specs/mazing.md`).
//
// WHY EVERY MULTI-SCENARIO POINT RE-POSES THROUGH `poseGun`. A fire accumulator
// is per emitter and carries between frames (`specs/combat.md`), so a second
// scenario driven onto the residue of a first would resolve a shot early and
// read a figure the check never asked for. `poseGun` opens with `startRun`,
// whose `reset` empties the tower roster, so each scenario's emitter is a new
// one with a fire clock at zero.

import { fail } from "../assert";
import {
  TILE,
  TOWER_DEFS,
  colAt,
  emitterStats,
  footprintCentre,
  heatMultiplier,
  isEmitter,
  rowAt,
  type EmitterDef,
  type SurgeType,
  type Tile,
  type TowerType,
} from "../constants";
import {
  poseTarget,
  posePinnedTower,
  requireTower,
  requireUnit,
  startRun,
  type Harness,
  type TowerView,
} from "../harness";

/* -------------------------------------------------------------------------- */
/* The specification's own arithmetic                                         */
/* -------------------------------------------------------------------------- */

/** The emitter `specs/towers.md` tabulates under `type`, narrowed. */
export function emitterDefOf(type: TowerType): EmitterDef {
  const def = TOWER_DEFS[type];
  if (!isEmitter(def)) {
    fail("one of the six emitters (specs/towers.md)", type);
  }
  return def;
}

/**
 * The hp one shot from a level-`level` `type` at `heat` must remove:
 * `baseDamage(level) * heatMultiplier(H, redline)`, which `specs/combat.md`
 * states for every emitter with no exception.
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

/** That emitter's shots per second at `level` (`specs/towers.md`). */
export function fireRateOf(type: TowerType, level = 1): number {
  return emitterStats(emitterDefOf(type), level).fireRate;
}

/** The Rime's cold-slow ceiling at `level` (`specs/towers.md`). */
export function slowCeilOf(level: number): number {
  return emitterStats(emitterDefOf("rime"), level).slowCeil;
}

/** That emitter's range at `level`, as a radius in LOGICAL UNITS. */
export function rangeUnitsOf(type: TowerType, level = 1): number {
  return emitterStats(emitterDefOf(type), level).range * TILE;
}

/* -------------------------------------------------------------------------- */
/* Where a scenario stands                                                    */
/* -------------------------------------------------------------------------- */

/** The gun's footprint anchor: quiet at every size up to a 4x4 (see the head). */
export const GUN: Tile = { col: 12, row: 24 };

/** The point a gun of `type` posed at {@link GUN} measures its range from. */
export function gunCentre(type: TowerType): { x: number; y: number } {
  return footprintCentre(GUN.col, GUN.row, TOWER_DEFS[type].size);
}

/** The centre of the anchor TILE of a gun posed at {@link GUN}. */
export function gunAnchorCentre(): { x: number; y: number } {
  return footprintCentre(GUN.col, GUN.row, 1);
}

/** A point `units` logical units due east of a `type` gun's footprint centre. */
export function eastOfGun(
  type: TowerType,
  units: number,
): { x: number; y: number } {
  const centre = gunCentre(type);
  return { x: centre.x + units, y: centre.y };
}

/**
 * How far from the footprint centre a mark stands when the point is not about
 * range at all: three tiles.
 *
 * Geometry, not a tolerance. Three tiles clears the largest footprint on the
 * roster — a 4x4's own half-width is two tiles — so a mark posed here never
 * stands on the gun, and it is well inside the shortest range the roster has
 * (the Stutter's `5.0` tiles), so no point that is about something else reads a
 * range boundary by accident.
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
 * `startRun` empties both rosters and shuts the world gate, so the floor holds
 * this emitter and whatever the caller poses next, and nothing else.
 */
export async function poseGun(
  h: Harness,
  type: TowerType,
  heat: number,
  level = 1,
): Promise<number> {
  await startRun(h);
  const id = await posePinnedTower(h, type, GUN.col, GUN.row, heat);
  if (level !== 1) await h.debug.setTowerLevel(id, level);
  return id;
}

/**
 * A stationary, effectively unkillable mark whose CENTRE sits at an exact
 * logical stage point, and its id.
 *
 * `poseTarget` puts a unit on a tile centre and takes its motion off; a range,
 * splash or slow scenario needs a distance rather than a tile, so the position
 * is set again to the exact point. `setUnitPosition` recomputes the unit's route
 * from the tile the point falls in (`specs/instrumentation.md`), so `remaining`
 * still follows the floor.
 */
export async function poseMarkAt(
  h: Harness,
  type: SurgeType,
  x: number,
  y: number,
  hp = MARK_HP,
): Promise<number> {
  const id = await poseTarget(h, type, colAt(x), rowAt(y), hp);
  await h.debug.setUnitPosition(id, x, y);
  return id;
}

/** {@link poseMarkAt}, `units` logical units due east of the gun's centre. */
export function poseMarkEast(
  h: Harness,
  gun: TowerType,
  type: SurgeType,
  units: number,
  hp = MARK_HP,
): Promise<number> {
  const at = eastOfGun(gun, units);
  return poseMarkAt(h, type, at.x, at.y, hp);
}

/* -------------------------------------------------------------------------- */
/* Reading one                                                                */
/* -------------------------------------------------------------------------- */

/** The gun as the snapshot reports it right now. */
export async function readGun(
  h: Harness,
  id: number,
  doing = "the posed gun",
): Promise<TowerView> {
  return requireTower(await h.snapshot(), id, doing);
}

/** A mark's hp right now. */
export async function readHp(
  h: Harness,
  id: number,
  doing = "the posed mark",
): Promise<number> {
  return requireUnit(await h.snapshot(), id, doing).hp;
}
