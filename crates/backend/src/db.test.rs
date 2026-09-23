use super::*;
use std::collections::{BTreeMap, BTreeSet};

use crate::store::CaseNames;
use test_cabinet_core::metrics::RunMetrics;
use test_cabinet_core::review::{AestheticRating, DomainRating, Rating};
use test_cabinet_core::run_record::{
    HarnessFamily, HarnessSlug, RunEnvironment, RunState, RunStatus, RunSubject, RunTooling,
};
use test_cabinet_core::validation::ValidationSummary;

#[test]
fn publishable_failure_states_match_the_contract() {
    // The backend filters failures-only queries on wire strings, while
    // `RunState::is_publishable_failure` is the contract. Derive-and-compare so the
    // two can never drift: adding a failure tier to the contract must widen these
    // queries automatically.
    let derived = publishable_failure_states();
    let expected: Vec<&str> = RunState::ALL
        .into_iter()
        .filter(|s| s.is_publishable_failure())
        .map(run_state_str)
        .collect();
    assert_eq!(derived, expected);
    assert!(!derived.contains(&"completed"));
    assert!(!derived.contains(&"infrastructure"));
    assert!(!derived.contains(&"canceled"));

    // The publish gate's never-publishable list is derived the same way, from
    // `RunState::is_publishable`, so a new never-publishable tier cannot be added to
    // the contract and silently slip through the gate.
    let never = never_publishable_states();
    let expected_never: Vec<&str> = RunState::ALL
        .into_iter()
        .filter(|s| !s.is_publishable())
        .map(run_state_str)
        .collect();
    assert_eq!(never, expected_never);
    assert!(never.contains(&"infrastructure"));
    assert!(never.contains(&"canceled"));
    assert!(!never.contains(&"completed"));

    // Every entry must be a real serde wire string, not a hand-typed guess.
    for state in RunState::ALL {
        let wire = run_state_str(state);
        assert_eq!(
            serde_json::to_value(state).unwrap(),
            serde_json::Value::from(wire),
            "wire string for {state:?} disagrees with serde",
        );
    }
}

/// Build a minimal valid run record with the given id.
pub(crate) fn record(id: &str) -> RunRecord {
    RunRecord {
        id: id.to_string(),
        started_at: "2026-06-17T20:40:00Z".to_string(),
        finished_at: "2026-06-17T21:30:00Z".to_string(),
        subject: RunSubject {
            test_case_slug: "pong".to_string(),
            test_case_version: "v1.0.0".to_string(),
            test_type: test_cabinet_core::TestType::EndToEnd,
            variant: "base".to_string(),
            harness_slug: HarnessSlug::Claude,
            harness_version: Some("1.2.3".to_string()),
            orchestrator_slug: "one-shot".to_string(),
            engine_slug: "none".to_string(),
            engine_version: None,
            model_id: "claude-sonnet-4-5".to_string(),
            gg_capability_set: None,
            gg_summary: None,
        },
        tooling: RunTooling::default(),
        environment: RunEnvironment {
            os: "Debian".to_string(),
            container_image: "test-cabinet/claude:abcd".to_string(),
            node_version: Some("v22.11.0".to_string()),
            auth_mode: test_cabinet_core::AuthMode::ApiKey,
        },
        metrics: RunMetrics::default(),
        validation: ValidationSummary {
            debug_scripts: Vec::new(),
            loaded: true,
            ..ValidationSummary::default()
        },
        links: RunLinks::default(),
        status: RunStatus {
            state: RunState::Completed,
            detail: None,
        },
        game_jam_readme: None,
        tool_calls: Default::default(),
        game_jam_prior_entries: Vec::new(),
        seed_commit: None,
        code_analysis: None,
        toolchain: None,
        showcase: None,
    }
}

/// A gg run record: the base record reconfigured as a gg run carrying a capability set and the
/// aggregatable session summary the gg binary computed, so a test can assert both round-trip.
fn gg_record(id: &str) -> RunRecord {
    use test_cabinet_core::gg::{
        GgCapabilitySet, GgSessionSummary, GgSlotCost, GgUndocumentedCalls,
    };
    use test_cabinet_core::metrics::{Cost, TokenCounts};

    let mut record = record(id);
    record.subject.harness_slug = HarnessSlug::Gg;
    record.subject.model_id = "mock/echo".to_string();
    record.subject.gg_capability_set = Some(GgCapabilitySet::minimal("mock/echo"));
    record.subject.gg_summary = Some(GgSessionSummary {
        rejected_responses: Default::default(),
        max_response_chars: 0,
        max_response_output_tokens: 0,
        terminal_status: "completed".to_string(),
        undocumented_calls: GgUndocumentedCalls::default(),
        agents_spawned: 3,
        subagent_count: 2,
        max_subagent_depth: 1,
        compactions: 1,
        ran_out_of_context: false,
        context_overflow_count: 0,
        final_fullness: Some(0.61),
        issue_reviews: 1,
        review_cycles: 2,
        issues_reopened: 1,
        execution_mode: "tool_calling".to_string(),
        program_language: None,
        code_executions: 0,
        compile_ms: 0,
        errors: Default::default(),
        tool_calls: 0,
        provider_stats: Vec::new(),
        issues_created: 2,
        issues_completed: 2,
        slot_costs: vec![GgSlotCost {
            profile_id: "root".to_string(),
            model_id: "mock/echo".to_string(),
            tokens: TokenCounts {
                uncached_input: Some(2600),
                cached_input: None,
                output: Some(240),
                reasoning: None,
            },
            cost: Some(Cost {
                comparable: Some(0.0063),
                actual: Some(0.0063),
            }),
            work_cost: Some(Cost {
                comparable: Some(0.0063),
                actual: Some(0.0063),
            }),
        }],
        cost: Some(Cost {
            comparable: Some(0.0063),
            actual: Some(0.0063),
        }),
        work_cost: Some(Cost {
            comparable: Some(0.0063),
            actual: Some(0.0063),
        }),
        effective_tools: vec![
            "shell".to_string(),
            "read_file".to_string(),
            "write_file".to_string(),
        ],
        limits: Default::default(),
        limit_hit: None,
    });
    record
}

/// A gg run's aggregatable session summary is stored verbatim on the record and recovered by
/// `get_run` (the shape `GET /runs/{id}` serves), so result aggregation can read a run's outcome
/// without re-parsing its event stream.
#[tokio::test]
async fn a_gg_runs_session_summary_round_trips_through_get_run() {
    let db = Db::connect_in_memory().await.unwrap();
    let pushed = gg_record("gg1");
    db.push(&pushed, &links(), None, None).await.unwrap();

    let stored = db
        .get_run("gg1")
        .await
        .unwrap()
        .expect("the gg run is retrievable");
    // The whole summary round-trips verbatim alongside the capability set it is analyzed by.
    assert_eq!(stored.record.subject.gg_summary, pushed.subject.gg_summary);
    assert_eq!(
        stored.record.subject.gg_capability_set,
        pushed.subject.gg_capability_set
    );
    let summary = stored.record.subject.gg_summary.unwrap();
    assert_eq!(summary.agents_spawned, 3);
    assert_eq!(summary.issue_reviews, 1);
    assert_eq!(summary.issues_reopened, 1);
    assert_eq!(summary.slot_costs.len(), 1);
    assert_eq!(summary.slot_costs[0].tokens.output, Some(240));
}

/// A reviewer identity for tests, derived from a stable account id.
fn reviewer(id: &str) -> Reviewer {
    Reviewer {
        user_id: id.to_string(),
        username: format!("{id}-handle"),
        display_name: format!("{id} Display"),
    }
}

/// A review from account `u1` rating `gameplay` great.
fn review() -> StoredReview {
    review_by("u1", Rating::Great)
}

/// A review from `account` giving `rating` to the `gameplay` domain.
pub(super) fn review_by(account: &str, rating: Rating) -> StoredReview {
    use test_cabinet_core::review::VerdictStatus;
    StoredReview {
        reviewer: reviewer(account),
        ratings: vec![DomainRating {
            domain: "gameplay".to_string(),
            rating,
        }],
        aesthetics: vec![],
        aesthetic: None,
        writeup: "Plays well.".to_string(),
        checklist: vec![ReviewVerdict {
            id: "ball-spin".to_string(),
            status: VerdictStatus::Pass,
            note: Some("spin curves the ball".to_string()),
        }],
        reviewed_at: "2026-06-17T22:00:00Z".to_string(),
        edited_at: None,
        revisions: Vec::new(),
    }
}

pub(crate) fn links() -> RunLinks {
    RunLinks {
        source_repo: Some("https://github.com/x/y".to_string()),
        playable_build: Some("https://abc.pages.dev".to_string()),
    }
}

/// Push, review (account `u1`), and publish a run at `published_at` — the common
/// "now public" setup for these tests.
async fn push_review_publish(db: &Db, id: &str, published_at: &str) {
    db.push(&record(id), &links(), None, None).await.unwrap();
    db.add_review(id, &review(), None, None).await.unwrap();
    db.publish(id, published_at).await.unwrap();
}

#[tokio::test]
async fn a_pushed_run_is_unpublished_with_no_reviews_and_absent_from_the_public_list() {
    let db = Db::connect_in_memory().await.unwrap();
    let outcome = db.push(&record("r1"), &links(), None, None).await.unwrap();
    assert!(outcome.newly_pushed);

    let stored = db.get_run("r1").await.unwrap().unwrap();
    assert!(!stored.published);
    assert!(stored.reviews.is_empty());
    assert!(stored.published_at.is_none());
    // The stored record carries the resolved links even though the submitted
    // record's links were empty.
    assert_eq!(
        stored.record.links.playable_build.as_deref(),
        Some("https://abc.pages.dev")
    );

    // A pending run is not in the public list, but is in the reviewer worklist.
    assert!(db.list_published(50, None).await.unwrap().0.is_empty());
    assert_eq!(db.list_for_review(50, None).await.unwrap().0.len(), 1);
}

#[tokio::test]
async fn a_record_that_no_longer_deserializes_is_skipped_not_fatal() {
    // A stored record can predate a contract change and no longer parse as a
    // `RunRecord` (e.g. an animated-voxel run recorded before F-curve keyframes
    // gained their required `interp` field). Such a row must not blank an entire
    // worklist; it is skipped, and its still-valid siblings return normally.
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record("good"), &links(), None, None)
        .await
        .unwrap();
    db.push(&record("legacy"), &links(), None, None)
        .await
        .unwrap();

    // Corrupt `legacy`'s stored blob so it can no longer be parsed as a RunRecord,
    // standing in for a row written under an older, incompatible schema.
    run::Entity::update_many()
        .col_expr(
            run::Column::RecordJson,
            Expr::value(r#"{"id":"legacy","schema":"from-before-a-contract-change"}"#),
        )
        .filter(run::Column::Id.eq("legacy"))
        .exec(&db.conn())
        .await
        .unwrap();

    // The reviewer worklist still returns the good run instead of erroring on the
    // undeserializable sibling.
    let (runs, _) = db.list_for_review(50, None).await.unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].record.id, "good");

    // A direct read of the corrupt run is a clean not-found (it is skipped in
    // assembly), while the good run still reads back.
    assert!(db.get_run("legacy").await.unwrap().is_none());
    assert!(db.get_run("good").await.unwrap().is_some());

    // Assembly also marks the row unreadable, which is what takes it out of the
    // count as well as out of the page.
    assert!(!lifted(&db, "legacy").await.record_readable);
    assert!(lifted(&db, "good").await.record_readable);
}

#[tokio::test]
async fn publish_is_refused_until_a_run_has_a_review() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record("r1"), &links(), None, None).await.unwrap();

    let err = db.publish("r1", "2026-06-17T21:40:00Z").await.unwrap_err();
    assert!(matches!(err, crate::error::BackendError::Unprocessable(_)));

    // After a review, publish succeeds and the run becomes public.
    db.add_review("r1", &review(), None, None).await.unwrap();
    let outcome = db.publish("r1", "2026-06-17T21:40:00Z").await.unwrap();
    assert!(outcome.newly_published);
    let stored = db.get_run("r1").await.unwrap().unwrap();
    assert!(stored.published);
    assert_eq!(stored.published_at.as_deref(), Some("2026-06-17T21:40:00Z"));
    assert_eq!(stored.reviews[0].ratings, review().ratings);
    assert_eq!(stored.reviews[0].checklist, review().checklist);
}

#[tokio::test]
async fn add_review_is_per_account_upsert_and_a_run_can_carry_many() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record("r1"), &links(), None, None).await.unwrap();

    // Two distinct accounts → two reviews.
    db.add_review("r1", &review_by("u1", Rating::Great), None, None)
        .await
        .unwrap();
    db.add_review("r1", &review_by("u2", Rating::Broken), None, None)
        .await
        .unwrap();
    assert_eq!(db.get_run("r1").await.unwrap().unwrap().reviews.len(), 2);

    // The same account re-reviewing updates in place rather than adding another.
    // A content-changing edit (Great → Scuffed) requires a note; it records a
    // revision, stamps `edited_at`, and preserves the original `reviewed_at`.
    let mut edited = review_by("u1", Rating::Scuffed);
    edited.reviewed_at = "2026-06-18T09:00:00Z".to_string();
    db.add_review("r1", &edited, Some("fixed a misjudged rating"), None)
        .await
        .unwrap();
    let stored = db.get_run("r1").await.unwrap().unwrap();
    assert_eq!(stored.reviews.len(), 2);
    let u1 = stored
        .reviews
        .iter()
        .find(|r| r.reviewer.user_id == "u1")
        .unwrap();
    assert_eq!(u1.ratings[0].rating, Rating::Scuffed);
    // `reviewed_at` stays the first submission; `edited_at` records the edit.
    assert_eq!(u1.reviewed_at, "2026-06-17T22:00:00Z");
    assert_eq!(u1.edited_at.as_deref(), Some("2026-06-18T09:00:00Z"));
    assert_eq!(u1.revisions.len(), 1);
    assert_eq!(u1.revisions[0].note, "fixed a misjudged rating");
    // The autogenerated diff records the rating flip from Great to Scuffed.
    let rating_change = &u1.revisions[0].diff.ratings[0];
    assert_eq!(rating_change.from, Some(Rating::Great));
    assert_eq!(rating_change.to, Some(Rating::Scuffed));
}

#[tokio::test]
async fn editing_a_review_without_a_note_is_rejected() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record("r1"), &links(), None, None).await.unwrap();
    db.add_review("r1", &review_by("u1", Rating::Great), None, None)
        .await
        .unwrap();

    // A content-changing re-submission with no note is rejected as unprocessable.
    let err = db
        .add_review("r1", &review_by("u1", Rating::Scuffed), None, None)
        .await
        .unwrap_err();
    assert!(
        matches!(err, crate::error::BackendError::Unprocessable(_)),
        "expected Unprocessable, got {err:?}"
    );

    // A re-submission that changes nothing is a no-op that needs no note and records
    // no revision.
    db.add_review("r1", &review_by("u1", Rating::Great), None, None)
        .await
        .unwrap();
    let stored = db.get_run("r1").await.unwrap().unwrap();
    assert!(stored.reviews[0].revisions.is_empty());
    assert_eq!(stored.reviews[0].edited_at, None);
}

#[tokio::test]
async fn list_reviews_by_user_orders_by_reviewed_at_and_paginates() {
    let db = Db::connect_in_memory().await.unwrap();

    // Add a review by `account` on `run`, stamped `reviewed_at`.
    async fn review_at(db: &Db, run: &str, account: &str, reviewed_at: &str) {
        let mut r = review_by(account, Rating::Great);
        r.reviewed_at = reviewed_at.to_string();
        db.add_review(run, &r, None, None).await.unwrap();
    }

    for id in ["r1", "r2", "r3"] {
        db.push(&record(id), &links(), None, None).await.unwrap();
    }
    // u1 reviews all three, at increasing times; u2 reviews only r1 (so the filter
    // by reviewer is exercised, and r1's two reviews don't inflate u1's page).
    review_at(&db, "r1", "u1", "2026-06-17T10:00:00Z").await;
    review_at(&db, "r2", "u1", "2026-06-17T11:00:00Z").await;
    review_at(&db, "r3", "u1", "2026-06-17T12:00:00Z").await;
    review_at(&db, "r1", "u2", "2026-06-17T13:00:00Z").await;

    // Newest-reviewed first, windowed: page 1 (limit 2) is r3, r2; total is 3.
    let (page1, total) = db.list_reviews_by_user("u1", 2, 0).await.unwrap();
    assert_eq!(total, 3);
    let ids: Vec<&str> = page1.iter().map(|r| r.record.id.as_str()).collect();
    assert_eq!(ids, ["r3", "r2"]);
    // Each returned run carries u1's review among its reviews.
    assert!(page1[0].reviews.iter().any(|r| r.reviewer.user_id == "u1"));

    // Page 2 (offset 2) is the remaining r1.
    let (page2, total) = db.list_reviews_by_user("u1", 2, 2).await.unwrap();
    assert_eq!(total, 3);
    let ids: Vec<&str> = page2.iter().map(|r| r.record.id.as_str()).collect();
    assert_eq!(ids, ["r1"]);

    // u2 reviewed only r1.
    let (u2, total) = db.list_reviews_by_user("u2", 10, 0).await.unwrap();
    assert_eq!(total, 1);
    assert_eq!(u2[0].record.id, "r1");

    // An account that reviewed nothing gets an empty page.
    let (none, total) = db.list_reviews_by_user("nobody", 10, 0).await.unwrap();
    assert_eq!(total, 0);
    assert!(none.is_empty());
}

#[tokio::test]
async fn add_review_for_an_unknown_run_is_not_found() {
    let db = Db::connect_in_memory().await.unwrap();
    let err = db
        .add_review("nope", &review(), None, None)
        .await
        .unwrap_err();
    assert!(matches!(err, crate::error::BackendError::NotFound(_)));
}

#[tokio::test]
async fn push_stores_events_json_and_get_run_returns_it() {
    let db = Db::connect_in_memory().await.unwrap();
    let events = r#"[{"timestamp":"2026-06-17T20:41:00Z","type":"agent","message":"hi"}]"#;
    db.push(&record("r1"), &links(), Some(events), None)
        .await
        .unwrap();
    let stored = db.get_run("r1").await.unwrap().unwrap();
    assert_eq!(stored.events_json.as_deref(), Some(events));

    // A run pushed without an event log stores NULL and reads back as None.
    db.push(&record("r2"), &links(), None, None).await.unwrap();
    assert_eq!(db.get_run("r2").await.unwrap().unwrap().events_json, None);
}

#[tokio::test]
async fn republish_is_idempotent_and_keeps_first_published_at() {
    let db = Db::connect_in_memory().await.unwrap();
    push_review_publish(&db, "r1", "2026-06-17T21:40:00Z").await;

    let outcome = db.publish("r1", "2026-06-18T09:00:00Z").await.unwrap();
    assert!(!outcome.newly_published);

    let stored = db.get_run("r1").await.unwrap().unwrap();
    // published_at is preserved from the first publish.
    assert_eq!(stored.published_at.as_deref(), Some("2026-06-17T21:40:00Z"));
    assert_eq!(db.run_count().await.unwrap(), 1);
}

#[tokio::test]
async fn list_published_orders_newest_first_paginates_and_excludes_pending() {
    let db = Db::connect_in_memory().await.unwrap();
    push_review_publish(&db, "r1", "2026-06-17T10:00:00Z").await;
    push_review_publish(&db, "r2", "2026-06-17T11:00:00Z").await;
    push_review_publish(&db, "r3", "2026-06-17T12:00:00Z").await;
    // A pending (pushed-only) run must never appear in the public list.
    db.push(&record("pending"), &links(), None, None)
        .await
        .unwrap();

    let (page, next) = db.list_published(2, None).await.unwrap();
    assert_eq!(page.len(), 2);
    assert_eq!(page[0].record.id, "r3");
    assert_eq!(page[1].record.id, "r2");
    let next = next.expect("a next cursor");

    let (page2, next2) = db.list_published(2, Some(&next)).await.unwrap();
    assert_eq!(page2.len(), 1);
    assert_eq!(page2[0].record.id, "r1");
    assert!(next2.is_none());
}

#[tokio::test]
async fn publish_marks_snapshot_dirty_but_pushing_a_pending_run_does_not() {
    let db = Db::connect_in_memory().await.unwrap();
    assert!(!db.snapshot_state().await.unwrap().dirty);

    // Pushing and reviewing a pending run touches nothing public.
    db.push(&record("r1"), &links(), None, None).await.unwrap();
    db.add_review("r1", &review(), None, None).await.unwrap();
    assert!(!db.snapshot_state().await.unwrap().dirty);

    // Publishing flips it public and marks the snapshot dirty.
    db.publish("r1", "2026-06-17T10:00:00Z").await.unwrap();
    assert!(db.snapshot_state().await.unwrap().dirty);

    db.mark_uploaded("2026-06-17T10:05:00Z", 1).await.unwrap();
    let state = db.snapshot_state().await.unwrap();
    assert!(!state.dirty);
    assert_eq!(state.last_run_count, Some(1));
    assert_eq!(state.last_uploaded.as_deref(), Some("2026-06-17T10:05:00Z"));
}

/// Parse a stored mutation stamp back to an instant. Comparing parsed instants
/// rather than the raw strings is deliberate: the RFC 3339 rendering omits the
/// fractional part when it happens to be exactly zero, so two stamps a fraction of
/// a second apart do not reliably compare lexicographically.
fn stamp(raw: &str) -> time::OffsetDateTime {
    assert!(!raw.is_empty(), "the mutation stamp was never written");
    time::OffsetDateTime::parse(raw, &time::format_description::well_known::Rfc3339)
        .expect("the mutation stamp is RFC 3339")
}

#[tokio::test]
async fn every_run_mutation_moves_updated_at() {
    // The mutation timestamp is the *only* signal a cache or index can key on to
    // learn that a stored run now means something different: none of these three
    // writes moves `finished_at`, and only the last moves `published_at`. If any
    // one of them stops stamping, an index reconciling on this column serves the
    // pre-mutation document forever, silently.
    let db = Db::connect_in_memory().await.unwrap();

    db.push(&record("r1"), &links(), None, None).await.unwrap();
    let pushed = stamp(&lifted(&db, "r1").await.updated_at);

    db.add_review("r1", &review(), None, None).await.unwrap();
    let reviewed = stamp(&lifted(&db, "r1").await.updated_at);

    db.publish("r1", "2026-06-17T21:40:00Z").await.unwrap();
    let published = stamp(&lifted(&db, "r1").await.updated_at);

    assert!(
        pushed < reviewed,
        "add_review must move the stamp: {pushed} !< {reviewed}"
    );
    assert!(
        reviewed < published,
        "publish must move the stamp: {reviewed} !< {published}"
    );

    // A re-push rewrites the record blob without changing when the run finished,
    // so it too must move the stamp.
    db.push(&record("r1"), &links(), None, None).await.unwrap();
    let repushed = stamp(&lifted(&db, "r1").await.updated_at);
    assert!(
        published < repushed,
        "a re-push must move the stamp: {published} !< {repushed}"
    );

    // The stamp is the row's own, not the store's: mutating one run leaves every
    // other run's stamp exactly where it was.
    db.push(&record("r2"), &links(), None, None).await.unwrap();
    let other = lifted(&db, "r2").await.updated_at;
    db.add_review("r1", &review_by("u2", Rating::Broken), None, None)
        .await
        .unwrap();
    assert_eq!(lifted(&db, "r2").await.updated_at, other);
}

#[tokio::test]
async fn the_updated_at_migration_seeds_existing_rows_from_finished_at() {
    // Rolling the column's migration back and forward again reproduces exactly what
    // a deployment sees on the release that introduces it: rows that already exist
    // and have never been stamped. They must come out of the migration carrying the
    // run's finish time — the best evidence the row itself holds of when it last
    // meant something different — rather than the `''` the column defaults to,
    // which reads as a lie to anything that displays the value.
    use test_cabinet_migration::MigratorTrait;

    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record("r1"), &links(), None, None).await.unwrap();
    let conn = db.connection();

    // How many migrations to roll back to reach — and re-run — the one under test.
    // Derived from the registered list rather than hardcoded to `1`: `down` counts
    // steps from the head, so every migration added after this one would silently
    // move the test onto a different migration and leave this assertion passing
    // without ever running the code it names.
    let migrations = test_cabinet_migration::Migrator::migrations();
    let index = migrations
        .iter()
        .position(|migration| migration.name() == "m20260801_000024_add_run_updated_at")
        .expect("the `updated_at` migration is registered");
    let steps = (migrations.len() - index) as u32;

    test_cabinet_migration::Migrator::down(&conn, Some(steps))
        .await
        .unwrap();
    test_cabinet_migration::Migrator::up(&conn, Some(steps))
        .await
        .unwrap();

    assert_eq!(
        lifted(&db, "r1").await.updated_at,
        record("r1").finished_at,
        "the migration must seed an existing row's stamp from its finish time"
    );
}

#[tokio::test]
async fn the_startup_backfills_move_updated_at_on_the_rows_they_rewrite() {
    // The backfills rewrite lifted columns on rows that predate them, which is a
    // mutation like any other — and they are also what replaces the migration's
    // empty-string default on the rows they touch.
    let db = Db::connect_in_memory().await.unwrap();
    let mut named = gg_record("gg1");
    named.subject.gg_capability_set.as_mut().unwrap().preset = Some("planning-A".to_string());
    db.push(&named, &links(), None, None).await.unwrap();
    db.push(&record_with_metrics("r1"), &links(), None, None)
        .await
        .unwrap();

    // Reset both rows to how the migrations left a row written before these
    // columns existed: no lifted test type, no lifted preset, and no stamp.
    for id in ["gg1", "r1"] {
        let mut active = lifted(&db, id).await.into_active_model();
        active.test_type = Set(String::new());
        active.gg_preset = Set(None);
        active.updated_at = Set(String::new());
        active.update(&db.connection()).await.unwrap();
    }

    assert_eq!(db.backfill_sort_columns().await.unwrap(), 2);
    // `stamp` rejects the empty default, so parsing both is the assertion that the
    // backfill stamped every row it rewrote.
    stamp(&lifted(&db, "r1").await.updated_at);
    stamp(&lifted(&db, "gg1").await.updated_at);
    // And the lifted columns themselves carry the record-derived values.
    assert_eq!(
        lifted(&db, "gg1").await.gg_preset.as_deref(),
        Some("planning-A")
    );
    assert_ne!(lifted(&db, "r1").await.test_type, "");
}

#[tokio::test]
async fn all_published_returns_only_published_runs_newest_first() {
    let db = Db::connect_in_memory().await.unwrap();
    push_review_publish(&db, "r1", "2026-06-17T10:00:00Z").await;
    push_review_publish(&db, "r2", "2026-06-17T11:00:00Z").await;
    db.push(&record("pending"), &links(), None, None)
        .await
        .unwrap();

    let all = db.all_published().await.unwrap();
    assert_eq!(all.len(), 2);
    assert_eq!(all[0].record.id, "r2");
    assert_eq!(db.run_count().await.unwrap(), 2);
}

#[tokio::test]
async fn all_run_ids_reports_every_stored_run_and_drops_a_deleted_one() {
    // The set the artifact reclamation sweep protects a stored tree with: every run
    // the record store holds, whatever its state, and nothing else.
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record("r1"), &links(), None, None).await.unwrap();
    db.push(&record("r2"), &links(), None, None).await.unwrap();

    let ids = db.all_run_ids().await.unwrap();
    assert_eq!(
        ids,
        ["r1", "r2"]
            .into_iter()
            .map(str::to_string)
            .collect::<std::collections::HashSet<_>>()
    );

    // A deleted run leaves the set, which is what makes its tree an orphan.
    db.delete_run("r1").await.unwrap();
    let ids = db.all_run_ids().await.unwrap();
    assert_eq!(ids, std::iter::once("r2".to_string()).collect());
}

#[tokio::test]
async fn delete_run_removes_an_unpublished_run_and_cascades_its_reviews() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record("r1"), &links(), None, None).await.unwrap();
    db.add_review("r1", &review(), None, None).await.unwrap();
    // A second pending run is left untouched, to prove the delete is scoped.
    db.push(&record("r2"), &links(), None, None).await.unwrap();

    db.delete_run("r1").await.unwrap();

    // The run is gone from every read path, and its review cascaded away with it.
    assert!(db.get_run("r1").await.unwrap().is_none());
    let worklist = db.list_for_review(50, None).await.unwrap().0;
    assert_eq!(worklist.len(), 1);
    assert_eq!(worklist[0].record.id, "r2");
    assert!(db.get_run("r2").await.unwrap().unwrap().reviews.is_empty());
}

#[tokio::test]
async fn delete_run_also_removes_its_run_and_publish_queue_rows() {
    let db = Db::connect_in_memory().await.unwrap();

    // A run produced by a job (the job carries the produced run's id in
    // `record_id`, a plain column with no foreign key back to `run`), with a
    // publish job enqueued against it by `run_id` (likewise no foreign key).
    db.push(&record("r1"), &links(), None, None).await.unwrap();
    db.enqueue_job(new_job("j1", "2026-06-23T00:00:00Z"))
        .await
        .unwrap();
    db.set_job_state("j1", "succeeded", "2026-06-23T00:05:00Z", None, Some("r1"))
        .await
        .unwrap();
    db.enqueue_publish_job(NewPublishJob {
        id: "p1".to_string(),
        run_id: "r1".to_string(),
        job_token: "token-p1".to_string(),
        created_at: "2026-06-23T00:06:00Z".to_string(),
    })
    .await
    .unwrap();

    // A second run and its queue rows are left untouched, to prove the delete is
    // scoped to the deleted run.
    db.push(&record("r2"), &links(), None, None).await.unwrap();
    db.enqueue_job(new_job("j2", "2026-06-23T00:10:00Z"))
        .await
        .unwrap();
    db.set_job_state("j2", "succeeded", "2026-06-23T00:15:00Z", None, Some("r2"))
        .await
        .unwrap();
    db.enqueue_publish_job(NewPublishJob {
        id: "p2".to_string(),
        run_id: "r2".to_string(),
        job_token: "token-p2".to_string(),
        created_at: "2026-06-23T00:16:00Z".to_string(),
    })
    .await
    .unwrap();

    db.delete_run("r1").await.unwrap();

    // The deleted run leaves no orphan in either queue...
    assert!(db.get_run("r1").await.unwrap().is_none());
    assert!(db.get_job("j1").await.unwrap().is_none());
    assert!(db.get_publish_job("p1").await.unwrap().is_none());
    // ...while the untouched run's queue rows remain.
    assert!(db.get_job("j2").await.unwrap().is_some());
    assert!(db.get_publish_job("p2").await.unwrap().is_some());
}

#[tokio::test]
async fn delete_run_is_refused_for_a_published_run() {
    let db = Db::connect_in_memory().await.unwrap();
    push_review_publish(&db, "r1", "2026-06-17T10:00:00Z").await;

    let err = db.delete_run("r1").await.unwrap_err();
    assert!(matches!(err, crate::error::BackendError::Unprocessable(_)));
    // The published run is untouched.
    assert!(db.get_run("r1").await.unwrap().unwrap().published);
}

#[tokio::test]
async fn delete_run_for_an_unknown_run_is_not_found() {
    let db = Db::connect_in_memory().await.unwrap();
    let err = db.delete_run("nope").await.unwrap_err();
    assert!(matches!(err, crate::error::BackendError::NotFound(_)));
}

fn tournament_record(id: &str) -> TournamentRecord {
    use test_cabinet_core::match_play::{ControllerKind, ControllerRef, MatchSummary, Standing};
    use test_cabinet_core::validation::AdversarialOutcome;

    let participant = |pid: &str| ControllerRef {
        id: pid.to_string(),
        kind: ControllerKind::Baseline,
        label: None,
    };
    TournamentRecord {
        id: id.to_string(),
        created_at: "2026-06-21T00:00:00Z".to_string(),
        test_case_slug: "foray".to_string(),
        test_case_version: "v1.0.0".to_string(),
        variant: "base".to_string(),
        participants: vec![participant("border-soldier"), participant("random")],
        standings: vec![
            Standing {
                participant_id: "border-soldier".to_string(),
                wins: 1,
                losses: 0,
                draws: 0,
                rank: 1,
            },
            Standing {
                participant_id: "random".to_string(),
                wins: 0,
                losses: 1,
                draws: 0,
                rank: 2,
            },
        ],
        matches: vec![MatchSummary {
            match_id: "border-soldier__vs__random".to_string(),
            red_id: "border-soldier".to_string(),
            blue_id: "random".to_string(),
            winner: Some("border-soldier".to_string()),
            win_type: "swept".to_string(),
            outcome_for_red: AdversarialOutcome::Win,
            red_score: 20,
            blue_score: 3,
            ticks: 1234,
            red_kills: 4,
            blue_kills: 1,
            red_fuel: 8_000,
            blue_fuel: 12_000,
            replay_key: Some("border-soldier__vs__random".to_string()),
            detail: None,
        }],
    }
}

#[tokio::test]
async fn publish_then_get_tournament_round_trips() {
    let db = Db::connect_in_memory().await.unwrap();
    let outcome = db
        .publish_tournament(&tournament_record("t1"), "2026-06-21T00:00:00Z")
        .await
        .unwrap();
    assert!(outcome.newly_published);

    let stored = db.get_tournament("t1").await.unwrap().unwrap();
    assert_eq!(stored.record.standings[0].participant_id, "border-soldier");
    assert_eq!(stored.record.matches[0].red_kills, 4);
    assert_eq!(stored.published_at, "2026-06-21T00:00:00Z");
}

#[tokio::test]
async fn republish_tournament_keeps_first_published_at() {
    let db = Db::connect_in_memory().await.unwrap();
    db.publish_tournament(&tournament_record("t1"), "2026-06-21T00:00:00Z")
        .await
        .unwrap();
    let outcome = db
        .publish_tournament(&tournament_record("t1"), "2026-06-22T00:00:00Z")
        .await
        .unwrap();
    assert!(!outcome.newly_published, "re-publish is idempotent");
    let stored = db.get_tournament("t1").await.unwrap().unwrap();
    assert_eq!(stored.published_at, "2026-06-21T00:00:00Z");
}

#[tokio::test]
async fn list_tournaments_orders_newest_first_and_paginates() {
    let db = Db::connect_in_memory().await.unwrap();
    db.publish_tournament(&tournament_record("t1"), "2026-06-21T10:00:00Z")
        .await
        .unwrap();
    db.publish_tournament(&tournament_record("t2"), "2026-06-21T11:00:00Z")
        .await
        .unwrap();

    let (page, next) = db.list_tournaments(1, None).await.unwrap();
    assert_eq!(page.len(), 1);
    assert_eq!(page[0].record.id, "t2", "newest first");
    let cursor = next.expect("a second page remains");
    let (page2, _) = db.list_tournaments(1, Some(&cursor)).await.unwrap();
    assert_eq!(page2[0].record.id, "t1");
}

