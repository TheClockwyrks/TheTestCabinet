// Deepcore — fixed tuning constants.
//
// Every value here is pinned by the specs and is authoritative; the game reads these
// rather than re-deriving numbers inline. Where a spec calls a value "fixed", it is
// exported here verbatim. Sources are cited per block:
//   specs/overview.md   — stage, coordinate system, palette
//   specs/world.md      — grid, bands, depth
//   specs/character.md  — movement, fuel, hull
//   specs/mining.md     — ore values/bands, cargo
//   specs/hazards.md    — gas, lava, core timer
//   specs/upgrades.md   — the seven upgrade tracks
//   specs/rocket.md     — the five rocket components

import type {
  Band,
  ItemId,
  Ore,
  Material,
  RocketComponentId,
  UpgradeTrack,
} from "./types";

// ---------------------------------------------------------------------------
// Stage & coordinate system (specs/overview.md)
// ---------------------------------------------------------------------------

/** Logical stage size (16:9). All game logic operates in this space. */
export const STAGE_WIDTH = 1280;
export const STAGE_HEIGHT = 720;

/** The top status bar occupies y in [0, STATUS_BAR_HEIGHT]. */
export const STATUS_BAR_HEIGHT = 56;

/** The mine viewport is x in [0, 1280], y in [56, 720] → 1280 x 664. */
export const VIEWPORT_X = 0;
export const VIEWPORT_Y = STATUS_BAR_HEIGHT;
export const VIEWPORT_WIDTH = STAGE_WIDTH;
export const VIEWPORT_HEIGHT = STAGE_HEIGHT - STATUS_BAR_HEIGHT; // 664

// ---------------------------------------------------------------------------
// The tile grid & world (specs/world.md)
// ---------------------------------------------------------------------------

/**
 * Every tile is 80 x 80 logical pixels. The world (32 cols) is 2560 px wide — WIDER than
 * the 1280 viewport — so only ~16 columns are on screen at once and the camera scrolls
 * horizontally as well as vertically (specs/world.md). The movement/gravity px/s
 * constants below are scaled with this tile size so the *tiles-per-second* feel — and
 * every balance number derived in tiles/seconds/kg — is unchanged from the reference.
 */
export const TILE_SIZE = 80;

/** 32 columns [0, 31]; columns 0 and 31 are the unminable bedrock border. */
export const WORLD_COLS = 32;
export const PLAYABLE_COL_MIN = 1;
export const PLAYABLE_COL_MAX = 30;

/**
 * Rows: row 0 is the surface; the mine extends DOWN to the Core chamber at row
 * `WORLD.coreRow`, the deepest row. The depth of that chamber depends on the WORLD SIZE the
 * player chose when starting the expedition (specs/world.md): the STANDARD mine is
 * `BASE_CORE_ROW` (500) rows deep, Quick is half that, Marathon double. See the WORLD layout
 * (below) — code reads `WORLD.coreRow` / `WORLD.rows`, never a fixed row count.
 */
export const SURFACE_ROW = 0;
export const PLAYABLE_ROW_MIN = 1;
/** The Core-chamber depth of the STANDARD mine, in rows. Quick/Marathon scale this. */
export const BASE_CORE_ROW = 500;

/**
 * The world is 32 x 80 = 2560 px wide — wider than the 1280 viewport — so it is NOT
 * centered/letterboxed: its left edge sits at world x 0 and the camera scrolls across it
 * horizontally (specs/world.md). GRID_MARGIN_X is kept (0) so world x = col*TILE_SIZE.
 */
export const GRID_PIXEL_WIDTH = WORLD_COLS * TILE_SIZE; // 2560
export const GRID_MARGIN_X = 0;
/** Horizontal camera range: [0, world width − viewport width]. */
export const MAX_CAMERA_X = GRID_PIXEL_WIDTH - VIEWPORT_WIDTH; // 1280

/** Depth reported to the player: each row below the surface is 5 m. The Standard Core sits at
 *  2500 m; a Quick mine's is half as deep, a Marathon's twice (specs/world.md). */
export const METERS_PER_ROW = 5;
export const BASE_CORE_DEPTH_METERS = BASE_CORE_ROW * METERS_PER_ROW; // 2500 (Standard)

// ---------------------------------------------------------------------------
// World SIZE — the height option chosen when starting a new expedition (specs/world.md,
// specs/flow.md)
// ---------------------------------------------------------------------------
//
// A new expedition is dug at one of three sizes. The size ONLY scales the vertical extent of
// the mine — how deep the descent to the Core is — while keeping the SAME four bands (as equal
// quarters of the descent), the same hazards, economy, and the same difficulty-per-proportional-
// depth. So a Quick mine is the whole game compressed into half the depth (a short session), and
// a Marathon is it stretched over twice the depth (a long haul); Standard is the reference mine.
// The depth-scaled difficulty curves (ore frequency, gas damage) are expressed in BASE-row space
// via `toBaseRow`, so every size shares one difficulty envelope — a size stretches/compresses the
// descent, it never changes how hard a given fraction of it is.

export type WorldSize = "quick" | "standard" | "marathon";

export interface WorldSizeDef {
  readonly id: WorldSize;
  /** Menu label. */
  readonly label: string;
  /** Depth multiplier applied to BASE_CORE_ROW (0.5 / 1 / 2). */
  readonly scale: number;
  /** One-line description for the size-select screen (specs/flow.md). */
  readonly blurb: string;
}

/** The three world sizes, shallow → deep (the size-select order). */
export const WORLD_SIZES: Record<WorldSize, WorldSizeDef> = {
  quick: {
    id: "quick",
    label: "QUICK",
    scale: 0.5,
    blurb: "QUICK — a half-depth mine. The Core is only ~1250 m down: a short expedition.",
  },
  standard: {
    id: "standard",
    label: "STANDARD",
    scale: 1,
    blurb: "STANDARD — the full mine. The Core lies ~2500 m down: the reference expedition.",
  },
  marathon: {
    id: "marathon",
    label: "MARATHON",
    scale: 2,
    blurb: "MARATHON — a double-depth mine. The Core is ~5000 m down: a long haul.",
  },
};
export const WORLD_SIZE_ORDER: readonly WorldSize[] = ["quick", "standard", "marathon"];
export const DEFAULT_WORLD_SIZE: WorldSize = "standard";

/** Inclusive row span [min, max] of a band. */
export interface BandRows {
  readonly min: number;
  readonly max: number;
}

/** The resolved vertical layout of the mine for the chosen size (specs/world.md). */
export interface WorldLayout {
  size: WorldSize;
  /** Depth multiplier vs the Standard mine (0.5 / 1 / 2). */
  scale: number;
  /** Row index of the Core chamber (the deepest row). */
  coreRow: number;
  /** Total rows, 0..coreRow inclusive. */
  rows: number;
  /** Depth in metres reported at the Core. */
  coreDepthMeters: number;
  /** The four bands as equal quarters of the descent (scaled with the size). */
  bands: Record<Band, BandRows>;
}

