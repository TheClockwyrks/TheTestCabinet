// Arc Foundry — the figures this case's specification fixes. CASE-PROVIDED.
//
// Under an engine the same numbers reach a validator from `src/constants.ts`,
// which is SEEDED into the run: the case hands the build the module and the
// checks import it back. An engineless run seeds no `src/` at all — the build
// writes every module it has, including whichever one it chooses to name these
// figures in — so there is nothing for a check to import, and the values have to
// live on the validator's side of the line.
//
// So this file is that side. Every value below is stated by the seeded
// specification the build was given, under the name that specification uses, and
// nothing here is read from a build: a check that compared a build's own constant
// against itself would grade nothing. The pairing is deliberate —
// `PROJECTILE_SPEED` here is `specs/components.md`'s projectile speed, and a
// build that flies its shots at some other speed fails the point rather than
// moving the target.
//
// Every position is in the fixed 1280x720 logical-unit coordinate space of
// `specs/overview.md` (origin top-left, x right, y down), every rate is per
// second, and every duration is in seconds.

/* -------------------------------------------------------------------------- */
/* The stage and its three regions (specs/overview.md)                        */
/* -------------------------------------------------------------------------- */

export const STAGE_W = 1280;
export const STAGE_H = 720;

/** The status bar: x 0–1280, y 0–56. */
export const BAR_H = 56;

/** The build panel: x 1000–1280, y 56–720. */
export const PANEL_X = 1000;
export const PANEL_W = 280;

/** The yard: x 0–1000, y 56–720. */
export const BOARD_X = 0;
export const BOARD_Y = 56;
export const BOARD_W = 1000;
export const BOARD_H = 664;

export interface Point {
  x: number;
  y: number;
}

export interface Tile {
  col: number;
  row: number;
}

/* -------------------------------------------------------------------------- */
/* The tile grid (specs/yard.md)                                              */
/* -------------------------------------------------------------------------- */

export const GRID_COLS = 50;
export const GRID_ROWS = 33;
export const TILE = 20;

/** Every structure occupies FOOTPRINT by FOOTPRINT tiles, anchored top-left. */
export const FOOTPRINT = 2;

/** The anchors a 2 by 2 footprint may take: col 0–48, row 0–31. */
export const MAX_ANCHOR_COL = GRID_COLS - FOOTPRINT; // 48
export const MAX_ANCHOR_ROW = GRID_ROWS - FOOTPRINT; // 31

/** The center of tile `(col, row)`, in logical units. */
export function tileCenter(col: number, row: number): Point {
  return { x: TILE * col + TILE / 2, y: BOARD_Y + TILE * row + TILE / 2 };
}

/**
 * The center of a structure anchored at `(col, row)`: the point range, targeting
 * and drawing are measured from.
 */
export function structureCenter(col: number, row: number): Point {
  return { x: TILE * (col + 1), y: BOARD_Y + TILE * (row + 1) };
}

/** The four tiles a waypoint platform anchored at `(col, row)` covers. */
export function platformTiles(col: number, row: number): Tile[] {
  return [
    { col: col - 1, row },
    { col, row },
    { col: col + 1, row },
    { col, row: row < 16 ? row + 1 : row - 1 },
  ];
}

/* -------------------------------------------------------------------------- */
/* The three maps (specs/yard.md)                                             */
/* -------------------------------------------------------------------------- */

export type MapId = "substation" | "switchyard" | "transformer";

/** A rectangle of fixed-blocked tiles, inclusive at both ends. */
export interface HousingRect {
  col0: number;
  col1: number;
  row0: number;
  row1: number;
}

export interface MapDef {
  id: MapId;
  name: string;
  entry: Tile;
  /** The six waypoint platform anchors, WP1 first. */
  waypoints: Tile[];
  collector: Tile;
  housings: HousingRect[];
}

