// Meltdown — the roster table, typed and its face arithmetic. GROUP-LOCAL.
//
// Every figure this group asserts comes out of one table: `specs/towers.md`'s
// roster, restated in `constants.ts` as a union of the six emitters and the two
// movers. Reaching an emitter's mass, or a mover's output, means narrowing that
// union first, and the narrowing is written once here so that no check does it
// with a cast and so that asking a MOVER for a mass fails as a named requirement
// rather than as an `undefined` that turns a later comparison into `NaN`.
//
// The one derived figure here is the air-cooling coefficient, and it is derived
// from the SPECIFICATION rather than from anything a build reports.
// `specs/heat.md` counts a face as "one edge-tile long per tile of the
// footprint's side" and puts a tower's air loss at
// `(RAD_K * radiatorEdges + BASE_K * plainEdges) * (H / 100)`, so a tower alone
// on open floor — every face on air — has a coefficient fixed entirely by its
// size and by how many of its four faces `specs/towers.md` calls radiators. That
// coefficient is what lets a one-frame cooling reading name a MASS.
//
// NOTHING HERE READS A SNAPSHOT AND NOTHING HERE HOLDS A TOLERANCE. It is the
// specification's own table, typed, plus the arithmetic the specification states
// over it; what a reading must come to is stated in the check that takes it.

import { fail } from "../assert";
import {
  BASE_K,
  RAD_K,
  SIDES,
  TOWER_DEFS,
  emitterStats,
  isEmitter,
  type EmitterDef,
  type EmitterStats,
  type MoverDef,
  type SurgeType,
  type TowerType,
} from "../constants";

/** The emitter `specs/towers.md` tabulates under `type`. */
export function emitterDefOf(type: TowerType): EmitterDef {
  const def = TOWER_DEFS[type];
  if (!isEmitter(def)) {
    fail("one of the six emitters (specs/towers.md)", type);
  }
  return def;
}

/** The Forge or the Sink `specs/towers.md` tabulates under `type`. */
export function moverDefOf(type: TowerType): MoverDef {
  const def = TOWER_DEFS[type];
  if (isEmitter(def)) {
    fail("the Forge or the Sink (specs/towers.md)", type);
  }
  return def;
}

/** That emitter's figures at `level`, every per-level multiplier applied. */
export function figuresOf(type: TowerType, level = 1): EmitterStats {
  return emitterStats(emitterDefOf(type), level);
}

/** A tower type's footprint side, in tiles, as `specs/towers.md` tabulates it. */
export function sizeOf(type: TowerType): number {
  return TOWER_DEFS[type].size;
}

/**
 * The air-cooling coefficient of an emitter standing alone, in heat per second
 * at heat `100`.
 *
 * `specs/heat.md`: a face is one edge-tile long per tile of the footprint's
 * side, an edge-tile facing open floor, an opening or the casing sheds to air,
 * and `airLoss = (RAD_K * radiatorEdges + BASE_K * plainEdges) * (H / 100)`. A
 * tower with nothing against any of its four faces therefore has
 * `radiatorEdges = radiators * size` and `plainEdges = (4 - radiators) * size`.
 *
 * Geometry and the specification's own constants, not a tolerance: it says what
 * the frame's loss IS, never how far a build may miss it by.
 */
export function airCoefficient(type: TowerType): number {
  const def = emitterDefOf(type);
  const radiatorEdges = def.radiators.length * def.size;
  const plainEdges = (SIDES.length - def.radiators.length) * def.size;
  return RAD_K * radiatorEdges + BASE_K * plainEdges;
}

/**
 * The surge type an emitter's own targeting rule lets it fire on.
 *
 * `specs/combat.md`: "Every emitter targets ground units and flyers alike,
 * except the Flak, which targets flying units alone and ignores every ground
 * unit whatever its range." So a reading taken THROUGH a Flak's gun has to be
 * taken against a flyer, and `specs/surge.md` gives the Drift as one. Whether
 * the Flak really refuses a ground unit is `combat/flak-ignores-ground`'s
 * requirement, not this group's; here the flyer is simply what makes a Flak's
 * range, rate and heat readable at all.
 */
export function targetTypeFor(type: TowerType): SurgeType {
  return emitterDefOf(type).airOnly === true ? "drift" : "mote";
}
