//! Tests for what the state reclamation sweep reads and removes in the store's
//! `runs/` directory.

use tempfile::TempDir;

use super::*;

fn store() -> (TempDir, DefinitionStore) {
    let dir = TempDir::new().unwrap();
    let store = DefinitionStore::open(dir.path().join("store")).unwrap();
    (dir, store)
}

/// The file of run `run_id` named `name` as a listing of its folder finds it, or
/// a stand-in for a name no listing would give.
fn listed(store: &DefinitionStore, run_id: &str, name: &str) -> RunFolderFile {
    store
        .run_folder(run_id)
        .ok()
        .and_then(|folder| folder.files.into_iter().find(|file| file.name == name))
        .unwrap_or(RunFolderFile {
            name: name.to_string(),
            bytes: 0,
            modified: std::time::SystemTime::UNIX_EPOCH,
        })
}

/// Remove the file of run `run_id` named `name` as a listing made now finds it.
fn remove(store: &DefinitionStore, run_id: &str, name: &str) -> Result<Removal> {
    store.remove_run_file_as_listed(run_id, &listed(store, run_id, name), None)
}

fn md5_of(bytes: &[u8]) -> [u8; 16] {
    use md5::Digest;
    md5::Md5::digest(bytes).into()
}

fn names(folder: &RunFolder) -> Vec<&str> {
    folder.files.iter().map(|file| file.name.as_str()).collect()
}

#[test]
fn a_store_with_no_runs_directory_holds_no_run_folder() {
    let (_dir, store) = store();
    assert_eq!(store.list_run_folders().unwrap(), Vec::<String>::new());
    assert_eq!(store.run_folder("r1").unwrap(), RunFolder::default());
}

#[test]
fn the_run_folders_are_the_directories_under_runs() {
    let (_dir, store) = store();
    store.write_run_proof("b", "title.png", b"png").unwrap();
    store.write_run_controller("a", b"wasm").unwrap();
    // A stray file beside the folders is no run's folder.
    std::fs::write(store.root().join("runs").join("notes.txt"), b"x").unwrap();

    assert_eq!(store.list_run_folders().unwrap(), ["a", "b"]);
}

#[test]
fn a_runs_entry_that_is_not_a_directory_fails_the_listing() {
    let (_dir, store) = store();
    std::fs::write(store.root().join("runs"), b"not a directory").unwrap();
    assert!(store.list_run_folders().is_err());
}

#[test]
fn a_folder_lists_every_file_by_the_name_a_manifest_records() {
    let (_dir, store) = store();
    store.write_run_proof("r1", "title.png", b"png!").unwrap();
    store
        .write_run_validation("r1", "walk.webm", b"webm")
        .unwrap();
    store.write_run_asset("r1", "replay-1.json", b"{}").unwrap();
    store
        .write_run_showcase("r1", "hero.png", b"hero!")
        .unwrap();
    store.write_run_controller("r1", b"wasm").unwrap();
    store.write_run_code_analysis("r1", b"{\"a\":1}").unwrap();
    store.write_run_replay("r1", b"session").unwrap();

    let folder = store.run_folder("r1").unwrap();

    assert_eq!(
        names(&folder),
        [
            "asset/replay-1.json",
            "code-analysis.json",
            "controller.wasm",
            "proof/title.png",
            "replay.json",
            "showcase/hero.png",
            "validation/walk.webm",
        ]
    );
    assert!(folder.irregular.is_empty());
    assert!(folder.modified.is_some());
    assert_eq!(folder.session_record_bytes(), Some(7));
    let reclaimable: Vec<&str> = folder
        .reclaimable()
        .map(|file| file.name.as_str())
        .collect();
    assert!(!reclaimable.contains(&"replay.json"));
    assert_eq!(reclaimable.len(), 6);
    let proof = folder
        .files
        .iter()
        .find(|file| file.name == "proof/title.png");
    assert_eq!(proof.unwrap().bytes, 4);
    // Every name is one the store resolves back to the file.
    for file in &folder.files {
        assert!(store.run_file_path("r1", &file.name).unwrap().is_file());
    }
}

