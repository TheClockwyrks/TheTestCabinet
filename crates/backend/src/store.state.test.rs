//! Tests for what the state reclamation sweep reads and removes in the store's
//! `runs/` directory.

use tempfile::TempDir;

use super::*;

fn store() -> (TempDir, DefinitionStore) {
    let dir = TempDir::new().unwrap();
    let store = DefinitionStore::open(dir.path().join("store")).unwrap();
    (dir, store)
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

    assert!(store.remove_run_file("r1", "proof/title.png").unwrap());
    assert!(!store.remove_run_file("r1", "proof/title.png").unwrap());

    assert_eq!(names(&store.run_folder("r1").unwrap()), ["proof/other.png"]);
}

#[test]
fn the_session_record_and_a_name_outside_the_folder_are_refused() {
    let (dir, store) = store();
    store.write_run_replay("r1", b"session").unwrap();
    std::fs::write(dir.path().join("store").join("outside.txt"), b"keep").unwrap();

    assert!(store.remove_run_file("r1", "replay.json").is_err());
    assert!(store.remove_run_file("r1", "../../outside.txt").is_err());
    assert!(store.remove_run_file("r1", "/etc/hostname").is_err());
    assert!(store.remove_run_file("../r1", "replay.json").is_err());

    assert_eq!(store.read_run_replay("r1").unwrap(), b"session");
    assert!(dir.path().join("store").join("outside.txt").is_file());
}

#[test]
fn pruning_removes_only_directories_that_hold_nothing() {
    let (_dir, store) = store();
    store.write_run_proof("r1", "title.png", b"png").unwrap();
    store.write_run_asset("r1", "replay.json", b"{}").unwrap();
    store.remove_run_file("r1", "proof/title.png").unwrap();

    store.prune_run_dirs("r1");

    assert!(!store.run_proof_dir("r1").exists());
    assert_eq!(
        names(&store.run_folder("r1").unwrap()),
        ["asset/replay.json"]
    );

    // With the last file gone the folder goes too, and a file written afterwards
    // makes it again.
    store.remove_run_file("r1", "asset/replay.json").unwrap();
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
