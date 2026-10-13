//! Tests for the state reclaim record and for what an upload does to it and to a
//! run's media confirmation.

use test_cabinet_core::run_record::RunState;

use super::retention::ReclaimReason;
use super::retention_tests::{
    BUCKET, FIRST, confirmed_media, force_published, run_row, seed_run, set_media_confirmed,
};
use super::*;

const ENDED: &str = "2026-06-17T21:30:00Z";
const AT: &str = "2026-07-03T00:00:00Z";

/// A published run confirmed in [`BUCKET`] with a manifest, as a refresh records
/// one.
async fn confirmed(db: &Db, id: &str) {
    seed_run(db, id, RunState::Completed, ENDED).await;
    force_published(db, id).await;
    let states = db.published_media_states(BUCKET).await.unwrap();
    let states = states.into_iter().filter(|state| state.id == id).collect();
    let recorded = db
        .record_media_confirmation(&confirmed_media(states), &[], FIRST, BUCKET)
        .await
        .unwrap();
    assert_eq!(recorded.confirmed, 1);
}

async fn seen(db: &Db, id: &str) -> RetentionRun {
    db.retention_run(id, Some(BUCKET)).await.unwrap().unwrap()
}

#[tokio::test]
async fn the_record_is_written_for_the_run_as_it_was_seen() {
    let db = Db::connect_in_memory().await.unwrap();
    confirmed(&db, "r1").await;
    let before = run_row(&db, "r1").await.updated_at;
    let run = seen(&db, "r1").await;
    assert_eq!(run.state_reclaimed_at, None);

    assert!(
        db.mark_state_reclaimed(&run, ReclaimReason::Published, AT)
            .await
            .unwrap()
    );

    let row = run_row(&db, "r1").await;
    assert_eq!(row.state_reclaimed_at.as_deref(), Some(AT));
    assert_eq!(row.state_reclaimed_reason.as_deref(), Some("published"));
    // Nothing a console shows changed.
    assert_eq!(row.updated_at, before);
    let again = seen(&db, "r1").await;
    assert_eq!(again.state_reclaimed_at.as_deref(), Some(AT));
    assert_eq!(again.state_reclaimed_reason.as_deref(), Some("published"));
}

#[tokio::test]
async fn a_run_that_changed_since_it_was_seen_is_not_recorded() {
    let db = Db::connect_in_memory().await.unwrap();

    // Its confirmation replaced by a later refresh's.
    confirmed(&db, "replaced").await;
    let run = seen(&db, "replaced").await;
    set_media_confirmed(&db, "replaced", Some("2026-07-02T00:00:00Z")).await;
    // Its confirmation withdrawn.
    confirmed(&db, "withdrawn").await;
    let withdrawn = seen(&db, "withdrawn").await;
    db.record_media_confirmation(&[], &["withdrawn".to_string()], AT, BUCKET)
        .await
        .unwrap();
    // Seen with no confirmation at all.
    seed_run(&db, "unconfirmed", RunState::Completed, ENDED).await;
    force_published(&db, "unconfirmed").await;
    let unconfirmed = seen(&db, "unconfirmed").await;
    // A failed run that was published since.
    seed_run(&db, "published", RunState::TimedOut, ENDED).await;
    let published = seen(&db, "published").await;
    force_published(&db, "published").await;

    for (run, reason) in [
        (&run, ReclaimReason::Published),
        (&withdrawn, ReclaimReason::Published),
        (&unconfirmed, ReclaimReason::Published),
        (&published, ReclaimReason::Failed),
    ] {
        assert!(
            !db.mark_state_reclaimed(run, reason, AT).await.unwrap(),
            "{}",
            run.id
        );
        assert_eq!(
            run_row(&db, &run.id).await.state_reclaimed_at,
            None,
            "{}",
            run.id
        );
    }
}

#[tokio::test]
async fn a_restore_puts_back_what_the_run_held_and_only_under_its_own_mark() {
    let db = Db::connect_in_memory().await.unwrap();
    seed_run(&db, "r1", RunState::TimedOut, ENDED).await;
    let fresh = seen(&db, "r1").await;
    db.mark_state_reclaimed(&fresh, ReclaimReason::Failed, FIRST)
        .await
        .unwrap();
    let marked = seen(&db, "r1").await;
    db.mark_state_reclaimed(&marked, ReclaimReason::Failed, AT)
        .await
        .unwrap();

    // A restore naming another mark writes nothing.
    assert!(
        !db.restore_state_record(&marked, "2026-07-09T00:00:00Z")
            .await
            .unwrap()
    );
    assert_eq!(
        run_row(&db, "r1").await.state_reclaimed_at.as_deref(),
        Some(AT)
    );

    assert!(db.restore_state_record(&marked, AT).await.unwrap());
    let row = run_row(&db, "r1").await;
    assert_eq!(row.state_reclaimed_at.as_deref(), Some(FIRST));
    assert_eq!(row.state_reclaimed_reason.as_deref(), Some("failed"));

    // And a run that had no record goes back to none.
    db.mark_state_reclaimed(&fresh, ReclaimReason::Failed, AT)
        .await
        .unwrap();
    assert!(db.restore_state_record(&fresh, AT).await.unwrap());
    let row = run_row(&db, "r1").await;
    assert_eq!(row.state_reclaimed_at, None);
    assert_eq!(row.state_reclaimed_reason, None);
}