export const MAPS: readonly MapDef[] = [
  {
    id: "substation",
    name: "The Substation",
    entry: { col: 0, row: 5 },
    waypoints: [
      { col: 44, row: 5 },
      { col: 44, row: 27 },
      { col: 5, row: 27 },
      { col: 5, row: 14 },
      { col: 36, row: 14 },
      { col: 36, row: 20 },
    ],
    collector: { col: 49, row: 20 },
    housings: [],
  },
  {
    id: "switchyard",
    name: "The Switchyard",
    entry: { col: 25, row: 0 },
    waypoints: [
      { col: 5, row: 26 },
      { col: 44, row: 6 },
      { col: 5, row: 6 },
      { col: 44, row: 26 },
      { col: 24, row: 16 },
      { col: 5, row: 16 },
    ],
    collector: { col: 25, row: 32 },
    housings: [],
  },
  {
    id: "transformer",
    name: "The Transformer Yard",
    entry: { col: 0, row: 2 },
    waypoints: [
      { col: 44, row: 5 },
      { col: 24, row: 16 },
      { col: 44, row: 28 },
      { col: 24, row: 28 },
      { col: 6, row: 28 },
      { col: 6, row: 16 },
    ],
    collector: { col: 0, row: 30 },
    housings: [
      { col0: 12, col1: 19, row0: 6, row1: 12 },
      { col0: 30, col1: 37, row0: 20, row1: 26 },
    ],
  },
];

export const MAP_IDS: readonly MapId[] = MAPS.map((m) => m.id);

/** The map of that identifier. */
export function mapById(id: MapId): MapDef {
  const found = MAPS.find((m) => m.id === id);
  if (found === undefined) throw new Error(`no map ${id}`);
  return found;
}

/**
 * The whole ordered chain of a map: the entry, its six waypoints, the collector.
 *
 * The checkpoint a unit heads for is numbered from `1`, so `chain(map)[i]` is the
 * checkpoint `waypointIndex` `i` names once the entry is dropped — see
 * {@link checkpoint}.
 */
export function chain(map: MapDef): Tile[] {
  return [map.entry, ...map.waypoints, map.collector];
}

/**
 * The checkpoint a `waypointIndex` of `1`–`7` names: `1`–`6` are the numbered
 * waypoints and `7` is the collector (`specs/instrumentation.md`).
 */
export function checkpoint(map: MapDef, waypointIndex: number): Tile {
  return waypointIndex === 7
    ? map.collector
    : map.waypoints[waypointIndex - 1]!;
}

/* -------------------------------------------------------------------------- */
/* Pathing (specs/pathing.md)                                                 */
/* -------------------------------------------------------------------------- */

/** A route's length is in TILES: an orthogonal step is 1, a diagonal sqrt(2). */
export const STEP_ORTHOGONAL = 1;
export const STEP_DIAGONAL = Math.SQRT2;

/* -------------------------------------------------------------------------- */
/* The campaign and the economy (specs/campaign.md, specs/economy.md)         */
/* -------------------------------------------------------------------------- */

export const START_CHARGE = 10;
export const START_INTEGRITY = 20;

/** A wave's clear pays `WAVE_BONUS_BASE + WAVE_BONUS_STEP * waveNumber`. */
export const WAVE_BONUS_BASE = 8;
export const WAVE_BONUS_STEP = 2;

/** What clearing wave `n` pays, in Charge. */
export function waveBonus(n: number): number {
  return WAVE_BONUS_BASE + WAVE_BONUS_STEP * n;
}

/** Grid Integrity reads as an alert at or below this (specs/hud.md). */
export const INTEGRITY_ALERT = 5;

/* -------------------------------------------------------------------------- */
/* Difficulty (specs/difficulty.md)                                           */
/* -------------------------------------------------------------------------- */

export type DifficultyId = "easy" | "medium" | "hard";

export interface DifficultyDef {
  id: DifficultyId;
  /** The run's wave count, `N`. */
  waves: number;
  baseMult: number;
  k: number;
  c: number;
  r: number;
}

