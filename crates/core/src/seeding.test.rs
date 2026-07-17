use super::{init_repo, reserve_unique_dir, run_timestamp, seed_prior_game_jam_entries};
use crate::run_record::PriorGameJamEntry;

/// The run timestamp is a fixed-width `YYYYMMDD-HHMMSS` stamp: eight digits, a
/// dash, then six digits, all numeric. This is what makes a directory listing
/// sort chronologically, so the shape is part of the contract.
#[test]
fn run_timestamp_is_a_fixed_width_sortable_stamp() {
    let stamp = run_timestamp();

    let (date, time) = stamp.split_once('-').expect("a date-time separator");
    assert_eq!(date.len(), 8, "date is YYYYMMDD: {stamp}");
    assert_eq!(time.len(), 6, "time is HHMMSS: {stamp}");
    assert!(
        stamp.chars().all(|c| c.is_ascii_digit() || c == '-'),
        "only digits and the separator: {stamp}"
    );
}

/// With no existing directory, the stem is reserved verbatim — no tiebreaker is
/// appended in the common case.
#[test]
fn reserve_unique_dir_uses_the_bare_stem_when_free() {
    let base = tempfile::tempdir().expect("temp dir");

    let reserved = reserve_unique_dir(base.path(), "pong-v1.0.0-20260615-120000")
        .expect("reserve a free name");

    assert_eq!(reserved, base.path().join("pong-v1.0.0-20260615-120000"));
    assert!(reserved.is_dir(), "the reserved directory is created");
}

/// When the bare stem and earlier tiebreakers are taken, reservation walks
/// `-1`, `-2`, … until it finds a free name and creates exactly that directory.
#[test]
fn reserve_unique_dir_appends_a_tiebreaker_on_collision() {
    let base = tempfile::tempdir().expect("temp dir");
    let stem = "pong-v1.0.0-20260615-120000";

    let first = reserve_unique_dir(base.path(), stem).expect("first reservation");
    let second = reserve_unique_dir(base.path(), stem).expect("second reservation");
    let third = reserve_unique_dir(base.path(), stem).expect("third reservation");

    assert_eq!(first, base.path().join(stem));
    assert_eq!(second, base.path().join(format!("{stem}-1")));
    assert_eq!(third, base.path().join(format!("{stem}-2")));
    for dir in [&first, &second, &third] {
        assert!(dir.is_dir(), "{} is created", dir.display());
    }
}

/// A game jam's earlier entries are written into `previous-entries/` — an index
/// plus one numbered file per entry, oldest first — carrying each prior README's
/// content.
#[test]
fn seed_prior_game_jam_entries_writes_an_indexed_folder() {
    let repo = tempfile::tempdir().expect("temp dir");
    let entries = vec![
        PriorGameJamEntry {
            run_id: "run-a".to_string(),
            finished_at: "2026-01-01T00:00:00Z".to_string(),
            readme: "# Space Miner\n\nDig for ore.".to_string(),
        },
        PriorGameJamEntry {
            run_id: "run-b".to_string(),
            finished_at: "2026-02-02T00:00:00Z".to_string(),
            readme: "# Tide Pool\n\nTend a pool.".to_string(),
        },
    ];

    seed_prior_game_jam_entries(repo.path(), &entries).expect("seed prior entries");

    let dir = repo.path().join("previous-entries");
    let index = std::fs::read_to_string(dir.join("README.md")).expect("index written");
    assert!(index.contains("entry-01.md"));
    assert!(index.contains("entry-02.md"));

    let first = std::fs::read_to_string(dir.join("entry-01.md")).expect("first entry");
    assert!(first.contains("Space Miner"), "oldest entry is first");
    let second = std::fs::read_to_string(dir.join("entry-02.md")).expect("second entry");
    assert!(second.contains("Tide Pool"));
}

/// The previous-entries folder is reference material, not part of the submission:
/// `init_repo` git-ignores it (via `.git/info/exclude`) so the seed commit does not
/// track it, while the files stay on disk for the model to read.
#[test]
fn init_repo_excludes_the_previous_entries_folder_from_git() {
    let repo = tempfile::tempdir().expect("temp dir");
    // A normal seeded file that must be committed.
    std::fs::write(repo.path().join("package.json"), "{}\n").expect("write package.json");
    seed_prior_game_jam_entries(
        repo.path(),
        &[PriorGameJamEntry {
            run_id: "run-a".to_string(),
            finished_at: "2026-01-01T00:00:00Z".to_string(),
            readme: "# Space Miner".to_string(),
        }],
    )
    .expect("seed prior entries");

    init_repo(repo.path()).expect("init repo");

    let tracked = std::process::Command::new("git")
        .args(["-C", repo.path().to_str().expect("utf-8 path"), "ls-files"])
        .output()
        .expect("git ls-files");
    let tracked = String::from_utf8_lossy(&tracked.stdout);
    assert!(
        tracked.contains("package.json"),
        "normal files are committed"
    );
    assert!(
        !tracked.contains("previous-entries"),
        "the previous-entries folder must not be tracked: {tracked}",
    );
    // The files remain on disk for the model to read during the run.
    assert!(repo.path().join("previous-entries/entry-01.md").exists());
}
