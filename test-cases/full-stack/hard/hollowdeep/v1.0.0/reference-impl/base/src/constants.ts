// Hollowdeep — fixed constants: the stage geometry, palette, and EVERY tuning number
// the specs pin (DESIGN §5), plus the tile-property predicates every system reads. This
// is the single source of the numbers, so the simulation and the balance harness read
// exactly what the specs say (specs/gas.md, specs/power.md, specs/delvers.md,
// specs/economy.md, specs/world.md, specs/overview.md). Where a number here and a spec
// disagree, the spec wins and this file is corrected.

import type { TileKind, BuildKind } from "./types";

// ---- Stage / view geometry (specs/overview.md, specs/world.md) ------------------
export const STAGE_W = 1280;
export const STAGE_H = 720;

export const TOP_HUD_H = 64; // top vitals strip: y in [0, 64], full width
export const BOTTOM_HUD_Y = 656; // bottom strip: y in [656, 720]
// Colony view (the camera onto the world): y in [64, 656], full width (1280 x 592).
export const VIEW_X0 = 0;
export const VIEW_Y0 = TOP_HUD_H;
export const VIEW_W = STAGE_W;
export const VIEW_H = BOTTOM_HUD_Y - TOP_HUD_H;

// ---- World grid (specs/world.md) ------------------------------------------------
export const TILE = 24; // logical px per tile
export const WORLD_W = 64; // columns
export const WORLD_H = 44; // rows → world px 1536 x 1056 (larger than the view → camera)
export const WORLD_PX_W = WORLD_W * TILE;
export const WORLD_PX_H = WORLD_H * TILE;

// ---- Camera zoom (specs/world.md, specs/controls.md) ----------------------------
export const ZOOM_DEFAULT = 1.4;
export const ZOOM_MIN = 1.0;
export const ZOOM_MAX = 2.2;

// ---- Time (specs/controls.md, specs/flow.md) ------------------------------------
export const FIXED_STEP = 1 / 20; // 20 Hz fixed tick; render interpolates delver px/py
export const SPEEDS = [1, 2, 3] as const; // speed multipliers; pause halts ticks
export const CYCLE_SECONDS = 30; // sim-seconds per cycle (the colony "day")

// ---- Palette (specs/overview.md) — exact hex -----------------------------------
export const COL = {
  void: "#12100c", // deep rock / background
  dirt: "#4a3524",
  oreVein: "#d9a441", // ore vein in ore tiles
  rock: "#2b2620", // rock / bedrock
  open: "#191410", // dug space backing
  built: "#566073", // built structure (walls, floors)
  ladderWire: "#c9862f", // ladder / wire
  oxygen: "#47e0c8", // breathable air
  co2: "#b6c24a", // waste gas
  power: "#ffcb52", // power / energy
  food: "#7cd45a", // food / fungus
  suit: "#e08a3c", // delver suit
  alert: "#ff5a52", // alert / danger
  panel: "#1b1712", // panels / overlays
  text: "#ece6db", // primary text
  text2: "#a89e8d", // secondary text
  text3: "#6b6355", // tertiary text / hints
} as const;

export const FONT = `"SF Mono", "JetBrains Mono", "Fira Mono", "DejaVu Sans Mono", "Menlo", "Consolas", monospace`;

// ---- Gas (specs/gas.md) ---------------------------------------------------------
export const GAS_CAPACITY = 100; // per-tile soft cap, each gas
export const START_OXYGEN = 82; // oxygen in each cavern open tile at start
export const START_CO2 = 3; // trace CO2 at start
export const DIFFUSE_FRACTION = 0.12; // fraction of an edge difference moved per tick
export const BUOYANCY = 0.05; // extra vertical bias: CO2 down, oxygen up (gentle)
export const O2_BREATHE_MIN = 22; // below this oxygen → cannot breathe
export const CO2_TOXIC_MAX = 55; // above this CO2 → cannot breathe
export const DELVER_O2_RATE = 1.4; // /s oxygen a delver consumes from its tile
export const DELVER_CO2_RATE = 1.1; // /s CO2 a delver exhales into its tile
export const DIFFUSER_O2_OUT = 16; // /s oxygen a running diffuser adds (tile + open 4-neighbors, split)
export const PUMP_RATE = 22; // /s gas a running pump moves intake→output tile