// --- Run queue (the `job` table) -------------------------------------------

/// A queued run with the given id and enqueue time. The lifted identity columns
/// are fixed; tests that care about ordering vary `created_at`.
pub(crate) fn new_job(id: &str, created_at: &str) -> NewJob {
    NewJob {
        id: id.to_string(),
        request_json: format!("{{\"jobId\":\"{id}\"}}"),
        test_case_slug: "pong".to_string(),
        test_case_version: "v1.0.0".to_string(),
        variant: "base".to_string(),
        test_type: TestType::EndToEnd.as_str().to_string(),
        harness_slug: "claude".to_string(),
        model_id: "claude-sonnet-4-5".to_string(),
        engine_slug: None,
        gg_config_json: None,
        gg_preset: None,
        gg_config_id: None,
        gg_models: None,
        job_token: format!("token-{id}"),
        attempt: 0,
        // Unattributed by default — the shape of a job enqueued before attribution
        // existed, and the shape a manual launch keeps.
        user_id: None,
        origin: None,
        created_at: created_at.to_string(),
    }
}

#[tokio::test]
async fn enqueue_then_claim_flips_queued_to_dispatched_then_drains() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_job(new_job("j1", "2026-06-23T00:00:00Z"))
        .await
        .unwrap();

    let claimed = db
        .claim_next_job("2026-06-23T00:00:05Z")
        .await
        .unwrap()
        .expect("the queued job is claimable");
    assert_eq!(claimed.id, "j1");
    assert_eq!(claimed.state, "dispatched");
    assert_eq!(claimed.job_token, "token-j1");

    // A claimed job is no longer queued, so a second claim finds nothing.
    assert!(
        db.claim_next_job("2026-06-23T00:00:06Z")
            .await
            .unwrap()
            .is_none(),
        "the queue is drained"
    );
}

#[tokio::test]
async fn enqueue_jobs_batch_inserts_all_as_queued_and_claimable() {
    let db = Db::connect_in_memory().await.unwrap();
    // A batch spanning more than one insert chunk boundary is enqueued whole.
    let batch: Vec<NewJob> = (0..2500)
        .map(|i| new_job(&format!("j{i}"), "2026-06-23T00:00:00Z"))
        .collect();
    db.enqueue_jobs(batch).await.unwrap();

    // Every enqueued job is in flight (queued) — the batch analogue of a single
    // enqueue leaves each job claimable.
    let key = (
        "pong".to_string(),
        "v1.0.0".to_string(),
        "base".to_string(),
        // A job enqueued with no engine counts as a `none` job: an absent engine is the
        // engineless run, not an unknown one.
        "none".to_string(),
        "claude".to_string(),
        "claude-sonnet-4-5".to_string(),
        String::new(),
        String::new(),
    );
    assert_eq!(
        db.count_in_flight_jobs_by_cell(&["pong".to_string()])
            .await
            .unwrap()
            .get(&key)
            .copied(),
        Some(2500),
        "all batch-enqueued jobs are queued and counted in flight",
    );

    // And each is really claimable, not merely inserted.
    let claimed = db.claim_next_job("2026-06-23T00:00:05Z").await.unwrap();
    assert!(claimed.is_some(), "a batch-enqueued job is claimable");

    // An empty batch is a harmless no-op.
    db.enqueue_jobs(Vec::new()).await.unwrap();
}

#[tokio::test]
async fn claim_takes_the_first_enqueued_job_first() {
    let db = Db::connect_in_memory().await.unwrap();
    // Every job carries the *same* `created_at`, as a batch's runs do and as two
    // submissions inside one clock tick can: enqueue order alone decides.
    db.enqueue_job(new_job("first", "2026-06-23T00:00:00Z"))
        .await
        .unwrap();
    db.enqueue_job(new_job("second", "2026-06-23T00:00:00Z"))
        .await
        .unwrap();

    let first = db.claim_next_job("2026-06-23T01:00:00Z").await.unwrap();
    assert_eq!(
        first.unwrap().id,
        "first",
        "first enqueued is claimed first"
    );
    let second = db.claim_next_job("2026-06-23T01:00:01Z").await.unwrap();
    assert_eq!(second.unwrap().id, "second");
}

/// The queue is ordered by enqueue position, not by the `created_at` string — which
/// is stamped once per batch and compares lexicographically, so it cannot order a
/// batch's runs at all. An enqueue whose timestamp *looks* older than one already in
/// the queue still goes to the back.
#[tokio::test]
async fn claim_ignores_created_at_when_ordering_the_queue() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_job(new_job("enqueued-first", "2026-06-23T00:10:00Z"))
        .await
        .unwrap();
    db.enqueue_job(new_job("enqueued-second", "2026-06-23T00:00:00Z"))
        .await
        .unwrap();

    assert_eq!(
        db.claim_next_job("2026-06-23T01:00:00Z")
            .await
            .unwrap()
            .unwrap()
            .id,
        "enqueued-first",
    );
    assert_eq!(
        db.claim_next_job("2026-06-23T01:00:01Z")
            .await
            .unwrap()
            .unwrap()
            .id,
        "enqueued-second",
    );
}

/// A batch's runs dispatch in the order they were submitted. This is what makes
/// repeated runs reviewable: a console that lists a case's repeats together gets all
/// of that case's runs started — and so finished — before the next case's, instead of
/// the three cases interleaving arbitrarily.
#[tokio::test]
async fn claim_dispatches_a_batch_in_the_order_it_was_submitted() {
    let db = Db::connect_in_memory().await.unwrap();
    // Three repeats each of three cases, listed case-major, all sharing the single
    // `created_at` the batch endpoint stamps on every row.
    let submitted: Vec<String> = ["carom", "pinwheel", "drift"]
        .iter()
        .flat_map(|case| (1..=3).map(move |n| format!("{case}-{n}")))
        .collect();
    let batch: Vec<NewJob> = submitted
        .iter()
        .map(|id| NewJob {
            test_case_slug: id.rsplit_once('-').unwrap().0.to_string(),
            ..new_job(id, "2026-06-23T00:00:00Z")
        })
        .collect();
    db.enqueue_jobs(batch).await.unwrap();

    let mut dispatched = Vec::new();
    while let Some(job) = db.claim_next_job("2026-06-23T00:00:01Z").await.unwrap() {
        dispatched.push(job.id);
    }
    assert_eq!(
        dispatched, submitted,
        "the queue dispatches a batch in submission order, so each case's repeats run together",
    );
}

/// Batches keep their blocks of queue positions in submission order too: the second
/// batch's runs all follow the first batch's, never interleaving with them.
#[tokio::test]
async fn claim_dispatches_batches_in_the_order_they_were_submitted() {
    let db = Db::connect_in_memory().await.unwrap();
    for batch in ["a", "b"] {
        let jobs: Vec<NewJob> = (1..=3)
            .map(|n| new_job(&format!("{batch}{n}"), "2026-06-23T00:00:00Z"))
            .collect();
        db.enqueue_jobs(jobs).await.unwrap();
    }

    let mut dispatched = Vec::new();
    while let Some(job) = db.claim_next_job("2026-06-23T00:00:01Z").await.unwrap() {
        dispatched.push(job.id);
    }
    assert_eq!(dispatched, ["a1", "a2", "a3", "b1", "b2", "b3"]);
}

/// Every enqueue path shares one sequence: a single enqueue that follows a batch —
/// an automatic retry, or a one-off launch — lands behind it rather than ahead of it.
#[tokio::test]
async fn a_single_enqueue_after_a_batch_goes_to_the_back_of_the_queue() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_jobs(
        (1..=3)
            .map(|n| new_job(&format!("batch{n}"), "2026-06-23T00:00:00Z"))
            .collect(),
    )
    .await
    .unwrap();
    db.enqueue_job(new_job("single", "2026-06-23T00:00:00Z"))
        .await
        .unwrap();

    let mut dispatched = Vec::new();
    while let Some(job) = db.claim_next_job("2026-06-23T00:00:01Z").await.unwrap() {
        dispatched.push(job.id);
    }
    assert_eq!(dispatched, ["batch1", "batch2", "batch3", "single"]);
}

/// A job for a specific harness, otherwise identical to [`new_job`].
fn new_job_h(id: &str, created_at: &str, harness: &str) -> NewJob {
    NewJob {
        harness_slug: harness.to_string(),
        ..new_job(id, created_at)
    }
}

#[tokio::test]
async fn claim_respects_harness_max_parallelism_and_holds_pending() {
    let db = Db::connect_in_memory().await.unwrap();
    // Only one Claude run may be in flight at a time.
    db.set_harness_max_parallelism("claude", Some(1), "2026-06-23T00:00:00Z")
        .await
        .unwrap();
    db.enqueue_job(new_job_h("j1", "2026-06-23T00:00:00Z", "claude"))
        .await
        .unwrap();
    db.enqueue_job(new_job_h("j2", "2026-06-23T00:01:00Z", "claude"))
        .await
        .unwrap();

    // The first claim takes j1 (now occupying the harness's one slot).
    let first = db.claim_next_job("2026-06-23T00:02:00Z").await.unwrap();
    assert_eq!(first.expect("j1 is claimable").id, "j1");

    // The second claim finds nothing claimable — j2's harness is at its cap — and
    // reconciles j2's display state to `pending` so it reads as deliberately held.
    assert!(
        db.claim_next_job("2026-06-23T00:02:01Z")
            .await
            .unwrap()
            .is_none(),
        "j2 is held back by the harness cap"
    );
    let j2 = db.get_job("j2").await.unwrap().unwrap();
    assert_eq!(j2.state, "pending");

    // Once the in-flight run finishes, the slot frees and the held job is claimable.
    db.set_job_state("j1", "succeeded", "2026-06-23T00:03:00Z", None, None)
        .await
        .unwrap();
    let released = db.claim_next_job("2026-06-23T00:03:01Z").await.unwrap();
    assert_eq!(released.expect("j2 released once the slot freed").id, "j2");
}

#[tokio::test]
async fn claim_skips_a_capped_harness_for_another_that_has_room() {
    let db = Db::connect_in_memory().await.unwrap();
    db.set_harness_max_parallelism("claude", Some(1), "2026-06-23T00:00:00Z")
        .await
        .unwrap();
    // Two Claude jobs (older) and one Codex job (newest); Claude is capped at 1.
    db.enqueue_job(new_job_h("a", "2026-06-23T00:00:00Z", "claude"))
        .await
        .unwrap();
    db.enqueue_job(new_job_h("b", "2026-06-23T00:01:00Z", "claude"))
        .await
        .unwrap();
    db.enqueue_job(new_job_h("c", "2026-06-23T00:02:00Z", "codex"))
        .await
        .unwrap();

    // `a` fills Claude's only slot.
    assert_eq!(
        db.claim_next_job("2026-06-23T00:03:00Z")
            .await
            .unwrap()
            .unwrap()
            .id,
        "a"
    );
    // The next claim skips the now-capped Claude job `b` and takes the uncapped
    // Codex job `c` instead, even though `b` enqueued first.
    assert_eq!(
        db.claim_next_job("2026-06-23T00:03:01Z")
            .await
            .unwrap()
            .unwrap()
            .id,
        "c"
    );
    // `b` is left visibly held back.
    assert_eq!(db.get_job("b").await.unwrap().unwrap().state, "pending");
}

#[tokio::test]
async fn claim_is_unlimited_without_a_configured_cap() {
    let db = Db::connect_in_memory().await.unwrap();
    // No cap configured for claude, so both jobs are claimable back-to-back.
    db.enqueue_job(new_job_h("j1", "2026-06-23T00:00:00Z", "claude"))
        .await
        .unwrap();
    db.enqueue_job(new_job_h("j2", "2026-06-23T00:01:00Z", "claude"))
        .await
        .unwrap();

    assert_eq!(
        db.claim_next_job("2026-06-23T00:02:00Z")
            .await
            .unwrap()
            .unwrap()
            .id,
        "j1"
    );
    assert_eq!(
        db.claim_next_job("2026-06-23T00:02:01Z")
            .await
            .unwrap()
            .unwrap()
            .id,
        "j2"
    );
}

/// A queued **game-jam** job for a jam, harness, and model — the shape the
/// per-model jam serialization keys off.
fn new_jam_job(id: &str, created_at: &str, jam: &str, harness: &str, model: &str) -> NewJob {
    NewJob {
        test_case_slug: jam.to_string(),
        test_type: TestType::GameJam.as_str().to_string(),
        harness_slug: harness.to_string(),
        model_id: model.to_string(),
        ..new_job(id, created_at)
    }
}

/// A model's runs of one jam go one at a time, whichever harness drives them: the
/// second entry is held until the first finishes, because it is briefed with the
/// first's README.
#[tokio::test]
async fn claim_serializes_a_models_jam_runs_across_harnesses() {
    let db = Db::connect_in_memory().await.unwrap();
    // Three runs of the same jam by the same model — two on claude, one on codex.
    db.enqueue_job(new_jam_job(
        "j1",
        "2026-06-23T00:00:00Z",
        "comfort-zone",
        "claude",
        "sonnet",
    ))
    .await
    .unwrap();
    db.enqueue_job(new_jam_job(
        "j2",
        "2026-06-23T00:01:00Z",
        "comfort-zone",
        "claude",
        "sonnet",
    ))
    .await
    .unwrap();
    db.enqueue_job(new_jam_job(
        "j3",
        "2026-06-23T00:02:00Z",
        "comfort-zone",
        "codex",
        "sonnet",
    ))
    .await
    .unwrap();

    // The first entry dispatches; the rest wait their turn, visibly held.
    let first = db.claim_next_job("2026-06-23T00:03:00Z").await.unwrap();
    assert_eq!(first.expect("the first entry is claimable").id, "j1");
    assert!(
        db.claim_next_job("2026-06-23T00:03:01Z")
            .await
            .unwrap()
            .is_none(),
        "no other entry of this jam+model may run alongside the first"
    );
    assert_eq!(db.get_job("j2").await.unwrap().unwrap().state, "pending");
    assert_eq!(
        db.get_job("j3").await.unwrap().unwrap().state,
        "pending",
        "the other harness's entry waits too — the model is what repeats itself"
    );

    // Once the first finishes (and so has stored its README), the next is released.
    db.set_job_state("j1", "succeeded", "2026-06-23T01:00:00Z", None, None)
        .await
        .unwrap();
    let second = db.claim_next_job("2026-06-23T01:00:01Z").await.unwrap();
    assert_eq!(second.expect("the second entry is released").id, "j2");
}

/// The serialization is per jam **and** per model: different jams, and different
/// models on the same jam, still dispatch in parallel — they share no history.
#[tokio::test]
async fn claim_runs_different_jams_and_models_in_parallel() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_job(new_jam_job(
        "same-jam-other-model",
        "2026-06-23T00:00:00Z",
        "comfort-zone",
        "claude",
        "sonnet",
    ))
    .await
    .unwrap();
    db.enqueue_job(new_jam_job(
        "other-jam-same-model",
        "2026-06-23T00:01:00Z",
        "plot-twist",
        "claude",
        "opus",
    ))
    .await
    .unwrap();
    db.enqueue_job(new_jam_job(
        "same-jam-same-model",
        "2026-06-23T00:02:00Z",
        "comfort-zone",
        "claude",
        "opus",
    ))
    .await
    .unwrap();

    for expected in [
        "same-jam-other-model",
        "other-jam-same-model",
        "same-jam-same-model",
    ] {
        let claimed = db.claim_next_job("2026-06-23T00:03:00Z").await.unwrap();
        assert_eq!(
            claimed.expect("each pair is independent").id,
            expected,
            "jam runs only serialize against the same jam + model"
        );
    }
}

/// The jam rule does not leak into the other test types: two runs of the same
/// ordinary case by the same model still dispatch together.
#[tokio::test]
async fn claim_does_not_serialize_non_jam_runs_of_one_model() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_job(new_job("j1", "2026-06-23T00:00:00Z"))
        .await
        .unwrap();
    db.enqueue_job(new_job("j2", "2026-06-23T00:01:00Z"))
        .await
        .unwrap();

    assert_eq!(
        db.claim_next_job("2026-06-23T00:02:00Z")
            .await
            .unwrap()
            .unwrap()
            .id,
        "j1"
    );
    assert_eq!(
        db.claim_next_job("2026-06-23T00:02:01Z")
            .await
            .unwrap()
            .unwrap()
            .id,
        "j2",
        "an end-to-end case has no per-run history to wait for"
    );
}

#[tokio::test]
async fn set_harness_max_parallelism_upserts_and_clears() {
    let db = Db::connect_in_memory().await.unwrap();
    db.set_harness_max_parallelism("claude", Some(3), "2026-06-23T00:00:00Z")
        .await
        .unwrap();
    let rows = db.list_harness_configs().await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].harness_slug, "claude");
    assert_eq!(rows[0].max_parallelism, Some(3));

    // Upsert the same harness to a new value.
    db.set_harness_max_parallelism("claude", Some(5), "2026-06-23T00:01:00Z")
        .await
        .unwrap();
    let rows = db.list_harness_configs().await.unwrap();
    assert_eq!(rows.len(), 1, "upsert, not a second row");
    assert_eq!(rows[0].max_parallelism, Some(5));

    // Clearing the limit keeps the row but stores NULL (no limit).
    db.set_harness_max_parallelism("claude", None, "2026-06-23T00:02:00Z")
        .await
        .unwrap();
    let rows = db.list_harness_configs().await.unwrap();
    assert_eq!(rows[0].max_parallelism, None);
}

#[tokio::test]
async fn set_job_state_records_terminal_detail_and_record_id() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_job(new_job("j1", "2026-06-23T00:00:00Z"))
        .await
        .unwrap();

    db.set_job_state("j1", "running", "2026-06-23T00:01:00Z", None, None)
        .await
        .unwrap()
        .expect("the job exists");
    let succeeded = db
        .set_job_state(
            "j1",
            "succeeded",
            "2026-06-23T00:50:00Z",
            None,
            Some("record-7"),
        )
        .await
        .unwrap()
        .expect("the job exists");
    assert_eq!(succeeded.state, "succeeded");
    assert_eq!(succeeded.record_id.as_deref(), Some("record-7"));
    assert!(succeeded.detail.is_none());

    // An unknown job yields None rather than erroring.
    assert!(
        db.set_job_state("missing", "running", "2026-06-23T00:00:00Z", None, None)
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn set_job_state_stamps_the_run_start_once_it_actually_starts() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_job(new_job("j1", "2026-06-23T00:00:00Z"))
        .await
        .unwrap();

    // Queued and dispatched are both still waiting on something: the run has not begun,
    // so there is no start time and the console shows a dash. Dispatch in particular is
    // pod scheduling and the image pull, which the run is not billed for.
    let queued = db.get_job("j1").await.unwrap().expect("the job exists");
    assert!(queued.started_at.is_none());
    let dispatched = db
        .set_job_state("j1", "dispatched", "2026-06-23T00:01:00Z", None, None)
        .await
        .unwrap()
        .expect("the job exists");
    assert!(dispatched.started_at.is_none());

    // `starting` is the anchor: the driver posts it immediately before taking the
    // `started_at` its produced record is measured from.
    let starting = db
        .set_job_state("j1", "starting", "2026-06-23T00:02:00Z", None, None)
        .await
        .unwrap()
        .expect("the job exists");
    assert_eq!(starting.started_at.as_deref(), Some("2026-06-23T00:02:00Z"));

    // The `running` report that follows setup must not restart the clock — that setup
    // is inside the run time the finished record reports, so a duration re-anchored
    // here would disagree with the figure the finished row shows.
    let running = db
        .set_job_state("j1", "running", "2026-06-23T00:05:00Z", None, None)
        .await
        .unwrap()
        .expect("the job exists");
    assert_eq!(running.started_at.as_deref(), Some("2026-06-23T00:02:00Z"));

    // Nor does reaching a terminal state rewrite it.
    let succeeded = db
        .set_job_state("j1", "succeeded", "2026-06-23T00:50:00Z", None, Some("r1"))
        .await
        .unwrap()
        .expect("the job exists");
    assert_eq!(
        succeeded.started_at.as_deref(),
        Some("2026-06-23T00:02:00Z")
    );
}

#[tokio::test]
async fn a_driver_that_skipped_starting_still_anchors_its_run_on_running() {
    // The defensive half of the rule. A row the console is showing as running with no
    // start time at all is worse than one anchored a few seconds late, so `running`
    // stamps the anchor when nothing before it did.
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_job(new_job("j1", "2026-06-23T00:00:00Z"))
        .await
        .unwrap();

    let running = db
        .set_job_state("j1", "running", "2026-06-23T00:01:00Z", None, None)
        .await
        .unwrap()
        .expect("the job exists");
    assert_eq!(running.started_at.as_deref(), Some("2026-06-23T00:01:00Z"));
}

#[tokio::test]
async fn cancel_job_moves_a_non_terminal_job_to_canceled_with_its_reason() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_job(new_job("j1", "2026-06-23T00:00:00Z"))
        .await
        .unwrap();
    db.set_job_state("j1", "running", "2026-06-23T00:01:00Z", None, None)
        .await
        .unwrap();

    let canceled = db
        .cancel_job("j1", "2026-06-23T00:02:00Z", "canceled by operator")
        .await
        .unwrap()
        .expect("a running job is cancelable");
    assert_eq!(canceled.state, "canceled");
    assert_eq!(canceled.detail.as_deref(), Some("canceled by operator"));

    // A canceled job no longer counts as in flight.
    assert!(db.active_jobs().await.unwrap().is_empty());
}

#[tokio::test]
async fn cancel_job_refuses_a_terminal_or_unknown_job() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_job(new_job("done", "2026-06-23T00:00:00Z"))
        .await
        .unwrap();
    db.set_job_state(
        "done",
        "succeeded",
        "2026-06-23T00:05:00Z",
        None,
        Some("r1"),
    )
    .await
    .unwrap();

    // A finished job cannot be canceled — `cancel_job` transitions only from a
    // non-terminal state, so it reports no change and leaves the row untouched.
    assert!(
        db.cancel_job("done", "2026-06-23T00:06:00Z", "canceled by operator")
            .await
            .unwrap()
            .is_none()
    );
    let still = db.get_job("done").await.unwrap().expect("the job exists");
    assert_eq!(still.state, "succeeded");

    // An unknown job is likewise a no-op None rather than an error.
    assert!(
        db.cancel_job("missing", "2026-06-23T00:06:00Z", "canceled by operator")
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn set_job_state_never_overwrites_a_canceled_job() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_job(new_job("j1", "2026-06-23T00:00:00Z"))
        .await
        .unwrap();
    db.cancel_job("j1", "2026-06-23T00:01:00Z", "canceled by operator")
        .await
        .unwrap()
        .expect("a queued job is cancelable");

    // A late report from the still-winding-down driver must not resurrect or
    // overwrite the canceled run: `set_job_state` leaves it untouched (None).
    assert!(
        db.set_job_state("j1", "succeeded", "2026-06-23T00:02:00Z", None, Some("r1"))
            .await
            .unwrap()
            .is_none()
    );
    let still = db.get_job("j1").await.unwrap().expect("the job exists");
    assert_eq!(still.state, "canceled");
    assert!(still.record_id.is_none());
}

#[tokio::test]
async fn attach_canceled_job_record_keeps_the_kill_but_retains_the_record() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_job(new_job("j1", "2026-06-23T00:00:00Z"))
        .await
        .unwrap();
    db.cancel_job("j1", "2026-06-23T00:01:00Z", "canceled by operator")
        .await
        .unwrap()
        .expect("a queued job is cancelable");

    // The killed run's driver hands back the partial record it built. It is
    // attached, but nothing else about the canceled job moves: without this the
    // record would be discarded and the killed run would vanish from the run list.
    let attached = db
        .attach_canceled_job_record("j1", "r1", "2026-06-23T00:02:00Z")
        .await
        .unwrap()
        .expect("a canceled job accepts its record");
    assert_eq!(attached.record_id.as_deref(), Some("r1"));
    assert_eq!(attached.state, "canceled");
    assert_eq!(attached.detail.as_deref(), Some("canceled by operator"));

    // A duplicate report from a still-winding-down driver cannot overwrite it.
    assert!(
        db.attach_canceled_job_record("j1", "r2", "2026-06-23T00:03:00Z")
            .await
            .unwrap()
            .is_none()
    );
    let still = db.get_job("j1").await.unwrap().expect("the job exists");
    assert_eq!(still.record_id.as_deref(), Some("r1"));
}

#[tokio::test]
async fn attach_canceled_job_record_refuses_a_job_that_was_not_canceled() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_job(new_job("j1", "2026-06-23T00:00:00Z"))
        .await
        .unwrap();
    db.set_job_state("j1", "running", "2026-06-23T00:01:00Z", None, None)
        .await
        .unwrap();

    // Only a canceled job takes this path; a live one keeps its normal transitions.
    assert!(
        db.attach_canceled_job_record("j1", "r1", "2026-06-23T00:02:00Z")
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        db.attach_canceled_job_record("missing", "r1", "2026-06-23T00:02:00Z")
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn active_jobs_excludes_terminal_jobs_oldest_first() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_job(new_job("a", "2026-06-23T00:00:00Z"))
        .await
        .unwrap();
    db.enqueue_job(new_job("b", "2026-06-23T00:01:00Z"))
        .await
        .unwrap();
    db.enqueue_job(new_job("c", "2026-06-23T00:02:00Z"))
        .await
        .unwrap();
    // b finishes; a and c stay in flight.
    db.set_job_state("b", "succeeded", "2026-06-23T00:30:00Z", None, Some("r-b"))
        .await
        .unwrap();

    let active = db.active_jobs().await.unwrap();
    let ids: Vec<&str> = active.iter().map(|j| j.id.as_str()).collect();
    assert_eq!(
        ids,
        vec!["a", "c"],
        "terminal jobs are excluded, oldest first"
    );
}

#[tokio::test]
async fn fail_in_flight_jobs_reaps_only_executing_jobs() {
    let db = Db::connect_in_memory().await.unwrap();
    // q stays queued (no driver yet); d is dispatched; r is running; s succeeded.
    db.enqueue_job(new_job("q", "2026-06-23T00:00:00Z"))
        .await
        .unwrap();
    db.enqueue_job(new_job("d", "2026-06-23T00:01:00Z"))
        .await
        .unwrap();
    db.set_job_state("d", "dispatched", "2026-06-23T00:01:30Z", None, None)
        .await
        .unwrap();
    db.enqueue_job(new_job("r", "2026-06-23T00:02:00Z"))
        .await
        .unwrap();
    db.set_job_state("r", "running", "2026-06-23T00:02:30Z", None, None)
        .await
        .unwrap();
    db.enqueue_job(new_job("s", "2026-06-23T00:03:00Z"))
        .await
        .unwrap();
    db.set_job_state("s", "succeeded", "2026-06-23T00:30:00Z", None, Some("r-s"))
        .await
        .unwrap();

    let reaped = db
        .fail_in_flight_jobs("2026-06-23T01:00:00Z", "interrupted")
        .await
        .unwrap();
    assert_eq!(reaped, 2, "only the dispatched and running jobs are reaped");

    // The two executing jobs are now terminal failures with the stamped detail.
    for id in ["d", "r"] {
        let job = db.get_job(id).await.unwrap().expect("the job exists");
        assert_eq!(job.state, "failed");
        assert_eq!(job.detail.as_deref(), Some("interrupted"));
        assert_eq!(job.updated_at, "2026-06-23T01:00:00Z");
    }
    // The queued job is untouched, ready for the dispatcher to drain.
    assert_eq!(db.get_job("q").await.unwrap().unwrap().state, "queued");
    // The already-terminal succeeded job keeps its outcome.
    let s = db.get_job("s").await.unwrap().unwrap();
    assert_eq!(s.state, "succeeded");
    assert_eq!(s.record_id.as_deref(), Some("r-s"));

    // The active-run list is now just the still-queued job.
    let active = db.active_jobs().await.unwrap();
    let ids: Vec<&str> = active.iter().map(|j| j.id.as_str()).collect();
    assert_eq!(ids, vec!["q"]);
}

#[tokio::test]
async fn fail_in_flight_jobs_is_a_noop_with_nothing_executing() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_job(new_job("q", "2026-06-23T00:00:00Z"))
        .await
        .unwrap();

    let reaped = db
        .fail_in_flight_jobs("2026-06-23T01:00:00Z", "interrupted")
        .await
        .unwrap();
    assert_eq!(reaped, 0);
    assert_eq!(db.get_job("q").await.unwrap().unwrap().state, "queued");
}

#[tokio::test]
async fn publish_refuses_an_infrastructure_failure_even_with_a_review() {
    let db = Db::connect_in_memory().await.unwrap();
    // An infrastructure failure is the Test Cabinet's fault, never publishable —
    // even if someone attached a review.
    let mut rec = record("i1");
    rec.status.state = RunState::Infrastructure;
    db.push(&rec, &RunLinks::default(), None, None)
        .await
        .unwrap();
    db.add_review("i1", &review(), None, None).await.unwrap();

    let err = db
        .publish("i1", "2026-06-23T00:00:00Z")
        .await
        .expect_err("an infrastructure failure must never be publishable");
    assert!(
        matches!(err, crate::error::BackendError::Unprocessable(_)),
        "got {err:?}"
    );
}

#[tokio::test]
async fn publish_refuses_a_canceled_run_even_with_a_review() {
    let db = Db::connect_in_memory().await.unwrap();
    // A killed run is retained so it stays inspectable, but an operator stopping a
    // run says nothing about the model — it can never be published, review or not.
    let mut rec = record("k1");
    rec.status.state = RunState::Canceled;
    db.push(&rec, &RunLinks::default(), None, None)
        .await
        .unwrap();
    db.add_review("k1", &review(), None, None).await.unwrap();

    let err = db
        .publish("k1", "2026-06-23T00:00:00Z")
        .await
        .expect_err("a canceled run must never be publishable");
    match err {
        crate::error::BackendError::Unprocessable(message) => assert!(
            message.contains("canceled by an operator"),
            "the refusal must name the actual reason, got {message:?}",
        ),
        other => panic!("got {other:?}"),
    }
}

#[tokio::test]
async fn publish_allows_a_failure_tier_without_any_review() {
    let db = Db::connect_in_memory().await.unwrap();
    // Catastrophic and timed-out runs are publishable model signal with no review
    // checklist — they publish through the failures path with zero reviews.
    for (id, state) in [
        ("cat1", RunState::Catastrophic),
        ("to1", RunState::TimedOut),
    ] {
        let mut rec = record(id);
        rec.status.state = state;
        db.push(&rec, &RunLinks::default(), None, None)
            .await
            .unwrap();

        let outcome = db.publish(id, "2026-06-23T00:00:00Z").await.unwrap();
        assert!(
            outcome.newly_published,
            "{id} should publish with no review"
        );
        assert!(db.get_run(id).await.unwrap().unwrap().published);
    }
}

#[tokio::test]
async fn worklist_holds_completed_runs_and_failures_path_holds_the_rest() {
    let db = Db::connect_in_memory().await.unwrap();
    for (id, state) in [
        ("done", RunState::Completed),
        ("cat", RunState::Catastrophic),
        ("slow", RunState::TimedOut),
        ("harness", RunState::HarnessError),
        ("infra", RunState::Infrastructure),
        ("killed", RunState::Canceled),
    ] {
        let mut rec = record(id);
        rec.status.state = state;
        db.push(&rec, &RunLinks::default(), None, None)
            .await
            .unwrap();
    }

    let (review, _) = db.list_for_review(50, None).await.unwrap();
    let review_ids: Vec<&str> = review.iter().map(|r| r.record.id.as_str()).collect();
    assert_eq!(
        review_ids,
        vec!["done"],
        "only completed runs are reviewable"
    );

    let (failures, _) = db.list_publishable_failures(50, None).await.unwrap();
    let mut failure_ids: Vec<&str> = failures.iter().map(|r| r.record.id.as_str()).collect();
    failure_ids.sort_unstable();
    assert_eq!(
        failure_ids,
        vec!["cat", "harness", "slow"],
        "publishable failures cover catastrophic/timed-out/harness-error but exclude \
         infrastructure and canceled"
    );

    // The console's produced worklist carries every unpublished run whatever its
    // tier — including the two that appear in neither worklist above, the
    // infrastructure failure and the run an operator killed — so both stay
    // inspectable rather than vanishing.
    let (unpublished, _) = db.list_unpublished(50, None).await.unwrap();
    let mut unpublished_ids: Vec<&str> = unpublished.iter().map(|r| r.record.id.as_str()).collect();
    unpublished_ids.sort_unstable();
    assert_eq!(
        unpublished_ids,
        vec!["cat", "done", "harness", "infra", "killed", "slow"],
        "every unpublished run, all tiers, is in the produced worklist"
    );

    // Publishing one drops it from the produced worklist (it is now the public
    // read side), leaving the worklist disjoint from the published listing.
    db.publish("cat", "2026-06-23T00:00:00Z").await.unwrap();
    let (after, _) = db.list_unpublished(50, None).await.unwrap();
    let mut after_ids: Vec<&str> = after.iter().map(|r| r.record.id.as_str()).collect();
    after_ids.sort_unstable();
    assert_eq!(
        after_ids,
        vec!["done", "harness", "infra", "killed", "slow"],
        "a published run leaves the unpublished worklist"
    );
}

// --- Publish queue ----------------------------------------------------------

fn new_publish_job(id: &str, run_id: &str, created_at: &str) -> NewPublishJob {
    NewPublishJob {
        id: id.to_string(),
        run_id: run_id.to_string(),
        job_token: format!("ptoken-{id}"),
        created_at: created_at.to_string(),
    }
}

#[tokio::test]
async fn enqueue_then_claim_publish_job_flips_queued_to_dispatched_then_drains() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_publish_job(new_publish_job("p1", "r1", "2026-06-27T00:00:00Z"))
        .await
        .unwrap();

    let claimed = db
        .claim_next_publish_job("2026-06-27T00:00:05Z")
        .await
        .unwrap()
        .expect("the queued publish job is claimable");
    assert_eq!(claimed.id, "p1");
    assert_eq!(claimed.run_id, "r1");
    assert_eq!(claimed.state, "dispatched");
    assert_eq!(claimed.job_token, "ptoken-p1");

    // A claimed publish job is no longer queued, so a second claim finds nothing.
    assert!(
        db.claim_next_publish_job("2026-06-27T00:00:06Z")
            .await
            .unwrap()
            .is_none(),
        "the publish queue is drained"
    );
}

