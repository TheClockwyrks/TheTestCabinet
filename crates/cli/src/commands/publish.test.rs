use std::path::Path;

use test_cabinet_core::parse_writeup;

use super::{PublishPlan, WriteupLoadError, describe_ratings, load_writeup_at, plan_lines};

fn writeup(text: &str) -> test_cabinet_core::Writeup {
    parse_writeup(text).expect("fixture writeup parses")
}

#[test]
fn describe_ratings_reports_the_functional_channel_on_a_legacy_writeup() {
    let writeup =
        writeup("---\nrating.single-player: great\nrating.versus: scuffed\n---\n\nBody.\n");
    assert_eq!(
        describe_ratings(&writeup),
        "functional scuffed (worst of single-player=great, versus=scuffed)"
    );
}

#[test]
fn describe_ratings_reports_the_aesthetic_channel_on_a_validator_rated_writeup() {
    let writeup =
        writeup("---\naesthetic.single-player: amazing\naesthetic.versus: okay\n---\n\nBody.\n");
    assert_eq!(
        describe_ratings(&writeup),
        "aesthetic okay (worst of single-player=amazing, versus=okay)"
    );
}

#[test]
fn describe_ratings_reports_both_channels_when_both_are_present() {
    let writeup = writeup("---\nrating.gameplay: great\naesthetic.gameplay: good\n---\n\nBody.\n");
    assert_eq!(
        describe_ratings(&writeup),
        "functional great (worst of gameplay=great); aesthetic good (worst of gameplay=good)"
    );
}

#[test]
fn describe_ratings_is_unrated_for_a_checklist_only_writeup() {
    let writeup = writeup("---\nreview.debug-api: pass\n---\n\nBody.\n");
    assert_eq!(describe_ratings(&writeup), "unrated");
}

#[test]
fn a_missing_writeup_is_distinguished_from_a_malformed_one() {
    let dir = tempfile::tempdir().expect("tempdir");
    let missing = dir.path().join("run-a.md");
    assert!(matches!(
        load_writeup_at(&missing),
        Err(WriteupLoadError::Missing(reason)) if reason.contains("no writeup")
    ));

    let malformed = dir.path().join("run-b.md");
    std::fs::write(&malformed, "no frontmatter here\n").expect("write fixture");
    assert!(matches!(
        load_writeup_at(&malformed),
        Err(WriteupLoadError::Invalid(_))
    ));
}

#[test]
fn an_aesthetic_only_writeup_loads_from_disk() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("run-c.md");
    std::fs::write(
        &path,
        "---\naesthetic.single-player: legendary\n---\n\nStunning.\n",
    )
    .expect("write fixture");
    let loaded = load_writeup_at(Path::new(&path)).expect("loads");
    assert!(loaded.ratings.is_empty());
    assert_eq!(loaded.aesthetics.len(), 1);
    assert_eq!(loaded.aesthetics[0].domain, "single-player");
    assert_eq!(loaded.body, "Stunning.");
}

#[test]
fn plan_lines_describe_a_self_review() {
    let plan = PublishPlan::SelfReview(writeup(
        "---\naesthetic.single-player: amazing\n---\n\nBody.\n",
    ));
    assert_eq!(
        plan_lines("run-a", &plan),
        vec![
            "  run-a".to_string(),
            "    review: aesthetic amazing (worst of single-player=amazing)".to_string(),
            "    action: submit self-review, then publish".to_string(),
        ]
    );
}

#[test]
fn plan_lines_say_a_validator_rated_run_publishes_without_a_review() {
    assert_eq!(
        plan_lines("run-b", &PublishPlan::WithoutReview),
        vec![
            "  run-b".to_string(),
            "    review: none (validator-rated, no `run-b.md` writeup)".to_string(),
            "    action: publish without a self-review".to_string(),
        ]
    );
}
