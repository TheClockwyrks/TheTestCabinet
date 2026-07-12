// Junction — fixed constants: the stage, palette, tile grid, camera, clock, the zone /
// tier / development tables, transit, utilities, economy, pollution / land / RCI tuning,
// and the milestones (DESIGN §3). Every number the specs pin lives here so the simulation
// reads exactly as written (specs/map.md, specs/transit.md, specs/utilities.md,
// specs/economy.md, specs/flow.md); the values the spec leaves to us are fixed here and
// restated in the README. The balance harness (`sim/`) reuses these directly, so a tuning
// change is a one-line edit here re-checked by re-running the harness — mirrors valence.

import type { Tool, ZoneKind, Terrain } from "./types";

// ---- Stage, grid, camera (specs/overview.md, specs/map.md, specs/controls.md) --
export const STAGE_W = 1280;
export const STAGE_H = 720;

export const TOP_H = 64; // top HUD strip: y in [0, 64], full width
export const BOT_H = 64; // bottom HUD strip: y in [656, 720], full width
export const VIEW_Y0 = 64; // city view band top
export const VIEW_Y1 = 656; // city view band bottom

export const TILE = 24; // logical px per tile at 1× zoom
export const MAP_COLS = 96;
export const MAP_ROWS = 72;
export const MAP_W = MAP_COLS * TILE; // 2304 world px — larger than the view
export const MAP_H = MAP_ROWS * TILE; // 1728 world px
export const TILE_COUNT = MAP_COLS * MAP_ROWS;

export const ZOOM_MIN = 16; // on-screen px per tile (mouse-wheel zoom)
export const ZOOM_DEF = 24;
export const ZOOM_MAX = 34;
export const PAN_SPEED = 640; // world px/s for keyboard pan
export const EDGE_MARGIN = 24; // edge-scroll band (screen px)

// ---- Simulation & clock (specs/controls.md, specs/flow.md) ---------------------
export const TICK_HZ = 6; // fixed sim ticks/sec
export const FIXED_STEP = 1 / TICK_HZ; // seconds per tick (render interpolates between)
export const TICKS_PER_MONTH = 24; // ⇒ 4 s/month at 1× — the budget period beat
export const SPEEDS = [1, 2, 3] as const; // normal / fast / faster tick multipliers
export const START_MONTH = { month: 0, year: 2027 } as const; // HUD clock; renders `MMM YYYY`
export const MONTH_NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// ---- Palette & font (specs/overview.md) ----------------------------------------
export const COL = {
  bg: "#12161c",
  earth: "#2a2f26",
  grass: "#33502f",
  water: "#245a73",
  hill: "#3a3630",
  res: "#4caf6d",
  com: "#4a90d9",
  ind: "#e0a63c",
  road: "#3c434d",
  rail: "#b061e6",
  station: "#ece6db",
  power: "#ffcb52",
  pipe: "#47c8e0",
  congest: "#ff7a3c",
  pollution: "#8a7d5a",
  money: "#7cd45a",
  alert: "#ff5a52",
  panel: "#161b22",
  text: "#e6ebf0",
  text2: "#9aa4af",
  text3: "#5b6570",
} as const;

export const FONT = `"SF Mono", "JetBrains Mono", "DejaVu Sans Mono", Menlo, Consolas, monospace`;

// Per-zone accent colour (RCI meters, empty-lot hatch, palette buttons).
export const ZONE_COLOR: Record<ZoneKind, string> = {
  res: COL.res,
  com: COL.com,
  ind: COL.ind,
};

// ---- Typed-array encodings -----------------------------------------------------
// The dense tile arrays store enums as small integers. `terrain` stores TERRAIN_ORDER
// index; `zone` stores 0 = none else ZONE_ORDER index + 1 (DESIGN §2.2).
export const TERRAIN_ORDER: Terrain[] = ["earth", "grass", "water", "hill"];
export const ZONE_ORDER: ZoneKind[] = ["res", "com", "ind"];

// `net` is a per-tile bitmask of the carriers occupying the tile (DESIGN §2.2). A SPAN bit
// marks a bridge/tunnel tile carried over water/hill (priced up); the STATION bit rides on
// a rail tile.
export const NET_ROAD = 1 << 0;
export const NET_RAIL = 1 << 1;
export const NET_WIRE = 1 << 2;
export const NET_PIPE = 1 << 3;
export const NET_STATION = 1 << 4;
export const NET_SPAN = 1 << 5;

// ---- Zones, tiers, development (specs/map.md, specs/economy.md) -----------------
// Per-tier tables indexed by tier 1..3 (index 0 = empty lot, unused padding).
export const POP: Record<ZoneKind, number[]> = {
  res: [0, 10, 30, 75],
  com: [0, 0, 0, 0],
  ind: [0, 0, 0, 0],
};
export const JOBS: Record<ZoneKind, number[]> = {
  res: [0, 0, 0, 0],
  com: [0, 8, 24, 55],
  ind: [0, 12, 32, 80],
};
export const SHOP_CAP: Record<ZoneKind, number[]> = {
  res: [0, 0, 0, 0],
  com: [0, 12, 34, 78],
  ind: [0, 0, 0, 0],
};
// Power = water demand units per tier.
export const UTIL_DEMAND: Record<ZoneKind, number[]> = {
  res: [0, 1, 3, 6],
  com: [0, 1, 3, 6],
  ind: [0, 2, 5, 10],
};
// Pollution emitted per tick by an industry tile of each tier (res/com emit none).
export const POLL_EMIT: Record<ZoneKind, number[]> = {
  res: [0, 0, 0, 0],
  com: [0, 0, 0, 0],
  ind: [0, 0.4, 0.9, 1.6],
};