#[tokio::test]
async fn claim_takes_the_oldest_queued_publish_job_first() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_publish_job(new_publish_job("newer", "r2", "2026-06-27T00:10:00Z"))
        .await
        .unwrap();
    db.enqueue_publish_job(new_publish_job("older", "r1", "2026-06-27T00:00:00Z"))
        .await
        .unwrap();

    let first = db
        .claim_next_publish_job("2026-06-27T01:00:00Z")
        .await
        .unwrap();
    assert_eq!(
        first.unwrap().id,
        "older",
        "oldest enqueued is claimed first"
    );
    let second = db
        .claim_next_publish_job("2026-06-27T01:00:01Z")
        .await
        .unwrap();
    assert_eq!(second.unwrap().id, "newer");
}

#[tokio::test]
async fn ensure_publishable_mirrors_the_publish_gate() {
    let db = Db::connect_in_memory().await.unwrap();

    // A completed run with no review is refused, exactly like `publish`.
    db.push(&record("r1"), &links(), None, None).await.unwrap();
    let err = db.ensure_publishable("r1").await.unwrap_err();
    assert!(matches!(err, crate::error::BackendError::Unprocessable(_)));

    // With a review it passes (without flipping anything).
    db.add_review("r1", &review(), None, None).await.unwrap();
    db.ensure_publishable("r1").await.unwrap();
    assert!(
        !db.get_run("r1").await.unwrap().unwrap().published,
        "the gate does not publish"
    );

    // An infrastructure failure is refused even with a review.
    let mut infra = record("infra");
    infra.status.state = RunState::Infrastructure;
    db.push(&infra, &RunLinks::default(), None, None)
        .await
        .unwrap();
    db.add_review("infra", &review(), None, None).await.unwrap();
    let err = db.ensure_publishable("infra").await.unwrap_err();
    assert!(matches!(err, crate::error::BackendError::Unprocessable(_)));

    // A publishable failure tier passes with no review at all.
    let mut cat = record("cat");
    cat.status.state = RunState::Catastrophic;
    db.push(&cat, &RunLinks::default(), None, None)
        .await
        .unwrap();
    db.ensure_publishable("cat").await.unwrap();

    // A harness error is likewise a publishable failure — no review required.
    let mut harness = record("harness");
    harness.status.state = RunState::HarnessError;
    db.push(&harness, &RunLinks::default(), None, None)
        .await
        .unwrap();
    db.ensure_publishable("harness").await.unwrap();

    // An unknown run is not found.
    let err = db.ensure_publishable("nope").await.unwrap_err();
    assert!(matches!(err, crate::error::BackendError::NotFound(_)));
}

#[tokio::test]
async fn complete_publish_job_attaches_links_flips_published_and_marks_the_job() {
    let db = Db::connect_in_memory().await.unwrap();
    // A reviewed but not-yet-published run, pushed with no links.
    db.push(&record("r1"), &RunLinks::default(), None, None)
        .await
        .unwrap();
    db.add_review("r1", &review(), None, None).await.unwrap();
    db.enqueue_publish_job(new_publish_job("p1", "r1", "2026-06-27T00:00:00Z"))
        .await
        .unwrap();
    let before = stamp(&lifted(&db, "r1").await.updated_at);

    let outcome = db
        .complete_publish_job(
            "p1",
            "r1",
            Some("https://github.com/x/y"),
            Some("https://abc.pages.dev"),
            "2026-06-27T01:00:00Z",
        )
        .await
        .unwrap();
    assert!(outcome.newly_published);

    // The run is published, the links are on both the sibling and the record blob,
    // and the snapshot is dirty.
    let stored = db.get_run("r1").await.unwrap().unwrap();
    assert!(stored.published);
    assert_eq!(stored.published_at.as_deref(), Some("2026-06-27T01:00:00Z"));
    assert_eq!(
        stored.links.source_repo.as_deref(),
        Some("https://github.com/x/y")
    );
    assert_eq!(
        stored.record.links.playable_build.as_deref(),
        Some("https://abc.pages.dev"),
        "the record blob's links agree with the sibling"
    );
    assert!(db.snapshot_state().await.unwrap().dirty);

    // This is the publish path the queue actually takes, and it rewrites the record
    // blob as well as flipping the run, so it stamps the mutation timestamp exactly
    // as the synchronous `publish` does.
    let after = stamp(&lifted(&db, "r1").await.updated_at);
    assert!(
        before < after,
        "completing a publish job must move the stamp: {before} !< {after}"
    );

    // The publish job is marked succeeded with the same links.
    let job = db.get_publish_job("p1").await.unwrap().unwrap();
    assert_eq!(job.state, "succeeded");
    assert_eq!(job.source_repo.as_deref(), Some("https://github.com/x/y"));
    assert_eq!(job.updated_at, "2026-06-27T01:00:00Z");
}

#[tokio::test]
async fn complete_publish_job_preserves_an_existing_published_at() {
    let db = Db::connect_in_memory().await.unwrap();
    push_review_publish(&db, "r1", "2026-06-27T00:00:00Z").await;
    db.enqueue_publish_job(new_publish_job("p1", "r1", "2026-06-27T00:30:00Z"))
        .await
        .unwrap();

    let outcome = db
        .complete_publish_job("p1", "r1", None, None, "2026-06-27T02:00:00Z")
        .await
        .unwrap();
    assert!(
        !outcome.newly_published,
        "re-publishing an already-published run is not newly published"
    );
    let stored = db.get_run("r1").await.unwrap().unwrap();
    assert_eq!(
        stored.published_at.as_deref(),
        Some("2026-06-27T00:00:00Z"),
        "the first publish's timestamp is preserved"
    );
}

#[tokio::test]
async fn complete_publish_job_is_not_found_for_a_missing_run() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_publish_job(new_publish_job("p1", "missing", "2026-06-27T00:00:00Z"))
        .await
        .unwrap();
    let err = db
        .complete_publish_job("p1", "missing", None, None, "2026-06-27T01:00:00Z")
        .await
        .unwrap_err();
    assert!(matches!(err, crate::error::BackendError::NotFound(_)));
}

#[tokio::test]
async fn set_publish_job_state_records_a_failure_detail() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_publish_job(new_publish_job("p1", "r1", "2026-06-27T00:00:00Z"))
        .await
        .unwrap();

    let failed = db
        .set_publish_job_state(
            "p1",
            "failed",
            "2026-06-27T01:00:00Z",
            Some("wrangler exploded"),
        )
        .await
        .unwrap()
        .expect("the publish job exists");
    assert_eq!(failed.state, "failed");
    assert_eq!(failed.detail.as_deref(), Some("wrangler exploded"));

    // An unknown publish job yields None rather than erroring.
    assert!(
        db.set_publish_job_state("missing", "failed", "2026-06-27T01:00:00Z", None)
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn active_publish_job_for_run_finds_a_queued_job() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_publish_job(new_publish_job("p1", "r1", "2026-06-27T00:00:00Z"))
        .await
        .unwrap();

    let active = db
        .active_publish_job_for_run("r1", "2026-06-27T00:00:05Z")
        .await
        .unwrap()
        .expect("a queued publish job is a release already under way");
    assert_eq!(active.id, "p1");
    assert_eq!(active.state, "queued");

    // Another run's publishing is unaffected.
    assert!(
        db.active_publish_job_for_run("r2", "2026-06-27T00:00:05Z")
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn active_publish_job_for_run_finds_a_recently_dispatched_job() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_publish_job(new_publish_job("p1", "r1", "2026-06-27T00:00:00Z"))
        .await
        .unwrap();
    db.claim_next_publish_job("2026-06-27T00:00:10Z")
        .await
        .unwrap()
        .expect("the queued job is claimable");

    // A publisher is carrying this one out right now: a second publish must not be
    // enqueued alongside it, or the run gets two Pages deployments.
    let active = db
        .active_publish_job_for_run("r1", "2026-06-27T00:05:00Z")
        .await
        .unwrap()
        .expect("a freshly dispatched publish job is still under way");
    assert_eq!(active.id, "p1");
    assert_eq!(active.state, "dispatched");
}

#[tokio::test]
async fn active_publish_job_for_run_ignores_a_dispatched_job_gone_stale() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_publish_job(new_publish_job("p1", "r1", "2026-06-27T00:00:00Z"))
        .await
        .unwrap();
    db.claim_next_publish_job("2026-06-27T00:00:10Z")
        .await
        .unwrap()
        .unwrap();

    // Nothing reaps a publish job whose publisher died before reporting, so past the
    // staleness cutoff it must stop blocking — otherwise the run could never be
    // published again.
    assert!(
        db.active_publish_job_for_run("r1", "2026-06-27T02:00:00Z")
            .await
            .unwrap()
            .is_none(),
        "a dispatched job quiet for hours is abandoned, not active"
    );

    // Just inside the window it still blocks.
    assert!(
        db.active_publish_job_for_run("r1", "2026-06-27T00:59:00Z")
            .await
            .unwrap()
            .is_some(),
        "a dispatched job within the window is still under way"
    );
}

#[tokio::test]
async fn active_publish_job_for_run_ignores_terminal_jobs() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_publish_job(new_publish_job("p1", "r1", "2026-06-27T00:00:00Z"))
        .await
        .unwrap();
    db.set_publish_job_state(
        "p1",
        "failed",
        "2026-06-27T00:01:00Z",
        Some("wrangler died"),
    )
    .await
    .unwrap();

    // A failed publish must stay retryable — it cannot block the next attempt.
    assert!(
        db.active_publish_job_for_run("r1", "2026-06-27T00:02:00Z")
            .await
            .unwrap()
            .is_none()
    );

    db.enqueue_publish_job(new_publish_job("p2", "r1", "2026-06-27T00:03:00Z"))
        .await
        .unwrap();
    db.set_publish_job_state("p2", "succeeded", "2026-06-27T00:04:00Z", None)
        .await
        .unwrap();
    assert!(
        db.active_publish_job_for_run("r1", "2026-06-27T00:05:00Z")
            .await
            .unwrap()
            .is_none(),
        "a completed publish is not a release under way"
    );
}

#[tokio::test]
async fn active_publish_job_for_run_returns_the_oldest_live_job() {
    let db = Db::connect_in_memory().await.unwrap();
    // Two live jobs can only coexist across states (the unique index forbids two
    // queued ones): claim the first so it is dispatched, then queue another.
    db.enqueue_publish_job(new_publish_job("p1", "r1", "2026-06-27T00:00:00Z"))
        .await
        .unwrap();
    db.claim_next_publish_job("2026-06-27T00:00:10Z")
        .await
        .unwrap()
        .unwrap();
    db.enqueue_publish_job(new_publish_job("p2", "r1", "2026-06-27T00:01:00Z"))
        .await
        .unwrap();

    let active = db
        .active_publish_job_for_run("r1", "2026-06-27T00:02:00Z")
        .await
        .unwrap()
        .expect("a live job");
    assert_eq!(
        active.id, "p1",
        "the caller re-attaches to the publish that started first"
    );
}

#[tokio::test]
async fn a_second_queued_publish_job_for_one_run_is_refused_by_the_database() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_publish_job(new_publish_job("p1", "r1", "2026-06-27T00:00:00Z"))
        .await
        .unwrap();

    // The partial unique index is the backstop under the application-level check:
    // two concurrent enqueues that both pass `active_publish_job_for_run` cannot both
    // land a queued job for the same run.
    assert!(
        db.enqueue_publish_job(new_publish_job("p2", "r1", "2026-06-27T00:00:01Z"))
            .await
            .is_err(),
        "a second queued publish job for the same run must be refused"
    );

    // A different run is unaffected, and so is a re-publish once the first is done.
    db.enqueue_publish_job(new_publish_job("p3", "r2", "2026-06-27T00:00:02Z"))
        .await
        .unwrap();
    db.set_publish_job_state("p1", "failed", "2026-06-27T00:01:00Z", None)
        .await
        .unwrap();
    db.enqueue_publish_job(new_publish_job("p4", "r1", "2026-06-27T00:02:00Z"))
        .await
        .expect("a retry after a failed publish is allowed");
}

#[tokio::test]
async fn referenced_cases_returns_distinct_pairs_including_pending_runs() {
    let db = Db::connect_in_memory().await.unwrap();

    // Two pending runs of pong@v1.0.0 (should collapse to one pair), one run of a
    // different case, and one of a different version of pong.
    db.push(&record("r1"), &links(), None, None).await.unwrap();
    db.push(&record("r2"), &links(), None, None).await.unwrap();
    let mut other = record("r3");
    other.subject.test_case_slug = "carom".to_string();
    other.subject.test_case_version = "v2.0.0".to_string();
    db.push(&other, &links(), None, None).await.unwrap();
    let mut pong_v2 = record("r4");
    pong_v2.subject.test_case_version = "v1.1.0".to_string();
    db.push(&pong_v2, &links(), None, None).await.unwrap();

    let refs = db.referenced_cases().await.unwrap();
    // Pending runs count — a definition a pushed-but-unpublished run needs must be
    // spared too — and duplicate pairs collapse.
    assert_eq!(
        refs,
        std::collections::HashSet::from([
            ("pong".to_string(), "v1.0.0".to_string()),
            ("pong".to_string(), "v1.1.0".to_string()),
            ("carom".to_string(), "v2.0.0".to_string()),
        ])
    );
}

// --- Model catalog store ---

use std::collections::HashMap;
use test_cabinet_core::metrics::{Cost, TokenCounts, TokenPrices};

/// Tag a test alias with a plausible family (OpenRouter for a `provider/model`
/// id, Claude for a bare native id — enough for the CRUD tests here).
fn test_alias(alias: &str) -> AliasEntry {
    AliasEntry {
        alias: alias.to_string(),
        family: if alias.contains('/') {
            HarnessFamily::Openrouter
        } else {
            HarnessFamily::Claude
        },
    }
}

/// A model-config write with the common fields defaulted.
fn model_write(slug: &str, name: &str, aliases: &[&str]) -> ModelConfigWrite {
    ModelConfigWrite {
        slug: slug.to_string(),
        display_name: name.to_string(),
        provider: "Anthropic".to_string(),
        provider_logo_url: None,
        provider_logo_svg: None,
        description_md: None,
        openrouter_slug: aliases.first().map(|a| a.to_string()),
        provider_pin: None,
        aliases: aliases.iter().map(|a| test_alias(a)).collect(),
        now: "2026-07-09T00:00:00Z".to_string(),
        ..Default::default()
    }
}

/// A run record with an explicit model id + harness (and, optionally, token
/// counts), for the derive/normalize tests.
fn run_with_model(
    id: &str,
    model_id: &str,
    harness: HarnessSlug,
    tokens: TokenCounts,
) -> RunRecord {
    let mut r = record(id);
    r.subject.model_id = model_id.to_string();
    r.subject.harness_slug = harness;
    r.metrics.tokens = tokens;
    r
}

#[tokio::test]
async fn model_config_crud_and_alias_conflict() {
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(model_write(
        "opus",
        "Claude Opus 4.8",
        &["claude-opus-4-8", "anthropic/claude-opus-4.8"],
    ))
    .await
    .unwrap();

    let got = db.get_model_config("opus").await.unwrap().unwrap();
    assert_eq!(got.config.display_name, "Claude Opus 4.8");
    let alias_slugs: Vec<&str> = got.aliases.iter().map(|a| a.alias.as_str()).collect();
    assert_eq!(
        alias_slugs,
        vec!["anthropic/claude-opus-4.8", "claude-opus-4-8"]
    );
    // The family round-trips through the store.
    assert_eq!(
        got.aliases
            .iter()
            .find(|a| a.alias == "claude-opus-4-8")
            .map(|a| a.family),
        Some(HarnessFamily::Claude)
    );
    assert_eq!(
        got.aliases
            .iter()
            .find(|a| a.alias == "anthropic/claude-opus-4.8")
            .map(|a| a.family),
        Some(HarnessFamily::Openrouter)
    );

    // A second model claiming an alias the first owns is a conflict.
    let err = db
        .upsert_model_config(model_write(
            "sonnet",
            "Claude Sonnet 5",
            &["anthropic/claude-opus-4.8"],
        ))
        .await
        .unwrap_err();
    assert!(
        matches!(err, crate::error::BackendError::Conflict(_)),
        "{err:?}"
    );

    // Updating the same model replaces its alias set and keeps created_at.
    db.upsert_model_config(ModelConfigWrite {
        display_name: "Opus (renamed)".to_string(),
        aliases: vec![test_alias("claude-opus-4-8")],
        now: "2026-08-01T00:00:00Z".to_string(),
        ..model_write("opus", "ignored", &[])
    })
    .await
    .unwrap();
    let updated = db.get_model_config("opus").await.unwrap().unwrap();
    assert_eq!(updated.config.display_name, "Opus (renamed)");
    assert_eq!(updated.config.created_at, "2026-07-09T00:00:00Z");
    assert_eq!(
        updated.aliases,
        vec![AliasEntry {
            alias: "claude-opus-4-8".to_string(),
            family: HarnessFamily::Claude,
        }]
    );

    assert!(db.delete_model_config("opus").await.unwrap());
    assert!(db.get_model_config("opus").await.unwrap().is_none());
    assert!(!db.delete_model_config("opus").await.unwrap());
}

#[tokio::test]
async fn backfill_alias_families_corrects_legacy_rows() {
    let db = Db::connect_in_memory().await.unwrap();

    // Simulate legacy rows created before the harness_family column: every alias
    // carries the migration's `openrouter` default, even the native ones.
    let legacy = |slug: &str, aliases: &[&str]| ModelConfigWrite {
        aliases: aliases
            .iter()
            .map(|a| AliasEntry {
                alias: a.to_string(),
                family: HarnessFamily::Openrouter,
            })
            .collect(),
        ..model_write(slug, slug, &[])
    };
    db.upsert_model_config(legacy(
        "opus",
        &["claude-opus-4-8", "anthropic/claude-opus-4.8"],
    ))
    .await
    .unwrap();
    db.upsert_model_config(legacy("gpt", &["gpt-5.5"]))
        .await
        .unwrap();

    // A Claude Code run of the native id is the run evidence for its family.
    db.push(
        &run_with_model(
            "r1",
            "claude-opus-4-8",
            HarnessSlug::Claude,
            TokenCounts::default(),
        ),
        &links(),
        None,
        None,
    )
    .await
    .unwrap();

    let fixed = crate::bootstrap::backfill_alias_families(&db)
        .await
        .unwrap();
    assert_eq!(fixed, 2, "the two native slugs were corrected");

    let family_of = |stored: &StoredModel, slug: &str| {
        stored
            .aliases
            .iter()
            .find(|a| a.alias == slug)
            .map(|a| a.family)
    };
    let opus = db.get_model_config("opus").await.unwrap().unwrap();
    // Native id corrected from run evidence; OpenRouter id left as-is.
    assert_eq!(
        family_of(&opus, "claude-opus-4-8"),
        Some(HarnessFamily::Claude)
    );
    assert_eq!(
        family_of(&opus, "anthropic/claude-opus-4.8"),
        Some(HarnessFamily::Openrouter)
    );
    // No run for gpt-5.5, so the structural rule (`gpt` prefix) classifies it.
    let gpt = db.get_model_config("gpt").await.unwrap().unwrap();
    assert_eq!(family_of(&gpt, "gpt-5.5"), Some(HarnessFamily::Codex));

    // Idempotent: a second pass corrects nothing.
    let again = crate::bootstrap::backfill_alias_families(&db)
        .await
        .unwrap();
    assert_eq!(again, 0);
}

#[tokio::test]
async fn price_observations_dedup_and_latest() {
    let db = Db::connect_in_memory().await.unwrap();
    let obs = |input: f64, at: &str| PriceWrite {
        model_id: "x/y".to_string(),
        observed_at: at.to_string(),
        uncached_input: Some(input),
        cached_input: None,
        output: Some(2.0),
        context_length: Some(200_000),
        released_at: None,
        input_modalities: Some("text,image".to_string()),
        provider_pin: None,
    };
    db.insert_price_observation(obs(1.0, "2026-01-01T00:00:00Z"))
        .await
        .unwrap();
    db.insert_price_observation(obs(1.5, "2026-01-02T00:00:00Z"))
        .await
        .unwrap();

    let latest = db.latest_price("x/y").await.unwrap().unwrap();
    assert_eq!(latest.uncached_input, Some(1.5));
    assert_eq!(db.all_model_prices().await.unwrap().len(), 2);
    assert!(db.latest_price("nope").await.unwrap().is_none());
}

#[tokio::test]
async fn distinct_run_models_returns_pairs() {
    let db = Db::connect_in_memory().await.unwrap();
    let z = TokenCounts::default();
    db.push(
        &run_with_model("r1", "anthropic/claude-opus-4.8", HarnessSlug::Kilo, z),
        &links(),
        None,
        None,
    )
    .await
    .unwrap();
    db.push(
        &run_with_model("r2", "anthropic/claude-opus-4.8", HarnessSlug::Kilo, z),
        &links(),
        None,
        None,
    )
    .await
    .unwrap();
    db.push(
        &run_with_model("r3", "gpt-5.5", HarnessSlug::Codex, z),
        &links(),
        None,
        None,
    )
    .await
    .unwrap();
    let mut pairs = db.distinct_run_models().await.unwrap();
    pairs.sort();
    assert_eq!(
        pairs,
        vec![
            ("anthropic/claude-opus-4.8".to_string(), "kilo".to_string()),
            ("gpt-5.5".to_string(), "codex".to_string()),
        ]
        .into_iter()
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>()
    );
}

#[tokio::test]
async fn normalize_free_model_ids_reprices_openrouter_runs_only() {
    let db = Db::connect_in_memory().await.unwrap();
    let tokens = TokenCounts {
        uncached_input: Some(1_000_000),
        cached_input: None,
        output: Some(1_000_000),
        reasoning: None,
    };
    // An OpenRouter-accessed run tagged `:free` with a $0 recorded cost.
    let mut kilo = run_with_model(
        "free-run",
        "deepseek/deepseek-v4:free",
        HarnessSlug::Kilo,
        tokens,
    );
    kilo.metrics.cost = Cost {
        comparable: Some(0.0),
        actual: Some(0.0),
    };
    db.push(&kilo, &links(), None, None).await.unwrap();
    // A provider-native Codex run whose id happens to contain a colon is left alone.
    let codex = run_with_model("codex-run", "gpt-5.5:preview", HarnessSlug::Codex, tokens);
    db.push(&codex, &links(), None, None).await.unwrap();

    let mut base_prices = HashMap::new();
    base_prices.insert(
        "deepseek/deepseek-v4".to_string(),
        TokenPrices {
            uncached_input: Some(0.000_002),
            cached_input: None,
            output: Some(0.000_006),
        },
    );
    let untouched = lifted(&db, "codex-run").await.updated_at;
    let before = stamp(&lifted(&db, "free-run").await.updated_at);

    let rewritten = db.normalize_free_model_ids(&base_prices).await.unwrap();
    assert_eq!(rewritten, 1);

    // Re-pricing rewrites the record blob, so the rewritten row's mutation stamp
    // moves; the row this startup routine skipped keeps its stamp untouched.
    let after = stamp(&lifted(&db, "free-run").await.updated_at);
    assert!(
        before < after,
        "re-pricing must move the stamp: {before} !< {after}"
    );
    assert_eq!(lifted(&db, "codex-run").await.updated_at, untouched);

    let run = db.get_run("free-run").await.unwrap().unwrap();
    assert_eq!(run.record.subject.model_id, "deepseek/deepseek-v4");
    // Re-priced at the base rate: 1e6 * 2e-6 + 1e6 * 6e-6 = 8.0, not $0.
    assert_eq!(run.record.metrics.cost.comparable, Some(8.0));

    let codex_run = db.get_run("codex-run").await.unwrap().unwrap();
    assert_eq!(codex_run.record.subject.model_id, "gpt-5.5:preview");

    // Idempotent: a second pass rewrites nothing.
    assert_eq!(db.normalize_free_model_ids(&base_prices).await.unwrap(), 0);
}

/// A run record carrying non-default metrics, for the lifted sort/filter columns.
/// Total tokens sum to 175; comparable cost is `$1.50`; run time is 42s.
fn record_with_metrics(id: &str) -> RunRecord {
    let mut r = record(id);
    r.subject.test_type = test_cabinet_core::TestType::AssetGeneration;
    r.metrics = RunMetrics {
        run_time_seconds: 42.0,
        tokens: TokenCounts {
            uncached_input: Some(100),
            cached_input: Some(20),
            output: Some(50),
            reasoning: Some(5),
        },
        cost: Cost {
            comparable: Some(1.5),
            actual: Some(1.5),
        },
        ..RunMetrics::default()
    };
    r
}

/// Read the lifted sort/filter columns off the raw `run` row.
pub(super) async fn lifted(db: &Db, id: &str) -> run::Model {
    run::Entity::find_by_id(id.to_string())
        .one(&db.connection())
        .await
        .unwrap()
        .expect("the run row exists")
}

#[tokio::test]
async fn push_lifts_the_record_sort_columns_and_starts_unrated() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record_with_metrics("r1"), &links(), None, None)
        .await
        .unwrap();

    let row = lifted(&db, "r1").await;
    assert_eq!(row.test_type, "asset-generation");
    assert_eq!(row.run_time_seconds, 42.0);
    assert_eq!(row.total_tokens, 175);
    assert_eq!(row.cost_comparable, Some(1.5));
    // A freshly pushed run carries no reviews yet.
    assert_eq!(row.rating, None);
    assert_eq!(row.review_count, 0);
    // A third-party-harness run has no configuration to lift.
    assert_eq!(row.gg_preset, None);
}

#[tokio::test]
async fn push_lifts_the_gg_configuration_name_only_for_a_gg_run() {
    let db = Db::connect_in_memory().await.unwrap();

    let mut named = gg_record("named");
    named.subject.gg_capability_set.as_mut().unwrap().preset = Some("planning-A".to_string());
    db.push(&named, &links(), None, None).await.unwrap();
    assert_eq!(
        lifted(&db, "named").await.gg_preset.as_deref(),
        Some("planning-A")
    );

    // A gg run assembled by hand records no configuration name; the column stays
    // NULL and every consumer falls back to the model.
    let mut hand_assembled = gg_record("hand");
    hand_assembled
        .subject
        .gg_capability_set
        .as_mut()
        .unwrap()
        .preset = None;
    db.push(&hand_assembled, &links(), None, None)
        .await
        .unwrap();
    assert_eq!(lifted(&db, "hand").await.gg_preset, None);

    // The lift is gated on the HARNESS, not the capability set alone: a non-gg run
    // carrying one somehow could never displace its model in the listing.
    let mut impostor = gg_record("impostor");
    impostor.subject.harness_slug = HarnessSlug::Claude;
    impostor.subject.gg_capability_set.as_mut().unwrap().preset = Some("planning-A".to_string());
    db.push(&impostor, &links(), None, None).await.unwrap();
    assert_eq!(lifted(&db, "impostor").await.gg_preset, None);
}

#[tokio::test]
async fn push_lifts_the_gg_configuration_id_the_cell_is_keyed_on() {
    let db = Db::connect_in_memory().await.unwrap();

    let mut launched = gg_record("launched");
    let set = launched.subject.gg_capability_set.as_mut().unwrap();
    set.preset = Some("planning-A".to_string());
    set.preset_id = Some("cfg-1".to_string());
    db.push(&launched, &links(), None, None).await.unwrap();
    let row = lifted(&db, "launched").await;
    assert_eq!(row.gg_config_id.as_deref(), Some("cfg-1"));
    assert_eq!(
        row.gg_preset.as_deref(),
        Some("planning-A"),
        "the name rides along for display beside the id the cell is keyed on",
    );

    // A gg run assembled by hand was launched from no configuration, so there is no id
    // to attribute it to and the column stays NULL — the harness form of the segment.
    let mut hand_assembled = gg_record("hand");
    let set = hand_assembled.subject.gg_capability_set.as_mut().unwrap();
    set.preset = None;
    set.preset_id = None;
    db.push(&hand_assembled, &links(), None, None)
        .await
        .unwrap();
    assert_eq!(lifted(&db, "hand").await.gg_config_id, None);

    // Gated on the HARNESS like the name beside it: a set that somehow rode in on a
    // third-party-harness run must not put it in a cell no gg run can join.
    let mut impostor = gg_record("impostor");
    impostor.subject.harness_slug = HarnessSlug::Claude;
    let set = impostor.subject.gg_capability_set.as_mut().unwrap();
    set.preset = Some("planning-A".to_string());
    set.preset_id = Some("cfg-1".to_string());
    db.push(&impostor, &links(), None, None).await.unwrap();
    assert_eq!(lifted(&db, "impostor").await.gg_config_id, None);
}

#[tokio::test]
async fn repush_refreshes_the_lifted_gg_configuration_name() {
    let db = Db::connect_in_memory().await.unwrap();
    let mut r = gg_record("r1");
    r.subject.gg_capability_set.as_mut().unwrap().preset = Some("planning-A".to_string());
    db.push(&r, &links(), None, None).await.unwrap();

    r.subject.gg_capability_set.as_mut().unwrap().preset = Some("planning-B".to_string());
    db.push(&r, &links(), None, None).await.unwrap();
    assert_eq!(
        lifted(&db, "r1").await.gg_preset.as_deref(),
        Some("planning-B")
    );
}

/// A gg run of `preset` whose capability set binds one agent per entry in `models` —
/// the shape a configuration with several launch slots produces once they are bound.
fn gg_record_binding(id: &str, preset: Option<&str>, models: &[&str]) -> RunRecord {
    use test_cabinet_core::gg::GgAgentConfig;

    let mut record = gg_record(id);
    let set = record.subject.gg_capability_set.as_mut().unwrap();
    set.preset = preset.map(str::to_string);
    // One agent per model, each with a slug of its own: the lifted key names which agent runs
    // which model, so a fixture whose agents all shared the root's slug would collapse.
    set.agents = models
        .iter()
        .enumerate()
        .map(|(index, model)| GgAgentConfig {
            slug: if index == 0 {
                "root".to_string()
            } else {
                format!("agent-{index}")
            },
            model_id: (*model).to_string(),
            ..GgAgentConfig::root()
        })
        .collect();
    record
}

/// A gg run launched from the saved configuration `config_id`, displayed as `preset`.
/// The shape every cell assertion needs: a cell is keyed on the id, and the name beside it
/// is only what a person reads.
fn gg_record_config(id: &str, config_id: &str, preset: &str, models: &[&str]) -> RunRecord {
    let mut record = gg_record_binding(id, Some(preset), models);
    record.subject.gg_capability_set.as_mut().unwrap().preset_id = Some(config_id.to_string());
    record
}

#[tokio::test]
async fn push_lifts_the_gg_bound_models_as_one_sorted_comparable_string() {
    let db = Db::connect_in_memory().await.unwrap();

    // Declaration order is not identity: the column is compared against the same key
    // lifted onto a queued job, so it is sorted before it is stored.
    db.push(
        &gg_record_binding("two", Some("planning-A"), &["mock/echo", "anthropic/opus"]),
        &links(),
        None,
        None,
    )
    .await
    .unwrap();
    assert_eq!(
        lifted(&db, "two").await.gg_models.as_deref(),
        Some("agent-1=anthropic/opus,root=mock/echo"),
    );

    // The same two models on the other two agents are a different cell: which agent runs
    // which is exactly what separates two arms of one configuration.
    db.push(
        &gg_record_binding(
            "swapped",
            Some("planning-A"),
            &["anthropic/opus", "mock/echo"],
        ),
        &links(),
        None,
        None,
    )
    .await
    .unwrap();
    assert_eq!(
        lifted(&db, "swapped").await.gg_models.as_deref(),
        Some("agent-1=mock/echo,root=anthropic/opus"),
        "the two models bound to the other two agents are the other arm, not the same cell",
    );

    // One configuration running one model is still a bound set, so the column is
    // written rather than left to the run's `model_id`.
    db.push(
        &gg_record_binding("one", Some("planning-A"), &["mock/echo"]),
        &links(),
        None,
        None,
    )
    .await
    .unwrap();
    assert_eq!(
        lifted(&db, "one").await.gg_models.as_deref(),
        Some("root=mock/echo")
    );
}

#[tokio::test]
async fn the_lifted_gg_models_are_gated_on_the_harness_like_the_configuration_name() {
    let db = Db::connect_in_memory().await.unwrap();

    // A third-party-harness run binds no set at all.
    db.push(&record_with_metrics("r1"), &links(), None, None)
        .await
        .unwrap();
    assert_eq!(lifted(&db, "r1").await.gg_models, None);

    // Nor does a non-gg run that somehow carries one: the pair is written and absent
    // together, so a consumer that has tested `gg_preset` need not re-derive this.
    let mut impostor = gg_record_binding("impostor", Some("planning-A"), &["mock/echo"]);
    impostor.subject.harness_slug = HarnessSlug::Claude;
    db.push(&impostor, &links(), None, None).await.unwrap();
    let row = lifted(&db, "impostor").await;
    assert_eq!(row.gg_preset, None);
    assert_eq!(row.gg_models, None);
}

#[tokio::test]
async fn repush_refreshes_the_lifted_gg_bound_models() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(
        &gg_record_binding("r1", Some("planning-A"), &["mock/echo"]),
        &links(),
        None,
        None,
    )
    .await
    .unwrap();
    db.push(
        &gg_record_binding("r1", Some("planning-A"), &["mock/echo", "anthropic/opus"]),
        &links(),
        None,
        None,
    )
    .await
    .unwrap();
    assert_eq!(
        lifted(&db, "r1").await.gg_models.as_deref(),
        Some("agent-1=anthropic/opus,root=mock/echo"),
        "a re-pushed record rewrites the cell it belongs to",
    );
}

#[tokio::test]
async fn add_review_maintains_the_lifted_rating_and_count() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record_with_metrics("r1"), &links(), None, None)
        .await
        .unwrap();

    // First review (great) sets the aggregate; the count reaches one.
    db.add_review("r1", &review_by("u1", Rating::Great), None, None)
        .await
        .unwrap();
    let row = lifted(&db, "r1").await;
    assert_eq!(row.rating.as_deref(), Some("great"));
    assert_eq!(row.review_count, 1);

    // A second, harsher review drags the aggregate to the worst rating.
    db.add_review("r1", &review_by("u2", Rating::Scuffed), None, None)
        .await
        .unwrap();
    let row = lifted(&db, "r1").await;
    assert_eq!(row.rating.as_deref(), Some("scuffed"));
    assert_eq!(row.review_count, 2);

    // Re-pushing the run refreshes the record-derived columns but preserves the
    // review-derived aggregate (a re-push carries no reviews).
    db.push(&record_with_metrics("r1"), &links(), None, None)
        .await
        .unwrap();
    let row = lifted(&db, "r1").await;
    assert_eq!(row.rating.as_deref(), Some("scuffed"));
    assert_eq!(row.review_count, 2);
    assert_eq!(row.total_tokens, 175);
}

