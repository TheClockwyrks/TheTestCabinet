//! The state reclamation sweep's passes: what a pass removes from the backend's
//! own store and every guard that keeps a folder.
//!
//! The passes run against an in-memory database, a store in a temporary
//! directory whose files are dated by hand, and a stand-in bucket listing, with a
//! fixed `now`, so nothing here waits on a clock.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use tempfile::TempDir;
use test_cabinet_core::run_record::RunState;
use time::macros::datetime;

use super::*;
use crate::db::retention_tests::{
    BUCKET, damage_manifest, force_published, run_row, seed_job, seed_publish_job, seed_run,
};
use crate::db::{ConfirmedMedia, MediaFileKind, MediaManifestFile};

/// The instant every test decides at.
const NOW: OffsetDateTime = datetime!(2026-07-01 12:00 UTC);
const NOW_TEXT: &str = "2026-07-01T12:00:00Z";

/// When the files of these tests were written, unless a test dates them itself:
/// long before any retention or grace window.
const WRITTEN: OffsetDateTime = datetime!(2026-06-01 12:00 UTC);

/// When the runs of these tests ended.
const ENDED: &str = "2026-06-01T11:00:00Z";

/// When the refresh that confirmed a run uploaded.
const CONFIRMED: &str = "2026-06-20T00:00:00Z";

const RULES: SweepRules = SweepRules {
    grace: Duration::from_secs(24 * 3600),
    retention: RetentionPolicy {
        failed: Duration::from_secs(24 * 3600),
        canceled: Duration::from_secs(3600),
        published: true,
        bucket: Some(BUCKET),
    },
};

/// A stand-in bucket listing: the keys it holds, and whether it is failing.
#[derive(Default)]
struct Listing {
    keys: Mutex<HashSet<String>>,
    failing: AtomicBool,
    /// The runs whose keys were asked for.
    asked: Mutex<Vec<String>>,
}

impl RunBucket for Listing {
    async fn run_keys(&self, run_id: &str) -> Result<HashSet<String>, String> {
        self.asked.lock().unwrap().push(run_id.to_string());
        if self.failing.load(Ordering::SeqCst) {
            return Err("the bucket answered HTTP 500".to_string());
        }
        let prefix = format!("media/runs/{run_id}/");
        Ok(self
            .keys
            .lock()
            .unwrap()
            .iter()
            .filter(|key| key.starts_with(&prefix))
            .cloned()
            .collect())
    }
}

struct Harness {
    db: Db,
    store: DefinitionStore,
    bucket: Listing,
    dir: TempDir,
}

async fn harness() -> Harness {
    let dir = TempDir::new().unwrap();
    Harness {
        db: Db::connect_in_memory().await.unwrap(),
        store: DefinitionStore::open(dir.path().join("store")).unwrap(),
        bucket: Listing::default(),
        dir,
    }
}

impl Harness {
    /// Write `name` into run `id`'s folder through the store's own writers, dated
    /// `at`.
    fn write_at(&self, id: &str, name: &str, bytes: &[u8], at: OffsetDateTime) {
        let store = &self.store;
        match name.split_once('/') {
            Some(("proof", file)) => store.write_run_proof(id, file, bytes),
            Some(("validation", file)) => store.write_run_validation(id, file, bytes),
            Some(("asset", file)) => store.write_run_asset(id, file, bytes),
            Some(("showcase", file)) => store.write_run_showcase(id, file, bytes),
            None if name == "controller.wasm" => store.write_run_controller(id, bytes),
            None if name == "code-analysis.json" => store.write_run_code_analysis(id, bytes),
            None if name == "replay.json" => store.write_run_replay(id, bytes),
            _ => panic!("no writer for `{name}`"),
        }
        .unwrap();
        let path = store.run_file_path(id, name).unwrap();
        std::fs::File::options()
            .write(true)
            .open(path)
            .unwrap()
            .set_modified(at.into())
            .unwrap();
    }

