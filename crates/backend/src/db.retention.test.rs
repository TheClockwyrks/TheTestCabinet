//! Tests for what the artifact reclamation sweep's retention rules read and write
//! on a run: the reclaim record and how it keeps a reclaimed tree apart from a lost
//! one, a published run's media confirmation, and which runs are busy.
//!
//! The helpers that put a run into a given state are shared with the sweep's own
//! tests (`crate::artifacts::retention_tests`).

use std::collections::HashSet;

use sea_orm::sea_query::Expr;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use test_cabinet_core::run_record::RunState;
use test_cabinet_entities::{job, publish_job, run};
use time::macros::datetime;

use super::*;
use crate::db::tests::{links, new_job, new_publish_job, record};

/// Push a run that ended in `state` at `finished_at`, unpublished and with its
/// presence unknown.
pub(crate) async fn seed_run(db: &Db, id: &str, state: RunState, finished_at: &str) {
    let mut record = record(id);
    record.status.state = state;
    record.finished_at = finished_at.to_string();
    db.push(&record, &links(), None, None).await.unwrap();
}

/// Mark run `id` published, past the review gate: these tests are about a
/// published run's tree, whatever let the run be published.
pub(crate) async fn force_published(db: &Db, id: &str) {
    run::Entity::update_many()
        .col_expr(run::Column::Published, Expr::value(true))
        .col_expr(
            run::Column::PublishedAt,
            Expr::value("2026-06-18T00:00:00Z"),
        )
        .filter(run::Column::Id.eq(id))
        .exec(&db.conn())
        .await
        .unwrap();
}

/// The bucket the tests' backend is configured with, as a confirmation names it.
pub(crate) const BUCKET: &str = "https://r2.test/gallery";

/// Write run `id`'s media confirmation column verbatim, valid or not, as one made
/// against [`BUCKET`].
pub(crate) async fn set_media_confirmed(db: &Db, id: &str, at: Option<&str>) {
    set_media_confirmed_in(db, id, at, BUCKET).await;
}

