//! **Python's [healing dialect](crate::healing::Dialect)** — the lexical half of
//! [response healing](crate::healing), answered in Python's own terms.
//!
//! The three questions the healing skeleton asks and cannot answer itself — the fence tags and the
//! two line predicates — are answered here in Python's spelling rather than the ECMAScript arm's, a
//! difference of syntax rather than of discipline. The fourth question on the trait, the
//! [mask](Dialect::code_mask), is one healing never asks: it sits beside the other three because it
//! is the same kind of lexical question, and what reads it is
//! [this arm's module analysis](super::modules), which must not take a `def` written inside a
//! docstring for one the module declares.
//!
//! # Fence tags and the two line predicates
//!
//! A line of Python ends with `:` where a line of JavaScript ends with `{`, opens with `def` where
//! the other opens with `function`, and comments with `#` rather than `//` — but the discipline is
//! identical, and it is the asymmetry that matters rather than the clauses. [`looks_like_code`] may
//! cost a fence that could have been unwrapped; [`is_prose_line`] *deletes the model's line*. So
//! every clause of the first is a shape only code has, every clause of the second is a shape only
//! English has, and where neither can tell, both decline.
//!
//! The `#` character is where that asymmetry bites hardest here, and it is worth naming because it
//! is the one thing a reader would otherwise call a bug. `# note` is a Python comment *and* a
//! Markdown heading, and nothing lexical tells them apart. It is therefore listed among the
//! characters no prose line contains — so a `#` line is never deleted as prose, and a model that
//! headed its explanation `## Plan` keeps that heading in its program, where the guest reads it as a
//! comment and it costs nothing.
//!
//! # None of these is a parser
//!
//! Not one predicate here parses, for the reason [TypeScript's dialect](super::super::typescript::healing)
//! gives: healing runs on text that is not yet known to be a program. Unlike that arm, gg has no
//! Python parser to decline to use — [preparing a Python program](super) hands the source
//! across untouched and CPython itself is the first thing to read it — so every answer below is a
//! lexical shape test, and each declines rather than guessing.

use crate::healing::{CodeMask, Dialect};

/// Python's dialect. A unit struct: everything it "holds" is the `const` data below.
pub(in crate::sandbox::language) struct PythonDialect;

/// The one instance, held by [`Python`](super::Python) and handed out as `&'static dyn Dialect`.
pub(in crate::sandbox::language) static PYTHON_DIALECT: PythonDialect = PythonDialect;

impl Dialect for PythonDialect {
    fn program_fence_tags(&self) -> &'static [&'static str] {
        PROGRAM_TAGS
    }

    fn looks_like_code(&self, line: &str) -> bool {
        looks_like_code(line)
    }

    fn is_prose_line(&self, line: &str) -> bool {
        is_prose_line(line)
    }

    fn code_mask(&self, src: &str) -> Option<CodeMask> {
        code_mask(src)
    }

    #[cfg(test)]
    fn fixtures(&self) -> &'static [&'static str] {
        tests::FIXTURES
    }
}

/// The info-string tags gg reads as "this block is the program", lower-cased.
///
/// A closed, recognised list, on the same terms [TypeScript's](super::super::typescript::healing) is: a
/// block tagged `json`, `text` or `bash` is context the model showed rather than the program, and
/// tier 3 of the candidacy ladder is what keeps the closed list from being a trap.
///
/// `pycon` and `doctest` are deliberately **absent**. Both name a *transcript* of an interactive
/// session — every line prefixed `>>>`, with the interpreter's answers interleaved — which is not a
/// program and would not run as one.
const PROGRAM_TAGS: &[&str] = &["python", "py", "python3", "py3", "pyw", "ipython"];

/// The statement keywords a line of Python code may open with, matched **case-sensitively** at an
/// identifier boundary.
///
/// Case-sensitivity is what keeps `If you want to…` prose while `if x:` is code, and it is the same
/// distinction a real reply turned on for the other arm. A few are ordinary English words in lower
/// case too (`for`, `with`, `while`), and that is safe in both directions here: a prose line
/// mistaken for code costs a fence that could have been unwrapped, and the same list is what stops
/// [`is_prose_line`] from ever deleting a statement.
///
/// It is the **keywords** and nothing else. `print` is not here even though it opens more lines of a
/// model's Python than any keyword does: it is an ordinary name, `opens_with_call` already reads
/// `print(` as code, and listing it would additionally stop `print the plan first` from ever being
/// deleted as prose. The same reasoning keeps `not`, `and`, `or` and `in` out — all four are
/// operators rather than statement openers, and all four open English clauses.
const STATEMENT_KEYWORDS: [&str; 28] = [
    "def", "class", "return", "yield", "if", "elif", "else", "for", "while", "with", "try",
    "except", "finally", "raise", "assert", "import", "from", "global", "nonlocal", "lambda",
    "pass", "break", "continue", "del", "async", "await", "match", "case",
];

