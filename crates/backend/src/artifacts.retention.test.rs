//! The retention rules of the artifact reclamation sweep: which trees of runs that
//! still exist a pass deletes, and every guard that keeps one.
//!
//! The rule itself ([`retention_reason`]) is tested as the pure function it is.
//! The passes run against an in-memory database and a stand-in artifact service,
//! with a fixed `now`, so nothing here waits on a clock.

use std::sync::{Arc, Mutex};

use axum::Json;
use axum::Router;
use axum::extract::Path as AxumPath;
use axum::http::StatusCode;
use axum::routing::get;
use test_cabinet_core::run_record::RunState;
use time::macros::datetime;

use super::*;
use crate::db::Db;
use crate::db::retention_tests::{
    BUCKET, force_published, run_row, seed_job, seed_publish_job, seed_run, set_finished_at,
    set_media_confirmed,
};

const TOKEN: &str = "service-secret";

/// The instant every test decides at.
const NOW: OffsetDateTime = datetime!(2026-07-01 12:00 UTC);
const NOW_TEXT: &str = "2026-07-01T12:00:00Z";

/// The default policy: a failed run's tree for a day, a canceled run's for an
/// hour, and published trees reclaimed.
const POLICY: RetentionPolicy = RetentionPolicy {
    failed: Duration::from_secs(24 * 3600),
    canceled: Duration::from_secs(3600),
    published: true,
    bucket: Some(BUCKET),
};

/// When the trees of these tests were stored: long before any retention.
const STORED: OffsetDateTime = datetime!(2026-06-01 12:00 UTC);

const RULES: SweepRules = SweepRules {
    grace: Duration::from_secs(24 * 3600),
    retention: POLICY,
};

/// `NOW` less `minutes`, as the RFC 3339 text a run row holds.
fn ago(minutes: i64) -> String {
    (NOW - time::Duration::minutes(minutes))
        .format(&Rfc3339)
        .unwrap()
}

/// The facts of an unpublished run that ended in `state`, `minutes` before `NOW`.
fn run(state: &str, minutes: i64) -> RetentionRun {
    RetentionRun {
        id: "r1".to_string(),
        run_state: state.to_string(),
        finished_at: ago(minutes),
        published: false,
        media_confirmed_at: None,
        artifacts_stored: Some(true),
        artifacts_reclaimed_at: None,
        artifacts_reclaimed_reason: None,
    }
}

/// The facts of a published run that completed long ago, with `confirmed_at` as
/// its confirmation.
fn published(confirmed_at: Option<&str>) -> RetentionRun {
    RetentionRun {
        published: true,
        media_confirmed_at: confirmed_at.map(str::to_string),
        ..run("completed", 100_000)
    }
}

fn decide(run: &RetentionRun) -> Option<ReclaimReason> {
    retention_reason(run, false, STORED, NOW, &POLICY)
}

const FAILED_STATES: [&str; 6] = [
    "catastrophic",
    "timed_out",
    "harness_error",
    "limit_exceeded",
    "hung",
    "infrastructure",
];

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

#[test]
fn the_states_these_tests_name_are_the_contracts() {
    // The rule matches `RunState` exhaustively, so a state added to the contract
    // does not compile until it is placed. This pins the spellings used here to
    // the contract's, so no test below passes by naming a state that is unknown.
    for state in FAILED_STATES.into_iter().chain(["completed", "canceled"]) {
        let parsed: RunState = serde_json::from_value(serde_json::Value::String(state.to_string()))
            .unwrap_or_else(|_| panic!("{state} is not a run state"));
        assert_eq!(serde_json::to_value(parsed).unwrap(), state);
    }
}

#[test]
fn a_failed_run_is_reclaimed_a_day_after_it_ended() {
    for state in FAILED_STATES {
        assert_eq!(decide(&run(state, 24 * 60 - 1)), None, "{state}: inside");
        assert_eq!(
            decide(&run(state, 24 * 60)),
            None,
            "{state}: at the boundary"
        );
        assert_eq!(
            decide(&run(state, 24 * 60 + 1)),
            Some(ReclaimReason::Failed),
            "{state}: past"
        );
    }
}

#[test]
fn a_canceled_run_is_reclaimed_an_hour_after_it_ended() {
    assert_eq!(decide(&run("canceled", 59)), None);
    assert_eq!(decide(&run("canceled", 60)), None);
    assert_eq!(decide(&run("canceled", 61)), Some(ReclaimReason::Canceled));
}

#[test]
fn a_completed_run_that_is_not_published_is_never_reclaimed() {
    // Whatever its age: its tree is the only copy of what a release publishes.
    assert_eq!(decide(&run("completed", 10)), None);
    assert_eq!(decide(&run("completed", 10_000_000)), None);
    // A confirmation on an unpublished run is no reason either.
    let confirmed = RetentionRun {
        media_confirmed_at: Some(ago(60)),
        ..run("completed", 10_000_000)
    };
    assert_eq!(decide(&confirmed), None);
}

#[test]
fn a_published_run_is_reclaimed_once_its_media_is_confirmed() {
    assert_eq!(decide(&published(None)), None, "no confirmation");
    assert_eq!(
        decide(&published(Some(&ago(1)))),
        Some(ReclaimReason::Published)
    );
    // The confirmation is the whole rule: it needs no age.
    assert_eq!(
        decide(&published(Some(NOW_TEXT))),
        Some(ReclaimReason::Published)
    );
}