#[tokio::test]
async fn a_first_upload_writes_nothing() {
    let db = Db::connect_in_memory().await.unwrap();
    seed_run(&db, "r1", RunState::Completed, ENDED).await;
    let before = run_row(&db, "r1").await;

    assert_eq!(
        db.note_run_file_uploaded("r1").await.unwrap(),
        UploadedOver::Nothing
    );
    // A driver mirrors a run before it reports it.
    assert_eq!(
        db.note_run_file_uploaded("not-reported-yet").await.unwrap(),
        UploadedOver::Nothing
    );

    assert_eq!(run_row(&db, "r1").await, before);
}

#[tokio::test]
async fn an_upload_over_a_reclaim_clears_the_record() {
    let db = Db::connect_in_memory().await.unwrap();
    seed_run(&db, "r1", RunState::TimedOut, ENDED).await;
    let run = seen(&db, "r1").await;
    db.mark_state_reclaimed(&run, ReclaimReason::Failed, AT)
        .await
        .unwrap();

    assert_eq!(
        db.note_run_file_uploaded("r1").await.unwrap(),
        UploadedOver::Reclaim
    );

    let row = run_row(&db, "r1").await;
    assert_eq!(row.state_reclaimed_at, None);
    assert_eq!(row.state_reclaimed_reason, None);
    assert_eq!(
        db.note_run_file_uploaded("r1").await.unwrap(),
        UploadedOver::Nothing
    );
}

#[tokio::test]
async fn an_upload_over_a_confirmation_leaves_the_run_unevaluated() {
    let db = Db::connect_in_memory().await.unwrap();
    confirmed(&db, "r1").await;
    let run = seen(&db, "r1").await;
    db.mark_state_reclaimed(&run, ReclaimReason::Published, AT)
        .await
        .unwrap();
    assert_eq!(db.published_runs_unchecked(BUCKET).await.unwrap(), 0);
    // A refresh reads the run, and the upload lands while it builds.
    let read_before = db.published_media_states(BUCKET).await.unwrap();
    let before = run_row(&db, "r1").await.updated_at;

    assert_eq!(
        db.note_run_file_uploaded("r1").await.unwrap(),
        UploadedOver::Confirmation
    );

    let row = run_row(&db, "r1").await;
    assert_eq!(row.media_confirmed_at, None);
    assert_eq!(row.media_checked_at, None);
    assert_eq!(row.media_confirmation_version, None);
    assert_eq!(row.state_reclaimed_at, None);
    assert_eq!(row.state_reclaimed_reason, None);
    assert!(row.published, "the run stays published");
    assert_ne!(row.updated_at, before);
    // The run is one a start requests a refresh for, and one no sweep reclaims.
    assert_eq!(db.published_runs_unchecked(BUCKET).await.unwrap(), 1);
    assert_eq!(seen(&db, "r1").await.media_confirmed_at, None);
    assert_eq!(
        db.run_media_manifest("r1", Some(BUCKET)).await.unwrap(),
        None
    );
    // The run's files were removed from the store, so the manifest is the only
    // record of where they are. The upload must not take it from the routes.
    assert!(
        db.run_file_locations("r1", Some(BUCKET))
            .await
            .unwrap()
            .is_some()
    );

    // The refresh that read the run as confirmed before the upload writes
    // nothing for it, so the run stays unevaluated for the next one.
    let recorded = db
        .record_media_confirmation(&confirmed_media(read_before), &[], AT, BUCKET)
        .await
        .unwrap();
    assert_eq!(recorded.confirmed, 0);
    assert_eq!(run_row(&db, "r1").await.media_confirmed_at, None);
}

