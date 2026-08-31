// Meltdown — the emitter table, and the two readings this group takes. GROUP-LOCAL.
//
// THE TABLE. Every figure this group asserts is specs/towers.md's: the Arc's base
// damage and redline, the Stutter's mass, the Rime's `heatPerShot`.
// `src/constants.ts` holds that table as a union of the six emitters and the two
// movers, so reaching a mass or a base damage means narrowing it first. That
// narrowing is written once here so that no check does it with a cast, and so
// that asking a MOVER for a mass fails as a named requirement rather than as an
// `undefined` that turns a later comparison into `NaN`.
//
// `thermal.ts` beside this file has a `massOf` of its own, and it answers `1` for
// a mover on purpose: it resolves a whole floor, movers included, and a mover's
// heat never changes so the divisor it uses for one is immaterial. That is the
// wrong answer for a CHECK, which asserts a ratio of two masses and would read
// the Forge's `1` as a figure specs/towers.md gave it. Hence the strict one here.
//
// THE READINGS. `towerById` and `unitById` answer `undefined` for something that
// is not on the floor, which is the honest reading of a roster that does not hold
// it. Every check in this group wants the tower it posed a moment ago, so what a
// missing one MEANS is stated once, here, rather than as an optional chain in
// twenty files.
//
// Nothing here holds a tolerance: it is the specification's own table, typed, and
// two lookups.

import { TOWER_DEFS, emitterStats, type EmitterDef } from "../../src/constants";
import { fail } from "../assert";
import {
  towerById,
  unitById,
  type MeltdownSnapshot,
  type TowerSnapshot,
  type TowerType,
  type UnitSnapshot,
} from "../harness";

/** The emitter specs/towers.md tabulates under `type`. */
export function emitterDefOf(type: TowerType): EmitterDef {
  const def = TOWER_DEFS[type];
  if (def.kind !== "emitter") {
    fail("one of the six emitters (specs/towers.md)", type);
  }
  return def;
}

/** That emitter's figures at `level`, every per-level multiplier applied. */
export function figuresOf(
  type: TowerType,
  level = 1,
): ReturnType<typeof emitterStats> {
  return emitterStats(emitterDefOf(type), level);
}

/** The thermal mass that divides every change to a `type`'s heat. */
export function massOf(type: TowerType): number {
  return emitterDefOf(type).mass;
}

/** The redline specs/towers.md gives `type`. An upgrade never moves it. */
export function redlineOf(type: TowerType): number {
  return emitterDefOf(type).redline;
}

/** The tower with that id on `snapshot`, or a failure naming the id. */
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
