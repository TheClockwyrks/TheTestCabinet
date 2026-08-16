//! The answers that are Rust's own, and the lexer underneath them.
//!
//! What is deliberately **not** here is a second copy of the skeleton's tests. Fence stripping,
//! prose stripping, the fixpoint loop, the honesty disclosure and the delete-only invariant are
//! asserted once in `healing.test.rs` against every registered dialect, this one included. What this
//! file asserts is the part that is Rust's — the lexer that reads text no other arm's can, and the
//! two predicates whose lists are this dialect's own. Where an answer is only interesting beside
//! another arm's, the test is written as a **comparison** against it.

use test_cabinet_core::gg::GgProgramLanguage;

use super::RUST_DIALECT;
use crate::healing::Dialect;

/// Replies in Rust that the [delete-only invariant](crate::healing::Dialect::fixtures) is re-earned
/// over.
///
/// The shapes a model really sends on this arm, whether or not any strategy has something to say
/// about one: a fenced program with prose either side, programs written around `thread::spawn` and
/// `.await`, a doubled program and a program doubled around nothing but `let`s, a `use` line above
/// the work, a raw string whose body must not be read as code, a lifetime and a character literal in
/// the same program, an apostrophe in a line of English, a `#` line that is prose here, and two
/// replies that are no program at all.
pub(super) const FIXTURES: &[&str] = &[
    "Here is the program.\n\n```rust\nuse gg::{files, views};\n\nfn main() -> Result<(), gg::Failure> {\n    let rows = files::list_dir(Some(\"src\"))?;\n    views::open_text(\"rows\", &format!(\"{rows:?}\"))?;\n    Ok(())\n}\n```\n\nThat lists the directory.",
    "fn main() {\n    std::thread::spawn(|| {\n        gg::views::open_text(\"note\", \"done\")\n    }).join().unwrap();\n}",
    "use std::thread;\n\nfn main() {\n    thread::spawn(move || {\n        let rows = gg::files::list_dir(Some(\"src\"))?;\n        gg::views::open_text(\"rows\", &format!(\"{rows:?}\"))?;\n    }).join().unwrap();\n}",
    "fn main() {\n    let handle = std::thread::spawn(|| {\n        gg::views::open_text(\"note\", \"done\")\n    });\n    handle.join().expect(\"worker panicked\");\n}",
    "fn main() {\n    std::thread::spawn(|| {\n        let notes = gg::files::read_text_file(\"notes.md\", gg::files::ReadOptions::default()).await;\n        gg::views::open_text(\"notes\", &notes)?;\n    }).join().unwrap();\n}",
    "use std::collections::HashMap;\n\nfn main() -> Result<(), gg::Failure> {\n    let mut counts: HashMap<&str, usize> = HashMap::new();\n    counts.insert(\"src\", 1);\n    gg::views::open_text(\"counts\", &format!(\"{counts:?}\"))?;\n    Ok(())\n}",
    "fn helper() -> usize { 1 }\nfn main() -> Result<(), gg::Failure> {\n    gg::views::open_text(\"n\", &helper().to_string())?;\n    Ok(())\n}\nfn helper() -> usize { 1 }\nfn main() -> Result<(), gg::Failure> {\n    gg::views::open_text(\"n\", &helper().to_string())?;\n    Ok(())\n}",
    "fn main() -> Result<(), gg::Failure> {\n    let total = 1;\n    gg::views::open_text(\"n\", &total.to_string())?;\n    let total = 1;\n    gg::views::open_text(\"n\", &total.to_string())?;\n    Ok(())\n}",
    "fn main() -> Result<(), gg::Failure> {\n    let usage = r#\"\n    Example:\n\n    std::thread::spawn(|| {\n        let total = 1;\n    });\n\"#;\n    gg::views::open_text(\"usage\", usage)?;\n    Ok(())\n}",
    "fn first(rows: &'static [&'static str]) -> char {\n    rows.first().map(|row| row.chars().next().unwrap_or('?')).unwrap_or('!')\n}\n\nfn main() -> Result<(), gg::Failure> {\n    gg::views::open_text(\"c\", &first(&[\"a\"]).to_string())?;\n    Ok(())\n}",
    "I couldn't finish that.\n\n```rust\nfn main() -> Result<(), gg::Failure> {\n    gg::views::open_text(\"note\", \"partial\")?;\n    Ok(())\n}\n```",
    "# Plan\n\nfn main() -> Result<(), gg::Failure> {\n    let total = 1;\n    gg::views::open_text(\"total\", &total.to_string())?;\n    Ok(())\n}",
    "I have finished the task. Everything works.",
];