/// The keywords that open a **block**, and so the only lines whose trailing `:` is proof of code.
///
/// A trailing colon on its own is not: `Here is the plan:` is the most ordinary sentence a model
/// writes above its program. Pairing the colon with the keyword that opened the block is what makes
/// the clause a shape only code has.
const BLOCK_KEYWORDS: [&str; 13] = [
    "def", "class", "if", "elif", "else", "for", "while", "with", "try", "except", "finally",
    "match", "case",
];

/// The tokens a line of code may end with — a statement continued, a collection left open, or a
/// block about to be opened.
const CODE_ENDINGS: [&str; 6] = [",", "(", "[", "{", "\\", "="];

/// Characters no line of English prose contains.
///
/// `#` is here and is the one entry worth explaining: it opens a Python comment *and* a Markdown
/// heading, and nothing lexical tells them apart. Listing it means a `#` line is never deleted as
/// prose — so a comment survives, which is what matters, and a heading survives too, which costs a
/// line of comment in the program and nothing else.
const NON_PROSE_CHARS: [char; 16] = [
    '`', '#', ';', '{', '}', '(', ')', '[', ']', '=', '<', '>', '|', '&', '$', '\\',
];

// ---------------------------------------------------------------------------------------------
// The line predicates
// ---------------------------------------------------------------------------------------------

/// Whether `line` is **certainly** a line of Python — this dialect's answer to
/// [`Dialect::looks_like_code`].
///
/// Its errors are asymmetric on purpose: a false positive costs a fence that could have been
/// unwrapped (one turn, one located diagnostic), while a false negative deletes a line of the
/// model's program. So every clause below is a shape that only code has.
fn looks_like_code(line: &str) -> bool {
    let line = line.trim();
    if line.is_empty() {
        return false;
    }
    // 1. It opens a block: a block keyword, and a `:` at the end of the line.
    if line.ends_with(':') && starts_with_any(line, &BLOCK_KEYWORDS) {
        return true;
    }
    // 2. It opens with a statement keyword.
    if starts_with_any(line, &STATEMENT_KEYWORDS) {
        return true;
    }
    // 3. It opens with a closer, a comment or a decorator.
    if line.starts_with([')', ']', '}', '#', '@']) {
        return true;
    }
    // 4. It is left open at the end.
    if CODE_ENDINGS.iter().any(|ending| line.ends_with(ending)) {
        return true;
    }
    // 5. It assigns: a plain or dotted or subscripted target, then a single `=`.
    if is_assignment(line) {
        return true;
    }
    // 6. It opens with a call: an identifier or dotted chain immediately followed by `(`.
    opens_with_call(line)
}

/// Whether `line` opens with one of `keywords` at an identifier boundary.
fn starts_with_any(line: &str, keywords: &[&str]) -> bool {
    keywords.iter().any(|keyword| {
        line.strip_prefix(keyword)
            .is_some_and(|rest| rest.chars().next().is_none_or(|c| !is_ident_char(c)))
    })
}

/// Whether `line` is an assignment whose target is a name — `total = 1`, `self.count += 1`,
/// `rows[0] = x`, `total: int = 1`.
///
/// The target has to be a *name-shaped* thing for the clause to mean anything: `Rewrite = better`
/// would otherwise read two words of English as an assignment. A comparison (`==`, `!=`, `<=`,
/// `>=`) is not an assignment and is excluded, though a line containing one is already kept out of
/// prose by [`NON_PROSE_CHARS`].
fn is_assignment(line: &str) -> bool {
    let Some(at) = find_assignment(line) else {
        return false;
    };
    let target = line[..at].trim_end();
    // An augmented assignment (`+=`, `//=`, `|=`) carries its operator on the target's side.
    let target =
        target.trim_end_matches(['+', '-', '*', '/', '%', '@', '&', '|', '^', '<', '>', '~']);
    // An annotated assignment carries its type there instead: `total: int = 1`.
    let target = target.split(':').next().unwrap_or_default().trim();
    !target.is_empty() && is_name_shaped(target)
}

