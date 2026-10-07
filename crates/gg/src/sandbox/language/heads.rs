//! **A declaration without its body**, cut once for the arms whose bodies open with a brace.
//!
//! A code module's [export](super::ModuleExport) is quoted into a documentation view as its author
//! wrote it, which means everything up to the body and nothing of the body itself. Five languages
//! spell that boundary the same way — C++, C#, ECMAScript, Rust and Swift all open a body with `{`
//! — so the cut lives here rather than five times over, where five copies would be five chances to
//! get one of the two mistakes below.
//!
//! # The two mistakes
//!
//! **Cutting at the first brace** loses a parameter list that has one in it: `function widen({ text,
//! width })` is quoted as `function widen(` by a reading that stops at the first `{` it sees. So the
//! brackets are counted, and a brace inside a parameter list or a subscript is not a body.
//!
//! **Cutting a value's own value away** is the same error from the other side. `constexpr int
//! limits[] = {1, 2};` and `pub static ROOT: Row = Row { id: 0 };` are declarations whose braces are
//! what the reader came for, and a view showing `constexpr int limits[] =` cut away the thing it was
//! quoting. So a `=` at the top level ends the search: what follows it is a value, and a value is
//! part of its declaration.
//!
//! `=>` is the exception the same rule needs, because two of these languages write a body with it —
//! C#'s expression-bodied members and ECMAScript's arrows — and there the arrow is the boundary and
//! not the value.
//!
//! # What it will not do
//!
//! It reads **one line**, like everything else these scans do, so a signature written across several
//! is quoted as far as its first. Nothing here is a parser: where the line runs out, the quote does.

/// `line` without the body it opens, trimmed — what a documentation view quotes.
///
/// The search is for whichever comes first outside any bracket of the declaration's own: a `{`,
/// which opens a body; a `=>`, which opens one too; or a `=`, which opens a **value** and so ends
/// the search having cut nothing.
///
/// A trailing brace goes whether or not it was the cut: a declaration whose body opens at the end of
/// its own line leaves one behind, and `pub fn widen(text: &str) ->` reads as a declaration where
/// `pub fn widen(text: &str) -> String {` reads as a fragment of a file.
pub(super) fn head(line: &str) -> String {
    let mut depth = 0usize;
    let mut characters = line.char_indices().peekable();
    let mut cut = None;
    while let Some((at, character)) = characters.next() {
        match character {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = depth.saturating_sub(1),
            '{' if depth == 0 => {
                cut = Some(at);
                break;
            }
            '=' if depth == 0 => {
                // The arrow that opens a body, against the `=` that opens a value — and against the
                // `==` of an operator declaration, which opens neither and is left whole.
                if characters.peek().map(|(_, next)| *next) == Some('>') {
                    cut = Some(at);
                }
                break;
            }
            _ => {}
        }
    }
    let head = cut.map_or(line, |at| &line[..at]).trim_end();
    head.strip_suffix('{')
        .map_or(head, str::trim_end)
        .to_string()
}

#[cfg(test)]
#[path = "heads.test.rs"]
mod tests;