// Development gates & pace (specs/map.md).
export const WALK_TILES = 3; // road-access reach (tiles from the road network)
export const BUILD_TICKS = 18; // ≈3 s construction; plays the construction sheet + a dust puff
export const UPGRADE_TICKS = 48; // ticks the tier-up conditions must hold before growing
export const DECAY_RATE = 1 / 36; // dilapidation accrued per tick while a precondition is lost
// Land value needed to reach a tier (index = TARGET tier). Tier 1 has no land floor; a tile
// only tiers up to 2 with land ≥ 0.50 and to 3 with land ≥ 0.72, sustained UPGRADE_TICKS.
export const LAND_TIER = [0, 0, 0.5, 0.72];

// ---- Transit (specs/transit.md) ------------------------------------------------
export const ROAD_CAP = 14; // trips/tick a road tile carries at full speed
export const RAIL_CAP = 70; // rail segment capacity (high — offloads roads)
export const CONGEST_K = 1.5; // travel-time mult = 1 + K·max(0, load/cap − 1)
export const COMMUTE_FRAC = 0.6; // share of a res tile's pop that makes a work/shop trip
export const RAIL_SPEED_MULT = 2.0; // a station-to-station leg is this much faster than road
export const VEHICLE_CAP_ON_SCREEN = 220; // render budget — sample vehicles to draw

// ---- Utilities (specs/utilities.md) --------------------------------------------
export const POWER_PLANT_CAP = 150; // supply units per power plant
export const WATER_SOURCE_CAP = 150; // supply units per water source

// ---- Economy: costs, upkeep, budget (specs/economy.md) -------------------------
// Capital cost ($) charged when a tile/structure is placed, keyed by tool.
export const COST: Record<Tool, number> = {
  zoneRes: 10,
  zoneCom: 10,
  zoneInd: 10,
  road: 12,
  rail: 30,
  station: 200,
  wire: 6,
  pipe: 6,
  plant: 700,
  source: 450,
  bulldoze: 4,
};
// Monthly upkeep ($/month) charged per placed tile/structure, keyed by tool.
export const UPKEEP: Record<Tool, number> = {
  zoneRes: 0,
  zoneCom: 0,
  zoneInd: 0,
  road: 2,
  rail: 4,
  station: 12,
  wire: 1,
  pipe: 1,
  plant: 30,
  source: 22,
  bulldoze: 0,
};
// A carrier laid over water/hill is a SPAN (bridge/tunnel): +capital, +upkeep on that tile.
export const SPAN_COST_EXTRA = 48; // road span = 12 + 48 = 60 capital (specs/economy.md)
export const SPAN_UPKEEP_EXTRA = 4; // road span = 2 + 4 = 6 upkeep

export const BULLDOZE_REFUND = 0.4; // fraction of a razed tile's capital refunded
export const ZONE_COST = COST.zoneRes; // $/tile to zone (README-stated tunable)

// Budget (specs/economy.md, specs/flow.md).
export const START_TREASURY = 30000;
export const DEBT_LIMIT = -20000; // treasury floor before insolvency is possible
export const TAX_DEFAULT = 0.09;
export const TAX_MIN = 0;
export const TAX_MAX = 0.2;
export const TAX_STEP = 0.01;
export const TAX_CAPITA = 1.8; // $/occupant·land·taxRate of monthly income (sim-tuned)

// ---- Pollution, land value, RCI demand (specs/economy.md) ----------------------
// Pollution field.
export const POLL_CONGEST = 0.15; // pollution a congested road adds per unit of over-capacity
export const POLL_DIFFUSE = 0.12; // share diffused to each 4-neighbour per tick
export const POLL_DECAY = 0.04; // share decayed away per tick
export const POLL_MAX = 100;

// Land value (per tile, 0..1, recomputed each tick).
export const LAND_BASE = 0.35;
export const LAND_AMENITY_MAX = 0.3; // water/park bonus ceiling
export const LAND_AMENITY_RADIUS = 4; // tiles
export const LAND_SERVICE = 0.15; // powered + watered + access
export const LAND_STATION = 0.1; // near a station
export const LAND_STATION_RADIUS = 4; // tiles
export const LAND_POLL_K = 0.6; // −K·(pollution/100)
export const LAND_CONGEST_MAX = 0.25; // up to this much off for adjacent congestion