function computeLayout(size: WorldSize): WorldLayout {
  const scale = WORLD_SIZES[size].scale;
  const coreRow = Math.round(BASE_CORE_ROW * scale);
  // Split the minable rows 1..coreRow-1 into four equal quarters (at Standard this reproduces
  // the reference bands exactly: topsoil 1..125, rockbed 126..250, deepstone 251..375,
  // coreshell 376..499). The quarter size is floored so the coreshell absorbs any remainder.
  const q = Math.floor(coreRow / 4);
  return {
    size,
    scale,
    coreRow,
    rows: coreRow + 1,
    coreDepthMeters: coreRow * METERS_PER_ROW,
    bands: {
      topsoil: { min: 1, max: q },
      rockbed: { min: q + 1, max: 2 * q },
      deepstone: { min: 2 * q + 1, max: 3 * q },
      coreshell: { min: 3 * q + 1, max: coreRow - 1 },
    },
  };
}

/**
 * The ACTIVE world layout. A single-instance, single-threaded game reads the current size's
 * dimensions through this one shared object, so every module (generation, band lookup, camera,
 * hazards, render) sees the chosen size without threading it through every call. `setWorldSize`
 * (called when a new expedition starts, or when a save is restored) mutates it in place; imports
 * hold the object by reference, so they always observe the current size (specs/world.md).
 */
export const WORLD: WorldLayout = computeLayout(DEFAULT_WORLD_SIZE);

/** Point the active layout at a world size (specs/world.md, specs/flow.md). Called before
 *  generating a fresh mine and before restoring a saved one, so all dimension queries match. */
export function setWorldSize(size: WorldSize): void {
  Object.assign(WORLD, computeLayout(size));
}

/**
 * Convert an ACTUAL row to its equivalent row in the STANDARD (500-row) mine, so the depth-scaled
 * difficulty curves — ore frequency (`oreWeightAtRow`) and gas damage (`gasDamageAt`) — stay
 * identical in shape at every size. A size only stretches/compresses the descent; it does not
 * change how hard a given FRACTION of it is (specs/world.md, specs/mining.md, specs/hazards.md).
 */
export function toBaseRow(row: number): number {
  return row / WORLD.scale;
}

// ---------------------------------------------------------------------------
// The four depth bands + Core chamber (specs/world.md)
// ---------------------------------------------------------------------------

export interface BandDef {
  readonly band: Band;
  /** Tile hardness 1..4 (harder = more tile health, so more hits/fuel to break). */
  readonly hardness: 1 | 2 | 3 | 4;
  /**
   * Full HEALTH of a minable tile in this band (specs/character.md, specs/upgrades.md). The
   * drill removes health in DAMAGE-per-hit chunks (DRILL_DAMAGE_BY_TIER); hits-to-break =
   * `ceil(maxHealth / damagePerHit)`, each hit spending FUEL_PER_HIT. Health ∝ hardness
   * (4 / 8 / 12 / 16), so a deeper band costs proportionally more hits, time, and fuel to
   * drill through unless the drill is upgraded.
   */
  readonly maxHealth: number;
  /** Rock fill color from the palette. */
  readonly fill: string;
  /** Whether gas pockets appear in this band. */
  readonly gas: boolean;
  /** Whether lava appears in this band. */
  readonly lava: boolean;
  /** The exotic material sourced from this band, if any. */
  readonly material: Material | null;
}

// Per-band STATIC properties (hardness, tile health, fill, hazards, material). The band ROW
// SPANS are NOT here — they scale with the world size and live on `WORLD.bands` (above); look a
// row's band up with `bandForRow` (world.ts).
export const BANDS: Record<Band, BandDef> = {
  topsoil: {
    band: "topsoil",
    hardness: 1,
    maxHealth: 4,
    fill: "#3a2c1f",
    gas: false,
    lava: false,
    material: null,
  },
  rockbed: {
    band: "rockbed",
    hardness: 2,
    maxHealth: 8,
    fill: "#3a3d44",
    gas: true,
    lava: false,
    material: "resonite",
  },
  deepstone: {
    band: "deepstone",
    hardness: 3,
    maxHealth: 12,
    fill: "#20242c",
    gas: true,
    lava: true,
    material: "cryenite",
  },
  coreshell: {
    band: "coreshell",
    hardness: 4,
    maxHealth: 16,
    fill: "#3a1512",
    gas: true,
    lava: true, // dense lava
    material: null,
  },
};

/** Band lookup order by depth, for resolving which band a row belongs to. */
export const BAND_ORDER: readonly Band[] = [
  "topsoil",
  "rockbed",
  "deepstone",
  "coreshell",
];

// ---------------------------------------------------------------------------
// Palette (specs/overview.md)
// ---------------------------------------------------------------------------

export const PALETTE = {
  void: "#05070a",
  duskSky: "#1b2536",
  surfaceGround: "#2c2620",
  topsoilFill: "#3a2c1f",
  rockbedFill: "#3a3d44",
  deepstoneFill: "#20242c",
  coreshellFill: "#3a1512",
  coreGlow: "#ff6a2a",
  bedrock: "#0c0f14",
  tunnel: "#0a0d12",
  tunnelEdge: "#171b22",
  ferron: "#b8794a",
  marlite: "#b8a24e",
  cuprite: "#4fb0a0",
  argenite: "#cdd6e0",
  cobaltine: "#7b74c8",
  voltite: "#5a8cff",
  halcite: "#9fc63e",
  pyronium: "#ff8a3a",
  cindrite: "#e0472a",
  adamite: "#8affda",
  // Gemstones — jewel-toned and deliberately distinct from every ore/material color, so a
  // faceted gem reads at a glance as a rarer, richer find than an ore smear (specs/mining.md).
  verdite: "#2fe36a",
  roselite: "#ff4f7a",
  aurite: "#ffca28",
  resonite: "#4ad0ff",
  cryenite: "#b98cff",
  coreSample: "#ff4a2a",
  gas: "#9ad24a",
  lava: "#ff5220",
  fuel: "#ffcf4a",
  hull: "#46d6e6",
  cargo: "#c48a52",
  credits: "#ffd23a",
  minerSuit: "#ffcf9a",
  jetpackFlame: "#ffa63a",
  alert: "#ff5a52",
  panel: "#141a20",
  textPrimary: "#e8eef5",
  textSecondary: "#93a2b2",
  textTertiary: "#5d6b7a",
} as const;

/** System monospace stack (no downloaded web font — must render identically offline). */
export const FONT_STACK =
  'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

// ---------------------------------------------------------------------------
// Movement (specs/character.md)
// ---------------------------------------------------------------------------

/** Walk / lateral speed (logical px/s). Scaled with the 80px tile (was 150 at 48px). */
export const WALK_SPEED = 250;
/**
 * Terminal falling speed (logical px/s). Set high enough that a fall keeps
 * accelerating over several tiles before it caps (terminal is reached at
 * ~4 tiles of free-fall), so landing speed — and thus fall impact
 * (specs/hazards.md) — actually distinguishes a short hop from a full-depth
 * plunge. Only caps *descent*; the climb is capped separately, per jetpack tier
 * (JETPACK_CLIMB, specs/upgrades.md). Scaled with the 80px tile (was 600 at 48px).
 */
