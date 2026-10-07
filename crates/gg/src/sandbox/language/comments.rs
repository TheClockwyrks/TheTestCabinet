//! **The comment written above a declaration**, read once for eleven arms.
//!
//! A code module's [export](super::ModuleExport) becomes a documentation view, and the prose in that
//! view is whatever its author wrote above the declaration. That is the one part of an export scan
//! which is the same shape in every language and differs only in the marker: walk up from the
//! declaration while the lines are comments, strip the marker, keep the text. Ten copies of that
//! walk would be ten places for it to drift — one arm ending a run at a blank line, another
//! swallowing the file's own header comment — so the walk lives here and each arm names its markers.
//!
//! # What it will not do
//!
//! It reads **lines**, and only the ones immediately above the declaration. A comment written to the
//! right of a declaration, or below it, or anywhere a blank line separates from it, is not read: the
//! run has to end somewhere, and a blank line is where every language's authors already put the
//! boundary between one declaration's documentation and the file's own prose.
//!
//! Nothing here is a parser, for the reason [nothing in these scans is](super::super): where it
//! cannot tell, it says nothing, and a view that shows a declaration without its prose is smaller
//! than the truth rather than wrong about it.

/// The index of the first line above `index` that is not something to be walked past — an attribute,
/// an annotation, a decorator: the lines a language allows *between* a declaration's documentation
/// and the declaration itself.
///
/// Returned as an index to read a comment run above rather than folded into the readers below,
/// because what stands between the two is the one thing about this that really is per-language:
/// `#[inline]`, `@Override` and `@discardableResult` are three spellings of "still the same
/// declaration".
pub(super) fn above(lines: &[&str], index: usize, ignore: impl Fn(&str) -> bool) -> usize {
    let mut at = index;
    while at > 0 && ignore(lines[at - 1].trim()) {
        at -= 1;
    }
    at
}

/// The run of line comments immediately above `index`, in `markers` spelling, with the marker
/// stripped — or `None` when the line above it is not one.
///
/// `markers` is tried longest-match-first, so an arm that names both `///` and `//` reads a doc
/// comment as documentation rather than as a line of code commented out with an extra slash.
pub(super) fn line_doc(lines: &[&str], index: usize, markers: &[&str]) -> Option<String> {
    let mut run: Vec<&str> = Vec::new();
    let mut at = index;
    while at > 0 {
        let line = lines[at - 1].trim();
        let Some(text) = strip_marker(line, markers) else {
            break;
        };
        run.push(text);
        at -= 1;
    }
    run.reverse();
    joined(run)
}

/// `line` without whichever of `markers` it opens with, and without the single space authors write
/// after one — `None` when it opens with none of them.
fn strip_marker<'a>(line: &'a str, markers: &[&str]) -> Option<&'a str> {
    let marker = markers
        .iter()
        .filter(|marker| line.starts_with(**marker))
        .max_by_key(|marker| marker.len())?;
    Some(
        line[marker.len()..]
            .strip_prefix(' ')
            .unwrap_or(&line[marker.len()..]),
    )
}

/// The `/** … */` block immediately above `index`, with its delimiters and its leading `*` column
/// stripped — or `None` when there is no block there, or the block above is an ordinary `/* … */`.
///
/// The `/**` spelling is the whole test: a `/* … */` above a declaration is a note to whoever reads
/// the file, and the languages that have this form all agree that doubling the star is how an author
/// says the note is *about* the declaration.
///
/// The walk up for the opener is bounded by the block it is looking for **closing** where the search
/// began. A line ending `*/` is not proof that a block starts above it — `const a = 1; /* a note */`
/// ends that way and opens nothing — so a walk that only looked for a `/**` would find whichever one
/// happens to be higher up the file and quote every line between the two, code included, as the
/// declaration's documentation. A `*/` anywhere before the last line of the run is that other
/// block's, and it means the run is not one comment.
pub(super) fn block_doc(lines: &[&str], index: usize) -> Option<String> {
    if index == 0 || !lines[index - 1].trim().ends_with("*/") {
        return None;
    }
    let mut at = index - 1;
    while !lines[at].trim_start().starts_with("/*") {
        if at == 0 {
            return None;
        }
        at -= 1;
    }
    if !lines[at].trim_start().starts_with("/**") {
        return None;
    }
    // Everything but the closing line, which is where the only `*/` of one block stands.
    if lines[at..index - 1].iter().any(|line| line.contains("*/")) {
        return None;
    }
    let mut run: Vec<&str> = Vec::new();
    for (number, line) in lines[at..index].iter().enumerate() {
        let mut text = line.trim();
        if number == 0 {
            text = text.strip_prefix("/**").unwrap_or(text);
        }
        if number == index - at - 1 {
            text = text.strip_suffix("*/").unwrap_or(text).trim_end();
        }
        let text = text.strip_prefix('*').unwrap_or(text);
        run.push(text.strip_prefix(' ').unwrap_or(text));
    }
    joined(run)
}

/// `run` as one string, trimmed of the blank lines a comment block opens and closes with — `None`
/// when nothing but blanks was written, so a bare `/** */` reads as no documentation at all.
fn joined(run: Vec<&str>) -> Option<String> {
    let text = run.join("\n");
    let text = text.trim_matches('\n').trim_end();
    (!text.trim().is_empty()).then(|| text.to_string())
}

#[cfg(test)]
#[path = "comments.test.rs"]
mod tests;
