//! Tests for building an asset-generation reference implementation.

use super::*;

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
    // must name the override, the cargo target dir, the tool-sprite checkout's
    // target dir, and PATH — not just fail.
    assert!(message.contains("/nonexistent-tcab-bin-dir"), "{message}");
    assert!(message.contains("release"), "{message}");
    assert!(message.contains(TOOL_SPRITE_RELEASE), "{message}");
    assert!(message.contains("$PATH"), "{message}");
    assert!(message.contains("cargo build --release"), "{message}");
    assert!(message.contains("tool-sprite checkout"), "{message}");
}