export const FALL_TERMINAL = 1000;
/** Gravity (logical px/s^2). Scaled with the 80px tile (was 900 at 48px). */
export const GRAVITY = 1500;

// ---------------------------------------------------------------------------
// Weight & lift (specs/character.md, specs/mining.md)
// ---------------------------------------------------------------------------
//
// Ore has WEIGHT (each ore's `weightKg`, below). The miner's total mass is its own
// hull/suit/drill/jetpack (MINER_BASE_MASS) plus the weight of the ore in the bay. The
// jetpack pushes up with a fixed FORCE per tier (JETPACK_LIFT); the upward *acceleration*
// it achieves is that force divided by the loaded mass, so a heavy haul climbs slower —
// and once the load is heavy enough that the thrust acceleration no longer exceeds
// GRAVITY, the jetpack can only slow the descent, not climb (the Motherload "too heavy to
// take off" wall). Cargo is capped by SLOT COUNT (CARGO_CAPACITY), so a heavy-enough haul
// can hit this lift wall well before the bay is full — at which point the miner must DROP
// ore from the inventory (specs/mining.md, specs/character.md) or upgrade the jetpack.

/** The miner's own mass (suit + drill + jetpack), in the same kg units as ore weight. */
export const MINER_BASE_MASS = 200;

// ---------------------------------------------------------------------------
// Fuel (specs/character.md)
// ---------------------------------------------------------------------------

/**
 * Fuel burned while holding jetpack thrust — the rate is NOT flat: it DROPS as the miner's
 * upward climb speed rises (specs/character.md). Lifting off from a stop, or grinding up
 * under a heavy load that can barely climb, burns the FULL rate; once the miner is cruising
 * at climb speed — which an empty or light miner reaches quickly and a near-overloaded one
 * never does — the burn eases to the CRUISE rate. This is what makes an EMPTY ascent cheap
 * and fast without simply raising the top climb speed (which would make the miner move too
 * fast): the efficiency comes from cruising, and a heavy haul — which climbs slowly, so its
 * upward speed stays low (see the load-scaled climb cap in game.ts) — keeps paying the full
 * rate. Interpolated by `thrustFuelRate` below.
 */
export const FUEL_THRUST_RATE = 6.0; // full burn: lifting off / heavy, slow climb
export const FUEL_THRUST_CRUISE_RATE = 2.2; // eased burn once cruising at climb speed
/** At/below this upward speed (px/s) the thrust burns the FULL rate (still accelerating / heavy). */
export const JETPACK_FULL_BURN_SPEED = 220;
/** At/above this upward speed (px/s) the thrust burns the CRUISE rate (an empty/light climb). */
export const JETPACK_CRUISE_SPEED = 460;

/**
 * The jetpack thrust fuel rate for a given UPWARD climb speed (px/s, i.e. `max(0, -vy)`):
 * the full rate at/below JETPACK_FULL_BURN_SPEED, easing linearly to the cruise rate at/above
 * JETPACK_CRUISE_SPEED (specs/character.md). Empty tier-1 climbs at ~700 px/s (> cruise
 * threshold) so it sips fuel; a near-overloaded haul barely accelerates and lingers below the
 * cruise threshold, paying the full rate — the fuel cost of a climb tracks the load.
 */
export function thrustFuelRate(upSpeed: number): number {
  if (upSpeed <= JETPACK_FULL_BURN_SPEED) return FUEL_THRUST_RATE;
  if (upSpeed >= JETPACK_CRUISE_SPEED) return FUEL_THRUST_CRUISE_RATE;
  const t = (upSpeed - JETPACK_FULL_BURN_SPEED) / (JETPACK_CRUISE_SPEED - JETPACK_FULL_BURN_SPEED);
  return FUEL_THRUST_RATE + (FUEL_THRUST_CRUISE_RATE - FUEL_THRUST_RATE) * t;
}
/** Fuel burned for lateral drift while airborne (fuel/s). */
export const FUEL_LATERAL_AIR_RATE = 2.0;
/** Passive life-support drain while underground (fuel/s). */
export const FUEL_LIFE_SUPPORT_RATE = 0.4;
/**
 * Fuel spent per drill HIT (specs/character.md, specs/upgrades.md). A tile has HEALTH
 * (its band's `maxHealth`, below) and the drill deals DAMAGE per hit (DRILL_DAMAGE_BY_TIER);
 * the number of hits to break a tile is `ceil(maxHealth / damagePerHit)`, and each hit
 * spends this much fuel. So harder soil (more health → more hits) costs MORE fuel to drill,
 * not just more time, and a stronger drill (more damage/hit → fewer hits) cuts BOTH the fuel
 * and the time. Pinned so a topsoil tile (4 health) with the tier-1 drill (1 dmg/hit → 4
 * hits) costs 4 × 0.25 = 1.0 fuel — the same flat cost the early game had before the
 * health/damage model, so parity holds at the top.
 */
export const FUEL_PER_HIT = 0.25;
/** Low-fuel warning threshold (fraction of max). */
export const LOW_FUEL_FRACTION = 0.2;

// ---------------------------------------------------------------------------
// Hull (specs/character.md, specs/hazards.md)
// ---------------------------------------------------------------------------

/**
 * Gas-explosion hull damage SCALES WITH DEPTH (specs/hazards.md): a rockbed pocket is a
 * survivable tax, but a coreshell pocket near the Core is near-lethal on a starting hull —
 * so the deep bands demand hull *and* radiator tiers. The raw (pre-radiator) damage is
 *   max(GAS_BASE_DAMAGE, GAS_BASE_DAMAGE + GAS_DAMAGE_PER_METER * (depthM - GAS_BASE_DEPTH_M))
 * then reduced by the radiator's effectiveness (RADIATOR_EFFECTIVENESS). Anchored so gas is
 * ~20 where it first appears (rockbed top, 630 m) and ~120 at the Core (2500 m): the slope is
 * (120 − 20) / (2500 − 630) ≈ 0.0535 hull/m.
 */
export const GAS_BASE_DAMAGE = 20;
export const GAS_BASE_DEPTH_M = 630; // rockbed top (row 126 × 5 m), where gas first appears
export const GAS_DAMAGE_PER_METER = 0.0535;
/** Hull drained per second while in contact with lava, before the radiator reduces it. */
export const LAVA_DAMAGE_RATE = 32;
/** Low-hull warning threshold (fraction of max). */
export const LOW_HULL_FRACTION = 0.25;

