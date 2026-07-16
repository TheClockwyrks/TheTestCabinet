//! Tests for the reference-build lockfile: the round-trip, the env-first keying,
//! and the absent-vs-empty distinction the backend reconcile depends on.

use super::*;

#[test]
fn set_and_entries_for_env_round_trip() {
    let mut lock = ReferenceLock::default();
    lock.set("prod", "carom", "v1.1.0", "base", "https://a.pages.dev");
    lock.set("prod", "carom", "v1.1.0", "gyre", "https://b.pages.dev");
    lock.set(
        "staging",
        "carom",
        "v1.1.0",
        "base",
        "https://staging-a.pages.dev",
    );

    let mut prod = lock.entries_for_env("prod").expect("prod is present");
    prod.sort_by(|a, b| a.variant.cmp(&b.variant));
    assert_eq!(prod.len(), 2);
    assert_eq!(prod[0].variant, "base");
    assert_eq!(prod[0].url, "https://a.pages.dev");
    assert_eq!(prod[1].variant, "gyre");

    // The environments are independent — staging holds only its own URL.
    let staging = lock.entries_for_env("staging").expect("staging is present");
    assert_eq!(staging.len(), 1);
    assert_eq!(staging[0].url, "https://staging-a.pages.dev");
}

#[test]
fn set_overwrites_a_redeploy_in_place() {
    let mut lock = ReferenceLock::default();
    lock.set("prod", "carom", "v1.1.0", "base", "https://old.pages.dev");
    lock.set("prod", "carom", "v1.1.0", "base", "https://new.pages.dev");

    let entries = lock.entries_for_env("prod").unwrap();
    assert_eq!(
        entries.len(),
        1,
        "a redeploy overwrites, it does not accumulate"
    );
    assert_eq!(entries[0].url, "https://new.pages.dev");
}

#[test]
fn entries_for_env_distinguishes_absent_from_empty() {
    // An env never written is absent (`None`) — a reader must leave its table alone.
    let lock = ReferenceLock::default();
    assert!(lock.entries_for_env("prod").is_none());

    // A round-trip of an env-with-no-cases stays present-but-empty (`Some([])`) so a
    // reader reconciles to empty rather than skipping.
    let json = r#"{ "prod": {} }"#;
    let lock: ReferenceLock = serde_json::from_str(json).unwrap();
    let entries = lock.entries_for_env("prod").expect("prod key is present");
    assert!(entries.is_empty());
    assert!(lock.entries_for_env("staging").is_none());
}

#[test]
fn serializes_transparently_env_first_and_sorted() {
    let mut lock = ReferenceLock::default();
    // Insert out of order to prove BTreeMap sorts the serialized keys.
    lock.set("prod", "shatter", "v1.0.1", "base", "https://s.pages.dev");
    lock.set("prod", "carom", "v1.1.0", "base", "https://c.pages.dev");

    let json = serde_json::to_string(&lock).unwrap();
    // No wrapper object (transparent), env first, and `carom` before `shatter`.
    assert!(json.starts_with("{\"prod\":{\"carom\":"), "got: {json}");
    assert!(json.find("carom").unwrap() < json.find("shatter").unwrap());
}

#[test]
fn load_missing_file_is_none_not_error() {
    let dir = std::env::temp_dir().join("tcab-reference-lock-test-missing");
    let path = dir.join("does-not-exist.json");
    assert!(ReferenceLock::load(&path).unwrap().is_none());
}

#[test]
fn save_then_load_round_trips() {
    let dir = std::env::temp_dir().join("tcab-reference-lock-test-roundtrip");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join(REFERENCE_LOCK_FILENAME);

    let mut lock = ReferenceLock::default();
    lock.set("prod", "carom", "v1.1.0", "base", "https://a.pages.dev");
    lock.save(&path).unwrap();

    let loaded = ReferenceLock::load(&path).unwrap().expect("file exists");
    assert_eq!(loaded, lock);

    std::fs::remove_dir_all(&dir).ok();
}