export const DIFFICULTIES: readonly DifficultyDef[] = [
  { id: "easy", waves: 40, baseMult: 0.2, k: 0.5, c: 0.08, r: 1.09 },
  { id: "medium", waves: 50, baseMult: 0.22, k: 1.17, c: 0.28, r: 1.145 },
  { id: "hard", waves: 60, baseMult: 0.24, k: 1.3, c: 0.22, r: 1.15 },
];

export const DIFFICULTY_IDS: readonly DifficultyId[] = DIFFICULTIES.map(
  (d) => d.id,
);

export function difficultyById(id: DifficultyId): DifficultyDef {
  const found = DIFFICULTIES.find((d) => d.id === id);
  if (found === undefined) throw new Error(`no difficulty ${id}`);
  return found;
}

/** The two milestone waves of a run of `N` waves: `round(N / 2)` and `N`. */
export function milestoneWaves(waves: number): [number, number] {
  return [Math.round(waves / 2), waves];
}

/**
 * A unit's maximum health on wave `w`:
 * `round(baseHp * baseMult * [(1 + k(w - 1)) + c(r^(w-1) - 1)])`, to the nearest
 * whole number with an exact half rounding up.
 */
export function scaledHp(
  baseHp: number,
  wave: number,
  difficulty: DifficultyDef,
): number {
  const w = Math.max(1, wave);
  const { baseMult, k, c, r } = difficulty;
  const bracket = 1 + k * (w - 1) + c * (Math.pow(r, w - 1) - 1);
  return Math.round(baseHp * baseMult * bracket);
}

/* -------------------------------------------------------------------------- */
/* The Load (specs/enemies.md)                                                */
/* -------------------------------------------------------------------------- */

export type LoadType =
  | "mote"
  | "spark"
  | "slug"
  | "cluster"
  | "filament"
  | "dynamo";

/** Every type `spawnUnit` takes: the roster, plus the finale's Overload Dynamo. */
export type SpawnType = LoadType | "overload";

export interface LoadDef {
  type: LoadType;
  baseHp: number;
  speed: number;
  flying: boolean;
  bounty: number;
  leak: number;
}

export const LOAD_ROSTER: readonly LoadDef[] = [
  { type: "mote", baseHp: 44, speed: 60, flying: false, bounty: 1, leak: 1 },
  { type: "spark", baseHp: 27, speed: 120, flying: false, bounty: 1, leak: 1 },
  { type: "slug", baseHp: 180, speed: 38, flying: false, bounty: 3, leak: 2 },
  { type: "cluster", baseHp: 16, speed: 72, flying: false, bounty: 1, leak: 1 },
  {
    type: "filament",
    baseHp: 74,
    speed: 85,
    flying: true,
    bounty: 2,
    leak: 1,
  },
  {
    type: "dynamo",
    baseHp: 1500,
    speed: 30,
    flying: false,
    bounty: 40,
    leak: 5,
  },
];

export const LOAD_TYPES: readonly LoadType[] = LOAD_ROSTER.map((u) => u.type);

/** Every argument `spawnUnit` takes, in the order specs/instrumentation.md lists. */
export const SPAWN_TYPES: readonly SpawnType[] = [...LOAD_TYPES, "overload"];

export function loadDef(type: LoadType): LoadDef {
  const found = LOAD_ROSTER.find((u) => u.type === type);
  if (found === undefined) throw new Error(`no load type ${type}`);
  return found;
}

/** The finale's Overload Dynamo walks the chain at this speed. */
export const OVERLOAD_SPEED = 55;

/* -------------------------------------------------------------------------- */
/* Components (specs/components.md)                                           */
/* -------------------------------------------------------------------------- */

export type ComponentType =
  | "capacitor"
  | "coil"
  | "emitter"
  | "arcnode"
  | "discharge"
  | "choke"
  | "rectifier"
  | "regulator";

/** The one base type that never fires. */
export const NON_FIRING_TYPE: ComponentType = "regulator";