/**
 * Fall impact: a landing above SAFE_FALL_SPEED deals impact damage scaled to the
 * excess speed. The threshold and scale are reference feel (specs/hazards.md gives the
 * rule, not exact numbers); tune in the sim.
 *
 * The safe threshold is pinned to a *drop height* (SAFE_FALL_TILES) rather than a bare
 * fraction of terminal, so short, ordinary drops — stepping off a ledge, dropping down a
 * shaft you already carved — never chip the hull (specs/hazards.md). A miner in free-fall
 * clears this many tiles before it lands hard enough to hurt; only genuinely long plunges
 * exceed it, and feathering the jetpack over the last couple of tiles keeps a deep drop
 * under the line. A full terminal-velocity slam costs ~18 hull on the starting hull —
 * meaningful but survivable, and a rounding error to an upgraded hull (specs/upgrades.md).
 */
export const SAFE_FALL_TILES = 3; // free drop height (tiles) before impact damage begins
export const SAFE_FALL_SPEED = Math.sqrt(2 * GRAVITY * SAFE_FALL_TILES * TILE_SIZE); // ~848 px/s @80px tile
export const FALL_IMPACT_SCALE = 0.12; // hull per (px/s) of excess speed — scaled with the 80px tile

// ---------------------------------------------------------------------------
// Fuel Depot pricing (specs/world.md, specs/flow.md, specs/character.md)
// ---------------------------------------------------------------------------
//
// Fuel and hull are NEVER free and never refill on their own: they are bought here with
// Credits, a running cost of every trip alongside upgrades and the rocket. Prices are
// kept modest so a sensible dig still nets Credits (drilling already costs fuel per hit —
// ~1 fuel for a topsoil tile at the tier-1 drill, more for harder bands, specs/character.md)
// while a reckless, fuel-guzzling, damage-taking run can cost more to
// recover than it earned.

/** Credits per unit of fuel bought at the Fuel Depot. */
export const FUEL_COST_PER_UNIT = 1;
/** Credits per point of hull repaired at the Fuel Depot. */
export const REPAIR_COST_PER_POINT = 2;
/** The fixed amount the depot's "+N" buttons add per click (fuel units / hull points). */
export const DEPOT_INCREMENT = 25;

// ---------------------------------------------------------------------------
// The unstable Core Sample (specs/hazards.md)
// ---------------------------------------------------------------------------

/** Destabilization countdown (seconds) that starts when the Core Sample is extracted. */
export const CORE_TIMER_SECONDS = 90;

/**
 * Lethal radius (tiles) of a JETTISONED Core Sample's ground detonation (specs/items.md).
 * A carried Sample that expires kills outright; a jettisoned one detonates at its ground
 * tile and kills only a miner whose center is within this radius — flee farther and survive.
 */
export const CORE_GROUND_BLAST_TILES = 3;

// ---------------------------------------------------------------------------
// Field supplies — the six single-use items (specs/items.md)
// ---------------------------------------------------------------------------
//
// Items are bought with Credits at the SUPPLY DEPOT building (the FOURTH Credits sink,
// alongside fuel/repair, upgrades, and the rocket — specs/flow.md, specs/world.md) and
// carried as a count per type; each use consumes one. Prices are pinned so that USING an
// item is an IMPACTFUL spend, not a throwaway (specs/items.md) — a single use costs a real
// slice of a good haul rather than pocket change. Against the economy (upgrade tiers
// 300–4100, ore values 28–1900, depot fuel 1 Cr/unit and hull 2 Cr/pt): the consumables run
// 300–8000, each well above the raw depot cost of the fuel/hull it saves you a trip for, and
// the premium GUARANTEED escape (Matter Transmitter 8000) sits far above the risky Quantum
// Teleporter (1500). All magnitudes below are fixed and match specs/items.md verbatim.

/** Dynamite clears a 3×3 block centered on the miner (blast radius 1 tile). */
export const DYNAMITE_RADIUS = 1;
/** Plastic Explosives clear a 5×5 block centered on the miner (blast radius 2 tiles). */
export const PLASTIC_RADIUS = 2;
/** Hull points Regenerative Nanobots repair per use (capped at max hull). */
export const NANOBOTS_HEAL = 20;
/** Fuel units Emergency Fuel refuels per use (capped at max fuel). */
export const EMERGENCY_FUEL_AMOUNT = 30;

/**
 * Quantum Teleporter drop: it warps the miner ABOVE the camp floor at a randomized height
 * (this many tiles) with a randomized DOWNWARD velocity, then lets normal physics carry it
 * down — so a good roll lands gently and a bad roll SLAMS into the floor at speed, and
 * normal fall-impact applies (specs/hazards.md), which can kill a low-hull miner. A drop of
 * ~1 tile lands under the safe-fall threshold (harmless); ~8 tiles reaches terminal and
 * costs the full fall-impact tax. The randomized velocity/height are a live player action,
 * not part of the deterministic proof, so Math.random is fine (specs/items.md).
 */
export const QUANTUM_DROP_MIN_TILES = 1;
export const QUANTUM_DROP_MAX_TILES = 8;
export const QUANTUM_VEL_MIN = 150;
export const QUANTUM_VEL_MAX = 700;

export interface ItemDef {
  readonly id: ItemId;
  /** The number-key hotkey (1..6) that uses this item during live in-mine play. */
  readonly hotkey: number;
  readonly label: string;
  /** Credits to buy one at the Supply Depot. */
  readonly price: number;
  /** One-line description shown in the shop / inventory (no strategy advice). */
  readonly blurb: string;
}

/** The six items in hotkey order (1..6) — the buy list and the use hotkeys both read this. */
export const ITEMS: readonly ItemDef[] = [
  { id: "dynamite", hotkey: 1, label: "Dynamite", price: 300, blurb: "Clears a 3×3 block — stone too. Sets off gas." },
  { id: "plastic-explosives", hotkey: 2, label: "Plastic Explosives", price: 1000, blurb: "Clears a 5×5 block — stone too. Sets off gas." },
  { id: "quantum-teleporter", hotkey: 3, label: "Quantum Teleporter", price: 1500, blurb: "Warp to the surface — but you drop in at speed." },
  { id: "matter-transmitter", hotkey: 4, label: "Matter Transmitter", price: 8000, blurb: "Warp safely to the surface — no impact." },
  { id: "nanobots", hotkey: 5, label: "Regen Nanobots", price: 4000, blurb: "Repair +20 hull (capped at max)." },
  { id: "emergency-fuel", hotkey: 6, label: "Emergency Fuel", price: 2000, blurb: "Refuel +30 fuel (capped at max)." },
];

/** Item defs keyed by id, for O(1) lookup at a buy/use site. */
export const ITEM_BY_ID: Record<ItemId, ItemDef> = ITEMS.reduce(
  (acc, def) => {
    acc[def.id] = def;
    return acc;
  },
  {} as Record<ItemId, ItemDef>,
);

// ---------------------------------------------------------------------------
// Ore (specs/mining.md)
// ---------------------------------------------------------------------------

/**
 * Ore veins never spawn in the first three dirt rows (rows 1..3) just below the surface
 * (specs/world.md): the shallow topsoil right under the cave mouth stays plain rock, so a
 * fresh expedition digs a little before the first payoff. Materials and hazards are already
 * absent this shallow; this rule is specifically about ore.
 */
