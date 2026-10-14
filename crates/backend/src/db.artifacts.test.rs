//! Tests for a run's recorded artifact presence: the single-run write, the
//! reconciliation against the artifact service's listing, and the rule that a push
//! never moves it.

use std::collections::HashSet;

use crate::db::Db;
use crate::db::tests::{links, record};

/// A store holding one pushed run per id, each with its presence unknown.
async fn db_with(ids: &[&str]) -> Db {
    let db = Db::connect_in_memory().await.unwrap();
    for id in ids {
        db.push(&record(id), &links(), None, None).await.unwrap();
    }
    db
}

fn ids(ids: &[&str]) -> HashSet<String> {
    ids.iter().map(|id| id.to_string()).collect()
}

#[tokio::test]
async fn a_pushed_run_starts_with_its_presence_unknown() {
    let db = db_with(&["r1"]).await;
    assert_eq!(db.run_artifacts_stored("r1").await.unwrap(), None);
}

#[tokio::test]
async fn the_recorded_presence_is_written_and_reports_whether_it_changed() {
    let db = db_with(&["r1"]).await;

    assert!(db.set_run_artifacts_stored("r1", false).await.unwrap());
    assert_eq!(db.run_artifacts_stored("r1").await.unwrap(), Some(false));
    // Recording the same value again changes nothing.
    assert!(!db.set_run_artifacts_stored("r1", false).await.unwrap());

    assert!(db.set_run_artifacts_stored("r1", true).await.unwrap());
    assert_eq!(db.run_artifacts_stored("r1").await.unwrap(), Some(true));

    // A run that does not exist is neither written nor invented.
    assert!(!db.set_run_artifacts_stored("ghost", true).await.unwrap());
    assert_eq!(db.run_artifacts_stored("ghost").await.unwrap(), None);
}

#[tokio::test]
async fn a_push_never_moves_the_recorded_presence() {
    // A terminal report stores its record again, and a re-push of a stored run does
    // too. Neither says anything about the tree.
    let db = db_with(&["r1"]).await;
    db.set_run_artifacts_stored("r1", false).await.unwrap();

    db.push(&record("r1"), &links(), None, None).await.unwrap();

    assert_eq!(db.run_artifacts_stored("r1").await.unwrap(), Some(false));
}

#[tokio::test]
async fn reconciliation_marks_listed_runs_stored_and_the_rest_not_stored() {
    let db = db_with(&["kept", "lost", "also-lost"]).await;

    let outcome = db
        .reconcile_artifacts_stored(
            &ids(&["kept", "lost", "also-lost"]),
            &ids(&["kept", "an-orphan-with-no-run"]),
        )
        .await
        .unwrap();

    assert_eq!(outcome.marked_stored, 1);
    assert_eq!(outcome.marked_not_stored, 2);
    assert_eq!(db.run_artifacts_stored("kept").await.unwrap(), Some(true));
    assert_eq!(db.run_artifacts_stored("lost").await.unwrap(), Some(false));
    assert_eq!(
        db.run_artifacts_stored("also-lost").await.unwrap(),
        Some(false)
    );
}

#[tokio::test]
async fn reconciliation_unmarks_a_run_whose_tree_has_appeared() {
    // A run recorded as not stored whose tree is later listed, as after a restored
    // volume, is recorded as stored again; and one recorded stored whose tree has
    // gone is recorded as not stored.
    let db = db_with(&["back", "gone"]).await;
    db.set_run_artifacts_stored("back", false).await.unwrap();
    db.set_run_artifacts_stored("gone", true).await.unwrap();

    let outcome = db
        .reconcile_artifacts_stored(&ids(&["back", "gone"]), &ids(&["back"]))
        .await
        .unwrap();

    assert_eq!(outcome.marked_stored, 1);
    assert_eq!(outcome.marked_not_stored, 1);
    assert_eq!(db.run_artifacts_stored("back").await.unwrap(), Some(true));
    assert_eq!(db.run_artifacts_stored("gone").await.unwrap(), Some(false));
}

#[tokio::test]
async fn reconciliation_leaves_a_run_it_was_not_given_unknown() {
    // `landed-late` has a row, but it was not in the run-id set the pass read: it
    // landed between that read and the listing. Its tree may be in the listing or
    // not; either way the pass has no standing to decide.
    let db = db_with(&["known", "landed-late"]).await;

    db.reconcile_artifacts_stored(&ids(&["known"]), &ids(&[]))
        .await
        .unwrap();

    assert_eq!(db.run_artifacts_stored("known").await.unwrap(), Some(false));
    assert_eq!(db.run_artifacts_stored("landed-late").await.unwrap(), None);
}