#[test]
fn a_published_run_is_governed_by_its_confirmation_whatever_state_it_ended_in() {
    // A published failure ended long past the failed retention. Its tree is still
    // the refresh's fallback source until its media is confirmed.
    for state in FAILED_STATES {
        let unconfirmed = RetentionRun {
            published: true,
            ..run(state, 100_000)
        };
        assert_eq!(decide(&unconfirmed), None, "{state}");
        let confirmed = RetentionRun {
            media_confirmed_at: Some(ago(5)),
            ..unconfirmed
        };
        assert_eq!(
            decide(&confirmed),
            Some(ReclaimReason::Published),
            "{state}"
        );
    }
}

#[test]
fn the_published_switch_keeps_every_published_tree() {
    let off = RetentionPolicy {
        published: false,
        ..POLICY
    };
    assert_eq!(
        retention_reason(&published(Some(&ago(60))), false, STORED, NOW, &off),
        None
    );
    // The switch is the published rule's alone.
    assert_eq!(
        retention_reason(&run("hung", 100_000), false, STORED, NOW, &off),
        Some(ReclaimReason::Failed)
    );
}

#[test]
fn a_zero_retention_keeps_every_tree_of_its_kind() {
    let never = RetentionPolicy {
        failed: Duration::ZERO,
        canceled: Duration::ZERO,
        published: true,
        bucket: Some(BUCKET),
    };
    for state in FAILED_STATES {
        assert_eq!(
            retention_reason(&run(state, 10_000_000), false, STORED, NOW, &never),
            None
        );
    }
    assert_eq!(
        retention_reason(&run("canceled", 10_000_000), false, STORED, NOW, &never),
        None
    );
    // Each setting is its own.
    let failed_only = RetentionPolicy {
        canceled: Duration::ZERO,
        ..POLICY
    };
    assert_eq!(
        retention_reason(
            &run("canceled", 10_000_000),
            false,
            STORED,
            NOW,
            &failed_only
        ),
        None
    );
    assert_eq!(
        retention_reason(&run("hung", 10_000_000), false, STORED, NOW, &failed_only),
        Some(ReclaimReason::Failed)
    );
    assert_eq!(
        retention_reason(
            &run("hung", 10_000_000),
            false,
            STORED,
            NOW,
            &RetentionPolicy::KEEP_EVERYTHING
        ),
        None
    );
}

#[test]
fn a_canceled_retention_never_falls_inside_the_drivers_upload_window() {
    // A driver may still be uploading for ten minutes after a cancel. A setting
    // shorter than the floor behaves as the floor.
    let short = RetentionPolicy {
        canceled: Duration::from_secs(60),
        ..POLICY
    };
    assert!(CANCELED_RETENTION_FLOOR > Duration::from_secs(10 * 60));
    assert_eq!(
        retention_reason(&run("canceled", 5), false, STORED, NOW, &short),
        None
    );
    assert_eq!(
        retention_reason(&run("canceled", 15), false, STORED, NOW, &short),
        None
    );
    assert_eq!(
        retention_reason(&run("canceled", 16), false, STORED, NOW, &short),
        Some(ReclaimReason::Canceled)
    );
}

#[test]
fn an_end_time_that_cannot_be_measured_from_never_qualifies() {
    for state in ["hung", "canceled"] {
        for finished_at in ["", "not a time", "2026-06-01 00:00:00", "1751371200"] {
            let unreadable = RetentionRun {
                finished_at: finished_at.to_string(),
                ..run(state, 0)
            };
            assert_eq!(decide(&unreadable), None, "{state}: {finished_at:?}");
        }
        // The future: a clock that moved, or a record that lies.
        assert_eq!(decide(&run(state, -1)), None, "{state}: a minute ahead");
        assert_eq!(decide(&run(state, -100_000)), None, "{state}: far ahead");
    }
}

#[test]
fn a_confirmation_that_cannot_be_read_never_qualifies() {
    for confirmed_at in ["", "soon", "2026-06-01 00:00:00"] {
        assert_eq!(
            decide(&published(Some(confirmed_at))),
            None,
            "{confirmed_at:?}"
        );
    }
    assert_eq!(decide(&published(Some(&ago(-1)))), None, "the future");
}

#[test]
fn a_state_this_build_cannot_name_keeps_its_tree() {
    for state in ["", "archived", "COMPLETED", "Canceled"] {
        assert_eq!(decide(&run(state, 10_000_000)), None, "{state:?}");
    }
}

#[test]
fn a_busy_run_keeps_its_tree_whatever_else_holds() {
    for candidate in [
        run("hung", 100_000),
        run("canceled", 100_000),
        published(Some(&ago(60))),
    ] {
        assert!(decide(&candidate).is_some());
        assert_eq!(
            retention_reason(&candidate, true, STORED, NOW, &POLICY),
            None
        );
    }
}

