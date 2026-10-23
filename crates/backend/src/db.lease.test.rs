//! Claim leases: the lease a claim stores, the dispatcher's renewal, and the claim
//! pass returning a lapsed `dispatched` job to the queue (the dispatcher overview's
//! "Claim leases", the backend API's "Leases and lost jobs").

use sea_orm::EntityTrait;
use test_cabinet_entities::job;

use super::tests::new_job;
use super::*;

/// When the first claim of each test is made.
const T0: &str = "2026-10-19T12:00:00Z";

/// Every job row, in queue order.
async fn all_jobs(db: &Db) -> Vec<job::Model> {
    use sea_orm::QueryOrder;
    job::Entity::find()
        .order_by_asc(job::Column::QueueSeq)
        .all(&db.connection())
        .await
        .unwrap()
}

/// One job row, which must exist.
async fn job_row(db: &Db, id: &str) -> job::Model {
    db.get_job(id).await.unwrap().expect("the job exists")
}

/// A database holding the given jobs, enqueued in order before [`T0`].
async fn queue(ids: &[&str]) -> Db {
    let db = Db::connect_in_memory().await.unwrap();
    for id in ids {
        db.enqueue_job(new_job(id, "2026-10-19T11:00:00Z"))
            .await
            .unwrap();
    }
    db
}

#[test]
fn a_lease_expiry_is_two_minutes_out_at_whole_seconds_in_utc() {
    assert_eq!(job_lease_expiry(T0).unwrap(), "2026-10-19T12:02:00Z");
    assert_eq!(
        job_lease_expiry("2026-10-19T12:00:00.987654321Z").unwrap(),
        "2026-10-19T12:02:00Z"
    );
    assert_eq!(
        job_lease_expiry("2026-10-19T14:00:00.5+02:00").unwrap(),
        "2026-10-19T12:02:00Z"
    );
    assert!(job_lease_expiry("not a time").is_err());
}

#[test]
fn a_lease_lapses_chronologically_whatever_either_sides_precision() {
    let at = |s: &str| OffsetDateTime::parse(s, &Rfc3339).unwrap();
    assert!(lease_lapsed(None, at(T0)));
    assert!(lease_lapsed(Some("garbage"), at(T0)));
    assert!(lease_lapsed(
        Some("2026-10-19T12:02:00Z"),
        at("2026-10-19T12:02:00.9Z")
    ));
    assert!(!lease_lapsed(
        Some("2026-10-19T12:02:00Z"),
        at("2026-10-19T12:01:59.999Z")
    ));
    assert!(!lease_lapsed(
        Some("2026-10-19T12:02:00Z"),
        at("2026-10-19T12:02:00Z")
    ));
    // As strings `…00.5Z` sorts before `…00Z`; as instants the lease is still live.
    assert!(!lease_lapsed(
        Some("2026-10-19T12:02:00.5Z"),
        at("2026-10-19T12:02:00Z")
    ));
}

#[tokio::test]
async fn a_claim_stores_a_lease_two_minutes_out() {
    let db = queue(&["j1"]).await;
    assert_eq!(job_row(&db, "j1").await.lease_expires_at, None);

    let claimed = db
        .claim_next_job("2026-10-19T12:00:00.25Z")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(claimed.id, "j1");
    assert_eq!(
        claimed.lease_expires_at.as_deref(),
        Some("2026-10-19T12:02:00Z")
    );
    assert_eq!(
        job_row(&db, "j1").await.lease_expires_at.as_deref(),
        Some("2026-10-19T12:02:00Z")
    );
}

#[tokio::test]
async fn a_claim_refuses_a_now_that_is_not_an_instant() {
    let db = queue(&["j1"]).await;
    assert!(db.claim_next("yesterday").await.is_err());
    assert_eq!(job_row(&db, "j1").await.state, "queued");
}

#[tokio::test]
async fn a_live_claim_stays_dispatched() {
    let db = queue(&["j1", "j2"]).await;
    db.claim_next_job(T0).await.unwrap().unwrap();

    let next = db.claim_next("2026-10-19T12:01:59Z").await.unwrap();
    assert_eq!(next.claimed.unwrap().id, "j2");
    assert!(next.reconciled.is_empty());
    let j1 = job_row(&db, "j1").await;
    assert_eq!(j1.state, "dispatched");
    assert_eq!(j1.job_token, "token-j1");
    assert_eq!(j1.lease_expires_at.as_deref(), Some("2026-10-19T12:02:00Z"));
}

