//! The answers that are Swift's own, and the lexer underneath them.
//!
//! What is deliberately **not** here is a second copy of the skeleton's tests. Fence stripping,
//! prose stripping, the fixpoint loop, the operator's record and the delete-only invariant are
//! asserted once in `healing.test.rs` against every registered dialect, this one included. What this
//! file asserts is the part that is Swift's — and some of it is written as a **comparison against
//! another arm**, because this dialect's lexer survives text another's does not.

use test_cabinet_core::gg::GgProgramLanguage;

use super::SWIFT_DIALECT;
use crate::healing::Dialect;

/// Replies in Swift that the [delete-only invariant](crate::healing::Dialect::fixtures) is re-earned
/// over.
///
/// Every one of them exercises an answer that is this dialect's rather than the skeleton's: a raw
/// string and a multi-line string whose bodies must not be read as code, an interpolation carrying a
/// nested quote, an `extension` and a `protocol` in the same program, both shapes of the `Task`
/// wrapper and a doubled program — replies nothing here is done to, which are still replies the
/// invariant holds over — an apostrophe in a line of English, a `#` line that is prose here, and two
/// replies that are no program at all.
pub(super) const FIXTURES: &[&str] = &[
    "Here is the program.\n\n```swift\nlet rows = try files.listDir(\"src\")\ntry views.openText(\"rows\", rows.map(\\.name).joined(separator: \"\\n\"))\n```\n\nThat lists the directory.",
    "Task {\n    try views.openText(\"note\", \"done\")\n}",
    "import Collections\n\nTask {\n    let rows = try files.listDir(\"src\")\n    try views.openText(\"rows\", rows.map(\\.name).joined(separator: \"\\n\"))\n}",
    "let work = Task {\n    try views.openText(\"note\", \"done\")\n}\n_ = await work.value",
    "Task {\n    let notes = try await files.readTextFile(\"notes.md\")\n    try views.openText(\"notes\", notes)\n}",
    "import Foundation\n\nlet stamp = Date().timeIntervalSince1970\ntry views.openText(\"stamp\", \"\\(stamp)\")",
    "let total = 1\ntry views.openText(\"n\", \"\\(total)\")\nlet total = 1\ntry views.openText(\"n\", \"\\(total)\")",
    "func helper() -> Int { 1 }\ntry views.openText(\"n\", \"\\(helper())\")\nfunc helper() -> Int { 1 }\ntry views.openText(\"n\", \"\\(helper())\")",
    "let usage = #\"\"\"\n    Example:\n\n    Task {\n        let total = 1\n    }\n\"\"\"#\ntry views.openText(\"usage\", usage)",
    "let rows = [\"a\": 1]\ntry views.openText(\"n\", \"total: \\(rows[\"a\"] ?? 0)\")",
    "protocol Named {\n    var label: String { get }\n}\n\nextension files.DirEntry: Named {\n    var label: String { name }\n}\n\nlet rows = try files.listDir(\"src\")\ntry views.openText(\"rows\", rows.map(\\.label).joined(separator: \"\\n\"))",
    "I couldn't finish that.\n\n```swift\ntry views.openText(\"note\", \"partial\")\n```",
    "# Plan\n\nlet total = 1\ntry views.openText(\"total\", \"\\(total)\")",
    "I have finished the task. Everything works.",
];

/// This dialect, as the skeleton takes it.
fn swift() -> &'static dyn Dialect {
    &SWIFT_DIALECT
}

/// [Kotlin's](super::super::kotlin::healing), whose lexer an apostrophe defeats and this one's does
/// not.
fn kotlin() -> &'static dyn Dialect {
    crate::sandbox::language(GgProgramLanguage::Kotlin).healing()
}

/// The mask of `src`, for a test that is about what the lexer read.
fn mask(src: &str) -> crate::healing::CodeMask {
    swift().code_mask(src).expect("this source lexes")
}

/// Whether every byte of `needle` inside `src` was read as code.
fn read_as_code(src: &str, needle: &str) -> bool {
    let mask = mask(src);
    let at = src.find(needle).expect("the needle is in the source");
    (at..at + needle.len()).all(|index| mask.is_code(index))
}

