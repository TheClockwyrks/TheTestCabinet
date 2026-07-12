// Junction — the `base` start this build plays (specs/mode.md, DESIGN §1, §4), ported from
// `mode.ts`.
//
// THE START CONFIG IS ISOLATED TO THIS FILE. Only the starting valley seed, the modest
// starting treasury, the default tax rate, the already-positive opening RCI demand, the
// short pre-placed road stub, and the camera focus live here; every other system is common.

use crate::constants::{START_TREASURY, TAX_DEFAULT};
use crate::types::Rci;

/// A short pre-placed horizontal road run (in tile coords) the player builds out from.
pub struct RoadStub {
    pub col: i32,
    pub row: i32,
    pub len: i32,
}

pub struct CityMode {
    pub menu_label: &'static str, // main-menu entry (specs/mode.md) — before HOW TO PLAY
    pub tagline: &'static str,
    pub seed: u32,
    pub start_treasury: f64,
    pub start_tax: f64,
    pub start_rci: Rci,
    pub stub: RoadStub,
    pub center_col: i32,
    pub center_row: i32,
}

pub const MODE: CityMode = CityMode {
    menu_label: "NEW CITY",
    tagline: "ZONE. CONNECT. GROW.",
    seed: 0x4a55_4e43, // "JUNC"
    start_treasury: START_TREASURY,
    start_tax: TAX_DEFAULT,
    // The region opens hungry for all three: jobs and homes and works are all wanted, so the
    // first zoned blocks develop while the player lays their first networks (specs/mode.md).
    start_rci: Rci { r: 46.0, c: 30.0, d: 24.0 },
    stub: RoadStub { col: 44, row: 36, len: 9 },
    center_col: 48,
    center_row: 36,
};
