//! The rules of the state reclamation sweep as the pure functions they are: which
//! runs' files a pass removes from the backend's own store, how a published run's
//! folder divides against its manifest, and when a folder with no run is an
//! orphan.

use time::macros::datetime;

use super::*;
use crate::db::retention_tests::BUCKET;
use crate::db::{MediaFileKind, MediaManifestFile};
use crate::store::RunFolderFile;

/// The instant every test decides at.
const NOW: OffsetDateTime = datetime!(2026-07-01 12:00 UTC);

/// When the folders of these tests were last written: long before any retention.
const WRITTEN: OffsetDateTime = datetime!(2026-06-01 12:00 UTC);

/// The default policy with the published rule on: a failed run's files for a day,
/// a canceled run's for an hour.
const POLICY: RetentionPolicy = RetentionPolicy {
    failed: Duration::from_secs(24 * 3600),
    canceled: Duration::from_secs(3600),
    published: true,
    bucket: Some(BUCKET),
};

/// `NOW` less `minutes`, as the RFC 3339 text a run row holds.
fn ago(minutes: i64) -> String {
    (NOW - time::Duration::minutes(minutes))
        .format(&Rfc3339)
        .unwrap()
}

/// One case of the rule's table: what it is, the run, whether it is busy, when
/// its folder was last written, the policy, and what the rule decides.
type Case = (
    &'static str,
    RetentionRun,
    bool,
    OffsetDateTime,
    RetentionPolicy,
    Option<ReclaimReason>,
);

/// How the artifact service's tree of a run is recorded.
#[derive(Clone, Copy, Debug)]
enum Tree {
    /// The sweep reclaimed it.
    Reclaimed,
    /// Recorded as not stored, with no reclaim.
    NotStored,
    /// Recorded as stored.
    Stored,
    /// Nothing has reported on it.
    Unknown,
}

/// The facts of an unpublished run that ended in `state`, `minutes` before `NOW`,
/// whose tree is recorded as `tree`.
fn run(state: &str, minutes: i64, tree: Tree) -> RetentionRun {
    let (stored, reclaimed) = match tree {
        Tree::Reclaimed => (Some(false), Some(ago(1))),
        Tree::NotStored => (Some(false), None),
        Tree::Stored => (Some(true), None),
        Tree::Unknown => (None, None),
    };
    RetentionRun {
        id: "r1".to_string(),
        run_state: state.to_string(),
        finished_at: ago(minutes),
        published: false,
        media_confirmed_at: None,
        artifacts_stored: stored,
        artifacts_reclaimed_reason: reclaimed.as_ref().map(|_| "failed".to_string()),
        artifacts_reclaimed_at: reclaimed,
        state_reclaimed_at: None,
        state_reclaimed_reason: None,
    }
}

/// The facts of a published run that ended in `state` two days ago, confirmed
/// `confirmed` minutes before `NOW` when given.
fn published(state: &str, confirmed: Option<i64>) -> RetentionRun {
    RetentionRun {
        published: true,
        media_confirmed_at: confirmed.map(ago),
        ..run(state, 2 * 24 * 60, Tree::Stored)
    }
}

const DAY: i64 = 24 * 60;

