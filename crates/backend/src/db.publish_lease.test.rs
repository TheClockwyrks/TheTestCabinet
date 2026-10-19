//! Publish-job leases, lost publishers and the abandonment sweep: the lease a publish
//! claim stores, the dispatcher's renewal, a lost report, and the sweep that records
//! a publish job `dispatched` for an hour as failed (the backend results page's "A
//! publisher that stops").

use super::tests::new_publish_job;
use super::*;

/// When each test's publish job is enqueued.
const ENQUEUED: &str = "2026-10-19T11:59:00Z";

/// When each test's publish job is claimed (its dispatch instant).
const T0: &str = "2026-10-19T12:00:00Z";

/// A database holding one publish job `p1` for run `r1`, enqueued at [`ENQUEUED`].
async fn queued() -> Db {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_publish_job(new_publish_job("p1", "r1", ENQUEUED))
        .await
        .unwrap();
    db
}

/// A database holding one publish job `p1` for run `r1`, claimed at [`T0`].
async fn dispatched() -> Db {
    let db = queued().await;
    db.claim_next_publish_job(T0).await.unwrap().unwrap();
    db
}

/// One publish job row, which must exist.
async fn row(db: &Db, id: &str) -> publish_job::Model {
    db.get_publish_job(id)
        .await
        .unwrap()
        .expect("the job exists")
}

#[tokio::test]
async fn an_enqueued_publish_job_holds_no_lease() {
    let db = queued().await;
    assert_eq!(row(&db, "p1").await.lease_expires_at, None);
}

#[tokio::test]
async fn a_publish_claim_stores_a_lease_two_minutes_out() {
    let db = queued().await;
    let claimed = db
        .claim_next_publish_job("2026-10-19T12:00:00.25Z")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(claimed.state, "dispatched");
    assert_eq!(
        claimed.lease_expires_at.as_deref(),
        Some("2026-10-19T12:02:00Z")
    );
    assert_eq!(
        row(&db, "p1").await.lease_expires_at.as_deref(),
        Some("2026-10-19T12:02:00Z")
    );
    assert!(db.claim_next_publish_job("not a time").await.is_err());
}

#[tokio::test]
async fn a_renewal_extends_a_dispatched_lease_and_leaves_the_dispatch_instant() {
    let db = dispatched().await;
    let renewed = db
        .renew_publish_leases(&["p1".to_string()], "2026-10-19T12:01:30Z")
        .await
        .unwrap();
    assert_eq!(renewed, 1);
    let job = row(&db, "p1").await;
    assert_eq!(
        job.lease_expires_at.as_deref(),
        Some("2026-10-19T12:03:30Z")
    );
    assert_eq!(job.updated_at, T0, "a renewal is not a state transition");
}

#[tokio::test]
async fn a_renewal_ignores_queued_terminal_and_unknown_jobs() {
    let db = queued().await;
    db.enqueue_publish_job(new_publish_job("p2", "r2", ENQUEUED))
        .await
        .unwrap();
    db.set_publish_job_state("p2", "failed", T0, Some("boom"))
        .await
        .unwrap();
    let renewed = db
        .renew_publish_leases(
            &["p1".to_string(), "p2".to_string(), "missing".to_string()],
            T0,
        )
        .await
        .unwrap();
    assert_eq!(renewed, 0);
    assert_eq!(row(&db, "p1").await.lease_expires_at, None);
    assert_eq!(row(&db, "p2").await.lease_expires_at, None);
    assert_eq!(db.renew_publish_leases(&[], T0).await.unwrap(), 0);
    assert!(db.renew_publish_leases(&[], "not a time").await.is_err());
}

#[tokio::test]
async fn active_publish_jobs_lists_queued_and_dispatched_oldest_first() {
    let db = dispatched().await;
    db.enqueue_publish_job(new_publish_job("p2", "r2", "2026-10-19T12:00:30Z"))
        .await
        .unwrap();
    db.enqueue_publish_job(new_publish_job("p3", "r3", "2026-10-19T12:00:40Z"))
        .await
        .unwrap();
    db.set_publish_job_state("p3", "succeeded", T0, None)
        .await
        .unwrap();
    let active: Vec<(String, String)> = db
        .active_publish_jobs()
        .await
        .unwrap()
        .into_iter()
        .map(|job| (job.id, job.state))
        .collect();
    assert_eq!(
        active,
        [
            ("p1".to_string(), "dispatched".to_string()),
            ("p2".to_string(), "queued".to_string()),
        ]
    );
}

#[tokio::test]
async fn a_lost_report_fails_a_dispatched_job_with_its_detail() {
    let db = dispatched().await;
    let lost = db
        .mark_publish_job_lost(
            "p1",
            "2026-10-19T12:03:00Z",
            "the publisher's Job no longer exists",
        )
        .await
        .unwrap()
        .expect("a dispatched job is failed");
    assert_eq!(lost.state, "failed");
    assert_eq!(
        lost.detail.as_deref(),
        Some("the publisher's Job no longer exists")
    );
    assert_eq!(lost.updated_at, "2026-10-19T12:03:00Z");
    assert_eq!(lost.lease_expires_at, None);
    assert!(db.active_publish_job_for_run("r1").await.unwrap().is_none());
}

