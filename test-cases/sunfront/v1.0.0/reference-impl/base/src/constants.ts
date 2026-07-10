/**
 * Sunfront — the fixed numbers.
 *
 * Every geometry, economy, wave, unit-stat, and counter-matrix value below is
 * transcribed **exactly** from the specs (the file each block cites). This is the
 * single source of truth for the tuning; the simulation, renderer, HUD, and AI read
 * from here rather than re-deriving. Positions and distances are logical units on
 * the ground plane (specs/playfield.md); times are seconds; speeds units/second.
 */

import type {
  Armor,
  AttackType,
  UnitStats,
  UnitType,
  MuzzleKind,
} from "./types";

// ---------------------------------------------------------------------------
// Palette (specs/overview.md) — use EXACTLY. Monospace system font, no web font.
// ---------------------------------------------------------------------------

export const PALETTE = {
  /** Sand field / background. */
  sand: "#9c8452",
  /** Sand shadow / lane banding along the diagonal. */
  banding: "#7a663d",
  /** Rock and terrain detail. */
  rock: "#5a4a30",
  /** Staging-yard panel. */
  yardPanel: "#241a10",
  /** Fog of war (unexplored). */
  fog: "#150f08",
  /** Player team — Ember. */
  ember: "#ff8a3d",
  /** Player team — Ember light (energy accent). */
  emberLight: "#ffc061",
  /** Enemy team — Azure. */
  azure: "#46b4e0",
  /** Enemy team — Azure light (energy accent). */
  azureLight: "#8fd8f2",
  /** Neutral structure / Reliquary. */
  neutral: "#ecd58c",
  /** Health bar — healthy. */
  healthHealthy: "#7ed957",
  /** Health bar — critical. */
  healthCritical: "#ff5c5a",
  /** Primary text. */
  textPrimary: "#f4ecd8",
  /** Secondary text. */
  textSecondary: "#c7b487",
  /** Faint text / hints. */
  textFaint: "#8a7a58",
  /** Selection / valid placement. */
  valid: "#ffc061",
  /** Invalid placement. */
  invalid: "#ff5c5a",
} as const;

/** System monospace stack (specs/overview.md): renders identically offline. */
export const MONO_FONT_STACK =
  'ui-monospace, "SF Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

/** The two team tints and their light energy accent, keyed by team. */
export const TEAM_COLORS = {
  player: { base: PALETTE.ember, accent: PALETTE.emberLight },
  enemy: { base: PALETTE.azure, accent: PALETTE.azureLight },
} as const;

// ---------------------------------------------------------------------------
// Arena geometry (specs/playfield.md).
// ---------------------------------------------------------------------------

/** The square ground plane is 1200 x 1200 logical units. */
export const ARENA_SIZE = 1200;
/** The player's corner (origin) and the enemy's opposite corner. */
export const PLAYER_CORNER = { x: 0, z: 0 } as const;
export const ENEMY_CORNER = { x: 1200, z: 1200 } as const;
/** Arena centre; the diagonal midline is the set of points where x + z = 1200. */
export const ARENA_CENTER = { x: 600, z: 600 } as const;
/** x + z on the midline (the anti-diagonal through the centre). */
export const MIDLINE_SUM = 1200;
/** Combat corridor: ~480 wide, i.e. perpendicular half-width 240 either side. */
export const CORRIDOR_HALF_WIDTH = 240;
export const CORRIDOR_WIDTH = 480;

/** Bases: 1200 HP, in each corner; a unit within 40 attacks the base. */
export const BASE_HP = 1200;
export const BASE_PROXIMITY = 40;
export const PLAYER_BASE = { x: 130, z: 130 } as const;
export const ENEMY_BASE = { x: 1070, z: 1070 } as const;

/** Reliquaries: 2000 HP, +4 HP/s regen when undamaged, partway down the diagonal. */
export const RELIQUARY_HP = 2000;
export const RELIQUARY_REGEN_HP_PER_S = 4;
export const PLAYER_RELIQUARY = { x: 360, z: 360 } as const;
export const ENEMY_RELIQUARY = { x: 840, z: 840 } as const;

/** Muster lines: units enter here each wave, spread across the corridor width. */
export const PLAYER_MUSTER = { x: 230, z: 230 } as const;
export const ENEMY_MUSTER = { x: 970, z: 970 } as const;

/** Build grid: 8 x 3 cells of 72 x 72 units behind each base, off the corridor. */
export const BUILD_CELL_SIZE = 72;
export const BUILD_GRID_COLS = 8;
export const BUILD_GRID_ROWS = 3;
export const BUILD_GRID_CELLS = BUILD_GRID_COLS * BUILD_GRID_ROWS; // 24