// ---------------------------------------------------------------------------------------------
// The lexer
// ---------------------------------------------------------------------------------------------

/// **An apostrophe in a line of English is ordinary punctuation here.**
///
/// Swift has no character literal at all, so `'` is not a delimiter in this grammar — where Kotlin's
/// scan reads the same byte as an unterminated one and gives up the whole mask. That is what lets a
/// reply with prose wrapped around its program go on being repaired here.
#[test]
fn an_apostrophe_in_prose_lexes_here_and_not_in_kotlin() {
    let reply = "I couldn't finish that.\n\nlet total = 1\n";
    assert!(swift().code_mask(reply).is_some());
    assert!(
        kotlin().code_mask(reply).is_none(),
        "the comparison is the point: Kotlin's scan loses its place on the same byte",
    );
}

/// **An interpolation's contents are code, and a quote inside one closes nothing.**
///
/// `"total: \(rows["a"] ?? 0)"` is one string. A scan that stopped at the quote before `a` would
/// read the rest of the line as code and every strategy consulting the mask would be reading the
/// wrong text.
#[test]
fn an_interpolation_is_followed_through_with_its_nested_quotes() {
    let src = "try views.openText(\"n\", \"total: \\(rows[\"a\"] ?? 0)\")\nlet after = 1\n";
    assert!(read_as_code(src, "rows["), "the splice is code");
    assert!(read_as_code(src, "let after"), "and the scan came back out");
    assert!(!mask(src).is_code(src.find("total: ").expect("the literal is there")));
}

/// **A raw string's `\` and `"` mean nothing, and its fence has to be counted.**
#[test]
fn a_raw_strings_fence_is_counted() {
    let src = "let usage = #\"a \" b \\(not) c\"#\nlet after = 1\n";
    assert!(!mask(src).is_code(src.find("not").expect("the body is there")));
    assert!(read_as_code(src, "let after"));
}

/// **A multi-line string may carry a newline and a single-line one may not.**
///
/// Both open with the same byte, so the triple has to be recognised first; and a `"` still open at a
/// `\n` is a scan that has lost its place, which is the state that declines the mask.
#[test]
fn a_multiline_string_spans_newlines_and_a_plain_one_declines() {
    let multiline = "let usage = \"\"\"\nTask {\n}\n\"\"\"\nlet after = 1\n";
    assert!(!mask(multiline).is_code(multiline.find("Task").expect("the body is there")));
    assert!(read_as_code(multiline, "let after"));
    assert!(
        swift()
            .code_mask("let broken = \"open\nlet after = 1\n")
            .is_none(),
        "a single-line string cannot carry a newline, so the scan gives up",
    );
}

/// **A nested block comment is one comment**, as it is in Kotlin and Rust and is not in Java.
#[test]
fn block_comments_nest() {
    let src = "/* a /* b */ c */\nlet after = 1\n";
    assert!(!mask(src).is_code(src.find(" c ").expect("the tail is there") + 1));
    assert!(read_as_code(src, "let after"));
}

// ---------------------------------------------------------------------------------------------
// The predicates
// ---------------------------------------------------------------------------------------------

/// **A statement without a `;` is still code**, which is the ending every other C-shaped arm reads
/// first and this one does not have.
#[test]
fn a_call_with_no_semicolon_is_code() {
    assert!(swift().looks_like_code("try views.openText(\"n\", body)"));
    assert!(swift().looks_like_code("let rows = try files.listDir(\"src\")"));
    assert!(swift().looks_like_code("rows.forEach {"));
}

/// **A lead-in that opens with `open` stays deletable**, which is the one keyword this dialect
/// leaves off its list on purpose.
#[test]
fn a_sentence_beginning_open_is_prose() {
    assert!(swift().is_prose_line("open a view of the value you computed"));
    assert!(!swift().is_prose_line("public func parse"));
}

/// **A Markdown bullet is not code**, which is what keeps a reply of prose, fence and prose from
/// being sent to the compiler whole.
#[test]
fn a_bullet_is_not_code() {
    assert!(!swift().looks_like_code("* read the manifest"));
    assert!(!swift().looks_like_code("- list the directory"));
}
