use std::path::Path;

use test_cabinet_core::{AestheticRating, VerdictStatus, parse_writeup};

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
fn describe_ratings_reports_the_run_wide_aesthetic_tier() {
    let writeup = writeup("---\naesthetic: okay\n---\n\nBody.\n");
    assert_eq!(describe_ratings(&writeup), "aesthetic okay");
}

#[test]
fn describe_ratings_collapses_legacy_per_domain_aesthetic_lines_to_the_worst_tier() {
    let writeup =
        writeup("---\naesthetic.single-player: amazing\naesthetic.versus: okay\n---\n\nBody.\n");
    assert_eq!(describe_ratings(&writeup), "aesthetic okay");
}

#[test]
fn describe_ratings_reports_both_channels_when_both_are_present() {
    let writeup = writeup("---\nrating.gameplay: great\naesthetic: good\n---\n\nBody.\n");
    assert_eq!(
        describe_ratings(&writeup),
        "functional great (worst of gameplay=great); aesthetic good"
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
    std::fs::write(&path, "---\naesthetic: legendary\n---\n\nStunning.\n").expect("write fixture");
    let loaded = load_writeup_at(Path::new(&path)).expect("loads");
    assert!(loaded.ratings.is_empty());
    assert_eq!(loaded.aesthetic, Some(AestheticRating::Legendary));
    assert_eq!(loaded.body, "Stunning.");
}

#[test]
fn a_validator_rated_writeup_carries_its_override_lines_as_the_checklist() {
    // `review.<id>` lines on a validator-rated run are the reviewer's overrides of
    // individual validator verdicts; the loaded writeup carries them so the
    // self-review path forwards them (with the run-wide aesthetic) verbatim.
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("run-d.md");
    std::fs::write(
        &path,
        "---\naesthetic: good\nreview.versus.serve: pass precondition unmet, judged by hand\n---\n\nBody.\n",
    )
    .expect("write fixture");
    let loaded = load_writeup_at(Path::new(&path)).expect("loads");
    assert_eq!(loaded.aesthetic, Some(AestheticRating::Good));
    assert_eq!(loaded.checklist.len(), 1);
    assert_eq!(loaded.checklist[0].id, "versus.serve");
    assert_eq!(loaded.checklist[0].status, VerdictStatus::Pass);
    assert_eq!(
        loaded.checklist[0].note.as_deref(),
        Some("precondition unmet, judged by hand")
    );
}

#[test]
fn plan_lines_describe_a_self_review() {
    let plan = PublishPlan::SelfReview(writeup("---\naesthetic: amazing\n---\n\nBody.\n"));
    assert_eq!(
        plan_lines("run-a", &plan),
        vec![
            "  run-a".to_string(),
            "    review: aesthetic amazing".to_string(),
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
