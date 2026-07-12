// Junction — the shared runtime data model (DESIGN §2, ported from the TS `types.ts`).
//
// The world is a STRUCT-OF-ARRAYS tile grid (dense arrays indexed by
// `idx = row * MAP_COLS + col`) for the per-tile fields the sim sweeps every tick, plus a
// handful of object lists for placed sources and moving agents. The enums are encoded as
// small integers in the dense arrays (see `constants.rs`) and as `#[repr(u8)]` codes the
// wasm boundary hands the front end.

// ---- Enums (DESIGN §2.1) -------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Terrain {
    Earth = 0,
    Grass = 1,
    Water = 2,
    Hill = 3,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ZoneKind {
    Res = 0,
    Com = 1,
    Ind = 2,
}

impl ZoneKind {
    /// Stored in the `zone` array as `kind as u8 + 1` (0 = none).
    pub fn code(self) -> u8 {
        self as u8 + 1
    }
    pub fn from_code(code: u8) -> Option<ZoneKind> {
        match code {
            1 => Some(ZoneKind::Res),
            2 => Some(ZoneKind::Com),
            3 => Some(ZoneKind::Ind),
            _ => None,
        }
    }
}

/// The eleven build tools, in the canonical palette order (specs/controls.md). The integer
/// value is the code the wasm boundary uses, so the JS palette must mirror this order.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Tool {
    ZoneRes = 0,
    ZoneCom = 1,
    ZoneInd = 2,
    Road = 3,
    Rail = 4,
    Station = 5,
    Plant = 6,
    Wire = 7,
    Source = 8,
    Pipe = 9,
    Bulldoze = 10,
}

impl Tool {
    pub fn from_code(code: u32) -> Option<Tool> {
        use Tool::*;
        Some(match code {
            0 => ZoneRes,
            1 => ZoneCom,
            2 => ZoneInd,
            3 => Road,
            4 => Rail,
            5 => Station,
            6 => Plant,
            7 => Wire,
            8 => Source,
            9 => Pipe,
            10 => Bulldoze,
            _ => return None,
        })
    }

    /// The zone kind a zoning tool paints, if any.
    pub fn zone_kind(self) -> Option<ZoneKind> {
        match self {
            Tool::ZoneRes => Some(ZoneKind::Res),
            Tool::ZoneCom => Some(ZoneKind::Com),
            Tool::ZoneInd => Some(ZoneKind::Ind),
            _ => None,
        }
    }

    /// Parse the `tool:<name>` action names the JS palette emits.
    pub fn from_name(name: &str) -> Option<Tool> {
        Some(match name {
            "zoneRes" => Tool::ZoneRes,
            "zoneCom" => Tool::ZoneCom,
            "zoneInd" => Tool::ZoneInd,
            "road" => Tool::Road,
            "rail" => Tool::Rail,
            "station" => Tool::Station,
            "plant" => Tool::Plant,
            "wire" => Tool::Wire,
            "source" => Tool::Source,
            "pipe" => Tool::Pipe,
            "bulldoze" => Tool::Bulldoze,
            _ => return None,
        })
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GameState {
    Title = 0,
    Howto = 1,
    Playing = 2,
    Paused = 3,
    Bankrupt = 4,
}

impl GameState {
    pub fn from_code(code: u32) -> Option<GameState> {
        Some(match code {
            0 => GameState::Title,
            1 => GameState::Howto,
            2 => GameState::Playing,
            3 => GameState::Paused,
            4 => GameState::Bankrupt,
            _ => return None,
        })
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Overlay {
    None = 0,
    Traffic = 1,
    Utility = 2,
    Landvalue = 3,
}

impl Overlay {
    pub fn from_code(code: u32) -> Overlay {
        match code {
            1 => Overlay::Traffic,
            2 => Overlay::Utility,
            3 => Overlay::Landvalue,
            _ => Overlay::None,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum VehicleKind {
    Car = 0,
    Truck = 1,
    Tram = 2,
}

/// A produced-audio cue queued by the sim for the front end to play.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Cue {
    Build = 0,
    Chime = 1,
    Alert = 2,
}

/// A produced particle system the sim asks the front end to play.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FxKind {
    Haze = 0,
    Dust = 1,
    Fireworks = 2,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Tone {
    Info = 0,
    Good = 1,
    Alert = 2,
}

// ---- Object lists on the World / Game (DESIGN §2.3) ----------------------------

/// A power plant or water source: a 2×2 footprint anchored at its top-left tile, feeding
/// one connected component of its carrier with a fixed capacity.
#[derive(Clone, Debug)]
pub struct Source {
    pub id: u32,
    pub kind: SourceKind,
    pub col: i32,
    pub row: i32,
    pub capacity: f64,
    pub supplied: f64,
    pub net: i32,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SourceKind {
    Plant = 0,
    Source = 1,
}

/// A visible agent on the network (specs/transit.md), rendered interpolated along `path`.
#[derive(Clone, Debug)]
pub struct Vehicle {
    pub id: u32,
    pub kind: VehicleKind,
    pub path: Vec<usize>,
    pub seg: usize,
    pub t: f64,
    pub speed: f64,
    pub angle: f64,
    pub anim_t: f64,
}

/// A brief, non-blocking HUD toast (specs/flow.md).
#[derive(Clone, Debug)]
pub struct Notification {
    pub text: String,
    pub age: f64,
    pub ttl: f64,
    pub tone: Tone,
}

/// An animated traffic signal at a road junction.
#[derive(Clone, Copy, Debug)]
pub struct Signal {
    pub col: i32,
    pub row: i32,
    pub phase: f64,
}

// ---- Aggregate / economy state (DESIGN §2.4) -----------------------------------

/// RCI demand, −100..+100 (`d` = industrial demand).
#[derive(Clone, Copy, Debug, Default)]
pub struct Rci {
    pub r: f64,
    pub c: f64,
    pub d: f64,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Budget {
    pub treasury: f64,
    pub income: f64,
    pub upkeep: f64,
    pub balance: f64,
    pub tax_rate: f64,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Balance {
    pub supply: f64,
    pub demand: f64,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct GameStats {
    pub population: f64,
    pub jobs: f64,
    pub shops: f64,
    pub peak_population: f64,
    pub power: Balance,
    pub water: Balance,
    pub months_survived: u32,
}

#[derive(Clone, Copy, Debug)]
pub struct Clock {
    pub month: u32,
    pub year: u32,
}

/// A particle event queued by the sim for the front end to spawn.
#[derive(Clone, Copy, Debug)]
pub struct FxEvent {
    pub kind: FxKind,
    pub x: f64,
    pub y: f64,
    pub strength: f64,
}

/// The reproducible snapshot the proof hook reads (DESIGN §6).
#[derive(Clone, Copy, Debug)]
pub struct Snapshot {
    pub population: f64,
    pub peak_population: f64,
    pub treasury: f64,
    pub balance: f64,
    pub months_survived: u32,
    pub bankrupt: bool,
}

/// The result of applying a tool over a tile list.
#[derive(Clone, Debug, Default)]
pub struct ApplyResult {
    pub placed: u32,
    pub spent: f64,
    pub refused: Option<String>,
}