#[tokio::test]
async fn backfill_sort_columns_fills_rows_from_record_and_reviews() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record_with_metrics("r1"), &links(), None, None)
        .await
        .unwrap();
    db.add_review("r1", &review_by("u1", Rating::Great), None, None)
        .await
        .unwrap();
    db.add_review("r1", &review_by("u2", Rating::Scuffed), None, None)
        .await
        .unwrap();
    // A second run with no reviews, to prove the null-rating path is backfilled too.
    db.push(&record_with_metrics("r2"), &links(), None, None)
        .await
        .unwrap();

    // Simulate rows that predate the sort columns: reset every lifted value to the
    // migration's defaults (empty test_type is the "un-backfilled" sentinel).
    for id in ["r1", "r2"] {
        let mut active = lifted(&db, id).await.into_active_model();
        active.test_type = Set(String::new());
        active.run_time_seconds = Set(0.0);
        active.total_tokens = Set(0);
        active.cost_comparable = Set(None);
        active.rating = Set(None);
        active.review_count = Set(0);
        active.update(&db.connection()).await.unwrap();
    }

    let filled = db.backfill_sort_columns().await.unwrap();
    assert_eq!(filled, 2);

    let r1 = lifted(&db, "r1").await;
    assert_eq!(r1.test_type, "asset-generation");
    assert_eq!(r1.run_time_seconds, 42.0);
    assert_eq!(r1.total_tokens, 175);
    assert_eq!(r1.cost_comparable, Some(1.5));
    assert_eq!(r1.rating.as_deref(), Some("scuffed"));
    assert_eq!(r1.review_count, 2);

    let r2 = lifted(&db, "r2").await;
    assert_eq!(r2.total_tokens, 175);
    assert_eq!(r2.rating, None);
    assert_eq!(r2.review_count, 0);

    // Idempotent: a second pass finds nothing un-backfilled.
    assert_eq!(db.backfill_sort_columns().await.unwrap(), 0);
}

// --- list_summaries: filter / free-text / sort / offset + total ---------------

/// Push an unpublished run with the given identity columns and token count (cost
/// `Some(1.0)`, no review) for the filter/free-text tests. Left unpublished so the
/// tests can query it via the [`SummaryState::Unpublished`] slice.
async fn seed_ident(
    db: &Db,
    id: &str,
    test_case: &str,
    model: &str,
    harness: HarnessSlug,
    variant: &str,
    tokens: u64,
) {
    let mut r = record(id);
    r.subject.test_case_slug = test_case.to_string();
    r.subject.model_id = model.to_string();
    r.subject.harness_slug = harness;
    r.subject.variant = variant.to_string();
    r.metrics.run_time_seconds = 1.0;
    r.metrics.tokens = TokenCounts {
        uncached_input: Some(tokens),
        cached_input: None,
        output: None,
        reasoning: None,
    };
    r.metrics.cost = Cost {
        comparable: Some(1.0),
        actual: Some(1.0),
    };
    db.push(&r, &links(), None, None).await.unwrap();
}

/// Push an unpublished gg run with the given model and configuration name (`None`
/// = assembled by hand, recording no name), for the tests covering the lifted
/// `gg_preset` column's search and sort.
async fn seed_gg_ident(db: &Db, id: &str, model: &str, preset: Option<&str>) {
    let mut r = gg_record(id);
    r.subject.test_case_slug = "pong".to_string();
    r.subject.model_id = model.to_string();
    r.subject.variant = "base".to_string();
    r.subject.gg_capability_set.as_mut().unwrap().preset = preset.map(str::to_string);
    db.push(&r, &links(), None, None).await.unwrap();
}

/// Push an unpublished gg run launched from the saved configuration `config_id` and
/// displaying `preset`, for the tests covering the `gg_config_id` filter. The two are
/// separate arguments because that is the whole point of the column: a name is display
/// text two configurations may share and one configuration may change.
async fn seed_gg_config_ident(db: &Db, id: &str, config_id: &str, preset: &str) {
    let mut r = gg_record(id);
    r.subject.test_case_slug = "pong".to_string();
    r.subject.model_id = "mock/echo".to_string();
    r.subject.variant = "base".to_string();
    let set = r.subject.gg_capability_set.as_mut().unwrap();
    set.preset = Some(preset.to_string());
    set.preset_id = Some(config_id.to_string());
    db.push(&r, &links(), None, None).await.unwrap();
}

/// Push an unpublished `pong`/`m`/claude/`base` run varying only the sort metrics:
/// token count, comparable cost (`None` = unknown), and rating (`None` = unrated,
/// otherwise one review at that rating). For the sort/offset/total tests.
async fn seed_metric(db: &Db, id: &str, tokens: u64, cost: Option<f64>, rating: Option<Rating>) {
    let mut r = record(id);
    r.subject.test_case_slug = "pong".to_string();
    r.subject.model_id = "m".to_string();
    r.subject.variant = "base".to_string();
    r.metrics.run_time_seconds = 1.0;
    r.metrics.tokens = TokenCounts {
        uncached_input: Some(tokens),
        cached_input: None,
        output: None,
        reasoning: None,
    };
    r.metrics.cost = Cost {
        comparable: cost,
        actual: cost,
    };
    db.push(&r, &links(), None, None).await.unwrap();
    if let Some(rating) = rating {
        db.add_review(id, &review_by("u1", rating), None, None)
            .await
            .unwrap();
    }
}

/// The `SummaryFilter` for the unpublished slice (where these tests seed).
pub(super) fn unpublished_filter() -> SummaryFilter {
    SummaryFilter {
        state: SummaryState::Unpublished,
        ..SummaryFilter::default()
    }
}

/// The run ids of an assembled page, in order.
fn run_ids(runs: &[StoredRun]) -> Vec<String> {
    runs.iter().map(|run| run.record.id.clone()).collect()
}

/// A [`Db::list_summaries`] call over the unpublished slice with the given filter,
/// sort, and direction (no paging), returning just the ordered run ids.
async fn summary_ids(
    db: &Db,
    filter: &SummaryFilter,
    sort: SummarySort,
    dir: SortDir,
) -> Vec<String> {
    let (runs, _) = db
        .list_summaries(filter, sort, dir, &CaseNames::new(), 50, 0)
        .await
        .unwrap();
    run_ids(&runs)
}

#[tokio::test]
async fn list_summaries_filters_by_test_case_model_and_harness() {
    let db = Db::connect_in_memory().await.unwrap();
    // pong/sonnet/claude, pong/opus/codex, snake/sonnet/claude — distinct axes.
    seed_ident(&db, "a", "pong", "sonnet", HarnessSlug::Claude, "base", 10).await;
    seed_ident(&db, "b", "pong", "opus", HarnessSlug::Codex, "base", 20).await;
    seed_ident(&db, "c", "snake", "sonnet", HarnessSlug::Claude, "base", 30).await;

    // test_case narrows to the two pong runs.
    let filter = SummaryFilter {
        test_case: Some("pong".to_string()),
        ..unpublished_filter()
    };
    let (runs, total) = db
        .list_summaries(
            &filter,
            SummarySort::Tokens,
            SortDir::Asc,
            &CaseNames::new(),
            50,
            0,
        )
        .await
        .unwrap();
    assert_eq!(run_ids(&runs), ["a", "b"]);
    assert_eq!(total, 2);

    // model narrows to the two sonnet runs.
    let filter = SummaryFilter {
        model: Some("sonnet".to_string()),
        ..unpublished_filter()
    };
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Tokens, SortDir::Asc).await,
        ["a", "c"]
    );

    // harness narrows to the single codex run.
    let filter = SummaryFilter {
        harness: Some("codex".to_string()),
        ..unpublished_filter()
    };
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Tokens, SortDir::Asc).await,
        ["b"]
    );

    // Filters AND together: pong AND sonnet is just `a`.
    let filter = SummaryFilter {
        test_case: Some("pong".to_string()),
        model: Some("sonnet".to_string()),
        ..unpublished_filter()
    };
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Tokens, SortDir::Asc).await,
        ["a"]
    );
}

/// Push an unpublished run of `test_case` at `version`, varying nothing else. For
/// the version-filter tests, whose ordering key is the id tiebreak.
async fn seed_version(db: &Db, id: &str, test_case: &str, version: &str) {
    let mut r = record(id);
    r.subject.test_case_slug = test_case.to_string();
    r.subject.test_case_version = version.to_string();
    db.push(&r, &links(), None, None).await.unwrap();
}

#[test]
fn current_versions_keeps_each_cases_greatest_major_minor() {
    // Every revision of the greatest minor survives (`v1.2.0` and `v1.2.1` are one
    // spec); older minors and majors are dropped, per case independently.
    let scope = current_versions(vec![
        ("pong".into(), "v1.0.0".into()),
        ("pong".into(), "v1.2.0".into()),
        ("pong".into(), "v1.2.1".into()),
        ("pong".into(), "v1.1.0".into()),
        ("snake".into(), "v3.0.0".into()),
        ("snake".into(), "v2.9.0".into()),
    ]);
    assert_eq!(
        scope,
        vec![
            CaseVersions {
                slug: "pong".into(),
                versions: vec!["v1.2.0".into(), "v1.2.1".into()],
            },
            CaseVersions {
                slug: "snake".into(),
                versions: vec!["v3.0.0".into()],
            },
        ]
    );
}

#[test]
fn current_versions_orders_components_numerically_not_lexically() {
    // `v1.10.0` is newer than `v1.9.0`; a string compare gets that backwards.
    let scope = current_versions(vec![
        ("pong".into(), "v1.9.0".into()),
        ("pong".into(), "v1.10.0".into()),
    ]);
    assert_eq!(
        scope,
        vec![CaseVersions {
            slug: "pong".into(),
            versions: vec!["v1.10.0".into()],
        }]
    );
}

#[tokio::test]
async fn list_summaries_filters_by_exact_version() {
    let db = Db::connect_in_memory().await.unwrap();
    seed_version(&db, "a", "pong", "v1.0.0").await;
    seed_version(&db, "b", "pong", "v2.0.0").await;
    seed_version(&db, "c", "snake", "v1.0.0").await;

    // A bare version is a plain equality filter — it selects that version of every
    // case…
    let filter = SummaryFilter {
        version: Some("v1.0.0".to_string()),
        ..unpublished_filter()
    };
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Date, SortDir::Asc).await,
        ["a", "c"]
    );

    // …and paired with a case, exactly that case's version.
    let filter = SummaryFilter {
        test_case: Some("pong".to_string()),
        version: Some("v2.0.0".to_string()),
        ..unpublished_filter()
    };
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Date, SortDir::Asc).await,
        ["b"]
    );

    // An empty version is ignored, like the other equality filters.
    let filter = SummaryFilter {
        version: Some(String::new()),
        ..unpublished_filter()
    };
    let (_, total) = db
        .list_summaries(
            &filter,
            SummarySort::Date,
            SortDir::Asc,
            &CaseNames::new(),
            50,
            0,
        )
        .await
        .unwrap();
    assert_eq!(total, 3);
}

#[tokio::test]
async fn list_summaries_latest_versions_narrows_per_case() {
    let db = Db::connect_in_memory().await.unwrap();
    // pong is on v1.2.x (two revisions of the current minor); snake on v3.0.0.
    seed_version(&db, "a", "pong", "v1.0.0").await;
    seed_version(&db, "b", "pong", "v1.2.0").await;
    seed_version(&db, "c", "pong", "v1.2.1").await;
    seed_version(&db, "d", "snake", "v2.0.0").await;
    seed_version(&db, "e", "snake", "v3.0.0").await;

    let filter = SummaryFilter {
        latest_versions: true,
        ..unpublished_filter()
    };
    let (runs, total) = db
        .list_summaries(
            &filter,
            SummarySort::Date,
            SortDir::Asc,
            &CaseNames::new(),
            50,
            0,
        )
        .await
        .unwrap();
    assert_eq!(run_ids(&runs), ["b", "c", "e"]);
    // The total is counted under the same predicate, so the pager stays honest.
    assert_eq!(total, 3);

    // It ANDs with the other filters rather than replacing them.
    let filter = SummaryFilter {
        test_case: Some("pong".to_string()),
        latest_versions: true,
        ..unpublished_filter()
    };
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Date, SortDir::Asc).await,
        ["b", "c"]
    );
}

#[tokio::test]
async fn list_summaries_exact_version_overrides_latest_versions() {
    // Asking for an older version explicitly must show it, not silently empty the
    // listing because it is not the current one.
    let db = Db::connect_in_memory().await.unwrap();
    seed_version(&db, "a", "pong", "v1.0.0").await;
    seed_version(&db, "b", "pong", "v2.0.0").await;

    let filter = SummaryFilter {
        version: Some("v1.0.0".to_string()),
        latest_versions: true,
        ..unpublished_filter()
    };
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Date, SortDir::Asc).await,
        ["a"]
    );
}

#[tokio::test]
async fn list_summaries_filters_by_a_versions_list() {
    // The case Runs tab's anchored version scope: the console computes the versions
    // in the anchored line and sends the concrete list; any of them matches.
    let db = Db::connect_in_memory().await.unwrap();
    seed_version(&db, "a", "pong", "v1.0.0").await;
    seed_version(&db, "b", "pong", "v1.1.0").await;
    seed_version(&db, "c", "pong", "v2.0.0").await;

    let filter = SummaryFilter {
        test_case: Some("pong".to_string()),
        versions: Some(vec!["v1.0.0".to_string(), "v1.1.0".to_string()]),
        ..unpublished_filter()
    };
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Date, SortDir::Asc).await,
        ["a", "b"]
    );

    // An empty list is no filter at all, like the other empty equality filters.
    let filter = SummaryFilter {
        versions: Some(Vec::new()),
        ..unpublished_filter()
    };
    let (_, total) = db
        .list_summaries(
            &filter,
            SummarySort::Date,
            SortDir::Asc,
            &CaseNames::new(),
            50,
            0,
        )
        .await
        .unwrap();
    assert_eq!(total, 3);
}

#[tokio::test]
async fn list_summaries_versions_list_overrides_latest_versions() {
    // Scoping to an older line explicitly must show it — the concrete list is the
    // more specific instruction, exactly as an exact `version` is.
    let db = Db::connect_in_memory().await.unwrap();
    seed_version(&db, "a", "pong", "v1.0.0").await;
    seed_version(&db, "b", "pong", "v2.0.0").await;

    let filter = SummaryFilter {
        versions: Some(vec!["v1.0.0".to_string()]),
        latest_versions: true,
        ..unpublished_filter()
    };
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Date, SortDir::Asc).await,
        ["a"]
    );
}

#[tokio::test]
async fn list_summaries_filters_by_a_test_cases_list() {
    // The home page's group-leaderboard slice: one query covers a test-case
    // group's member cases; any of them matches.
    let db = Db::connect_in_memory().await.unwrap();
    seed_version(&db, "a", "pong", "v1.0.0").await;
    seed_version(&db, "b", "meltdown", "v1.0.0").await;
    seed_version(&db, "c", "valence", "v1.0.0").await;

    let filter = SummaryFilter {
        test_cases: Some(vec!["pong".to_string(), "valence".to_string()]),
        ..unpublished_filter()
    };
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Date, SortDir::Asc).await,
        ["a", "c"]
    );

    // It ANDs with `test_case` — naming both narrows to their intersection, the
    // written-down semantic the console's `runQuery.ts` mirrors…
    let filter = SummaryFilter {
        test_case: Some("pong".to_string()),
        test_cases: Some(vec!["pong".to_string(), "valence".to_string()]),
        ..unpublished_filter()
    };
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Date, SortDir::Asc).await,
        ["a"]
    );

    // …which can be empty when the single case is not in the list.
    let filter = SummaryFilter {
        test_case: Some("meltdown".to_string()),
        test_cases: Some(vec!["pong".to_string()]),
        ..unpublished_filter()
    };
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Date, SortDir::Asc).await,
        Vec::<String>::new()
    );

    // An empty list is no filter at all, like the empty `versions` list.
    let filter = SummaryFilter {
        test_cases: Some(Vec::new()),
        ..unpublished_filter()
    };
    let (_, total) = db
        .list_summaries(
            &filter,
            SummarySort::Date,
            SortDir::Asc,
            &CaseNames::new(),
            50,
            0,
        )
        .await
        .unwrap();
    assert_eq!(total, 3);
}

#[tokio::test]
async fn list_summaries_test_cases_list_composes_with_latest_versions() {
    // Unlike the explicit `versions` list, the case list carries no version
    // instruction, so `latest_versions` still narrows each member to its current
    // `major.minor`.
    let db = Db::connect_in_memory().await.unwrap();
    seed_version(&db, "a", "pong", "v1.0.0").await;
    seed_version(&db, "b", "pong", "v2.0.0").await;
    seed_version(&db, "c", "meltdown", "v1.0.0").await;

    let filter = SummaryFilter {
        test_cases: Some(vec!["pong".to_string()]),
        latest_versions: true,
        ..unpublished_filter()
    };
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Date, SortDir::Asc).await,
        ["b"]
    );
}

/// A review from `account` carrying the run-wide aesthetic `rating`, which
/// maintains the lifted `run.aesthetic` column the filter matches on.
fn review_with_aesthetic(account: &str, rating: AestheticRating) -> StoredReview {
    StoredReview {
        aesthetic: Some(rating),
        ..review_by(account, Rating::Great)
    }
}

#[tokio::test]
async fn list_summaries_filters_by_aesthetic_and_unrated_runs_never_match() {
    let db = Db::connect_in_memory().await.unwrap();
    seed_version(&db, "a", "pong", "v1.0.0").await;
    seed_version(&db, "b", "pong", "v1.0.0").await;
    seed_version(&db, "c", "pong", "v1.0.0").await;
    db.add_review(
        "a",
        &review_with_aesthetic("u1", AestheticRating::Legendary),
        None,
        None,
    )
    .await
    .unwrap();
    db.add_review(
        "b",
        &review_with_aesthetic("u1", AestheticRating::Slop),
        None,
        None,
    )
    .await
    .unwrap();
    // `c` carries no aesthetic rating at all: its NULL column matches no tier.

    let filter = SummaryFilter {
        aesthetic: Some("legendary".to_string()),
        ..unpublished_filter()
    };
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Date, SortDir::Asc).await,
        ["a"]
    );

    let filter = SummaryFilter {
        aesthetic: Some("slop".to_string()),
        ..unpublished_filter()
    };
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Date, SortDir::Asc).await,
        ["b"]
    );

    // An empty token is ignored, like the other equality filters.
    let filter = SummaryFilter {
        aesthetic: Some(String::new()),
        ..unpublished_filter()
    };
    let (_, total) = db
        .list_summaries(
            &filter,
            SummarySort::Date,
            SortDir::Asc,
            &CaseNames::new(),
            50,
            0,
        )
        .await
        .unwrap();
    assert_eq!(total, 3);
}

#[tokio::test]
async fn cabinet_stat_rows_cover_every_recorded_run() {
    // The `/stats/cabinet` corpus is the whole cabinet: every state, published or
    // not — a failed run consumed real tokens and money too.
    let db = Db::connect_in_memory().await.unwrap();
    push_review_publish(&db, "pub", "2026-06-18T00:00:00Z").await;
    let mut failed = record("failed");
    failed.status.state = RunState::Catastrophic;
    db.push(&failed, &links(), None, None).await.unwrap();

    let rows = db.cabinet_stat_rows().await.unwrap();
    assert_eq!(rows.len(), 2);
    for (started_at, total_tokens, cost_comparable, slug, model) in &rows {
        assert_eq!(started_at, "2026-06-17T20:40:00Z");
        // The default record reports no tokens and no cost: the lifted columns
        // store `0` and NULL, exactly what the fold counts as unreported.
        assert_eq!(*total_tokens, 0);
        assert_eq!(*cost_comparable, None);
        assert_eq!(slug, "pong");
        assert_eq!(model, "claude-sonnet-4-5");
    }
}

/// Push an unpublished `pong` run recording the given engine slug, varying nothing
/// else. For the engine-filter tests, whose ordering key is the id tiebreak.
async fn seed_engine(db: &Db, id: &str, engine: &str) {
    let mut r = record(id);
    r.subject.test_case_slug = "pong".to_string();
    r.subject.engine_slug = engine.to_string();
    db.push(&r, &links(), None, None).await.unwrap();
}

#[tokio::test]
async fn list_summaries_filters_by_engine_with_null_matching_only_none() {
    let db = Db::connect_in_memory().await.unwrap();
    seed_engine(&db, "a", "none").await;
    seed_engine(&db, "b", "simple-2d").await;
    // Simulate a pre-column row the backfill could not lift, leaving the column
    // NULL so the engine is unknown. The row's record still reads, so it is listed
    // like any other; only its engine is in question.
    seed_engine(&db, "c", "simple-2d").await;
    let mut active = lifted(&db, "c").await.into_active_model();
    active.engine_slug = Set(None);
    active.update(&db.connection()).await.unwrap();

    // An engine filter matches the lifted slug — and NEVER a NULL row, whose engine
    // is unknown even if its unreadable record happened to name one.
    let filter = SummaryFilter {
        engine: Some("simple-2d".to_string()),
        ..unpublished_filter()
    };
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Date, SortDir::Asc).await,
        ["b"]
    );

    // `none` is the one filter NULL matches: every pre-engine-era record
    // deserializes to `none`, so an un-backfillable row can only be engineless-era.
    let filter = SummaryFilter {
        engine: Some("none".to_string()),
        ..unpublished_filter()
    };
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Date, SortDir::Asc).await,
        ["a", "c"]
    );

    // An empty engine is ignored, like the other equality filters.
    let filter = SummaryFilter {
        engine: Some(String::new()),
        ..unpublished_filter()
    };
    let (_, total) = db
        .list_summaries(
            &filter,
            SummarySort::Date,
            SortDir::Asc,
            &CaseNames::new(),
            50,
            0,
        )
        .await
        .unwrap();
    assert_eq!(total, 3);
}

#[tokio::test]
async fn push_lifts_the_engine_slug() {
    let db = Db::connect_in_memory().await.unwrap();
    seed_engine(&db, "r1", "simple-2d").await;
    assert_eq!(
        lifted(&db, "r1").await.engine_slug.as_deref(),
        Some("simple-2d")
    );
    // The engineless run lifts the concrete `none`, not NULL — it is a real value
    // the engine filter matches on, distinct from "unknown".
    seed_engine(&db, "r2", "none").await;
    assert_eq!(lifted(&db, "r2").await.engine_slug.as_deref(), Some("none"));
}

#[tokio::test]
async fn backfill_engine_slug_lifts_the_recorded_engine() {
    let db = Db::connect_in_memory().await.unwrap();
    seed_engine(&db, "r1", "simple-2d").await;
    seed_engine(&db, "r2", "none").await;

    // Simulate rows that predate the column: NULL the lifted value.
    for id in ["r1", "r2"] {
        let mut active = lifted(&db, id).await.into_active_model();
        active.engine_slug = Set(None);
        active.update(&db.connection()).await.unwrap();
    }

    let filled = db.backfill_engine_slug().await.unwrap();
    assert_eq!(filled, 2);
    assert_eq!(
        lifted(&db, "r1").await.engine_slug.as_deref(),
        Some("simple-2d")
    );
    // `none` is lifted too: the candidate set settles rather than re-parsing the
    // whole engineless-era corpus on every boot.
    assert_eq!(lifted(&db, "r2").await.engine_slug.as_deref(), Some("none"));

    // Idempotent: a second pass finds nothing un-backfilled.
    assert_eq!(db.backfill_engine_slug().await.unwrap(), 0);
}

#[tokio::test]
async fn latest_versions_is_measured_within_the_state_slice() {
    // The current version is resolved from the slice the listing draws from, so a
    // published-only listing is not narrowed by a version only an unpublished run
    // has reached.
    let db = Db::connect_in_memory().await.unwrap();
    seed_version(&db, "old", "pong", "v1.0.0").await;
    db.add_review("old", &review_by("u1", Rating::Great), None, None)
        .await
        .unwrap();
    db.publish("old", "2026-06-18T00:00:00Z").await.unwrap();
    seed_version(&db, "new", "pong", "v2.0.0").await;

    let published = SummaryFilter {
        state: SummaryState::Published,
        latest_versions: true,
        ..SummaryFilter::default()
    };
    assert_eq!(
        summary_ids(&db, &published, SummarySort::Date, SortDir::Asc).await,
        ["old"]
    );

    // The consoles' `any` slice sees the v2 run, so v1 falls out of scope there.
    let any = SummaryFilter {
        state: SummaryState::Any,
        latest_versions: true,
        ..SummaryFilter::default()
    };
    assert_eq!(
        summary_ids(&db, &any, SummarySort::Date, SortDir::Asc).await,
        ["new"]
    );
}

#[tokio::test]
async fn list_summaries_failures_slice_covers_the_publishable_failure_tiers() {
    // The `fields=summary&state=failures` path must surface exactly the publishable
    // failure tiers — catastrophic, timed-out, and harness-error — and never a
    // completed run or an infrastructure failure.
    let db = Db::connect_in_memory().await.unwrap();
    for (id, state) in [
        ("done", RunState::Completed),
        ("cat", RunState::Catastrophic),
        ("slow", RunState::TimedOut),
        ("harness", RunState::HarnessError),
        ("infra", RunState::Infrastructure),
    ] {
        let mut r = record(id);
        r.status.state = state;
        db.push(&r, &links(), None, None).await.unwrap();
    }

    let filter = SummaryFilter {
        state: SummaryState::Failures,
        ..SummaryFilter::default()
    };
    let mut ids = summary_ids(&db, &filter, SummarySort::Date, SortDir::Asc).await;
    ids.sort();
    assert_eq!(ids, ["cat", "harness", "slow"]);
}

/// The `publishable` slice is the console's Unpublished worklist, where every
/// listed run is meant to be selectable and published — so it must list exactly
/// what the publish gate accepts, no more. Rather than restating the rule, this
/// asks the gate itself about each seeded run and compares the two sets, so the
/// query and `gate_publishable` cannot drift apart.
#[tokio::test]
async fn publishable_slice_matches_the_publish_gate() {
    let db = Db::connect_in_memory().await.unwrap();
    // Every combination that decides publishability: terminal state × reviewed.
    let seeded = [
        ("done-reviewed", RunState::Completed, true),
        ("done-unreviewed", RunState::Completed, false),
        ("cat", RunState::Catastrophic, false),
        ("slow", RunState::TimedOut, false),
        ("harness", RunState::HarnessError, false),
        ("hung", RunState::Hung, false),
        ("infra", RunState::Infrastructure, false),
        // The two never-publishable states, each seeded reviewed as well, because a
        // review is what satisfies the other half of the rule: these are the rows the
        // slice would list and the gate would then refuse.
        ("infra-reviewed", RunState::Infrastructure, true),
        ("canceled", RunState::Canceled, false),
        ("canceled-reviewed", RunState::Canceled, true),
    ];
    for (id, state, reviewed) in seeded {
        let mut r = record(id);
        r.status.state = state;
        db.push(&r, &links(), None, None).await.unwrap();
        if reviewed {
            db.add_review(id, &review_by("u1", Rating::Great), None, None)
                .await
                .unwrap();
        }
    }
    // The third arm of the rule: a validator-rated completed run needs no review
    // (its functional rating and score stand on their own), while a validator-rated
    // run in a never-publishable state is still refused by the first half.
    let manifest = validator_manifest();
    let mut validator_seeded = vec![];
    for (id, state) in [
        ("validated-unreviewed", RunState::Completed),
        ("validated-canceled", RunState::Canceled),
    ] {
        let mut r = validator_record(id, &[("serve", true)]);
        r.status.state = state;
        db.push(&r, &links(), None, Some(&manifest)).await.unwrap();
        validator_seeded.push(id);
    }

    let filter = SummaryFilter {
        state: SummaryState::Publishable,
        ..SummaryFilter::default()
    };
    let mut listed = summary_ids(&db, &filter, SummarySort::Date, SortDir::Asc).await;
    listed.sort();

    let mut accepted_by_the_gate = Vec::new();
    for id in seeded
        .iter()
        .map(|(id, _, _)| *id)
        .chain(validator_seeded.iter().copied())
    {
        if db.ensure_publishable(id).await.is_ok() {
            accepted_by_the_gate.push(id.to_string());
        }
    }
    accepted_by_the_gate.sort();

    assert_eq!(listed, accepted_by_the_gate);
    assert_eq!(
        listed,
        [
            "cat",
            "done-reviewed",
            "harness",
            "hung",
            "slow",
            "validated-unreviewed"
        ]
    );
}

/// Publishing a run retires it from the worklist — the slice is what is *still*
/// waiting to be published, not everything that ever could be.
#[tokio::test]
async fn publishable_slice_drops_a_run_once_it_is_published() {
    let db = Db::connect_in_memory().await.unwrap();
    for id in ["kept", "released"] {
        db.push(&record(id), &links(), None, None).await.unwrap();
        db.add_review(id, &review_by("u1", Rating::Great), None, None)
            .await
            .unwrap();
    }

    let filter = SummaryFilter {
        state: SummaryState::Publishable,
        ..SummaryFilter::default()
    };
    let mut ids = summary_ids(&db, &filter, SummarySort::Date, SortDir::Asc).await;
    ids.sort();
    assert_eq!(ids, ["kept", "released"]);

    db.publish("released", "2026-06-18T00:00:00Z")
        .await
        .unwrap();

    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Date, SortDir::Asc).await,
        ["kept"]
    );
}

#[tokio::test]
async fn list_summaries_any_slice_covers_every_recorded_run() {
    // The `fields=summary&state=any` path applies no lifecycle predicate at all: a
    // published run, an unpublished completed one, and every failure tier — including
    // the never-publishable infrastructure one — are all in scope. This is what the
    // gg analysis section's Sessions tab lists (narrowed by `harness=gg`), so it must
    // match exactly the set the gg document index holds, most of which never publish.
    let db = Db::connect_in_memory().await.unwrap();
    push_review_publish(&db, "public", "2026-06-17T10:00:00Z").await;
    for (id, state) in [
        ("pending", RunState::Completed),
        ("harness", RunState::HarnessError),
        ("infra", RunState::Infrastructure),
    ] {
        let mut r = record(id);
        r.status.state = state;
        db.push(&r, &links(), None, None).await.unwrap();
    }

    let filter = SummaryFilter {
        state: SummaryState::Any,
        ..SummaryFilter::default()
    };
    let (runs, total) = db
        .list_summaries(
            &filter,
            SummarySort::Date,
            SortDir::Asc,
            &CaseNames::new(),
            50,
            0,
        )
        .await
        .unwrap();
    let mut ids = run_ids(&runs);
    ids.sort();
    assert_eq!(ids, ["harness", "infra", "pending", "public"]);
    assert_eq!(total, 4);

    // It composes with the equality filters the same way every other slice does.
    let mut r = gg_record("session");
    r.status.state = RunState::Completed;
    db.push(&r, &links(), None, None).await.unwrap();
    let filter = SummaryFilter {
        state: SummaryState::Any,
        harness: Some(HarnessSlug::Gg.as_str().to_string()),
        ..SummaryFilter::default()
    };
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Date, SortDir::Asc).await,
        ["session"]
    );
}

#[tokio::test]
async fn list_summaries_free_text_matches_across_fields_case_insensitively() {
    let db = Db::connect_in_memory().await.unwrap();
    seed_ident(&db, "a", "pong", "sonnet", HarnessSlug::Claude, "base", 10).await;
    seed_ident(&db, "b", "snake", "opus", HarnessSlug::Codex, "hard", 20).await;
    seed_ident(&db, "c", "tetris", "haiku", HarnessSlug::Claude, "base", 30).await;

    let q = |text: &str| SummaryFilter {
        q: Some(text.to_string()),
        ..unpublished_filter()
    };

    // Model column, matched case-insensitively ("OP" -> opus).
    assert_eq!(
        summary_ids(&db, &q("OP"), SummarySort::Tokens, SortDir::Asc).await,
        ["b"]
    );
    // Variant column.
    assert_eq!(
        summary_ids(&db, &q("hard"), SummarySort::Tokens, SortDir::Asc).await,
        ["b"]
    );
    // Harness column, across two runs.
    assert_eq!(
        summary_ids(&db, &q("claude"), SummarySort::Tokens, SortDir::Asc).await,
        ["a", "c"]
    );
    // Test-case column.
    assert_eq!(
        summary_ids(&db, &q("tetris"), SummarySort::Tokens, SortDir::Asc).await,
        ["c"]
    );
}

#[tokio::test]
async fn list_summaries_free_text_matches_a_gg_configuration_name() {
    let db = Db::connect_in_memory().await.unwrap();
    seed_gg_ident(&db, "named", "mock/echo", Some("planning-A")).await;
    seed_gg_ident(&db, "other", "mock/echo", Some("review-heavy")).await;
    seed_ident(
        &db,
        "third",
        "pong",
        "sonnet",
        HarnessSlug::Claude,
        "base",
        10,
    )
    .await;

    let q = |text: &str| SummaryFilter {
        q: Some(text.to_string()),
        ..unpublished_filter()
    };

    // A gg run is findable by the configuration its row SHOWS, not only by the
    // representative model behind it — the whole point of the lifted column.
    assert_eq!(
        summary_ids(&db, &q("PLANNING"), SummarySort::Date, SortDir::Asc).await,
        ["named"]
    );
    // The other columns still match alongside it: the model is shared by both gg
    // runs and by neither the third.
    assert_eq!(
        summary_ids(&db, &q("mock/echo"), SummarySort::Date, SortDir::Asc).await,
        ["named", "other"]
    );
    // A NULL column simply never matches; it does not swallow the whole OR.
    assert_eq!(
        summary_ids(&db, &q("sonnet"), SummarySort::Date, SortDir::Asc).await,
        ["third"]
    );
}

#[tokio::test]
async fn list_summaries_filters_by_gg_configuration_id() {
    let db = Db::connect_in_memory().await.unwrap();
    // Two configurations carrying one name, and one of `cfg-a`'s runs recorded before it
    // was renamed. Nothing about the name separates the three; the id separates all of
    // them.
    seed_gg_config_ident(&db, "mine", "cfg-a", "planning-A").await;
    seed_gg_config_ident(&db, "renamed", "cfg-a", "planning-old").await;
    seed_gg_config_ident(&db, "theirs", "cfg-b", "planning-A").await;
    // A gg run assembled by hand records no configuration, and a harness run has none to
    // record: neither belongs to any configuration's listing.
    seed_gg_ident(&db, "hand", "mock/echo", None).await;
    seed_ident(
        &db,
        "harness",
        "pong",
        "sonnet",
        HarnessSlug::Claude,
        "base",
        10,
    )
    .await;

    let by_config = |id: &str| SummaryFilter {
        gg_config_id: Some(id.to_string()),
        ..unpublished_filter()
    };

    // Both of `cfg-a`'s runs, the one recorded under its old name included, and none of
    // the same-named `cfg-b`'s.
    assert_eq!(
        summary_ids(&db, &by_config("cfg-a"), SummarySort::Date, SortDir::Asc).await,
        ["mine", "renamed"]
    );
    assert_eq!(
        summary_ids(&db, &by_config("cfg-b"), SummarySort::Date, SortDir::Asc).await,
        ["theirs"]
    );

    // What the free text over the name answers instead: it crosses the two
    // configurations and misses the renamed run, which is the reason a cell links by id.
    let by_name = SummaryFilter {
        q: Some("planning-A".to_string()),
        ..unpublished_filter()
    };
    assert_eq!(
        summary_ids(&db, &by_name, SummarySort::Date, SortDir::Asc).await,
        ["mine", "theirs"]
    );

    // An empty id is ignored, like the other equality filters.
    let unfiltered = SummaryFilter {
        gg_config_id: Some(String::new()),
        ..unpublished_filter()
    };
    assert_eq!(
        summary_ids(&db, &unfiltered, SummarySort::Date, SortDir::Asc).await,
        ["hand", "harness", "mine", "renamed", "theirs"]
    );
}

