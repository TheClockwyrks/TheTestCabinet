//! Tests for a gg run's session record from end to end: a refresh publishes the
//! record of a published run and of no other, the state sweep then removes the
//! store's copy, and nothing of it is uploaded twice.

use std::sync::Arc;
use std::time::Duration;

use tempfile::TempDir;
use test_cabinet_core::run_record::RunLinks;

use super::tests::{
    BUCKET, Bucket, Trees, bucket_client, bucket_publisher, record, run_columns, seed_published,
};
use super::*;
use crate::artifacts::{RetentionPolicy, SweepRules};
use crate::db::{MediaFileKind, MediaManifestFile};
use crate::state_reclaim::{ScheduledPass, StateSweepOutcome, scheduled_pass};

/// The credential every record of these tests carries.
const LEAK: &str = "sk-ant-api03-notreal-value";

/// A session record as a driver mirrors it: gzipped JSON holding `conversation`
/// and a credential the model printed into it.
fn gzipped_record(conversation: &str) -> Vec<u8> {
    use std::io::Write;

    let record = serde_json::json!({
        "formatVersion": 1,
        "entries": [{ "text": conversation, "leak": LEAK }],
    });
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    encoder
        .write_all(&serde_json::to_vec(&record).unwrap())
        .unwrap();
    encoder.finish().unwrap()
}

fn store_of(dir: &TempDir) -> DefinitionStore {
    DefinitionStore::open(dir.path().join("store")).unwrap()
}

fn key_of(id: &str) -> String {
    format!("media/runs/{id}/session-record.json")
}

/// One state sweep pass over `store`, a minute from now so that a confirmation
/// just recorded is in its past.
async fn sweep(db: &Db, store: &DefinitionStore, bucket: &Arc<Bucket>) -> StateSweepOutcome {
    let rules = SweepRules {
        grace: Duration::from_secs(24 * 3600),
        retention: RetentionPolicy {
            failed: Duration::from_secs(24 * 3600),
            canceled: Duration::from_secs(3600),
            published: true,
            bucket: Some(BUCKET),
        },
    };
    let client = bucket_client(bucket).await;
    let now = OffsetDateTime::now_utc() + time::Duration::minutes(1);
    match scheduled_pass(db, store, Some(&client), now, &rules).await {
        ScheduledPass::Complete(outcome) => outcome,
        ScheduledPass::Abandoned(why) => panic!("the pass was abandoned: {}", why.as_str()),
    }
}