// RCI demand (−100..+100), eased toward monthly targets. Coefficients are the sim's
// starting point (validated by `sim/`, DESIGN §7); the LOOP is what the spec pins — jobs
// pull R, people pull C/I, oversupply pushes a demand negative — and growth is capped by
// service, not by these numbers.
export const RCI = {
  ease: 0.25, // fraction of the gap to the target closed each month
  clamp: 100, // |demand| ceiling
  taxPen: 220, // TAX_PEN — a higher tax rate suppresses all three demands
  // Residential: open jobs pull, vacant housing pushes.
  r: { jobPull: 1.3, vacancyPen: 1.0 },
  // Commercial: unmet shopping need + goods from industry pull, oversupply pushes.
  c: { shopPull: 1.1, goodsPull: 0.7, oversupply: 1.0 },
  // Industrial: commercial goods pull + available workforce pull, oversupply pushes.
  i: { comPull: 1.0, workforcePull: 0.8, oversupply: 1.0 },
} as const;

// ---- Milestones (specs/flow.md) ------------------------------------------------
// Each fires once → a Notification + the fireworks one-shot + the chime cue.
export const POP_MILESTONES = [500, 2000, 5000, 10000];
export const MILESTONES: { id: string; label: string }[] = [
  { id: "first-rail", label: "FIRST RAIL LINE" },
  { id: "pop-500", label: "POPULATION 500" },
  { id: "pop-2000", label: "POPULATION 2,000" },
  { id: "pop-5000", label: "POPULATION 5,000" },
  { id: "pop-10000", label: "POPULATION 10,000" },
  { id: "first-tier3", label: "FIRST HIGH-RISE" },
  { id: "first-district", label: "FIRST FULLY-SERVED DISTRICT" },
];

// ---- Tool catalog / palette metadata (DESIGN §4, §5.1) -------------------------
// Order matches the bottom-strip build palette (specs/overview.md gameplay mockup). `icon`
// is the produced-sprite key (resolved by assets.ts) — palette buttons reuse the zone /
// utility sprites (ASSETS.md §1.5). `drag` marks tools painted as a rectangle / run.
export interface ToolDef {
  tool: Tool;
  label: string; // short palette label (e.g. "STATN")
  name: string; // full name for the cost readout (e.g. "RESIDENTIAL ZONE")
  icon: string; // produced-sprite key (assets.ts key, no extension)
  color: string; // palette / preview accent
  cost: number; // capital $ per tile
  upkeep: number; // $/month per tile
  drag: boolean; // paints a rectangle (zones) or a run (roads/rail/wire/pipe/raze)
  span: boolean; // may be laid over water/hill as a span (priced up)
}

export const TOOLS: ToolDef[] = [
  { tool: "zoneRes", label: "RES", name: "RESIDENTIAL ZONE", icon: "icons/zone_r", color: COL.res, cost: COST.zoneRes, upkeep: 0, drag: true, span: false },
  { tool: "zoneCom", label: "COM", name: "COMMERCIAL ZONE", icon: "icons/zone_c", color: COL.com, cost: COST.zoneCom, upkeep: 0, drag: true, span: false },
  { tool: "zoneInd", label: "IND", name: "INDUSTRIAL ZONE", icon: "icons/zone_i", color: COL.ind, cost: COST.zoneInd, upkeep: 0, drag: true, span: false },
  { tool: "road", label: "ROAD", name: "ROAD", icon: "icons/road", color: COL.road, cost: COST.road, upkeep: UPKEEP.road, drag: true, span: true },
  { tool: "rail", label: "RAIL", name: "RAIL LINE", icon: "icons/rail", color: COL.rail, cost: COST.rail, upkeep: UPKEEP.rail, drag: true, span: true },
  { tool: "station", label: "STATN", name: "STATION", icon: "icons/station", color: COL.station, cost: COST.station, upkeep: UPKEEP.station, drag: false, span: false },
  { tool: "plant", label: "PWR", name: "POWER PLANT", icon: "utility/plant", color: COL.power, cost: COST.plant, upkeep: UPKEEP.plant, drag: false, span: false },
  { tool: "wire", label: "WIRE", name: "POWER LINE", icon: "utility/wire", color: COL.power, cost: COST.wire, upkeep: UPKEEP.wire, drag: true, span: true },
  { tool: "source", label: "WTR", name: "WATER SOURCE", icon: "utility/source", color: COL.pipe, cost: COST.source, upkeep: UPKEEP.source, drag: false, span: false },
  { tool: "pipe", label: "PIPE", name: "WATER PIPE", icon: "utility/pipe", color: COL.pipe, cost: COST.pipe, upkeep: UPKEEP.pipe, drag: true, span: true },
  { tool: "bulldoze", label: "RAZE", name: "BULLDOZE", icon: "icons/bulldoze", color: COL.text2, cost: COST.bulldoze, upkeep: 0, drag: true, span: false },
];

export const TOOL_BY_KIND: Record<Tool, ToolDef> = Object.fromEntries(TOOLS.map((t) => [t.tool, t])) as Record<Tool, ToolDef>;

// The zone kind a zoning tool paints (null for non-zoning tools).
export const TOOL_ZONE: Partial<Record<Tool, ZoneKind>> = {
  zoneRes: "res",
  zoneCom: "com",
  zoneInd: "ind",
};