#[tokio::test]
async fn list_summaries_sorts_model_by_the_configuration_where_there_is_one() {
    let db = Db::connect_in_memory().await.unwrap();
    // Chosen so sorting by model id and sorting by what the cell shows disagree: by
    // model the gg rows lead (`mock/echo` < `sonnet`) in the order a/b; by the
    // displayed identity they are `zeta`, `alpha`, and the hand-assembled run falls
    // back to `mock/echo`.
    seed_gg_ident(&db, "a", "mock/echo", Some("zeta")).await;
    seed_gg_ident(&db, "b", "mock/echo", Some("alpha")).await;
    seed_gg_ident(&db, "hand", "mock/echo", None).await;
    seed_ident(&db, "c", "pong", "sonnet", HarnessSlug::Claude, "base", 10).await;

    assert_eq!(
        summary_ids(&db, &unpublished_filter(), SummarySort::Model, SortDir::Asc).await,
        ["b", "hand", "c", "a"]
    );
    assert_eq!(
        summary_ids(
            &db,
            &unpublished_filter(),
            SummarySort::Model,
            SortDir::Desc
        )
        .await,
        ["a", "c", "hand", "b"]
    );
}

#[tokio::test]
async fn list_summaries_sorts_test_case_by_display_name_not_slug() {
    let db = Db::connect_in_memory().await.unwrap();
    // Chosen so slug order and name order disagree: by slug `arc-foundry` <
    // `pong` < `zz-unknown`; by name Arc Foundry < Carom < `zz-unknown` still, but
    // `pong` (Carom) must file under "c" ahead of `valence` (Valence), which by
    // slug trails it.
    seed_ident(
        &db,
        "a",
        "valence",
        "sonnet",
        HarnessSlug::Claude,
        "base",
        10,
    )
    .await;
    seed_ident(&db, "b", "pong", "sonnet", HarnessSlug::Claude, "base", 10).await;
    seed_ident(
        &db,
        "c",
        "arc-foundry",
        "sonnet",
        HarnessSlug::Claude,
        "base",
        10,
    )
    .await;
    seed_ident(
        &db,
        "d",
        "zz-unknown",
        "sonnet",
        HarnessSlug::Claude,
        "base",
        10,
    )
    .await;
    let names: CaseNames = [
        ("arc-foundry", "Arc Foundry"),
        ("pong", "Carom"),
        ("valence", "Valence"),
    ]
    .into_iter()
    .map(|(slug, name)| (slug.to_string(), name.to_string()))
    .collect();

    let ids = |dir| {
        let (db, names) = (&db, &names);
        async move {
            let (runs, _) = db
                .list_summaries(
                    &unpublished_filter(),
                    SummarySort::TestCase,
                    dir,
                    names,
                    50,
                    0,
                )
                .await
                .unwrap();
            run_ids(&runs)
        }
    };
    // Arc Foundry, Carom, Valence, then the nameless slug on its own.
    assert_eq!(ids(SortDir::Asc).await, ["c", "b", "a", "d"]);
    assert_eq!(ids(SortDir::Desc).await, ["d", "a", "b", "c"]);

    // Without a name map the key degrades to the slug itself.
    let (runs, _) = db
        .list_summaries(
            &unpublished_filter(),
            SummarySort::TestCase,
            SortDir::Asc,
            &CaseNames::new(),
            50,
            0,
        )
        .await
        .unwrap();
    assert_eq!(run_ids(&runs), ["c", "b", "a", "d"]);
}

#[tokio::test]
async fn list_summaries_sorts_by_tokens_and_reverses_with_dir() {
    let db = Db::connect_in_memory().await.unwrap();
    seed_metric(&db, "a", 10, Some(1.0), None).await;
    seed_metric(&db, "b", 30, Some(1.0), None).await;
    seed_metric(&db, "c", 20, Some(1.0), None).await;

    let filter = unpublished_filter();
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Tokens, SortDir::Asc).await,
        ["a", "c", "b"]
    );
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Tokens, SortDir::Desc).await,
        ["b", "c", "a"]
    );
}

#[tokio::test]
async fn list_summaries_sorts_cost_with_unknown_cost_last_in_both_directions() {
    let db = Db::connect_in_memory().await.unwrap();
    seed_metric(&db, "hi", 1, Some(3.0), None).await;
    seed_metric(&db, "lo", 1, Some(1.0), None).await;
    seed_metric(&db, "no", 1, None, None).await;
    seed_metric(&db, "mid", 1, Some(2.0), None).await;

    let filter = unpublished_filter();
    // Ascending by cost, unknown-cost NULL pinned last.
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Cost, SortDir::Asc).await,
        ["lo", "mid", "hi", "no"]
    );
    // Descending by cost, unknown-cost NULL STILL last.
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Cost, SortDir::Desc).await,
        ["hi", "mid", "lo", "no"]
    );
}

#[tokio::test]
async fn list_summaries_sorts_rating_by_tier_with_unrated_last() {
    let db = Db::connect_in_memory().await.unwrap();
    seed_metric(&db, "flaw", 1, Some(1.0), Some(Rating::Flawless)).await;
    seed_metric(&db, "scuf", 1, Some(1.0), Some(Rating::Scuffed)).await;
    seed_metric(&db, "unr", 1, Some(1.0), None).await;
    seed_metric(&db, "grea", 1, Some(1.0), Some(Rating::Great)).await;

    let filter = unpublished_filter();
    // Ascending by tier rank: best (flawless) first, unrated NULL last.
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Rating, SortDir::Asc).await,
        ["flaw", "grea", "scuf", "unr"]
    );
    // Descending by tier rank: worst (scuffed) first, unrated NULL STILL last —
    // proving NULLs are pinned, not merely lexically ordered.
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Rating, SortDir::Desc).await,
        ["scuf", "grea", "flaw", "unr"]
    );
}

#[tokio::test]
async fn list_summaries_windows_by_offset_and_limit_with_a_full_total() {
    let db = Db::connect_in_memory().await.unwrap();
    // Five runs with strictly increasing token counts -> a deterministic order.
    for (i, id) in ["a", "b", "c", "d", "e"].iter().enumerate() {
        seed_metric(&db, id, (i as u64 + 1) * 10, Some(1.0), None).await;
    }

    // Page 2 (offset 2, limit 2) of the ascending-by-tokens order is [c, d]; the
    // total reflects every matching row, not the page size.
    let (page, total) = db
        .list_summaries(
            &unpublished_filter(),
            SummarySort::Tokens,
            SortDir::Asc,
            &CaseNames::new(),
            2,
            2,
        )
        .await
        .unwrap();
    assert_eq!(run_ids(&page), ["c", "d"]);
    assert_eq!(total, 5);

    // The tail page is short but the total is unchanged.
    let (tail, total) = db
        .list_summaries(
            &unpublished_filter(),
            SummarySort::Tokens,
            SortDir::Asc,
            &CaseNames::new(),
            2,
            4,
        )
        .await
        .unwrap();
    assert_eq!(run_ids(&tail), ["e"]);
    assert_eq!(total, 5);
}

#[tokio::test]
async fn list_summaries_total_counts_the_filtered_set_not_the_page() {
    let db = Db::connect_in_memory().await.unwrap();
    // Six pong runs and two snake runs; a filtered-and-paged pong query reports
    // total 6 (the filtered count) even though the page holds only 2.
    for i in 0..6 {
        seed_ident(
            &db,
            &format!("p{i}"),
            "pong",
            "m",
            HarnessSlug::Claude,
            "base",
            i,
        )
        .await;
    }
    for i in 0..2 {
        seed_ident(
            &db,
            &format!("s{i}"),
            "snake",
            "m",
            HarnessSlug::Claude,
            "base",
            i,
        )
        .await;
    }

    let filter = SummaryFilter {
        test_case: Some("pong".to_string()),
        ..unpublished_filter()
    };
    let (page, total) = db
        .list_summaries(
            &filter,
            SummarySort::Tokens,
            SortDir::Asc,
            &CaseNames::new(),
            2,
            0,
        )
        .await
        .unwrap();
    assert_eq!(page.len(), 2);
    assert_eq!(total, 6);
}

#[tokio::test]
async fn list_summaries_filters_by_variant_within_a_case() {
    let db = Db::connect_in_memory().await.unwrap();
    seed_ident(&db, "a", "pong", "m", HarnessSlug::Claude, "base", 10).await;
    seed_ident(&db, "b", "pong", "m", HarnessSlug::Claude, "gyre", 20).await;
    // Same variant slug under a different case: only the case+variant pair narrows
    // to one case's runs, since a variant slug is unique only within its case.
    seed_ident(&db, "c", "snake", "m", HarnessSlug::Claude, "base", 30).await;

    let filter = SummaryFilter {
        variant: Some("base".to_string()),
        ..unpublished_filter()
    };
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Tokens, SortDir::Asc).await,
        ["a", "c"]
    );

    let filter = SummaryFilter {
        test_case: Some("pong".to_string()),
        variant: Some("base".to_string()),
        ..unpublished_filter()
    };
    let (runs, total) = db
        .list_summaries(
            &filter,
            SummarySort::Tokens,
            SortDir::Asc,
            &CaseNames::new(),
            50,
            0,
        )
        .await
        .unwrap();
    assert_eq!(run_ids(&runs), ["a"]);
    assert_eq!(total, 1);
}

#[tokio::test]
async fn list_summaries_any_slice_orders_unpublished_runs_among_the_published_ones() {
    // The consoles' run listings draw from the union slice, where an unpublished
    // (and therefore unreviewed) run must take its place in the SAME sorted order as
    // the published ones rather than leading the listing.
    let db = Db::connect_in_memory().await.unwrap();
    seed_metric(&db, "pub-lo", 10, Some(1.0), Some(Rating::Great)).await;
    seed_metric(&db, "unpub-mid", 20, Some(1.0), None).await;
    seed_metric(&db, "pub-hi", 30, Some(1.0), Some(Rating::Great)).await;
    db.publish("pub-lo", "2026-06-17T21:40:00Z").await.unwrap();
    db.publish("pub-hi", "2026-06-17T21:41:00Z").await.unwrap();

    let filter = SummaryFilter {
        state: SummaryState::Any,
        ..SummaryFilter::default()
    };
    // The unpublished run sorts strictly between the two published ones by tokens —
    // in both directions — and the total counts every stored run.
    let (runs, total) = db
        .list_summaries(
            &filter,
            SummarySort::Tokens,
            SortDir::Asc,
            &CaseNames::new(),
            50,
            0,
        )
        .await
        .unwrap();
    assert_eq!(run_ids(&runs), ["pub-lo", "unpub-mid", "pub-hi"]);
    assert_eq!(total, 3);
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Tokens, SortDir::Desc).await,
        ["pub-hi", "unpub-mid", "pub-lo"]
    );

    // The narrower slices still see only their own runs.
    assert_eq!(
        summary_ids(
            &db,
            &SummaryFilter {
                state: SummaryState::Published,
                ..SummaryFilter::default()
            },
            SummarySort::Tokens,
            SortDir::Asc
        )
        .await,
        ["pub-lo", "pub-hi"]
    );
    assert_eq!(
        summary_ids(
            &db,
            &unpublished_filter(),
            SummarySort::Tokens,
            SortDir::Asc
        )
        .await,
        ["unpub-mid"]
    );
}

#[tokio::test]
async fn list_summaries_any_slice_covers_every_terminal_state() {
    // The union slice is a lifecycle union, not a state filter: a failure tier the
    // review/failures worklists exclude (an infrastructure failure) is still listed,
    // matching the produced worklist the consoles previously merged in client-side.
    let db = Db::connect_in_memory().await.unwrap();
    for (id, state) in [
        ("done", RunState::Completed),
        ("cat", RunState::Catastrophic),
        ("infra", RunState::Infrastructure),
    ] {
        let mut r = record(id);
        r.status.state = state;
        db.push(&r, &links(), None, None).await.unwrap();
    }

    let filter = SummaryFilter {
        state: SummaryState::Any,
        ..SummaryFilter::default()
    };
    let mut ids = summary_ids(&db, &filter, SummarySort::Date, SortDir::Asc).await;
    ids.sort();
    assert_eq!(ids, ["cat", "done", "infra"]);
}

#[tokio::test]
async fn sync_reference_builds_reconciles_the_table_to_the_lockfile() {
    let db = Db::connect_in_memory().await.unwrap();

    let entry =
        |slug: &str, version: &str, variant: &str, engine: &str, url: &str| ReferenceBuildEntry {
            slug: slug.to_string(),
            version: version.to_string(),
            variant: variant.to_string(),
            engine: engine.to_string(),
            url: url.to_string(),
        };
    // What the reconcile stored for one variant on one engine.
    let url_of =
        |map: &std::collections::HashMap<String, std::collections::BTreeMap<String, String>>,
         variant: &str,
         engine: &str| {
            map.get(variant)
                .and_then(|by_engine| by_engine.get(engine))
                .cloned()
        };

    // Reconciling an empty desired set against an empty table changes nothing.
    assert!(
        !db.sync_reference_builds(&[], "2026-07-13T00:00:00Z")
            .await
            .unwrap()
    );
    assert!(
        db.reference_builds_for_version("carom", "v1.1.0")
            .await
            .unwrap()
            .is_empty()
    );

    // First reconcile records two variants — one of them on two engines, which are
    // separate builds with separate URLs — and reports a change.
    let desired = vec![
        entry(
            "carom",
            "v1.1.0",
            "base",
            "none",
            "https://base-none.example.pages.dev",
        ),
        entry(
            "carom",
            "v1.1.0",
            "base",
            "simple-2d",
            "https://base-s2d.example.pages.dev",
        ),
        entry(
            "carom",
            "v1.1.0",
            "gyre",
            "none",
            "https://gyre.example.pages.dev",
        ),
    ];
    assert!(
        db.sync_reference_builds(&desired, "2026-07-13T00:00:00Z")
            .await
            .unwrap()
    );
    let map = db
        .reference_builds_for_version("carom", "v1.1.0")
        .await
        .unwrap();
    assert_eq!(map.len(), 2, "two variants");
    assert_eq!(
        url_of(&map, "base", "none").as_deref(),
        Some("https://base-none.example.pages.dev")
    );
    assert_eq!(
        url_of(&map, "base", "simple-2d").as_deref(),
        Some("https://base-s2d.example.pages.dev"),
        "one variant's two engines are two rows, not one overwriting the other"
    );

    // Re-running with the identical set is a no-op — no change, so no snapshot refresh.
    assert!(
        !db.sync_reference_builds(&desired, "2026-07-13T01:00:00Z")
            .await
            .unwrap()
    );

    // A moved URL plus dropped rows reconciles in place: base's engineless URL
    // updates, and base's other engine and gyre are pruned (absent from the new
    // desired set — the lockfile is authoritative).
    let desired = vec![entry(
        "carom",
        "v1.1.0",
        "base",
        "none",
        "https://base-2.example.pages.dev",
    )];
    assert!(
        db.sync_reference_builds(&desired, "2026-07-13T02:00:00Z")
            .await
            .unwrap()
    );
    let map = db
        .reference_builds_for_version("carom", "v1.1.0")
        .await
        .unwrap();
    assert_eq!(map.len(), 1, "gyre pruned");
    assert_eq!(
        url_of(&map, "base", "none").as_deref(),
        Some("https://base-2.example.pages.dev")
    );
    assert!(
        url_of(&map, "base", "simple-2d").is_none(),
        "the engine the lockfile no longer lists is pruned too"
    );

    // Reconciling to an empty set prunes everything that remains.
    assert!(
        db.sync_reference_builds(&[], "2026-07-13T03:00:00Z")
            .await
            .unwrap()
    );
    assert!(
        db.reference_builds_for_version("carom", "v1.1.0")
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn sync_reference_sheets_reconciles_the_table_to_the_bucket() {
    let db = Db::connect_in_memory().await.unwrap();

    let entry = |slug: &str, version: &str, variant: &str, frames: Vec<u32>| ReferenceSheetEntry {
        slug: slug.to_string(),
        version: version.to_string(),
        variant: variant.to_string(),
        frames,
    };

    // Reconciling an empty desired set against an empty table changes nothing.
    assert!(
        !db.sync_reference_sheets(&[], "2026-07-21T00:00:00Z")
            .await
            .unwrap()
    );
    assert!(
        db.reference_sheets_for_version("lattice-belt", "v1.0.0")
            .await
            .unwrap()
            .is_empty()
    );

    // First reconcile records two variants and reports a change.
    let desired = vec![
        entry("lattice-belt", "v1.0.0", "base", vec![0, 1, 2]),
        entry("lattice-belt", "v1.0.0", "curved", vec![0]),
    ];
    assert!(
        db.sync_reference_sheets(&desired, "2026-07-21T00:00:00Z")
            .await
            .unwrap()
    );
    let map = db
        .reference_sheets_for_version("lattice-belt", "v1.0.0")
        .await
        .unwrap();
    assert_eq!(map.len(), 2);
    assert_eq!(
        map.get("base").map(Vec::as_slice),
        Some([0, 1, 2].as_slice())
    );
    assert_eq!(map.get("curved").map(Vec::as_slice), Some([0].as_slice()));

    // Re-running with the identical set is a no-op — no change, so no snapshot refresh.
    assert!(
        !db.sync_reference_sheets(&desired, "2026-07-21T01:00:00Z")
            .await
            .unwrap()
    );

    // Nor does the *order* R2 happened to list the keys in count as a change: the
    // stored form is canonical, so an out-of-order (or duplicated) frame list of the
    // same set compares equal and writes nothing.
    let shuffled = vec![
        entry("lattice-belt", "v1.0.0", "base", vec![2, 0, 1, 1]),
        entry("lattice-belt", "v1.0.0", "curved", vec![0]),
    ];
    assert!(
        !db.sync_reference_sheets(&shuffled, "2026-07-21T01:30:00Z")
            .await
            .unwrap()
    );

    // A grown frame set plus a dropped variant reconciles in place: base gains a frame
    // and curved is pruned (absent from the new desired set — the bucket is
    // authoritative, so a deleted frame set stops being advertised).
    let desired = vec![entry("lattice-belt", "v1.0.0", "base", vec![0, 1, 2, 3])];
    assert!(
        db.sync_reference_sheets(&desired, "2026-07-21T02:00:00Z")
            .await
            .unwrap()
    );
    let map = db
        .reference_sheets_for_version("lattice-belt", "v1.0.0")
        .await
        .unwrap();
    assert_eq!(map.len(), 1, "curved pruned");
    assert_eq!(
        map.get("base").map(Vec::as_slice),
        Some([0, 1, 2, 3].as_slice())
    );

    // Reconciling to an empty set prunes everything that remains.
    assert!(
        db.sync_reference_sheets(&[], "2026-07-21T03:00:00Z")
            .await
            .unwrap()
    );
    assert!(
        db.reference_sheets_for_version("lattice-belt", "v1.0.0")
            .await
            .unwrap()
            .is_empty()
    );
}

#[test]
fn frames_round_trip_through_their_stored_encoding() {
    // The column form is canonical — ascending, de-duplicated, comma-separated, no
    // whitespace — because `sync_reference_sheets` decides whether to write by
    // comparing encoded strings. An unsorted or duplicated input must therefore
    // encode to the same bytes as its canonical form, or every ingest would rewrite
    // every row and force a needless snapshot refresh.
    assert_eq!(encode_frames(&[0, 1, 2]), "0,1,2");
    assert_eq!(encode_frames(&[2, 0, 1]), "0,1,2");
    assert_eq!(encode_frames(&[1, 1, 0]), "0,1");
    assert_eq!(encode_frames(&[]), "");
    assert_eq!(encode_frames(&[7]), "7");

    // Decode is the inverse, including the empty set (no frames), and multi-digit
    // indices survive — a long sprite sheet's frame 12 must not read back as 1 and 2.
    for frames in [vec![], vec![0], vec![0, 1, 2], vec![3, 12, 100]] {
        assert_eq!(decode_frames(&encode_frames(&frames)), frames);
    }

    // Decoding is lenient: the column is only ever written by `encode_frames`, so a
    // malformed value means hand-editing or a future format, and dropping one frame
    // beats failing the whole version response. The result stays canonical.
    assert_eq!(decode_frames("2,,x,0, 1 "), vec![0, 1, 2]);
}

// ---- Reviewer coverage plans + counts -------------------------------------

/// The default `record`/`new_job` combination (claude/claude-sonnet-4-5).
fn sample_combo() -> crate::api::ReviewPlanCombo {
    crate::api::ReviewPlanCombo {
        harness: HarnessSlug::Claude,
        model: "claude-sonnet-4-5".to_string(),
        provider: None,
        gg_config_id: None,
        gg_slot_models: BTreeMap::new(),
        gg_config_name: None,
    }
}

/// The default `record`/`new_job` case (pong v1.0.0 base).
fn sample_case() -> crate::api::ReviewPlanCase {
    crate::api::ReviewPlanCase {
        slug: "pong".to_string(),
        version: "v1.0.0".to_string(),
        variant: "base".to_string(),
        engine: None,
    }
}

/// A combo group with the given id/name holding [`sample_combo`].
fn combo_group(id: &str, name: &str) -> crate::api::CoverageGroup {
    crate::api::CoverageGroup {
        id: id.to_string(),
        name: name.to_string(),
        kind: crate::api::CoverageGroupKind::Combo,
        combos: vec![sample_combo()],
        cases: vec![],
        updated_at: "2026-07-15T00:00:00Z".to_string(),
    }
}

#[tokio::test]
async fn coverage_groups_round_trip_and_scope_to_account() {
    let db = Db::connect_in_memory().await.unwrap();
    assert!(db.list_coverage_groups("u1").await.unwrap().is_empty());

    db.insert_coverage_group("u1", &combo_group("g1", "Anthropic"))
        .await
        .unwrap();
    let listed = db.list_coverage_groups("u1").await.unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].name, "Anthropic");
    assert_eq!(listed[0].combos.len(), 1);
    // Only the kind's members are stored: a combo group carries no cases.
    assert!(listed[0].cases.is_empty());

    // Scoped by account: another user cannot read it.
    assert!(db.get_coverage_group("u2", "g1").await.unwrap().is_none());
    assert!(db.list_coverage_groups("u2").await.unwrap().is_empty());

    // Update in place (owner only).
    let mut renamed = combo_group("g1", "Anthropic (all)");
    renamed.updated_at = "2026-07-15T01:00:00Z".to_string();
    assert!(db.update_coverage_group("u1", &renamed).await.unwrap());
    assert!(
        !db.update_coverage_group("u2", &renamed).await.unwrap(),
        "a non-owner update matches no row"
    );
    assert_eq!(
        db.get_coverage_group("u1", "g1")
            .await
            .unwrap()
            .unwrap()
            .name,
        "Anthropic (all)"
    );

    // Delete (owner only).
    assert!(!db.delete_coverage_group("u2", "g1").await.unwrap());
    assert!(db.delete_coverage_group("u1", "g1").await.unwrap());
    assert!(db.list_coverage_groups("u1").await.unwrap().is_empty());
}

#[tokio::test]
async fn coverage_plans_round_trip_and_scope_to_account() {
    let db = Db::connect_in_memory().await.unwrap();
    assert!(db.list_coverage_plans("u1").await.unwrap().is_empty());

    let plan = crate::api::CoveragePlan {
        id: "p1".to_string(),
        name: "Anthropic/E2E".to_string(),
        runs_per_cell: 3,
        combo_group_ids: vec!["g1".to_string()],
        case_group_ids: vec![],
        combos: vec![],
        cases: vec![sample_case()],
        updated_at: "2026-07-15T00:00:00Z".to_string(),
    };
    db.insert_coverage_plan("u1", &plan, &CoveragePlanSchedule::default())
        .await
        .unwrap();

    let got = db.get_coverage_plan("u1", "p1").await.unwrap().unwrap();
    assert_eq!(got.name, "Anthropic/E2E");
    assert_eq!(got.combo_group_ids, vec!["g1".to_string()]);
    assert_eq!(got.cases.len(), 1);
    // Scoped by account.
    assert!(db.get_coverage_plan("u2", "p1").await.unwrap().is_none());

    // Update in place (owner only).
    let mut bumped = plan.clone();
    bumped.runs_per_cell = 5;
    assert!(db.update_coverage_plan("u1", &bumped).await.unwrap());
    assert!(!db.update_coverage_plan("u2", &bumped).await.unwrap());
    assert_eq!(
        db.get_coverage_plan("u1", "p1")
            .await
            .unwrap()
            .unwrap()
            .runs_per_cell,
        5
    );

    // Delete (owner only).
    assert!(!db.delete_coverage_plan("u2", "p1").await.unwrap());
    assert!(db.delete_coverage_plan("u1", "p1").await.unwrap());
    assert!(db.list_coverage_plans("u1").await.unwrap().is_empty());
}

/// Seed a legacy single-per-account `review_plan` row (the shape the backfill
/// migrates), carrying one case and one combination.
async fn seed_legacy_review_plan(db: &Db, user_id: &str) {
    review_plan::Entity::insert(review_plan::ActiveModel {
        user_id: Set(user_id.to_string()),
        runs_per_cell: Set(4),
        cases_json: Set(serde_json::to_string(&vec![sample_case()]).unwrap()),
        combinations_json: Set(serde_json::to_string(&vec![sample_combo()]).unwrap()),
        updated_at: Set("2026-07-11T00:00:00Z".to_string()),
        migrated: Set(false),
    })
    .exec(&db.connection())
    .await
    .unwrap();
}

#[tokio::test]
async fn backfill_migrates_each_legacy_plan_exactly_once() {
    let db = Db::connect_in_memory().await.unwrap();
    seed_legacy_review_plan(&db, "u1").await;

    // First run migrates the legacy plan into one coverage plan with its members
    // inlined as one-offs (referencing no groups).
    assert_eq!(
        crate::bootstrap::backfill_coverage_plans(&db)
            .await
            .unwrap(),
        1
    );
    let plans = db.list_coverage_plans("u1").await.unwrap();
    assert_eq!(plans.len(), 1);
    assert_eq!(plans[0].name, "My coverage plan");
    assert_eq!(plans[0].runs_per_cell, 4);
    assert_eq!(plans[0].combos.len(), 1);
    assert_eq!(plans[0].cases.len(), 1);
    assert!(plans[0].combo_group_ids.is_empty());

    // Re-running is a no-op: the migrated flag guards against a duplicate.
    assert_eq!(
        crate::bootstrap::backfill_coverage_plans(&db)
            .await
            .unwrap(),
        0
    );
    assert_eq!(db.list_coverage_plans("u1").await.unwrap().len(), 1);

    // A migrated plan the reviewer deletes is not recreated on the next startup.
    let id = plans[0].id.clone();
    assert!(db.delete_coverage_plan("u1", &id).await.unwrap());
    assert_eq!(
        crate::bootstrap::backfill_coverage_plans(&db)
            .await
            .unwrap(),
        0
    );
    assert!(db.list_coverage_plans("u1").await.unwrap().is_empty());
}

#[tokio::test]
async fn coverage_counts_completed_runs_and_in_flight_jobs_per_cell() {
    let db = Db::connect_in_memory().await.unwrap();
    // A completed run and a queued job for the same cell.
    db.push(&record("r1"), &links(), None, None).await.unwrap();
    db.enqueue_job(new_job("j1", "2026-06-23T00:00:00Z"))
        .await
        .unwrap();

    let slugs = vec!["pong".to_string()];
    let completed = db.count_completed_runs_by_cell(&slugs).await.unwrap();
    let in_flight = db.count_in_flight_jobs_by_cell(&slugs).await.unwrap();
    // A harness cell key: the six identity segments plus the empty gg pair. Neither the
    // run nor the job names an engine, so both are counted as the `none` runs they are.
    let cell = |version: &str, model: &str| {
        (
            "pong".to_string(),
            version.to_string(),
            "base".to_string(),
            "none".to_string(),
            "claude".to_string(),
            model.to_string(),
            String::new(),
            String::new(),
        )
    };

    assert_eq!(
        completed.get(&cell("v1.0.0", "claude-sonnet-4-5")).copied(),
        Some(1),
        "the one completed run counts"
    );
    assert_eq!(
        in_flight.get(&cell("v1.0.0", "claude-sonnet-4-5")).copied(),
        Some(1),
        "the queued job counts as in-flight"
    );

    // A different model shares nothing: neither count sees it.
    assert_eq!(completed.get(&cell("v1.0.0", "other-model")), None);
    // A different pinned version is a different cell.
    assert_eq!(completed.get(&cell("v2.0.0", "claude-sonnet-4-5")), None);
}

#[tokio::test]
async fn coverage_counts_are_keyed_by_the_engine_and_read_a_missing_one_as_none() {
    let db = Db::connect_in_memory().await.unwrap();
    // Two completed runs of one case at one version and variant, on two engines. They are
    // two cells: a model handed a runtime is not doing the work a model starting from
    // nothing is, so the two results are not comparable and must not pool.
    seed_engine(&db, "r1", "simple-2d").await;
    seed_engine(&db, "r2", "none").await;
    // And a run whose slug was never lifted — a row the backfill could not read. An
    // absent engine is the engineless run, so it counts with `none` rather than into a
    // cell of its own that nothing pins.
    seed_engine(&db, "r3", "none").await;
    let mut active = lifted(&db, "r3").await.into_active_model();
    active.engine_slug = Set(None);
    active.update(&db.connection()).await.unwrap();

    let completed = db
        .count_completed_runs_by_cell(&["pong".to_string()])
        .await
        .unwrap();
    let cell = |engine: &str| {
        (
            "pong".to_string(),
            "v1.0.0".to_string(),
            "base".to_string(),
            engine.to_string(),
            "claude".to_string(),
            "claude-sonnet-4-5".to_string(),
            String::new(),
            String::new(),
        )
    };
    assert_eq!(completed.get(&cell("simple-2d")).copied(), Some(1));
    assert_eq!(
        completed.get(&cell("none")).copied(),
        Some(2),
        "the lifted `none` run and the unlifted one are the same cell"
    );
    assert_eq!(completed.len(), 2, "no third cell for the unlifted row");
}

#[tokio::test]
async fn an_in_flight_job_is_counted_under_the_engine_it_was_enqueued_on() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_job(NewJob {
        engine_slug: Some("simple-2d".to_string()),
        ..new_job("j1", "2026-06-23T00:00:00Z")
    })
    .await
    .unwrap();
    db.enqueue_job(new_job("j2", "2026-06-23T00:00:01Z"))
        .await
        .unwrap();

    let in_flight = db
        .count_in_flight_jobs_by_cell(&["pong".to_string()])
        .await
        .unwrap();
    let cell = |engine: &str| {
        (
            "pong".to_string(),
            "v1.0.0".to_string(),
            "base".to_string(),
            engine.to_string(),
            "claude".to_string(),
            "claude-sonnet-4-5".to_string(),
            String::new(),
            String::new(),
        )
    };
    // A cell pinned to one engine must not see the runs already coming for another, or a
    // plan reads its shortfall as filled and buys nothing it actually asked for.
    assert_eq!(in_flight.get(&cell("simple-2d")).copied(), Some(1));
    assert_eq!(in_flight.get(&cell("none")).copied(), Some(1));
}

/// A queued job whose stored launch request names `engine`, with the lifted column left
/// `NULL` — the shape of every job that was already in flight when the column arrived.
fn unlifted_engine_job(id: &str, engine: Option<&str>) -> NewJob {
    let engine = engine
        .map(|slug| format!(",\"engine\":\"{slug}\""))
        .unwrap_or_default();
    NewJob {
        request_json: format!(
            "{{\"testCase\":\"pong\",\"version\":\"v1.0.0\",\"variant\":\"base\",\
             \"harness\":\"claude\",\"model\":\"claude-sonnet-4-5\"{engine}}}"
        ),
        ..new_job(id, "2026-06-23T00:00:00Z")
    }
}

#[tokio::test]
async fn backfilling_an_in_flight_engine_slug_reads_the_jobs_own_launch_request() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_job(unlifted_engine_job("j1", Some("simple-2d")))
        .await
        .unwrap();
    db.enqueue_job(unlifted_engine_job("j2", None))
        .await
        .unwrap();

    // Only the job that named a real engine is rewritten. One that named none is already
    // counted where it belongs — an absent slug is the `none` engine, not an unknown one —
    // so filling it in would be a write for a number that does not change.
    assert_eq!(db.backfill_in_flight_engine_slugs().await.unwrap(), 1);
    assert_eq!(
        db.get_job("j1").await.unwrap().unwrap().engine_slug,
        Some("simple-2d".to_string())
    );
    assert_eq!(db.get_job("j2").await.unwrap().unwrap().engine_slug, None);

    // Idempotent, because it runs on every boot: the second pass finds nothing left.
    assert_eq!(db.backfill_in_flight_engine_slugs().await.unwrap(), 0);

    // And the point of the pass — the filled job is now counted against the cell its run
    // will actually land in, rather than against the `none` cell it never belonged to.
    let in_flight = db
        .count_in_flight_jobs_by_cell(&["pong".to_string()])
        .await
        .unwrap();
    let cell = |engine: &str| {
        (
            "pong".to_string(),
            "v1.0.0".to_string(),
            "base".to_string(),
            engine.to_string(),
            "claude".to_string(),
            "claude-sonnet-4-5".to_string(),
            String::new(),
            String::new(),
        )
    };
    assert_eq!(in_flight.get(&cell("simple-2d")).copied(), Some(1));
    assert_eq!(in_flight.get(&cell("none")).copied(), Some(1));
}

#[tokio::test]
async fn backfilling_an_engine_slug_leaves_the_jobs_that_are_no_longer_in_flight() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_job(unlifted_engine_job("j1", Some("simple-2d")))
        .await
        .unwrap();
    db.set_job_state("j1", "succeeded", "2026-06-23T00:01:00Z", None, None)
        .await
        .unwrap();

    // A finished job's coverage comes from the `run` row it produced, so rewriting the
    // whole job history would be a large write for a number nothing reads. The pass is
    // bounded to what is still in flight across the deploy.
    assert_eq!(db.backfill_in_flight_engine_slugs().await.unwrap(), 0);
    assert_eq!(db.get_job("j1").await.unwrap().unwrap().engine_slug, None);
}

