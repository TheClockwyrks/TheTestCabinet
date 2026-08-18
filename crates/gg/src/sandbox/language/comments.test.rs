//! What the shared comment reader owes every arm that documents a code module's exports.

use super::{above, block_doc, line_doc};

/// **A run of line comments is one piece of prose**, joined in the order it was written.
#[test]
fn a_run_of_line_comments_reads_as_one_document() {
    let lines = [
        "/// Widen a row.",
        "/// The second line.",
        "pub fn widen() {}",
    ];
    assert_eq!(
        line_doc(&lines, 2, &["///", "//"]),
        Some("Widen a row.\nThe second line.".to_string())
    );
}

/// **A blank line ends the run**, so the file's own header is not read as the first declaration's
/// documentation.
#[test]
fn a_blank_line_ends_the_run() {
    let lines = [
        "// A module of helpers.",
        "",
        "// Widen a row.",
        "def widen():",
    ];
    assert_eq!(
        line_doc(&lines, 3, &["//"]),
        Some("Widen a row.".to_string())
    );
}

/// **The longest marker wins**, so `///` is documentation rather than a `//` with a stray slash in
/// its text.
#[test]
fn the_longest_marker_is_the_one_stripped() {
    let lines = ["/// Widen a row.", "fn widen() {}"];
    assert_eq!(
        line_doc(&lines, 1, &["//", "///"]),
        Some("Widen a row.".to_string())
    );
}

/// **Nothing above is nothing to show**, and neither is a run of empty comment markers.
#[test]
fn an_undocumented_declaration_reads_as_none() {
    assert_eq!(line_doc(&["fn widen() {}"], 0, &["///"]), None);
    assert_eq!(line_doc(&["///", "fn widen() {}"], 1, &["///"]), None);
}

/// **A `/** … */` block is read; a plain `/* … */` is not** — doubling the star is how an author
/// says the note is about the declaration below it.
#[test]
fn a_doc_block_is_read_and_a_plain_block_is_not() {
    let documented = [
        "/**",
        " * Widen a row.",
        " */",
        "public static String widen() {}",
    ];
    assert_eq!(block_doc(&documented, 3), Some("Widen a row.".to_string()));

    let noted = [
        "/*",
        " * A note to the reader.",
        " */",
        "public static String widen() {}",
    ];
    assert_eq!(block_doc(&noted, 3), None);
}

/// **A one-line block counts**, because that is how a short one is written.
#[test]
fn a_single_line_doc_block_is_read() {
    let lines = ["/** Widen a row. */", "fun widen() {}"];
    assert_eq!(block_doc(&lines, 1), Some("Widen a row.".to_string()));
}

/// **An attribute between the two does not detach them**: the run is read from above whatever the
/// arm says to walk past.
#[test]
fn an_attribute_line_is_walked_past() {
    let lines = ["/// Widen a row.", "#[inline]", "pub fn widen() {}"];
    let at = above(&lines, 2, |line| line.starts_with('#'));
    assert_eq!(at, 1);
    assert_eq!(
        line_doc(&lines, at, &["///"]),
        Some("Widen a row.".to_string())
    );
}

/// **A line that merely *ends* in `*/` opens nothing**, so the walk up for a block's opener cannot
/// run past it into some earlier one.
///
/// The failure this rules out is not a missing sentence but a wrong one: with a `/**` block anywhere
/// above it, a declaration whose preceding line carries a trailing `/* … */` was documented with
/// that far block's text *and every line of code between the two*. A view is allowed to say less
/// than the truth; it is not allowed to quote the file back as prose.
#[test]
fn a_trailing_block_comment_above_a_declaration_is_not_its_documentation() {
    let lines = [
        "/** The module's own header. */",
        "const setup = 1; /* a note to the reader */",
        "export function parse(text) {}",
    ];
    assert_eq!(block_doc(&lines, 2), None);
}

/// **A block that really is one is still read**, however many lines stand inside it — which is what
/// makes the rule above a statement about `*/` closing somebody else's block rather than a ban on
/// blocks with more than one line.
#[test]
fn a_multi_line_doc_block_directly_above_is_still_read() {
    let lines = [
        "/** The module's own header. */",
        "const setup = 1;",
        "",
        "/**",
        " * Parse a row.",
        " * The second line.",
        " */",
        "export function parse(text) {}",
    ];
    assert_eq!(
        block_doc(&lines, 7),
        Some("Parse a row.\nThe second line.".to_string())
    );
}