export const COMPONENT_TYPES: readonly ComponentType[] = [
  "capacitor",
  "coil",
  "emitter",
  "arcnode",
  "discharge",
  "choke",
  "rectifier",
  "regulator",
];

/** The seven base types that fire. */
export const FIRING_TYPES: readonly ComponentType[] = COMPONENT_TYPES.filter(
  (t) => t !== NON_FIRING_TYPE,
);

/** A press rolls a type uniformly over the eight (specs/scrap-press.md). */
export const TYPE_ROLL_ODDS = 1 / COMPONENT_TYPES.length; // 0.125

export type Tier = 1 | 2 | 3 | 4 | 5;

export const QUALITY_TIERS = [
  { tier: 1, name: "Scrap", id: "scrap" },
  { tier: 2, name: "Tuned", id: "tuned" },
  { tier: 3, name: "Charged", id: "charged" },
  { tier: 4, name: "Primed", id: "primed" },
  { tier: 5, name: "Tesla-Prime", id: "teslaprime" },
] as const;

export const TIERS: readonly Tier[] = [1, 2, 3, 4, 5];

/** Damage is `baseDamage * QUALITY_MULT[tier - 1]`. */
export const QUALITY_MULT: readonly number[] = [1, 3, 9, 40, 110];

/** Range is `baseRange + RANGE_PER_TIER * (tier - 1)`. */
export const RANGE_PER_TIER = 8;

export interface BaseStat {
  type: ComponentType;
  /** Scrap-tier range. The Regulator has none, and reports `0`. */
  range: number;
  /** Shots per second, flat across tiers. The Regulator has none. */
  fireRate: number;
  /** Scrap-tier damage per shot. */
  damage: number;
}

export const BASE_STATS: readonly BaseStat[] = [
  { type: "capacitor", range: 100, fireRate: 1.6, damage: 6 },
  { type: "coil", range: 110, fireRate: 1.0, damage: 5 },
  { type: "emitter", range: 88, fireRate: 4.5, damage: 2 },
  { type: "arcnode", range: 96, fireRate: 0.85, damage: 5 },
  { type: "discharge", range: 160, fireRate: 0.5, damage: 18 },
  { type: "choke", range: 104, fireRate: 1.3, damage: 3 },
  { type: "rectifier", range: 96, fireRate: 1.1, damage: 2 },
  { type: "regulator", range: 0, fireRate: 0, damage: 0 },
];

export function baseStat(type: ComponentType): BaseStat {
  const found = BASE_STATS.find((s) => s.type === type);
  if (found === undefined) throw new Error(`no base stats for ${type}`);
  return found;
}

/** A base component's damage per shot at `tier`, before any aura. */
export function componentDamage(type: ComponentType, tier: Tier): number {
  return baseStat(type).damage * QUALITY_MULT[tier - 1]!;
}

/** A base component's range at `tier`. The Regulator has none. */
export function componentRange(type: ComponentType, tier: Tier): number {
  return baseStat(type).range + RANGE_PER_TIER * (tier - 1);
}

/* ---- The Coil's chain ---------------------------------------------------- */

export const COIL_LEAP_RANGE = 70;
export const COIL_FALLOFF = 0.7;

/** Additional leaps by tier, indexed `tier - 1`. */
export const COIL_LEAPS: readonly number[] = [2, 2, 3, 3, 4];

/* ---- The Arc-Node's splash ----------------------------------------------- */

/** Splash radius by tier, indexed `tier - 1`: 42 at Scrap, 5 more per tier. */
export const ARCNODE_SPLASH: readonly number[] = [42, 47, 52, 57, 62];

/* ---- The Choke's slow ---------------------------------------------------- */

export const CHOKE_SLOW_DUR = 1.2;

/** Slow amount by tier, indexed `tier - 1`: `0.22 + 0.03 * (tier - 1)`. */
export const CHOKE_SLOW: readonly number[] = [0.22, 0.25, 0.28, 0.31, 0.34];