#[tokio::test]
async fn a_claimed_job_no_longer_counts_toward_a_cell() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_job(new_job("j1", "2026-06-23T00:00:00Z"))
        .await
        .unwrap();
    let slugs = vec!["pong".to_string()];
    let key = (
        "pong".to_string(),
        "v1.0.0".to_string(),
        "base".to_string(),
        // A job enqueued with no engine counts as a `none` job: an absent engine is the
        // engineless run, not an unknown one.
        "none".to_string(),
        "claude".to_string(),
        "claude-sonnet-4-5".to_string(),
        String::new(),
        String::new(),
    );
    assert_eq!(
        db.count_in_flight_jobs_by_cell(&slugs)
            .await
            .unwrap()
            .get(&key)
            .copied(),
        Some(1),
        "queued counts"
    );
    // Claiming moves it to `dispatched` — still in-flight.
    db.claim_next_job("2026-06-23T00:00:05Z").await.unwrap();
    assert_eq!(
        db.count_in_flight_jobs_by_cell(&slugs)
            .await
            .unwrap()
            .get(&key)
            .copied(),
        Some(1),
        "dispatched still counts"
    );
}

/// A provider-routed harness (OpenCode / Kilo Code) launches — and so stores on
/// both the job and the produced run — its model id with the `openrouter/` prefix
/// the plan's canonical `combo.model` omits. Coverage must count those against the
/// *launched* id, or a provider-routed cell reads zero forever (the in-flight badge
/// never shows and "Trigger" re-launches indefinitely). This pins the invariant the
/// `coverage` handler relies on by using [`launch_model_id`] the same way it does.
#[tokio::test]
async fn coverage_counts_provider_routed_runs_by_their_launched_model_id() {
    use test_cabinet_core::model_id::launch_model_id;

    let db = Db::connect_in_memory().await.unwrap();
    // The canonical model the reviewer pins in their plan, and the prefixed id an
    // OpenCode job/run is actually launched with and stored under.
    let canonical = "anthropic/claude-opus-4.8";
    let launched = launch_model_id(canonical, HarnessSlug::Opencode, None);
    assert_eq!(launched, "openrouter/anthropic/claude-opus-4.8");

    // A completed OpenCode run and a queued OpenCode job, both stored prefixed.
    db.push(
        &run_with_model(
            "r1",
            &launched,
            HarnessSlug::Opencode,
            TokenCounts::default(),
        ),
        &links(),
        None,
        None,
    )
    .await
    .unwrap();
    db.enqueue_job(NewJob {
        harness_slug: "opencode".to_string(),
        model_id: launched.clone(),
        ..new_job("j1", "2026-06-23T00:00:00Z")
    })
    .await
    .unwrap();

    let slugs = vec!["pong".to_string()];
    let completed = db.count_completed_runs_by_cell(&slugs).await.unwrap();
    let in_flight = db.count_in_flight_jobs_by_cell(&slugs).await.unwrap();
    let cell = |model: &str| {
        (
            "pong".to_string(),
            "v1.0.0".to_string(),
            "base".to_string(),
            "none".to_string(),
            "opencode".to_string(),
            model.to_string(),
            String::new(),
            String::new(),
        )
    };

    // The plan's bare canonical id — the pre-fix behavior — matches neither the
    // completed run nor the queued job, because the stored ids carry the prefix.
    assert_eq!(
        completed.get(&cell(canonical)),
        None,
        "the bare canonical id does not match the prefixed stored run",
    );
    assert_eq!(
        in_flight.get(&cell(canonical)),
        None,
        "the bare canonical id does not match the prefixed queued job",
    );

    // Matching against the launched id — what `coverage` now does — counts both.
    assert_eq!(
        completed.get(&cell(&launched)).copied(),
        Some(1),
        "the launched id counts the completed run",
    );
    assert_eq!(
        in_flight.get(&cell(&launched)).copied(),
        Some(1),
        "the launched id counts the in-flight job",
    );
}

#[tokio::test]
async fn unreviewed_lists_completed_runs_with_no_review_and_drops_them_once_reviewed() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record("r1"), &links(), None, None).await.unwrap();

    let (unreviewed, _) = db.list_unreviewed(50, None).await.unwrap();
    assert_eq!(unreviewed.len(), 1, "a fresh completed run is unreviewed");
    assert_eq!(unreviewed[0].record.id, "r1");

    // Once any account reviews it, it drops off the unreviewed worklist.
    db.add_review("r1", &review(), None, None).await.unwrap();
    let (after, _) = db.list_unreviewed(50, None).await.unwrap();
    assert!(after.is_empty(), "a reviewed run is no longer unreviewed");
}

#[tokio::test]
async fn unreviewed_excludes_the_auto_graded_performance_type() {
    // A performance run is graded by its validator (correctness, then fuel) and
    // carries no reviewer checklist, so its `review_count` is 0 forever. Were it
    // listed, it would wedge the worklist permanently: no reviewer could ever clear
    // it. Both unreviewed paths — the cursor listing and the console's paged summary
    // listing — must drop it while still surfacing a reviewable run beside it.
    let db = Db::connect_in_memory().await.unwrap();

    let mut perf = record("perf");
    perf.subject.test_type = test_cabinet_core::TestType::Performance;
    perf.subject.test_case_slug = "lattice".to_string();
    db.push(&perf, &links(), None, None).await.unwrap();
    db.push(&record("e2e"), &links(), None, None).await.unwrap();

    let (cursor, _) = db.list_unreviewed(50, None).await.unwrap();
    let cursor_ids: Vec<&str> = cursor.iter().map(|r| r.record.id.as_str()).collect();
    assert_eq!(
        cursor_ids,
        ["e2e"],
        "list_unreviewed drops the auto-graded performance run"
    );

    let (summaries, total) = db
        .list_summaries(
            &SummaryFilter {
                state: SummaryState::Unreviewed,
                ..SummaryFilter::default()
            },
            SummarySort::Date,
            SortDir::Desc,
            &CaseNames::new(),
            50,
            0,
        )
        .await
        .unwrap();
    let summary_ids: Vec<&str> = summaries.iter().map(|s| s.record.id.as_str()).collect();
    assert_eq!(
        summary_ids,
        ["e2e"],
        "the console's unreviewed slice drops it too"
    );
    // The count backs the pager, so it must agree with the page it sizes.
    assert_eq!(total, 1, "the total excludes the performance run as well");
}

/// A game-jam run record with a captured README, for the prior-readmes lookup.
fn game_jam_record(
    id: &str,
    harness: HarnessSlug,
    model: &str,
    readme: &str,
    finished_at: &str,
) -> RunRecord {
    let mut r = record(id);
    r.subject.test_type = test_cabinet_core::TestType::GameJam;
    r.subject.test_case_slug = "comfort-zone".to_string();
    r.subject.harness_slug = harness;
    r.subject.model_id = model.to_string();
    r.finished_at = finished_at.to_string();
    r.game_jam_readme = Some(readme.to_string());
    r
}

/// The prior-readmes lookup returns the same jam + model oldest first — including
/// entries built under a *different* harness, since it is the model that would
/// otherwise retell the same idea — and only runs that captured a README, regardless
/// of publish state.
#[tokio::test]
async fn game_jam_prior_readmes_matches_jam_and_model_across_harnesses_oldest_first() {
    let db = Db::connect_in_memory().await.unwrap();

    // Two matching runs (unpublished — the lookup does not require publishing),
    // pushed newest-first to prove the query re-orders them oldest-first. The newer
    // one ran under a different harness: same model, so it still counts.
    db.push(
        &game_jam_record(
            "newer",
            HarnessSlug::Codex,
            "sonnet",
            "# Tide Pool",
            "2026-02-02T00:00:00Z",
        ),
        &links(),
        None,
        None,
    )
    .await
    .unwrap();
    db.push(
        &game_jam_record(
            "older",
            HarnessSlug::Claude,
            "sonnet",
            "# Space Miner",
            "2026-01-01T00:00:00Z",
        ),
        &links(),
        None,
        None,
    )
    .await
    .unwrap();

    // A different model — excluded.
    db.push(
        &game_jam_record(
            "other-model",
            HarnessSlug::Claude,
            "opus",
            "# Other",
            "2026-01-15T00:00:00Z",
        ),
        &links(),
        None,
        None,
    )
    .await
    .unwrap();

    // A matching run that captured no README — excluded.
    let mut no_readme = game_jam_record(
        "no-readme",
        HarnessSlug::Claude,
        "sonnet",
        "",
        "2026-01-20T00:00:00Z",
    );
    no_readme.game_jam_readme = None;
    db.push(&no_readme, &links(), None, None).await.unwrap();

    let entries = db
        .game_jam_prior_readmes("comfort-zone", "sonnet")
        .await
        .unwrap();

    let readmes: Vec<&str> = entries.iter().map(|e| e.readme.as_str()).collect();
    assert_eq!(
        readmes,
        vec!["# Space Miner", "# Tide Pool"],
        "oldest first, matches only"
    );
    assert_eq!(entries[0].run_id, "older");
    assert_eq!(entries[0].finished_at, "2026-01-01T00:00:00Z");
}

/// A minimal stored comparison for the CRUD round-trip.
fn sample_stored_comparison(id: &str) -> StoredComparison {
    use std::collections::BTreeMap;

    use test_cabinet_core::comparison::{ComparisonArm, ComparisonConfig, ComparisonControls};
    StoredComparison {
        id: id.to_string(),
        user_id: "user-1".to_string(),
        name: "carom-pi-vs-kilo".to_string(),
        description: "Pi vs Kilo".to_string(),
        config: ComparisonConfig {
            controls: ComparisonControls {
                case_slug: "carom".to_string(),
                version: "v2.0.0".to_string(),
                variant: "base".to_string(),
                orchestrator_slug: "one-shot".to_string(),
                engine_slug: "none".to_string(),
                container_build: None,
            },
            arms: vec![ComparisonArm {
                id: "pi".to_string(),
                label: "Pi".to_string(),
                harness_slug: Some(HarnessSlug::Pi),
                model_id: Some("anthropic/claude-opus-4.8".to_string()),
                gg_config_id: None,
                gg_slot_models: BTreeMap::new(),
                run_ids: vec!["pi-1".to_string()],
            }],
            n: 3,
        },
        published: false,
        published_at: None,
        created_at: "2026-07-27T00:00:00Z".to_string(),
        updated_at: "2026-07-27T00:00:00Z".to_string(),
    }
}

#[tokio::test]
async fn comparison_crud_round_trips_and_scopes_to_the_owner() {
    let db = Db::connect_in_memory().await.unwrap();
    let stored = sample_stored_comparison("cmp-1");

    // Insert, then read it back with its config intact.
    db.insert_comparison("user-1", &stored).await.unwrap();
    let got = db.get_comparison("user-1", "cmp-1").await.unwrap().unwrap();
    assert_eq!(got, stored);

    // Another account cannot see it.
    assert!(
        db.get_comparison("user-2", "cmp-1")
            .await
            .unwrap()
            .is_none()
    );

    // It lists for its owner.
    let listed = db.list_comparisons("user-1").await.unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, "cmp-1");

    // Update changes name/description/config but leaves created_at and publish state.
    let mut edited = stored.clone();
    edited.name = "renamed".to_string();
    edited.config.n = 5;
    edited.updated_at = "2026-07-27T02:00:00Z".to_string();
    assert!(db.update_comparison("user-1", &edited).await.unwrap());
    let after = db.get_comparison("user-1", "cmp-1").await.unwrap().unwrap();
    assert_eq!(after.name, "renamed");
    assert_eq!(after.config.n, 5);
    assert_eq!(after.created_at, "2026-07-27T00:00:00Z");
    assert!(!after.published);

    // Publishing flips the flag and stamps the timestamp.
    assert!(
        db.set_comparison_published("user-1", "cmp-1", true, Some("2026-07-27T03:00:00Z"))
            .await
            .unwrap()
    );
    let published = db.get_comparison("user-1", "cmp-1").await.unwrap().unwrap();
    assert!(published.published);
    assert_eq!(
        published.published_at.as_deref(),
        Some("2026-07-27T03:00:00Z")
    );

    // A non-owner cannot delete it; the owner can.
    assert!(!db.delete_comparison("user-2", "cmp-1").await.unwrap());
    assert!(db.delete_comparison("user-1", "cmp-1").await.unwrap());
    assert!(
        db.get_comparison("user-1", "cmp-1")
            .await
            .unwrap()
            .is_none()
    );
}

/// A completed run carrying one automated validation verdict — an auto-validated
/// run, the kind a comparison publishes without a human review.
fn auto_validated_record(id: &str) -> RunRecord {
    use test_cabinet_core::validation::{AutoVerdict, DebugScriptResult};
    let mut rec = record(id);
    rec.validation.debug_scripts = vec![DebugScriptResult {
        item_id: "a".to_string(),
        sub_item_id: None,
        title: String::new(),
        category_title: String::new(),
        script: "validation/a.mjs".to_string(),
        gates: true,
        ran: true,
        precondition_unmet: false,
        inconclusive: None,
        detail: None,
        verdicts: vec![AutoVerdict {
            id: "a".to_string(),
            pass: true,
            assertions: vec![],
        }],
        outputs: vec![],
    }];
    rec
}

#[tokio::test]
async fn the_comparison_publish_gate_waives_review_only_for_an_auto_validated_run() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&auto_validated_record("auto"), &links(), None, None)
        .await
        .unwrap();
    db.push(&record("bare"), &links(), None, None)
        .await
        .unwrap();

    // The normal publish gate still requires a human review — even for the
    // auto-validated run.
    assert!(db.ensure_publishable("auto").await.is_err());
    assert!(db.ensure_publishable("bare").await.is_err());

    // The comparison publish gate waives the review requirement, but ONLY for a run
    // that actually carries automated verdicts. A bare review-less run is still
    // refused — there is nothing to stand in for the missing review.
    assert!(db.ensure_publishable_comparison_run("auto").await.is_ok());
    assert!(db.ensure_publishable_comparison_run("bare").await.is_err());
}

/// A record carrying a **real** code analysis, produced by pointing the real analyzer at a
/// two-file tree. A ninety-five-field literal would drift from the contract on the next
/// metric added; this cannot.
fn record_with_code_analysis(id: &str) -> RunRecord {
    let mut record = record_with_metrics(id);
    let tree = tempfile::TempDir::new().expect("temp dir");
    std::fs::create_dir_all(tree.path().join("src")).expect("a source directory");
    std::fs::write(
        tree.path().join("src/main.ts"),
        "export function boot(): number {\n  return 1;\n}\n",
    )
    .expect("a source file");
    record.code_analysis = Some(
        test_cabinet_code_analysis::analyze(&test_cabinet_code_analysis::AnalysisRequest {
            root: tree.path(),
            seed_commit: None,
            tree_basis: test_cabinet_core::CodeTreeBasis::PreValidation,
            // A hand-built fixture tree with no run behind it, so nothing is known to
            // have been seeded into its root.
            root_seeding: test_cabinet_code_analysis::walk::RootSeeding::default(),
        })
        .summary,
    );
    record
}

#[tokio::test]
async fn push_lifts_the_code_analyzer_version_and_leaves_it_null_without_an_analysis() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record_with_code_analysis("analysed"), &links(), None, None)
        .await
        .unwrap();
    db.push(&record_with_metrics("unanalysed"), &links(), None, None)
        .await
        .unwrap();

    assert_eq!(
        lifted(&db, "analysed").await.code_analyzer_version,
        Some(test_cabinet_core::CODE_ANALYZER_VERSION as i32),
    );
    // NULL means *never analysed*, not "analysed by an unknown generation": there is no
    // backfill of the analysis itself, so absence is a durable, meaningful state.
    assert_eq!(lifted(&db, "unanalysed").await.code_analyzer_version, None);
}

#[tokio::test]
async fn the_lifted_analyzer_version_describes_the_stored_result_not_the_server() {
    // A backend whose binary carries one analyzer generation must not restamp a stored
    // run's figures with a generation that did not compute them — the column would then
    // say the corpus is homogeneous when it is not, which is the exact failure it exists
    // to prevent. So the lift reads the record's own stamp, never the server's constant.
    let db = Db::connect_in_memory().await.unwrap();
    let other_generation = test_cabinet_core::CODE_ANALYZER_VERSION + 1;
    let mut record = record_with_code_analysis("other");
    record.code_analysis.as_mut().unwrap().analyzer_version = other_generation;
    db.push(&record, &links(), None, None).await.unwrap();

    assert_eq!(
        lifted(&db, "other").await.code_analyzer_version,
        Some(other_generation as i32)
    );
}

#[tokio::test]
async fn a_code_analysis_changes_no_other_column_on_the_run_row() {
    // Q8: no code figure may influence a run's score or verdict. Structurally that means
    // the analysis must be inert everywhere but its own column — so pushing the same run
    // with and without one must produce byte-identical rows apart from
    // `code_analyzer_version` and the record blob that carries it.
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record_with_metrics("without"), &links(), None, None)
        .await
        .unwrap();
    let mut with = record_with_code_analysis("with");
    with.subject = record_with_metrics("with").subject;
    db.push(&with, &links(), None, None).await.unwrap();

    let without = lifted(&db, "without").await;
    let with = lifted(&db, "with").await;
    assert_eq!(with.run_state, without.run_state);
    assert_eq!(with.rating, without.rating);
    assert_eq!(with.review_count, without.review_count);
    assert_eq!(with.loaded, without.loaded);
    assert_eq!(with.run_time_seconds, without.run_time_seconds);
    assert_eq!(with.total_tokens, without.total_tokens);
    assert_eq!(with.cost_comparable, without.cost_comparable);
    assert_eq!(with.test_type, without.test_type);
    assert_ne!(with.code_analyzer_version, without.code_analyzer_version);
}

#[tokio::test]
async fn backfill_code_analyzer_version_lifts_the_column_but_analyses_nothing() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record_with_code_analysis("analysed"), &links(), None, None)
        .await
        .unwrap();
    db.push(&record_with_metrics("unanalysed"), &links(), None, None)
        .await
        .unwrap();

    // Simulate rows that predate the column: it read NULL for both.
    for id in ["analysed", "unanalysed"] {
        let mut active = lifted(&db, id).await.into_active_model();
        active.code_analyzer_version = Set(None);
        active.update(&db.connection()).await.unwrap();
    }

    assert_eq!(db.backfill_code_analyzer_version().await.unwrap(), 1);
    assert_eq!(
        lifted(&db, "analysed").await.code_analyzer_version,
        Some(test_cabinet_core::CODE_ANALYZER_VERSION as i32),
    );
    // The run with no analysis stays NULL. The backfill lifts a number the record blob
    // already holds; it never *analyses* a tree, because a historical run's tree can only
    // be re-read post-validation and those are not comparable figures.
    assert_eq!(lifted(&db, "unanalysed").await.code_analyzer_version, None);

    // Settles to an *empty* candidate set, not merely a no-write one. The distinction is
    // the whole cost of this routine: the analysis-less half of the `NULL`s is every run
    // recorded before the analyzer shipped, so a pass that re-read them would fetch and
    // parse the entire historical corpus on every boot, before the router is built. The
    // blob filter is what keeps them out, so it is asserted directly rather than through
    // the return value — a no-write pass and a no-read one both report 0.
    assert_eq!(db.backfill_code_analyzer_version().await.unwrap(), 0);
    let candidates = run::Entity::find()
        .filter(run::Column::CodeAnalyzerVersion.is_null())
        .filter(run::Column::RecordJson.contains("\"codeAnalysis\""))
        .all(&db.connection())
        .await
        .unwrap();
    assert!(
        candidates.is_empty(),
        "the unanalysed run must not be a candidate at all, but {} row(s) would be \
         re-read on every boot",
        candidates.len(),
    );
}

// ---- Coverage buffering, ladders, and job attribution ----------------------

/// The default completed run, with control over whether its build loaded — the one
/// fact a ladder gate is allowed to judge without a reviewer.
fn record_loaded(id: &str, loaded: bool) -> RunRecord {
    let mut record = record(id);
    record.validation.loaded = loaded;
    record
}

/// The cell key `record`/`new_job` produce: pong v1.0.0 base on the `none` engine on
/// claude/sonnet, with the empty gg pair every harness cell carries.
fn sample_cell() -> CellKey {
    (
        "pong".to_string(),
        "v1.0.0".to_string(),
        "base".to_string(),
        "none".to_string(),
        "claude".to_string(),
        "claude-sonnet-4-5".to_string(),
        String::new(),
        String::new(),
    )
}

#[tokio::test]
async fn unreviewed_cell_counts_are_per_account_and_ignore_another_reviewers_pass() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record("r1"), &links(), None, None).await.unwrap();
    db.push(&record("r2"), &links(), None, None).await.unwrap();
    let slugs = vec!["pong".to_string()];

    // Nobody has reviewed: both runs are outstanding for either account.
    for account in ["u1", "u2"] {
        assert_eq!(
            db.count_unreviewed_runs_by_cell(&slugs, account, false)
                .await
                .unwrap()
                .get(&sample_cell())
                .copied(),
            Some(2),
        );
    }

    // `u2` reviews one. That clears it from *their* buffer and nobody else's —
    // judgement is per account even though the run counts are global.
    db.add_review("r1", &review_by("u2", Rating::Great), None, None)
        .await
        .unwrap();
    assert_eq!(
        db.count_unreviewed_runs_by_cell(&slugs, "u2", false)
            .await
            .unwrap()
            .get(&sample_cell())
            .copied(),
        Some(1),
    );
    assert_eq!(
        db.count_unreviewed_runs_by_cell(&slugs, "u1", false)
            .await
            .unwrap()
            .get(&sample_cell())
            .copied(),
        Some(2),
        "another account's review does not empty this account's buffer",
    );
}

#[tokio::test]
async fn gg_saved_queries_round_trip_and_scope_to_account() {
    let db = Db::connect_in_memory().await.unwrap();
    assert!(db.list_gg_saved_queries("u1").await.unwrap().is_empty());

    let saved = crate::api::GgSavedQuery {
        id: "q1".to_string(),
        name: "overflow by model".to_string(),
        description: "how often context ran out".to_string(),
        query: "has.summary:true | stats avg(summary.ranOutOfContext) by model".to_string(),
        range_id: "30d".to_string(),
        updated_at: "2026-08-01T00:00:00Z".to_string(),
    };
    db.insert_gg_saved_query("u1", &saved).await.unwrap();

    // Stored and returned as source text — nothing on the read path parses it, so a
    // relative range in the text survives the round trip verbatim.
    let got = db.get_gg_saved_query("u1", "q1").await.unwrap().unwrap();
    assert_eq!(got, saved);

    // The corpus is deployment-wide; the *view* over it is not.
    assert!(db.get_gg_saved_query("u2", "q1").await.unwrap().is_none());
    assert!(db.list_gg_saved_queries("u2").await.unwrap().is_empty());

    // Update in place (owner only).
    let mut edited = saved.clone();
    edited.query = "| stats count() by model".to_string();
    edited.range_id = "all".to_string();
    assert!(db.update_gg_saved_query("u1", &edited).await.unwrap());
    assert!(!db.update_gg_saved_query("u2", &edited).await.unwrap());
    let got = db.get_gg_saved_query("u1", "q1").await.unwrap().unwrap();
    assert_eq!(got.query, "| stats count() by model");
    assert_eq!(got.range_id, "all");

    // Delete (owner only).
    assert!(!db.delete_gg_saved_query("u2", "q1").await.unwrap());
    assert!(db.delete_gg_saved_query("u1", "q1").await.unwrap());
    assert!(db.list_gg_saved_queries("u1").await.unwrap().is_empty());
}

#[tokio::test]
async fn gg_dashboards_round_trip_and_scope_to_account() {
    let db = Db::connect_in_memory().await.unwrap();
    assert!(db.list_gg_dashboards("u1").await.unwrap().is_empty());

    let board = crate::api::GgDashboard {
        id: "d1".to_string(),
        name: "compaction comparison".to_string(),
        description: String::new(),
        panels: vec![
            crate::api::GgDashboardPanel {
                title: "Sessions".to_string(),
                query: "| stats count() by bucket(started, 1d)".to_string(),
                width: 12,
            },
            crate::api::GgDashboardPanel {
                title: "Outcomes".to_string(),
                query: "| stats count() by state".to_string(),
                width: 6,
            },
        ],
        range_id: "90d".to_string(),
        updated_at: "2026-08-01T00:00:00Z".to_string(),
    };
    db.insert_gg_dashboard("u1", &board).await.unwrap();

    // The panel list is JSON text in the row, read and written whole — and it comes back
    // in **render order**, which is the only binding between a panel and its answer once
    // the board is drawn from one batched request.
    let got = db.get_gg_dashboard("u1", "d1").await.unwrap().unwrap();
    assert_eq!(got, board);

    assert!(db.get_gg_dashboard("u2", "d1").await.unwrap().is_none());
    assert!(db.list_gg_dashboards("u2").await.unwrap().is_empty());

    let mut edited = board.clone();
    edited.panels.truncate(1);
    assert!(db.update_gg_dashboard("u1", &edited).await.unwrap());
    assert!(!db.update_gg_dashboard("u2", &edited).await.unwrap());
    assert_eq!(
        db.get_gg_dashboard("u1", "d1")
            .await
            .unwrap()
            .unwrap()
            .panels
            .len(),
        1
    );

    assert!(!db.delete_gg_dashboard("u2", "d1").await.unwrap());
    assert!(db.delete_gg_dashboard("u1", "d1").await.unwrap());
    assert!(db.list_gg_dashboards("u1").await.unwrap().is_empty());
}

#[tokio::test]
async fn gg_agents_round_trip_and_scope_to_account() {
    use test_cabinet_core::gg::{GgAgentConfig, GgModelSlot};

    let db = Db::connect_in_memory().await.unwrap();
    assert!(db.list_gg_agents("u1").await.unwrap().is_empty());

    let agent = crate::api::GgSavedAgent {
        id: "a1".to_string(),
        name: "reviewer".to_string(),
        description: "reviews what the implementer wrote".to_string(),
        agent: GgAgentConfig {
            name: "reviewer".to_string(),
            model_slot: Some("critic".to_string()),
            model_slots: vec![GgModelSlot {
                name: "critic".to_string(),
                default_model_id: Some("mock/echo".to_string()),
                passthrough: true,
            }],
            ..GgAgentConfig::root()
        },
        updated_at: "2026-08-18T00:00:00Z".to_string(),
    };
    db.insert_gg_agent("u1", &agent).await.unwrap();

    // The profile column is read and written whole, so the profile a configuration
    // imports is byte-for-byte the profile that was saved, model slots and all.
    let got = db.get_gg_agent("u1", "a1").await.unwrap().unwrap();
    assert_eq!(got.agent, agent.agent);
    assert_eq!(got.name, "reviewer");

    // The library belongs to the account that wrote it.
    assert!(db.get_gg_agent("u2", "a1").await.unwrap().is_none());
    assert!(db.list_gg_agents("u2").await.unwrap().is_empty());

    let mut edited = agent.clone();
    edited.agent.custom_instructions = Some("Be brief.".to_string());
    assert!(db.update_gg_agent("u1", &edited).await.unwrap());
    assert!(!db.update_gg_agent("u2", &edited).await.unwrap());
    assert_eq!(
        db.get_gg_agent("u1", "a1")
            .await
            .unwrap()
            .unwrap()
            .agent
            .custom_instructions
            .as_deref(),
        Some("Be brief.")
    );

    // Names are unique per account, and the check the handler makes is a scan of this
    // list — so another account holding the name changes nothing.
    let mut theirs = agent.clone();
    theirs.id = "a2".to_string();
    db.insert_gg_agent("u2", &theirs).await.unwrap();
    assert_eq!(db.list_gg_agents("u1").await.unwrap().len(), 1);

    assert!(!db.delete_gg_agent("u2", "a1").await.unwrap());
    assert!(db.delete_gg_agent("u1", "a1").await.unwrap());
    assert!(db.list_gg_agents("u1").await.unwrap().is_empty());
}

#[tokio::test]
async fn gg_configs_round_trip_their_agent_sources() {
    use test_cabinet_core::gg::GgCapabilitySet;

    let db = Db::connect_in_memory().await.unwrap();
    let config = crate::api::GgConfig {
        id: "c1".to_string(),
        name: "review arm".to_string(),
        description: String::new(),
        capability_set: GgCapabilitySet::minimal("mock/echo"),
        agent_sources: vec![crate::api::GgAgentSource {
            profile_id: "root".to_string(),
            agent_id: "a1".to_string(),
            overrides: vec!["customInstructions".to_string()],
        }],
        updated_at: "2026-08-18T00:00:00Z".to_string(),
    };
    db.insert_gg_config("u1", &config).await.unwrap();

    // The sources sit beside the resolved capability set: gg reads the set, the console
    // reads these to know which fields still follow the saved agent.
    let got = db.get_gg_config("u1", "c1").await.unwrap().unwrap();
    assert_eq!(got.agent_sources, config.agent_sources);

    let mut edited = config.clone();
    edited.agent_sources.clear();
    assert!(db.update_gg_config("u1", &edited).await.unwrap());
    assert!(
        db.get_gg_config("u1", "c1")
            .await
            .unwrap()
            .unwrap()
            .agent_sources
            .is_empty()
    );
}

#[tokio::test]
async fn unreviewed_cell_counts_can_exclude_a_run_whose_build_never_loaded() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record_loaded("loaded", true), &links(), None, None)
        .await
        .unwrap();
    db.push(&record_loaded("dead", false), &links(), None, None)
        .await
        .unwrap();
    let slugs = vec!["pong".to_string()];

    // A coverage plan has no gate: a dead build still wants a human to look at it.
    assert_eq!(
        db.count_unreviewed_runs_by_cell(&slugs, "u1", false)
            .await
            .unwrap()
            .get(&sample_cell())
            .copied(),
        Some(2),
    );
    // A ladder that counts an unloaded build as broken decides it without a
    // reviewer, so it must not hold a buffer slot waiting for one.
    assert_eq!(
        db.count_unreviewed_runs_by_cell(&slugs, "u1", true)
            .await
            .unwrap()
            .get(&sample_cell())
            .copied(),
        Some(1),
    );
}

#[tokio::test]
async fn unreviewed_cell_counts_skip_the_automatically_graded_types() {
    let db = Db::connect_in_memory().await.unwrap();
    let mut auto = record("perf");
    auto.subject.test_type = TestType::Performance;
    db.push(&auto, &links(), None, None).await.unwrap();

    // No reviewer can ever clear a performance run, so counting it would hold a
    // buffer slot that never frees — exactly why `list_unreviewed` drops it too.
    assert!(
        db.count_unreviewed_runs_by_cell(&["pong".to_string()], "u1", false)
            .await
            .unwrap()
            .is_empty(),
    );
}

#[tokio::test]
async fn cell_run_ratings_read_only_the_requesting_accounts_review() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record("r1"), &links(), None, None).await.unwrap();
    // Two reviewers disagree. The lifted `run.rating` is the worse of the two, and
    // is exactly what a gate must not read.
    db.add_review("r1", &review_by("u1", Rating::Great), None, None)
        .await
        .unwrap();
    db.add_review("r1", &review_by("u2", Rating::Broken), None, None)
        .await
        .unwrap();
    assert_eq!(
        lifted(&db, "r1").await.rating.as_deref(),
        Some("broken"),
        "the run's aggregate is the worst across reviewers",
    );

    let mine = db.cell_run_ratings(&sample_cell(), "u1").await.unwrap();
    assert_eq!(mine.len(), 1);
    assert_eq!(mine[0].run_id, "r1");
    assert_eq!(
        mine[0].rating,
        Some(Rating::Great),
        "u1's climb is gated on u1's own judgement, not u2's harsher one",
    );
    // And the account that has not reviewed it at all sees no rating — which is
    // "undecided", not "bad".
    assert_eq!(
        db.cell_run_ratings(&sample_cell(), "u3").await.unwrap()[0].rating,
        None,
    );
}

#[tokio::test]
async fn cell_run_ratings_hold_only_completed_runs() {
    let db = Db::connect_in_memory().await.unwrap();
    let mut failed = record("boom");
    failed.status.state = RunState::HarnessError;
    db.push(&failed, &links(), None, None).await.unwrap();
    db.push(&record("ok"), &links(), None, None).await.unwrap();

    let runs = db.cell_run_ratings(&sample_cell(), "u1").await.unwrap();
    // An infrastructure failure retries; it is never evidence, and never a wall.
    assert_eq!(
        runs.iter().map(|r| r.run_id.as_str()).collect::<Vec<_>>(),
        vec!["ok"],
    );
}

/// A queued job attributed to `user_id` and launched by `origin`.
fn attributed_job(id: &str, user_id: &str, origin: Option<JobOrigin>) -> NewJob {
    NewJob {
        user_id: Some(user_id.to_string()),
        origin,
        ..new_job(id, "2026-08-15T00:00:00Z")
    }
}

#[tokio::test]
async fn job_origin_tokens_round_trip_and_never_collide_across_kinds() {
    assert_eq!(JobOrigin::Plan("x".to_string()).as_token(), "plan:x");
    assert_eq!(
        JobOrigin::parse("ladder:x"),
        Some(JobOrigin::Ladder("x".to_string())),
    );
    // A plan and a ladder that happen to share an id are still different origins.
    assert_ne!(
        JobOrigin::Plan("x".to_string()).as_token(),
        JobOrigin::Ladder("x".to_string()).as_token(),
    );
    // A manual launch, and anything unrecognized, is simply unattributed.
    assert_eq!(JobOrigin::parse(""), None);
    assert_eq!(JobOrigin::parse("plan:"), None);
    assert_eq!(JobOrigin::parse("tournament:x"), None);
}

#[tokio::test]
async fn a_scoped_halt_cancels_its_own_waiting_jobs_and_nothing_else() {
    let db = Db::connect_in_memory().await.unwrap();
    let plan = JobOrigin::Plan("p1".to_string());
    db.enqueue_jobs(vec![
        attributed_job("mine-1", "u1", Some(plan.clone())),
        attributed_job("mine-2", "u1", Some(plan.clone())),
        attributed_job("other-plan", "u1", Some(JobOrigin::Plan("p2".to_string()))),
        attributed_job("ladder", "u1", Some(JobOrigin::Ladder("p1".to_string()))),
        attributed_job("by-hand", "u1", None),
    ])
    .await
    .unwrap();

    let cancelled = db
        .cancel_jobs(
            &JobCancelFilter {
                states: &CANCELABLE_WAITING_STATES,
                origin: Some(&plan),
                ..JobCancelFilter::default()
            },
            "2026-08-15T00:01:00Z",
            "halted",
        )
        .await
        .unwrap();
    assert_eq!(cancelled, 2, "the halt reports what it actually cancelled");

    let still_waiting: Vec<String> = db
        .active_jobs()
        .await
        .unwrap()
        .into_iter()
        .map(|job| job.id)
        .collect();
    // Another plan's runs, a ladder that shares the id, and the run someone kicked
    // off by hand all survive — the last of these is why `origin` exists at all.
    assert_eq!(still_waiting, vec!["other-plan", "ladder", "by-hand"]);
    assert_eq!(
        db.get_job("mine-1")
            .await
            .unwrap()
            .unwrap()
            .detail
            .as_deref(),
        Some("halted"),
    );
}

