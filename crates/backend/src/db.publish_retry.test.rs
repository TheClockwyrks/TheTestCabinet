//! Tests for what the retry of failed publishes reads from and writes to the
//! publish job table: the facts the publish rules are decided from, and the end of
//! a publish job whose publisher never reported.

use sea_orm::sea_query::Expr;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use test_cabinet_core::run_record::RunState;
use test_cabinet_entities::{job, publish_job, run};
use time::macros::datetime;

use super::PUBLISHER_NEVER_REPORTED;
use crate::db::retention_tests::{force_published, seed_publish_job, seed_run};
use crate::db::{Db, ReclaimReason};

const ENDED: &str = "2026-10-01T00:00:00Z";

async fn db_with_runs(runs: &[&str]) -> Db {
    let db = Db::connect_in_memory().await.unwrap();
    for run in runs {
        seed_run(&db, run, RunState::Completed, ENDED).await;
        set_validator_rated(&db, run, true).await;
    }
    db
}

/// Write run `id`'s validator-rated flag, which is what lets a completed run be
/// published with no review.
async fn set_validator_rated(db: &Db, id: &str, rated: bool) {
    run::Entity::update_many()
        .col_expr(run::Column::ValidatorRated, Expr::value(rated))
        .filter(run::Column::Id.eq(id))
        .exec(&db.conn())
        .await
        .unwrap();
}

fn sorted(mut ids: Vec<String>) -> Vec<String> {
    ids.sort();
    ids
}

#[tokio::test]
async fn the_facts_hold_every_publish_job_of_the_unpublished_runs() {
    let db = db_with_runs(&["open", "done"]).await;
    seed_publish_job(&db, "p1", "open", "failed", "2026-10-01T01:00:00Z").await;
    seed_publish_job(&db, "p2", "open", "queued", "2026-10-01T02:00:00Z").await;
    seed_publish_job(&db, "p3", "done", "failed", "2026-10-01T01:30:00Z").await;
    seed_publish_job(&db, "p4", "done", "succeeded", "2026-10-01T03:00:00Z").await;
    force_published(&db, "done").await;

    let facts = db.publish_facts().await.unwrap();

    assert_eq!(
        sorted(facts.jobs.iter().map(|job| job.id.clone()).collect()),
        ["p1", "p2"],
        "a published run's failures are behind it"
    );
    assert_eq!(sorted(facts.releasable.into_iter().collect()), ["open"]);
    assert_eq!(
        facts.last_success,
        Some(datetime!(2026-10-01 03:00:00 UTC)),
        "the published run's success is what clears a hold"
    );
}

#[tokio::test]
async fn the_latest_success_is_found_by_instant_not_by_text() {
    let db = db_with_runs(&["a", "b", "c"]).await;
    // Within one second, text orders a bare `Z` after any fraction.
    seed_publish_job(&db, "p1", "a", "succeeded", "2026-10-01T03:00:05Z").await;
    seed_publish_job(&db, "p2", "b", "succeeded", "2026-10-01T03:00:05.75Z").await;
    seed_publish_job(&db, "p3", "c", "succeeded", "2026-10-01T03:00:04.9Z").await;

    let facts = db.publish_facts().await.unwrap();

    assert_eq!(
        facts.last_success,
        Some(datetime!(2026-10-01 03:00:05.75 UTC))
    );
}

#[tokio::test]
async fn with_no_publish_jobs_there_is_nothing_to_assess() {
    let db = db_with_runs(&["a"]).await;
    let facts = db.publish_facts().await.unwrap();
    assert!(facts.jobs.is_empty());
    assert!(facts.releasable.is_empty());
    assert_eq!(facts.last_success, None);
}