export const ORE_FREE_TOP_ROWS = 3;

/**
 * The fraction of plain rock cells (in every band, at every depth) that generation turns into
 * an ore-bearing cell (specs/world.md). Placement is TWO-STAGE and this is the FIRST stage:
 * whether a cell is ore at all is one CONSTANT roll, independent of depth — so the share of a
 * band's tiles that hold ore is roughly the SAME everywhere, never spiking in one stratum. Only
 * the SECOND stage — WHICH ore (below) — varies with depth. Gems are folded into the second
 * stage (a rare-weight ore type), so this single density covers ore AND gems and the overall
 * ore-tile fraction stays flat (specs/mining.md, specs/world.md). Applied to rock cells left
 * after the stone/lava/gas rolls; the connectivity repair still guarantees a diggable route.
 */
export const ORE_DENSITY = 0.15;

export interface OreDef {
  readonly ore: Ore;
  /** Credits per unit when sold. */
  readonly value: number;
  /**
   * Weight per unit (kg) — the load the jetpack must lift (specs/character.md). Value rises
   * steeply with depth while weight rises only gently, so value-per-kg climbs with depth: a
   * shallow ore is barely worth hauling up, a deep one richly repays its weight. Cargo is
   * limited by SLOT COUNT, and weight is a separate lift concern (specs/mining.md).
   */
  readonly weightKg: number;
  /** Palette color the vein reads as. */
  readonly color: string;
  /**
   * True for a GEMSTONE (specs/mining.md) — a rarer, cut-crystal find rather than a mineral
   * ore. A gem is drawn as a faceted jewel (not the ore SMEAR), and is worth 3× and weighs 2×
   * the band's signature ore. Sold, slotted, and lifted exactly like ore otherwise; it is rare
   * purely because its curve peak (below) is small.
   */
  readonly gem?: boolean;
  // --- Depth-frequency curve (specs/mining.md, specs/world.md) -----------------------------
  //
  // WHICH ore a given ore-cell becomes is a weighted roll over every ore's frequency AT THAT
  // ROW. Each ore's frequency is a TRIANGULAR curve: zero above `firstRow` (a hard minimum
  // depth — a deep ore never appears shallow), rising linearly to `peakWeight` at `peakRow`
  // (the "common depth"), then falling linearly back to zero at `lastRow`. Because the curves
  // OVERLAP and are staggered, 4–5 ores are available in any band and the mix shifts smoothly
  // WITHIN a band (the bottom of a stratum rolls a different distribution than its top), while
  // the total ore DENSITY (above) stays constant. A shallow staple sets firstRow == peakRow so
  // it is common from the moment it appears and only tapers with depth.
  /** Shallowest row this ore can appear at — zero frequency above it (its MIN DEPTH). */
  readonly firstRow: number;
  /** Row of PEAK frequency (its COMMON DEPTH): the curve rises to here, then tapers. */
  readonly peakRow: number;
  /** Deepest row it still appears at — zero frequency below it. */
  readonly lastRow: number;
  /** Relative frequency at the peak (the height of this ore's curve in the type roll). */
  readonly peakWeight: number;
}

// Ten mineral ores (the Motherload lineup) plus three gemstones, staggered by depth so a band
// always offers 4–5 of them (their curves overlap) and the mix shifts as you descend. Value is
// pinned so the cheapest ore still buys a meaningful amount of fuel (Ferron 28 ≈ 28 fuel at
// 1 Cr/unit — a dig always nets a surplus, never a fuel-for-fuel treadmill) and climbs steeply
// with depth (28 → 1900, ~68×) while weight rises only gently, so value-per-kg rises with
// depth (2.8 → 41 kg⁻¹). The four band SIGNATURE ores the upgrade ladder is anchored to are
// unchanged — Cuprite 65, Argenite 150, Voltite 380, Pyronium 820 (specs/upgrades.md). The
// ceiling stays far below Motherload's (there is no boss run to fund). Rows: topsoil 1–125,
// rockbed 126–250, deepstone 251–375, coreshell 376–499 (specs/world.md).
export const ORES: Record<Ore, OreDef> = {
  // -- Topsoil / rockbed staples (cheap, common, taper out with depth) --
  ferron: {
    ore: "ferron",
    value: 28,
    weightKg: 10,
    color: PALETTE.ferron,
    firstRow: 4,
    peakRow: 4,
    lastRow: 200,
    peakWeight: 6.0,
  },
  marlite: {
    ore: "marlite",
    value: 46,
    weightKg: 12,
    color: PALETTE.marlite,
    firstRow: 4,
    peakRow: 40,
    lastRow: 210,
    peakWeight: 4.5,
  },
  cuprite: {
    ore: "cuprite",
    value: 65,
    weightKg: 12,
    color: PALETTE.cuprite,
    firstRow: 20,
    peakRow: 95,
    lastRow: 280,
    peakWeight: 4.0,
  },
  // -- Rockbed / deepstone mid-tier --
  argenite: {
    ore: "argenite",
    value: 150,
    weightKg: 16,
    color: PALETTE.argenite,
    // Reaches up into the lower topsoil as a rare, valuable target there, then peaks in the
    // rockbed (its home band, the tier-2 upgrade anchor — specs/upgrades.md).
    firstRow: 95,
    peakRow: 180,
    lastRow: 340,
    peakWeight: 4.0,
  },
  cobaltine: {
    ore: "cobaltine",
    value: 240,
    weightKg: 20,
    color: PALETTE.cobaltine,
    firstRow: 175,
    peakRow: 245,
    lastRow: 390,
    peakWeight: 3.5,
  },
  voltite: {
    ore: "voltite",
    value: 380,
    weightKg: 24,
    color: PALETTE.voltite,
    firstRow: 230,
    peakRow: 305,
    lastRow: 460,
    peakWeight: 3.5,
  },
  // -- Deepstone / coreshell rich-tier --
  halcite: {
    ore: "halcite",
    value: 560,
    weightKg: 28,
    color: PALETTE.halcite,
    firstRow: 295,
    peakRow: 360,
    lastRow: 500,
    peakWeight: 3.0,
  },
  pyronium: {
    ore: "pyronium",
    value: 820,
    weightKg: 34,
    color: PALETTE.pyronium,
    firstRow: 350,
    peakRow: 435,
    lastRow: 500,
    peakWeight: 3.0,
  },
  cindrite: {
    ore: "cindrite",
    value: 1250,
    weightKg: 40,
    color: PALETTE.cindrite,
    firstRow: 390,
    peakRow: 470,
    lastRow: 500,
    peakWeight: 2.5,
  },
  adamite: {
    ore: "adamite",
    value: 1900,
    weightKg: 46,
    color: PALETTE.adamite,
    // A rare glint deep down: a wide, deep curve with a deliberately LOW peak so it is only ever
    // an occasional find among the coreshell's richer ore (specs/mining.md).
    firstRow: 300,
    peakRow: 485,
    lastRow: 500,
    peakWeight: 0.8,
  },
  // Gemstones (specs/mining.md) — one per band below the topsoil (none in the first band; each
  // gem's firstRow is at or below its band's top). Each is worth 3× and weighs 2× that band's
  // SIGNATURE ore (rockbed Argenite 150/16, deepstone Voltite 380/24, coreshell Pyronium
  // 820/34), a rich but heavy prize. They are folded into the same type roll as ore but with a
  // tiny peakWeight, so a gem is a GENUINELY RARE find (well under 1 % of a band's tiles) and
  // the total ore density is unchanged. Drawn as a faceted cut jewel, not an ore smear.
  verdite: {
    ore: "verdite",
    value: 450, // 3 × Argenite (150)
    weightKg: 32, // 2 × Argenite (16)
    color: PALETTE.verdite,
    gem: true,
    firstRow: 126,
    peakRow: 200,
    lastRow: 375,
    peakWeight: 0.30,
  },
  roselite: {
    ore: "roselite",
    value: 1140, // 3 × Voltite (380)
    weightKg: 48, // 2 × Voltite (24)
    color: PALETTE.roselite,
    gem: true,
    firstRow: 251,
    peakRow: 320,
    lastRow: 500,
    peakWeight: 0.30,
  },
  aurite: {
    ore: "aurite",
    value: 2460, // 3 × Pyronium (820)
    weightKg: 68, // 2 × Pyronium (34)
    color: PALETTE.aurite,
    gem: true,
    firstRow: 376,
    peakRow: 470,
    lastRow: 500,
    peakWeight: 0.30,
  },
};