#[tokio::test]
async fn a_bulk_cancel_spares_running_jobs_unless_they_are_asked_for() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_jobs(vec![
        attributed_job("waiting", "u1", None),
        attributed_job("running", "u1", None),
        attributed_job("done", "u1", None),
    ])
    .await
    .unwrap();
    db.set_job_state("running", "running", "2026-08-15T00:00:30Z", None, None)
        .await
        .unwrap();
    db.set_job_state("done", "succeeded", "2026-08-15T00:00:30Z", None, None)
        .await
        .unwrap();

    // "Clear pending": the jobs that have cost nothing yet.
    let cleared = db
        .cancel_jobs(
            &JobCancelFilter {
                states: &CANCELABLE_WAITING_STATES,
                ..JobCancelFilter::default()
            },
            "2026-08-15T00:01:00Z",
            "cleared",
        )
        .await
        .unwrap();
    assert_eq!(cleared, 1);
    assert_eq!(
        db.get_job("running").await.unwrap().unwrap().state,
        "running",
        "an executing run keeps going until it is explicitly killed",
    );

    // "Kill active": the expensive half, confirmed separately in the console.
    let killed = db
        .cancel_jobs(
            &JobCancelFilter {
                states: &CANCELABLE_ACTIVE_STATES,
                ..JobCancelFilter::default()
            },
            "2026-08-15T00:02:00Z",
            "killed",
        )
        .await
        .unwrap();
    assert_eq!(killed, 1);
    // A job that already reached a terminal state is untouchable, exactly as it is
    // through `cancel_job`.
    assert_eq!(
        db.get_job("done").await.unwrap().unwrap().state,
        "succeeded"
    );
}

#[tokio::test]
async fn coverage_buffer_target_is_absent_until_the_account_chooses_one() {
    let db = Db::connect_in_memory().await.unwrap();
    // No row means "no opinion", so the caller applies its own default rather than
    // the store inventing a zero.
    assert_eq!(db.coverage_buffer_target("u1").await.unwrap(), None);

    db.set_coverage_buffer_target(
        "u1",
        BufferTarget::Bounded { runs: 10 },
        "2026-08-15T00:00:00Z",
    )
    .await
    .unwrap();
    assert_eq!(
        db.coverage_buffer_target("u1").await.unwrap(),
        Some(BufferTarget::Bounded { runs: 10 })
    );
    // An explicit zero is a real instruction — "never top me up" — and is stored.
    db.set_coverage_buffer_target(
        "u1",
        BufferTarget::Bounded { runs: 0 },
        "2026-08-15T01:00:00Z",
    )
    .await
    .unwrap();
    assert_eq!(
        db.coverage_buffer_target("u1").await.unwrap(),
        Some(BufferTarget::Bounded { runs: 0 })
    );
    // So is "no bound at all", and it round-trips as itself rather than as some
    // large number the read would have to reinterpret.
    db.set_coverage_buffer_target("u1", BufferTarget::Unbounded, "2026-08-15T02:00:00Z")
        .await
        .unwrap();
    assert_eq!(
        db.coverage_buffer_target("u1").await.unwrap(),
        Some(BufferTarget::Unbounded)
    );
    assert_eq!(db.coverage_buffer_target("u2").await.unwrap(), None);
}

#[test]
fn buffer_target_column_encoding_round_trips_every_shape() {
    for target in [
        BufferTarget::Bounded { runs: 0 },
        BufferTarget::Bounded { runs: 10 },
        BufferTarget::Bounded { runs: 500 },
        BufferTarget::Unbounded,
    ] {
        assert_eq!(
            buffer_target_from_column(buffer_target_to_column(target)),
            target
        );
    }
    // The unbounded marker is negative, so no bound the API can hand the store ever
    // collides with it — a bound too wide for the column saturates rather than wraps.
    assert!(buffer_target_to_column(BufferTarget::Unbounded) < 0);
    assert_eq!(
        buffer_target_from_column(buffer_target_to_column(BufferTarget::Bounded {
            runs: u32::MAX
        })),
        BufferTarget::Bounded {
            runs: i32::MAX as u32
        }
    );
    // Any negative reads as unbounded: there is exactly one such instruction.
    assert_eq!(buffer_target_from_column(-7), BufferTarget::Unbounded);
}

/// The minimal plan used by the scheduling/top-up tests.
fn schedulable_plan(id: &str) -> crate::api::CoveragePlan {
    crate::api::CoveragePlan {
        id: id.to_string(),
        name: "Anthropic/E2E".to_string(),
        runs_per_cell: 3,
        combo_group_ids: vec![],
        case_group_ids: vec![],
        combos: vec![sample_combo()],
        cases: vec![sample_case()],
        updated_at: "2026-08-15T00:00:00Z".to_string(),
    }
}

#[tokio::test]
async fn editing_a_plans_declaration_never_disturbs_its_schedule() {
    let db = Db::connect_in_memory().await.unwrap();
    let plan = schedulable_plan("p1");
    db.insert_coverage_plan("u1", &plan, &CoveragePlanSchedule::default())
        .await
        .unwrap();

    let paused = CoveragePlanSchedule {
        outer_axis: "combination".to_string(),
        paused: true,
        auto_top_up: true,
        buffer_target: Some(BufferTarget::Bounded { runs: 4 }),
    };
    assert!(
        db.set_coverage_plan_schedule("u1", "p1", &paused)
            .await
            .unwrap()
    );
    assert!(
        !db.set_coverage_plan_schedule("u2", "p1", &paused)
            .await
            .unwrap(),
        "the schedule is the owner's to change",
    );

    // Saving an edit to the members must not un-pause a plan somebody paused.
    let mut bumped = plan.clone();
    bumped.runs_per_cell = 5;
    assert!(db.update_coverage_plan("u1", &bumped).await.unwrap());
    assert_eq!(
        db.coverage_plan_schedule("u1", "p1").await.unwrap(),
        Some(paused),
    );
}

#[tokio::test]
async fn a_top_up_claim_is_exclusive_until_it_is_released_or_expires() {
    let db = Db::connect_in_memory().await.unwrap();
    db.insert_coverage_plan(
        "u1",
        &schedulable_plan("p1"),
        &CoveragePlanSchedule::default(),
    )
    .await
    .unwrap();

    assert!(
        db.claim_coverage_plan_top_up("u1", "p1", "2026-08-15T00:00:00Z")
            .await
            .unwrap()
    );
    // The second console tab observes the same shortfall a moment later and must
    // not enqueue for it a second time.
    assert!(
        !db.claim_coverage_plan_top_up("u1", "p1", "2026-08-15T00:00:01Z")
            .await
            .unwrap()
    );
    db.release_coverage_plan_top_up("p1").await.unwrap();
    assert!(
        db.claim_coverage_plan_top_up("u1", "p1", "2026-08-15T00:00:02Z")
            .await
            .unwrap()
    );

    // A caller that died mid-top-up expires out of the claim rather than wedging
    // the plan: the marker is a timestamp precisely so this can recover itself.
    assert!(
        db.claim_coverage_plan_top_up("u1", "p1", "2026-08-15T00:05:00Z")
            .await
            .unwrap()
    );
    // Someone else's plan is not claimable at all.
    assert!(
        !db.claim_coverage_plan_top_up("u2", "p1", "2026-08-15T01:00:00Z")
            .await
            .unwrap()
    );
}

/// One rung of a test ladder, pinned to `version` of `slug`.
fn rung(id: &str, slug: &str, version: &str) -> StoredLadderRung {
    StoredLadderRung {
        id: id.to_string(),
        slug: slug.to_string(),
        version: version.to_string(),
        variant: "base".to_string(),
        engine: None,
        runs_override: None,
    }
}

/// A ladder with the given rungs, climbed by [`sample_combo`].
fn test_ladder(id: &str, name: &str, rungs: Vec<StoredLadderRung>) -> StoredLadder {
    StoredLadder {
        id: id.to_string(),
        name: name.to_string(),
        runs_per_cell: 5,
        gate: Gate {
            floor: Rating::Scuffed,
            threshold: GateThreshold::Fraction { fraction: 0.5 },
            unloaded_counts_as_broken: true,
            early_stop: false,
        },
        combo_group_ids: vec!["g1".to_string()],
        combos: vec![sample_combo()],
        rungs,
        updated_at: "2026-08-15T00:00:00Z".to_string(),
    }
}

#[tokio::test]
async fn ladders_round_trip_with_their_gate_and_scope_to_account() {
    let db = Db::connect_in_memory().await.unwrap();
    assert!(db.list_ladders("u1").await.unwrap().is_empty());

    let ladder = test_ladder(
        "l1",
        "E2E difficulty climb",
        vec![
            rung("r1", "pong", "v1.0.0"),
            rung("r2", "carom", "v1.0.0"),
            // A rung pinned to an engine, so the pin's fourth segment is proved to
            // survive the round trip rather than silently reverting to the engineless
            // run every rung written before the column existed asks for.
            StoredLadderRung {
                engine: Some("simple-2d".to_string()),
                ..rung("r3", "caldera", "v1.2.0")
            },
        ],
    );
    db.insert_ladder("u1", &ladder, &LadderSchedule::default())
        .await
        .unwrap();

    let got = db.get_ladder("u1", "l1").await.unwrap().unwrap();
    assert_eq!(got.name, "E2E difficulty climb");
    assert_eq!(got.runs_per_cell, 5);
    // The gate round-trips through its three columns without changing shape.
    assert_eq!(got.gate, ladder.gate);
    assert_eq!(got.combo_group_ids, vec!["g1".to_string()]);
    assert_eq!(got.combos.len(), 1);
    assert_eq!(got.rungs, ladder.rungs);
    // Rungs come back in climb order, which is the order they were written in.
    assert_eq!(
        got.rungs
            .iter()
            .map(|r| r.slug.as_str())
            .collect::<Vec<_>>(),
        vec!["pong", "carom", "caldera"],
    );
    assert!(db.get_ladder("u2", "l1").await.unwrap().is_none());
    assert!(db.list_ladders("u2").await.unwrap().is_empty());

    // The schedule is stored apart from the declaration, as a plan's is.
    assert_eq!(
        db.ladder_schedule("u1", "l1").await.unwrap(),
        Some(LadderSchedule::default()),
    );
    let steered = LadderSchedule {
        outer_axis: "combination".to_string(),
        paused: true,
        auto_top_up: false,
        buffer_target: Some(BufferTarget::Unbounded),
    };
    assert!(db.set_ladder_schedule("u1", "l1", &steered).await.unwrap());
    assert!(!db.set_ladder_schedule("u2", "l1", &steered).await.unwrap());

    assert!(!db.delete_ladder("u2", "l1").await.unwrap());
    assert!(db.delete_ladder("u1", "l1").await.unwrap());
    assert!(db.list_ladders("u1").await.unwrap().is_empty());
    // The rungs went with it (they cascade), leaving nothing orphaned.
    assert!(db.list_ladder_rungs("l1").await.unwrap().is_empty());
}

#[tokio::test]
async fn reordering_a_ladder_keeps_every_climbers_recorded_progress() {
    let db = Db::connect_in_memory().await.unwrap();
    let ladder = test_ladder(
        "l1",
        "Climb",
        vec![rung("r1", "pong", "v1.0.0"), rung("r2", "carom", "v1.0.0")],
    );
    db.insert_ladder("u1", &ladder, &LadderSchedule::default())
        .await
        .unwrap();
    let combo = combination_key(&sample_combo());
    db.record_ladder_outcome(
        "l1",
        "r1",
        &combo,
        "v1.0.0",
        LadderOutcomeKind::Advanced,
        "2026-08-15T01:00:00Z",
    )
    .await
    .unwrap();

    // Swap the two rungs and add a third. Rungs are reconciled under their stable
    // ids, so nothing is deleted — which matters because outcomes cascade from
    // `ladder_rung`, and a delete-and-reinsert would silently erase the climb.
    let mut reordered = ladder.clone();
    reordered.rungs = vec![
        rung("r2", "carom", "v1.0.0"),
        rung("r1", "pong", "v1.0.0"),
        rung("r3", "caldera", "v1.2.0"),
    ];
    assert!(db.update_ladder("u1", &reordered).await.unwrap());

    assert_eq!(
        db.list_ladder_rungs("l1")
            .await
            .unwrap()
            .iter()
            .map(|r| r.id.as_str())
            .collect::<Vec<_>>(),
        vec!["r2", "r1", "r3"],
    );
    let outcomes = db.list_ladder_outcomes("l1").await.unwrap();
    assert_eq!(outcomes.len(), 1, "the verdict survived the reorder");
    assert_eq!(outcomes[0].rung_id, "r1");
    assert_eq!(outcomes[0].outcome, LadderOutcomeKind::Advanced);

    // Dropping a rung from the climb does take its verdicts with it — that is what
    // removing it means.
    let mut trimmed = ladder.clone();
    trimmed.rungs = vec![rung("r2", "carom", "v1.0.0")];
    assert!(db.update_ladder("u1", &trimmed).await.unwrap());
    assert!(db.list_ladder_outcomes("l1").await.unwrap().is_empty());
}

#[tokio::test]
async fn a_recomputed_outcome_never_overwrites_a_reviewers_override() {
    let db = Db::connect_in_memory().await.unwrap();
    db.insert_ladder(
        "u1",
        &test_ladder("l1", "Climb", vec![rung("r1", "pong", "v1.0.0")]),
        &LadderSchedule::default(),
    )
    .await
    .unwrap();
    let combo = combination_key(&sample_combo());

    db.record_ladder_outcome(
        "l1",
        "r1",
        &combo,
        "v1.0.0",
        LadderOutcomeKind::Walled,
        "2026-08-15T01:00:00Z",
    )
    .await
    .unwrap();
    // The reviewer disagrees and promotes past the wall.
    assert!(
        db.set_ladder_outcome_override(
            "l1",
            "r1",
            &combo,
            "v1.0.0",
            Some(LadderOutcomeKind::Advanced),
            "2026-08-15T02:00:00Z",
        )
        .await
        .unwrap()
    );

    // A later recompute re-states the automatic verdict and must leave the human
    // decision — and therefore the effective one — exactly as it was.
    db.record_ladder_outcome(
        "l1",
        "r1",
        &combo,
        "v1.0.0",
        LadderOutcomeKind::Walled,
        "2026-08-15T03:00:00Z",
    )
    .await
    .unwrap();
    let outcome = &db.list_ladder_outcomes("l1").await.unwrap()[0];
    assert_eq!(outcome.outcome, LadderOutcomeKind::Walled);
    assert_eq!(
        outcome.override_outcome,
        Some(LadderOutcomeKind::Advanced),
        "the override survives a recompute",
    );
    assert_eq!(outcome.effective(), LadderOutcomeKind::Advanced);
    assert_eq!(outcome.decided_at, "2026-08-15T03:00:00Z");

    // Clearing it reverses the override exactly, restoring the gate's own verdict.
    assert!(
        db.set_ladder_outcome_override("l1", "r1", &combo, "v1.0.0", None, "2026-08-15T04:00:00Z")
            .await
            .unwrap()
    );
    let outcome = &db.list_ladder_outcomes("l1").await.unwrap()[0];
    assert_eq!(outcome.override_outcome, None);
    assert_eq!(outcome.override_at, None);
    assert_eq!(outcome.effective(), LadderOutcomeKind::Walled);

    // There is nothing to promote past on a rung the gate has not resolved.
    assert!(
        !db.set_ladder_outcome_override(
            "l1",
            "r1",
            &combo,
            "v9.9.9",
            Some(LadderOutcomeKind::Advanced),
            "2026-08-15T05:00:00Z",
        )
        .await
        .unwrap()
    );
}

#[tokio::test]
async fn bumping_a_rungs_version_neither_erases_nor_inherits_the_old_verdict() {
    let db = Db::connect_in_memory().await.unwrap();
    let ladder = test_ladder("l1", "Climb", vec![rung("r1", "pong", "v1.0.0")]);
    db.insert_ladder("u1", &ladder, &LadderSchedule::default())
        .await
        .unwrap();
    let combo = combination_key(&sample_combo());
    db.record_ladder_outcome(
        "l1",
        "r1",
        &combo,
        "v1.0.0",
        LadderOutcomeKind::Advanced,
        "2026-08-15T01:00:00Z",
    )
    .await
    .unwrap();

    // Re-pin the rung to a newer case version, keeping its stable id.
    let mut bumped = ladder.clone();
    bumped.rungs = vec![rung("r1", "pong", "v2.0.0")];
    assert!(db.update_ladder("u1", &bumped).await.unwrap());

    let versions: Vec<String> = db
        .list_ladder_outcomes("l1")
        .await
        .unwrap()
        .into_iter()
        .map(|o| o.decided_version)
        .collect();
    assert_eq!(
        versions,
        vec!["v1.0.0"],
        "the verdict stays recorded against the version that earned it",
    );

    // The new pin starts undecided, and deciding it leaves both on the books.
    db.record_ladder_outcome(
        "l1",
        "r1",
        &combo,
        "v2.0.0",
        LadderOutcomeKind::Walled,
        "2026-08-15T02:00:00Z",
    )
    .await
    .unwrap();
    assert_eq!(db.list_ladder_outcomes("l1").await.unwrap().len(), 2);
}

#[tokio::test]
async fn ladder_climbers_hold_steering_only_and_are_optional() {
    let db = Db::connect_in_memory().await.unwrap();
    db.insert_ladder(
        "u1",
        &test_ladder("l1", "Climb", vec![rung("r1", "pong", "v1.0.0")]),
        &LadderSchedule::default(),
    )
    .await
    .unwrap();
    // An un-steered combination writes nothing, which is how a model added to a
    // standing ladder simply starts at rung 1.
    assert!(db.list_ladder_climbers("l1").await.unwrap().is_empty());

    let combo = combination_key(&sample_combo());
    db.set_ladder_climber(
        "l1",
        &StoredLadderClimber {
            combination_key: combo.clone(),
            priority: 5,
            focused: true,
            held: false,
            updated_at: "2026-08-15T01:00:00Z".to_string(),
        },
    )
    .await
    .unwrap();
    // Re-steering the same combination updates it rather than adding a second row.
    db.set_ladder_climber(
        "l1",
        &StoredLadderClimber {
            combination_key: combo.clone(),
            priority: 5,
            focused: true,
            held: true,
            updated_at: "2026-08-15T02:00:00Z".to_string(),
        },
    )
    .await
    .unwrap();

    let climbers = db.list_ladder_climbers("l1").await.unwrap();
    assert_eq!(climbers.len(), 1);
    assert!(climbers[0].held);
    assert_eq!(climbers[0].updated_at, "2026-08-15T02:00:00Z");
}

/// A gg cell key for the `record` case: pong v1.0.0 base on the gg harness, with the
/// configuration id and bound-model string that separate one gg arm from another.
fn gg_cell(config_id: &str, models: &str) -> CellKey {
    (
        "pong".to_string(),
        "v1.0.0".to_string(),
        "base".to_string(),
        "none".to_string(),
        "gg".to_string(),
        "mock/echo".to_string(),
        config_id.to_string(),
        models.to_string(),
    )
}

/// A queued gg job of the `new_job` case, lifted into the cell `config_id`/`models` name.
fn new_gg_job(id: &str, config_id: &str, models: &str) -> NewJob {
    NewJob {
        harness_slug: "gg".to_string(),
        model_id: "mock/echo".to_string(),
        gg_preset: Some("planning-A".to_string()),
        gg_config_id: Some(config_id.to_string()),
        gg_models: Some(models.to_string()),
        ..new_job(id, "2026-06-23T00:00:00Z")
    }
}

#[tokio::test]
async fn a_gg_cell_is_counted_by_its_configuration_and_the_models_it_binds() {
    let db = Db::connect_in_memory().await.unwrap();
    // Three gg runs of one case on one root model, differing only in the two segments
    // that make a gg cell: the configuration they came from, and the set of models it
    // binds.
    for (id, config_id, models) in [
        ("a-echo", "cfg-a", vec!["mock/echo"]),
        ("a-both", "cfg-a", vec!["mock/echo", "anthropic/opus"]),
        ("b-echo", "cfg-b", vec!["mock/echo"]),
    ] {
        db.push(
            &gg_record_config(id, config_id, "planning-A", &models),
            &links(),
            None,
            None,
        )
        .await
        .unwrap();
    }
    // Plus a third-party-harness run of the same case, which must not join any of them.
    db.push(&record("harness"), &links(), None, None)
        .await
        .unwrap();

    let slugs = vec!["pong".to_string()];
    let completed = db.count_completed_runs_by_cell(&slugs).await.unwrap();
    assert_eq!(
        completed.get(&gg_cell("cfg-a", "root=mock/echo")).copied(),
        Some(1),
    );
    assert_eq!(
        completed
            .get(&gg_cell("cfg-a", "agent-1=anthropic/opus,root=mock/echo"))
            .copied(),
        Some(1),
        "one configuration binding a second model is a second arm, not the same cell",
    );
    assert_eq!(
        completed.get(&gg_cell("cfg-b", "root=mock/echo")).copied(),
        Some(1),
        "two configurations are two cells however alike their bindings, and however \
         alike their names",
    );
    assert_eq!(
        completed.get(&sample_cell()).copied(),
        Some(1),
        "the harness run keeps its own cell, whose gg segments are empty",
    );

    // A queued gg job is attributed to its cell from the columns lifted at enqueue,
    // so an in-flight run counts toward the same target its finished record will.
    db.enqueue_job(new_gg_job("j1", "cfg-a", "root=mock/echo"))
        .await
        .unwrap();
    db.enqueue_job(new_gg_job("j2", "cfg-b", "root=mock/echo"))
        .await
        .unwrap();
    let in_flight = db.count_in_flight_jobs_by_cell(&slugs).await.unwrap();
    assert_eq!(
        in_flight.get(&gg_cell("cfg-a", "root=mock/echo")).copied(),
        Some(1),
    );
    assert_eq!(
        in_flight.get(&gg_cell("cfg-b", "root=mock/echo")).copied(),
        Some(1),
    );
}

#[tokio::test]
async fn a_renamed_configuration_keeps_its_cell_and_the_counts_under_it() {
    let db = Db::connect_in_memory().await.unwrap();
    // Two runs of one configuration, recorded either side of a rename: each records the
    // name the configuration carried at launch, and both record the id it has always had.
    db.push(
        &gg_record_config("before", "cfg-a", "planning-A", &["mock/echo"]),
        &links(),
        None,
        None,
    )
    .await
    .unwrap();
    db.push(
        &gg_record_config("after", "cfg-a", "planning-A-v2", &["mock/echo"]),
        &links(),
        None,
        None,
    )
    .await
    .unwrap();

    let completed = db
        .count_completed_runs_by_cell(&["pong".to_string()])
        .await
        .unwrap();
    assert_eq!(
        completed.get(&gg_cell("cfg-a", "root=mock/echo")).copied(),
        Some(2),
        "renaming a configuration re-points nothing: the runs behind the cell survive it",
    );
    assert_eq!(completed.len(), 1, "one configuration, one cell");
}

#[tokio::test]
async fn two_configurations_sharing_a_name_are_two_cells() {
    let db = Db::connect_in_memory().await.unwrap();
    // Nothing keeps a configuration's name unique within an account, so one name can
    // stand for two capability sets. They are two cells, and a run of one never counts
    // toward the other's target.
    for id in ["cfg-a", "cfg-b"] {
        db.push(
            &gg_record_config(id, id, "planning-A", &["mock/echo"]),
            &links(),
            None,
            None,
        )
        .await
        .unwrap();
    }

    let completed = db
        .count_completed_runs_by_cell(&["pong".to_string()])
        .await
        .unwrap();
    assert_eq!(
        completed.get(&gg_cell("cfg-a", "root=mock/echo")).copied(),
        Some(1),
    );
    assert_eq!(
        completed.get(&gg_cell("cfg-b", "root=mock/echo")).copied(),
        Some(1),
    );
}

#[tokio::test]
async fn unreviewed_gg_cell_counts_split_on_the_configuration_too() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(
        &gg_record_config("a", "cfg-a", "planning-A", &["mock/echo"]),
        &links(),
        None,
        None,
    )
    .await
    .unwrap();
    db.push(
        &gg_record_config("b", "cfg-b", "planning-B", &["mock/echo"]),
        &links(),
        None,
        None,
    )
    .await
    .unwrap();
    db.add_review("a", &review_by("u1", Rating::Great), None, None)
        .await
        .unwrap();

    let unreviewed = db
        .count_unreviewed_runs_by_cell(&["pong".to_string()], "u1", false)
        .await
        .unwrap();
    assert_eq!(unreviewed.get(&gg_cell("cfg-a", "root=mock/echo")), None);
    assert_eq!(
        unreviewed.get(&gg_cell("cfg-b", "root=mock/echo")).copied(),
        Some(1),
        "reviewing one configuration's run says nothing about another's",
    );
}

#[tokio::test]
async fn cell_run_ratings_read_the_evidence_of_one_gg_configuration_only() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(
        &gg_record_config("a", "cfg-a", "planning-A", &["mock/echo"]),
        &links(),
        None,
        None,
    )
    .await
    .unwrap();
    db.push(
        &gg_record_config("b", "cfg-b", "planning-B", &["mock/echo"]),
        &links(),
        None,
        None,
    )
    .await
    .unwrap();
    db.push(&record("harness"), &links(), None, None)
        .await
        .unwrap();

    // A gate reads the runs of the configuration its climber names — not every gg run
    // of the case, which would let one arm's failures wall another's climb.
    let a = db
        .cell_run_ratings(&gg_cell("cfg-a", "root=mock/echo"), "u1")
        .await
        .unwrap();
    assert_eq!(
        a.iter().map(|run| run.run_id.as_str()).collect::<Vec<_>>(),
        vec!["a"],
    );

    // And the harness cell's empty pair selects the runs that carry no configuration,
    // rather than matching nothing at all.
    let harness = db.cell_run_ratings(&sample_cell(), "u1").await.unwrap();
    assert_eq!(
        harness
            .iter()
            .map(|run| run.run_id.as_str())
            .collect::<Vec<_>>(),
        vec!["harness"],
    );
}

/// Save a gg configuration for `user_id` under `id`/`name` — what the backfill matches a
/// historical run's recorded configuration name against.
async fn save_gg_config(db: &Db, user_id: &str, id: &str, name: &str) {
    use test_cabinet_core::gg::GgCapabilitySet;

    db.insert_gg_config(
        user_id,
        &crate::api::GgConfig {
            id: id.to_string(),
            name: name.to_string(),
            description: String::new(),
            capability_set: GgCapabilitySet::minimal("mock/echo"),
            agent_sources: Vec::new(),
            updated_at: "2026-08-18T00:00:00Z".to_string(),
        },
    )
    .await
    .unwrap();
}