/** Vision radii (specs/playfield.md fog of war). */
export const VISION_BASE = 180;
export const VISION_RELIQUARY = 180;
export const VISION_UNIT = 140;

// ---------------------------------------------------------------------------
// Economy (specs/economy.md).
// ---------------------------------------------------------------------------

/** Each side starts with 200 sol. */
export const START_SOL = 200;
/** Passive income accrues continuously at 10 sol/s (does NOT rise on waves). */
export const PASSIVE_INCOME_PER_S = 10;
/** No unit kill bounty. */
export const KILL_BOUNTY = 0;
/** Destroying the enemy Reliquary pays a lump +700 sol. */
export const RELIQUARY_BOUNTY = 700;

/** Solar Extractor economy structure. */
export const SOLAR_EXTRACTOR_COST = 180;
export const SOLAR_EXTRACTOR_UPGRADE_COST = 135; // per level
/** Income by level: +4 (L1), +7 (L2 total), +10 (L3 total) sol/s. */
export const SOLAR_EXTRACTOR_INCOME_BY_LEVEL = [4, 7, 10] as const;

/** Spawner upgrade cost = 75% of the unit's build cost per level, rounded. */
export const SPAWNER_UPGRADE_COST_FRACTION = 0.75;
/**
 * Spawner upgrade bonus, additive per level above 1: L1 = +0%, L2 = +30%, L3 = +60%
 * to HP and attack damage of every unit it emits (specs/economy.md).
 */
export const SPAWNER_LEVEL_BONUS = [0.0, 0.3, 0.6] as const;
/** Structures level 1 -> 2 -> 3; built at level 1. */
export const MAX_STRUCTURE_LEVEL = 3;
/** Selling refunds 50% of the total sol invested (build + every upgrade), rounded. */
export const SELL_REFUND_FRACTION = 0.5;

// ---------------------------------------------------------------------------
// Wave clock (specs/waves.md).
// ---------------------------------------------------------------------------

/** The first wave fires 20 s after the match begins. */
export const FIRST_WAVE_DELAY_S = 20;
/** Every wave after fires 45 s after the previous one. */
export const WAVE_INTERVAL_S = 45;

// ---------------------------------------------------------------------------
// Combat resolution (specs/units.md).
// ---------------------------------------------------------------------------

/** Target acquisition = range + a 40-unit buffer. */
export const ACQUISITION_BUFFER = 40;
/** Melee = range <= 30 (acquire almost adjacent). */
export const MELEE_RANGE_THRESHOLD = 30;

/** Lumen support: heals the most-wounded ally within 130 for 14 HP every 0.5 s. */
export const LUMEN_HEAL_RANGE = 130;
export const LUMEN_HEAL_AMOUNT = 14;
export const LUMEN_HEAL_INTERVAL_S = 0.5;

/**
 * The counter matrix (specs/units.md). `COUNTER[attack][armor]` is the multiplier,
 * or `null` when that attack **cannot target that armor class at all** (a `—` in the
 * spec). Ground attacks (Normal/Piercing/Splash) cannot hit Air; Air is hit only by
 * Flak; Support deals no damage.
 */
export const COUNTER: Record<AttackType, Record<Armor, number | null>> = {
  Normal: { Light: 1.0, Heavy: 0.75, Air: null },
  Piercing: { Light: 1.0, Heavy: 1.5, Air: null },
  Splash: { Light: 1.5, Heavy: 0.75, Air: null },
  Flak: { Light: 0.5, Heavy: 0.5, Air: 2.0 },
  Support: { Light: null, Heavy: null, Air: null },
};

/** Structures (base/reliquary) count as Heavy armor for the counter multiplier. */
export const STRUCTURE_ARMOR: Armor = "Heavy";

/**
 * The unit roster (specs/units.md), base values at spawner level 1. Costs are the
 * `Cost` column (also the spawner build cost, specs/economy.md).
 */