#[tokio::test]
async fn an_upload_for_a_published_run_stops_a_refresh_in_flight_confirming_it() {
    let db = Db::connect_in_memory().await.unwrap();
    seed_run(&db, "r1", RunState::Completed, ENDED).await;
    force_published(&db, "r1").await;
    // A refresh reads the run, lists its files, and the upload lands while it
    // builds.
    let read_before = db.published_media_states(BUCKET).await.unwrap();

    assert_eq!(
        db.note_run_file_uploaded("r1").await.unwrap(),
        UploadedOver::Pending
    );

    // The manifest the refresh built does not name the uploaded file, and is not
    // recorded: the run changed under it.
    let recorded = db
        .record_media_confirmation(&confirmed_media(read_before), &[], AT, BUCKET)
        .await
        .unwrap();
    assert_eq!(recorded.confirmed, 0);
    assert_eq!(recorded.changed, 1);
    assert_eq!(run_row(&db, "r1").await.media_confirmed_at, None);

    // A refresh that reads the run after the upload confirms it.
    let read_after = db.published_media_states(BUCKET).await.unwrap();
    let recorded = db
        .record_media_confirmation(&confirmed_media(read_after), &[], AT, BUCKET)
        .await
        .unwrap();
    assert_eq!(recorded.confirmed, 1);
}

#[tokio::test]
async fn a_push_of_the_run_clears_the_state_reclaim_record() {
    let db = Db::connect_in_memory().await.unwrap();
    seed_run(&db, "r1", RunState::TimedOut, ENDED).await;
    let run = seen(&db, "r1").await;
    db.mark_state_reclaimed(&run, ReclaimReason::Failed, AT)
        .await
        .unwrap();

    seed_run(&db, "r1", RunState::TimedOut, ENDED).await;

    let row = run_row(&db, "r1").await;
    assert_eq!(row.state_reclaimed_at, None);
    assert_eq!(row.state_reclaimed_reason, None);
}

#[tokio::test]
async fn only_the_upload_that_makes_a_run_unevaluated_asks_for_a_refresh() {
    // A mirror of a run's files is dozens of uploads. One refresh evaluates the
    // run, so one request is enough.
    let db = Db::connect_in_memory().await.unwrap();
    confirmed(&db, "r1").await;

    let first = db.note_run_file_uploaded("r1").await.unwrap();
    assert_eq!(first, UploadedOver::Confirmation);
    assert!(first.needs_refresh());
    for _ in 0..3 {
        let later = db.note_run_file_uploaded("r1").await.unwrap();
        assert_eq!(later, UploadedOver::Pending);
        assert!(!later.needs_refresh());
    }

    // A run a refresh evaluated and left unconfirmed is unevaluated again by
    // its first upload, and waiting after that.
    seed_run(&db, "r2", RunState::Completed, ENDED).await;
    force_published(&db, "r2").await;
    db.record_media_confirmation(&[], &["r2".to_string()], FIRST, BUCKET)
        .await
        .unwrap();
    assert_eq!(db.published_runs_unconfirmed(BUCKET).await.unwrap(), 1);
    let first = db.note_run_file_uploaded("r2").await.unwrap();
    assert_eq!(first, UploadedOver::Published);
    assert!(first.needs_refresh());
    assert_eq!(run_row(&db, "r2").await.media_checked_at, None);
    assert_eq!(
        db.note_run_file_uploaded("r2").await.unwrap(),
        UploadedOver::Pending
    );
}

#[tokio::test]
async fn every_upload_for_a_published_run_stamps_it_as_changed() {
    // Also the ones that ask for no refresh: a refresh evaluating the run at
    // that moment must not confirm it with a manifest the file is missing from.
    let db = Db::connect_in_memory().await.unwrap();
    seed_run(&db, "r1", RunState::Completed, ENDED).await;
    force_published(&db, "r1").await;
    db.note_run_file_uploaded("r1").await.unwrap();
    let read_before = db.published_media_states(BUCKET).await.unwrap();

    assert_eq!(
        db.note_run_file_uploaded("r1").await.unwrap(),
        UploadedOver::Pending
    );

    let recorded = db
        .record_media_confirmation(&confirmed_media(read_before), &[], AT, BUCKET)
        .await
        .unwrap();
    assert_eq!((recorded.confirmed, recorded.changed), (0, 1));
}

#[tokio::test]
async fn a_withdrawal_names_the_confirmation_it_withdraws_and_keeps_the_manifest() {
    let db = Db::connect_in_memory().await.unwrap();
    confirmed(&db, "r1").await;
    let run = seen(&db, "r1").await;

    assert!(db.withdraw_media_confirmation(&run).await.unwrap());

    let row = run_row(&db, "r1").await;
    assert_eq!(row.media_confirmed_at, None);
    assert_eq!(row.media_checked_at, None);
    assert!(row.media_manifest.is_some());
    assert_eq!(db.published_runs_unchecked(BUCKET).await.unwrap(), 1);
    assert!(
        db.run_file_locations("r1", Some(BUCKET))
            .await
            .unwrap()
            .is_some()
    );
    // The confirmation is gone, so the same facts withdraw nothing more, and a
    // run that was never confirmed has nothing to withdraw.
    assert!(!db.withdraw_media_confirmation(&run).await.unwrap());
    assert!(
        !db.withdraw_media_confirmation(&seen(&db, "r1").await)
            .await
            .unwrap()
    );
}
