// Meltdown — the one door onto the emitter table. GROUP-LOCAL.
//
// Every figure this group asserts is specs/towers.md's: the Arc's base damage
// and redline, the Stutter's mass, the Rime's `heatPerShot`. `constants.ts`
// holds that table as a union of the six emitters and the two movers, so
// reaching a mass or a base damage means narrowing it first. That narrowing is
// written once here so that no check does it with a cast, and so that asking a
// MOVER for a mass fails as a named requirement rather than as an `undefined`
// that turns a later comparison into `NaN`.
//
// `thermal.ts` beside this file has a `massOf` of its own, and it answers `1` for
// a mover on purpose: it resolves a whole floor, movers included, and a mover's
// heat never changes so the divisor it uses for one is immaterial. That is the
// wrong answer for a CHECK, which asserts a ratio of two masses and would read
// the Forge's `1` as a figure specs/towers.md gave it. Hence the strict one here.
//
// It reads no snapshot and holds no tolerance: it is the specification's own
// table, typed.

import { fail } from "../assert";
import { TOWER_DEFS, emitterStats, type EmitterDef } from "../constants";
import type { TowerType } from "../harness";

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