export const UNIT_STATS: Record<UnitType, UnitStats> = {
  scarab: {
    type: "scarab", cost: 60, hp: 55, armor: "Light", attack: "Normal",
    damage: 8, cadenceS: 0.6, range: 22, speedUps: 95, minRange: 0,
    splashRadius: 0, muzzle: null,
    name: "Scarab", role: "Cheap fast melee swarm; screens the line, soaks fire.",
  },
  trooper: {
    type: "trooper", cost: 80, hp: 70, armor: "Light", attack: "Normal",
    damage: 9, cadenceS: 0.8, range: 90, speedUps: 70, minRange: 0,
    splashRadius: 0, muzzle: "small-arms",
    name: "Trooper", role: "Cheap rifle infantry; braces and holds ground.",
  },
  sentinel: {
    type: "sentinel", cost: 100, hp: 90, armor: "Light", attack: "Normal",
    damage: 12, cadenceS: 0.9, range: 130, speedUps: 65, minRange: 0,
    splashRadius: 0, muzzle: "small-arms",
    name: "Sentinel", role: "Backbone ranged rifleman; longer reach, cost-efficient.",
  },
  bulwark: {
    type: "bulwark", cost: 200, hp: 420, armor: "Heavy", attack: "Normal",
    damage: 16, cadenceS: 1.1, range: 26, speedUps: 45, minRange: 0,
    splashRadius: 0, muzzle: null,
    name: "Bulwark", role: "Heavy frontline; walks the line forward and eats fire.",
  },
  lancer: {
    type: "lancer", cost: 180, hp: 80, armor: "Light", attack: "Piercing",
    damage: 26, cadenceS: 1.4, range: 200, speedUps: 55, minRange: 0,
    splashRadius: 0, muzzle: "lance",
    name: "Lancer", role: "Long-range marksman; deletes Heavy units, fragile.",
  },
  bombard: {
    type: "bombard", cost: 280, hp: 130, armor: "Light", attack: "Splash",
    damage: 22, cadenceS: 2.0, range: 240, speedUps: 40, minRange: 70,
    splashRadius: 55, muzzle: "cannon",
    name: "Bombard", role: "Siege artillery; erases swarms, helpless up close.",
  },
  flakhound: {
    type: "flakhound", cost: 150, hp: 120, armor: "Light", attack: "Flak",
    damage: 20, cadenceS: 0.8, range: 190, speedUps: 60, minRange: 0,
    splashRadius: 0, muzzle: "small-arms",
    name: "Flakhound", role: "Anti-air platform; near-useless against ground alone.",
  },
  sunhawk: {
    type: "sunhawk", cost: 240, hp: 160, armor: "Air", attack: "Normal",
    damage: 14, cadenceS: 0.7, range: 120, speedUps: 85, minRange: 0,
    splashRadius: 0, muzzle: "small-arms",
    name: "Sunhawk", role: "Air gunship; flies over the line, only Flak stops it.",
  },
  lumen: {
    type: "lumen", cost: 160, hp: 100, armor: "Light", attack: "Support",
    damage: 0, cadenceS: null, range: 130, speedUps: 60, minRange: 0,
    splashRadius: 0, muzzle: null,
    name: "Lumen", role: "Repair drone; heals nearby allies, deals no damage.",
  },
  monolith: {
    type: "monolith", cost: 900, hp: 900, armor: "Heavy", attack: "Splash",
    damage: 40, cadenceS: 1.5, range: 90, speedUps: 38, minRange: 0,
    splashRadius: 60, muzzle: "cannon",
    name: "Monolith", role: "Expensive capstone bruiser; slow, splashes the line.",
  },
};

/**
 * The palette / shortcut order for the build palette (specs/flow.md): the ten unit
 * spawners bound to `1`-`9`,`0`, then the Solar Extractor bound to `E`.
 */
export const BUILD_PALETTE_ORDER: readonly UnitType[] = [
  "scarab", "trooper", "sentinel", "bulwark", "lancer",
  "bombard", "flakhound", "sunhawk", "lumen", "monolith",
];

// ---------------------------------------------------------------------------
// The Aegis (specs/waves.md) — not buildable; the comeback guardian.
// ---------------------------------------------------------------------------

export const AEGIS = {
  hp: 2200,
  armor: "Heavy" as Armor,
  speedUps: 40,
  /** Main forward cannon: Piercing, Heavy-first in a narrow forward cone. */
  main: {
    attack: "Piercing" as AttackType,
    damage: 48,
    cadenceS: 1.5,
    range: 130,
  },
  /** Two side turrets: lighter Splash, Light-first on their own flank arc. */
  side: {
    attack: "Splash" as AttackType,
    damage: 18,
    splashRadius: 35,
    cadenceS: 1.0,
    range: 90,
  },
  /** Which muzzle-flash family each firing turret plays. */
  muzzle: "cannon" as MuzzleKind,
  /** Rarity guards (specs/waves.md). */
  maxPerSide: 1,
  maxPerMatch: 2,
} as const;

// ---------------------------------------------------------------------------
// Presentation (specs/overview.md rendering/camera).
// ---------------------------------------------------------------------------

/** The rendered view preserves 16:9, letterboxed with the background color. */
export const ASPECT_W = 16;
export const ASPECT_H = 9;
export const ASPECT_RATIO = ASPECT_W / ASPECT_H;

/**
 * One global units-per-logical world scale so authored `dimensions` are honored
 * across the whole roster without per-model renormalization (specs/assets.md — a
 * Monolith towers over a Scarab). Model units map to world units by this factor.
 */
export const WORLD_UNITS_PER_LOGICAL = 1;