/// A finished gg job that `user_id` launched and that produced `run_id` — the only link a
/// `run` row has back to an account, and so the only way the backfill can tell whose
/// configuration a historical run came from.
async fn finished_gg_job(db: &Db, job_id: &str, user_id: Option<&str>, run_id: &str) {
    db.enqueue_job(NewJob {
        harness_slug: "gg".to_string(),
        model_id: "mock/echo".to_string(),
        user_id: user_id.map(str::to_string),
        ..new_job(job_id, "2026-06-23T00:00:00Z")
    })
    .await
    .unwrap();
    db.set_job_state(
        job_id,
        "succeeded",
        "2026-06-23T01:00:00Z",
        None,
        Some(run_id),
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn the_gg_configuration_backfill_resolves_a_run_through_the_job_that_produced_it() {
    let db = Db::connect_in_memory().await.unwrap();
    save_gg_config(&db, "u1", "cfg-a", "planning-A").await;
    // A run recorded before the id was part of a capability set: it names the
    // configuration and nothing else.
    db.push(
        &gg_record_binding("r1", Some("planning-A"), &["mock/echo"]),
        &links(),
        None,
        None,
    )
    .await
    .unwrap();
    assert_eq!(lifted(&db, "r1").await.gg_config_id, None);
    finished_gg_job(&db, "j1", Some("u1"), "r1").await;

    assert_eq!(db.backfill_gg_config_id().await.unwrap(), 1);
    assert_eq!(
        lifted(&db, "r1").await.gg_config_id.as_deref(),
        Some("cfg-a"),
        "the launching account is reached through the job, and the name resolved inside it",
    );
    // And the run now counts toward the same cell a fresh run of that configuration
    // lands in, which is the whole point of resolving it.
    let completed = db
        .count_completed_runs_by_cell(&["pong".to_string()])
        .await
        .unwrap();
    assert_eq!(
        completed.get(&gg_cell("cfg-a", "root=mock/echo")).copied(),
        Some(1),
    );

    // The record is filled too, not only the column lifted from it. The grouped counts read
    // the column and a cell's review queue reads the record, so a row whose two disagreed
    // would be counted into a cell that could never offer it for review — a buffer slot
    // spent on a run no reviewer is ever shown.
    let row = lifted(&db, "r1").await;
    let stored: RunRecord = serde_json::from_str(&row.record_json).unwrap();
    assert_eq!(
        stored
            .subject
            .gg_capability_set
            .as_ref()
            .and_then(|set| set.preset_id.as_deref()),
        Some("cfg-a"),
    );
    assert_eq!(crate::db::lifted_gg_config_id(&stored), row.gg_config_id);
    // And the name the run was launched under is left as it was recorded.
    assert_eq!(
        stored
            .subject
            .gg_capability_set
            .as_ref()
            .and_then(|set| set.preset.as_deref()),
        Some("planning-A"),
    );

    // Idempotent: the filled row is no longer a candidate.
    assert_eq!(db.backfill_gg_config_id().await.unwrap(), 0);
}

#[tokio::test]
async fn the_gg_configuration_backfill_runs_once_so_a_new_configuration_adopts_nothing() {
    let db = Db::connect_in_memory().await.unwrap();
    // Runs of a configuration that is gone by the time the column arrives. The account holds
    // nothing by that name, so the pass resolves none of them.
    db.push(
        &gg_record_binding("r1", Some("planning-A"), &["mock/echo"]),
        &links(),
        None,
        None,
    )
    .await
    .unwrap();
    finished_gg_job(&db, "j1", Some("u1"), "r1").await;
    assert_eq!(db.backfill_gg_config_id().await.unwrap(), 0);

    // The operator later saves a fresh configuration and gives it the name the old one had —
    // a rename frees a name, and the next configuration takes it. It ran none of those runs,
    // and no later boot hands them to it: the residue stays unattributed, which under-counts
    // one cell rather than crediting 40 runs to a configuration that never produced one.
    save_gg_config(&db, "u1", "cfg-new", "planning-A").await;
    assert_eq!(db.backfill_gg_config_id().await.unwrap(), 0);
    assert_eq!(lifted(&db, "r1").await.gg_config_id, None);
}

#[tokio::test]
async fn the_gg_configuration_backfill_leaves_an_unresolvable_run_null() {
    let db = Db::connect_in_memory().await.unwrap();
    save_gg_config(&db, "u1", "cfg-a", "planning-A").await;
    for id in ["no-job", "unattributed", "other-account"] {
        db.push(
            &gg_record_binding(id, Some("planning-A"), &["mock/echo"]),
            &links(),
            None,
            None,
        )
        .await
        .unwrap();
    }
    // One run whose job was never recorded, one whose job predates attribution, and one
    // launched by an account that has no configuration of that name. None of the three
    // can be tied to a configuration, and a plausible guess would merge two accounts'
    // histories for good.
    finished_gg_job(&db, "j-unattributed", None, "unattributed").await;
    finished_gg_job(&db, "j-other", Some("u2"), "other-account").await;

    assert_eq!(db.backfill_gg_config_id().await.unwrap(), 0);
    for id in ["no-job", "unattributed", "other-account"] {
        assert_eq!(
            lifted(&db, id).await.gg_config_id,
            None,
            "{id} is left unattributed rather than guessed at",
        );
    }
}

#[tokio::test]
async fn the_gg_configuration_backfill_leaves_an_ambiguous_name_null() {
    let db = Db::connect_in_memory().await.unwrap();
    // Nothing keeps a configuration's name unique within an account, so a name can stand
    // for two of them — and then it identifies neither.
    save_gg_config(&db, "u1", "cfg-a", "planning-A").await;
    save_gg_config(&db, "u1", "cfg-b", "planning-A").await;
    db.push(
        &gg_record_binding("r1", Some("planning-A"), &["mock/echo"]),
        &links(),
        None,
        None,
    )
    .await
    .unwrap();
    finished_gg_job(&db, "j1", Some("u1"), "r1").await;

    assert_eq!(db.backfill_gg_config_id().await.unwrap(), 0);
    assert_eq!(lifted(&db, "r1").await.gg_config_id, None);
}

#[tokio::test]
async fn the_in_flight_gg_configuration_backfill_reads_the_set_then_the_account() {
    use test_cabinet_core::gg::GgCapabilitySet;

    let db = Db::connect_in_memory().await.unwrap();
    save_gg_config(&db, "u1", "cfg-a", "planning-A").await;

    // One queued job whose capability set already names the configuration it came from,
    // and one that predates the field and carries only the name.
    let mut carried = GgCapabilitySet::minimal("mock/echo");
    carried.preset = Some("planning-A".to_string());
    carried.preset_id = Some("cfg-carried".to_string());
    let mut named = GgCapabilitySet::minimal("mock/echo");
    named.preset = Some("planning-A".to_string());
    for (job_id, set) in [("j-carried", carried), ("j-named", named)] {
        db.enqueue_job(NewJob {
            harness_slug: "gg".to_string(),
            model_id: "mock/echo".to_string(),
            gg_config_json: Some(serde_json::to_string(&set).unwrap()),
            gg_preset: set.preset.clone(),
            user_id: Some("u1".to_string()),
            ..new_job(job_id, "2026-06-23T00:00:00Z")
        })
        .await
        .unwrap();
    }

    assert_eq!(db.backfill_in_flight_gg_config_ids().await.unwrap(), 2);
    assert_eq!(
        db.get_job("j-carried")
            .await
            .unwrap()
            .unwrap()
            .gg_config_id
            .as_deref(),
        Some("cfg-carried"),
        "the set names its own configuration, so nothing is looked up",
    );
    assert_eq!(
        db.get_job("j-named")
            .await
            .unwrap()
            .unwrap()
            .gg_config_id
            .as_deref(),
        Some("cfg-a"),
        "and an older set is resolved against the launching account's configurations",
    );

    // A name-resolved job has the id written into its stored capability set as well, because
    // that set is what the driver hands the run: the column alone would count the job toward
    // a cell and then produce a run recording no configuration at all.
    let stored: test_cabinet_core::gg::GgCapabilitySet = serde_json::from_str(
        &db.get_job("j-named")
            .await
            .unwrap()
            .unwrap()
            .gg_config_json
            .expect("a gg job carries its capability set"),
    )
    .unwrap();
    assert_eq!(stored.preset_id.as_deref(), Some("cfg-a"));

    // Idempotent, and bounded to what is still in flight.
    assert_eq!(db.backfill_in_flight_gg_config_ids().await.unwrap(), 0);
}

#[tokio::test]
async fn the_in_flight_gg_configuration_backfill_runs_once() {
    use test_cabinet_core::gg::GgCapabilitySet;

    let db = Db::connect_in_memory().await.unwrap();
    let mut set = GgCapabilitySet::minimal("mock/echo");
    set.preset = Some("planning-A".to_string());
    db.enqueue_job(NewJob {
        harness_slug: "gg".to_string(),
        model_id: "mock/echo".to_string(),
        gg_config_json: Some(serde_json::to_string(&set).unwrap()),
        gg_preset: set.preset.clone(),
        user_id: Some("u1".to_string()),
        ..new_job("j1", "2026-06-23T00:00:00Z")
    })
    .await
    .unwrap();
    assert_eq!(db.backfill_in_flight_gg_config_ids().await.unwrap(), 0);

    // The same rule the run pass follows: a configuration saved after the pass has run takes
    // over none of the work in flight when it happens to share a name.
    save_gg_config(&db, "u1", "cfg-new", "planning-A").await;
    assert_eq!(db.backfill_in_flight_gg_config_ids().await.unwrap(), 0);
    assert_eq!(db.get_job("j1").await.unwrap().unwrap().gg_config_id, None);
}

/// A gg member: the configuration `config` with `slots` bound.
fn gg_combo(config: &str, slots: &[(&str, &str)]) -> crate::api::ReviewPlanCombo {
    crate::api::ReviewPlanCombo {
        harness: HarnessSlug::Gg,
        model: String::new(),
        provider: None,
        gg_config_id: Some(config.to_string()),
        gg_slot_models: slots
            .iter()
            .map(|(slot, model)| ((*slot).to_string(), (*model).to_string()))
            .collect(),
        gg_config_name: None,
    }
}

#[test]
fn a_gg_combination_key_carries_the_configuration_and_every_slot_it_binds() {
    assert_eq!(
        combination_key(&gg_combo(
            "saved:cfg1",
            &[("reviewer", "anthropic/opus"), ("root", "mock/echo")],
        )),
        "gg:cfg1|reviewer=anthropic/opus,root=mock/echo",
    );

    // Two climbers on one configuration differing only on a subagent's model are the
    // two arms a ladder exists to separate, so they are two keys.
    assert_ne!(
        combination_key(&gg_combo("saved:cfg1", &[("reviewer", "anthropic/opus")])),
        combination_key(&gg_combo("saved:cfg1", &[("reviewer", "mock/echo")])),
    );
    // As are two that bind the same two models to swapped slots.
    assert_ne!(
        combination_key(&gg_combo(
            "saved:cfg1",
            &[("reviewer", "anthropic/opus"), ("root", "mock/echo")],
        )),
        combination_key(&gg_combo(
            "saved:cfg1",
            &[("reviewer", "mock/echo"), ("root", "anthropic/opus")],
        )),
    );

    // The picker's `saved:<id>` value and the bare id name one configuration, so they
    // must key as one climber however the member was written.
    assert_eq!(
        combination_key(&gg_combo("saved:cfg1", &[("root", "mock/echo")])),
        combination_key(&gg_combo("cfg1", &[("root", "mock/echo")])),
    );
}

#[test]
fn a_gg_combination_key_cannot_collide_with_a_harness_one() {
    // The harness form's first segment is a harness slug, so no harness key can begin
    // `gg:` — not even the degenerate one whose harness *is* gg and whose model and
    // provider are empty, which is exactly the shape a gg member has in storage.
    let stored_gg_shape = crate::api::ReviewPlanCombo {
        harness: HarnessSlug::Gg,
        model: String::new(),
        ..sample_combo()
    };
    assert_eq!(combination_key(&stored_gg_shape), "gg||");
    assert_ne!(
        combination_key(&stored_gg_shape),
        combination_key(&gg_combo("saved:cfg1", &[])),
    );

    // A member whose configuration id is blank names no configuration at all, so it
    // keys as the harness member it is rather than as a nameless gg cell.
    assert_eq!(
        combination_key(&crate::api::ReviewPlanCombo {
            gg_config_id: Some("   ".to_string()),
            ..sample_combo()
        }),
        combination_key(&sample_combo()),
    );
}

#[test]
fn a_combination_key_separates_on_a_character_a_model_id_cannot_contain() {
    // Model ids routinely carry `/`, so the key separates on `|`; the provider
    // segment is present-but-empty when the harness is not provider-routed.
    assert_eq!(
        combination_key(&crate::api::ReviewPlanCombo {
            harness: HarnessSlug::Opencode,
            model: "anthropic/claude-opus-4.8".to_string(),
            provider: Some("openrouter".to_string()),
            ..sample_combo()
        }),
        "opencode|anthropic/claude-opus-4.8|openrouter",
    );
    assert_eq!(
        combination_key(&sample_combo()),
        "claude|claude-sonnet-4-5|",
    );
}

#[tokio::test]
async fn the_probe_provider_projection_joins_slug_and_reads_errored_as_missing_label() {
    // The `/stats/providers` probe fold reads four columns: the item's serving
    // provider, the owning probe's model slug (the join), the pass flag, and
    // "errored" as the absence of a classification label. Prove the projection
    // against a store with two probes of two models, mixed providers, and one
    // errored call.
    let db = Db::connect_in_memory().await.unwrap();
    let probe = |id: &str, slug: &str| test_cabinet_entities::model_probe::Model {
        id: id.to_string(),
        model_slug: slug.to_string(),
        openrouter_slug: format!("or/{slug}"),
        provider: None,
        user_id: "u1".to_string(),
        language: None,
        samples: 1,
        max_tokens: 100,
        request_json: "[]".to_string(),
        status: "complete".to_string(),
        error: None,
        verdict: None,
        pass_rate: None,
        spend: 0.0,
        created_at: "2026-08-23T00:00:00Z".to_string(),
        finished_at: None,
    };
    let item =
        |id: &str, probe_id: &str, provider: Option<&str>, pass: bool, label: Option<&str>| {
            test_cabinet_entities::model_probe_item::Model {
                id: id.to_string(),
                probe_id: probe_id.to_string(),
                language: "typescript".to_string(),
                scenario: "baseline".to_string(),
                prompt: "write-plan".to_string(),
                sample: 0,
                provider: provider.map(str::to_string),
                finish_reason: None,
                native_finish_reason: None,
                label: label.map(str::to_string),
                pass,
                program_text: None,
                response_text: String::new(),
                reasoning_text: None,
                prompt_tokens: None,
                completion_tokens: None,
                cost: None,
                duration_ms: 1,
                error: label.is_none().then(|| "gateway refused".to_string()),
                created_at: "2026-08-23T00:00:01Z".to_string(),
            }
        };
    db.insert_model_probe(probe("p1", "alpha")).await.unwrap();
    db.insert_model_probe(probe("p2", "beta")).await.unwrap();
    db.insert_model_probe_item(item("i1", "p1", Some("acme"), true, Some("correct-calls")))
        .await
        .unwrap();
    db.insert_model_probe_item(item("i2", "p1", Some("acme"), false, Some("missing-calls")))
        .await
        .unwrap();
    db.insert_model_probe_item(item(
        "i3",
        "p2",
        Some("zenith"),
        true,
        Some("correct-calls"),
    ))
    .await
    .unwrap();
    db.insert_model_probe_item(item("i4", "p2", None, false, None))
        .await
        .unwrap();

    let mut rows = db.probe_item_provider_rows().await.unwrap();
    rows.sort();
    assert_eq!(
        rows,
        vec![
            (None, "beta".to_string(), false, true),
            (Some("acme".to_string()), "alpha".to_string(), false, false),
            (Some("acme".to_string()), "alpha".to_string(), true, false),
            (Some("zenith".to_string()), "beta".to_string(), true, false),
        ],
    );
}

// --- The two rating channels ----------------------------------------------------
//
// A run of a case version on the engine manifest format is **validator-rated**: its
// functional rating starts as the validators' decision (each failing scored point
// capping its domains at its declared failure cap), written at push time, and each
// review may override individual verdicts — the run takes the worst across the
// reviews' effective ratings, recomputed on review-add. Its reviews also supply the
// run-wide aesthetic tier, and it publishes with zero reviews. A legacy run keeps
// behaving exactly as it always has.

/// A `pong@v1.0.0` manifest on the engine format whose base variant scores two
/// validated points: `serve` (gameplay-critical, cap `broken`, single-player only)
/// and `hud` (cosmetic, cap `great`, both domains). Two domains: `single-player`
/// (common) and `versus` (the base variant's own).
fn validator_manifest() -> crate::store::StoredManifest {
    use crate::store::{
        StoredDomain, StoredManifest, StoredReviewItem, StoredReviewValidation, StoredVariant,
    };
    use test_cabinet_core::review::FailureCap;
    let point = |id: &str, cap: FailureCap, domains: &[&str]| StoredReviewItem {
        id: id.to_string(),
        title: id.to_string(),
        text: format!("The build satisfies {id}."),
        reference: None,
        proof: None,
        sequences: vec![],
        frames: vec![],
        weight: 1,
        graded: false,
        domain: None,
        sub_items: vec![],
        validation: Some(StoredReviewValidation {
            script: format!("gameplay/{id}"),
            per_engine: true,
            engines: vec![],
            outputs: vec![],
        }),
        failure_cap: Some(cap),
        domains: domains.iter().map(|d| d.to_string()).collect(),
    };
    let domain = |id: &str| StoredDomain {
        id: id.to_string(),
        name: id.to_string(),
        description: format!("The {id} mode."),
    };
    StoredManifest {
        toolchain: None,
        engine_format: true,
        slug: "pong".to_string(),
        version: "v1.0.0".to_string(),
        name: "Carom".to_string(),
        difficulty: "easy".to_string(),
        tags: vec![],
        summary: None,
        description: None,
        changelog: "Introduced.".to_string(),
        max_runtime_seconds: 1800,
        test_type: test_cabinet_core::TestType::EndToEnd,
        engines: vec![test_cabinet_core::EngineSupport::unbounded("simple-2d")],
        experimental: false,
        build: None,
        canvas: None,
        tool: None,
        output: None,
        contract: None,
        sandbox: None,
        cases: Vec::new(),
        simulation: None,
        r#match: None,
        replay: None,
        asset_kind: test_cabinet_core::AssetKind::Sprite,
        asset_dimension: test_cabinet_core::AssetDimension::TwoD,
        sheet: None,
        voxel: None,
        model: None,
        ui: None,
        material: None,
        particle: None,
        audio: None,
        audio_packs: Vec::new(),
        prompt_template: "build it".to_string(),
        common_specs: vec![],
        workspace: Default::default(),
        init: None,
        assets: vec![],
        packages: vec![],
        variants: vec![StoredVariant {
            slug: "base".to_string(),
            name: "Base".to_string(),
            description: None,
            specs: vec![],
            workspace: None,
            references: vec![],
            proofs: vec![],
            review_items: vec![],
            domains: vec![domain("versus")],
            voxel: None,
            showcase: None,
        }],
        common_references: vec![],
        common_proofs: vec![],
        checks: vec![],
        common_review_items: vec![
            point("serve", FailureCap::Broken, &["single-player"]),
            point("hud", FailureCap::Great, &["single-player", "versus"]),
        ],
        domains: vec![domain("single-player")],
        instrumentation: None,
        errata: Vec::new(),
    }
}

/// [`record`] with one decided validator verdict per `(point, pass)` pair.
fn validator_record(id: &str, verdicts: &[(&str, bool)]) -> RunRecord {
    use test_cabinet_core::validation::{AutoVerdict, DebugScriptResult};
    let mut record = record(id);
    record.validation.debug_scripts = verdicts
        .iter()
        .map(|(point, pass)| DebugScriptResult {
            item_id: point.to_string(),
            sub_item_id: None,
            title: point.to_string(),
            category_title: point.to_string(),
            script: format!("gameplay/{point}"),
            gates: true,
            ran: true,
            precondition_unmet: false,
            inconclusive: None,
            detail: None,
            verdicts: vec![AutoVerdict {
                id: point.to_string(),
                pass: *pass,
                assertions: vec![],
            }],
            outputs: vec![],
        })
        .collect();
    record
}

/// A review from `account` carrying the run-wide aesthetic `rating` and nothing
/// else — the minimal shape a validator-rated run accepts.
fn aesthetic_review(
    account: &str,
    rating: test_cabinet_core::review::AestheticRating,
) -> StoredReview {
    override_review(account, rating, &[])
}

/// [`aesthetic_review`] plus the reviewer's verdict `overrides`, one binary
/// pass/fail per `(verdict id, pass)` pair.
fn override_review(
    account: &str,
    rating: test_cabinet_core::review::AestheticRating,
    overrides: &[(&str, bool)],
) -> StoredReview {
    use test_cabinet_core::review::VerdictStatus;
    StoredReview {
        reviewer: reviewer(account),
        ratings: vec![],
        aesthetics: vec![],
        aesthetic: Some(rating),
        writeup: "Looks lovely.".to_string(),
        checklist: overrides
            .iter()
            .map(|(id, pass)| ReviewVerdict {
                id: id.to_string(),
                status: if *pass {
                    VerdictStatus::Pass
                } else {
                    VerdictStatus::Fail
                },
                note: None,
            })
            .collect(),
        reviewed_at: "2026-06-17T22:00:00Z".to_string(),
        edited_at: None,
        revisions: Vec::new(),
    }
}

#[test]
fn functional_rating_takes_the_lowest_cap_among_failing_points() {
    let manifest = validator_manifest();
    // No failure: every domain is flawless.
    assert_eq!(
        functional_rating(Some(&manifest), &validator_record("r", &[]), &[]),
        Some(Rating::Flawless)
    );
    // The cosmetic point fails: both domains capped at great.
    assert_eq!(
        functional_rating(
            Some(&manifest),
            &validator_record("r", &[("serve", true), ("hud", false)]),
            &[]
        ),
        Some(Rating::Great)
    );
    // Both fail: single-player is capped at broken (the lowest cap wins), and the
    // run's rating is its worst domain.
    assert_eq!(
        functional_rating(
            Some(&manifest),
            &validator_record("r", &[("serve", false), ("hud", false)]),
            &[]
        ),
        Some(Rating::Broken)
    );
    // A review with no overrides is the fixed point: the validators' figure stands.
    assert_eq!(
        functional_rating(
            Some(&manifest),
            &validator_record("r", &[("serve", true), ("hud", false)]),
            &[aesthetic_review("u1", AestheticRating::Good)]
        ),
        Some(Rating::Great)
    );
    // An override moves it both ways: waving the failing cosmetic point through
    // raises the run to flawless; failing the gameplay-critical one lowers it to
    // broken. With several reviews the worst effective rating wins.
    assert_eq!(
        functional_rating(
            Some(&manifest),
            &validator_record("r", &[("serve", true), ("hud", false)]),
            &[override_review(
                "u1",
                AestheticRating::Good,
                &[("hud", true)]
            )]
        ),
        Some(Rating::Flawless)
    );
    assert_eq!(
        functional_rating(
            Some(&manifest),
            &validator_record("r", &[("serve", true), ("hud", true)]),
            &[
                override_review("u1", AestheticRating::Good, &[("serve", false)]),
                aesthetic_review("u2", AestheticRating::Good),
            ]
        ),
        Some(Rating::Broken)
    );
    // A legacy version (or no manifest at all) is the review aggregate.
    let mut legacy = validator_manifest();
    legacy.engine_format = false;
    assert_eq!(
        functional_rating(
            Some(&legacy),
            &record("r"),
            &[review_by("u1", Rating::Scuffed)]
        ),
        Some(Rating::Scuffed)
    );
    assert_eq!(functional_rating(None, &record("r"), &[]), None);
}

#[test]
fn a_run_that_did_not_complete_has_no_functional_rating() {
    use test_cabinet_core::RunState;
    let manifest = validator_manifest();
    // A catastrophic build never loaded, so no validator ran: the empty verdict
    // set must not read as a flawless run.
    let mut record = validator_record("r", &[]);
    record.status.state = RunState::Catastrophic;
    assert_eq!(functional_rating(Some(&manifest), &record, &[]), None);
    // Nor may a review's overrides rate it — there is no build the review saw.
    assert_eq!(
        functional_rating(
            Some(&manifest),
            &record,
            &[override_review(
                "u1",
                AestheticRating::Good,
                &[("hud", true)]
            )]
        ),
        None
    );
    // Every non-completed tier is unscored, whether validator-rated or legacy.
    for state in [
        RunState::TimedOut,
        RunState::HarnessError,
        RunState::LimitExceeded,
        RunState::Hung,
        RunState::Infrastructure,
        RunState::Canceled,
    ] {
        let mut record = validator_record("r", &[("serve", true), ("hud", true)]);
        record.status.state = state;
        assert_eq!(functional_rating(Some(&manifest), &record, &[]), None);
        let mut legacy_record = super::tests::record("r");
        legacy_record.status.state = state;
        assert_eq!(
            functional_rating(None, &legacy_record, &[review_by("u1", Rating::Flawless)]),
            None
        );
    }
    // The completed tier is the one that rates.
    assert_eq!(
        functional_rating(Some(&manifest), &validator_record("r", &[]), &[]),
        Some(Rating::Flawless)
    );
}

#[tokio::test]
async fn a_validator_rated_run_is_rated_at_push_from_its_validators() {
    let db = Db::connect_in_memory().await.unwrap();
    let manifest = validator_manifest();

    db.push(
        &validator_record("r1", &[("serve", true), ("hud", false)]),
        &links(),
        None,
        Some(&manifest),
    )
    .await
    .unwrap();

    let stored = db.get_run("r1").await.unwrap().unwrap();
    assert!(stored.validator_rated);
    assert_eq!(
        stored.rating,
        Some(Rating::Great),
        "written before any review"
    );
    assert_eq!(
        stored.aesthetic, None,
        "nobody has rated the aesthetic channel"
    );
    assert!(stored.reviews.is_empty());

    // The summary card reads the lifted rating without a catalog.
    let card = crate::snapshot::RunSummary::from_stored(&stored);
    assert_eq!(card.rating, Some(Rating::Great));
    assert!(card.validator_rated);
    assert_eq!(card.aesthetic, None);
}

#[tokio::test]
async fn a_re_push_recomputes_a_validator_rated_runs_rating_but_keeps_its_aesthetic() {
    use test_cabinet_core::review::AestheticRating;
    let db = Db::connect_in_memory().await.unwrap();
    let manifest = validator_manifest();

    db.push(
        &validator_record("r1", &[("serve", false)]),
        &links(),
        None,
        Some(&manifest),
    )
    .await
    .unwrap();
    assert_eq!(
        db.get_run("r1").await.unwrap().unwrap().rating,
        Some(Rating::Broken)
    );
    db.add_review(
        "r1",
        &aesthetic_review("u1", AestheticRating::Good),
        None,
        Some(&manifest),
    )
    .await
    .unwrap();

    // The validators now pass: the rating follows the record (the no-override
    // review is the fixed point), and the review-derived aesthetic and count are
    // preserved.
    db.push(
        &validator_record("r1", &[("serve", true)]),
        &links(),
        None,
        Some(&manifest),
    )
    .await
    .unwrap();
    let stored = db.get_run("r1").await.unwrap().unwrap();
    assert_eq!(stored.rating, Some(Rating::Flawless));
    assert_eq!(stored.aesthetic, Some(AestheticRating::Good));
    assert_eq!(stored.reviews.len(), 1);
    assert!(stored.validator_rated);
}

#[tokio::test]
async fn a_review_of_a_validator_rated_run_supplies_the_run_wide_aesthetic() {
    use test_cabinet_core::review::AestheticRating;
    let db = Db::connect_in_memory().await.unwrap();
    let manifest = validator_manifest();
    db.push(
        &validator_record("r1", &[("serve", true), ("hud", true)]),
        &links(),
        None,
        Some(&manifest),
    )
    .await
    .unwrap();

    db.add_review(
        "r1",
        &aesthetic_review("u1", AestheticRating::Amazing),
        None,
        Some(&manifest),
    )
    .await
    .unwrap();
    let stored = db.get_run("r1").await.unwrap().unwrap();
    assert_eq!(
        stored.rating,
        Some(Rating::Flawless),
        "a review with no overrides never moves it"
    );
    assert_eq!(stored.aesthetic, Some(AestheticRating::Amazing));
    assert_eq!(
        stored.reviews[0].aesthetic,
        Some(AestheticRating::Amazing),
        "round-trips"
    );
    assert!(stored.reviews[0].aesthetics.is_empty());
    assert!(stored.reviews[0].ratings.is_empty());

    // The run's aesthetic is the worst across its reviews, like the rating.
    db.add_review(
        "r1",
        &aesthetic_review("u2", AestheticRating::Okay),
        None,
        Some(&manifest),
    )
    .await
    .unwrap();
    let stored = db.get_run("r1").await.unwrap().unwrap();
    assert_eq!(stored.aesthetic, Some(AestheticRating::Okay));
    assert_eq!(stored.reviews.len(), 2);
    assert_eq!(stored.rating, Some(Rating::Flawless));

    // The account's recent-review subjects carry the aesthetic channel for the
    // Profile-tab breakdown.
    let (subjects, total) = db.recent_review_subjects("u2", 10).await.unwrap();
    assert_eq!(total, 1);
    assert!(subjects[0].ratings.is_empty());
    assert_eq!(subjects[0].aesthetic, Some(AestheticRating::Okay));
}

#[tokio::test]
async fn a_pre_migration_per_domain_review_row_collapses_to_its_worst_tier() {
    use test_cabinet_core::review::{AestheticRating, DomainAesthetic};
    let db = Db::connect_in_memory().await.unwrap();
    let manifest = validator_manifest();
    db.push(
        &validator_record("r1", &[]),
        &links(),
        None,
        Some(&manifest),
    )
    .await
    .unwrap();

    // A row shaped like a pre-migration review: per-domain tiers in the legacy
    // `aesthetics` JSON, nothing in the run-wide column.
    let legacy_row = StoredReview {
        aesthetic: None,
        aesthetics: vec![
            DomainAesthetic {
                domain: "single-player".to_string(),
                rating: AestheticRating::Amazing,
            },
            DomainAesthetic {
                domain: "versus".to_string(),
                rating: AestheticRating::Okay,
            },
        ],
        ratings: vec![],
        checklist: vec![],
        ..review_by("u1", Rating::Great)
    };
    db.add_review("r1", &legacy_row, None, Some(&manifest))
        .await
        .unwrap();

    // Every read sees the worst tier as the row's one run-wide aesthetic — the
    // same figure the old per-domain aggregation produced.
    let stored = db.get_run("r1").await.unwrap().unwrap();
    assert_eq!(stored.reviews[0].aesthetic, Some(AestheticRating::Okay));
    assert_eq!(stored.aesthetic, Some(AestheticRating::Okay));
    let (subjects, _) = db.recent_review_subjects("u1", 10).await.unwrap();
    assert_eq!(subjects[0].aesthetic, Some(AestheticRating::Okay));
}

#[tokio::test]
async fn a_reviewer_override_recomputes_the_lifted_rating() {
    use test_cabinet_core::review::AestheticRating;
    let db = Db::connect_in_memory().await.unwrap();
    let manifest = validator_manifest();
    // The cosmetic point fails: the validators' own rating caps at great.
    db.push(
        &validator_record("r1", &[("serve", true), ("hud", false)]),
        &links(),
        None,
        Some(&manifest),
    )
    .await
    .unwrap();
    assert_eq!(
        db.get_run("r1").await.unwrap().unwrap().rating,
        Some(Rating::Great),
        "the no-review fixed point: the validators' own figure"
    );

    // A reviewer waves the failing point through: the run's rating rises.
    db.add_review(
        "r1",
        &override_review("u1", AestheticRating::Good, &[("hud", true)]),
        None,
        Some(&manifest),
    )
    .await
    .unwrap();
    let stored = db.get_run("r1").await.unwrap().unwrap();
    assert_eq!(stored.rating, Some(Rating::Flawless));
    assert_eq!(
        stored.reviews[0].checklist.len(),
        1,
        "the override persists"
    );

    // A second reviewer fails the gameplay-critical point: the run takes the
    // worst across the reviews' effective ratings.
    db.add_review(
        "r1",
        &override_review("u2", AestheticRating::Good, &[("serve", false)]),
        None,
        Some(&manifest),
    )
    .await
    .unwrap();
    let stored = db.get_run("r1").await.unwrap().unwrap();
    assert_eq!(stored.rating, Some(Rating::Broken));

    // The summary card reads the recomputed lifted rating without a catalog.
    let card = crate::snapshot::RunSummary::from_stored(&stored);
    assert_eq!(card.rating, Some(Rating::Broken));
}

#[tokio::test]
async fn editing_a_reviews_aesthetics_records_the_change_in_its_revision() {
    use test_cabinet_core::review::AestheticRating;
    let db = Db::connect_in_memory().await.unwrap();
    let manifest = validator_manifest();
    db.push(
        &validator_record("r1", &[]),
        &links(),
        None,
        Some(&manifest),
    )
    .await
    .unwrap();
    db.add_review(
        "r1",
        &aesthetic_review("u1", AestheticRating::Okay),
        None,
        Some(&manifest),
    )
    .await
    .unwrap();

    // An edit that only changes the aesthetic channel is still an edit: it needs a
    // note and records the single domainless change.
    let mut edited = aesthetic_review("u1", AestheticRating::Good);
    edited.reviewed_at = "2026-06-18T09:00:00Z".to_string();
    let err = db
        .add_review("r1", &edited, None, Some(&manifest))
        .await
        .unwrap_err();
    assert!(matches!(err, crate::error::BackendError::Unprocessable(_)));
    db.add_review(
        "r1",
        &edited,
        Some("Second look: the palette grew on me."),
        Some(&manifest),
    )
    .await
    .unwrap();

    let stored = db.get_run("r1").await.unwrap().unwrap();
    assert_eq!(stored.aesthetic, Some(AestheticRating::Good));
    let review = &stored.reviews[0];
    assert_eq!(review.edited_at.as_deref(), Some("2026-06-18T09:00:00Z"));
    assert_eq!(review.revisions.len(), 1);
    let diff = &review.revisions[0].diff;
    assert!(diff.ratings.is_empty());
    assert_eq!(diff.aesthetics.len(), 1);
    assert_eq!(diff.aesthetics[0].domain, None);
    assert_eq!(diff.aesthetics[0].from, Some(AestheticRating::Okay));
    assert_eq!(diff.aesthetics[0].to, Some(AestheticRating::Good));
}

#[tokio::test]
async fn a_validator_rated_completed_run_publishes_with_zero_reviews() {
    let db = Db::connect_in_memory().await.unwrap();
    let manifest = validator_manifest();
    db.push(
        &validator_record("v1", &[("serve", false)]),
        &links(),
        None,
        Some(&manifest),
    )
    .await
    .unwrap();
    // A legacy completed run beside it keeps the ≥1-review gate.
    db.push(&record("l1"), &links(), None, None).await.unwrap();

    db.ensure_publishable("v1").await.unwrap();
    let outcome = db.publish("v1", "2026-06-17T21:40:00Z").await.unwrap();
    assert!(outcome.newly_published);
    let stored = db.get_run("v1").await.unwrap().unwrap();
    assert!(stored.published);
    assert_eq!(
        stored.rating,
        Some(Rating::Broken),
        "published on its own rating"
    );

    let err = db.ensure_publishable("l1").await.unwrap_err();
    assert!(matches!(err, crate::error::BackendError::Unprocessable(_)));
    let err = db.publish("l1", "2026-06-17T21:40:00Z").await.unwrap_err();
    assert!(matches!(err, crate::error::BackendError::Unprocessable(_)));
}

#[tokio::test]
async fn a_legacy_run_never_carries_an_aesthetic_and_is_rated_by_its_reviews() {
    let db = Db::connect_in_memory().await.unwrap();
    // The store may hold the run's case (on the legacy format) or not at all; both
    // are legacy runs.
    let mut legacy = validator_manifest();
    legacy.engine_format = false;
    db.push(&record("r1"), &links(), None, Some(&legacy))
        .await
        .unwrap();
    db.push(&record("r2"), &links(), None, None).await.unwrap();

    for id in ["r1", "r2"] {
        let stored = db.get_run(id).await.unwrap().unwrap();
        assert!(!stored.validator_rated);
        assert_eq!(stored.rating, None, "unreviewed");
        db.add_review(id, &review_by("u1", Rating::Passable), None, None)
            .await
            .unwrap();
        let stored = db.get_run(id).await.unwrap().unwrap();
        assert_eq!(stored.rating, Some(Rating::Passable));
        assert_eq!(stored.aesthetic, None);
        assert!(stored.reviews[0].aesthetics.is_empty());
        let card = crate::snapshot::RunSummary::from_stored(&stored);
        assert_eq!(card.rating, Some(Rating::Passable));
        assert!(!card.validator_rated);
        assert_eq!(card.aesthetic, None);
    }
}

#[tokio::test]
async fn a_validator_rated_run_stays_in_the_unreviewed_worklist_until_reviewed() {
    // Decision: a validator-rated run with no review can still receive an aesthetic
    // review, so it belongs in the reviewer worklist exactly like a legacy run.
    use test_cabinet_core::review::AestheticRating;
    let db = Db::connect_in_memory().await.unwrap();
    let manifest = validator_manifest();
    db.push(
        &validator_record("r1", &[]),
        &links(),
        None,
        Some(&manifest),
    )
    .await
    .unwrap();
    assert_eq!(db.list_for_review(50, None).await.unwrap().0.len(), 1);
    db.add_review(
        "r1",
        &aesthetic_review("u1", AestheticRating::Good),
        None,
        None,
    )
    .await
    .unwrap();
    let stored = db.get_run("r1").await.unwrap().unwrap();
    assert_eq!(stored.reviews.len(), 1);
}

/// The three ways a comparison arm's recorded id still names something that exists.
/// A comparison tops an arm up to `n` by counting these off, so each one it misses is
/// a run relaunched for nothing.
#[tokio::test]
async fn live_run_ids_counts_stored_runs_jobs_in_flight_and_jobs_whose_run_landed() {
    let db = Db::connect_in_memory().await.unwrap();

    // A run recorded under the id the arm holds.
    db.push(&record("r1"), &links(), None, None).await.unwrap();

    // A job still in the queue: no record yet, and relaunching it would double the
    // arm.
    db.enqueue_job(new_job("queued", "2026-06-23T00:00:00Z"))
        .await
        .unwrap();

    // A job that has finished. The arm recorded the id the launch handed back — the
    // job id — while the run the driver produced carries an id of its own minting,
    // so only `job.record_id` ties the two together.
    db.enqueue_job(new_job("finished", "2026-06-23T00:01:00Z"))
        .await
        .unwrap();
    db.push(&record("produced"), &links(), None, None)
        .await
        .unwrap();
    db.set_job_state(
        "finished",
        "succeeded",
        "2026-06-23T00:30:00Z",
        None,
        Some("produced"),
    )
    .await
    .unwrap();

    let live = db
        .live_run_ids(&[
            "r1".to_string(),
            "queued".to_string(),
            "finished".to_string(),
            "never-existed".to_string(),
        ])
        .await
        .unwrap();

    assert_eq!(
        live,
        BTreeSet::from([
            "r1".to_string(),
            "queued".to_string(),
            "finished".to_string(),
        ])
    );
}

/// Every in-flight state counts, including the two the queue has not dispatched yet.
#[tokio::test]
async fn live_run_ids_counts_a_job_in_every_in_flight_state() {
    let db = Db::connect_in_memory().await.unwrap();
    for (i, state) in IN_FLIGHT_STATES.iter().enumerate() {
        db.enqueue_job(new_job(state, &format!("2026-06-23T00:0{i}:00Z")))
            .await
            .unwrap();
        db.set_job_state(state, state, "2026-06-23T00:10:00Z", None, None)
            .await
            .unwrap();
    }
    let ids: Vec<String> = IN_FLIGHT_STATES.iter().map(|s| s.to_string()).collect();
    let live = db.live_run_ids(&ids).await.unwrap();
    assert_eq!(live, ids.into_iter().collect::<BTreeSet<_>>());
}

/// The defect this exists for: an operator launched an arm's runs, deleted them, and
/// came back. Both the run id and the job id the arm might hold are dead, so the arm
/// can be topped back up.
#[tokio::test]
async fn live_run_ids_drops_an_id_whose_run_was_deleted() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record("r1"), &links(), None, None).await.unwrap();
    db.enqueue_job(new_job("j1", "2026-06-23T00:00:00Z"))
        .await
        .unwrap();
    db.set_job_state("j1", "succeeded", "2026-06-23T00:30:00Z", None, Some("r1"))
        .await
        .unwrap();

    db.delete_run("r1").await.unwrap();

    let live = db
        .live_run_ids(&["r1".to_string(), "j1".to_string()])
        .await
        .unwrap();
    assert!(live.is_empty(), "{live:?}");
}

/// A job that ended without producing a record is dead too — nothing was recorded and
/// nothing is still running, so the run it stood for has to be launched again.
#[tokio::test]
async fn live_run_ids_drops_a_terminal_job_that_produced_no_record() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_job(new_job("failed", "2026-06-23T00:00:00Z"))
        .await
        .unwrap();
    db.set_job_state(
        "failed",
        "failed",
        "2026-06-23T00:05:00Z",
        Some("could not pull the run image"),
        None,
    )
    .await
    .unwrap();
    db.enqueue_job(new_job("canceled", "2026-06-23T00:01:00Z"))
        .await
        .unwrap();
    db.set_job_state("canceled", "canceled", "2026-06-23T00:06:00Z", None, None)
        .await
        .unwrap();

    let live = db
        .live_run_ids(&["failed".to_string(), "canceled".to_string()])
        .await
        .unwrap();
    assert!(live.is_empty(), "{live:?}");
}

#[tokio::test]
async fn live_run_ids_of_nothing_is_empty() {
    let db = Db::connect_in_memory().await.unwrap();
    assert!(db.live_run_ids(&[]).await.unwrap().is_empty());
}
