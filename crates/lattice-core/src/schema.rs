//! The JSON Schemas seeded into the case, re-exported from one place.
//!
//! Both schemas are generated from the very Rust types the engine
//! (de)serializes — [`Scenario`](crate::scenario::Scenario) and
//! `Vec<`[`Snapshot`](crate::state::Snapshot)`>` — via schemars, so the
//! `schemas/scenario.json` / `schemas/state.json` the manifest seeds can never
//! drift from the engine. The [`gen-artifacts`](../bin/gen-artifacts) binary
//! writes them and a drift test asserts the on-disk copies match.

/// The scenario JSON Schema as the canonical pretty-printed string.
pub fn scenario_schema_string() -> String {
    let schema = schemars::schema_for!(crate::scenario::Scenario);
    let mut text = serde_json::to_string_pretty(&schema).expect("the scenario schema serializes");
    text.push('\n');
    text
}

/// The state JSON Schema (a top-level array of snapshots) as the canonical
/// pretty-printed string.
pub fn state_schema_string() -> String {
    crate::state::state_schema_string()
}