#[test]
fn the_folder_s_date_is_its_newest_file_s() {
    let (_dir, store) = store();
    store.write_run_proof("r1", "old.png", b"a").unwrap();
    store.write_run_proof("r1", "new.png", b"b").unwrap();
    let old = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_000_000);
    let new = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(2_000_000);
    for (name, at) in [("proof/old.png", old), ("proof/new.png", new)] {
        std::fs::File::options()
            .write(true)
            .open(store.run_file_path("r1", name).unwrap())
            .unwrap()
            .set_modified(at)
            .unwrap();
    }

    assert_eq!(store.run_folder("r1").unwrap().modified, Some(new));
}

#[cfg(unix)]
#[test]
fn a_link_in_a_folder_is_reported_and_never_followed() {
    let (dir, store) = store();
    store.write_run_proof("r1", "title.png", b"png").unwrap();
    let outside = dir.path().join("outside");
    std::fs::create_dir(&outside).unwrap();
    std::fs::write(outside.join("precious.txt"), b"keep").unwrap();
    std::os::unix::fs::symlink(&outside, store.run_dir("r1").join("link")).unwrap();

    let folder = store.run_folder("r1").unwrap();

    assert_eq!(names(&folder), ["proof/title.png"]);
    assert_eq!(folder.irregular, ["link"]);
}

#[test]
fn a_file_is_removed_by_name_and_a_missing_one_reports_so() {
    let (_dir, store) = store();
    store.write_run_proof("r1", "title.png", b"png").unwrap();
    store.write_run_proof("r1", "other.png", b"png").unwrap();

    assert_eq!(
        remove(&store, "r1", "proof/title.png").unwrap(),
        Removal::Removed
    );
    assert_eq!(
        remove(&store, "r1", "proof/title.png").unwrap(),
        Removal::Gone
    );

    assert_eq!(names(&store.run_folder("r1").unwrap()), ["proof/other.png"]);
}

#[test]
fn the_session_record_and_a_name_outside_the_folder_are_refused() {
    let (dir, store) = store();
    store.write_run_replay("r1", b"session").unwrap();
    std::fs::write(dir.path().join("store").join("outside.txt"), b"keep").unwrap();

    assert!(remove(&store, "r1", "replay.json").is_err());
    assert!(remove(&store, "r1", "../../outside.txt").is_err());
    assert!(remove(&store, "r1", "/etc/hostname").is_err());
    assert!(remove(&store, "../r1", "replay.json").is_err());

    assert_eq!(store.read_run_replay("r1").unwrap(), b"session");
    assert!(dir.path().join("store").join("outside.txt").is_file());
}

/// What the bucket would hold for the session record `stored`.
fn record_copy(stored: &[u8]) -> PublishedCopy {
    let published = crate::snapshot::published_session_record(stored).expect("it publishes");
    PublishedCopy {
        size: published.len() as u64,
        md5: Some(md5_of(&published)),
    }
}

#[test]
fn a_published_run_s_session_record_is_removed_only_as_the_listed_file() {
    let (_dir, store) = store();
    let record = br#"{"turns": ["one"]}"#;
    let another = br#"{"turns": ["another", "session"]}"#;
    store.write_run_replay("r1", record).unwrap();
    store.write_run_proof("r1", "title.png", b"png!").unwrap();

    // The removal is of a scrubbed document and of nothing else.
    let proof = listed(&store, "r1", "proof/title.png");
    assert!(
        store
            .remove_published_document("r1", &proof, Some(&record_copy(record)))
            .is_err()
    );
    assert_eq!(names(&store.run_folder("r1").unwrap()).len(), 2);

    // A record written again since it was listed is another record.
    let before = listed(&store, "r1", "replay.json");
    store.write_run_replay("r1", another).unwrap();
    assert_eq!(
        store
            .remove_published_document("r1", &before, Some(&record_copy(record)))
            .unwrap(),
        Removal::Changed
    );
    assert_eq!(store.read_run_replay("r1").unwrap(), another);

    let now = listed(&store, "r1", "replay.json");
    assert_eq!(
        store
            .remove_published_document("r1", &now, Some(&record_copy(another)))
            .unwrap(),
        Removal::Removed
    );
    assert_eq!(
        store
            .remove_published_document("r1", &now, Some(&record_copy(another)))
            .unwrap(),
        Removal::Gone
    );
    assert_eq!(names(&store.run_folder("r1").unwrap()), ["proof/title.png"]);
}