/// This dialect, as the skeleton takes it.
fn rust() -> &'static dyn Dialect {
    &RUST_DIALECT
}

/// [Kotlin's](super::super::kotlin::healing), for the comparisons this file makes.
fn kotlin() -> &'static dyn Dialect {
    crate::sandbox::language(GgProgramLanguage::Kotlin).healing()
}

/// The mask of `src`, for a test that is about what the lexer read.
fn mask(src: &str) -> crate::healing::CodeMask {
    rust().code_mask(src).expect("this source lexes")
}

// ---------------------------------------------------------------------------------------------
// The lexer
// ---------------------------------------------------------------------------------------------

/// **A lifetime is not an opening quote, and a character literal is.**
///
/// The hazard no other arm's `'` carries. A scan that took the `'` of `&'static str` as an opener
/// would swallow the rest of the program into a string, and every reading built on the mask would
/// then be of the wrong text.
#[test]
fn a_lifetime_is_code_and_a_character_literal_is_not() {
    let src = "fn first(rows: &'static [&'static str]) -> char {\n    \
                   rows.first().map(|row| row.chars().next().unwrap_or('?')).unwrap_or('!')\n\
               }\nlet marker = 'x';\n";
    let mask = mask(src);
    // Everything after the last lifetime is still code: the `}` that closes the function is found.
    let close = src.rfind('}').expect("the function closes");
    assert!(mask.is_code(close), "a lifetime swallowed the program");
    // The character inside `'x'` is not.
    let literal = src.find("'x'").expect("the literal is there");
    assert!(!mask.is_code(literal + 1), "`'x'` was read as code");
    assert!(mask.is_code(src.find("&'static").expect("a lifetime") + 1));
}

/// **An apostrophe in a line of English does not decline the mask.**
///
/// A consequence of the same rule, and a valuable one: a reply of prose around a program still
/// lexes here, where the identical apostrophe leaves [Kotlin's](super::super::kotlin::healing)
/// scan with an unterminated character literal and no mask at all.
#[test]
fn an_apostrophe_in_prose_lexes_here_and_does_not_on_a_single_quote_arm() {
    let reply = "I couldn't finish that.\n\nview::open_text(\"note\", \"x\")?;";
    assert!(rust().code_mask(reply).is_some());
    assert!(
        kotlin().code_mask(reply).is_none(),
        "the comparison this test is about no longer holds"
    );
}

/// **A string may span newlines here**, which is the opposite of every other C-shaped arm.
#[test]
fn a_string_may_span_newlines() {
    let src = "let note = \"first\nsecond\";\nview::open_text(\"n\", note)?;\n";
    let mask = mask(src);
    let inside = src
        .find("second")
        .expect("the second line is inside the string");
    assert!(!mask.is_code(inside), "a newline ended the string");
    assert!(mask.is_code(src.find("view::").expect("the call")));
}

/// **A raw string's fence is counted**, so a `"` inside `r#"…"#` closes nothing.
#[test]
fn a_raw_strings_fence_is_counted() {
    let src = "let json = r#\"{\"name\": \"x\"}\"#;\nview::open_text(\"json\", json)?;\n";
    let mask = mask(src);
    let inside = src.find("name").expect("the body");
    assert!(!mask.is_code(inside));
    assert!(mask.is_code(src.find("view::").expect("the call")));

    // And the `r` of an ordinary identifier is not a raw-string opener.
    assert!(
        rust()
            .code_mask("for row in rows {\n    let _ = row;\n}\n")
            .is_some()
    );
}

