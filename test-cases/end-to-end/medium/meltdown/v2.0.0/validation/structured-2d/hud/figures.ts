// hud/figures — the figures this group holds the panel to, restated from the
// specification rather than read out of the build's own arithmetic.
//
// WHY THEY ARE RESTATED. `src/constants.ts` is the build's file: the case seeds
// it, and a build is free to edit it. Reading a NAMED FIGURE back out of it is
// how a check reads back the number the build was handed — `TOWER_DEFS`, the
// four `UPGRADE_*` multipliers, `MIN_HEAT_MULT` — and that is what the imports
// below do. Reading a FORMULA out of it is a different thing entirely: a panel
// check that asked the build's own `heatMultiplier` what to expect would compare
// the build against itself, and a build that flattened the damage curve would
// draw the flattened figure and be told it was right.
//
// So every rule this group compares a drawn number against is written out here,
// in the form the specification states it, over figures the specification names.
// It is the same separation `heat/thermal.ts` keeps for the thermal model.
//
// THIS FILE FIXES NO TOLERANCE. How near a drawn figure has to be to one of
// these is the check's own business, stated where it is asserted.

import {
  MAX_HEAT_MULT,
  MIN_HEAT_MULT,
  RIME_SLOW_CEIL,
  UPGRADE_DAMAGE,
  UPGRADE_FIRE_RATE,
  UPGRADE_RANGE,
  type EmitterDef,
} from "../../src/constants";

/**
 * The heat multiplier at heat `H` against redline `R` (specs/heat.md, Heat is
 * damage): quadratic to the redline, then flat across the plateau to `100`.
 *
 * ```
 * heatMultiplier(H, R) = MIN_HEAT_MULT
 *                      + (MAX_HEAT_MULT - MIN_HEAT_MULT) * (min(H, R) / R)^2
 * ```
 */
export function heatMultiplierOf(heat: number, redline: number): number {
  const ramp = Math.min(heat, redline) / redline;
  return MIN_HEAT_MULT + (MAX_HEAT_MULT - MIN_HEAT_MULT) * ramp * ramp;
}

/** The three figures an emitter draws that a level moves (specs/towers.md). */
export interface LevelStats {
  range: number;
  fireRate: number;
  baseDamage: number;
}

/**
 * An emitter's drawn figures at `level`, as specs/towers.md's Levels table
 * applies them: `UPGRADE_RANGE` added once per level above the first,
 * `UPGRADE_FIRE_RATE` and `UPGRADE_DAMAGE` multiplied once each.
 *
 * The size, the cost, the redline, the mass and the radiator layout are "the
 * same at every level", so they are read straight off the tabulated definition
 * and are not here.
 */
export function statsAt(def: EmitterDef, level: number): LevelStats {
  const steps = level - 1;
  return {
    range: def.range + UPGRADE_RANGE * steps,
    fireRate: def.fireRate * UPGRADE_FIRE_RATE ** steps,
    baseDamage: def.baseDamage * UPGRADE_DAMAGE ** steps,
  };
}

/**
 * A Rime's slow at heat `H` and `level` (specs/combat.md, The Rime's slow):
 * `slowFactor(H) = slowCeil * (1 - H / 100)`, where `slowCeil` is
 * `RIME_SLOW_CEIL` at that level.
 */
export function rimeSlowOf(heat: number, level: number): number {
  return RIME_SLOW_CEIL[level - 1] * (1 - heat / 100);
}
