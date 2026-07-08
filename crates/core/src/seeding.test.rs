use super::{reserve_unique_dir, run_timestamp};

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
