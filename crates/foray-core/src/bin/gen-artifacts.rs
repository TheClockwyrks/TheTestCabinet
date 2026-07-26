//! Emit the committed artifacts that must stay in lockstep with the engine: the
//! `world`/`action` JSON Schemas the manifest seeds verbatim, and the
//! `maps/mirror-32x16.toml` map file.
//!
//! Run from the crate root: `cargo run -p foray-core --bin gen-artifacts`. A test
//! in the `foray-core` library's own test suite asserts the on-disk copies match
//! what this would emit, so the schemas can never drift from the `World`/`Action`
//! types and the committed map can never drift from the generator.

use std::path::Path;

use foray_core::board::{Board, BoardParams};
use foray_core::contract::{action_schema_string, world_schema_string};
use foray_core::map_artifacts::{MAP_ID, MAP_SEED};

fn main() -> std::io::Result<()> {
    let crate_dir = Path::new(env!("CARGO_MANIFEST_DIR"));

    let schemas = crate_dir.join("schemas");
    std::fs::create_dir_all(&schemas)?;
    std::fs::write(schemas.join("world.json"), world_schema_string())?;
    std::fs::write(schemas.join("action.json"), action_schema_string())?;

    let maps = crate_dir.join("maps");
    std::fs::create_dir_all(&maps)?;
    let board = Board::generate(MAP_ID, BoardParams::default(), MAP_SEED);
    std::fs::write(maps.join(format!("{MAP_ID}.toml")), board.to_map_toml())?;

    println!("wrote schemas/world.json, schemas/action.json, maps/{MAP_ID}.toml");
    Ok(())
}
