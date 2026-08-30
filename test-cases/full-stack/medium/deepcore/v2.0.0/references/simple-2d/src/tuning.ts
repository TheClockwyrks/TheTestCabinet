// Deepcore — the figures the specification leaves open, and the curves derived
// from the ones it fixes.
//
// `src/constants.ts` is supplied with the project and holds every value the
// specification names. Two other kinds of number are needed to build the game,
// and both live here so nothing is invented at its point of use:
//
//  - THE DERIVED CURVES. The specification states a rule and the endpoints it
//    runs between — the density ramps, the thrust burn's easing, the gas
//    damage's depth scaling — and the function of depth those endpoints describe
//    is written once, here, against the constants that fix it.
//  - THE BUILD'S OWN CHOICES. Where the camp's buildings stand, how near the
//    miner must be to use one, how long the launch takes, how hard the screen
//    shakes, and the copy the menus and panels read. The specification names none
//    of these, so they are this build's to pick.
//
// Every rate is per second and every duration is in seconds, exactly as in
// `src/constants.ts`.

import {
  BANDS,
  BUILDINGS,
  CARGO_TIERS,
  CRUISE_SPEED,
  FUEL_TIERS,
  GAS_DAMAGE_MAX,
  GAS_DAMAGE_MIN,
  GAS_DENSITY_MAX,
  GAS_DENSITY_MIN,
  HULL_TIERS,
  ITEMS,
  JETPACK_TIERS,
  LAVA_DENSITY_MAX,
  LAVA_DENSITY_MIN,
  LAVA_DRILL_CORESHELL,
  LAVA_DRILL_DEEPSTONE,
  MAX_TIER,
  METERS_PER_ROW,
  RADIATOR_TIERS,
  SCANNER_TIERS,
  SIZE_ITEMS,
  STANDARD_ROWS,
  STONE_DENSITY_MAX,
  STONE_DENSITY_MIN,
  THRUST_BURN_MAX,
  THRUST_BURN_MIN,
  TILE,
  UPGRADE_PRICES,
  VIEW_W,
  WORLD_SIZE_SCALE,
  WORLD_W,
} from "./constants";
import type {
  BandName,
  BuildingId,
  FieldSupply,
  ItemId,
  Mineral,
  Mode,
  TrackName,
  WorldSize,
} from "./constants";

// ---- The mine's rows (specs/world.md) ------------------------------------

/** The camp's row: open sky above the ground line, and the ground itself. */
export const SURFACE_ROW = 0;

/** The world size an expedition opens at before the player chooses one. */
export const DEFAULT_WORLD_SIZE: WorldSize = "standard";

/** The Core chamber's row at a world size. */
export function coreRowFor(size: WorldSize): number {
  return Math.round(STANDARD_ROWS * WORLD_SIZE_SCALE[size]);
}

/** How deep the Core lies at a world size, in meters. */
export function coreDepthMetersFor(size: WorldSize): number {
  return coreRowFor(size) * METERS_PER_ROW;
}

/**
 * The fraction of the descent a row sits at: `0` at row `1`, `1` at the deepest
 * minable row. Every depth-varying rule is expressed against this rather than
 * against a row, so its shape is identical at every world size.
 */
export function depthFraction(row: number, coreRow: number): number {
  if (coreRow <= 1) return 0;
  return (row - 1) / (coreRow - 1);
}

/** The band a depth fraction falls in: the four bands are equal quarters. */
export function bandAtFraction(f: number): BandName {
  const index = Math.min(BANDS.length - 1, Math.max(0, Math.floor(4 * f)));
  return BANDS[index];
}

/** A band's index, shallowest first. */
export function bandIndex(band: BandName): number {
  return BANDS.indexOf(band);
}

// ---- The camera's horizontal clamp (specs/world.md) -----------------------

/** The farthest right the camera scrolls, so the border columns stay in frame. */
export const MAX_CAM_X = WORLD_W - VIEW_W;

// ---- What generation places (specs/world.md) -----------------------------

/** The depth fraction the rockbed begins at, where stone and gas first appear. */
export const ROCKBED_TOP_FRACTION = 0.25;

/** The depth fraction the deepstone begins at, where lava first appears. */
export const DEEPSTONE_TOP_FRACTION = 0.5;

/** Unbreakable stone's share of a row's playable cells at a depth fraction. */
export function stoneDensityAt(f: number): number {
  if (f < ROCKBED_TOP_FRACTION) return 0;
  const t = (f - ROCKBED_TOP_FRACTION) / (1 - ROCKBED_TOP_FRACTION);
  return STONE_DENSITY_MIN + (STONE_DENSITY_MAX - STONE_DENSITY_MIN) * t;
}