#[test]
fn the_rule_removes_a_run_s_files_for_exactly_the_cases_it_names() {
    use ReclaimReason::{Canceled, Failed, Published};

    let off = RetentionPolicy {
        published: false,
        ..POLICY
    };
    let no_bucket = RetentionPolicy {
        bucket: None,
        ..POLICY
    };
    let keep_failed = RetentionPolicy {
        failed: Duration::ZERO,
        ..POLICY
    };
    let keep_canceled = RetentionPolicy {
        canceled: Duration::ZERO,
        ..POLICY
    };
    // Each case: what it is, the run, whether it is busy, when its folder was
    // last written, the policy, and what the rule decides.
    let cases: Vec<Case> = vec![
        (
            "a confirmed published run",
            published("completed", Some(60)),
            false,
            WRITTEN,
            POLICY,
            Some(Published),
        ),
        (
            "a confirmed published run whose folder was written a moment ago",
            published("completed", Some(60)),
            false,
            NOW,
            POLICY,
            Some(Published),
        ),
        (
            "a published failure is governed by its confirmation, not its state",
            published("timed_out", Some(60)),
            false,
            WRITTEN,
            POLICY,
            Some(Published),
        ),
        (
            "a published run no refresh has confirmed",
            published("completed", None),
            false,
            WRITTEN,
            POLICY,
            None,
        ),
        (
            "a published run confirmed in the future",
            published("completed", Some(-60)),
            false,
            WRITTEN,
            POLICY,
            None,
        ),
        (
            "a confirmed published run with a job in flight or a publish job waiting",
            published("completed", Some(60)),
            true,
            WRITTEN,
            POLICY,
            None,
        ),
        (
            "a confirmed published run while the published rule is off",
            published("completed", Some(60)),
            false,
            WRITTEN,
            off,
            None,
        ),
        (
            "a confirmed published run on a backend with no bucket",
            published("completed", Some(60)),
            false,
            WRITTEN,
            no_bucket,
            None,
        ),
        (
            "a confirmed published run in a state this build cannot name",
            published("transcended", Some(60)),
            false,
            WRITTEN,
            POLICY,
            None,
        ),
        (
            "a completed run that is not published, whatever its age",
            run("completed", 400 * DAY, Tree::Reclaimed),
            false,
            WRITTEN,
            POLICY,
            None,
        ),
        (
            "a failed run past its retention whose tree was reclaimed",
            run("catastrophic", 2 * DAY, Tree::Reclaimed),
            false,
            WRITTEN,
            POLICY,
            Some(Failed),
        ),
        (
            "a failed run past its retention whose tree was never stored",
            run("harness_error", 2 * DAY, Tree::NotStored),
            false,
            WRITTEN,
            POLICY,
            Some(Failed),
        ),
        (
            "a failed run past its retention whose tree is still stored",
            run("catastrophic", 2 * DAY, Tree::Stored),
            false,
            WRITTEN,
            POLICY,
            None,
        ),
        (
            "a failed run past its retention whose tree nothing has reported on",
            run("catastrophic", 2 * DAY, Tree::Unknown),
            false,
            WRITTEN,
            POLICY,
            None,
        ),
        (
            "a failed run inside its retention, which could still be published",
            run("timed_out", 23 * 60, Tree::Reclaimed),
            false,
            WRITTEN,
            POLICY,
            None,
        ),
        (
            "a failed run whose files were written inside the retention",
            run("timed_out", 2 * DAY, Tree::Reclaimed),
            false,
            NOW - time::Duration::hours(2),
            POLICY,
            None,
        ),
        (
            "a failed run whose files are dated after now",
            run("timed_out", 2 * DAY, Tree::Reclaimed),
            false,
            NOW + time::Duration::hours(1),
            POLICY,
            None,
        ),
        (
            "a failed run with a publish job waiting",
            run("timed_out", 2 * DAY, Tree::Reclaimed),
            true,
            WRITTEN,
            POLICY,
            None,
        ),
        (
            "a failed run while failed runs are kept",
            run("timed_out", 2 * DAY, Tree::Reclaimed),
            false,
            WRITTEN,
            keep_failed,
            None,
        ),
        (
            "a failed run whose end time does not parse",
            RetentionRun {
                finished_at: "yesterday".to_string(),
                ..run("timed_out", 2 * DAY, Tree::Reclaimed)
            },
            false,
            WRITTEN,
            POLICY,
            None,
        ),
        (
            "a canceled run past its retention whose tree was reclaimed",
            run("canceled", 90, Tree::Reclaimed),
            false,
            WRITTEN,
            POLICY,
            Some(Canceled),
        ),
        (
            "a canceled run inside its retention",
            run("canceled", 30, Tree::Reclaimed),
            false,
            WRITTEN,
            POLICY,
            None,
        ),
        (
            "a canceled run whose tree is still stored",
            run("canceled", 90, Tree::Stored),
            false,
            WRITTEN,
            POLICY,
            None,
        ),
        (
            "a canceled run while canceled runs are kept",
            run("canceled", 90, Tree::Reclaimed),
            false,
            WRITTEN,
            keep_canceled,
            None,
        ),
        (
            "an unpublished run in a state this build cannot name",
            run("transcended", 400 * DAY, Tree::Reclaimed),
            false,
            WRITTEN,
            POLICY,
            None,
        ),
    ];
    for (what, run, busy, modified, policy, expected) in cases {
        assert_eq!(
            state_retention_reason(&run, busy, modified, NOW, &policy),
            expected,
            "{what}"
        );
    }
}

#[test]
fn a_canceled_retention_under_the_floor_behaves_as_the_floor() {
    let policy = RetentionPolicy {
        canceled: Duration::from_secs(60),
        ..POLICY
    };
    let decide = |minutes| {
        state_retention_reason(
            &run("canceled", minutes, Tree::Reclaimed),
            false,
            WRITTEN,
            NOW,
            &policy,
        )
    };
    assert_eq!(decide(10), None);
    assert_eq!(decide(16), Some(ReclaimReason::Canceled));
}

fn file(name: &str) -> RunFolderFile {
    sized(name, 1)
}

fn sized(name: &str, bytes: u64) -> RunFolderFile {
    RunFolderFile {
        name: name.to_string(),
        bytes,
        modified: WRITTEN.into(),
    }
}

fn folder(names: &[&str]) -> RunFolder {
    RunFolder {
        files: names.iter().map(|name| file(name)).collect(),
        irregular: Vec::new(),
        modified: Some(WRITTEN.into()),
    }
}