/**
 * The frequency of an ore at a given row from its triangular depth curve (specs/mining.md):
 * zero outside [firstRow, lastRow], rising linearly from firstRow to peakWeight at peakRow, then
 * falling linearly to zero at lastRow. A shallow staple with firstRow == peakRow reads as
 * "common from its first appearance, tapering with depth". This is the per-ore weight the WHICH-
 * ore roll sums over every ore at a cell's row (world.ts).
 */
export function oreWeightAtRow(def: OreDef, row: number): number {
  if (row < def.firstRow || row > def.lastRow) return 0;
  if (row <= def.peakRow) {
    if (def.peakRow <= def.firstRow) return def.peakWeight; // common from first appearance
    return (def.peakWeight * (row - def.firstRow)) / (def.peakRow - def.firstRow);
  }
  if (def.lastRow <= def.peakRow) return def.peakWeight;
  return (def.peakWeight * (def.lastRow - row)) / (def.lastRow - def.peakRow);
}

// ---------------------------------------------------------------------------
// Exotic materials (specs/mining.md)
// ---------------------------------------------------------------------------

/**
 * Number of each buried material node placed in its band — exactly ONE Resonite (rockbed)
 * and ONE Cryenite (deepstone), each at a random position within its band, always present
 * and always reachable (connectivity repair targets it). With a single node, the SCANNER
 * (specs/mining.md) becomes genuinely necessary to find it — that is the point.
 */
export const MATERIAL_NODES_PER_BAND = 1;

export interface MaterialDef {
  readonly material: Material;
  /** The band its node is buried in, or null for the Core Sample (Core chamber). */
  readonly band: Band | null;
  readonly color: string;
  /** Whether the scanner points to it (never points at the Core Sample). */
  readonly scannable: boolean;
}

export const MATERIALS: Record<Material, MaterialDef> = {
  resonite: {
    material: "resonite",
    band: "rockbed",
    color: PALETTE.resonite,
    scannable: true,
  },
  cryenite: {
    material: "cryenite",
    band: "deepstone",
    color: PALETTE.cryenite,
    scannable: true,
  },
  "core-sample": {
    material: "core-sample",
    band: null,
    color: PALETTE.coreSample,
    scannable: false,
  },
};

// ---------------------------------------------------------------------------
// Upgrade tracks (specs/upgrades.md)
// ---------------------------------------------------------------------------

/**
 * Each track has five tiers; the player starts at tier 1 and buys the next in order.
 * `prices[i]` is the cost to reach tier i+1 (prices[0] is 0 = the starting tier).
 */
export interface UpgradeTrackDef {
  readonly track: UpgradeTrack;
  /** Per-tier prices; index 0 is the free starting tier. */
  readonly prices: readonly number[];
}

// -------------------------------------------------------------------------------------
// Upgrade price ladder (specs/upgrades.md — "How the tracks pace the game")
// -------------------------------------------------------------------------------------
//
// Each purchasable tier is priced to roughly cost ~5 units of the SIGNATURE ore of the band
// you dig to fund it, so a tier ≈ a depth layer:
//   tier 1→2 ≈ 5 × Cuprite  (topsoil,   65)  ≈ 300
//   tier 2→3 ≈ 5 × Argenite (rockbed,   150) = 750
//   tier 3→4 ≈ 5 × Voltite  (deepstone, 380) = 1900
//   tier 4→5 ≈ 5 × Pyronium (coreshell, 820) = 4100
// All seven tracks share this ladder (near-uniform across tracks at a given tier is the most
// faithful reading of "~5 ores of that layer"). prices[0] = 0 is the free starting tier.
export const UPGRADE_PRICE_LADDER: readonly number[] = [0, 300, 750, 1900, 4100];

/** Fuel tank: sets max fuel. */
export const FUEL_TANK_MAX: readonly number[] = [100, 175, 275, 400, 550];
export const FUEL_TANK_PRICES: readonly number[] = UPGRADE_PRICE_LADDER;

/**
 * Drill: the tier RATING (1..5) shown in the shop as "power" — a plain tier indicator, NOT
 * the raw damage number (which is DRILL_DAMAGE_BY_TIER, deliberately a gentler curve so one
 * upgrade never trivializes the layer above it — specs/upgrades.md).
 */
export const DRILL_POWER: readonly number[] = [1, 2, 3, 4, 5];
export const DRILL_PRICES: readonly number[] = UPGRADE_PRICE_LADDER;
/**
 * Damage the drill deals PER HIT, indexed by drill tier 1..5 (specs/upgrades.md). A tile
 * breaks after `ceil(band.maxHealth / damagePerHit)` hits; hits land on the HIT_INTERVAL
 * cadence and each spends FUEL_PER_HIT. A higher tier deals more damage per hit → fewer hits
 * → both less time AND less fuel for a given band.
 *
 * The curve is deliberately SUB-DOUBLING through the middle tiers (was a flat 1/2/3/4/5). The
 * endpoints are pinned — tier 1 = `1` and tier 5 = `5` — so every band's tier-1 and tier-5
 * hits/time/fuel are unchanged (topsoil·T1 = 1.0 fuel, coreshell·T1 = 4.0, coreshell·T5 = 1.0
 * all hold). Only the intermediate steps are softened so that buying ONE drill tier no longer
 * halves the band above it: a fresh miner's second drill takes topsoil from 4 hits to 3 (not
 * 2), and a layer only becomes near-trivial two tiers past the one it is matched to — the feel
 * the playtest asked for (specs/upgrades.md). Fractional damage is fine; health is a float and
 * hits round up.
 */
