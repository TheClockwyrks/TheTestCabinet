//! Tests for a confirmed run's file manifest and for the version a confirmation
//! is made under: what is written with a confirmation, what clears it, and what
//! a confirmation recorded under an earlier version still counts for.

use sea_orm::sea_query::Expr;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use test_cabinet_core::run_record::RunState;
use test_cabinet_entities::run;

use super::retention_tests::{
    BUCKET, FIRST, SECOND, confirm_under_the_first_definition, confirmed_media, force_published,
    manifest_of, refresh, run_row, seed_run,
};
use super::*;
use crate::db::tests::{links, record};

const OTHER_BUCKET: &str = "https://r2.test/other";

/// A completed, published run with its tree recorded as stored.
async fn published_run(db: &Db, id: &str) {
    seed_run(db, id, RunState::Completed, "2026-06-17T21:30:00Z").await;
    force_published(db, id).await;
    db.set_run_artifacts_stored(id, true).await.unwrap();
}

async fn state_of(db: &Db, id: &str) -> PublishedMediaState {
    db.published_media_states(BUCKET)
        .await
        .unwrap()
        .into_iter()
        .find(|state| state.id == id)
        .expect("a published run")
}

#[test]
fn a_confirmation_holds_only_for_its_bucket_under_the_current_version() {
    let current = Some(MEDIA_CONFIRMATION_VERSION);
    assert!(confirmation_holds(
        Some(FIRST),
        Some(BUCKET),
        current,
        Some(BUCKET)
    ));
    // Never confirmed.
    assert!(!confirmation_holds(
        None,
        Some(BUCKET),
        current,
        Some(BUCKET)
    ));
    // Confirmed in another bucket, and in none.
    assert!(!confirmation_holds(
        Some(FIRST),
        Some(OTHER_BUCKET),
        current,
        Some(BUCKET)
    ));
    assert!(!confirmation_holds(
        Some(FIRST),
        None,
        current,
        Some(BUCKET)
    ));
    // A backend with no bucket.
    assert!(!confirmation_holds(
        Some(FIRST),
        Some(BUCKET),
        current,
        None
    ));
    assert!(!confirmation_holds(Some(FIRST), None, current, None));
    // Made before the column existed, under an earlier version, under a later one.
    for version in [
        None,
        Some(MEDIA_CONFIRMATION_VERSION - 1),
        Some(MEDIA_CONFIRMATION_VERSION + 1),
    ] {
        assert!(
            !confirmation_holds(Some(FIRST), Some(BUCKET), version, Some(BUCKET)),
            "{version:?}"
        );
    }
}

#[test]
fn a_manifest_serializes_each_file_with_only_the_fields_it_has() {
    let manifest = MediaManifest {
        files: vec![
            MediaManifestFile::stored(
                MediaFileKind::Asset,
                "asset/replay-1.json",
                "media/runs/r/asset/replay-1.json",
            ),
            MediaManifestFile::transcoded(
                MediaFileKind::Proof,
                "proof/rally.webm",
                "media/runs/r/original/proof/rally.webm",
                "media/runs/r/proof/rally.mp4",
            ),
            MediaManifestFile::unrecoverable(
                MediaFileKind::Showcase,
                "showcase/clip.webm",
                Some("media/runs/r/showcase/clip.mp4".to_string()),
            ),
            MediaManifestFile::unrecoverable(
                MediaFileKind::CodeAnalysis,
                "code-analysis.json",
                None,
            ),
            MediaManifestFile::stored(
                MediaFileKind::Controller,
                "controller.wasm",
                "media/runs/r/controller.wasm",
            ),
        ],
    };

    let json = serde_json::to_value(&manifest).unwrap();

    assert_eq!(
        json,
        serde_json::json!({ "files": [
            {
                "kind": "asset",
                "name": "asset/replay-1.json",
                "key": "media/runs/r/asset/replay-1.json",
            },
            {
                "kind": "proof",
                "name": "proof/rally.webm",
                "key": "media/runs/r/original/proof/rally.webm",
                "transcodedKey": "media/runs/r/proof/rally.mp4",
            },
            {
                "kind": "showcase",
                "name": "showcase/clip.webm",
                "transcodedKey": "media/runs/r/showcase/clip.mp4",
                "unrecoverable": true,
            },
            { "kind": "code-analysis", "name": "code-analysis.json", "unrecoverable": true },
            {
                "kind": "controller",
                "name": "controller.wasm",
                "key": "media/runs/r/controller.wasm",
            },
        ]})
    );
    assert_eq!(
        serde_json::from_value::<MediaManifest>(json).unwrap(),
        manifest
    );
    assert_eq!(
        manifest
            .file("proof/rally.webm")
            .unwrap()
            .keys()
            .collect::<Vec<_>>(),
        [
            "media/runs/r/original/proof/rally.webm",
            "media/runs/r/proof/rally.mp4"
        ]
    );
    assert_eq!(manifest.file("proof/rally.mp4"), None);
    assert_eq!(
        manifest.unrecoverable().collect::<Vec<_>>(),
        ["showcase/clip.webm", "code-analysis.json"]
    );
    assert_eq!(manifest.keys().count(), 5);
}

