//! Emit the committed JSON Schemas that must stay in lockstep with the engine:
//! `schemas/scenario.json` (the [`Scenario`](lattice_core::Scenario) shape) and
//! `schemas/state.json` (a top-level array of [`Snapshot`](lattice_core::Snapshot)).
//!
//! Run from the crate root: `cargo run -p lattice-core --bin gen-lattice-artifacts`. A
//! test ([`crate::tests`](../lib.test.rs)) asserts the on-disk copies match what
//! this would emit, so the schemas can never drift from the types the engine
//! (de)serializes.

use std::path::Path;

use lattice_core::schema::{scenario_schema_string, state_schema_string};

fn main() -> std::io::Result<()> {
    let crate_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let schemas = crate_dir.join("schemas");
    std::fs::create_dir_all(&schemas)?;
    std::fs::write(schemas.join("scenario.json"), scenario_schema_string())?;
    std::fs::write(schemas.join("state.json"), state_schema_string())?;
    println!("wrote schemas/scenario.json, schemas/state.json");
    Ok(())
}