export const DRILL_DAMAGE_BY_TIER: readonly number[] = [1, 1.5, 2.5, 3.5, 5];
/**
 * Seconds between drill hits. Pinned so a tier-1 drill on a topsoil tile (4 health, 1
 * dmg/hit → 4 hits) breaks it in 4 × 0.125 = 0.5 s — the tier-1/topsoil feel of the old
 * fixed drill time. Everything else derives: e.g. a tier-1 coreshell tile (16 health) is 16
 * hits → 2.0 s and 4.0 fuel; a tier-5 coreshell tile (4 hits) is 0.5 s and 1.0 fuel.
 */
export const HIT_INTERVAL = 0.125;

/**
 * Cargo bay: sets capacity as a NUMBER OF ORE SLOTS the bay holds — one unit of any ore
 * fills one slot, regardless of its weight (the Motherload cargo model, specs/mining.md).
 * Weight is a SEPARATE mechanic: each ore's `weightKg` is the load the jetpack must lift
 * (specs/character.md), so a bay can be full by slot count while still light, or heavy with
 * far fewer pieces — the two limits (slots to pick up, weight to fly out) pull against each
 * other exactly as in Motherload. Slot counts follow Motherload's holds (15/25/40/70/120).
 */
export const CARGO_CAPACITY: readonly number[] = [15, 25, 40, 70, 120];
export const CARGO_PRICES: readonly number[] = UPGRADE_PRICE_LADDER;

/** Hull: sets max hull. */
export const HULL_MAX: readonly number[] = [100, 150, 220, 320, 450];
export const HULL_PRICES: readonly number[] = UPGRADE_PRICE_LADDER;

/** Scanner: sets range in tiles. */
export const SCANNER_RANGE: readonly number[] = [6, 12, 20, 32, 48];
export const SCANNER_PRICES: readonly number[] = UPGRADE_PRICE_LADDER;

/**
 * Jetpack (the engine track): sets both the lift FORCE and the EMPTY-load climb SPEED CAP
 * (specs/upgrades.md, specs/character.md). JETPACK_LIFT is the upward acceleration the
 * jetpack achieves at the miner's base mass (MINER_BASE_MASS); loaded, the achieved
 * acceleration is JETPACK_LIFT * MINER_BASE_MASS / totalMass, so a heavier haul climbs
 * slower and, past a point, cannot climb at all.
 *
 * The heaviest cargo a tier can still lift (thrust accel > gravity) is
 *   JETPACK_LIFT * MINER_BASE_MASS / GRAVITY - MINER_BASE_MASS
 * ≈ 256 / 378 / 533 / 733 / 956 kg for tiers 1..5 (unchanged). Cargo is capped by SLOT
 * COUNT, not weight (CARGO_CAPACITY, above), so this liftable-mass ceiling is what actually
 * gates a heavy haul: fill the bay with light shallow ore and the whole load lifts easily,
 * but a bay part-filled with heavy deep ore can exceed the jetpack's lift — at which point
 * the miner must drop ore from the inventory (specs/mining.md) or upgrade the jetpack.
 */
export const JETPACK_LIFT: readonly number[] = [3417, 4333, 5500, 7000, 8667];
/**
 * JETPACK_CLIMB is the climb-speed cap when EMPTY. The EFFECTIVE cap falls with the load
 * (game.ts `climbCap()` scales it by how far the thrust accel still beats gravity): an empty
 * miner reaches the full cap and cruises (so it burns the eased CRUISE fuel rate, above), a
 * heavy haul is throttled to a low climb speed and never reaches the cruise-efficiency band,
 * so it stays slow AND fuel-hungry — the cost of a climb tracks the weight. The caps rise
 * gently across tiers (a better jetpack climbs a little faster) but stay comfortably below the
 * fall terminal (1000) so a climb never feels as fast as a plunge. They were raised (was
 * 420→540) because the bands are DEEP — a full 125-row band is 10000 px — so at the old caps a
 * climb out of even the first band ate the whole tank and crawled; a matched engine must be
 * able to dive to its band, mine, and lift an ~80%-weight haul back out (specs/upgrades.md).
 */
export const JETPACK_CLIMB: readonly number[] = [700, 760, 820, 880, 940];
export const JETPACK_PRICES: readonly number[] = UPGRADE_PRICE_LADDER;
/**
 * How steeply the effective climb cap falls with the load (game.ts `climbCap()`): the cap is
 * `emptyCap * (1 − FALLOFF * loadFraction)`, where loadFraction is the cargo weight over the
 * tier's heaviest liftable cargo. At 0.30 a full-limit haul (loadFraction 1) is throttled to
 * 70% of the empty cap — gentle enough that an ~80%-weight haul (the design target) still
 * climbs at a workable speed and lifts out on a sensible fuel budget, so weight ramps the cost
 * of a climb smoothly rather than stranding a loaded miner deep (specs/character.md).
 */
export const JETPACK_LOAD_CAP_FALLOFF = 0.3;

/**
 * Radiator: reduces gas-explosion and lava-contact damage by its effectiveness fraction
 * (specs/upgrades.md, specs/hazards.md). Tier 1 is the bare stock plating (no reduction);
 * the deep bands' depth-scaled gas and dense lava make an upgraded radiator essential for
 * the core run. Effectiveness never reaches 100% — the deep is always dangerous.
 */
export const RADIATOR_EFFECTIVENESS: readonly number[] = [0, 0.25, 0.45, 0.65, 0.8];
export const RADIATOR_PRICES: readonly number[] = UPGRADE_PRICE_LADDER;

/** Number of tiers per track. */
export const MAX_TIER = 5;

/** Grouped view of the seven tracks for shop iteration. */
export const UPGRADE_TRACKS: Record<
  UpgradeTrack,
  {
    readonly prices: readonly number[];
    readonly values: readonly number[];
    readonly label: string;
    readonly unit: string;
  }
> = {
  fuel: {
    prices: FUEL_TANK_PRICES,
    values: FUEL_TANK_MAX,
    label: "Fuel Tank",
    unit: "max fuel",
  },
  drill: {
    prices: DRILL_PRICES,
    values: DRILL_POWER,
    label: "Drill",
    unit: "power",
  },
  cargo: {
    prices: CARGO_PRICES,
    values: CARGO_CAPACITY,
    label: "Cargo Bay",
    unit: "ore slots",
  },
  hull: {
    prices: HULL_PRICES,
    values: HULL_MAX,
    label: "Hull",
    unit: "max hull",
  },
  jetpack: {
    prices: JETPACK_PRICES,
    values: JETPACK_CLIMB,
    label: "Jetpack",
    unit: "lift",
  },
  radiator: {
    prices: RADIATOR_PRICES,
    values: RADIATOR_EFFECTIVENESS,
    label: "Radiator",
    unit: "dmg cut",
  },
  scanner: {
    prices: SCANNER_PRICES,
    values: SCANNER_RANGE,
    label: "Scanner",
    unit: "tiles range",
  },
};

