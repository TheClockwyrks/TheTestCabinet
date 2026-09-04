// Arc Foundry — the live behavior every figure in `src/constants.ts` adds up to.
//
// `src/constants.ts` states the figures the specification fixes, each exactly once, in
// the shape the specification states them: a base type's Scrap stats and the multipliers
// the ladder climbs them by, a tower's reference block and the fractions its levels
// scale it by, the roster's base health and the four constants a difficulty scales it
// with. What FIRES is one flat block of numbers per structure, and this module is the
// single place those figures are folded into one.
//
// Nothing here is a figure of its own. Every value below is either read straight off
// `src/constants.ts` or computed from it by the arithmetic the specification states, so
// a number the specification changes changes here and nowhere else. The lookups are
// keyed conversions of the same tables: the specification lists the maps, the roster,
// the towers, and the difficulties as ordered arrays, because the order is what the
// menus and the previews present, and the simulation wants them by identifier.

import {
  ARCNODE_SPLASH,
  AURA_CAP,
  BASE_STATS,
  BOARD_Y,
  CHOKE_SLOW,
  CHOKE_SLOW_DUR,
  COIL_FALLOFF,
  COIL_LEAP_RANGE,
  COIL_LEAPS,
  COMBOS,
  COMBO_DAMAGE_MULT,
  COMBO_MAX_LEVEL,
  COMBO_RANGE_BONUS,
  COMBO_UPGRADE_COST_FRAC,
  COMPONENT_TYPES,
  DIFFICULTIES,
  FOOTPRINT,
  GRID_COLS,
  GRID_ROWS,
  LOAD_ROSTER,
  MAPS,
  MAX_QUALITY,
  QUALITY_MULT,
  RANGE_PER_TIER,
  RECTIFIER_BURN_DUR,
  RECTIFIER_BURN_FRAC,
  REFINEMENT_COSTS,
  REGULATOR_AURA,
  TILE,
  WAVE_BONUS_BASE,
  WAVE_BONUS_STEP,
  type Combo,
  type ComboId,
  type ComponentType,
  type Difficulty,
  type DifficultyId,
  type FoundryMap,
  type LoadType,
  type LoadUnitType,
  type MapId,
  type RecipeIngredient,
} from "./constants";
import { LOAD_RADIUS, qualityIndex } from "./theme";
import type { Pt } from "./types";

// ---- Grid geometry -------------------------------------------------------

/** The grid is anchored at the yard region's top-left corner. */
export const GRID_X0 = 0;
export const GRID_Y0 = BOARD_Y;

/** The highest anchor a `FOOTPRINT` by `FOOTPRINT` block still fits at. */
export const MAX_ANCHOR_COL = GRID_COLS - FOOTPRINT;
export const MAX_ANCHOR_ROW = GRID_ROWS - FOOTPRINT;

/** The footprint's side, in logical units. */
export const FOOTPRINT_PX = FOOTPRINT * TILE;

/** A tile's center, in logical units. */
export function tileCenter(col: number, row: number): Pt {
  return {
    x: GRID_X0 + TILE * col + TILE / 2,
    y: GRID_Y0 + TILE * row + TILE / 2,
  };
}

/** A footprint's center, which is what range, targeting, and drawing use. */
export function footprintCenter(col: number, row: number): Pt {
  return { x: GRID_X0 + TILE * (col + 1), y: GRID_Y0 + TILE * (row + 1) };
}

// ---- Keyed lookups over the specification's ordered tables ---------------

export const MAP_BY_ID: Readonly<Record<MapId, FoundryMap>> =
  Object.fromEntries(MAPS.map((m) => [m.id, m])) as Record<MapId, FoundryMap>;

export const LOAD_BY_TYPE: Readonly<Record<LoadType, LoadUnitType>> =
  Object.fromEntries(LOAD_ROSTER.map((u) => [u.type, u])) as Record<
    LoadType,
    LoadUnitType
  >;

export const COMBO_BY_ID: Readonly<Record<ComboId, Combo>> = Object.fromEntries(
  COMBOS.map((c) => [c.id, c]),
) as Record<ComboId, Combo>;

export const DIFFICULTY_BY_ID: Readonly<Record<DifficultyId, Difficulty>> =
  Object.fromEntries(DIFFICULTIES.map((d) => [d.id, d])) as Record<
    DifficultyId,
    Difficulty
  >;