/** A gas pocket's share of a row's playable cells at a depth fraction. */
export function gasDensityAt(f: number): number {
  if (f < ROCKBED_TOP_FRACTION) return 0;
  const t = (f - ROCKBED_TOP_FRACTION) / (1 - ROCKBED_TOP_FRACTION);
  return GAS_DENSITY_MIN + (GAS_DENSITY_MAX - GAS_DENSITY_MIN) * t;
}

/** Lava's share of a row's playable cells at a depth fraction. */
export function lavaDensityAt(f: number): number {
  if (f < DEEPSTONE_TOP_FRACTION) return 0;
  const t = (f - DEEPSTONE_TOP_FRACTION) / (1 - DEEPSTONE_TOP_FRACTION);
  return LAVA_DENSITY_MIN + (LAVA_DENSITY_MAX - LAVA_DENSITY_MIN) * t;
}

/** A mineral's weight in the which-ore draw at a depth fraction. */
export function mineralWeightAt(mineral: Mineral, f: number): number {
  return (
    mineral.pick * Math.max(0, 1 - Math.abs(f - mineral.peak) / mineral.spread)
  );
}

// ---- The surface camp (this build's layout) ------------------------------

/** The footprint every building is drawn and reached at, in world units. */
export const BUILDING_W = 112;
export const BUILDING_H = 132;

/** How near a building the miner stands to activate it, in world units. */
export const BUILDING_REACH = TILE * 1.6;

/**
 * The camp column each building's footprint is centered on, and the name the
 * camp and its panel read.
 *
 * The six are spread four columns apart, so `320` units of clear ground sit
 * between two footprints of `BUILDING_W` — far past `BUILDING_GAP` — and the
 * rightmost stands well left of the cave mouth.
 */
export const BUILDING_PLACES: readonly {
  readonly id: BuildingId;
  readonly name: string;
  readonly col: number;
}[] = [
  { id: "fuel-depot", name: "Fuel Depot", col: 3 },
  { id: "ore-market", name: "Ore Market", col: 7 },
  { id: "save-pad", name: "Save Pad", col: 11 },
  { id: "upgrade-shop", name: "Upgrade Shop", col: 15 },
  { id: "supply-depot", name: "Supply Depot", col: 19 },
  { id: "launch-pad", name: "Launch Pad", col: 23 },
];

/** One building's place, by its id. */
export function buildingPlace(
  id: BuildingId,
): (typeof BUILDING_PLACES)[number] {
  const place = BUILDING_PLACES.find((entry) => entry.id === id);
  if (!place) throw new Error(`Deepcore: no camp place for building ${id}`);
  return place;
}

/** Every building id, in the order the camp lays them out left to right. */
export const CAMP_ORDER: readonly BuildingId[] = BUILDINGS;

// ---- Fuel and hazards (specs/character.md, specs/hazards.md) -------------

/**
 * The thrust burn per second at an upward speed, before the world size's
 * multiplier: `THRUST_BURN_MAX` at rest, easing linearly to `THRUST_BURN_MIN`
 * once the climb reaches `CRUISE_SPEED`.
 */
export function thrustBurnAt(upSpeed: number): number {
  const t = Math.min(1, Math.max(0, upSpeed) / CRUISE_SPEED);
  return THRUST_BURN_MAX + (THRUST_BURN_MIN - THRUST_BURN_MAX) * t;
}

/**
 * The hull a gas detonation deals at a depth fraction: `GAS_DAMAGE_MIN` where
 * gas first appears, at `ROCKBED_TOP_FRACTION`, rising linearly to
 * `GAS_DAMAGE_MAX` at the deepest minable row.
 */
export function gasDamageAt(f: number): number {
  const span = 1 - ROCKBED_TOP_FRACTION;
  const t = Math.max(0, f - ROCKBED_TOP_FRACTION) / span;
  return GAS_DAMAGE_MIN + (GAS_DAMAGE_MAX - GAS_DAMAGE_MIN) * t;
}

/** The hull a lava cell of a band burns when it breaks, before the radiator. */
export const LAVA_DRILL_DAMAGE: Readonly<Record<BandName, number>> = {
  topsoil: 0,
  rockbed: 0,
  deepstone: LAVA_DRILL_DEEPSTONE,
  coreshell: LAVA_DRILL_CORESHELL,
};

// ---- Screen shake, which is render-only ----------------------------------

export const SHAKE_GAS_AMP = 11;
export const SHAKE_GAS_TIME = 0.36;
export const SHAKE_IMPACT_PER_SPEED = 0.03;
export const SHAKE_CORE_AMP = 18;
export const SHAKE_CORE_TIME = 0.6;

/** Seconds the shake takes to fade out once its timer enters its tail. */
export const SHAKE_FADE = 0.3;

// ---- The upgrade ladders, as the shop reads them -------------------------