fn stored(name: &str) -> MediaManifestFile {
    MediaManifestFile::stored(MediaFileKind::Proof, name, format!("media/runs/r1/{name}"))
}

/// A bucket listing that holds, for every key `manifest` names, an object one
/// byte long: the size of every file [`folder`] makes.
fn listing(manifest: &MediaManifest) -> HashMap<String, BucketObject> {
    manifest
        .keys()
        .map(|key| {
            (
                key.to_string(),
                BucketObject {
                    size: Some(1),
                    md5: None,
                },
            )
        })
        .collect()
}

/// The names of the files an accounting would remove.
fn removed(accounting: &Accounting) -> Vec<&str> {
    accounting
        .remove
        .iter()
        .map(|removable| removable.file.name.as_str())
        .collect()
}

#[test]
fn a_folder_whose_every_file_has_an_object_is_removed_whole() {
    let manifest = MediaManifest {
        files: vec![
            stored("proof/title.png"),
            MediaManifestFile::transcoded(
                MediaFileKind::Proof,
                "proof/play.webm",
                "media/runs/r1/original/proof/play.webm",
                "media/runs/r1/proof/play.mp4",
            ),
            MediaManifestFile::stored(
                MediaFileKind::Controller,
                "controller.wasm",
                "media/runs/r1/controller.wasm",
            ),
        ],
    };
    let accounting = account_folder(
        &folder(&["controller.wasm", "proof/play.webm", "proof/title.png"]),
        &manifest,
        &listing(&manifest),
    );
    assert_eq!(
        removed(&accounting),
        ["controller.wasm", "proof/play.webm", "proof/title.png"]
    );
    // Each is held to its object: the recording to the recording's, not the mp4's.
    assert!(
        accounting
            .remove
            .iter()
            .all(|removable| { removable.published == Some(PublishedCopy { size: 1, md5: None }) })
    );
    assert_eq!(accounting.kept().count(), 0);
}

#[test]
fn a_file_the_manifest_does_not_name_is_unaccounted() {
    let manifest = MediaManifest {
        files: vec![stored("proof/title.png")],
    };
    let accounting = account_folder(
        &folder(&[
            "asset/notes.txt",
            "proof/title.png",
            "showcase/showcase.toml",
        ]),
        &manifest,
        &listing(&manifest),
    );
    assert_eq!(removed(&accounting), ["proof/title.png"]);
    assert_eq!(
        accounting.unaccounted,
        ["asset/notes.txt", "showcase/showcase.toml"]
    );
}

#[test]
fn a_file_the_manifest_wrote_off_is_unpublished_when_the_folder_holds_it() {
    // The refresh found the recording nowhere and kept the mp4 made from it.
    // The recording turning up later is a file nothing has uploaded.
    let manifest = MediaManifest {
        files: vec![
            MediaManifestFile::unrecoverable(
                MediaFileKind::Proof,
                "proof/play.webm",
                Some("media/runs/r1/proof/play.mp4".to_string()),
            ),
            MediaManifestFile::unrecoverable(MediaFileKind::Asset, "asset/replay.json", None),
        ],
    };
    let accounting = account_folder(
        &folder(&["asset/replay.json", "proof/play.webm"]),
        &manifest,
        &listing(&manifest),
    );
    assert!(accounting.remove.is_empty());
    assert_eq!(
        accounting.unpublished,
        ["asset/replay.json", "proof/play.webm"]
    );
}

#[test]
fn a_name_recorded_twice_counts_only_when_every_entry_has_an_object() {
    let manifest = MediaManifest {
        files: vec![
            stored("proof/title.png"),
            MediaManifestFile::unrecoverable(MediaFileKind::Proof, "proof/title.png", None),
        ],
    };
    let accounting = account_folder(
        &folder(&["proof/title.png"]),
        &manifest,
        &listing(&manifest),
    );
    assert_eq!(accounting.unpublished, ["proof/title.png"]);
    assert!(accounting.remove.is_empty());
}

#[test]
fn the_session_record_is_neither_removed_nor_a_reason_to_keep_the_rest() {
    let manifest = MediaManifest {
        files: vec![stored("proof/title.png")],
    };
    let accounting = account_folder(
        &folder(&["proof/title.png", "replay.json"]),
        &manifest,
        &listing(&manifest),
    );
    assert_eq!(removed(&accounting), ["proof/title.png"]);
    assert_eq!(accounting.kept().count(), 0);
    // An adversarial run's replay shares the file name and not the place.
    let accounting = account_folder(
        &folder(&["asset/replay.json"]),
        &MediaManifest::default(),
        &HashMap::new(),
    );
    assert_eq!(accounting.unaccounted, ["asset/replay.json"]);
}

