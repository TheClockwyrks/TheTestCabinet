use super::*;

#[test]
fn an_ingested_version_names_its_rendered_references() {
    assert_eq!(
        version_state(true, 3, None, None),
        "ingested (3 reference image(s))"
    );
}

#[test]
fn a_skipped_version_names_the_reason_the_backend_gave() {
    assert_eq!(
        version_state(false, 0, Some("unchanged"), None),
        "skipped: unchanged"
    );
}

#[test]
fn a_skip_without_a_reason_is_one_the_store_already_held() {
    assert_eq!(
        version_state(false, 0, None, None),
        "skipped: already stored"
    );
}

#[test]
fn a_refused_version_names_the_problem_it_was_refused_for() {
    assert_eq!(
        version_state(false, 0, None, Some("`carom` does not validate")),
        "refused: `carom` does not validate"
    );
}
