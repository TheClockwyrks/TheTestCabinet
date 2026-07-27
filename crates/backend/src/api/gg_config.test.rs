use super::*;

/// A save body: a named configuration carrying the minimal capability set.
fn sample_input(name: &str) -> GgConfigInput {
    GgConfigInput {
        name: name.to_string(),
        description: "  the default arm  ".to_string(),
        capability_set: GgCapabilitySet::minimal("mock/echo"),
    }
}

#[test]
fn config_from_input_trims_the_name_and_description() {
    let input = GgConfigInput {
        name: "  minimal  ".to_string(),
        ..sample_input("ignored")
    };
    let config = config_from_input("c1".to_string(), input, "2026-07-24T00:00:00Z").unwrap();
    assert_eq!(config.id, "c1");
    assert_eq!(config.name, "minimal");
    assert_eq!(config.description, "the default arm");
    assert_eq!(config.updated_at, "2026-07-24T00:00:00Z");
}

#[test]
fn config_from_input_rejects_a_blank_name() {
    let input = GgConfigInput {
        name: "   ".to_string(),
        ..sample_input("ignored")
    };
    let err = config_from_input("c1".to_string(), input, "2026-07-24T00:00:00Z").unwrap_err();
    assert_eq!(err.status, StatusCode::BAD_REQUEST);
}

#[test]
fn config_from_input_rejects_an_overlong_name() {
    let input = GgConfigInput {
        name: "n".repeat(MAX_NAME_LEN + 1),
        ..sample_input("ignored")
    };
    let err = config_from_input("c1".to_string(), input, "2026-07-24T00:00:00Z").unwrap_err();
    assert_eq!(err.status, StatusCode::BAD_REQUEST);
}

#[test]
fn config_from_input_rejects_an_overlong_description() {
    let input = GgConfigInput {
        description: "d".repeat(MAX_DESCRIPTION_LEN + 1),
        ..sample_input("minimal")
    };
    let err = config_from_input("c1".to_string(), input, "2026-07-24T00:00:00Z").unwrap_err();
    assert_eq!(err.status, StatusCode::BAD_REQUEST);
}

#[test]
fn config_from_input_keeps_an_unbound_capability_set() {
    // A saved configuration is reusable across models, so — unlike a launch — it may
    // leave the primary slot unbound; the new-run form binds it per run.
    let input = GgConfigInput {
        capability_set: GgCapabilitySet::default(),
        ..sample_input("skeleton")
    };
    let config = config_from_input("c1".to_string(), input, "2026-07-24T00:00:00Z").unwrap();
    assert!(config.capability_set.root().resolved_model_id().is_none());
}