#[tokio::test]
async fn a_reconciliation_that_agrees_with_the_record_writes_nothing() {
    let db = db_with(&["kept", "lost"]).await;
    let runs = ids(&["kept", "lost"]);
    let listed = ids(&["kept"]);
    db.reconcile_artifacts_stored(&runs, &listed).await.unwrap();

    let again = db.reconcile_artifacts_stored(&runs, &listed).await.unwrap();

    assert_eq!(again, super::ArtifactReconciliation::default());
}

#[tokio::test]
async fn reconciliation_covers_more_runs_than_one_statement_names() {
    let names: Vec<String> = (0..super::RECONCILE_CHUNK + 7)
        .map(|n| format!("run-{n:04}"))
        .collect();
    let db = Db::connect_in_memory().await.unwrap();
    for id in &names {
        db.push(&record(id), &links(), None, None).await.unwrap();
    }
    let runs: HashSet<String> = names.iter().cloned().collect();

    let outcome = db
        .reconcile_artifacts_stored(&runs, &HashSet::new())
        .await
        .unwrap();

    assert_eq!(outcome.marked_not_stored, names.len() as u64);
    assert_eq!(
        db.run_artifacts_stored(names.last().unwrap())
            .await
            .unwrap(),
        Some(false)
    );
}

/// Run `id`'s mutation timestamp.
async fn updated_at(db: &Db, id: &str) -> String {
    use sea_orm::EntityTrait;
    test_cabinet_entities::run::Entity::find_by_id(id.to_string())
        .one(&db.conn())
        .await
        .unwrap()
        .unwrap()
        .updated_at
}

#[tokio::test]
async fn reconciling_an_unknown_run_to_stored_leaves_its_mutation_timestamp() {
    // The first pass over an existing cabinet moves every run from unknown, and
    // nothing a console shows changes for the ones whose tree is there.
    let db = db_with(&["kept", "lost"]).await;
    let (kept_before, lost_before) = (updated_at(&db, "kept").await, updated_at(&db, "lost").await);

    let outcome = db
        .reconcile_artifacts_stored(&ids(&["kept", "lost"]), &ids(&["kept"]))
        .await
        .unwrap();

    assert_eq!(outcome.marked_stored, 1);
    assert_eq!(outcome.marked_not_stored, 1);
    assert_eq!(updated_at(&db, "kept").await, kept_before);
    assert_ne!(
        updated_at(&db, "lost").await,
        lost_before,
        "a run found to have no tree is a change a console shows"
    );
}

#[tokio::test]
async fn reconciling_a_lost_run_to_stored_stamps_it() {
    let db = db_with(&["r1"]).await;
    db.reconcile_artifacts_stored(&ids(&["r1"]), &ids(&[]))
        .await
        .unwrap();
    let before = updated_at(&db, "r1").await;

    let outcome = db
        .reconcile_artifacts_stored(&ids(&["r1"]), &ids(&["r1"]))
        .await
        .unwrap();

    assert_eq!(outcome.marked_stored, 1);
    assert_ne!(updated_at(&db, "r1").await, before);
}

#[tokio::test]
async fn a_deferred_run_is_settled_once_it_has_a_publish_job_or_is_published() {
    let db = db_with(&["waiting", "queued", "untouched"]).await;
    // Validator-rated, which is what lets it be published with no review.
    db.push(
        &crate::db::tests::validator_record("public", &[("serve", true)]),
        &links(),
        None,
        Some(&crate::db::tests::validator_manifest()),
    )
    .await
    .unwrap();
    let deferred: Vec<String> = ["waiting", "queued", "public"].map(String::from).to_vec();
    db.defer_auto_publish(&deferred).await.unwrap();
    let mut listed = db.auto_publish_deferred_runs().await.unwrap();
    listed.sort();
    assert_eq!(listed, ["public", "queued", "waiting"]);

    db.enqueue_publish_job_once("queued", "2026-10-12T00:00:00Z")
        .await
        .unwrap();
    db.publish("public", "2026-10-12T00:00:00Z").await.unwrap();

    assert_eq!(db.settle_auto_publish_deferred(&deferred).await.unwrap(), 2);
    assert_eq!(db.auto_publish_deferred_runs().await.unwrap(), ["waiting"]);
    // Settling again changes nothing.
    assert_eq!(db.settle_auto_publish_deferred(&deferred).await.unwrap(), 0);
}
