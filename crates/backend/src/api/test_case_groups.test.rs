use super::*;

use test_cabinet_core::TestCaseGroup;

// The wire shape drops `rank` (applied at ingest, server-side) and keeps
// everything else, `summary`'s null included.
#[test]
fn the_wire_shape_carries_everything_but_rank() {
    let out = TestCaseGroupOut::from(TestCaseGroup {
        slug: "tower-defense".to_string(),
        name: "Tower Defense".to_string(),
        summary: Some("Mazes and waves.".to_string()),
        rank: Some(1),
        cases: vec!["meltdown".to_string(), "valence".to_string()],
    });
    let value = serde_json::to_value(TestCaseGroupsResponse { groups: vec![out] }).unwrap();
    assert_eq!(
        value,
        serde_json::json!({
            "groups": [{
                "slug": "tower-defense",
                "name": "Tower Defense",
                "summary": "Mazes and waves.",
                "cases": ["meltdown", "valence"],
            }]
        })
    );

    let unsummarized = TestCaseGroupOut::from(TestCaseGroup {
        slug: "sim-economy".to_string(),
        name: "Sim & Economy".to_string(),
        summary: None,
        rank: None,
        cases: vec!["coil".to_string()],
    });
    assert_eq!(
        serde_json::to_value(&unsummarized).unwrap()["summary"],
        serde_json::Value::Null
    );
}