/** The drawn radius of a Load type, or of the finale's Overload Dynamo. */
export function loadRadius(type: string): number {
  return LOAD_RADIUS[type] ?? 10;
}

// ---- One firing block ----------------------------------------------------

/**
 * The complete live behavior of any firing structure, base component or combination
 * tower alike, as one flat block. Everything the simulation needs to fire a shot and
 * resolve its impact is here, so firing reads one shape rather than branching on what
 * kind of structure it came from.
 */
export interface Stats {
  fires: boolean;
  range: number;
  /** Shots per second. */
  fireRate: number;
  /** Per shot, before any external aura. */
  dmg: number;
  /** The radius full damage reaches around the impact point. `0` is single-target. */
  splash: number;
  /** Further hits after the first. `0` is no chain. */
  chainLeaps: number;
  chainRange: number;
  chainFalloff: number;
  /** The fraction of speed a hit removes. `0` is no slow. */
  slowAmt: number;
  slowDur: number;
  /** The burn's per-second damage as a fraction of the shot's. `0` is no burn. */
  burnFrac: number;
  burnDur: number;
  critChance: number;
  critMult: number;
  /** Distinct simultaneous targets each cadence. `1` is single. */
  multishot: number;
  /** The aura this structure itself projects. `0` is none. */
  auraRadius: number;
  auraBonus: number;
}

const NO_ABILITIES = {
  splash: 0,
  chainLeaps: 0,
  chainRange: COIL_LEAP_RANGE,
  chainFalloff: COIL_FALLOFF,
  slowAmt: 0,
  slowDur: 0,
  burnFrac: 0,
  burnDur: 0,
  critChance: 0,
  critMult: 1,
  multishot: 1,
  auraRadius: 0,
  auraBonus: 0,
} as const;

/**
 * A base component's live behavior, which follows entirely from its type and its
 * quality.
 *
 * Damage is `BASE_STATS[type].damage * QUALITY_MULT[quality - 1]`, rounded, and range is
 * `BASE_STATS[type].range + RANGE_PER_TIER * (quality - 1)`; fire rate is flat across the
 * ladder. The signature numbers each come off their own per-rung table. The Regulator
 * neither fires nor reaches, so it carries its aura and nothing else.
 */
export function baseStats(type: ComponentType, quality: number): Stats {
  const q = qualityIndex(quality);
  const base = BASE_STATS[type];
  const fires = base.range !== null && base.fireRate !== null;
  return {
    ...NO_ABILITIES,
    fires,
    range: fires ? base.range! + RANGE_PER_TIER * q : 0,
    fireRate: base.fireRate ?? 0,
    dmg: Math.round(base.damage * QUALITY_MULT[q]!),
    splash: type === "arcnode" ? ARCNODE_SPLASH[q]! : 0,
    chainLeaps: type === "coil" ? COIL_LEAPS[q]! : 0,
    slowAmt: type === "choke" ? CHOKE_SLOW[q]! : 0,
    slowDur: type === "choke" ? CHOKE_SLOW_DUR : 0,
    burnFrac: type === "rectifier" ? RECTIFIER_BURN_FRAC : 0,
    burnDur: type === "rectifier" ? RECTIFIER_BURN_DUR : 0,
    auraRadius: type === "regulator" ? REGULATOR_AURA[q]!.radius : 0,
    auraBonus: type === "regulator" ? REGULATOR_AURA[q]!.bonus : 0,
  };
}

/**
 * A combination tower's live behavior at an upgrade level.
 *
 * The reference block is what a level-`3` tower scales toward: damage takes
 * `COMBO_DAMAGE_MULT[level]` and range gains `COMBO_RANGE_BONUS[level]`. Fire rate and
 * every ability parameter are flat across level, so a level carries through the
 * abilities by way of damage alone, which is what all of them are stated against.
 */
