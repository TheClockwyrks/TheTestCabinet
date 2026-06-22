//! Crate-level tests: the schema-drift guard that keeps the committed
//! `schemas/*.json` in lockstep with the engine's types.

#[cfg(feature = "schema")]
#[test]
fn committed_schemas_match_the_types() {
    for (file, generated) in [
        (
            "schemas/scenario.json",
            crate::schema::scenario_schema_string(),
        ),
        ("schemas/state.json", crate::schema::state_schema_string()),
    ] {
        let path = format!("{}/{}", env!("CARGO_MANIFEST_DIR"), file);
        let on_disk = std::fs::read_to_string(&path).expect("the committed schema exists");
        assert_eq!(
            on_disk, generated,
            "run `cargo run -p lattice-core --bin gen-lattice-artifacts`"
        );
    }
}