#[test]
fn a_run_reclaimed_before_qualifies_again() {
    // A tree that landed after the reclaim has to be deletable, so the rule reads
    // the run's state and not whether it was reclaimed.
    let reclaimed = RetentionRun {
        artifacts_stored: Some(false),
        artifacts_reclaimed_at: Some(ago(30)),
        artifacts_reclaimed_reason: Some("canceled".to_string()),
        ..run("canceled", 120)
    };
    assert_eq!(decide(&reclaimed), Some(ReclaimReason::Canceled));
}

#[test]
fn an_unrepresentable_retention_keeps_the_tree() {
    let huge = RetentionPolicy {
        failed: Duration::MAX,
        canceled: Duration::MAX,
        published: true,
        bucket: Some(BUCKET),
    };
    assert_eq!(
        retention_reason(&run("hung", 100_000), false, STORED, NOW, &huge),
        None
    );
    assert_eq!(
        retention_reason(&run("canceled", 100_000), false, STORED, NOW, &huge),
        None
    );
}

// ---------------------------------------------------------------------------
// The selection
// ---------------------------------------------------------------------------

fn tree(id: &str) -> StoredTree {
    StoredTree {
        id: id.to_string(),
        modified_at: STORED,
    }
}

fn named(id: &str, run: RetentionRun) -> RetentionRun {
    RetentionRun {
        id: id.to_string(),
        ..run
    }
}

#[test]
fn only_a_listed_tree_of_a_qualifying_run_is_selected() {
    let runs = vec![
        named("failed", run("hung", 100_000)),
        named("failed-no-tree", run("hung", 100_000)),
        named("canceled", run("canceled", 100_000)),
        named("public", published(Some(&ago(60)))),
        named("unconfirmed", published(None)),
        named("pending", run("completed", 100_000)),
        named("busy", run("hung", 100_000)),
    ];
    let trees: Vec<StoredTree> = [
        "failed",
        "canceled",
        "public",
        "unconfirmed",
        "pending",
        "busy",
        "orphan",
    ]
    .into_iter()
    .map(tree)
    .collect();
    let busy = HashSet::from(["busy".to_string()]);

    let selection = retention_trees(&trees, &runs, &busy, NOW, &POLICY);

    assert_eq!(
        selection.reclaim,
        vec![
            ("failed".to_string(), ReclaimReason::Failed),
            ("canceled".to_string(), ReclaimReason::Canceled),
            ("public".to_string(), ReclaimReason::Published),
        ]
    );
    assert_eq!(selection.unconfirmed, 1);
}

#[test]
fn unconfirmed_runs_are_not_counted_while_the_published_rule_is_off() {
    let runs = vec![named("unconfirmed", published(None))];
    let off = RetentionPolicy {
        published: false,
        ..POLICY
    };
    let selection = retention_trees(&[tree("unconfirmed")], &runs, &HashSet::new(), NOW, &off);
    assert_eq!(selection, RetentionSelection::default());
}

// ---------------------------------------------------------------------------
// A pass
// ---------------------------------------------------------------------------

/// A stand-in artifact service holding one tree per id, each a fixed size.
struct Service {
    /// The run ids a tree is stored for.
    trees: Mutex<HashSet<String>>,
    /// The run ids a delete was made for, in order.
    deletes: Mutex<Vec<String>>,
    /// The status a delete answers with. Only a success removes the tree.
    delete_status: Mutex<StatusCode>,
    /// Whether the listing answers. Off, it answers `500`.
    listing_works: Mutex<bool>,
    /// When set, a delete gets no answer: the connection is dropped, after the
    /// tree was removed (`true`) or with the tree left in place (`false`).
    unanswered_deletes: Mutex<Option<bool>>,
    /// When each tree was stored, for the trees not stored long ago.
    stored_at: Mutex<HashMap<String, String>>,
}

/// What each stored tree takes of the stand-in's volume.
const TREE_BYTES: u64 = 1_000;
const VOLUME_BYTES: u64 = 1_000_000;

impl Service {
    fn deleted(&self) -> Vec<String> {
        self.deletes.lock().unwrap().clone()
    }

    fn holds(&self, id: &str) -> bool {
        self.trees.lock().unwrap().contains(id)
    }
}