/**
 * The Credits the next tier on a track costs, or `null` once it is maxed out.
 *
 * `UPGRADE_PRICES` is indexed by the tier being LEFT, counted from zero, so the
 * step out of tier `1` takes the ladder's first rung.
 */
export function upgradePrice(track: TrackName, tier: number): number | null {
  if (tier >= MAX_TIER[track]) return null;
  return UPGRADE_PRICES[tier - 1] ?? null;
}

/** The drill's rung as the shop reads it: a power rating rather than raw damage. */
export const DRILL_POWER: readonly number[] = [1, 2, 3, 4, 5];

/** What the shop shows for each track's tier, and the unit it reads in. */
export const TRACK_DISPLAY: Readonly<
  Record<
    TrackName,
    { readonly values: readonly number[]; readonly unit: string }
  >
> = {
  fuel: { values: FUEL_TIERS, unit: "max fuel" },
  drill: { values: DRILL_POWER, unit: "power" },
  cargo: { values: CARGO_TIERS, unit: "ore slots" },
  hull: { values: HULL_TIERS, unit: "max hull" },
  jetpack: {
    values: JETPACK_TIERS.map((rung) => rung.liftLimitKg),
    unit: "kg lift",
  },
  radiator: { values: RADIATOR_TIERS, unit: "dmg cut" },
  scanner: {
    values: SCANNER_TIERS.map((range) => range ?? 0),
    unit: "tiles range",
  },
};

/** The name the shop gives each track. */
export const TRACK_LABEL: Readonly<Record<TrackName, string>> = {
  fuel: "FUEL TANK",
  drill: "DRILL",
  cargo: "CARGO BAY",
  hull: "HULL",
  jetpack: "JETPACK",
  radiator: "RADIATOR",
  scanner: "SCANNER",
};

// ---- Field supplies, as the depot reads them -----------------------------

/** The field supplies keyed by id. */
export const ITEM_BY_ID: Readonly<Record<ItemId, FieldSupply>> =
  Object.fromEntries(ITEMS.map((item) => [item.id, item])) as Record<
    ItemId,
    FieldSupply
  >;

/** The number key, `1` through `6`, that uses a supply during live play. */
export function itemHotkey(id: ItemId): number {
  return ITEMS.findIndex((item) => item.id === id) + 1;
}

/** The supply a number key uses, or `null` where the key names none. */
export function itemForHotkey(key: number): ItemId | null {
  return ITEMS[key - 1]?.id ?? null;
}

/** The one line the Supply Depot and the inventory show under a supply's name. */
export const ITEM_BLURB: Readonly<Record<ItemId, string>> = {
  dynamite: "Clears a 3x3 block, stone too. Sets off gas.",
  "plastic-explosives": "Clears a 5x5 block, stone too. Sets off gas.",
  "quantum-teleporter": "Drops you in over the camp at speed.",
  "matter-transmitter": "Sets you down at the camp, unhurt.",
  nanobots: "Repairs 20 hull, capped at the maximum.",
  "emergency-fuel": "Adds 30 fuel, capped at the maximum.",
};

// ---- The launch (specs/rocket.md) ----------------------------------------

/** Seconds the rocket rises for before the Victory screen. */
export const LAUNCH_ANIM_TIME = 2.6;

/** How fast the rocket rises during that climb, in world units per second. */
export const LAUNCH_RISE_SPEED = 230;

/** Seconds the death plays out before the mode's outcome is applied. */
export const DEATH_ANIM = 1.1;

// ---- Screen copy this build writes ---------------------------------------

/** The line under the title. */
export const TAGLINE_TEXT = "Dig down. Build the rocket. Fly home.";

/** What each world size reads as on the size-select screen. */
export const WORLD_SIZE_LABEL: Readonly<Record<WorldSize, string>> = {
  quick: SIZE_ITEMS[0],
  standard: SIZE_ITEMS[1],
  marathon: SIZE_ITEMS[2],
};

/** What the mode-select screen says about each mode before it is chosen. */
export const MODE_BLURB: Readonly<Record<Mode, string>> = {
  standard:
    "STANDARD — a death lets you restore from your last save and keep going.",
  hardcore:
    "HARDCORE — a death deletes your save and ends the expedition. Permadeath.",
};

/** What the size-select screen says about each size before it is chosen. */
export const SIZE_BLURB: Readonly<Record<WorldSize, string>> = {
  quick: `QUICK — a half-depth mine. The Core lies ${coreDepthMetersFor("quick")} m down.`,
  standard: `STANDARD — the full mine. The Core lies ${coreDepthMetersFor("standard")} m down.`,
  marathon: `MARATHON — a double-depth mine. The Core lies ${coreDepthMetersFor("marathon")} m down.`,
};