#[tokio::test]
async fn a_lost_report_on_a_job_not_dispatched_is_ignored() {
    let db = queued().await;
    assert!(
        db.mark_publish_job_lost("p1", T0, "lost")
            .await
            .unwrap()
            .is_none()
    );
    let job = row(&db, "p1").await;
    assert_eq!(job.state, "queued");
    assert_eq!(job.detail, None);

    db.claim_next_publish_job(T0).await.unwrap().unwrap();
    db.set_publish_job_state("p1", "succeeded", "2026-10-19T12:01:00Z", None)
        .await
        .unwrap();
    assert!(
        db.mark_publish_job_lost("p1", "2026-10-19T12:03:00Z", "lost")
            .await
            .unwrap()
            .is_none()
    );
    let job = row(&db, "p1").await;
    assert_eq!(job.state, "succeeded");
    assert_eq!(job.updated_at, "2026-10-19T12:01:00Z");
    assert_eq!(job.detail, None);

    assert!(
        db.mark_publish_job_lost("missing", T0, "lost")
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn the_sweep_leaves_a_job_dispatched_under_an_hour() {
    let db = dispatched().await;
    // Renewals do not move the dispatch instant the hour is measured from.
    db.renew_publish_leases(&["p1".to_string()], "2026-10-19T12:59:00Z")
        .await
        .unwrap();
    let swept = db
        .fail_abandoned_publish_jobs("2026-10-19T12:59:59.999Z")
        .await
        .unwrap();
    assert!(swept.is_empty());
    assert_eq!(row(&db, "p1").await.state, "dispatched");
}

#[tokio::test]
async fn the_sweep_records_an_abandoned_job_failed_at_its_hour() {
    let db = dispatched().await;
    db.renew_publish_leases(&["p1".to_string()], "2026-10-19T12:30:00Z")
        .await
        .unwrap();
    // Swept long after the hour, the failure is still dated at the hour.
    let swept = db
        .fail_abandoned_publish_jobs("2026-10-19T17:45:12Z")
        .await
        .unwrap();
    assert_eq!(swept.len(), 1);
    let job = &swept[0];
    assert_eq!(job.id, "p1");
    assert_eq!(job.state, "failed");
    assert_eq!(job.detail.as_deref(), Some(PUBLISHER_NEVER_REPORTED));
    assert_eq!(job.updated_at, "2026-10-19T13:00:00Z");
    assert_eq!(job.lease_expires_at, None);
    assert_eq!(&row(&db, "p1").await, job);

    // A second pass finds nothing left to sweep.
    assert!(
        db.fail_abandoned_publish_jobs("2026-10-19T18:00:00Z")
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn the_sweep_fails_a_job_at_exactly_its_hour_and_never_a_queued_one() {
    let db = dispatched().await;
    db.enqueue_publish_job(new_publish_job("p2", "r2", "2026-10-19T09:00:00Z"))
        .await
        .unwrap();
    let swept: Vec<String> = db
        .fail_abandoned_publish_jobs("2026-10-19T13:00:00Z")
        .await
        .unwrap()
        .into_iter()
        .map(|job| job.id)
        .collect();
    assert_eq!(swept, ["p1"]);
    assert_eq!(row(&db, "p2").await.state, "queued");
    assert!(db.fail_abandoned_publish_jobs("not a time").await.is_err());
}

#[tokio::test]
async fn the_per_run_sweep_touches_only_that_run() {
    let db = dispatched().await;
    db.enqueue_publish_job(new_publish_job("p2", "r2", "2026-10-19T12:00:01Z"))
        .await
        .unwrap();
    db.claim_next_publish_job(T0).await.unwrap().unwrap();
    let swept = db
        .fail_abandoned_publish_jobs_for_run("r2", "2026-10-19T14:00:00Z")
        .await
        .unwrap();
    assert_eq!(swept.len(), 1);
    assert_eq!(swept[0].id, "p2");
    assert_eq!(row(&db, "p1").await.state, "dispatched");
}

#[tokio::test]
async fn an_enqueue_attaches_to_a_live_dispatched_job() {
    let db = dispatched().await;
    let outcome = db
        .enqueue_publish_job_once("r1", "2026-10-19T12:59:59Z")
        .await
        .unwrap();
    assert_eq!(outcome, PublishEnqueue::Attached("p1".to_string()));
}

#[tokio::test]
async fn an_enqueue_after_an_abandoned_job_leaves_one_live_job() {
    let db = dispatched().await;
    let outcome = db
        .enqueue_publish_job_once("r1", "2026-10-19T13:30:00Z")
        .await
        .unwrap();
    let PublishEnqueue::Enqueued(new_id) = outcome else {
        panic!("an abandoned job is swept, not attached to: {outcome:?}");
    };
    let abandoned = row(&db, "p1").await;
    assert_eq!(abandoned.state, "failed");
    assert_eq!(abandoned.updated_at, "2026-10-19T13:00:00Z");
    assert_eq!(abandoned.detail.as_deref(), Some(PUBLISHER_NEVER_REPORTED));

    let live: Vec<String> = db
        .active_publish_jobs()
        .await
        .unwrap()
        .into_iter()
        .filter(|job| job.run_id == "r1")
        .map(|job| job.id)
        .collect();
    assert_eq!(live, [new_id]);
}