/* ---- The Rectifier's burn ------------------------------------------------ */

export const RECTIFIER_BURN_FRAC = 0.5;
export const RECTIFIER_BURN_DUR = 2.0;

/* ---- The Regulator's aura ------------------------------------------------ */

/** Aura radius and damage bonus by tier, indexed `tier - 1`. */
export const REGULATOR_AURA: readonly { radius: number; bonus: number }[] = [
  { radius: 90, bonus: 0.1 },
  { radius: 96, bonus: 0.13 },
  { radius: 102, bonus: 0.16 },
  { radius: 108, bonus: 0.19 },
  { radius: 114, bonus: 0.22 },
];

/** Summed aura bonuses are capped here, so an aura at most doubles damage. */
export const AURA_CAP = 1.0;

/* ---- Firing and targeting ------------------------------------------------ */

export type Targeting = "first" | "last" | "nearest" | "strongest" | "weakest";

/** The cycle order of the targeting control, and the default, `first`. */
export const TARGETING_PRIORITIES: readonly Targeting[] = [
  "first",
  "last",
  "nearest",
  "strongest",
  "weakest",
];

export const DEFAULT_TARGETING: Targeting = "first";

/** Every shot travels; the projectile carries the hit. */
export const PROJECTILE_SPEED = 520;
export const PROJECTILE_HIT_R = 6;

/* -------------------------------------------------------------------------- */
/* Combination towers (specs/combinations.md)                                 */
/* -------------------------------------------------------------------------- */

export type ComboId =
  | "fusecluster"
  | "staticweb"
  | "slagdriver"
  | "corroder"
  | "ionprism"
  | "forkarray"
  | "nullcore"
  | "rupturenode"
  | "blightcoil"
  | "reactorpile"
  | "auroralance"
  | "singularity";

/** One base `(type, tier)` ingredient of a recipe. A recipe is a multiset. */
export interface Ingredient {
  type: ComponentType;
  tier: Tier;
}

export interface ComboDef {
  id: ComboId;
  name: string;
  recipe: Ingredient[];
  /** The reference block: the figures a level-3 tower scales toward. */
  range: number;
  fireRate: number;
  damage: number;
  abilities: string[];
}

const ing = (type: ComponentType, tier: Tier): Ingredient => ({ type, tier });