/// The offset of the `=` that assigns, skipping every `=` that is part of a comparison.
fn find_assignment(line: &str) -> Option<usize> {
    let bytes = line.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'=' {
            index += 1;
            continue;
        }
        if bytes.get(index + 1) == Some(&b'=') {
            index += 2;
            continue;
        }
        if index > 0 && matches!(bytes[index - 1], b'=' | b'!' | b'<' | b'>') {
            index += 1;
            continue;
        }
        return Some(index);
    }
    None
}

/// Whether `text` is a name, a dotted chain of names, or either with a subscript — the shapes an
/// assignment target takes.
fn is_name_shaped(text: &str) -> bool {
    let head = text.split(['[', '(']).next().unwrap_or_default();
    if head.is_empty() || head.trim() != head {
        return false;
    }
    head.split('.').all(|part| {
        !part.is_empty() && part.starts_with(is_ident_start) && part.chars().all(is_ident_char)
    })
}

/// Whether `line` opens with `identifier(`, `a.b(` or `a.b.c(` — `print(`, `views.open_file(`,
/// `entries.append(`.
fn opens_with_call(line: &str) -> bool {
    let mut chars = line.char_indices().peekable();
    let Some((_, first)) = chars.peek().copied() else {
        return false;
    };
    if !is_ident_start(first) {
        return false;
    }
    let mut end = 0;
    while let Some((index, c)) = chars.peek().copied() {
        if is_ident_char(c) {
            end = index + c.len_utf8();
            chars.next();
            continue;
        }
        // A dot continues the chain only when a further identifier follows it; otherwise the chain
        // ended at the previous character, which is what keeps `Done. Wrote the file.` prose.
        if c == '.' {
            let mut lookahead = chars.clone();
            lookahead.next();
            if lookahead
                .peek()
                .is_some_and(|(_, next)| is_ident_start(*next))
            {
                chars.next();
                continue;
            }
        }
        break;
    }
    line[end..].starts_with('(')
}

/// Whether `line` is **certainly** prose rather than Python — this dialect's answer to
/// [`Dialect::is_prose_line`], and the test `strip-prose` uses to *delete* a line.
///
/// The mirror image of [`looks_like_code`], with the asymmetry the other way round: a false positive
/// here deletes the model's code, so every clause is a shape only English has. The two are
/// deliberately not complements and not disjoint, and the pipeline's fixpoint loop resolves the
/// overlap.
fn is_prose_line(line: &str) -> bool {
    let line = line.trim();
    if line.is_empty() {
        return false;
    }
    // 1. No character that only code uses — which here includes `#`, because a Python comment and a
    //    Markdown heading are the same three bytes.
    if line.contains(NON_PROSE_CHARS) {
        return false;
    }
    // 2. Not a statement, and not the head of a block.
    if starts_with_any(line, &STATEMENT_KEYWORDS) {
        return false;
    }
    // 3. A sentence, or a single terminated word.
    let mut tokens = line.split_whitespace();
    let (Some(first), second) = (tokens.next(), tokens.next()) else {
        return false;
    };
    if second.is_some() {
        return [first]
            .into_iter()
            .chain(second)
            .chain(tokens)
            .any(has_letter_run);
    }
    first
        .strip_suffix(['.', '!', '?'])
        .is_some_and(|word| word.chars().count() >= 2 && word.chars().all(char::is_alphabetic))
}

/// Whether `token` contains a run of three or more letters — what tells a word of English from a
/// path, a number or an identifier fragment.
fn has_letter_run(token: &str) -> bool {
    let mut run = 0;
    for c in token.chars() {
        run = if c.is_alphabetic() { run + 1 } else { 0 };
        if run >= 3 {
            return true;
        }
    }
    false
}

/// Whether `c` may open a Python identifier.
///
/// Python 3 identifiers are Unicode, so this is `is_alphabetic` rather than an ASCII test — a
/// program written by a model prompted in another language is still a program.
fn is_ident_start(c: char) -> bool {
    c.is_alphabetic() || c == '_'
}

/// Whether `c` may continue a Python identifier.
fn is_ident_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