#[tokio::test]
async fn a_run_with_no_tree_to_release_is_not_releasable() {
    let db = db_with_runs(&["unknown", "stored", "lost", "reclaimed"]).await;
    for run in ["unknown", "stored", "lost", "reclaimed"] {
        seed_publish_job(
            &db,
            &format!("p-{run}"),
            run,
            "failed",
            "2026-10-01T01:00:00Z",
        )
        .await;
    }
    db.set_run_artifacts_stored("stored", true).await.unwrap();
    db.set_run_artifacts_stored("lost", false).await.unwrap();
    let reclaimed = db.retention_run("reclaimed", None).await.unwrap().unwrap();
    assert!(
        db.mark_artifacts_reclaimed(&reclaimed, ReclaimReason::Failed, "2026-10-02T00:00:00Z")
            .await
            .unwrap()
    );

    let facts = db.publish_facts().await.unwrap();

    assert_eq!(
        sorted(facts.releasable.into_iter().collect()),
        ["stored", "unknown"]
    );
    assert_eq!(facts.jobs.len(), 4, "the jobs are all read");
}

#[tokio::test]
async fn only_a_queued_publish_job_is_withdrawn() {
    // The publish gate withdraws the job it enqueued when it finds the run's tree
    // was reclaimed in the same instant. A job the dispatcher already claimed is
    // not the gate's to remove.
    let db = db_with_runs(&["a", "b"]).await;
    seed_publish_job(&db, "queued", "a", "queued", "2026-10-01T01:00:00Z").await;
    seed_publish_job(&db, "claimed", "b", "dispatched", "2026-10-01T01:00:00Z").await;

    assert!(db.withdraw_queued_publish_job("queued").await.unwrap());
    assert!(!db.withdraw_queued_publish_job("claimed").await.unwrap());
    assert!(!db.withdraw_queued_publish_job("ghost").await.unwrap());

    assert!(db.get_publish_job("queued").await.unwrap().is_none());
    assert!(db.get_publish_job("claimed").await.unwrap().is_some());
    // Withdrawn, it leaves no failure to count or retry.
    let facts = db.publish_facts().await.unwrap();
    assert!(facts.jobs.iter().all(|job| job.run_id != "a"));
}

#[tokio::test]
async fn a_deleted_runs_publish_jobs_are_gone_from_the_facts() {
    let db = db_with_runs(&["a"]).await;
    seed_publish_job(&db, "p1", "a", "failed", "2026-10-01T01:00:00Z").await;
    // A job naming a run that does not exist: what a hand edit could leave.
    seed_publish_job(&db, "p2", "ghost", "failed", "2026-10-01T01:00:00Z").await;

    let facts = db.publish_facts().await.unwrap();

    assert_eq!(
        facts.jobs.iter().map(|job| &job.id).collect::<Vec<_>>(),
        ["p1"]
    );
}

// --- A publisher that never reported -----------------------------------------

#[tokio::test]
async fn a_publish_job_dispatched_for_over_an_hour_is_recorded_as_failed() {
    let db = db_with_runs(&["a", "b", "c"]).await;
    seed_publish_job(&db, "old", "a", "dispatched", "2026-10-01T01:00:00Z").await;
    seed_publish_job(&db, "fresh", "b", "dispatched", "2026-10-01T01:30:00Z").await;
    seed_publish_job(&db, "waiting", "c", "queued", "2026-09-01T00:00:00Z").await;

    // An hour and a second after `old` was dispatched.
    let failed = db
        .fail_abandoned_publish_jobs("2026-10-01T02:00:01Z")
        .await
        .unwrap();

    assert_eq!(
        failed.iter().map(|job| &job.id).collect::<Vec<_>>(),
        ["old"]
    );
    let old = db.get_publish_job("old").await.unwrap().unwrap();
    assert_eq!(old.state, "failed");
    assert_eq!(
        old.updated_at, "2026-10-01T02:00:00Z",
        "it failed when its hour ran out, not when the pass noticed"
    );
    assert_eq!(old.detail.as_deref(), Some(PUBLISHER_NEVER_REPORTED));
    assert_eq!(failed[0], old, "the returned job is the stored one");
    assert_eq!(
        db.get_publish_job("fresh").await.unwrap().unwrap().state,
        "dispatched"
    );
    assert_eq!(
        db.get_publish_job("waiting").await.unwrap().unwrap().state,
        "queued",
        "a queued job has no publisher yet, however long it has waited"
    );
}