/// **Block comments nest**, as they do in Rust and do not in Java.
#[test]
fn block_comments_nest() {
    let src = "/* outer /* inner */ still comment */\nview::open_text(\"n\", \"1\")?;\n";
    let mask = mask(src);
    assert!(!mask.is_code(src.find("still").expect("inside the comment")));
    assert!(mask.is_code(src.find("view::").expect("the call")));
}

/// **An unterminated string declines the whole mask**, which is the one thing that still does.
#[test]
fn an_unterminated_string_declines_the_mask() {
    assert!(rust().code_mask("let note = \"unterminated;\n").is_none());
    assert!(
        rust()
            .code_mask("/* never closed\nview::open_text(\"n\", \"1\")?;\n")
            .is_none()
    );
}

// ---------------------------------------------------------------------------------------------
// The predicates
// ---------------------------------------------------------------------------------------------

/// **"Use `x` to …" is prose here**, which is why `use` is not on this dialect's keyword list.
///
/// It is the single most common lead-in a model writes, and gg's own system prompt writes it. A
/// keyword list that carried `use` would make that line un-deletable and cost the turn — and would
/// buy nothing, because every real `use` line ends in a `;` that the endings clause reads anyway.
#[test]
fn a_sentence_beginning_use_is_prose_and_a_use_statement_is_code() {
    assert!(rust().is_prose_line("Use the fs object to read a file."));
    assert!(!rust().looks_like_code("Use the fs object to read a file."));
    assert!(rust().looks_like_code("use std::collections::HashMap;"));
    assert!(!rust().is_prose_line("use std::collections::HashMap;"));
}

/// **A backtick makes a line prose here**, which is [Java's answer](super::super::java::healing) and
/// not [Kotlin's](super::super::kotlin::healing).
///
/// Rust has no backtick anywhere in its grammar — an identifier that needs escaping is written
/// `r#type` — so a line carrying one is certainly not Rust and a lead-in written with an inline code
/// span may be deleted.
#[test]
fn a_line_with_a_backtick_is_prose_here_and_is_not_on_a_backquoted_identifier_arm() {
    let line = "Then read the manifest with the fs object";
    assert!(rust().is_prose_line(line));
    let quoted = "Then read the manifest first";
    assert!(rust().is_prose_line(quoted));
    // The comparison the doc comment is about: a backtick is code punctuation on Kotlin's arm.
    let spanned = "Read the manifest with `readFile` first";
    assert!(rust().is_prose_line(spanned));
    assert!(!kotlin().is_prose_line(spanned));
}

/// **A path is code**, and it is Rust's most distinctive punctuation.
#[test]
fn a_path_is_code_and_never_prose() {
    for line in ["let entry = std::path::Path::new(\"a\")", "EntryKind::File"] {
        assert!(rust().looks_like_code(line), "{line}");
        assert!(!rust().is_prose_line(line), "{line}");
    }
}

/// **An attribute, a macro call and a chain continuation are all code.**
#[test]
fn the_shapes_only_rust_has_are_code() {
    for line in [
        "#[derive(Debug, Clone)]",
        "#![allow(unused)]",
        "println!(\"x\")",
        ".map(|row| row.name.clone())",
        "total += 1",
        "|row| row.len()",
    ] {
        assert!(rust().looks_like_code(line), "{line}");
    }
}

/// **An ordinary English sentence is not code**, however many technical words it carries.
#[test]
fn a_sentence_is_not_code() {
    for line in [
        "Here is the program that lists the directory.",
        "I have finished the task. Everything works.",
        "First read the manifest and then write the summary.",
        "* read the manifest",
    ] {
        assert!(!rust().looks_like_code(line), "{line}");
    }
}

/// **The fence tags are this language's**, and a block tagged for something else is not the program.
#[test]
fn the_program_fence_tags_are_rusts() {
    assert_eq!(rust().program_fence_tags(), &["rust", "rs"]);
}