#[tokio::test]
async fn a_lapsed_claim_is_taken_again_at_its_position_with_a_fresh_token() {
    let db = queue(&["j1", "j2"]).await;
    db.set_harness_max_parallelism("claude", Some(1), T0)
        .await
        .unwrap();
    let first = db.claim_next_job(T0).await.unwrap().unwrap();
    assert_eq!(first.id, "j1");
    // Enqueued after j1 was claimed, so it sits behind both.
    db.enqueue_job(new_job("j3", "2026-10-19T12:00:30Z"))
        .await
        .unwrap();

    // While j1's lease runs, its slot is taken and nothing else is claimable.
    let held = db.claim_next("2026-10-19T12:01:00Z").await.unwrap();
    assert!(held.claimed.is_none());

    // Once it lapses, the pass returns j1 to the queue, which frees the slot, and
    // takes it again ahead of the jobs behind it.
    let outcome = db.claim_next("2026-10-19T12:03:00Z").await.unwrap();
    let again = outcome.claimed.expect("the lapsed claim is taken again");
    assert_eq!(again.id, "j1");
    assert_eq!(again.state, "dispatched");
    assert_eq!(again.queue_seq, first.queue_seq);
    assert_eq!(again.attempt, first.attempt);
    assert_eq!(again.retried_by, None);
    assert_ne!(again.job_token, first.job_token);
    assert!(!again.job_token.is_empty());
    assert_eq!(
        again.lease_expires_at.as_deref(),
        Some("2026-10-19T12:05:00Z")
    );
    assert_eq!(again.lost_at, None);
    // The claim announces j1; the reconciliation reports only the jobs it moved.
    assert!(outcome.reconciled.iter().all(|job| job.id != "j1"));

    // Nothing was retried or added: the same three jobs, two still waiting.
    let rows = all_jobs(&db).await;
    let ids: Vec<&str> = rows.iter().map(|job| job.id.as_str()).collect();
    assert_eq!(ids, ["j1", "j2", "j3"]);
    assert!(rows[1..].iter().all(|job| job.state == "pending"));
}

#[tokio::test]
async fn a_lapsed_claim_held_back_is_reported_once_in_its_end_state() {
    let db = queue(&["j1"]).await;
    let first = db.claim_next_job(T0).await.unwrap().unwrap();
    // The harness's cap drops to nothing, so the returned job is held back.
    db.set_harness_max_parallelism("claude", Some(0), T0)
        .await
        .unwrap();

    let outcome = db.claim_next("2026-10-19T12:02:01Z").await.unwrap();
    assert!(outcome.claimed.is_none());
    assert_eq!(outcome.reconciled.len(), 1);
    let requeued = &outcome.reconciled[0];
    assert_eq!(requeued.id, "j1");
    assert_eq!(requeued.state, "pending");
    assert_eq!(requeued.lease_expires_at, None);
    assert_ne!(requeued.job_token, first.job_token);
    assert_eq!(requeued.updated_at, "2026-10-19T12:02:01Z");
}

#[tokio::test]
async fn a_lapsed_claim_behind_the_claimed_job_is_announced_as_queued() {
    let db = Db::connect_in_memory().await.unwrap();
    // j0 is ahead of j1 but held back at the first claim, so j1 is the one claimed.
    db.set_harness_max_parallelism("codex", Some(0), T0)
        .await
        .unwrap();
    db.enqueue_job(NewJob {
        harness_slug: "codex".to_string(),
        ..new_job("j0", "2026-10-19T11:00:00Z")
    })
    .await
    .unwrap();
    db.enqueue_job(new_job("j1", "2026-10-19T11:00:00Z"))
        .await
        .unwrap();
    assert_eq!(db.claim_next_job(T0).await.unwrap().unwrap().id, "j1");

    // j0's harness frees up and j1's lease lapses: j0 is claimed, and j1 is back in
    // the queue behind it.
    db.set_harness_max_parallelism("codex", None, T0)
        .await
        .unwrap();
    let outcome = db.claim_next("2026-10-19T12:02:01Z").await.unwrap();
    assert_eq!(outcome.claimed.unwrap().id, "j0");
    let moved: Vec<(&str, &str)> = outcome
        .reconciled
        .iter()
        .map(|job| (job.id.as_str(), job.state.as_str()))
        .collect();
    assert_eq!(moved, [("j1", "queued")]);
    assert_eq!(job_row(&db, "j1").await.lease_expires_at, None);
}