// ---------------------------------------------------------------------------------------------
// The lexical mask
// ---------------------------------------------------------------------------------------------

/// Where the scan currently is.
enum Mode {
    /// Ordinary code.
    Code,
    /// Inside a `#` comment, until the next newline.
    Comment,
    /// Inside a string. Carries the quote byte that opened it, and whether it was a triple quote —
    /// which is the whole of the difference between a string a newline ends and one it does not.
    Str { quote: u8, triple: bool },
}

/// Lex `src` into its [code mask](CodeMask) — this dialect's answer to [`Dialect::code_mask`].
///
/// `None` means the source did not lex cleanly, and every caller that needs the mask declines on
/// it. Two states end a scan uncleanly: a **triple-quoted** string still open at the end of input,
/// and a **single-quoted** string still open at a newline, which Python forbids exactly as
/// JavaScript does.
///
/// # What it handles, and the two shapes it deliberately does not read
///
/// It handles `'…'`, `"…"`, `'''…'''`, `"""…"""`, `#…\n`, and backslash escapes — including a
/// backslash-newline inside a single-quoted string, which Python accepts as a line continuation and
/// which would otherwise be read as an unterminated string.
///
/// **A string prefix is not read at all.** `r"…"`, `b"…"`, `f"…"` and their combinations are
/// identifier characters followed by a quote, so the scan reaches the quote and does the right
/// thing without knowing which prefix preceded it. That is correct even for a raw string, because
/// Python's raw strings still refuse to end on a backslash-escaped quote — `r"\""` is one string,
/// not two — so treating the backslash as an escape is the accurate reading rather than a
/// convenient one.
///
/// **An f-string's substitutions are string bytes**, not code. Since 3.12 the expression inside
/// `{…}` may re-use the outer quote, so following it as code is a scan that loses its place on
/// exactly the input that is hardest to notice. Reading the whole literal as string text costs
/// nothing any caller needs — an `import` or a `def` inside an f-string is text a reader must skip
/// either way — and it is the reading that cannot desynchronise.
fn code_mask(src: &str) -> Option<CodeMask> {
    let bytes = src.as_bytes();
    let mut code = vec![true; bytes.len()];
    let mut mode = Mode::Code;
    let mut index = 0;

    while index < bytes.len() {
        let byte = bytes[index];
        match mode {
            Mode::Code => match byte {
                b'#' => {
                    code[index] = false;
                    mode = Mode::Comment;
                    index += 1;
                }
                b'\'' | b'"' => {
                    let triple =
                        bytes.get(index + 1) == Some(&byte) && bytes.get(index + 2) == Some(&byte);
                    let width = if triple { 3 } else { 1 };
                    for offset in 0..width {
                        code[index + offset] = false;
                    }
                    mode = Mode::Str {
                        quote: byte,
                        triple,
                    };
                    index += width;
                }
                _ => index += 1,
            },
            Mode::Comment => {
                if byte == b'\n' {
                    mode = Mode::Code;
                } else {
                    code[index] = false;
                }
                index += 1;
            }
            Mode::Str { quote, triple } => {
                code[index] = false;
                match byte {
                    b'\\' => {
                        // A backslash escapes whatever follows it, newline included — which is how
                        // a single-quoted Python string legally spans two lines.
                        if index + 1 >= bytes.len() {
                            return None;
                        }
                        code[index + 1] = false;
                        index += 2;
                    }
                    // A single-quoted string that is still open at a newline is not a string Python
                    // accepts, and is the signature of a scan that has lost its place.
                    b'\n' if !triple => return None,
                    _ if byte == quote => {
                        if triple {
                            if bytes.get(index + 1) == Some(&quote)
                                && bytes.get(index + 2) == Some(&quote)
                            {
                                code[index + 1] = false;
                                code[index + 2] = false;
                                mode = Mode::Code;
                                index += 3;
                            } else {
                                index += 1;
                            }
                        } else {
                            mode = Mode::Code;
                            index += 1;
                        }
                    }
                    _ => index += 1,
                }
            }
        }
    }

    // A comment is closed by end of input; a string is not, and an open one means the scan lost its
    // place.
    matches!(mode, Mode::Code | Mode::Comment).then_some(CodeMask::from_flags(code))
}

#[cfg(test)]
#[path = "python.healing.test.rs"]
mod tests;
