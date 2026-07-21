//! Tests for building an asset-generation reference implementation.

use super::*;

#[test]
fn image_keys_round_trip_through_the_parser() {
    let key = reference_image_key("lattice-belt", "v1.0.0", "base", 3);
    assert_eq!(
        key,
        "media/references/lattice-belt/v1.0.0/base/frames/3.png"
    );
    assert_eq!(
        parse_reference_image_key(&key),
        Some(ReferenceMediaKey {
            slug: "lattice-belt".to_string(),
            version: "v1.0.0".to_string(),
            variant: "base".to_string(),
            index: 3,
        })
    );
}

#[test]
fn only_image_keys_parse() {
    // Action logs share the prefix but are not what proves a frame was published,
    // so the discovery side must skip them rather than count them as frames.
    assert_eq!(
        parse_reference_image_key(&reference_actions_key("lattice-belt", "v1.0.0", "base", 3)),
        None
    );
    // Run media lives under a sibling prefix and must never be mistaken for a
    // reference.
    assert_eq!(
        parse_reference_image_key("media/runs/abc/asset/regenerated-3.png"),
        None
    );
    // Structurally wrong keys under the right prefix are rejected, not guessed at.
    assert_eq!(
        parse_reference_image_key("media/references/slug/v1/base/3.png"),
        None
    );
    assert_eq!(
        parse_reference_image_key("media/references/slug/v1/base/frames/notanumber.png"),
        None
    );
}

#[test]
fn shell_quote_wraps_and_escapes_single_quotes() {
    assert_eq!(shell_quote("/tmp/plain"), "'/tmp/plain'");
    assert_eq!(shell_quote("/tmp/with space"), "'/tmp/with space'");
    // The `'\''` dance: close the quote, emit an escaped quote, reopen. Without it
    // a path holding an apostrophe would terminate the argument early and the rest
    // would be read as shell syntax.
    assert_eq!(shell_quote("it's"), r"'it'\''s'");
}

#[test]
fn resolve_binary_dir_prefers_the_explicit_override() {
    let dir = tempfile::tempdir().expect("tempdir");
    let binary = dir.path().join("draw-sheet");
    std::fs::write(&binary, b"#!/bin/sh\n").expect("write binary");

    // SAFETY: single-threaded test process; the variable is restored below.
    unsafe { std::env::set_var(BIN_DIR_ENV, dir.path()) };
    let resolved = resolve_binary_dir("draw-sheet").expect("resolves from the override");
    unsafe { std::env::remove_var(BIN_DIR_ENV) };

    assert_eq!(resolved, dir.path());
}

#[test]
fn resolve_binary_dir_names_every_location_it_tried() {
    // SAFETY: single-threaded test process; the variable is removed after.
    unsafe { std::env::set_var(BIN_DIR_ENV, "/nonexistent-tcab-bin-dir") };
    let err = resolve_binary_dir("tcab-definitely-not-a-real-binary")
        .expect_err("no such binary anywhere");
    unsafe { std::env::remove_var(BIN_DIR_ENV) };

    let message = err.to_string();
    // The message is the first thing an author hits on a fresh checkout, so it
    // must name the override, the cargo target dir, and PATH — not just fail.
    assert!(message.contains("/nonexistent-tcab-bin-dir"), "{message}");
    assert!(message.contains("release"), "{message}");
    assert!(message.contains("$PATH"), "{message}");
    assert!(message.contains("cargo build --release"), "{message}");
}