export const COMBOS: readonly ComboDef[] = [
  {
    id: "fusecluster",
    name: "Fuse Cluster",
    recipe: [ing("regulator", 1), ing("rectifier", 1), ing("arcnode", 1)],
    range: 108,
    fireRate: 1.0,
    damage: 40,
    abilities: ["splash", "burn"],
  },
  {
    id: "staticweb",
    name: "Static Web",
    recipe: [ing("coil", 1), ing("capacitor", 1), ing("choke", 1)],
    range: 120,
    fireRate: 1.2,
    damage: 34,
    abilities: ["chain", "slow"],
  },
  {
    id: "slagdriver",
    name: "Slag Driver",
    recipe: [ing("discharge", 2), ing("discharge", 1), ing("emitter", 1)],
    range: 175,
    fireRate: 0.6,
    damage: 120,
    abilities: ["crit"],
  },
  {
    id: "corroder",
    name: "Corroder",
    recipe: [ing("rectifier", 3), ing("regulator", 3), ing("choke", 2)],
    range: 110,
    fireRate: 1.1,
    damage: 40,
    abilities: ["burn", "slow", "aura"],
  },
  {
    id: "ionprism",
    name: "Ion Prism",
    recipe: [ing("discharge", 3), ing("rectifier", 4), ing("emitter", 2)],
    range: 140,
    fireRate: 0.9,
    damage: 220,
    abilities: ["splash", "burn", "crit"],
  },
  {
    id: "forkarray",
    name: "Fork Array",
    recipe: [ing("emitter", 3), ing("capacitor", 3), ing("coil", 2)],
    range: 118,
    fireRate: 1.8,
    damage: 100,
    abilities: ["multishot"],
  },
  {
    id: "nullcore",
    name: "Null Core",
    recipe: [ing("regulator", 5), ing("capacitor", 4), ing("arcnode", 3)],
    range: 120,
    fireRate: 1.0,
    damage: 420,
    abilities: ["splash", "aura"],
  },
  {
    id: "rupturenode",
    name: "Rupture Node",
    recipe: [ing("discharge", 5), ing("arcnode", 4), ing("emitter", 3)],
    range: 150,
    fireRate: 0.7,
    damage: 1770,
    abilities: ["splash", "burn"],
  },
  {
    id: "blightcoil",
    name: "Blight Coil",
    recipe: [ing("rectifier", 5), ing("choke", 4), ing("coil", 2)],
    range: 128,
    fireRate: 1.1,
    damage: 375,
    abilities: ["chain", "burn", "slow"],
  },
  {
    id: "reactorpile",
    name: "Reactor Pile",
    recipe: [ing("coil", 5), ing("choke", 3), ing("regulator", 2)],
    range: 130,
    fireRate: 1.4,
    damage: 420,
    abilities: ["chain", "multishot"],
  },
  {
    id: "auroralance",
    name: "Aurora Lance",
    recipe: [ing("choke", 5), ing("coil", 4), ing("discharge", 4)],
    range: 190,
    fireRate: 0.7,
    damage: 1980,
    abilities: ["chain", "slow"],
  },
  {
    id: "singularity",
    name: "Singularity",
    recipe: [
      ing("arcnode", 5),
      ing("regulator", 4),
      ing("rectifier", 2),
      ing("arcnode", 2),
    ],
    range: 150,
    fireRate: 1.0,
    damage: 490,
    abilities: ["splash", "burn", "crit", "aura"],
  },
];

export const COMBO_IDS: readonly ComboId[] = COMBOS.map((c) => c.id);

export function comboDef(id: ComboId): ComboDef {
  const found = COMBOS.find((c) => c.id === id);
  if (found === undefined) throw new Error(`no combination tower ${id}`);
  return found;
}

/** The four-rung upgrade track a combination tower climbs. */
export const COMBO_MAX_LEVEL = 3;
export const COMBO_LEVELS: readonly number[] = [0, 1, 2, 3];

/** Damage is `referenceDamage * COMBO_DAMAGE_MULT[level]`. */
export const COMBO_DAMAGE_MULT: readonly number[] = [0.5, 0.63, 0.78, 1.02];

/** Range is `referenceRange + COMBO_RANGE_BONUS[level]`. */
export const COMBO_RANGE_BONUS: readonly number[] = [0, 4, 8, 12];

/** The Charge cost of reaching level 1, 2, 3, as a fraction of reference damage. */
export const COMBO_UPGRADE_COST_FRAC: readonly number[] = [0.8, 1.5, 2.8];

/** A landed tower's damage at `level`. */
export function comboDamage(id: ComboId, level: number): number {
  return comboDef(id).damage * COMBO_DAMAGE_MULT[level]!;
}

/** A landed tower's range at `level`. */
export function comboRange(id: ComboId, level: number): number {
  return comboDef(id).range + COMBO_RANGE_BONUS[level]!;
}

/**
 * The Charge that raises a tower to `level`, rounded to the nearest whole number
 * with an exact half rounding up.
 */
export function comboUpgradeCost(id: ComboId, level: number): number {
  return Math.round(comboDef(id).damage * COMBO_UPGRADE_COST_FRAC[level - 1]!);
}

/* -------------------------------------------------------------------------- */
/* The scrap-press (specs/scrap-press.md)                                     */
/* -------------------------------------------------------------------------- */

/** Each build phase grants five rock stamps, at every difficulty. */
export const STAMPS_PER_LEVEL = 5;

/** The nine-rung refinement track, R0 through R8. */
export const REFINEMENT_MAX = 8;