#[tokio::test]
async fn exactly_an_hour_is_not_yet_abandoned() {
    let db = db_with_runs(&["a"]).await;
    seed_publish_job(&db, "p", "a", "dispatched", "2026-10-01T01:00:00Z").await;

    let failed = db
        .fail_abandoned_publish_jobs("2026-10-01T02:00:00Z")
        .await
        .unwrap();

    assert!(failed.is_empty());
}

#[tokio::test]
async fn a_dispatched_job_with_an_unreadable_instant_is_left_alone() {
    let db = db_with_runs(&["a"]).await;
    seed_publish_job(&db, "p", "a", "dispatched", "some time ago").await;

    let failed = db
        .fail_abandoned_publish_jobs("2026-10-01T02:00:00Z")
        .await
        .unwrap();

    assert!(failed.is_empty());
    let all = publish_job::Entity::find().all(&db.conn()).await.unwrap();
    assert_eq!(all[0].state, "dispatched");
}

#[tokio::test]
async fn a_job_abandoned_long_ago_fails_where_it_happened_not_at_the_pass() {
    // A database older than this rule: five publishers died months ago, and
    // publishing has worked since. The first pass must not turn them into five
    // fresh failures after that success, which would hold every new run.
    let runs = ["a", "b", "c", "d", "e", "ok"];
    let db = db_with_runs(&runs).await;
    for run in &runs[..5] {
        seed_publish_job(
            &db,
            &format!("p-{run}"),
            run,
            "dispatched",
            "2026-06-01T00:00:00Z",
        )
        .await;
    }
    seed_publish_job(&db, "p-ok", "ok", "succeeded", "2026-09-30T00:00:00Z").await;
    force_published(&db, "ok").await;

    let now = datetime!(2026-10-01 00:00:00 UTC);
    let failed = db
        .fail_abandoned_publish_jobs("2026-10-01T00:00:00Z")
        .await
        .unwrap();

    assert_eq!(failed.len(), 5);
    for job in &failed {
        assert_eq!(job.updated_at, "2026-06-01T01:00:00Z");
    }
    let facts = db.publish_facts().await.unwrap();
    let assessment = crate::publish_health::assess(&facts, 5, now);
    assert_eq!(
        assessment.hold, None,
        "failures from before the latest success hold nothing"
    );
    assert_eq!(assessment.failed_runs.len(), 5);
    assert!(
        assessment.failed_runs.iter().all(|run| !run.due(now)),
        "a publisher that died months ago is past its run's retries"
    );
}

// --- A run that is no longer publishable ---------------------------------------

#[tokio::test]
async fn a_run_that_stopped_being_publishable_is_not_releasable() {
    let db = db_with_runs(&["rated", "unreviewed", "superseded"]).await;
    seed_run(&db, "canceled", RunState::Canceled, ENDED).await;
    seed_run(&db, "infra", RunState::Infrastructure, ENDED).await;
    seed_run(&db, "crashed", RunState::Catastrophic, ENDED).await;
    // Completed, not rated by validators, with no review and no automated
    // verdicts: nothing lets it be published.
    set_validator_rated(&db, "unreviewed", false).await;
    // The attempt an automatic retry replaced.
    db.enqueue_job(crate::db::tests::new_job("j-old", ENDED))
        .await
        .unwrap();
    job::Entity::update_many()
        .col_expr(job::Column::RecordId, Expr::value("superseded"))
        .col_expr(job::Column::RetriedBy, Expr::value("j-new"))
        .filter(job::Column::Id.eq("j-old"))
        .exec(&db.conn())
        .await
        .unwrap();
    for run in [
        "rated",
        "unreviewed",
        "superseded",
        "canceled",
        "infra",
        "crashed",
    ] {
        seed_publish_job(
            &db,
            &format!("p-{run}"),
            run,
            "failed",
            "2026-10-01T01:00:00Z",
        )
        .await;
    }

    let facts = db.publish_facts().await.unwrap();

    assert_eq!(
        sorted(facts.releasable.into_iter().collect()),
        ["crashed", "rated"],
        "a validator-rated completed run and a publishable failure stay releasable"
    );
}