// ---- Power (specs/power.md) -----------------------------------------------------
export const GEN_SUPPLY = 20; // W — a fueled, running generator's output
export const GEN_FUEL_BURN_TIME = 12; // seconds to burn one ore-unit of fuel (1 ore / 12 s)
export const GEN_FUEL_MAX = 6; // ore-units the generator buffers
export const DIFFUSER_DEMAND = 12; // W
export const PUMP_DEMAND = 6; // W (one 20 W generator runs a diffuser+pump; a 2nd machine browns out)

// ---- Delvers (specs/delvers.md) -------------------------------------------------
export const DELVER_COUNT = 3; // starting crew
export const HEALTH_MAX = 100;
export const SUFFOCATE_DMG = 9; // /s health lost while unbreathable
export const O2_RECOVER = 6; // /s health regained in breathable air
export const STAMINA_MAX = 100;
export const WORK_DRAIN = 3.5; // /s stamina lost while working
export const REST_RECOVER = 14; // /s stamina regained while resting
export const REST_BELOW = 15; // rest when stamina < 15
export const REST_UNTIL = 75; // …until stamina >= 75
export const HUNGER_MAX = 100; // MAX = starving
export const HUNGER_RATE = 0.85; // /s (~65 in ≈2.5 cycles, MAX in ≈4 cycles)
export const EAT_ABOVE = 65; // eat when hunger > 65 and food in stock (consumes 1 food, resets hunger)
export const STARVE_DMG = 4; // /s health lost while hunger = MAX and no food
export const WALK_SPEED = 2.4; // tiles/s
export const CLIMB_SPEED = 1.8; // tiles/s (vertical on ladders)

// ---- Economy & digging (specs/economy.md, specs/world.md) ----------------------
// Dig time by solid-natural tile kind (bedrock cannot be dug). specs/world.md.
export const DIG_TIME: Record<"dirt" | "ore" | "rock", number> = {
  dirt: 1.5,
  ore: 3.0,
  rock: 6.0,
};
// Ore yielded when a tile is mined (dirt/rock yield none; an ore tile yields its oreRich).
export const DIG_YIELD_ORE: Record<"dirt" | "ore" | "rock", number> = {
  dirt: 0,
  ore: 1,
  rock: 0,
};

export const REFINE_ORE_PER_MATERIAL = 2; // 2 ore → 1 material
export const REFINE_TIME = 4; // s — operated refinery job
export const BUILD_TIME = 2.5; // s per placed order

// Material cost to build each order (specs/economy.md). A ghost waits if unaffordable;
// no partial refund (stated in README).
export const BUILD_COST: Record<BuildKind, number> = {
  wall: 2,
  floor: 1,
  ladder: 1,
  wire: 1,
  generator: 8,
  diffuser: 10,
  pump: 8,
  refinery: 6,
  farm: 5,
};

export const FARM_GROW_TIME = 22; // s to ripen a fungus farm
export const HARVEST_YIELD = 3; // food per harvest; the plot resets to grow again

// ---- Tile-property predicates (specs/world.md, specs/gas.md) -------------------
// A natural solid tile (must be dug to open). world.md "Solid (natural) tiles".
export function isSolid(k: TileKind): boolean {
  return k === "dirt" || k === "ore" || k === "rock" || k === "bedrock";
}

// Blocks gas AND blocks movement: solid natural tiles and built walls (gas.md, world.md).
export function blocksGas(k: TileKind): boolean {
  return isSolid(k) || k === "wall";
}

// Holds gas — open space and every built tile that isn't a wall (open machine tiles,
// floors, ladders, wires all pass air). gas.md.
export function isOpenToGas(k: TileKind): boolean {
  return !blocksGas(k);
}

// Provides footing to stand ON: a delver stands on a solid tile, a wall, or a floor, and
// a ladder tile is itself standable/climbable (specs/delvers.md, specs/world.md).
export function isWalkSurface(k: TileKind): boolean {
  return isSolid(k) || k === "wall" || k === "floor" || k === "ladder";
}

// A solid natural tile the player can queue to dig — bedrock is indestructible (world.md).
export function canDig(k: TileKind): boolean {
  return k === "dirt" || k === "ore" || k === "rock";
}

// A player-placed / delver-constructed tile (the "built" group: structure + machines).
export function isBuilt(k: TileKind): boolean {
  return (
    k === "wall" ||
    k === "floor" ||
    k === "ladder" ||
    k === "wire" ||
    k === "generator" ||
    k === "diffuser" ||
    k === "pump" ||
    k === "refinery" ||
    k === "farm"
  );
}

// A machine/farm tile (built, occupies a tile, driven by power.ts/economy.ts).
export function isMachine(k: TileKind): boolean {
  return k === "generator" || k === "diffuser" || k === "pump" || k === "refinery" || k === "farm";
}