export function comboStats(combo: ComboId, level = 0): Stats {
  const def = COMBO_BY_ID[combo];
  const lvl = Math.max(0, Math.min(COMBO_MAX_LEVEL, Math.round(level)));
  const ab = def.abilities;
  return {
    fires: true,
    range: def.range + COMBO_RANGE_BONUS[lvl]!,
    fireRate: def.fireRate,
    dmg: def.damage * COMBO_DAMAGE_MULT[lvl]!,
    splash: ab.splash?.radius ?? 0,
    chainLeaps: ab.chain?.leaps ?? 0,
    chainRange: ab.chain?.leapRange ?? COIL_LEAP_RANGE,
    chainFalloff: ab.chain?.falloff ?? COIL_FALLOFF,
    slowAmt: ab.slow?.amount ?? 0,
    slowDur: ab.slow?.duration ?? 0,
    burnFrac: ab.burn?.fraction ?? 0,
    burnDur: ab.burn?.duration ?? 0,
    critChance: ab.crit?.chance ?? 0,
    critMult: ab.crit?.multiplier ?? 1,
    multishot: ab.multishot?.targets ?? 1,
    auraRadius: ab.aura?.radius ?? 0,
    auraBonus: ab.aura?.bonus ?? 0,
  };
}

/**
 * The Charge that raises a tower from `level` to the next, or `null` at the top rung.
 *
 * The cost is a fraction of the tower's reference damage, so a stronger tower is a
 * deeper sink, rounded to the nearest whole number with an exact half rounding up.
 */
export function comboUpgradeCost(combo: ComboId, level: number): number | null {
  if (level >= COMBO_MAX_LEVEL) return null;
  return Math.round(
    COMBO_BY_ID[combo].damage * COMBO_UPGRADE_COST_FRAC[level]!,
  );
}

/** The Charge that buys refinement level `level + 1`, or `null` at the top rung. */
export function refinementCost(level: number): number | null {
  return REFINEMENT_COSTS[level] ?? null;
}

/** The most an aura, or several summed, may add to one structure's damage. */
export const MAX_AURA = AURA_CAP;

/** The ability tags a firing structure's live block carries. */
export function abilityTags(st: Stats): string[] {
  const tags: string[] = [];
  if (st.splash > 0) tags.push("splash");
  if (st.chainLeaps > 0) tags.push("chain");
  if (st.slowAmt > 0) tags.push("slow");
  if (st.burnFrac > 0) tags.push("burn");
  if (st.critChance > 0) tags.push("crit");
  if (st.multishot > 1) tags.push("multishot");
  if (st.auraRadius > 0) tags.push("aura");
  return tags;
}

// ---- Recipes -------------------------------------------------------------

/** A recipe as the multiset key an assembled set of ingredients is matched against. */
export function recipeKey(ingredients: readonly RecipeIngredient[]): string {
  return ingredients
    .map((i) => `${i.type}@${i.tier}`)
    .sort()
    .join(",");
}

/** Every recipe's key, so a set of ingredients resolves to its tower in one lookup. */
export const RECIPE_INDEX: ReadonlyMap<string, ComboId> = new Map(
  COMBOS.map((c) => [recipeKey(c.recipe), c.id] as const),
);

// ---- The Load's health ---------------------------------------------------

/**
 * A unit's health at a wave, on a difficulty.
 *
 * `HP(w) = round(baseHealth * baseMult * [(1 + k * (w - 1)) + c * (r^(w - 1) - 1)])`,
 * the linear ramp that carries the opening and the mid run plus the surcharge that is
 * nothing early and dominates the last third. The product rounds to the nearest whole
 * number with an exact half rounding up, which for these positive values is `Math.round`.
 */
export function scaledHealth(
  baseHealth: number,
  wave: number,
  diff: Difficulty,
): number {
  const linear = 1 + diff.k * (wave - 1);
  const surcharge = diff.c * (Math.pow(diff.r, wave - 1) - 1);
  return Math.round(baseHealth * diff.baseMult * (linear + surcharge));
}

/** The two waves a Dynamo anchors: the halfway wave and the last. */
export function milestoneWaves(diff: Difficulty): number[] {
  return [Math.round(diff.waves / 2), diff.waves];
}

/** Whether a Dynamo anchors this wave. */
export function isMilestoneWave(wave: number, diff: Difficulty): boolean {
  return milestoneWaves(diff).includes(wave);
}

/** The Charge a cleared wave pays. */
export function waveClearBonus(wave: number): number {
  return WAVE_BONUS_BASE + WAVE_BONUS_STEP * wave;
}

// ---- Convenience ---------------------------------------------------------

/** The eight base types in the order the recipe book and the odds table list them. */
export const TYPE_ORDER: readonly ComponentType[] = COMPONENT_TYPES;

/** The top rung of the quality ladder. */
export const MAX_TIER = MAX_QUALITY;
