use super::*;

#[test]
fn parse_versions_splits_trims_and_drops_empties() {
    // The wire form is a comma-separated list; whitespace around entries and
    // stray separators are tolerated rather than becoming phantom versions.
    assert_eq!(
        parse_versions(Some("v1.0.0,v1.1.0")),
        Some(vec!["v1.0.0".to_string(), "v1.1.0".to_string()])
    );
    assert_eq!(
        parse_versions(Some(" v1.0.0 , v1.1.0 ,")),
        Some(vec!["v1.0.0".to_string(), "v1.1.0".to_string()])
    );
}

#[test]
fn parse_versions_yields_none_for_absent_or_empty_input() {
    // No param, an empty string, and nothing-but-separators all mean "no filter",
    // so the store never sees an empty list it would have to special-case.
    assert_eq!(parse_versions(None), None);
    assert_eq!(parse_versions(Some("")), None);
    assert_eq!(parse_versions(Some(" , ,")), None);
}