#[tokio::test]
async fn a_published_run_s_session_record_is_published_once_and_then_reclaimed() {
    let dir = TempDir::new().unwrap();
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    let bucket = Arc::new(Bucket::default());
    let trees = Arc::new(Trees::default());
    let publisher = bucket_publisher(&dir, &db, &bucket, Some(&trees)).await;
    let store = store_of(&dir);
    seed_published(&db, "gg", "2026-06-17T21:40:00Z").await;
    let stored = gzipped_record("the-published-conversation");
    store.write_run_replay("gg", &stored).unwrap();
    // A completed run nobody published, with a record of its own.
    db.push(&record("draft"), &RunLinks::default(), None, None)
        .await
        .unwrap();
    let draft = gzipped_record("the-unpublished-conversation");
    store.write_run_replay("draft", &draft).unwrap();

    publisher.refresh_now().await.unwrap();

    // The published run's record is in the bucket, inflated and scrubbed.
    let published = bucket.objects.lock().unwrap()[&key_of("gg")].clone();
    let document: serde_json::Value = serde_json::from_slice(&published).unwrap();
    assert_eq!(document["entries"][0]["text"], "the-published-conversation");
    assert_eq!(
        document["entries"][0]["leak"],
        test_cabinet_core::redact::PLACEHOLDER
    );
    // Nothing of the unpublished run is, and the credential is nowhere.
    for (key, bytes) in bucket.objects.lock().unwrap().iter() {
        let body = String::from_utf8_lossy(bytes);
        assert!(!key.contains("/draft/"), "{key}");
        assert!(!body.contains("the-unpublished-conversation"), "{key}");
        assert!(!body.contains(LEAK), "{key}");
        assert!(
            *key == key_of("gg") || !body.contains("the-published-conversation"),
            "{key}"
        );
    }
    assert!(
        bucket
            .keys()
            .iter()
            .any(|key| key.ends_with("/gg-runs.json")),
        "the corpus was among the objects checked"
    );
    // The run is confirmed with a manifest that names the object.
    assert!(run_columns(&db, "gg").await.media_confirmed_at.is_some());
    let manifest = db
        .run_media_manifest("gg", Some(BUCKET))
        .await
        .unwrap()
        .expect("a confirmed run has a manifest");
    assert_eq!(
        manifest.files,
        [MediaManifestFile::stored(
            MediaFileKind::SessionRecord,
            "replay.json",
            key_of("gg")
        )]
    );

    // The sweep finds the stored record to be what the object holds, although
    // neither its bytes nor its size are the object's, and removes it. The
    // unpublished run's stays.
    let outcome = sweep(&db, &store, &bucket).await;
    assert_eq!(outcome.session_records, 2);
    assert_eq!(outcome.reclaimed_published, 1);
    assert_eq!(outcome.removed_files, 1);
    assert_eq!(outcome.freed_bytes, stored.len() as u64);
    assert!(store.read_run_replay("gg").is_err());
    assert_eq!(store.read_run_replay("draft").unwrap(), draft);
    let again = sweep(&db, &store, &bucket).await;
    assert_eq!(again.session_records, 1);
    assert_eq!(again.removed_files, 0);
    assert_eq!(store.read_run_replay("draft").unwrap(), draft);

    // A refresh after the removal keeps the entry and writes the object no
    // second time.
    publisher.refresh_now().await.unwrap();
    assert!(run_columns(&db, "gg").await.media_confirmed_at.is_some());
    assert_eq!(
        db.run_media_manifest("gg", Some(BUCKET))
            .await
            .unwrap()
            .unwrap(),
        manifest
    );
    let puts = bucket
        .put_keys
        .lock()
        .unwrap()
        .iter()
        .filter(|key| **key == key_of("gg"))
        .count();
    assert_eq!(puts, 1);
    assert!(bucket.keys().iter().all(|key| !key.contains("/draft/")));
}

#[tokio::test]
async fn a_session_record_found_beside_a_confirmation_is_published_by_the_next_refresh() {
    let dir = TempDir::new().unwrap();
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    let bucket = Arc::new(Bucket::default());
    let trees = Arc::new(Trees::default());
    let publisher = bucket_publisher(&dir, &db, &bucket, Some(&trees)).await;
    let store = store_of(&dir);
    // Confirmed while its folder held no record, so its manifest names none.
    seed_published(&db, "gg", "2026-06-17T21:40:00Z").await;
    publisher.refresh_now().await.unwrap();
    assert!(run_columns(&db, "gg").await.media_confirmed_at.is_some());
    let manifest = db.run_media_manifest("gg", Some(BUCKET)).await.unwrap();
    assert!(manifest.unwrap().files.is_empty());

    // A record that turns up beside that manifest without an upload's notice
    // is a file the manifest does not name. A refresh builds the confirmed run
    // from its manifest and reads no folder, so it does not publish it.
    let stored = gzipped_record("the-late-conversation");
    store.write_run_replay("gg", &stored).unwrap();
    publisher.refresh_now().await.unwrap();
    assert!(!bucket.keys().contains(&key_of("gg")));

    // The sweep keeps the record and withdraws the confirmation, and the
    // refresh that brings about publishes the record and confirms the run with
    // its entry.
    let outcome = sweep(&db, &store, &bucket).await;
    assert_eq!(outcome.removed_files, 0);
    assert_eq!(outcome.withdrawn, 1);
    assert_eq!(store.read_run_replay("gg").unwrap(), stored);
    assert!(run_columns(&db, "gg").await.media_confirmed_at.is_none());
    assert_eq!(sweep(&db, &store, &bucket).await.removed_files, 0);
    publisher.refresh_now().await.unwrap();
    assert!(bucket.keys().contains(&key_of("gg")));
    let manifest = db
        .run_media_manifest("gg", Some(BUCKET))
        .await
        .unwrap()
        .expect("the run is confirmed again");
    assert_eq!(
        manifest
            .file("replay.json")
            .and_then(|file| file.key.clone()),
        Some(key_of("gg"))
    );
    assert_eq!(sweep(&db, &store, &bucket).await.removed_files, 1);
    assert!(store.read_run_replay("gg").is_err());
}