/// Write run `id`'s media confirmation column verbatim, as one made against
/// `bucket` under the current version of the definition, with an empty manifest.
pub(crate) async fn set_media_confirmed_in(db: &Db, id: &str, at: Option<&str>, bucket: &str) {
    run::Entity::update_many()
        .col_expr(
            run::Column::MediaConfirmedAt,
            Expr::value(at.map(str::to_string)),
        )
        .col_expr(run::Column::MediaBucket, Expr::value(bucket))
        .col_expr(
            run::Column::MediaConfirmationVersion,
            Expr::value(MEDIA_CONFIRMATION_VERSION),
        )
        .col_expr(
            run::Column::MediaManifest,
            Expr::value(at.map(|_| r#"{"files":[]}"#.to_string())),
        )
        .filter(run::Column::Id.eq(id))
        .exec(&db.conn())
        .await
        .unwrap();
}

/// Write run `id`'s confirmation as a backend from before the definition
/// widened left it: confirmed against [`BUCKET`], with no version and no
/// manifest.
pub(crate) async fn confirm_under_the_first_definition(db: &Db, id: &str) {
    run::Entity::update_many()
        .col_expr(run::Column::MediaConfirmedAt, Expr::value(FIRST))
        .col_expr(run::Column::MediaCheckedAt, Expr::value(FIRST))
        .col_expr(run::Column::MediaBucket, Expr::value(BUCKET))
        .col_expr(
            run::Column::MediaConfirmationVersion,
            Expr::value(Option::<i32>::None),
        )
        .col_expr(
            run::Column::MediaManifest,
            Expr::value(Option::<String>::None),
        )
        .filter(run::Column::Id.eq(id))
        .exec(&db.conn())
        .await
        .unwrap();
}

/// Write run `id`'s end time column verbatim, valid or not.
pub(crate) async fn set_finished_at(db: &Db, id: &str, at: &str) {
    run::Entity::update_many()
        .col_expr(run::Column::FinishedAt, Expr::value(at))
        .filter(run::Column::Id.eq(id))
        .exec(&db.conn())
        .await
        .unwrap();
}

/// Run `id`'s whole row.
pub(crate) async fn run_row(db: &Db, id: &str) -> run::Model {
    run::Entity::find_by_id(id.to_string())
        .one(&db.conn())
        .await
        .unwrap()
        .expect("the run exists")
}

/// Enqueue job `job_id`, then put it in `state` naming `run_id` as its record.
pub(crate) async fn seed_job(db: &Db, job_id: &str, run_id: &str, state: &str) {
    db.enqueue_job(new_job(job_id, "2026-06-23T00:00:00Z"))
        .await
        .unwrap();
    job::Entity::update_many()
        .col_expr(job::Column::State, Expr::value(state))
        .col_expr(job::Column::RecordId, Expr::value(run_id))
        .filter(job::Column::Id.eq(job_id))
        .exec(&db.conn())
        .await
        .unwrap();
}

/// Enqueue publish job `job_id` for `run_id`, then put it in `state`, last updated
/// at `updated_at`.
pub(crate) async fn seed_publish_job(
    db: &Db,
    job_id: &str,
    run_id: &str,
    state: &str,
    updated_at: &str,
) {
    db.enqueue_publish_job(new_publish_job(job_id, run_id, updated_at))
        .await
        .unwrap();
    publish_job::Entity::update_many()
        .col_expr(publish_job::Column::State, Expr::value(state))
        .col_expr(publish_job::Column::UpdatedAt, Expr::value(updated_at))
        .filter(publish_job::Column::Id.eq(job_id))
        .exec(&db.conn())
        .await
        .unwrap();
}

/// A run that failed long ago, with its tree recorded as stored.
async fn failed_run(db: &Db, id: &str) -> RetentionRun {
    seed_run(db, id, RunState::Catastrophic, "2026-06-17T21:30:00Z").await;
    db.set_run_artifacts_stored(id, true).await.unwrap();
    db.retention_run(id, Some(BUCKET)).await.unwrap().unwrap()
}

const RECLAIMED_AT: &str = "2026-07-01T00:00:00Z";

fn ids(ids: &[&str]) -> HashSet<String> {
    ids.iter().map(|id| id.to_string()).collect()
}

// --- Instants ----------------------------------------------------------------

#[test]
fn only_a_parsable_instant_in_the_past_counts() {
    let now = datetime!(2026-07-01 12:00 UTC);
    assert_eq!(
        past_instant(Some("2026-07-01T11:00:00Z"), now),
        Some(datetime!(2026-07-01 11:00 UTC))
    );
    // The instant itself counts: a confirmation recorded this second is in the past.
    assert!(past_instant(Some("2026-07-01T12:00:00Z"), now).is_some());
    assert_eq!(past_instant(None, now), None, "absent");
    assert_eq!(past_instant(Some(""), now), None, "empty");
    assert_eq!(past_instant(Some("yesterday"), now), None, "unparsable");
    assert_eq!(
        past_instant(Some("2026-07-01 11:00:00"), now),
        None,
        "not RFC 3339"
    );
    assert_eq!(
        past_instant(Some("2026-07-01T12:00:01Z"), now),
        None,
        "the future"
    );
}

// --- The reclaim record ------------------------------------------------------

#[tokio::test]
async fn the_facts_of_a_run_are_read_whole() {
    let db = Db::connect_in_memory().await.unwrap();
    seed_run(&db, "r1", RunState::TimedOut, "2026-06-17T21:30:00Z").await;

    let run = db.retention_run("r1", Some(BUCKET)).await.unwrap().unwrap();

    assert_eq!(run.id, "r1");
    assert_eq!(run.run_state, "timed_out");
    assert_eq!(run.finished_at, "2026-06-17T21:30:00Z");
    assert!(!run.published);
    assert_eq!(run.media_confirmed_at, None);
    assert_eq!(run.artifacts_stored, None);
    assert_eq!(run.artifacts_reclaimed_at, None);
    assert_eq!(db.retention_runs(Some(BUCKET)).await.unwrap(), vec![run]);
    assert_eq!(db.retention_run("ghost", Some(BUCKET)).await.unwrap(), None);
}

#[tokio::test]
async fn a_reclaim_records_when_and_why_and_that_the_tree_is_gone() {
    let db = Db::connect_in_memory().await.unwrap();
    let seen = failed_run(&db, "r1").await;

    assert!(
        db.mark_artifacts_reclaimed(&seen, ReclaimReason::Failed, RECLAIMED_AT)
            .await
            .unwrap()
    );

    assert_eq!(
        db.run_artifacts_reclaimed("r1").await.unwrap(),
        Some(ArtifactsReclaimed {
            at: RECLAIMED_AT.to_string(),
            reason: ReclaimReason::Failed,
        })
    );
    assert_eq!(db.run_artifacts_stored("r1").await.unwrap(), Some(false));
    let stored = db.get_run("r1").await.unwrap().unwrap();
    assert_eq!(
        stored.artifacts_reclaimed.map(|reclaimed| reclaimed.reason),
        Some(ReclaimReason::Failed),
        "the stored run carries the record"
    );
    assert_eq!(db.run_artifacts_reclaimed("ghost").await.unwrap(), None);
}

#[tokio::test]
async fn a_reclaim_stamps_a_failed_run_and_leaves_a_published_one_unstamped() {
    let db = Db::connect_in_memory().await.unwrap();
    let failed = failed_run(&db, "failed").await;
    seed_run(&db, "public", RunState::Completed, "2026-06-17T21:30:00Z").await;
    force_published(&db, "public").await;
    let public = db
        .retention_run("public", Some(BUCKET))
        .await
        .unwrap()
        .unwrap();
    let public_before = run_row(&db, "public").await.updated_at;

    db.mark_artifacts_reclaimed(&failed, ReclaimReason::Failed, RECLAIMED_AT)
        .await
        .unwrap();
    db.mark_artifacts_reclaimed(&public, ReclaimReason::Published, RECLAIMED_AT)
        .await
        .unwrap();

    assert_eq!(run_row(&db, "failed").await.updated_at, RECLAIMED_AT);
    assert_eq!(run_row(&db, "public").await.updated_at, public_before);
}

#[tokio::test]
async fn a_reclaim_is_not_recorded_on_a_run_that_changed_since_it_was_read() {
    let db = Db::connect_in_memory().await.unwrap();
    let seen = failed_run(&db, "r1").await;
    // Published between the read and the write: no longer the run that qualified.
    force_published(&db, "r1").await;

    assert!(
        !db.mark_artifacts_reclaimed(&seen, ReclaimReason::Failed, RECLAIMED_AT)
            .await
            .unwrap()
    );
    assert_eq!(db.run_artifacts_reclaimed("r1").await.unwrap(), None);
    assert_eq!(db.run_artifacts_stored("r1").await.unwrap(), Some(true));

    // Re-pushed in another state: likewise left alone.
    let seen = failed_run(&db, "r2").await;
    seed_run(&db, "r2", RunState::Completed, "2026-06-17T21:30:00Z").await;
    assert!(
        !db.mark_artifacts_reclaimed(&seen, ReclaimReason::Failed, RECLAIMED_AT)
            .await
            .unwrap()
    );
    assert_eq!(db.run_artifacts_reclaimed("r2").await.unwrap(), None);
}

#[tokio::test]
async fn a_refused_delete_puts_the_record_back_as_it_was() {
    let db = Db::connect_in_memory().await.unwrap();
    let seen = failed_run(&db, "r1").await;
    db.mark_artifacts_reclaimed(&seen, ReclaimReason::Failed, RECLAIMED_AT)
        .await
        .unwrap();

    assert!(
        db.restore_artifact_record(&seen, RECLAIMED_AT)
            .await
            .unwrap()
    );

    assert_eq!(db.run_artifacts_reclaimed("r1").await.unwrap(), None);
    assert_eq!(db.run_artifacts_stored("r1").await.unwrap(), Some(true));
    // Only the mark that was written is undone: a second restore finds none.
    assert!(
        !db.restore_artifact_record(&seen, RECLAIMED_AT)
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn restoring_a_second_reclaim_keeps_the_first() {
    // A tree that landed again for a reclaimed run, whose second delete the
    // service refused: the run stays reclaimed as of the first.
    let db = Db::connect_in_memory().await.unwrap();
    let seen = failed_run(&db, "r1").await;
    db.mark_artifacts_reclaimed(&seen, ReclaimReason::Failed, RECLAIMED_AT)
        .await
        .unwrap();
    let again = db.retention_run("r1", Some(BUCKET)).await.unwrap().unwrap();
    let later = "2026-07-02T00:00:00Z";
    db.mark_artifacts_reclaimed(&again, ReclaimReason::Failed, later)
        .await
        .unwrap();

    db.restore_artifact_record(&again, later).await.unwrap();

    assert_eq!(
        db.run_artifacts_reclaimed("r1").await.unwrap(),
        Some(ArtifactsReclaimed {
            at: RECLAIMED_AT.to_string(),
            reason: ReclaimReason::Failed,
        })
    );
    assert_eq!(db.run_artifacts_stored("r1").await.unwrap(), Some(false));
}

#[test]
fn a_reclaim_with_a_reason_this_build_does_not_know_still_reads_as_reclaimed() {
    assert_eq!(
        ArtifactsReclaimed::from_columns(Some(RECLAIMED_AT.to_string()), Some("archived")),
        Some(ArtifactsReclaimed {
            at: RECLAIMED_AT.to_string(),
            reason: ReclaimReason::Failed,
        })
    );
    assert_eq!(ArtifactsReclaimed::from_columns(None, Some("failed")), None);
    for reason in [
        ReclaimReason::Published,
        ReclaimReason::Failed,
        ReclaimReason::Canceled,
    ] {
        assert_eq!(ReclaimReason::parse(reason.as_str()), Some(reason));
    }
}

// --- A reclaimed run is not a lost one ---------------------------------------

/// A run whose tree was reclaimed.
async fn reclaimed_run(db: &Db, id: &str) {
    let seen = failed_run(db, id).await;
    db.mark_artifacts_reclaimed(&seen, ReclaimReason::Failed, RECLAIMED_AT)
        .await
        .unwrap();
}

#[tokio::test]
async fn no_presence_report_moves_a_reclaimed_run() {
    let db = Db::connect_in_memory().await.unwrap();
    reclaimed_run(&db, "r1").await;

    // A canceled run's upload that landed after the reclaim reports its tree
    // stored. The tree is the sweep's to delete again; the record stands.
    assert!(!db.set_run_artifacts_stored("r1", true).await.unwrap());
    assert_eq!(db.run_artifacts_stored("r1").await.unwrap(), Some(false));
    assert!(db.run_artifacts_reclaimed("r1").await.unwrap().is_some());
}

#[tokio::test]
async fn reconciliation_leaves_a_reclaimed_run_as_it_is() {
    let db = Db::connect_in_memory().await.unwrap();
    reclaimed_run(&db, "relanded").await;
    reclaimed_run(&db, "gone").await;
    let before = run_row(&db, "gone").await.updated_at;

    // `relanded` is listed again and `gone` is not. Neither is written.
    let reconciled = db
        .reconcile_artifacts_stored(&ids(&["relanded", "gone"]), &ids(&["relanded"]))
        .await
        .unwrap();

    assert_eq!(reconciled, ArtifactReconciliation::default());
    assert_eq!(
        db.run_artifacts_stored("relanded").await.unwrap(),
        Some(false)
    );
    assert_eq!(db.run_artifacts_stored("gone").await.unwrap(), Some(false));
    assert_eq!(run_row(&db, "gone").await.updated_at, before);
}

#[tokio::test]
async fn the_restart_check_passes_over_a_reclaimed_run() {
    // The most recently finished run was reclaimed, which records it as not
    // stored. That says nothing about the store: the run before it decides.
    let db = Db::connect_in_memory().await.unwrap();
    seed_run(&db, "older", RunState::Completed, "2026-06-17T21:30:00Z").await;
    db.set_run_artifacts_stored("older", true).await.unwrap();
    seed_job(&db, "j-older", "older", "succeeded").await;
    reclaimed_run(&db, "newer").await;
    seed_job(&db, "j-newer", "newer", "failed").await;
    for (job_id, at) in [
        ("j-older", "2026-06-23T01:00:00Z"),
        ("j-newer", "2026-06-23T02:00:00Z"),
    ] {
        job::Entity::update_many()
            .col_expr(job::Column::UpdatedAt, Expr::value(at))
            .filter(job::Column::Id.eq(job_id))
            .exec(&db.conn())
            .await
            .unwrap();
    }

    assert_eq!(db.latest_finished_tree_stored().await.unwrap(), Some(true));
}

#[tokio::test]
async fn the_restart_check_still_reads_a_lost_tree_as_lost() {
    let db = Db::connect_in_memory().await.unwrap();
    seed_run(&db, "lost", RunState::Completed, "2026-06-17T21:30:00Z").await;
    db.set_run_artifacts_stored("lost", false).await.unwrap();
    seed_job(&db, "j-lost", "lost", "succeeded").await;

    assert_eq!(db.latest_finished_tree_stored().await.unwrap(), Some(false));
}

#[tokio::test]
async fn automatic_publishing_has_no_candidate_in_a_reclaimed_run() {
    use crate::db::tests::{validator_manifest, validator_record};

    let db = Db::connect_in_memory().await.unwrap();
    let manifest = validator_manifest();
    for id in ["kept", "reclaimed"] {
        db.push(&validator_record(id, &[]), &links(), None, Some(&manifest))
            .await
            .unwrap();
    }
    let both = vec!["kept".to_string(), "reclaimed".to_string()];
    assert_eq!(db.auto_publish_candidates(&both).await.unwrap().len(), 2);
    db.defer_auto_publish(&both).await.unwrap();

    let seen = db
        .retention_run("reclaimed", Some(BUCKET))
        .await
        .unwrap()
        .unwrap();
    db.mark_artifacts_reclaimed(&seen, ReclaimReason::Failed, RECLAIMED_AT)
        .await
        .unwrap();

    let candidates = db.auto_publish_candidates(&both).await.unwrap();
    assert_eq!(
        candidates
            .iter()
            .map(|candidate| candidate.run_id.as_str())
            .collect::<Vec<_>>(),
        ["kept"]
    );
    // The retry stops carrying the reclaimed run: nothing will ever release it.
    assert_eq!(db.settle_auto_publish_deferred(&both).await.unwrap(), 1);
    assert_eq!(db.auto_publish_deferred_runs().await.unwrap(), ["kept"]);
}

// --- Busy runs ---------------------------------------------------------------

#[tokio::test]
async fn a_run_is_busy_while_a_job_of_it_is_in_flight() {
    let now = "2026-06-27T00:10:00Z";
    for state in [
        "queued",
        "pending",
        "dispatched",
        "starting",
        "running",
        "storing",
    ] {
        let db = Db::connect_in_memory().await.unwrap();
        seed_job(&db, "j1", "r1", state).await;
        assert_eq!(db.busy_run_ids(now).await.unwrap(), ids(&["r1"]), "{state}");
        assert!(db.run_is_busy("r1", now).await.unwrap(), "{state}");
    }
    for state in ["succeeded", "failed", "canceled"] {
        let db = Db::connect_in_memory().await.unwrap();
        seed_job(&db, "j1", "r1", state).await;
        assert!(db.busy_run_ids(now).await.unwrap().is_empty(), "{state}");
        assert!(!db.run_is_busy("r1", now).await.unwrap(), "{state}");
    }
}

#[tokio::test]
async fn a_run_is_busy_while_a_publish_job_for_it_is_queued_or_dispatched() {
    let now = "2026-06-27T00:10:00Z";
    for state in ["queued", "dispatched"] {
        let db = Db::connect_in_memory().await.unwrap();
        seed_publish_job(&db, "p1", "r1", state, "2026-06-27T00:00:00Z").await;
        assert_eq!(db.busy_run_ids(now).await.unwrap(), ids(&["r1"]), "{state}");
        assert!(db.run_is_busy("r1", now).await.unwrap(), "{state}");
    }
    for state in ["succeeded", "failed"] {
        let db = Db::connect_in_memory().await.unwrap();
        seed_publish_job(&db, "p1", "r1", state, "2026-06-27T00:00:00Z").await;
        assert!(db.busy_run_ids(now).await.unwrap().is_empty(), "{state}");
        assert!(!db.run_is_busy("r1", now).await.unwrap(), "{state}");
    }
}

#[tokio::test]
async fn a_publish_job_whose_publisher_is_gone_keeps_no_run_busy() {
    // Dispatched and silent for longer than a publish can take: the rule the
    // publish gate applies before it lets a second publish through.
    let db = Db::connect_in_memory().await.unwrap();
    seed_publish_job(&db, "p1", "r1", "dispatched", "2026-06-27T00:00:00Z").await;
    let much_later = "2026-06-27T02:00:00Z";

    assert!(db.busy_run_ids(much_later).await.unwrap().is_empty());
    assert!(!db.run_is_busy("r1", much_later).await.unwrap());
}

// --- Media confirmation ------------------------------------------------------

/// A published run with no confirmation on record.
async fn published_run(db: &Db, id: &str) {
    seed_run(db, id, RunState::Completed, "2026-06-17T21:30:00Z").await;
    force_published(db, id).await;
}

fn owned(ids: &[&str]) -> Vec<String> {
    ids.iter().map(|id| id.to_string()).collect()
}

pub(crate) const FIRST: &str = "2026-07-01T00:00:00Z";
pub(crate) const SECOND: &str = "2026-07-02T00:00:00Z";

/// What a refresh reads about the published runs `ids` before it builds.
async fn states(db: &Db, ids: &[&str]) -> Vec<PublishedMediaState> {
    let all = db.published_media_states(BUCKET).await.unwrap();
    ids.iter()
        .map(|id| {
            all.iter()
                .find(|state| state.id == *id)
                .unwrap_or_else(|| panic!("{id} is not a published run"))
                .clone()
        })
        .collect()
}

/// The manifest the tests' refreshes record for run `id`: one proof.
pub(crate) fn manifest_of(id: &str) -> MediaManifest {
    MediaManifest {
        files: vec![MediaManifestFile::stored(
            MediaFileKind::Proof,
            "proof/gameplay.png",
            format!("media/runs/{id}/proof/gameplay.png"),
        )],
    }
}

/// Each of `states` as a run a refresh found confirmed, with [`manifest_of`] it.
pub(crate) fn confirmed_media(states: Vec<PublishedMediaState>) -> Vec<ConfirmedMedia> {
    states
        .into_iter()
        .map(|state| ConfirmedMedia {
            manifest: manifest_of(&state.id),
            state,
        })
        .collect()
}

/// Record a refresh at `at` that confirmed `confirmed` and could not confirm
/// `unconfirmed`, having read the runs just now.
pub(crate) async fn refresh(
    db: &Db,
    confirmed: &[&str],
    unconfirmed: &[&str],
    at: &str,
) -> MediaConfirmation {
    let confirmed = confirmed_media(states(db, confirmed).await);
    db.record_media_confirmation(&confirmed, &owned(unconfirmed), at, BUCKET)
        .await
        .unwrap()
}

#[tokio::test]
async fn a_refresh_records_the_runs_it_confirmed_once() {
    let db = Db::connect_in_memory().await.unwrap();
    published_run(&db, "a").await;
    published_run(&db, "b").await;
    let before = run_row(&db, "a").await.updated_at;

    let first = refresh(&db, &["a"], &["b"], FIRST).await;

    assert_eq!(
        first,
        MediaConfirmation {
            confirmed: 1,
            withdrawn: 0,
            changed: 0,
        }
    );
    let a = run_row(&db, "a").await;
    assert_eq!(a.media_confirmed_at.as_deref(), Some(FIRST));
    assert_eq!(a.media_checked_at.as_deref(), Some(FIRST));
    assert_eq!(a.media_bucket.as_deref(), Some(BUCKET));
    assert_eq!(a.updated_at, before, "nothing a console shows has changed");
    let b = run_row(&db, "b").await;
    assert_eq!(b.media_confirmed_at, None);
    assert_eq!(
        b.media_checked_at.as_deref(),
        Some(FIRST),
        "a run a refresh could not confirm was still evaluated"
    );
    assert_eq!(b.media_bucket.as_deref(), Some(BUCKET));

    // A later refresh that finds the same writes nothing.
    let second = refresh(&db, &["a"], &["b"], SECOND).await;
    assert_eq!(second, MediaConfirmation::default());
    assert_eq!(
        run_row(&db, "a").await.media_confirmed_at.as_deref(),
        Some(FIRST)
    );
    assert_eq!(
        run_row(&db, "b").await.media_checked_at.as_deref(),
        Some(FIRST)
    );
}

#[tokio::test]
async fn a_refresh_that_finds_a_run_unconfirmed_withdraws_its_confirmation() {
    let db = Db::connect_in_memory().await.unwrap();
    published_run(&db, "stored").await;
    published_run(&db, "reclaimed").await;
    refresh(&db, &["stored", "reclaimed"], &[], FIRST).await;
    let seen = db
        .retention_run("reclaimed", Some(BUCKET))
        .await
        .unwrap()
        .unwrap();
    db.mark_artifacts_reclaimed(&seen, ReclaimReason::Published, RECLAIMED_AT)
        .await
        .unwrap();

    let outcome = refresh(&db, &[], &["stored", "reclaimed"], SECOND).await;

    // Whatever the state of the tree. The publisher leaves a settled run out of
    // what it records; a reclaimed run it does hand over is one whose media it
    // went looking for and did not find, and the record must not go on saying
    // otherwise.
    assert_eq!(outcome.withdrawn, 2);
    assert_eq!(run_row(&db, "stored").await.media_confirmed_at, None);
    assert_eq!(run_row(&db, "reclaimed").await.media_confirmed_at, None);
    // The reclaim record stands: the tree was removed on purpose.
    assert!(
        db.run_artifacts_reclaimed("reclaimed")
            .await
            .unwrap()
            .is_some()
    );
}

#[tokio::test]
async fn only_a_published_run_is_confirmed() {
    let db = Db::connect_in_memory().await.unwrap();
    seed_run(&db, "pending", RunState::Completed, "2026-06-17T21:30:00Z").await;
    let updated_at = run_row(&db, "pending").await.updated_at;
    let state = |id: &str| PublishedMediaState {
        id: id.to_string(),
        updated_at: updated_at.clone(),
        confirmed: false,
        reclaimed: false,
        tree_recorded_absent: false,
    };

    let outcome = db
        .record_media_confirmation(
            &confirmed_media(vec![state("pending"), state("ghost")]),
            &[],
            FIRST,
            BUCKET,
        )
        .await
        .unwrap();

    assert_eq!(
        outcome,
        MediaConfirmation {
            changed: 2,
            ..MediaConfirmation::default()
        }
    );
    let row = run_row(&db, "pending").await;
    assert_eq!(row.media_confirmed_at, None);
    assert_eq!(row.media_checked_at, None);
}

#[tokio::test]
async fn a_run_that_changed_since_the_refresh_read_it_is_not_confirmed() {
    // The refresh read the run, built from its record, and found every file in
    // the bucket. Meanwhile the run was pushed again with a record that lists
    // more. Confirming it would let the sweep delete the tree of a record no
    // refresh has looked at.
    let db = Db::connect_in_memory().await.unwrap();
    published_run(&db, "a").await;
    published_run(&db, "steady").await;
    let read = states(&db, &["a", "steady"]).await;

    let mut again = record("a");
    again.finished_at = "2026-06-18T09:00:00Z".to_string();
    db.push(&again, &links(), None, None).await.unwrap();
    assert_ne!(run_row(&db, "a").await.updated_at, read[0].updated_at);

    let outcome = db
        .record_media_confirmation(&confirmed_media(read.clone()), &[], FIRST, BUCKET)
        .await
        .unwrap();

    assert_eq!((outcome.confirmed, outcome.changed), (1, 1));
    let a = run_row(&db, "a").await;
    assert_eq!(a.media_confirmed_at, None);
    assert_eq!(a.media_checked_at, None, "left for the next refresh");
    assert_eq!(
        run_row(&db, "steady").await.media_confirmed_at.as_deref(),
        Some(FIRST)
    );
    // A start still counts it as a run to evaluate.
    assert_eq!(db.published_runs_unchecked(BUCKET).await.unwrap(), 1);
}

#[tokio::test]
async fn storing_a_run_again_clears_its_confirmation() {
    let db = Db::connect_in_memory().await.unwrap();
    published_run(&db, "a").await;
    refresh(&db, &["a"], &[], FIRST).await;
    assert!(
        db.retention_run("a", Some(BUCKET))
            .await
            .unwrap()
            .unwrap()
            .media_confirmed_at
            .is_some()
    );

    db.push(&record("a"), &links(), None, None).await.unwrap();

    let row = run_row(&db, "a").await;
    assert!(row.published, "a re-push keeps the run published");
    assert_eq!(row.media_confirmed_at, None);
    assert_eq!(row.media_checked_at, None);
    assert_eq!(row.media_bucket, None);
    assert_eq!(db.published_runs_unchecked(BUCKET).await.unwrap(), 1);
}

#[tokio::test]
async fn storing_a_reclaimed_run_again_clears_the_reclaim_record() {
    // The push follows a driver that ran the run again and uploaded its tree, so
    // the run is no longer one with no tree on purpose.
    let db = Db::connect_in_memory().await.unwrap();
    let seen = failed_run(&db, "r1").await;
    db.mark_artifacts_reclaimed(&seen, ReclaimReason::Failed, RECLAIMED_AT)
        .await
        .unwrap();
    assert!(db.run_artifacts_reclaimed("r1").await.unwrap().is_some());

    seed_run(&db, "r1", RunState::Completed, "2026-07-02T00:00:00Z").await;

    assert_eq!(db.run_artifacts_reclaimed("r1").await.unwrap(), None);
    assert_eq!(
        db.run_artifacts_stored("r1").await.unwrap(),
        None,
        "unknown until the driver reports or a pass reconciles"
    );
    // And the driver's report is taken again.
    assert!(db.set_run_artifacts_stored("r1", true).await.unwrap());
}

#[tokio::test]
async fn storing_a_run_again_leaves_a_stored_trees_presence_alone() {
    let db = Db::connect_in_memory().await.unwrap();
    failed_run(&db, "r1").await;

    seed_run(&db, "r1", RunState::Completed, "2026-07-02T00:00:00Z").await;

    assert_eq!(db.run_artifacts_stored("r1").await.unwrap(), Some(true));
}

#[tokio::test]
async fn a_confirmation_made_against_another_bucket_is_not_reported() {
    // A database restored into another environment, or a backend pointed at
    // another bucket: the media was confirmed somewhere this backend does not
    // publish to.
    let db = Db::connect_in_memory().await.unwrap();
    published_run(&db, "here").await;
    published_run(&db, "elsewhere").await;
    published_run(&db, "legacy").await;
    refresh(&db, &["here"], &[], FIRST).await;
    set_media_confirmed_in(&db, "elsewhere", Some(FIRST), "https://r2.test/other").await;
    // Confirmed before confirmations named a bucket.
    run::Entity::update_many()
        .col_expr(run::Column::MediaConfirmedAt, Expr::value(FIRST))
        .col_expr(run::Column::MediaCheckedAt, Expr::value(FIRST))
        .filter(run::Column::Id.eq("legacy"))
        .exec(&db.conn())
        .await
        .unwrap();

    let confirmed = |runs: Vec<RetentionRun>| -> Vec<String> {
        let mut ids: Vec<String> = runs
            .into_iter()
            .filter(|run| run.media_confirmed_at.is_some())
            .map(|run| run.id)
            .collect();
        ids.sort();
        ids
    };
    assert_eq!(
        confirmed(db.retention_runs(Some(BUCKET)).await.unwrap()),
        ["here"]
    );
    assert_eq!(
        confirmed(
            db.retention_runs(Some("https://r2.test/other"))
                .await
                .unwrap()
        ),
        ["elsewhere"]
    );
    // A backend with no bucket has nowhere a run could be confirmed.
    assert!(confirmed(db.retention_runs(None).await.unwrap()).is_empty());
    for id in ["elsewhere", "legacy"] {
        assert_eq!(
            db.retention_run(id, Some(BUCKET))
                .await
                .unwrap()
                .unwrap()
                .media_confirmed_at,
            None,
            "{id}"
        );
    }

    // Both are runs this bucket's refresh has yet to evaluate.
    let states = db.published_media_states(BUCKET).await.unwrap();
    let confirmed_here: Vec<&str> = states
        .iter()
        .filter(|state| state.confirmed)
        .map(|state| state.id.as_str())
        .collect();
    assert_eq!(confirmed_here, ["here"]);
    assert_eq!(db.published_runs_unchecked(BUCKET).await.unwrap(), 2);
}

#[tokio::test]
async fn a_refresh_against_this_bucket_replaces_another_buckets_confirmation() {
    let db = Db::connect_in_memory().await.unwrap();
    published_run(&db, "found").await;
    published_run(&db, "missing").await;
    for id in ["found", "missing"] {
        set_media_confirmed_in(&db, id, Some(FIRST), "https://r2.test/other").await;
    }

    let outcome = refresh(&db, &["found"], &["missing"], SECOND).await;

    assert_eq!((outcome.confirmed, outcome.withdrawn), (1, 1));
    let found = run_row(&db, "found").await;
    assert_eq!(found.media_confirmed_at.as_deref(), Some(SECOND));
    assert_eq!(found.media_bucket.as_deref(), Some(BUCKET));
    let missing = run_row(&db, "missing").await;
    assert_eq!(missing.media_confirmed_at, None);
    assert_eq!(missing.media_bucket.as_deref(), Some(BUCKET));
    assert_eq!(db.published_runs_unchecked(BUCKET).await.unwrap(), 0);
}

#[tokio::test]
async fn a_run_confirmed_here_with_its_tree_reclaimed_is_settled() {
    let db = Db::connect_in_memory().await.unwrap();
    published_run(&db, "kept").await;
    published_run(&db, "gone").await;
    published_run(&db, "gone-elsewhere").await;
    refresh(&db, &["kept", "gone"], &[], FIRST).await;
    set_media_confirmed_in(&db, "gone-elsewhere", Some(FIRST), "https://r2.test/other").await;
    for id in ["gone", "gone-elsewhere"] {
        let seen = db.retention_run(id, None).await.unwrap().unwrap();
        db.mark_artifacts_reclaimed(&seen, ReclaimReason::Published, RECLAIMED_AT)
            .await
            .unwrap();
    }

    let settled: Vec<String> = db
        .published_media_states(BUCKET)
        .await
        .unwrap()
        .into_iter()
        .filter(PublishedMediaState::settled)
        .map(|state| state.id)
        .collect();

    assert_eq!(settled, ["gone"]);
}

#[tokio::test]
async fn the_unchecked_count_is_the_published_runs_no_refresh_has_evaluated() {
    let db = Db::connect_in_memory().await.unwrap();
    assert_eq!(db.published_runs_unchecked(BUCKET).await.unwrap(), 0);
    published_run(&db, "a").await;
    published_run(&db, "b").await;
    seed_run(&db, "pending", RunState::Completed, "2026-06-17T21:30:00Z").await;
    assert_eq!(db.published_runs_unchecked(BUCKET).await.unwrap(), 2);

    // One confirmed and one not: both were evaluated, so neither counts.
    refresh(&db, &["a"], &["b"], FIRST).await;
    assert_eq!(db.published_runs_unchecked(BUCKET).await.unwrap(), 0);
}

#[tokio::test]
async fn a_published_run_no_snapshot_holds_is_not_counted_as_unchecked() {
    // A run whose record no longer reads is in no snapshot, so no refresh will
    // ever evaluate it. Counting it would request a refresh at every start.
    let db = Db::connect_in_memory().await.unwrap();
    published_run(&db, "unreadable").await;
    run::Entity::update_many()
        .col_expr(run::Column::RecordReadable, Expr::value(false))
        .filter(run::Column::Id.eq("unreadable"))
        .exec(&db.conn())
        .await
        .unwrap();

    assert_eq!(db.published_runs_unchecked(BUCKET).await.unwrap(), 0);
}