#[test]
fn a_session_record_is_removed_only_when_its_published_form_is_the_object() {
    let (_dir, store) = store();
    let record = br#"{"turns": ["one"]}"#;
    store.write_run_replay("r1", record).unwrap();
    let file = listed(&store, "r1", "replay.json");
    let held = record_copy(record);

    // The object holds the published form of another record: another size, or
    // the same size and other bytes.
    let other_size = record_copy(br#"{"turns": ["one", "two"]}"#);
    let other_bytes = record_copy(br#"{"turns": ["two"]}"#);
    assert_eq!(other_bytes.size, held.size);
    // The stored bytes themselves are not what the object holds.
    let raw = PublishedCopy {
        size: record.len() as u64,
        md5: Some(md5_of(record)),
    };
    for object in [other_size, other_bytes, raw] {
        assert_eq!(
            store
                .remove_published_document("r1", &file, Some(&object))
                .unwrap(),
            Removal::Differs,
            "{object:?}"
        );
    }
    // Nothing to hold it against keeps a record that holds anything.
    assert_eq!(
        store.remove_published_document("r1", &file, None).unwrap(),
        Removal::Differs
    );
    assert_eq!(store.read_run_replay("r1").unwrap(), record);

    assert_eq!(
        store
            .remove_published_document("r1", &file, Some(&held))
            .unwrap(),
        Removal::Removed
    );

    // A record that is not a document publishes as nothing, so no object is it.
    store.write_run_replay("r2", b"not json").unwrap();
    let file = listed(&store, "r2", "replay.json");
    assert_eq!(
        store
            .remove_published_document("r2", &file, Some(&held))
            .unwrap(),
        Removal::Differs
    );
    assert_eq!(store.read_run_replay("r2").unwrap(), b"not json");
}

/// The comparison and the removal are of one file. A record of the same size
/// and the same modification time, renamed into place after the comparison, is
/// not the record that was compared, and stays.
#[test]
fn a_record_replaced_between_its_comparison_and_its_removal_is_kept() {
    let (_dir, store) = store();
    let record = br#"{"turns": ["one"]}"#;
    let replacement = br#"{"turns": ["two"]}"#;
    assert_eq!(record.len(), replacement.len());
    store.write_run_replay("r1", record).unwrap();
    let file = listed(&store, "r1", "replay.json");

    let racing = store.clone();
    let modified = file.modified;
    store.before_document_removal.set(move || {
        racing.write_run_replay("r1", replacement).unwrap();
        std::fs::File::options()
            .write(true)
            .open(racing.run_replay_path("r1"))
            .unwrap()
            .set_modified(modified)
            .unwrap();
    });
    assert_eq!(
        store
            .remove_published_document("r1", &file, Some(&record_copy(record)))
            .unwrap(),
        Removal::Changed
    );
    // The replacement is what the listing took the record for, and is there.
    assert_eq!(listed(&store, "r1", "replay.json"), file);
    assert_eq!(store.read_run_replay("r1").unwrap(), replacement);
}

#[test]
fn a_code_analysis_document_is_removed_by_its_published_form() {
    let (_dir, store) = store();
    let document = br#"{ "files": [ "a.ts" ] }"#;
    store.write_run_code_analysis("r1", document).unwrap();
    let file = listed(&store, "r1", "code-analysis.json");
    let published = crate::snapshot::published_scrubbed_document(document).unwrap();
    let held = PublishedCopy {
        size: published.len() as u64,
        md5: Some(md5_of(&published)),
    };
    let other = PublishedCopy {
        md5: Some(md5_of(b"another document")),
        ..held
    };
    assert_eq!(
        store
            .remove_published_document("r1", &file, Some(&other))
            .unwrap(),
        Removal::Differs
    );
    assert_eq!(
        store
            .remove_published_document("r1", &file, Some(&held))
            .unwrap(),
        Removal::Removed
    );
}

#[test]
fn an_empty_scrubbed_document_is_removed_without_an_object() {
    let (_dir, store) = store();
    store.write_run_replay("r1", b"").unwrap();
    let file = listed(&store, "r1", "replay.json");
    assert!(store.open_run_file("r1", "replay.json").unwrap().is_none());
    assert_eq!(
        store.remove_published_document("r1", &file, None).unwrap(),
        Removal::Removed
    );
    assert!(store.open_run_file("r1", "replay.json").unwrap().is_none());
    assert!(store.open_run_file("r1", "../outside").is_err());
}

#[test]
fn pruning_removes_only_directories_that_hold_nothing() {
    let (_dir, store) = store();
    store.write_run_proof("r1", "title.png", b"png").unwrap();
    store.write_run_asset("r1", "replay.json", b"{}").unwrap();
    remove(&store, "r1", "proof/title.png").unwrap();

    store.prune_run_dirs("r1");

    assert!(!store.run_proof_dir("r1").exists());
    assert_eq!(
        names(&store.run_folder("r1").unwrap()),
        ["asset/replay.json"]
    );

    // With the last file gone the folder goes too, and a file written afterwards
    // makes it again.
    remove(&store, "r1", "asset/replay.json").unwrap();
    store.prune_run_dirs("r1");
    assert!(!store.run_dir("r1").exists());
    store.write_run_proof("r1", "again.png", b"png").unwrap();
    assert_eq!(names(&store.run_folder("r1").unwrap()), ["proof/again.png"]);
}

#[test]
fn a_write_and_a_prune_never_lose_the_file() {
    // The write makes its directory and writes into it under one lock the prune
    // excludes, so a prune between the two cannot take the directory away.
    let (_dir, store) = store();
    let writer = {
        let store = store.clone();
        std::thread::spawn(move || {
            for i in 0..200 {
                store
                    .write_run_proof("r1", &format!("f{i}.png"), b"png")
                    .unwrap();
            }
        })
    };
    for _ in 0..200 {
        store.prune_run_dirs("r1");
    }
    writer.join().unwrap();

    assert_eq!(store.run_folder("r1").unwrap().files.len(), 200);
}

#[test]
fn a_failed_write_leaves_the_file_that_was_there_untouched() {
    // A write to a full volume lands some of its bytes and then fails. The file
    // already at the name must survive it whole, and no part of the new one may
    // be left where a refresh would publish it.
    let (_dir, store) = store();
    store
        .write_run_proof("r1", "title.png", b"the whole image")
        .unwrap();

    store
        .fail_writes
        .store(true, std::sync::atomic::Ordering::SeqCst);
    assert!(
        store
            .write_run_proof("r1", "title.png", b"a newer image")
            .is_err()
    );
    assert!(
        store
            .write_run_proof("r1", "other.png", b"never lands")
            .is_err()
    );
    store
        .fail_writes
        .store(false, std::sync::atomic::Ordering::SeqCst);

    assert_eq!(
        store.read_run_proof("r1", "title.png").unwrap(),
        b"the whole image"
    );
    assert_eq!(names(&store.run_folder("r1").unwrap()), ["proof/title.png"]);
    // Nothing is left in the staging directory either.
    let staged = std::fs::read_dir(store.root().join("run-uploads.tmp"))
        .unwrap()
        .count();
    assert_eq!(staged, 0);
}

#[test]
fn a_staged_file_is_in_no_run_folder_and_is_cleared_at_startup() {
    let (_dir, store) = store();
    store.write_run_proof("r1", "title.png", b"png").unwrap();
    let staging = store.root().join("run-uploads.tmp");
    std::fs::write(staging.join("left-by-a-crash"), b"half").unwrap();

    assert_eq!(store.list_run_folders().unwrap(), ["r1"]);

    store.clear_staged_uploads();
    assert_eq!(std::fs::read_dir(&staging).unwrap().count(), 0);
    assert_eq!(store.read_run_proof("r1", "title.png").unwrap(), b"png");
}

#[test]
fn a_file_written_again_since_the_listing_is_not_removed() {
    let (_dir, store) = store();
    store.write_run_proof("r1", "title.png", b"old").unwrap();
    let before = listed(&store, "r1", "proof/title.png");

    // Same name, same length: only the file itself tells the two apart.
    store.write_run_proof("r1", "title.png", b"new").unwrap();
    let path = store.run_file_path("r1", "proof/title.png").unwrap();
    std::fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_modified(before.modified + std::time::Duration::from_secs(5))
        .unwrap();

    assert_eq!(
        store
            .remove_run_file_as_listed("r1", &before, None)
            .unwrap(),
        Removal::Changed
    );
    assert_eq!(store.read_run_proof("r1", "title.png").unwrap(), b"new");
}

#[test]
fn a_file_is_removed_only_when_it_is_what_the_bucket_holds() {
    let (_dir, store) = store();
    store.write_run_proof("r1", "title.png", b"newer").unwrap();
    let file = listed(&store, "r1", "proof/title.png");

    // Another size.
    let other_size = PublishedCopy { size: 3, md5: None };
    assert_eq!(
        store
            .remove_run_file_as_listed("r1", &file, Some(&other_size))
            .unwrap(),
        Removal::Differs
    );
    // The same size and other bytes.
    let other_bytes = PublishedCopy {
        size: 5,
        md5: Some(md5_of(b"older")),
    };
    assert_eq!(
        store
            .remove_run_file_as_listed("r1", &file, Some(&other_bytes))
            .unwrap(),
        Removal::Differs
    );
    assert_eq!(store.read_run_proof("r1", "title.png").unwrap(), b"newer");

    let same = PublishedCopy {
        size: 5,
        md5: Some(md5_of(b"newer")),
    };
    assert_eq!(
        store
            .remove_run_file_as_listed("r1", &file, Some(&same))
            .unwrap(),
        Removal::Removed
    );
    assert!(store.read_run_proof("r1", "title.png").is_err());
}

#[test]
fn an_object_with_no_md5_is_held_to_its_size_alone() {
    let (_dir, store) = store();
    store.write_run_proof("r1", "title.png", b"bytes").unwrap();
    let file = listed(&store, "r1", "proof/title.png");
    let sized = PublishedCopy { size: 5, md5: None };
    assert_eq!(
        store
            .remove_run_file_as_listed("r1", &file, Some(&sized))
            .unwrap(),
        Removal::Removed
    );
}

#[test]
fn an_empty_file_is_no_copy_and_a_missing_one_is_absent() {
    let (_dir, store) = store();
    store.write_run_proof("r1", "full.png", b"png").unwrap();
    store.write_run_proof("r1", "empty.png", b"").unwrap();

    assert!(!store.run_file_absent("r1", "proof/full.png"));
    assert!(store.run_file_absent("r1", "proof/empty.png"));
    assert!(store.run_file_absent("r1", "proof/never.png"));
    assert_eq!(store.run_file_size("r1", "proof/full.png"), Some(3));
    assert_eq!(store.run_file_size("r1", "proof/never.png"), None);
}

#[test]
fn a_store_says_whether_it_holds_any_run_folder() {
    let (_dir, store) = store();
    assert!(!store.holds_run_folders());
    store.write_run_proof("r1", "title.png", b"png").unwrap();
    assert!(store.holds_run_folders());
}
