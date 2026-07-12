// Junction — the simulation tuning tables (DESIGN §3, ported from the sim half of the TS
// `constants.ts`). Every number the specs pin lives here so the model reads exactly as
// written (specs/map.md, specs/transit.md, specs/utilities.md, specs/economy.md,
// specs/flow.md); values the spec leaves to us are fixed here and restated in the README.
// The balance harness (`tests/balance.rs`) drives the real `Game` over these, so a tuning
// change is a one-line edit here re-checked by re-running `cargo test`.
//
// The PRESENTATION constants (the palette, fonts, tool labels/icons/colours, the stage/
// camera geometry the renderer and camera need) stay in the TS `constants.ts`; only the
// numbers the simulation itself reads live here.

use crate::types::Tool;

// ---- Grid & clock --------------------------------------------------------------
pub const TILE: f64 = 24.0; // logical px per tile at 1× zoom (world-px scale for FX/vehicles)
pub const MAP_COLS: usize = 96;
pub const MAP_ROWS: usize = 72;
pub const TILE_COUNT: usize = MAP_COLS * MAP_ROWS;

pub const TICK_HZ: f64 = 6.0; // fixed sim ticks/sec
pub const FIXED_STEP: f64 = 1.0 / TICK_HZ; // seconds per tick (render interpolates between)
pub const TICKS_PER_MONTH: u32 = 24; // ⇒ 4 s/month at 1× — the budget period beat
pub const START_MONTH_MONTH: u32 = 0;
pub const START_MONTH_YEAR: u32 = 2027;
pub const MONTH_COUNT: u32 = 12;

// ---- Typed-array / bitmask encodings -------------------------------------------
// `net` is a per-tile bitmask of the carriers occupying the tile (DESIGN §2.2). The SPAN
// bit marks a bridge/tunnel carried over water/hill (priced up); the STATION bit rides on
// a rail tile.
pub const NET_ROAD: u8 = 1 << 0;
pub const NET_RAIL: u8 = 1 << 1;
pub const NET_WIRE: u8 = 1 << 2;
pub const NET_PIPE: u8 = 1 << 3;
pub const NET_STATION: u8 = 1 << 4;
pub const NET_SPAN: u8 = 1 << 5;
pub const NET_CARRIER: u8 = NET_ROAD | NET_RAIL | NET_WIRE | NET_PIPE | NET_STATION;

// ---- Zones, tiers, development (specs/map.md, specs/economy.md) -----------------
// Per-tier tables indexed by tier 0..3 (index 0 = empty lot, unused padding), by zone
// [res, com, ind].
pub const POP: [[f64; 4]; 3] = [
    [0.0, 10.0, 30.0, 75.0], // res
    [0.0, 0.0, 0.0, 0.0],    // com
    [0.0, 0.0, 0.0, 0.0],    // ind
];
pub const JOBS: [[f64; 4]; 3] = [
    [0.0, 0.0, 0.0, 0.0],    // res
    [0.0, 8.0, 24.0, 55.0],  // com
    [0.0, 12.0, 32.0, 80.0], // ind
];
pub const SHOP_CAP: [[f64; 4]; 3] = [
    [0.0, 0.0, 0.0, 0.0],    // res
    [0.0, 12.0, 34.0, 78.0], // com
    [0.0, 0.0, 0.0, 0.0],    // ind
];
// Power = water demand units per tier.
pub const UTIL_DEMAND: [[f64; 4]; 3] = [
    [0.0, 1.0, 3.0, 6.0],  // res
    [0.0, 1.0, 3.0, 6.0],  // com
    [0.0, 2.0, 5.0, 10.0], // ind
];
// Pollution emitted per tick by an industry tile of each tier (res/com emit none).
pub const POLL_EMIT_IND: [f64; 4] = [0.0, 0.4, 0.9, 1.6];

// Zone-index helpers into the tables above.
pub const Z_RES: usize = 0;
pub const Z_COM: usize = 1;
pub const Z_IND: usize = 2;

// Development gates & pace (specs/map.md).
pub const WALK_TILES: i32 = 3; // road-access reach (tiles from the road network)
pub const BUILD_TICKS: f64 = 18.0; // ≈3 s construction; plays the construction sheet + dust
pub const UPGRADE_TICKS: f64 = 48.0; // ticks the tier-up conditions must hold before growing
pub const DECAY_RATE: f64 = 1.0 / 36.0; // dilapidation accrued per tick while a precond is lost
// Land value needed to reach a tier (index = TARGET tier). Tier 1 has no floor.
pub const LAND_TIER: [f64; 4] = [0.0, 0.0, 0.5, 0.72];

// ---- Transit (specs/transit.md) ------------------------------------------------
pub const ROAD_CAP: f64 = 14.0; // trips/tick a road tile carries at full speed
pub const RAIL_CAP: f64 = 70.0; // rail segment capacity (high — offloads roads)
pub const CONGEST_K: f64 = 1.5; // travel-time mult = 1 + K·max(0, load/cap − 1)
pub const COMMUTE_FRAC: f64 = 0.6; // share of a res tile's pop making a work/shop trip
pub const RAIL_SPEED_MULT: f64 = 2.0; // a station-to-station leg is this much faster than road
pub const VEHICLE_CAP_ON_SCREEN: usize = 220; // render budget — sample vehicles to draw

// ---- Utilities (specs/utilities.md) --------------------------------------------
pub const POWER_PLANT_CAP: f64 = 150.0;
pub const WATER_SOURCE_CAP: f64 = 150.0;