/** One five-tier quality distribution per refinement level, each summing to 1. */
export const REFINEMENT_ODDS: readonly (readonly number[])[] = [
  [1.0, 0.0, 0.0, 0.0, 0.0],
  [0.7, 0.3, 0.0, 0.0, 0.0],
  [0.6, 0.3, 0.1, 0.0, 0.0],
  [0.5, 0.3, 0.2, 0.0, 0.0],
  [0.4, 0.3, 0.2, 0.1, 0.0],
  [0.3, 0.3, 0.3, 0.1, 0.0],
  [0.2, 0.3, 0.3, 0.2, 0.0],
  [0.1, 0.3, 0.3, 0.3, 0.0],
  [0.0, 0.3, 0.3, 0.3, 0.1],
];

/** The Charge cost of reaching R1 through R8 from the level below. */
export const REFINEMENT_COSTS: readonly number[] = [
  20, 50, 80, 110, 140, 170, 200, 230,
];

/** The Charge that raises refinement from `level - 1` to `level`. */
export function refinementCost(level: number): number {
  return REFINEMENT_COSTS[level - 1]!;
}

/** The four things the press produces, as the snapshot's `kind`. */
export type StructureKind = "candidate" | "component" | "combo" | "blocker";

/* -------------------------------------------------------------------------- */
/* Screens, menus, and copy (specs/ui.md)                                     */
/* -------------------------------------------------------------------------- */

export type Screen =
  | "title"
  | "mapselect"
  | "difficultyselect"
  | "howto"
  | "playing"
  | "paused"
  | "victory"
  | "overload";

export const SCREENS: readonly Screen[] = [
  "title",
  "mapselect",
  "difficultyselect",
  "howto",
  "playing",
  "paused",
  "victory",
  "overload",
];

/** The three phases of a run, and `null` off the yard. */
export type Phase = "build" | "wave" | "finale";

export const TITLE_TEXT = "ARC FOUNDRY";
export const TAGLINE_TEXT = "GROUND THE LOAD";
export const TITLE_ITEMS = ["SALVAGE", "HOW TO PLAY"] as const;
export const PAUSE_ITEMS = ["RESUME", "RESTART", "QUIT TO MENU"] as const;
export const VICTORY_ITEMS = ["PLAY AGAIN", "MENU"] as const;
export const OVERLOAD_ITEMS = ["TRY AGAIN", "MENU"] as const;

/** The harvest prompt the build panel carries (specs/hud.md). */
export const HARVEST_PROMPT_FIRST = "KEEP OR COMBINE A ROLL TO START";
export const HARVEST_PROMPT_LATER = "KEEP OR COMBINE A ROLL TO SEND";

/* ---- The readings' vocabularies (specs/instrumentation.md) --------------- */

/** Every `action` a `panelButtons` row may carry, in the fixed slot order. */
export const PANEL_ACTIONS = [
  "keep",
  "downgrade",
  "combine",
  "combine-special",
  "upgrade",
  "targeting",
  "dismantle",
] as const;
export type PanelAction = (typeof PANEL_ACTIONS)[number];

/**
 * Every `action` a `pressControls` row may carry, in the order the panel draws them.
 *
 * They are the build panel's own two controls rather than inspector actions: the
 * refinement control refines the press whatever is selected, and the press control
 * pulls the press.
 */
export const PRESS_ACTIONS = ["refine", "stamp"] as const;
export type PressAction = (typeof PRESS_ACTIONS)[number];

/** Every `action` a `menuButtons` row may carry. */
export const MENU_ACTIONS = [
  "salvage",
  "howto",
  "map-substation",
  "map-switchyard",
  "map-transformer",
  "difficulty-easy",
  "difficulty-medium",
  "difficulty-hard",
  "back",
  "resume",
  "restart",
  "quit",
  "again",
  "menu",
] as const;
export type MenuAction = (typeof MENU_ACTIONS)[number];