// ---------------------------------------------------------------------------
// The escape rocket (specs/rocket.md)
// ---------------------------------------------------------------------------

export interface RocketComponentDef {
  readonly id: RocketComponentId;
  /** Build order 1..5. */
  readonly order: number;
  readonly label: string;
  readonly credits: number;
  /** Exotic material consumed on fabrication, if any. */
  readonly material: Material | null;
}

export const ROCKET_COMPONENTS: readonly RocketComponentDef[] = [
  { id: "hull-frame", order: 1, label: "Hull Frame", credits: 800, material: null },
  { id: "fuel-cells", order: 2, label: "Fuel Cells", credits: 1500, material: null },
  {
    id: "guidance",
    order: 3,
    label: "Guidance Unit",
    credits: 600,
    material: "resonite",
  },
  {
    id: "thruster",
    order: 4,
    label: "Thruster Assembly",
    credits: 1200,
    material: "cryenite",
  },
  {
    id: "ignition",
    order: 5,
    label: "Ignition Core",
    credits: 1000,
    material: "core-sample",
  },
];

/** Total Credits across all five components (specs/rocket.md). */
export const ROCKET_TOTAL_CREDITS = ROCKET_COMPONENTS.reduce(
  (sum, c) => sum + c.credits,
  0,
); // 5100

// ---------------------------------------------------------------------------
// Camera vertical lead (specs/world.md)
// ---------------------------------------------------------------------------
//
// The camera does NOT keep the miner dead-centre vertically: it LEADS the miner's motion,
// letting it sit off-centre toward the side it is coming FROM so more of the space it is
// heading INTO is visible (specs/world.md). The lead is driven by HOW LONG the miner has been
// moving in a direction, NOT by its speed: sustained travel builds the lead up gradually toward
// its full reach at a fixed rate, no matter whether the miner is drifting or plunging. A brief
// hop barely leads; a long sustained fall or climb walks the miner all the way out toward the
// edge. When the miner is essentially still — at rest, or boring straight down (braced, so its
// velocity is ~0) — the lead decays back toward CENTRE, so a slow, static motion never jerks the
// view. Descending it rides UP (the bottom of a shaft shows earlier); climbing it rides DOWN;
// at rest it re-centres. Because the reach is time-gated (not speed-gated) and ramped over a
// couple of seconds, the follow stays smooth and never lurches on a sudden change of speed.

/** How far (fraction of the mine viewport height) the miner shifts from centre at FULL lead:
 *  0.335 → a fully-built lead rides the miner to ~16.5 % from the leading edge (0.5 − 0.335),
 *  which places the miner's leading edge about **one character height** (MINER_H) from the edge
 *  of the screen — the deliberate cap the player should be able to reach after moving in one
 *  direction long enough. A climb rides it symmetrically toward the opposite edge. Much farther
 *  than the reach the old speed-gated response actually delivered in practice, but the slow,
 *  time-ramped build (below) keeps the extra range from ever reading as jerky (specs/world.md). */
export const CAMERA_LEAD_FRACTION = 0.335;
/** Seconds of sustained motion in one direction to ramp the lead from centre to its FULL
 *  CAMERA_LEAD_FRACTION reach. The lead grows at a fixed rate (1 / this) regardless of how fast
 *  the miner is moving — a long fall and a slow drift build the same lead over the same time —
 *  so a genuine sustained plunge is what walks the miner out to the edge, and the ramp is gentle
 *  enough that the camera never snaps (specs/world.md). */
export const CAMERA_LEAD_RAMP_TIME = 2.0;
/** Seconds to decay the lead back to centre once the miner is no longer moving (landed, braced,
 *  or drilling straight down). A touch quicker than the ramp so the view re-centres promptly
 *  after motion stops without snapping. */
export const CAMERA_LEAD_RELEASE_TIME = 1.1;
/** Seconds to unwind a full wrong-way lead when the miner REVERSES (e.g. jetpacking up, then
 *  releasing and falling): while the accumulated lead is still on the side the miner just left,
 *  it swings back toward centre at this faster rate so the view doesn't lag behind the reversal.
 *  Once it crosses centre and starts building a lead in the NEW direction, it falls back to the
 *  slow CAMERA_LEAD_RAMP_TIME — so a reversal snaps the miner back toward centre quickly, then
 *  eases out into the new lead (specs/world.md). */
export const CAMERA_LEAD_REVERSE_TIME = 0.6;
/** Vertical speed (px/s) below which the miner counts as "not moving" for the lead: drift and
 *  the braced ~0 velocity of a straight-down drill fall under this, so they let the lead decay
 *  to centre rather than build it. */
export const CAMERA_LEAD_MIN_SPEED = 45;
/** Per-second rate the camera eases toward its target each frame (the lerp factor is
 *  k = min(1, this * dt)). A first-order follow like this LAGS a moving target: while the miner
 *  falls at vy the RENDERED miner trails its lead target by vy·dt·(1−k)/k pixels (~a tile at
 *  speed), which would drag it back down-screen and eat most of the vertical lead. updateCamera
 *  cancels that with a matching feed-forward on the vertical target, so the miner reaches the
 *  CAMERA_LEAD_FRACTION cap during a sustained fall/climb at any frame rate (specs/world.md). */
export const CAMERA_FOLLOW_RATE = 9;

// ---------------------------------------------------------------------------
// Screen shake (specs/hazards.md, specs/assets.md)
// ---------------------------------------------------------------------------
//
// A short camera shake punches up the violent moments — chiefly a gas detonation, but also
// an explosives blast, a hard landing, and the Core Sample's lethal detonation. Purely a
// render-space offset of the whole mine (miner, tiles, VFX shake together); it never touches
// the deterministic simulation, so it is safe to drive from a live event.

/** Peak shake amplitude (px) and duration (s) of a gas-pocket detonation. */
export const SHAKE_GAS_AMP = 11;
export const SHAKE_GAS_TIME = 0.36;
/** A hard landing shakes in proportion to the impact (amplitude per px/s of excess speed). */
export const SHAKE_IMPACT_PER_SPEED = 0.03;

// ---------------------------------------------------------------------------
// First-time hazard tips (specs/hazards.md, specs/flow.md)
// ---------------------------------------------------------------------------

/** How long (s) a first-time hazard tip lingers before it auto-fades if not dismissed. It is
 *  a NON-blocking card (the mine keeps running behind it) so it can never stall a run. */
export const TIP_LIFE = 12;

// ---------------------------------------------------------------------------
// Simulation (specs/controls.md)
// ---------------------------------------------------------------------------

/** Fixed logic tick rate (Hz) — deterministic, framerate-independent. */
export const TICK_HZ = 60;
export const TICK_DT = 1 / TICK_HZ;