// ---- Economy: costs, upkeep, budget (specs/economy.md) -------------------------
// Capital cost ($) charged when a tile/structure is placed, and monthly upkeep ($/month)
// charged per placed tile/structure — both keyed by tool code (Tool as usize).
pub const COST: [f64; 11] = [
    10.0,  // zoneRes
    10.0,  // zoneCom
    10.0,  // zoneInd
    12.0,  // road
    30.0,  // rail
    200.0, // station
    700.0, // plant
    6.0,   // wire
    450.0, // source
    6.0,   // pipe
    4.0,   // bulldoze
];
pub const UPKEEP: [f64; 11] = [
    0.0,  // zoneRes
    0.0,  // zoneCom
    0.0,  // zoneInd
    2.0,  // road
    4.0,  // rail
    12.0, // station
    30.0, // plant
    1.0,  // wire
    22.0, // source
    1.0,  // pipe
    0.0,  // bulldoze
];

pub fn cost_of(tool: Tool) -> f64 {
    COST[tool as usize]
}
pub fn upkeep_of(tool: Tool) -> f64 {
    UPKEEP[tool as usize]
}

// A carrier laid over water/hill is a SPAN (bridge/tunnel): +capital, +upkeep on that tile.
pub const SPAN_COST_EXTRA: f64 = 48.0; // road span = 12 + 48 = 60 capital
pub const SPAN_UPKEEP_EXTRA: f64 = 4.0; // road span = 2 + 4 = 6 upkeep

pub const BULLDOZE_REFUND: f64 = 0.4; // fraction of a razed tile's capital refunded
pub const ZONE_COST: f64 = COST[Tool::ZoneRes as usize]; // $/tile to zone

// Budget (specs/economy.md, specs/flow.md).
pub const START_TREASURY: f64 = 30000.0;
pub const DEBT_LIMIT: f64 = -20000.0;
pub const TAX_DEFAULT: f64 = 0.09;
pub const TAX_MIN: f64 = 0.0;
pub const TAX_MAX: f64 = 0.2;
pub const TAX_STEP: f64 = 0.01;
pub const TAX_CAPITA: f64 = 1.8; // $/occupant·land·taxRate of monthly income (sim-tuned)

// ---- Pollution, land value (specs/economy.md) ----------------------------------
pub const POLL_CONGEST: f64 = 0.15; // pollution a congested road adds per unit over-capacity
pub const POLL_DIFFUSE: f64 = 0.12; // share diffused to each 4-neighbour per tick
pub const POLL_DECAY: f64 = 0.04; // share decayed away per tick
pub const POLL_MAX: f64 = 100.0;

pub const LAND_BASE: f64 = 0.35;
pub const LAND_AMENITY_MAX: f64 = 0.3;
pub const LAND_AMENITY_RADIUS: f64 = 4.0;
pub const LAND_SERVICE: f64 = 0.15;
pub const LAND_STATION: f64 = 0.1;
pub const LAND_STATION_RADIUS: i32 = 4;
pub const LAND_POLL_K: f64 = 0.6;
pub const LAND_CONGEST_MAX: f64 = 0.25;

// ---- RCI demand (specs/economy.md) ---------------------------------------------
pub const RCI_EASE: f64 = 0.25; // fraction of the gap to the target closed each month
pub const RCI_CLAMP: f64 = 100.0;
pub const RCI_TAX_PEN: f64 = 220.0;
pub const RCI_R_JOB_PULL: f64 = 1.3;
pub const RCI_R_VACANCY_PEN: f64 = 1.0;
pub const RCI_C_SHOP_PULL: f64 = 1.1;
pub const RCI_C_GOODS_PULL: f64 = 0.7;
pub const RCI_C_OVERSUPPLY: f64 = 1.0;
pub const RCI_I_COM_PULL: f64 = 1.0;
pub const RCI_I_WORKFORCE_PULL: f64 = 0.8;
pub const RCI_I_OVERSUPPLY: f64 = 1.0;

// ---- Milestones (specs/flow.md) ------------------------------------------------
pub const POP_MILESTONES: [f64; 4] = [500.0, 2000.0, 5000.0, 10000.0];

/// The milestone id/label pairs, in fire order (each fires once → notification + fireworks
/// one-shot + chime cue). The pop-* ids are matched by the checker to `POP_MILESTONES`.
pub const MILESTONES: [(&str, &str); 7] = [
    ("first-rail", "FIRST RAIL LINE"),
    ("pop-500", "POPULATION 500"),
    ("pop-2000", "POPULATION 2,000"),
    ("pop-5000", "POPULATION 5,000"),
    ("pop-10000", "POPULATION 10,000"),
    ("first-tier3", "FIRST HIGH-RISE"),
    ("first-district", "FIRST FULLY-SERVED DISTRICT"),
];

// ---- Tool placement metadata (DESIGN §4) ---------------------------------------
/// How a tool is painted: a filled rectangle (zones/bulldoze), an L-run (carriers), or a
/// single stamp (station/plant/source).
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum DragKind {
    Rect,
    Run,
    Stamp,
}

pub fn drag_kind(tool: Tool) -> DragKind {
    match tool {
        Tool::ZoneRes | Tool::ZoneCom | Tool::ZoneInd | Tool::Bulldoze => DragKind::Rect,
        Tool::Road | Tool::Rail | Tool::Wire | Tool::Pipe => DragKind::Run,
        Tool::Station | Tool::Plant | Tool::Source => DragKind::Stamp,
    }
}

/// A carrier that may be laid over water/hill as a priced-up span.
pub fn is_span_tool(tool: Tool) -> bool {
    matches!(tool, Tool::Road | Tool::Rail | Tool::Wire | Tool::Pipe)
}