async fn spawn_service(trees: &[&str]) -> (String, Arc<Service>) {
    let service = Arc::new(Service {
        trees: Mutex::new(trees.iter().map(|id| id.to_string()).collect()),
        deletes: Mutex::new(Vec::new()),
        delete_status: Mutex::new(StatusCode::NO_CONTENT),
        listing_works: Mutex::new(true),
        unanswered_deletes: Mutex::new(None),
        stored_at: Mutex::new(HashMap::new()),
    });
    let app = Router::new()
        .route(
            "/runs",
            get({
                let service = Arc::clone(&service);
                move || {
                    let service = Arc::clone(&service);
                    async move {
                        if !*service.listing_works.lock().unwrap() {
                            return (
                                StatusCode::INTERNAL_SERVER_ERROR,
                                Json(serde_json::Value::Null),
                            );
                        }
                        let mut ids: Vec<String> =
                            service.trees.lock().unwrap().iter().cloned().collect();
                        ids.sort();
                        let stored_at = service.stored_at.lock().unwrap();
                        let runs: Vec<serde_json::Value> = ids
                            .into_iter()
                            .map(|id| {
                                let modified_at = stored_at
                                    .get(&id)
                                    .cloned()
                                    .unwrap_or_else(|| "2026-01-01T00:00:00Z".to_string());
                                serde_json::json!({ "id": id, "modifiedAt": modified_at })
                            })
                            .collect();
                        (StatusCode::OK, Json(serde_json::json!({ "runs": runs })))
                    }
                }
            }),
        )
        .route(
            "/runs/{id}/artifacts",
            axum::routing::delete({
                let service = Arc::clone(&service);
                move |AxumPath(id): AxumPath<String>| {
                    let service = Arc::clone(&service);
                    async move {
                        let unanswered = *service.unanswered_deletes.lock().unwrap();
                        if let Some(deletes) = unanswered {
                            if deletes {
                                service.trees.lock().unwrap().remove(&id);
                            }
                            service.deletes.lock().unwrap().push(id);
                            // Ends this connection's task without an answer and
                            // without a panic message: the client sees the
                            // connection close under its request.
                            std::panic::resume_unwind(Box::new(()));
                        }
                        let status = *service.delete_status.lock().unwrap();
                        if status.is_success() {
                            service.trees.lock().unwrap().remove(&id);
                        }
                        service.deletes.lock().unwrap().push(id);
                        status
                    }
                }
            }),
        )
        .route(
            "/capacity",
            get({
                let service = Arc::clone(&service);
                move || {
                    let service = Arc::clone(&service);
                    async move {
                        let used = service.trees.lock().unwrap().len() as u64 * TREE_BYTES;
                        Json(serde_json::json!({
                            "freeBytes": VOLUME_BYTES - used,
                            "totalBytes": VOLUME_BYTES,
                            "writable": true,
                        }))
                    }
                }
            }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (format!("http://{addr}"), service)
}

/// A database holding one run of each kind the rules tell apart, every one with a
/// tree recorded as stored:
///
/// - `failed`: hung two days ago.
/// - `fresh-failure`: hung an hour ago.
/// - `canceled`: canceled two hours ago.
/// - `fresh-cancel`: canceled half an hour ago.
/// - `pending`: completed long ago and never published.
/// - `public`: published, its media confirmed.
/// - `unconfirmed`: published, with no confirmation.
const EVERY_KIND: [&str; 7] = [
    "failed",
    "fresh-failure",
    "canceled",
    "fresh-cancel",
    "pending",
    "public",
    "unconfirmed",
];

async fn db_of_every_kind() -> Db {
    let db = Db::connect_in_memory().await.unwrap();
    seed_run(&db, "failed", RunState::Hung, &ago(48 * 60)).await;
    seed_run(&db, "fresh-failure", RunState::Hung, &ago(60)).await;
    seed_run(&db, "canceled", RunState::Canceled, &ago(120)).await;
    seed_run(&db, "fresh-cancel", RunState::Canceled, &ago(30)).await;
    seed_run(&db, "pending", RunState::Completed, &ago(1_000_000)).await;
    seed_run(&db, "public", RunState::Completed, &ago(1_000_000)).await;
    force_published(&db, "public").await;
    set_media_confirmed(&db, "public", Some(&ago(5))).await;
    seed_run(&db, "unconfirmed", RunState::Completed, &ago(1_000_000)).await;
    force_published(&db, "unconfirmed").await;
    for id in EVERY_KIND {
        db.set_run_artifacts_stored(id, true).await.unwrap();
    }
    db
}

async fn pass(db: &Db, base: &str, rules: &SweepRules) -> ScheduledPass {
    scheduled_pass(db, &reqwest::Client::new(), base, TOKEN, NOW, rules).await
}

fn complete(pass: ScheduledPass) -> (SweepOutcome, crate::db::ArtifactReconciliation) {
    match pass {
        ScheduledPass::Complete(outcome, reconciled) => (outcome, reconciled),
        other => panic!("expected a complete pass, got {other:?}"),
    }
}

#[tokio::test]
async fn a_pass_deletes_exactly_the_trees_the_rules_name() {
    let db = db_of_every_kind().await;
    let (base, service) = spawn_service(&EVERY_KIND).await;

    let (outcome, reconciled) = complete(pass(&db, &base, &RULES).await);

    assert_eq!(service.deleted(), ["canceled", "failed", "public"]);
    assert_eq!(
        outcome,
        SweepOutcome {
            listed: 7,
            orphans: 0,
            reclaimed: 3,
            failed: 0,
            reclaimed_published: 1,
            reclaimed_failed: 1,
            reclaimed_canceled: 1,
            skipped: 0,
            unconfirmed: 1,
            freed_bytes: Some(3 * TREE_BYTES),
        }
    );
    // Each reclaim is on the run, with its reason and the pass's time.
    for (id, reason) in [
        ("failed", ReclaimReason::Failed),
        ("canceled", ReclaimReason::Canceled),
        ("public", ReclaimReason::Published),
    ] {
        assert_eq!(
            db.run_artifacts_reclaimed(id).await.unwrap(),
            Some(crate::db::ArtifactsReclaimed {
                at: NOW_TEXT.to_string(),
                reason,
            }),
            "{id}"
        );
        assert_eq!(
            db.run_artifacts_stored(id).await.unwrap(),
            Some(false),
            "{id}"
        );
    }
    // Every other run keeps its tree and its record.
    for id in ["fresh-failure", "fresh-cancel", "pending", "unconfirmed"] {
        assert!(service.holds(id), "{id}");
        assert_eq!(db.run_artifacts_reclaimed(id).await.unwrap(), None, "{id}");
        assert_eq!(
            db.run_artifacts_stored(id).await.unwrap(),
            Some(true),
            "{id}"
        );
    }
    // The reconciliation that follows in the same pass, from a listing that still
    // names the deleted trees, marked nothing: no reclaimed run reads as stored
    // again, and none as having lost its tree.
    assert_eq!(reconciled, crate::db::ArtifactReconciliation::default());
}

#[tokio::test]
async fn the_next_pass_finds_nothing_left_to_do() {
    let db = db_of_every_kind().await;
    let (base, service) = spawn_service(&EVERY_KIND).await;
    complete(pass(&db, &base, &RULES).await);

    let (outcome, reconciled) = complete(pass(&db, &base, &RULES).await);

    assert_eq!(service.deleted().len(), 3, "nothing more was deleted");
    assert_eq!(outcome.reclaimed, 0);
    assert_eq!(
        outcome.freed_bytes, None,
        "a pass that deletes nothing reads no space"
    );
    // The three reclaimed runs have no tree listed. That is not a lost tree.
    assert_eq!(reconciled, crate::db::ArtifactReconciliation::default());
    for id in ["failed", "canceled", "public"] {
        assert!(db.run_artifacts_reclaimed(id).await.unwrap().is_some());
    }
}

#[tokio::test]
async fn a_policy_that_keeps_everything_leaves_the_orphan_rule_alone() {
    let db = db_of_every_kind().await;
    let mut held = EVERY_KIND.to_vec();
    held.push("orphan");
    let (base, service) = spawn_service(&held).await;
    let rules = SweepRules {
        grace: RULES.grace,
        retention: RetentionPolicy::KEEP_EVERYTHING,
    };

    let (outcome, _) = complete(pass(&db, &base, &rules).await);

    // The tree with no run row, listed as written long ago, is reclaimed as
    // before. No tree of a run that exists is touched.
    assert_eq!(service.deleted(), ["orphan"]);
    assert_eq!(
        (outcome.orphans, outcome.reclaimed, outcome.unconfirmed),
        (1, 1, 0)
    );
    assert_eq!(db.run_artifacts_reclaimed("failed").await.unwrap(), None);
}

#[tokio::test]
async fn the_published_switch_keeps_published_trees_in_a_pass() {
    let db = db_of_every_kind().await;
    let (base, service) = spawn_service(&EVERY_KIND).await;
    let rules = SweepRules {
        grace: RULES.grace,
        retention: RetentionPolicy {
            published: false,
            ..POLICY
        },
    };

    let (outcome, _) = complete(pass(&db, &base, &rules).await);

    assert_eq!(service.deleted(), ["canceled", "failed"]);
    assert!(service.holds("public"));
    assert_eq!(outcome.reclaimed_published, 0);
    assert_eq!(db.run_artifacts_reclaimed("public").await.unwrap(), None);
}

#[tokio::test]
async fn a_run_something_is_working_on_keeps_its_tree() {
    let db = db_of_every_kind().await;
    let (base, service) = spawn_service(&EVERY_KIND).await;
    // A job naming the failed run is still storing, one naming the canceled run is
    // queued, and a publish of the confirmed run is dispatched.
    seed_job(&db, "j1", "failed", "storing").await;
    seed_job(&db, "j2", "canceled", "queued").await;
    seed_publish_job(&db, "p1", "public", "dispatched", &ago(5)).await;

    let (outcome, _) = complete(pass(&db, &base, &RULES).await);

    assert!(service.deleted().is_empty());
    assert_eq!(outcome.reclaimed, 0);
    for id in ["failed", "canceled", "public"] {
        assert_eq!(db.run_artifacts_reclaimed(id).await.unwrap(), None, "{id}");
    }
}

#[tokio::test]
async fn a_failed_listing_deletes_nothing_and_records_nothing() {
    let db = db_of_every_kind().await;
    let (base, service) = spawn_service(&EVERY_KIND).await;
    *service.listing_works.lock().unwrap() = false;

    let pass = pass(&db, &base, &RULES).await;

    let ScheduledPass::Abandoned(why) = pass else {
        panic!("expected an abandoned pass, got {pass:?}");
    };
    assert_eq!(why.as_str(), "listing_failed");
    assert!(service.deleted().is_empty());
    for id in EVERY_KIND {
        assert_eq!(db.run_artifacts_reclaimed(id).await.unwrap(), None, "{id}");
        assert_eq!(
            db.run_artifacts_stored(id).await.unwrap(),
            Some(true),
            "{id}"
        );
    }
}

#[tokio::test]
async fn an_empty_run_set_deletes_nothing() {
    // A fresh database beside a populated volume. `scheduled_pass` abandons before
    // it lists, and the pass itself selects nothing when handed an empty set.
    let db = Db::connect_in_memory().await.unwrap();
    let (base, service) = spawn_service(&EVERY_KIND).await;

    let scheduled = pass(&db, &base, &RULES).await;
    assert!(matches!(
        scheduled,
        ScheduledPass::Abandoned(AbandonedPass::NoRuns)
    ));

    let (outcome, _) = sweep_pass(
        &db,
        &reqwest::Client::new(),
        &base,
        TOKEN,
        &[],
        &HashSet::new(),
        NOW,
        &RULES,
    )
    .await
    .unwrap();
    assert_eq!(outcome.reclaimed, 0);
    assert!(service.deleted().is_empty());
}

#[tokio::test]
async fn a_refused_delete_leaves_the_run_as_it_was_and_is_retried() {
    let db = db_of_every_kind().await;
    let (base, service) = spawn_service(&EVERY_KIND).await;
    *service.delete_status.lock().unwrap() = StatusCode::INTERNAL_SERVER_ERROR;

    let (outcome, reconciled) = complete(pass(&db, &base, &RULES).await);

    assert_eq!((outcome.reclaimed, outcome.failed), (0, 3));
    assert_eq!(outcome.freed_bytes, None);
    assert_eq!(reconciled, crate::db::ArtifactReconciliation::default());
    for id in ["failed", "canceled", "public"] {
        assert!(service.holds(id), "{id}");
        assert_eq!(db.run_artifacts_reclaimed(id).await.unwrap(), None, "{id}");
        assert_eq!(
            db.run_artifacts_stored(id).await.unwrap(),
            Some(true),
            "{id}"
        );
    }

    // The service recovers, and the next pass reclaims all three.
    *service.delete_status.lock().unwrap() = StatusCode::NO_CONTENT;
    let (outcome, _) = complete(pass(&db, &base, &RULES).await);
    assert_eq!((outcome.reclaimed, outcome.failed), (3, 0));
}

#[tokio::test]
async fn a_tree_that_lands_after_its_reclaim_is_deleted_again() {
    // A canceled run's upload outlived the retention and landed after the reclaim.
    let db = db_of_every_kind().await;
    let (base, service) = spawn_service(&EVERY_KIND).await;
    complete(pass(&db, &base, &RULES).await);
    let first = db.run_artifacts_reclaimed("canceled").await.unwrap();
    assert!(first.is_some());
    // It lands twenty minutes later.
    let landed = NOW + time::Duration::minutes(20);
    service.trees.lock().unwrap().insert("canceled".to_string());
    service
        .stored_at
        .lock()
        .unwrap()
        .insert("canceled".to_string(), landed.format(&Rfc3339).unwrap());
    // Its driver reports the tree stored. The record does not move.
    assert!(!db.set_run_artifacts_stored("canceled", true).await.unwrap());

    // The retention runs from the landing: a pass half an hour on keeps it.
    let later = |minutes: i64| landed + time::Duration::minutes(minutes);
    let client = reqwest::Client::new();
    complete(scheduled_pass(&db, &client, &base, TOKEN, later(30), &RULES).await);
    assert!(service.holds("canceled"));

    let (outcome, reconciled) =
        complete(scheduled_pass(&db, &client, &base, TOKEN, later(61), &RULES).await);

    assert_eq!(outcome.reclaimed_canceled, 1);
    assert!(!service.holds("canceled"), "the late tree is not leaked");
    assert_eq!(reconciled, crate::db::ArtifactReconciliation::default());
    // Still a reclaimed run with the reason it was reclaimed for and the time it
    // was first reclaimed at, not a stored one and not one that lost its tree.
    assert_eq!(db.run_artifacts_reclaimed("canceled").await.unwrap(), first);
    assert_eq!(
        db.run_artifacts_stored("canceled").await.unwrap(),
        Some(false)
    );
}

// ---------------------------------------------------------------------------
// The read made immediately before a delete
// ---------------------------------------------------------------------------

async fn reclaim(db: &Db, base: &str, id: &str, reason: ReclaimReason) -> Reclaim {
    reclaim_run_tree(
        db,
        &reqwest::Client::new(),
        base,
        TOKEN,
        &tree(id),
        reason,
        NOW,
        &POLICY,
    )
    .await
}

#[tokio::test]
async fn a_selected_run_that_still_qualifies_is_reclaimed() {
    let db = db_of_every_kind().await;
    let (base, service) = spawn_service(&EVERY_KIND).await;

    assert_eq!(
        reclaim(&db, &base, "failed", ReclaimReason::Failed).await,
        Reclaim::Reclaimed
    );
    assert_eq!(service.deleted(), ["failed"]);
}

#[tokio::test]
async fn a_run_published_since_it_was_selected_keeps_its_tree() {
    // Selected as a failed run past its retention. Before the delete a person
    // published it, and no refresh has confirmed its media yet.
    let db = db_of_every_kind().await;
    let (base, service) = spawn_service(&EVERY_KIND).await;
    force_published(&db, "failed").await;

    assert_eq!(
        reclaim(&db, &base, "failed", ReclaimReason::Failed).await,
        Reclaim::Skipped
    );
    assert!(service.deleted().is_empty());
    assert_eq!(db.run_artifacts_reclaimed("failed").await.unwrap(), None);
    assert_eq!(db.run_artifacts_stored("failed").await.unwrap(), Some(true));
}

#[tokio::test]
async fn a_run_whose_publish_was_requested_since_it_was_selected_keeps_its_tree() {
    let db = db_of_every_kind().await;
    let (base, service) = spawn_service(&EVERY_KIND).await;
    seed_publish_job(&db, "p1", "failed", "queued", NOW_TEXT).await;

    assert_eq!(
        reclaim(&db, &base, "failed", ReclaimReason::Failed).await,
        Reclaim::Skipped
    );
    assert!(service.deleted().is_empty());
    assert_eq!(db.run_artifacts_reclaimed("failed").await.unwrap(), None);
}

#[tokio::test]
async fn a_run_whose_confirmation_was_withdrawn_since_it_was_selected_keeps_its_tree() {
    let db = db_of_every_kind().await;
    let (base, service) = spawn_service(&EVERY_KIND).await;
    set_media_confirmed(&db, "public", None).await;

    assert_eq!(
        reclaim(&db, &base, "public", ReclaimReason::Published).await,
        Reclaim::Skipped
    );
    assert!(service.deleted().is_empty());
    assert_eq!(db.run_artifacts_reclaimed("public").await.unwrap(), None);
}

#[tokio::test]
async fn a_run_re_pushed_as_completed_since_it_was_selected_keeps_its_tree() {
    let db = db_of_every_kind().await;
    let (base, service) = spawn_service(&EVERY_KIND).await;
    seed_run(&db, "failed", RunState::Completed, &ago(48 * 60)).await;

    assert_eq!(
        reclaim(&db, &base, "failed", ReclaimReason::Failed).await,
        Reclaim::Skipped
    );
    assert!(service.deleted().is_empty());
}

#[tokio::test]
async fn a_run_whose_end_time_no_longer_reads_keeps_its_tree() {
    let db = db_of_every_kind().await;
    let (base, service) = spawn_service(&EVERY_KIND).await;
    set_finished_at(&db, "failed", "").await;

    assert_eq!(
        reclaim(&db, &base, "failed", ReclaimReason::Failed).await,
        Reclaim::Skipped
    );
    assert!(service.deleted().is_empty());
}

#[tokio::test]
async fn a_run_deleted_since_it_was_selected_is_left_to_the_orphan_rule() {
    let db = db_of_every_kind().await;
    let (base, service) = spawn_service(&EVERY_KIND).await;

    assert_eq!(
        reclaim(&db, &base, "never-existed", ReclaimReason::Failed).await,
        Reclaim::Skipped
    );
    assert!(service.deleted().is_empty());
}

#[tokio::test]
async fn a_reclaim_is_recorded_before_the_tree_is_deleted() {
    // The service refuses the delete, so the mark the reclaim wrote first is what
    // the restore undoes. A run row stamped by the mark shows it was written.
    let db = db_of_every_kind().await;
    let (base, service) = spawn_service(&EVERY_KIND).await;
    *service.delete_status.lock().unwrap() = StatusCode::SERVICE_UNAVAILABLE;

    assert_eq!(
        reclaim(&db, &base, "failed", ReclaimReason::Failed).await,
        Reclaim::Failed
    );

    assert_eq!(
        service.deleted(),
        ["failed"],
        "the delete was asked for once"
    );
    assert!(service.holds("failed"));
    assert_eq!(
        run_row(&db, "failed").await.updated_at,
        NOW_TEXT,
        "the reclaim was on the run when the delete was asked for"
    );
    assert_eq!(db.run_artifacts_reclaimed("failed").await.unwrap(), None);
    assert_eq!(db.run_artifacts_stored("failed").await.unwrap(), Some(true));
}

// ---------------------------------------------------------------------------
// When the tree was stored
// ---------------------------------------------------------------------------

#[test]
fn a_retention_runs_from_the_later_of_the_runs_end_and_the_trees_storing() {
    // The run failed two days ago and waited in `storing` through an outage of
    // the store. Its tree landed an hour ago.
    let failed = run("hung", 48 * 60);
    let stored = |minutes: i64| NOW - time::Duration::minutes(minutes);
    assert_eq!(
        retention_reason(&failed, false, stored(60), NOW, &POLICY),
        None
    );
    assert_eq!(
        retention_reason(&failed, false, stored(24 * 60), NOW, &POLICY),
        None,
        "at the boundary"
    );
    assert_eq!(
        retention_reason(&failed, false, stored(24 * 60 + 1), NOW, &POLICY),
        Some(ReclaimReason::Failed)
    );

    let canceled = run("canceled", 10 * 60);
    assert_eq!(
        retention_reason(&canceled, false, stored(30), NOW, &POLICY),
        None
    );
    assert_eq!(
        retention_reason(&canceled, false, stored(61), NOW, &POLICY),
        Some(ReclaimReason::Canceled)
    );

    // A tree stored before its run ended changes nothing: the end decides.
    assert_eq!(
        retention_reason(&run("hung", 60), false, STORED, NOW, &POLICY),
        None
    );
}

#[test]
fn a_tree_stored_in_the_future_is_kept() {
    let ahead = NOW + time::Duration::minutes(1);
    for state in FAILED_STATES.into_iter().chain(["canceled"]) {
        assert_eq!(
            retention_reason(&run(state, 10_000_000), false, ahead, NOW, &POLICY),
            None,
            "{state}"
        );
    }
}

#[test]
fn a_published_runs_tree_is_decided_by_its_confirmation_whenever_it_was_stored() {
    let recent = NOW - time::Duration::minutes(1);
    assert_eq!(
        retention_reason(&published(Some(&ago(5))), false, recent, NOW, &POLICY),
        Some(ReclaimReason::Published)
    );
}

#[tokio::test]
async fn a_pass_keeps_a_tree_that_landed_inside_the_retention() {
    let db = db_of_every_kind().await;
    let (base, service) = spawn_service(&EVERY_KIND).await;
    service
        .stored_at
        .lock()
        .unwrap()
        .insert("failed".to_string(), ago(60));

    let (outcome, _) = complete(pass(&db, &base, &RULES).await);

    assert_eq!(outcome.reclaimed_failed, 0);
    assert!(service.holds("failed"));
    assert_eq!(db.run_artifacts_reclaimed("failed").await.unwrap(), None);
}

// ---------------------------------------------------------------------------
// The bucket a confirmation was made against
// ---------------------------------------------------------------------------

#[test]
fn a_backend_with_no_bucket_reclaims_no_published_tree() {
    let no_bucket = RetentionPolicy {
        bucket: None,
        ..POLICY
    };
    assert_eq!(
        retention_reason(&published(Some(&ago(60))), false, STORED, NOW, &no_bucket),
        None
    );
    // The bucket is the published rule's alone.
    assert_eq!(
        retention_reason(&run("hung", 100_000), false, STORED, NOW, &no_bucket),
        Some(ReclaimReason::Failed)
    );
}

#[tokio::test]
async fn a_pass_keeps_a_published_tree_confirmed_against_another_bucket() {
    // The database was restored from an environment that publishes elsewhere, or
    // the backend was pointed at another bucket. This bucket may hold none of the
    // run's media, and the tree is then the only copy.
    let db = db_of_every_kind().await;
    let (base, service) = spawn_service(&EVERY_KIND).await;
    crate::db::retention_tests::set_media_confirmed_in(
        &db,
        "public",
        Some(&ago(5)),
        "https://r2.test/production",
    )
    .await;

    let (outcome, _) = complete(pass(&db, &base, &RULES).await);

    assert_eq!(outcome.reclaimed_published, 0);
    assert_eq!(outcome.unconfirmed, 2, "it counts as unconfirmed here");
    assert!(service.holds("public"));
    assert_eq!(db.run_artifacts_reclaimed("public").await.unwrap(), None);

    // The read made before a delete holds the same line.
    assert_eq!(
        reclaim(&db, &base, "public", ReclaimReason::Published).await,
        Reclaim::Skipped
    );
    assert!(service.deleted().iter().all(|id| id != "public"));
}

// ---------------------------------------------------------------------------
// A delete that gets no answer
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_delete_that_gets_no_answer_leaves_the_run_recorded_as_reclaimed() {
    // The service removed the tree and the answer never arrived. Taking the
    // record back would leave a run whose tree the backend deleted reading as one
    // whose tree was lost.
    let db = db_of_every_kind().await;
    let (base, service) = spawn_service(&EVERY_KIND).await;
    *service.unanswered_deletes.lock().unwrap() = Some(true);

    let (outcome, _) = complete(pass(&db, &base, &RULES).await);

    assert_eq!((outcome.reclaimed, outcome.failed), (0, 3));
    for id in ["failed", "canceled", "public"] {
        assert!(!service.holds(id), "{id}");
        assert!(
            db.run_artifacts_reclaimed(id).await.unwrap().is_some(),
            "{id}"
        );
        assert_eq!(
            db.run_artifacts_stored(id).await.unwrap(),
            Some(false),
            "{id}"
        );
    }

    // The next pass finds no tree to delete and nothing to correct.
    *service.unanswered_deletes.lock().unwrap() = None;
    let (outcome, reconciled) = complete(pass(&db, &base, &RULES).await);
    assert_eq!((outcome.reclaimed, outcome.failed), (0, 0));
    assert_eq!(reconciled, crate::db::ArtifactReconciliation::default());
}

#[tokio::test]
async fn a_tree_still_there_after_an_unanswered_delete_is_deleted_by_the_next_pass() {
    let db = db_of_every_kind().await;
    let (base, service) = spawn_service(&EVERY_KIND).await;
    *service.unanswered_deletes.lock().unwrap() = Some(false);
    complete(pass(&db, &base, &RULES).await);
    let first = db.run_artifacts_reclaimed("failed").await.unwrap();
    assert!(first.is_some());
    assert!(service.holds("failed"), "the delete never happened");

    *service.unanswered_deletes.lock().unwrap() = None;
    let later = NOW + time::Duration::minutes(10);
    let (outcome, reconciled) =
        complete(scheduled_pass(&db, &reqwest::Client::new(), &base, TOKEN, later, &RULES).await);

    assert_eq!((outcome.reclaimed, outcome.failed), (3, 0));
    assert!(!service.holds("failed"));
    assert_eq!(
        db.run_artifacts_reclaimed("failed").await.unwrap(),
        first,
        "the record is the one first written"
    );
    assert_eq!(reconciled, crate::db::ArtifactReconciliation::default());
}