    fn write(&self, id: &str, name: &str, bytes: &[u8]) {
        self.write_at(id, name, bytes, WRITTEN);
    }

    /// The names of the files run `id`'s folder holds.
    fn files(&self, id: &str) -> Vec<String> {
        self.store
            .run_folder(id)
            .unwrap()
            .files
            .into_iter()
            .map(|file| file.name)
            .collect()
    }

    /// Store a published run and record its confirmation in [`BUCKET`] with a
    /// manifest naming an object for each of `names`, every one of which the
    /// bucket lists.
    async fn confirm(&self, id: &str, names: &[&str]) {
        seed_run(&self.db, id, RunState::Completed, ENDED).await;
        force_published(&self.db, id).await;
        let files: Vec<MediaManifestFile> = names
            .iter()
            .map(|name| {
                MediaManifestFile::stored(
                    MediaFileKind::Proof,
                    *name,
                    format!("media/runs/{id}/{name}"),
                )
            })
            .collect();
        for file in &files {
            self.bucket
                .keys
                .lock()
                .unwrap()
                .extend(file.keys().map(str::to_string));
        }
        self.confirm_with(id, MediaManifest { files }).await;
    }

    /// Record run `id`'s confirmation with `manifest`.
    async fn confirm_with(&self, id: &str, manifest: MediaManifest) {
        let state = self
            .db
            .published_media_states(BUCKET)
            .await
            .unwrap()
            .into_iter()
            .find(|state| state.id == id)
            .unwrap();
        let recorded = self
            .db
            .record_media_confirmation(
                &[ConfirmedMedia { state, manifest }],
                &[],
                CONFIRMED,
                BUCKET,
            )
            .await
            .unwrap();
        assert_eq!(recorded.confirmed, 1);
    }

    /// Store an unpublished run that ended in `state`, with its tree reclaimed.
    async fn ended_and_tree_reclaimed(&self, id: &str, state: RunState, reason: ReclaimReason) {
        seed_run(&self.db, id, state, ENDED).await;
        let seen = self
            .db
            .retention_run(id, Some(BUCKET))
            .await
            .unwrap()
            .unwrap();
        assert!(
            self.db
                .mark_artifacts_reclaimed(&seen, reason, "2026-06-03T00:00:00Z")
                .await
                .unwrap()
        );
    }

    /// One scheduled pass at [`NOW`], which must complete.
    async fn pass(&self) -> StateSweepOutcome {
        self.pass_with(&RULES).await
    }

    async fn pass_with(&self, rules: &SweepRules) -> StateSweepOutcome {
        match scheduled_pass(&self.db, &self.store, Some(&self.bucket), NOW, rules).await {
            ScheduledPass::Complete(outcome) => outcome,
            ScheduledPass::Abandoned(why) => panic!("the pass was abandoned: {}", why.as_str()),
        }
    }
}

#[tokio::test]
async fn a_confirmed_published_run_s_files_are_removed_and_recorded() {
    let h = harness().await;
    h.confirm(
        "r1",
        &["proof/title.png", "asset/replay.json", "controller.wasm"],
    )
    .await;
    h.write("r1", "proof/title.png", b"png!");
    h.write("r1", "asset/replay.json", b"{\"m\":1}");
    h.write("r1", "controller.wasm", b"wasm");

    let outcome = h.pass().await;

    assert_eq!(outcome.folders, 1);
    assert_eq!(outcome.reclaimed, 1);
    assert_eq!(outcome.reclaimed_published, 1);
    assert_eq!(outcome.removed_files, 3);
    assert_eq!(outcome.freed_bytes, 4 + 7 + 4);
    assert_eq!(
        outcome.failed + outcome.skipped + outcome.kept_unaccounted,
        0
    );
    // The folder went with its last file.
    assert!(!h.store.run_dir("r1").exists());
    let row = run_row(&h.db, "r1").await;
    assert_eq!(row.state_reclaimed_at.as_deref(), Some(NOW_TEXT));
    assert_eq!(row.state_reclaimed_reason.as_deref(), Some("published"));
    // The confirmation the removal rested on is untouched, and so is the run's
    // mutation timestamp's reader: the manifest still reads.
    assert!(
        h.db.run_media_manifest("r1", Some(BUCKET))
            .await
            .unwrap()
            .is_some()
    );

    // Nothing is left for the next pass.
    let again = h.pass().await;
    assert_eq!(again.folders, 0);
    assert_eq!(again.reclaimed, 0);
}