#[tokio::test]
async fn a_confirmation_is_written_with_its_manifest_and_version() {
    let db = Db::connect_in_memory().await.unwrap();
    published_run(&db, "a").await;
    published_run(&db, "b").await;

    refresh(&db, &["a"], &["b"], FIRST).await;

    let a = run_row(&db, "a").await;
    assert_eq!(
        a.media_confirmation_version,
        Some(MEDIA_CONFIRMATION_VERSION)
    );
    assert_eq!(
        db.run_media_manifest("a", Some(BUCKET)).await.unwrap(),
        Some(manifest_of("a"))
    );
    // A run a refresh could not confirm is recorded as evaluated under the
    // version, and has no manifest.
    let b = run_row(&db, "b").await;
    assert_eq!(
        b.media_confirmation_version,
        Some(MEDIA_CONFIRMATION_VERSION)
    );
    assert_eq!(b.media_manifest, None);
    assert_eq!(
        db.run_media_manifest("b", Some(BUCKET)).await.unwrap(),
        None
    );
    assert_eq!(
        db.confirmed_media_manifests(Some(BUCKET)).await.unwrap(),
        [("a".to_string(), manifest_of("a"))]
    );
}

#[tokio::test]
async fn a_manifest_is_read_only_where_its_confirmation_holds() {
    let db = Db::connect_in_memory().await.unwrap();
    published_run(&db, "a").await;
    refresh(&db, &["a"], &[], FIRST).await;

    assert_eq!(
        db.run_media_manifest("a", Some(OTHER_BUCKET))
            .await
            .unwrap(),
        None,
        "a backend configured with another bucket"
    );
    assert_eq!(
        db.run_media_manifest("a", None).await.unwrap(),
        None,
        "a backend with no bucket"
    );
    assert_eq!(
        db.run_media_manifest("ghost", Some(BUCKET)).await.unwrap(),
        None,
        "a run that does not exist"
    );
    assert!(db.confirmed_media_manifests(None).await.unwrap().is_empty());
    assert!(
        db.confirmed_media_manifests(Some(OTHER_BUCKET))
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn a_withdrawn_confirmation_clears_the_manifest() {
    let db = Db::connect_in_memory().await.unwrap();
    published_run(&db, "a").await;
    refresh(&db, &["a"], &[], FIRST).await;
    assert!(run_row(&db, "a").await.media_manifest.is_some());

    let outcome = refresh(&db, &[], &["a"], SECOND).await;

    assert_eq!(outcome.withdrawn, 1);
    let row = run_row(&db, "a").await;
    assert_eq!(row.media_confirmed_at, None);
    assert_eq!(row.media_manifest, None);
    assert_eq!(
        db.run_media_manifest("a", Some(BUCKET)).await.unwrap(),
        None
    );
    assert!(
        db.confirmed_media_manifests(Some(BUCKET))
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn storing_a_run_again_clears_its_manifest_and_version() {
    let db = Db::connect_in_memory().await.unwrap();
    published_run(&db, "a").await;
    refresh(&db, &["a"], &[], FIRST).await;

    db.push(&record("a"), &links(), None, None).await.unwrap();

    let row = run_row(&db, "a").await;
    assert_eq!(row.media_confirmed_at, None);
    assert_eq!(row.media_manifest, None);
    assert_eq!(row.media_confirmation_version, None);
    assert_eq!(
        db.run_media_manifest("a", Some(BUCKET)).await.unwrap(),
        None
    );
}

#[tokio::test]
async fn a_confirmed_run_with_no_readable_manifest_is_an_error_not_an_empty_run() {
    // A caller that deletes what a manifest lists must never read a damaged
    // manifest as a run with no files.
    let db = Db::connect_in_memory().await.unwrap();
    published_run(&db, "garbled").await;
    published_run(&db, "missing").await;
    refresh(&db, &["garbled", "missing"], &[], FIRST).await;
    for (id, value) in [("garbled", Some("{not json")), ("missing", None)] {
        run::Entity::update_many()
            .col_expr(
                run::Column::MediaManifest,
                Expr::value(value.map(str::to_string)),
            )
            .filter(run::Column::Id.eq(id))
            .exec(&db.conn())
            .await
            .unwrap();
    }

    for id in ["garbled", "missing"] {
        let read = db.run_media_manifest(id, Some(BUCKET)).await;
        assert!(read.is_err(), "{id}: {read:?}");
    }
    assert!(db.confirmed_media_manifests(Some(BUCKET)).await.is_err());
}

#[tokio::test]
async fn a_confirmation_from_before_the_version_confirms_nothing() {
    let db = Db::connect_in_memory().await.unwrap();
    published_run(&db, "old").await;
    confirm_under_the_first_definition(&db, "old").await;

    // The sweep reads no confirmation, so it deletes no tree on it.
    let seen = db
        .retention_run("old", Some(BUCKET))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(seen.media_confirmed_at, None);
    let all = db.retention_runs(Some(BUCKET)).await.unwrap();
    assert!(all.iter().all(|run| run.media_confirmed_at.is_none()));
    // The refresh reads it as a run to evaluate, and it has no manifest.
    assert!(!state_of(&db, "old").await.confirmed);
    assert_eq!(
        db.run_media_manifest("old", Some(BUCKET)).await.unwrap(),
        None
    );
    assert!(
        db.confirmed_media_manifests(Some(BUCKET))
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn a_run_confirmed_before_the_version_is_evaluated_again_exactly_once() {
    let db = Db::connect_in_memory().await.unwrap();
    published_run(&db, "kept").await;
    published_run(&db, "lost").await;
    confirm_under_the_first_definition(&db, "kept").await;
    confirm_under_the_first_definition(&db, "lost").await;
    // A start after the deploy finds both left to evaluate.
    assert_eq!(db.published_runs_unchecked(BUCKET).await.unwrap(), 2);

    // The refresh confirms one and cannot confirm the other.
    let outcome = refresh(&db, &["kept"], &["lost"], SECOND).await;

    assert_eq!(
        outcome,
        MediaConfirmation {
            confirmed: 1,
            withdrawn: 1,
            changed: 0,
        }
    );
    let kept = run_row(&db, "kept").await;
    assert_eq!(kept.media_confirmed_at.as_deref(), Some(SECOND));
    assert_eq!(
        kept.media_confirmation_version,
        Some(MEDIA_CONFIRMATION_VERSION)
    );
    assert!(kept.media_manifest.is_some());
    let lost = run_row(&db, "lost").await;
    assert_eq!(lost.media_confirmed_at, None);
    assert_eq!(lost.media_checked_at.as_deref(), Some(SECOND));
    assert_eq!(
        lost.media_confirmation_version,
        Some(MEDIA_CONFIRMATION_VERSION)
    );
    // Every later start finds nothing left, whichever way a run went.
    assert_eq!(db.published_runs_unchecked(BUCKET).await.unwrap(), 0);
    assert_eq!(
        refresh(&db, &["kept"], &["lost"], "2026-07-03T00:00:00Z").await,
        MediaConfirmation::default()
    );
}

#[tokio::test]
async fn a_tree_reclaimed_under_an_earlier_confirmation_stays_reclaimed() {
    let db = Db::connect_in_memory().await.unwrap();
    published_run(&db, "old").await;
    crate::db::retention_tests::set_media_confirmed(&db, "old", Some(FIRST)).await;
    let seen = db
        .retention_run("old", Some(BUCKET))
        .await
        .unwrap()
        .unwrap();
    db.mark_artifacts_reclaimed(&seen, ReclaimReason::Published, FIRST)
        .await
        .unwrap();
    // The row as a backend from before the version left it.
    run::Entity::update_many()
        .col_expr(
            run::Column::MediaConfirmationVersion,
            Expr::value(Option::<i32>::None),
        )
        .col_expr(
            run::Column::MediaManifest,
            Expr::value(Option::<String>::None),
        )
        .filter(run::Column::Id.eq("old"))
        .exec(&db.conn())
        .await
        .unwrap();

    let state = state_of(&db, "old").await;

    assert!(!state.confirmed);
    assert!(state.reclaimed);
    assert!(!state.settled(), "the run is evaluated again");
    assert!(state.tree_recorded_absent);
    assert!(db.run_artifacts_reclaimed("old").await.unwrap().is_some());
}

#[tokio::test]
async fn a_refresh_reads_whether_the_backend_recorded_a_tree_as_gone() {
    let db = Db::connect_in_memory().await.unwrap();
    published_run(&db, "stored").await;
    published_run(&db, "lost").await;
    db.set_run_artifacts_stored("lost", false).await.unwrap();
    seed_run(&db, "unknown", RunState::Completed, "2026-06-17T21:30:00Z").await;
    force_published(&db, "unknown").await;
    published_run(&db, "reclaimed").await;
    let seen = db
        .retention_run("reclaimed", Some(BUCKET))
        .await
        .unwrap()
        .unwrap();
    db.mark_artifacts_reclaimed(&seen, ReclaimReason::Published, FIRST)
        .await
        .unwrap();

    for (id, recorded_absent) in [
        ("stored", false),
        // Nothing has reported on the run, which is not a record that it is gone.
        ("unknown", false),
        ("lost", true),
        ("reclaimed", true),
    ] {
        assert_eq!(
            state_of(&db, id).await.tree_recorded_absent,
            recorded_absent,
            "{id}"
        );
    }
}

#[tokio::test]
async fn a_manifest_is_recorded_only_with_a_confirmation_that_is_written() {
    // The run changed after the refresh read it, so its confirmation is refused.
    // Its manifest must be refused with it.
    let db = Db::connect_in_memory().await.unwrap();
    published_run(&db, "a").await;
    let read = vec![state_of(&db, "a").await];
    let mut again = record("a");
    again.finished_at = "2026-06-18T09:00:00Z".to_string();
    db.push(&again, &links(), None, None).await.unwrap();

    let outcome = db
        .record_media_confirmation(&confirmed_media(read), &[], FIRST, BUCKET)
        .await
        .unwrap();

    assert_eq!(outcome.changed, 1);
    assert_eq!(run_row(&db, "a").await.media_manifest, None);
}