#[test]
fn a_file_whose_object_is_another_size_is_the_only_copy_of_its_bytes() {
    // A file uploaded again under a name the bucket already holds an object for:
    // the object is the older file's, and removing this one would lose it.
    let manifest = MediaManifest {
        files: vec![stored("proof/title.png"), stored("proof/other.png")],
    };
    let mut objects = listing(&manifest);
    objects.insert(
        "media/runs/r1/proof/title.png".to_string(),
        BucketObject {
            size: Some(7),
            md5: None,
        },
    );
    let accounting = account_folder(
        &folder(&["proof/other.png", "proof/title.png"]),
        &manifest,
        &objects,
    );
    assert_eq!(removed(&accounting), ["proof/other.png"]);
    assert_eq!(accounting.differing, ["proof/title.png"]);
}

#[test]
fn an_object_the_bucket_gave_no_size_for_vouches_for_nothing() {
    let manifest = MediaManifest {
        files: vec![stored("proof/title.png")],
    };
    let objects = HashMap::from([(
        "media/runs/r1/proof/title.png".to_string(),
        BucketObject {
            size: None,
            md5: None,
        },
    )]);
    let accounting = account_folder(&folder(&["proof/title.png"]), &manifest, &objects);
    assert!(accounting.remove.is_empty());
    assert_eq!(accounting.differing, ["proof/title.png"]);
}

#[test]
fn an_empty_file_the_manifest_names_is_removed_whatever_its_entry_says() {
    // What a write cut off by a full volume left: a copy of nothing.
    let manifest = MediaManifest {
        files: vec![
            stored("proof/title.png"),
            MediaManifestFile::unrecoverable(MediaFileKind::Asset, "asset/replay.json", None),
        ],
    };
    let empty = RunFolder {
        files: vec![sized("asset/replay.json", 0), sized("proof/title.png", 0)],
        irregular: Vec::new(),
        modified: Some(WRITTEN.into()),
    };
    let mut objects = listing(&manifest);
    objects.insert(
        "media/runs/r1/proof/title.png".to_string(),
        BucketObject {
            size: Some(900),
            md5: None,
        },
    );
    let accounting = account_folder(&empty, &manifest, &objects);
    assert_eq!(
        removed(&accounting),
        ["asset/replay.json", "proof/title.png"]
    );
    assert!(
        accounting
            .remove
            .iter()
            .all(|file| file.published.is_none())
    );
    assert_eq!(accounting.kept().count(), 0);
    // One no manifest entry names is still nothing's to remove.
    let accounting = account_folder(&empty, &MediaManifest::default(), &HashMap::new());
    assert_eq!(
        accounting.unaccounted,
        ["asset/replay.json", "proof/title.png"]
    );
}

#[test]
fn the_code_analysis_document_is_set_aside_to_be_compared_as_published() {
    // Its object is the scrubbed, uncompressed form of the file, so no size of
    // the file's says whether the object is this document's.
    let manifest = MediaManifest {
        files: vec![MediaManifestFile::stored(
            MediaFileKind::CodeAnalysis,
            "code-analysis.json",
            "media/runs/r1/code-analysis/v3.json",
        )],
    };
    let object = BucketObject {
        size: Some(4096),
        md5: None,
    };
    let objects = HashMap::from([("media/runs/r1/code-analysis/v3.json".to_string(), object)]);
    let accounting = account_folder(&folder(&["code-analysis.json"]), &manifest, &objects);
    assert!(accounting.remove.is_empty());
    assert_eq!(
        accounting.transformed,
        Some((file("code-analysis.json"), object))
    );
}

#[test]
fn orphans_are_held_when_there_are_too_many_to_believe() {
    // A few orphans are ordinary, however small the store.
    assert!(!orphans_held(20, 20));
    assert!(!orphans_held(3, 4));
    // Many, and a large share of the folders: a database older than the store.
    assert!(orphans_held(21, 80));
    assert!(orphans_held(500, 1999));
    // Many, and a small share: a large store's ordinary leftovers.
    assert!(!orphans_held(21, 84));
    assert!(!orphans_held(500, 2000));
}

#[test]
fn a_folder_is_an_orphan_only_past_the_grace_window() {
    let grace = Duration::from_secs(24 * 3600);
    let hours = |hours| NOW - time::Duration::hours(hours);
    assert!(orphan_expired(hours(25), NOW, grace));
    assert!(!orphan_expired(hours(24), NOW, grace));
    assert!(!orphan_expired(hours(1), NOW, grace));
    // No window is no orphan rule, not a window every folder is past.
    assert!(!orphan_expired(hours(25), NOW, Duration::ZERO));
    // Written after now: a clock that is wrong keeps the folder.
    assert!(!orphan_expired(hours(-1), NOW, grace));
    // A window past the representable range spares everything.
    assert!(!orphan_expired(hours(25), NOW, Duration::MAX));
}