/** Every `action` `statusControls` reports, in the order they are drawn. */
export const STATUS_ACTIONS = [
  "combos",
  "damage",
  "speed",
  "pause",
  "mute",
] as const;
export type StatusAction = (typeof STATUS_ACTIONS)[number];

/** The menu action that chooses each map. */
export const MAP_MENU_ACTION: Readonly<Record<MapId, MenuAction>> = {
  substation: "map-substation",
  switchyard: "map-switchyard",
  transformer: "map-transformer",
};

/** The menu action that chooses each difficulty. */
export const DIFFICULTY_MENU_ACTION: Readonly<
  Record<DifficultyId, MenuAction>
> = {
  easy: "difficulty-easy",
  medium: "difficulty-medium",
  hard: "difficulty-hard",
};

/* ---- Audio --------------------------------------------------------------- */

export type CueName =
  | "stamp"
  | "fire-bolt"
  | "fire-spark"
  | "fire-chain"
  | "fire-discharge"
  | "combine"
  | "kill"
  | "leak"
  | "slow"
  | "burn"
  | "settle"
  | "music";

/** The twelve cues, one per event. */
export const CUES: readonly CueName[] = [
  "stamp",
  "fire-bolt",
  "fire-spark",
  "fire-chain",
  "fire-discharge",
  "combine",
  "kill",
  "leak",
  "slow",
  "burn",
  "settle",
  "music",
];

/** The firing cue each firing base type raises. */
export const FIRE_CUE: Readonly<Record<ComponentType, CueName | null>> = {
  capacitor: "fire-bolt",
  choke: "fire-bolt",
  rectifier: "fire-bolt",
  emitter: "fire-spark",
  coil: "fire-chain",
  arcnode: "fire-discharge",
  discharge: "fire-discharge",
  regulator: null,
};

/* -------------------------------------------------------------------------- */
/* Controls (specs/controls.md)                                               */
/* -------------------------------------------------------------------------- */

export type Action =
  | "stamp"
  | "keep"
  | "downgrade"
  | "combine"
  | "upgrade"
  | "targeting"
  | "dismantle"
  | "speed"
  | "pause"
  | "combos"
  | "damage"
  | "mute"
  | "modify"
  | "up"
  | "down"
  | "confirm"
  | "back";

/** The seventeen actions the game reads, and the keys that fire them. */
export const BINDINGS: Readonly<Record<Action, readonly string[]>> = {
  stamp: ["KeyB"],
  keep: ["KeyK"],
  downgrade: ["KeyG"],
  combine: ["KeyC"],
  upgrade: ["KeyU"],
  targeting: ["KeyT"],
  dismantle: ["KeyX"],
  speed: ["KeyF"],
  pause: ["Space"],
  combos: ["KeyV"],
  damage: ["KeyL"],
  mute: ["KeyM"],
  modify: ["ShiftLeft", "ShiftRight"],
  up: ["ArrowUp"],
  down: ["ArrowDown"],
  confirm: ["Enter"],
  back: ["Escape"],
};

export const ACTIONS: readonly Action[] = Object.keys(BINDINGS) as Action[];

/** The one key of each action, for a check that presses rather than holds. */
export function keyFor(action: Action): string {
  return BINDINGS[action][0]!;
}

/** The key the diagnostics overlay is shown and hidden by. */
export const OVERLAY_KEY = "Backquote";

/**
 * A key no action is bound to.
 *
 * Used to arm a build's audio: the Web Audio context opens on the first real user
 * gesture (`specs/ui.md` leaves the unlock to the runtime, which an engineless
 * build writes), and a key with no binding is a gesture that changes nothing.
 */
export const UNBOUND_KEY = "KeyZ";

/** The speed multipliers the speed control cycles through, in order. */
export const SPEEDS: readonly number[] = [1, 2, 4, 8];

/* -------------------------------------------------------------------------- */
/* The surface itself (specs/instrumentation.md)                              */
/* -------------------------------------------------------------------------- */

/** The seed `reset` uses when it is given none. */
export const DEFAULT_SEED = 1;