#[tokio::test]
async fn a_refresh_that_fails_keeps_the_session_record_it_had_already_uploaded() {
    let dir = TempDir::new().unwrap();
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    let bucket = Arc::new(Bucket::default());
    let trees = Arc::new(Trees::default());
    let publisher = bucket_publisher(&dir, &db, &bucket, Some(&trees)).await;
    let store = store_of(&dir);
    seed_published(&db, "gg", "2026-06-17T21:40:00Z").await;
    store
        .write_run_replay("gg", &gzipped_record("the-conversation"))
        .unwrap();
    // The refresh fails once the run's objects are up: the bucket refuses the
    // snapshot's own documents.
    *bucket.refused.lock().unwrap() = Some("snapshots/".to_string());

    assert!(publisher.refresh_now().await.is_err());
    assert!(bucket.keys().contains(&key_of("gg")));
    assert_eq!(run_columns(&db, "gg").await.media_confirmed_at, None);
    // Unconfirmed, so the sweep removes nothing of the run.
    assert_eq!(sweep(&db, &store, &bucket).await.removed_files, 0);

    *bucket.refused.lock().unwrap() = None;
    publisher.refresh_now().await.unwrap();
    assert!(run_columns(&db, "gg").await.media_confirmed_at.is_some());
    let puts = bucket
        .put_keys
        .lock()
        .unwrap()
        .iter()
        .filter(|key| **key == key_of("gg"))
        .count();
    assert_eq!(puts, 1, "the object is not written again");
}

#[tokio::test]
async fn a_reclaimed_session_record_whose_object_is_deleted_is_recorded_as_unrecoverable() {
    let dir = TempDir::new().unwrap();
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    let bucket = Arc::new(Bucket::default());
    let trees = Arc::new(Trees::default());
    let publisher = bucket_publisher(&dir, &db, &bucket, Some(&trees)).await;
    let store = store_of(&dir);
    seed_published(&db, "gg", "2026-06-17T21:40:00Z").await;
    store
        .write_run_replay("gg", &gzipped_record("the-conversation"))
        .unwrap();
    publisher.refresh_now().await.unwrap();
    assert_eq!(sweep(&db, &store, &bucket).await.removed_files, 1);
    assert!(store.read_run_replay("gg").is_err());

    // The only copy left is deleted from the bucket.
    bucket.objects.lock().unwrap().remove(&key_of("gg"));
    assert!(!bucket.keys().contains(&key_of("gg")));

    // The store holds no run folder at all now, which is also what a volume
    // that is not mounted looks like: the record is not written off on that.
    publisher.refresh_now().await.unwrap();
    assert_eq!(run_columns(&db, "gg").await.media_confirmed_at, None);

    // Once the store answers, the record is known to exist nowhere. The run is
    // not confirmed as one that never had a record: its manifest says what was
    // lost.
    store
        .write_run_proof("another", "title.png", b"png!")
        .unwrap();
    publisher.refresh_now().await.unwrap();
    assert!(run_columns(&db, "gg").await.media_confirmed_at.is_some());
    let manifest = db
        .run_media_manifest("gg", Some(BUCKET))
        .await
        .unwrap()
        .expect("the run is confirmed again");
    assert_eq!(
        manifest.files,
        [MediaManifestFile::unrecoverable(
            MediaFileKind::SessionRecord,
            "replay.json",
            None
        )]
    );
    assert!(!bucket.keys().contains(&key_of("gg")));

    // A record uploaded after that is one the sweep finds beside an entry that
    // wrote it off, and the refresh its withdrawal brings about publishes it.
    let late = gzipped_record("the-conversation-restored");
    store.write_run_replay("gg", &late).unwrap();
    assert_eq!(sweep(&db, &store, &bucket).await.withdrawn, 1);
    publisher.refresh_now().await.unwrap();
    assert!(bucket.keys().contains(&key_of("gg")));
    assert_eq!(sweep(&db, &store, &bucket).await.removed_files, 1);
}