#[tokio::test]
async fn a_dispatched_job_holding_no_lease_is_returned_to_the_queue() {
    // A row in flight before leases existed, or one moved to `dispatched` by hand.
    let db = queue(&["j1"]).await;
    db.set_job_state("j1", "dispatched", T0, None, None)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(job_row(&db, "j1").await.lease_expires_at, None);

    let again = db
        .claim_next_job("2026-10-19T12:00:01Z")
        .await
        .unwrap()
        .expect("the lease-less claim is taken again");
    assert_eq!(again.id, "j1");
    assert_ne!(again.job_token, "token-j1");
    assert_eq!(
        again.lease_expires_at.as_deref(),
        Some("2026-10-19T12:02:01Z")
    );
}

#[tokio::test]
async fn a_lapsed_lease_past_dispatched_is_left_for_the_dispatcher() {
    let db = queue(&["j1", "j2", "j3"]).await;
    for (id, to) in [("j1", "starting"), ("j2", "running"), ("j3", "storing")] {
        let claimed = db.claim_next_job(T0).await.unwrap().unwrap();
        assert_eq!(claimed.id, id);
        db.set_job_state(id, to, T0, None, None)
            .await
            .unwrap()
            .unwrap();
    }

    let outcome = db.claim_next("2026-10-19T13:00:00Z").await.unwrap();
    assert!(outcome.claimed.is_none());
    assert!(outcome.reconciled.is_empty());
    for (id, state) in [("j1", "starting"), ("j2", "running"), ("j3", "storing")] {
        let row = job_row(&db, id).await;
        assert_eq!(row.state, state);
        assert_eq!(row.job_token, format!("token-{id}"));
        assert_eq!(
            row.lease_expires_at.as_deref(),
            Some("2026-10-19T12:02:00Z")
        );
    }
}

#[tokio::test]
async fn a_renewal_extends_only_the_driven_jobs_it_names() {
    let db = queue(&["j1", "j2", "j3", "j4", "j5"]).await;
    for _ in 0..4 {
        db.claim_next_job(T0).await.unwrap().unwrap();
    }
    db.set_job_state("j2", "running", T0, None, None)
        .await
        .unwrap()
        .unwrap();
    db.set_job_state("j3", "failed", T0, Some("gone"), None)
        .await
        .unwrap()
        .unwrap();

    let ids: Vec<String> = ["j1", "j2", "j3", "j5", "nope"]
        .iter()
        .map(ToString::to_string)
        .collect();
    let renewed = db
        .renew_job_leases(&ids, "2026-10-19T12:01:30.4Z")
        .await
        .unwrap();
    assert_eq!(renewed, 2);

    let lease = |id: &'static str| {
        let db = &db;
        async move { job_row(db, id).await.lease_expires_at }
    };
    assert_eq!(lease("j1").await.as_deref(), Some("2026-10-19T12:03:30Z"));
    assert_eq!(lease("j2").await.as_deref(), Some("2026-10-19T12:03:30Z"));
    // Terminal: not driven, so its old lease is left as it was.
    assert_eq!(lease("j3").await.as_deref(), Some("2026-10-19T12:02:00Z"));
    // Driven but not named.
    assert_eq!(lease("j4").await.as_deref(), Some("2026-10-19T12:02:00Z"));
    // Still queued: holds no lease.
    assert_eq!(lease("j5").await, None);

    // A renewed claim is not lapsed when its first lease would have been; j4's
    // lapsed unrenewed, so it went back to the queue and, ahead of j5, is taken again.
    let outcome = db.claim_next("2026-10-19T12:03:00Z").await.unwrap();
    let again = outcome.claimed.unwrap();
    assert_eq!(again.id, "j4");
    assert_ne!(again.job_token, "token-j4");
    let j1 = job_row(&db, "j1").await;
    assert_eq!(j1.state, "dispatched");
    assert_eq!(j1.job_token, "token-j1");
    assert_eq!(job_row(&db, "j5").await.state, "queued");
}

#[tokio::test]
async fn a_renewal_of_nothing_changes_nothing() {
    let db = queue(&["j1"]).await;
    assert_eq!(db.renew_job_leases(&[], T0).await.unwrap(), 0);
    assert!(db.renew_job_leases(&[], "never").await.is_err());
}