#[tokio::test]
async fn the_session_record_is_kept_and_its_size_reported() {
    let h = harness().await;
    h.confirm("gg", &["proof/title.png"]).await;
    h.write("gg", "proof/title.png", b"png!");
    h.write("gg", "replay.json", b"the whole conversation");

    let outcome = h.pass().await;

    assert_eq!(outcome.reclaimed_published, 1);
    assert_eq!(outcome.removed_files, 1);
    assert_eq!(outcome.session_records, 1);
    assert_eq!(outcome.session_record_bytes, 22);
    assert_eq!(h.files("gg"), ["replay.json"]);
    assert_eq!(
        h.store.read_run_replay("gg").unwrap(),
        b"the whole conversation"
    );
    // The emptied directory is gone and the folder stays for the record.
    assert!(!h.store.run_proof_dir("gg").exists());

    // A folder holding only a session record is not looked at again.
    let again = h.pass().await;
    assert_eq!(again.folders, 1);
    assert_eq!(again.reclaimed + again.skipped + again.unconfirmed, 0);
    assert_eq!(again.session_records, 1);
    assert!(h.bucket.asked.lock().unwrap().len() == 1);
}

#[tokio::test]
async fn a_folder_holding_a_file_the_manifest_does_not_account_for_is_kept_whole() {
    let h = harness().await;
    h.confirm("r1", &["proof/title.png"]).await;
    h.write("r1", "proof/title.png", b"png!");
    h.write("r1", "asset/unlisted.bin", b"??");

    let outcome = h.pass().await;

    assert_eq!(outcome.kept_unaccounted, 1);
    assert_eq!(outcome.reclaimed, 0);
    assert_eq!(outcome.removed_files, 0);
    assert_eq!(h.files("r1"), ["asset/unlisted.bin", "proof/title.png"]);
    assert_eq!(run_row(&h.db, "r1").await.state_reclaimed_at, None);
    // The bucket is not asked about a folder that is kept anyway.
    assert!(h.bucket.asked.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_file_the_manifest_wrote_off_keeps_the_folder_it_turned_up_in() {
    let h = harness().await;
    seed_run(&h.db, "r1", RunState::Completed, ENDED).await;
    force_published(&h.db, "r1").await;
    h.confirm_with(
        "r1",
        MediaManifest {
            files: vec![MediaManifestFile::unrecoverable(
                MediaFileKind::Asset,
                "asset/replay.json",
                None,
            )],
        },
    )
    .await;
    h.write("r1", "asset/replay.json", b"{}");

    let outcome = h.pass().await;

    assert_eq!(outcome.kept_unaccounted, 1);
    assert_eq!(h.files("r1"), ["asset/replay.json"]);
}

#[tokio::test]
async fn an_entry_the_store_does_not_write_keeps_its_folder() {
    let h = harness().await;
    h.confirm("r1", &["proof/title.png"]).await;
    h.write("r1", "proof/title.png", b"png!");
    #[cfg(unix)]
    std::os::unix::fs::symlink(h.dir.path(), h.store.run_dir("r1").join("elsewhere")).unwrap();

    let outcome = h.pass().await;

    #[cfg(unix)]
    {
        assert_eq!(outcome.kept_unaccounted, 1);
        assert_eq!(outcome.reclaimed, 0);
        assert_eq!(h.files("r1"), ["proof/title.png"]);
    }
    #[cfg(not(unix))]
    assert_eq!(outcome.reclaimed, 1);
}

#[tokio::test]
async fn a_folder_is_kept_while_the_bucket_does_not_list_every_object() {
    let h = harness().await;
    h.confirm("r1", &["proof/title.png", "asset/replay.json"])
        .await;
    h.write("r1", "proof/title.png", b"png!");
    // The object of a file the folder does not even hold is missing: the run is
    // one a refresh would read from this folder again.
    h.bucket
        .keys
        .lock()
        .unwrap()
        .remove("media/runs/r1/asset/replay.json");

    let outcome = h.pass().await;

    assert_eq!(outcome.kept_unlisted, 1);
    assert_eq!(outcome.reclaimed, 0);
    assert_eq!(h.files("r1"), ["proof/title.png"]);
    assert_eq!(run_row(&h.db, "r1").await.state_reclaimed_at, None);
}

#[tokio::test]
async fn a_bucket_that_cannot_be_listed_removes_nothing() {
    let h = harness().await;
    h.confirm("r1", &["proof/title.png"]).await;
    h.write("r1", "proof/title.png", b"png!");
    h.bucket.failing.store(true, Ordering::SeqCst);

    let outcome = h.pass().await;

    assert_eq!(outcome.failed, 1);
    assert_eq!(outcome.reclaimed, 0);
    assert_eq!(h.files("r1"), ["proof/title.png"]);
    assert_eq!(run_row(&h.db, "r1").await.state_reclaimed_at, None);

    // The next pass, with the bucket answering, removes it.
    h.bucket.failing.store(false, Ordering::SeqCst);
    assert_eq!(h.pass().await.reclaimed_published, 1);
}

#[tokio::test]
async fn a_confirmed_run_whose_manifest_does_not_read_keeps_its_files() {
    let h = harness().await;
    h.confirm("r1", &["proof/title.png"]).await;
    h.write("r1", "proof/title.png", b"png!");
    damage_manifest(&h.db, "r1").await;

    let outcome = h.pass().await;

    assert_eq!(outcome.failed, 1);
    assert_eq!(h.files("r1"), ["proof/title.png"]);
    assert_eq!(run_row(&h.db, "r1").await.state_reclaimed_at, None);
}

#[tokio::test]
async fn a_published_run_no_refresh_has_confirmed_keeps_its_files() {
    let h = harness().await;
    seed_run(&h.db, "fresh", RunState::Completed, ENDED).await;
    force_published(&h.db, "fresh").await;
    h.write("fresh", "proof/title.png", b"png!");
    // Confirmed against another bucket, and under the definition before this one.
    seed_run(&h.db, "elsewhere", RunState::Completed, ENDED).await;
    force_published(&h.db, "elsewhere").await;
    crate::db::retention_tests::set_media_confirmed_in(
        &h.db,
        "elsewhere",
        Some(CONFIRMED),
        "https://r2.test/other",
    )
    .await;
    h.write("elsewhere", "proof/title.png", b"png!");
    seed_run(&h.db, "old", RunState::Completed, ENDED).await;
    force_published(&h.db, "old").await;
    crate::db::retention_tests::confirm_under_the_first_definition(&h.db, "old").await;
    h.write("old", "proof/title.png", b"png!");

    let outcome = h.pass().await;

    assert_eq!(outcome.reclaimed, 0);
    assert_eq!(outcome.unconfirmed, 3);
    for id in ["fresh", "elsewhere", "old"] {
        assert_eq!(h.files(id), ["proof/title.png"], "{id}");
    }
}

#[tokio::test]
async fn a_backend_with_no_bucket_removes_no_published_run_s_files() {
    let h = harness().await;
    h.confirm("r1", &["proof/title.png"]).await;
    h.write("r1", "proof/title.png", b"png!");
    let rules = SweepRules {
        retention: RetentionPolicy {
            bucket: None,
            ..RULES.retention
        },
        ..RULES
    };

    let outcome = scheduled_pass(&h.db, &h.store, None::<&Listing>, NOW, &rules).await;

    let ScheduledPass::Complete(outcome) = outcome else {
        panic!("the pass was abandoned");
    };
    assert_eq!(outcome.reclaimed, 0);
    assert_eq!(h.files("r1"), ["proof/title.png"]);
    // Nor does one handed no bucket to ask while its policy names one.
    let outcome = scheduled_pass(&h.db, &h.store, None::<&Listing>, NOW, &RULES).await;
    let ScheduledPass::Complete(outcome) = outcome else {
        panic!("the pass was abandoned");
    };
    assert_eq!(outcome.reclaimed, 0);
    assert_eq!(h.files("r1"), ["proof/title.png"]);
    assert_eq!(run_row(&h.db, "r1").await.state_reclaimed_at, None);
}

#[tokio::test]
async fn the_published_rule_turned_off_removes_no_published_run_s_files() {
    let h = harness().await;
    h.confirm("r1", &["proof/title.png"]).await;
    h.write("r1", "proof/title.png", b"png!");
    let rules = SweepRules {
        retention: RetentionPolicy {
            published: false,
            ..RULES.retention
        },
        ..RULES
    };

    let outcome = h.pass_with(&rules).await;

    assert_eq!(outcome.reclaimed, 0);
    assert_eq!(outcome.unconfirmed, 0);
    assert_eq!(h.files("r1"), ["proof/title.png"]);
}

#[tokio::test]
async fn a_run_is_decided_again_immediately_before_its_files_are_removed() {
    let h = harness().await;
    let policy = &RULES.retention;
    let reclaim = async |id: &str| {
        reclaim_run_state(
            &h.db,
            &h.store,
            Some(&h.bucket),
            id,
            ReclaimReason::Published,
            NOW,
            policy,
        )
        .await
    };

    // Each run was selected by a pass, and changed before its turn came.
    // Pushed again: the confirmation was of the record the push replaced.
    h.confirm("pushed", &["proof/title.png"]).await;
    h.write("pushed", "proof/title.png", b"png!");
    seed_run(&h.db, "pushed", RunState::Completed, ENDED).await;
    assert_eq!(reclaim("pushed").await, StateReclaim::Skipped);

    // Its confirmation withdrawn by a refresh.
    h.confirm("withdrawn", &["proof/title.png"]).await;
    h.write("withdrawn", "proof/title.png", b"png!");
    h.db.record_media_confirmation(&[], &["withdrawn".to_string()], NOW_TEXT, BUCKET)
        .await
        .unwrap();
    assert_eq!(reclaim("withdrawn").await, StateReclaim::Skipped);

    // A publish job enqueued for it, and a job of its own in flight.
    h.confirm("publishing", &["proof/title.png"]).await;
    h.write("publishing", "proof/title.png", b"png!");
    seed_publish_job(&h.db, "p1", "publishing", "queued", NOW_TEXT).await;
    assert_eq!(reclaim("publishing").await, StateReclaim::Skipped);
    h.confirm("running", &["proof/title.png"]).await;
    h.write("running", "proof/title.png", b"png!");
    seed_job(&h.db, "j1", "running", "running").await;
    assert_eq!(reclaim("running").await, StateReclaim::Skipped);

    // Deleted.
    h.write("deleted", "proof/title.png", b"png!");
    assert_eq!(reclaim("deleted").await, StateReclaim::Skipped);

    for id in ["pushed", "withdrawn", "publishing", "running", "deleted"] {
        assert_eq!(h.files(id), ["proof/title.png"], "{id}");
    }
    for id in ["pushed", "withdrawn", "publishing", "running"] {
        assert_eq!(run_row(&h.db, id).await.state_reclaimed_at, None, "{id}");
    }
}

#[tokio::test]
async fn a_removal_that_removes_nothing_takes_the_record_back() {
    let h = harness().await;
    h.confirm("r1", &["proof/title.png"]).await;
    h.write("r1", "proof/title.png", b"png!");
    h.store.fail_removals.store(true, Ordering::SeqCst);

    let outcome = h.pass().await;

    assert_eq!(outcome.failed, 1);
    assert_eq!(outcome.reclaimed, 0);
    assert_eq!(outcome.freed_bytes, 0);
    assert_eq!(h.files("r1"), ["proof/title.png"]);
    let row = run_row(&h.db, "r1").await;
    assert_eq!(row.state_reclaimed_at, None);
    assert_eq!(row.state_reclaimed_reason, None);

    // The next pass, with the volume taking the removal, reclaims the folder.
    h.store.fail_removals.store(false, Ordering::SeqCst);
    assert_eq!(h.pass().await.reclaimed_published, 1);
    assert!(h.files("r1").is_empty());
}

#[tokio::test]
async fn a_failed_removal_restores_the_record_of_an_earlier_reclaim() {
    let h = harness().await;
    h.ended_and_tree_reclaimed("r1", RunState::TimedOut, ReclaimReason::Failed)
        .await;
    h.write("r1", "proof/title.png", b"png!");
    assert_eq!(h.pass().await.reclaimed_failed, 1);
    let first = run_row(&h.db, "r1").await.state_reclaimed_at;
    assert_eq!(first.as_deref(), Some(NOW_TEXT));

    // A file lands again without the upload route recording it, and the pass a
    // day later cannot remove it.
    h.write("r1", "proof/title.png", b"png!");
    h.store.fail_removals.store(true, Ordering::SeqCst);
    let later = NOW + time::Duration::days(1);
    let outcome = scheduled_pass(&h.db, &h.store, Some(&h.bucket), later, &RULES).await;

    let ScheduledPass::Complete(outcome) = outcome else {
        panic!("the pass was abandoned");
    };
    assert_eq!(outcome.failed, 1);
    let row = run_row(&h.db, "r1").await;
    assert_eq!(row.state_reclaimed_at, first);
    assert_eq!(row.state_reclaimed_reason.as_deref(), Some("failed"));
}

#[tokio::test]
async fn a_file_uploaded_after_the_reclaim_has_the_run_evaluated_again() {
    let h = harness().await;
    h.confirm("r1", &["proof/title.png"]).await;
    h.write("r1", "proof/title.png", b"png!");
    assert_eq!(h.pass().await.reclaimed_published, 1);

    // A mirror runs again and writes a file the manifest names and one it does
    // not, as the upload routes do: the file first, then the record.
    h.write("r1", "proof/title.png", b"png!");
    h.write("r1", "proof/extra.png", b"more");
    assert_eq!(
        h.db.note_run_file_uploaded("r1").await.unwrap(),
        crate::db::UploadedOver::Confirmation
    );

    let row = run_row(&h.db, "r1").await;
    assert_eq!(row.state_reclaimed_at, None);
    assert_eq!(row.media_confirmed_at, None);
    assert_eq!(row.media_manifest, None);
    // No refresh has evaluated the run now, which is what requests one at the
    // next start as well.
    assert_eq!(h.db.published_runs_unchecked(BUCKET).await.unwrap(), 1);

    // Until a refresh confirms the run again, nothing of it is removed.
    let outcome = h.pass().await;
    assert_eq!(outcome.reclaimed, 0);
    assert_eq!(outcome.unconfirmed, 1);
    assert_eq!(h.files("r1"), ["proof/extra.png", "proof/title.png"]);

    // The refresh that follows exports the new file and confirms the run with
    // both, and the pass after it removes both.
    h.confirm_with(
        "r1",
        MediaManifest {
            files: ["proof/title.png", "proof/extra.png"]
                .into_iter()
                .map(|name| {
                    MediaManifestFile::stored(
                        MediaFileKind::Proof,
                        name,
                        format!("media/runs/r1/{name}"),
                    )
                })
                .collect(),
        },
    )
    .await;
    h.bucket
        .keys
        .lock()
        .unwrap()
        .insert("media/runs/r1/proof/extra.png".to_string());
    assert_eq!(h.pass().await.removed_files, 2);
}

#[tokio::test]
async fn a_failed_and_a_canceled_run_lose_their_files_once_their_tree_is_gone() {
    let h = harness().await;
    h.ended_and_tree_reclaimed("failed", RunState::TimedOut, ReclaimReason::Failed)
        .await;
    h.write("failed", "proof/title.png", b"png!");
    h.write("failed", "replay.json", b"session");
    h.ended_and_tree_reclaimed("canceled", RunState::Canceled, ReclaimReason::Canceled)
        .await;
    h.write("canceled", "asset/preview.png", b"png!");
    // Past its retention with its tree still stored: it could not be published
    // from a reclaimed tree, and its tree is not reclaimed.
    seed_run(&h.db, "stored", RunState::TimedOut, ENDED).await;
    h.db.set_run_artifacts_stored("stored", true).await.unwrap();
    h.write("stored", "proof/title.png", b"png!");
    // Nothing has reported on its tree.
    seed_run(&h.db, "unknown", RunState::TimedOut, ENDED).await;
    h.write("unknown", "proof/title.png", b"png!");
    // Completed and unpublished: the only copy of what a release publishes.
    h.ended_and_tree_reclaimed("completed", RunState::Completed, ReclaimReason::Failed)
        .await;
    h.write("completed", "proof/title.png", b"png!");
    // A failed run whose files landed an hour ago.
    h.ended_and_tree_reclaimed("late", RunState::TimedOut, ReclaimReason::Failed)
        .await;
    h.write_at(
        "late",
        "proof/title.png",
        b"png!",
        NOW - time::Duration::hours(1),
    );

    let outcome = h.pass().await;

    assert_eq!(outcome.reclaimed_failed, 1);
    assert_eq!(outcome.reclaimed_canceled, 1);
    assert_eq!(outcome.reclaimed, 2);
    assert_eq!(h.files("failed"), ["replay.json"]);
    assert!(h.files("canceled").is_empty());
    for id in ["stored", "unknown", "completed", "late"] {
        assert_eq!(h.files(id), ["proof/title.png"], "{id}");
        assert_eq!(run_row(&h.db, id).await.state_reclaimed_at, None, "{id}");
    }
    let row = run_row(&h.db, "failed").await;
    assert_eq!(row.state_reclaimed_reason.as_deref(), Some("failed"));
    assert_eq!(
        run_row(&h.db, "canceled")
            .await
            .state_reclaimed_reason
            .as_deref(),
        Some("canceled")
    );
    // No bucket is asked about a run that was never published.
    assert!(h.bucket.asked.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_failed_run_with_a_publish_job_waiting_keeps_its_files() {
    let h = harness().await;
    h.ended_and_tree_reclaimed("r1", RunState::TimedOut, ReclaimReason::Failed)
        .await;
    h.write("r1", "proof/title.png", b"png!");
    seed_publish_job(&h.db, "p1", "r1", "queued", NOW_TEXT).await;

    let outcome = h.pass().await;

    assert_eq!(outcome.reclaimed, 0);
    assert_eq!(h.files("r1"), ["proof/title.png"]);
}

#[tokio::test]
async fn a_folder_with_no_run_is_removed_once_it_is_past_the_grace_window() {
    let h = harness().await;
    // The run set must hold a run for any folder to count as an orphan.
    seed_run(&h.db, "other", RunState::Completed, ENDED).await;
    h.write("gone", "proof/title.png", b"png!");
    h.write("gone", "replay.json", b"session");
    // A run that is still finishing: its driver mirrored it an hour ago and has
    // not reported it yet.
    h.write_at(
        "finishing",
        "proof/title.png",
        b"png!",
        NOW - time::Duration::hours(1),
    );
    // An old folder whose run is in flight under a job that names it.
    h.write("working", "proof/title.png", b"png!");
    seed_job(&h.db, "j1", "working", "running").await;

    let outcome = h.pass().await;

    assert_eq!(outcome.reclaimed_orphans, 1);
    assert_eq!(outcome.reclaimed, 1);
    assert_eq!(outcome.removed_files, 1);
    // An orphan's session record is kept like any other.
    assert_eq!(h.files("gone"), ["replay.json"]);
    assert_eq!(h.files("finishing"), ["proof/title.png"]);
    assert_eq!(h.files("working"), ["proof/title.png"]);
}

#[tokio::test]
async fn an_orphan_whose_run_was_reported_since_the_pass_began_is_kept() {
    let h = harness().await;
    h.write("r1", "proof/title.png", b"png!");
    // The pass read a run set without `r1`, and the run was stored before the
    // folder's turn came.
    seed_run(&h.db, "r1", RunState::Completed, ENDED).await;

    let reclaim = reclaim_orphan_folder(&h.db, &h.store, "r1", NOW, RULES.grace).await;

    assert_eq!(reclaim, StateReclaim::Skipped);
    assert_eq!(h.files("r1"), ["proof/title.png"]);
}

#[tokio::test]
async fn a_pass_over_an_empty_run_set_removes_nothing() {
    let h = harness().await;
    h.write("gone", "proof/title.png", b"png!");

    let pass = scheduled_pass(&h.db, &h.store, Some(&h.bucket), NOW, &RULES).await;

    assert!(matches!(
        pass,
        ScheduledPass::Abandoned(AbandonedPass::NoRuns)
    ));
    // The pass itself holds the same rule for any other caller.
    let outcome = sweep_pass(
        &h.db,
        &h.store,
        Some(&h.bucket),
        &["gone".to_string()],
        &[],
        &HashSet::new(),
        NOW,
        &RULES,
    )
    .await;
    assert_eq!(outcome.reclaimed, 0);
    assert_eq!(h.files("gone"), ["proof/title.png"]);
}

#[tokio::test]
async fn a_pass_that_cannot_list_the_run_folders_is_abandoned() {
    let h = harness().await;
    seed_run(&h.db, "r1", RunState::Completed, ENDED).await;
    // `runs` is a file, so listing it fails for another reason than its absence.
    std::fs::write(h.store.root().join("runs"), b"not a directory").unwrap();

    let pass = scheduled_pass(&h.db, &h.store, Some(&h.bucket), NOW, &RULES).await;

    assert!(matches!(
        pass,
        ScheduledPass::Abandoned(AbandonedPass::ListingFailed(_))
    ));
}

#[tokio::test]
async fn a_store_with_no_run_folder_completes_a_pass_that_does_nothing() {
    let h = harness().await;
    seed_run(&h.db, "r1", RunState::Completed, ENDED).await;

    assert_eq!(h.pass().await, StateSweepOutcome::default());
}

#[tokio::test]
async fn the_sweep_is_not_spawned_when_it_is_turned_off() {
    let h = harness().await;
    let db = Arc::new(h.db);
    let timing = SweepTiming {
        interval: Duration::from_secs(600),
        rules: RULES,
    };

    // `TCAB_STATE_RECLAIM` off hands the sweep no timing at all.
    assert!(spawn_state_sweeper(Arc::clone(&db), h.store.clone(), None::<Listing>, None).is_none());
    // A zero interval is the artifact sweep's way of turning both off.
    let stopped = SweepTiming {
        interval: Duration::ZERO,
        ..timing
    };
    assert!(
        spawn_state_sweeper(
            Arc::clone(&db),
            h.store.clone(),
            None::<Listing>,
            Some(stopped)
        )
        .is_none()
    );
    let running = spawn_state_sweeper(db, h.store.clone(), None::<Listing>, Some(timing));
    running.expect("a sweep with a timing runs").abort();
}

#[test]
fn the_first_pass_is_due_shortly_after_the_start() {
    // After the artifact sweep's first pass, so a tree that pass reclaims is
    // seen as reclaimed, and well inside the shortest interval a deployment uses.
    assert!(FIRST_SWEEP_DELAY > Duration::from_secs(60));
    assert!(FIRST_SWEEP_DELAY <= Duration::from_secs(120));
}
