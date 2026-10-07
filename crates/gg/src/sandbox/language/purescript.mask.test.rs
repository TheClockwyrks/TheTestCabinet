//! Tests for **PureScript's code mask** — that each of the lexer's modes is entered, closed and
//! masked where it should be, over sources that are not ASCII.
//!
//! A model's reply is UTF-8, so every mode has to be walked with a multi-byte character inside it:
//! the scan advances a byte at a time, and a delimiter test written as a slice of the source panics
//! the moment the walk stands inside a character. What the mask says about a source is otherwise
//! asserted through [the module analysis](super::super::modules) next door, which is the only thing
//! that reads it.

use super::*;

/// The mask of `src`, which every source here lexes cleanly enough to have one.
fn mask(src: &str) -> CodeMask {
    code_mask(src).expect("the source lexes cleanly")
}

/// The byte range `needle` occupies in `src`.
fn span(src: &str, needle: &str) -> std::ops::Range<usize> {
    let at = src
        .find(needle)
        .expect("the needle is written in the source");
    at..at + needle.len()
}

/// Whether every byte of `needle` is masked out of the code.
fn masked(src: &str, needle: &str) -> bool {
    let mask = mask(src);
    span(src, needle).all(|index| !mask.is_code(index))
}

/// Whether every byte of `needle` is code.
fn code(src: &str, needle: &str) -> bool {
    let mask = mask(src);
    span(src, needle).all(|index| mask.is_code(index))
}

/// **A block comment may hold text outside ASCII**, which is the shape a model writes at the top of
/// a module it has just been asked to write.
#[test]
fn a_block_comment_may_hold_text_outside_ascii() {
    let src = "{- Snake — grid helpers -}\nmodule Helpers where\nreal = 1\n";
    assert!(masked(src, "{- Snake — grid helpers -}"));
    assert!(code(src, "real = 1"));
}

/// **A nested block comment may hold text outside ASCII.**
///
/// The nesting is what makes this more than a repeat of the flat case: the depth is carried across
/// the multi-byte characters, so a scan that lost its place would close on the inner `-}` and read
/// the rest of the comment as code.
#[test]
fn a_nested_block_comment_may_hold_text_outside_ascii() {
    let src = "{- outer {- naïve 🚀 -} still outer -}\nreal = 1\n";
    assert!(masked(src, "{- outer {- naïve 🚀 -} still outer -}"));
    assert!(code(src, "real = 1"));
}

/// **A line comment may hold text outside ASCII**, and ends at its newline rather than at a
/// character inside it.
#[test]
fn a_line_comment_may_hold_text_outside_ascii() {
    let src = "-- naïve — decoy = 1\nreal = 2\n";
    assert!(masked(src, "-- naïve — decoy = 1"));
    assert!(code(src, "real = 2"));
}

/// **A string may hold text outside ASCII**, closing quote included.
#[test]
fn a_string_may_hold_text_outside_ascii() {
    let src = "greet = \"café ☕\"\nreal = 1\n";
    assert!(masked(src, "\"café ☕\""));
    assert!(code(src, "greet"));
    assert!(code(src, "real = 1"));
}

/// **A raw string may hold text outside ASCII**, over as many lines as it likes.
///
/// This is where the mask earns its keep: a module quoting another module's source would otherwise
/// have that module's declarations read as its own.
#[test]
fn a_raw_string_may_hold_text_outside_ascii() {
    let src = "usage = \"\"\"\ndata Colour — Red\nnaïve = 1\n\"\"\"\n\nreal = 2\n";
    assert!(masked(src, "data Colour — Red"));
    assert!(masked(src, "naïve = 1"));
    assert!(code(src, "real = 2"));
}

/// **A character literal holds one character of whatever width**, and the quote that follows an
/// identifier character is a prime whether that character is ASCII or not.
#[test]
fn a_character_literal_holds_one_character_of_any_width() {
    let src = "bullet = '•'\nreal = 1\n";
    assert!(masked(src, "'•'"));
    assert!(code(src, "real = 1"));

    // An ASCII literal and an escape close where they always did.
    assert!(masked("letter = 'a'\n", "'a'"));
    assert!(masked("newline = '\\n'\n", "'\\n'"));

    // A prime continues a name, so the quote is code and the rest of the source keeps its mask.
    let primes = "total' = 1\ncafé' = 2\n";
    assert!(code(primes, "total'"));
    assert!(code(primes, "café'"));
}

/// **A source the scan cannot finish declines the mask**, which is how a reader learns to fall back
/// to reading the lines as they stand.
#[test]
fn a_source_the_scan_cannot_finish_declines_the_mask() {
    // An ordinary string a newline reaches, a raw string with no close, and a block comment with no
    // close — the three states that end a scan uncleanly.
    assert!(code_mask("greet = \"café\nlimit = 1\n").is_none());
    assert!(code_mask("usage = \"\"\"\ncafé\n").is_none());
    assert!(code_mask("{- café\nreal = 1\n").is_none());
}
