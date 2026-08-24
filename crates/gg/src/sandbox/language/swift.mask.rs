//! **Swift's code mask and identifier lexing** — the byte-level readings [this arm's source
//! scan](super::source) shares: which bytes of a source are code rather than string,
//! interpolation or comment text, and the identifier/declaration-keyword readers built on the same
//! discipline. See [`CodeMask`] for the shape of the answer.

use super::super::mask::CodeMask;

/// The keywords that open a declaration binding a name of its own.
///
/// `import` is excluded because it binds no name into the file it is written in, and `extension`
/// because it declares no name at all: a type may carry as many as an author likes, which is how
/// this arm binds a code module in the first place.
const DECLARATION_KEYWORDS: [&str; 9] = [
    "let",
    "var",
    "func",
    "struct",
    "class",
    "enum",
    "actor",
    "protocol",
    "typealias",
];

/// Every modifier that may stand in front of one of those, and nothing else.
///
/// A **closed** list, read left to right and stopping at the first word that is not on it — so an
/// ordinary identifier ends the run rather than being read as part of it. Being wrong here can only
/// mean a declaration goes unrecognised, which is the safe direction.
pub(super) const DECLARATION_MODIFIERS: [&str; 15] = [
    "public",
    "private",
    "fileprivate",
    "internal",
    "open",
    "package",
    "static",
    "final",
    "lazy",
    "weak",
    "unowned",
    "indirect",
    "dynamic",
    "nonisolated",
    "distributed",
];

/// The declaration keyword `text` opens with once its modifiers are consumed, and what follows it.
///
/// The reading is: an optional run of [modifiers](DECLARATION_MODIFIERS), and then one
/// [declaration keyword](DECLARATION_KEYWORDS). Read by [the module reader](super::source),
/// which asks it of a code module's own lines — one reading of what opens a Swift declaration, used
/// by everything here that needs it.
pub(super) fn declaration_keyword(text: &str) -> Option<(&'static str, &str)> {
    let mut rest = text.trim_start();
    loop {
        let (word, after) = identifier(rest)?;
        if let Some(found) = DECLARATION_KEYWORDS
            .iter()
            .find(|candidate| **candidate == word)
        {
            return Some((found, after));
        }
        if !DECLARATION_MODIFIERS.contains(&word) {
            return None;
        }
        // A modifier and what follows it are separated by whitespace; `staticmethod` is a name.
        let trimmed = after.trim_start();
        if trimmed.len() == after.len() {
            return None;
        }
        rest = trimmed;
    }
}

// ---------------------------------------------------------------------------------------------
// The predicates
// ---------------------------------------------------------------------------------------------

/// The identifier at the front of `text` and what follows it.
pub(super) fn identifier(text: &str) -> Option<(&str, &str)> {
    let mut end = 0usize;
    for (index, character) in text.char_indices() {
        let acceptable = match index {
            0 => is_ident_start(character),
            _ => is_ident_char(character),
        };
        if !acceptable {
            break;
        }
        end = index + character.len_utf8();
    }
    (end > 0).then(|| (&text[..end], &text[end..]))
}

/// Whether `c` may open a Swift identifier.
///
/// ASCII-plus-Unicode-letters, which is close enough: a Unicode identifier is legal Swift and is
/// simply never a keyword, which is all these readings decide.
fn is_ident_start(c: char) -> bool {
    c.is_alphabetic() || c == '_'
}

/// Whether `c` may continue one.
fn is_ident_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

// ---------------------------------------------------------------------------------------------
// The lexer
// ---------------------------------------------------------------------------------------------

/// Lex `src` into its [code mask](CodeMask) — the one reading
/// [a code module's own scan](super::source) shares.
///
/// `None` means the source did not lex cleanly, and every reader of the mask declines on it. Four
/// states end a scan uncleanly: an unterminated block comment, an unterminated string of any
/// kind, a single-line string still open at a newline — which Swift forbids — and a backslash with
/// nothing after it.
///
/// Swift asks four things of a lexer that Java's does not:
///
/// * **interpolation is a paren count.** `"total: \(rows["n"])"` is one string, and the splice is
///   `\(…)` rather than `${…}` — so the counter runs over parentheses, nested strings and all, and
///   the contents are marked **code** because they are.
/// * **raw strings carry a `#` fence**, and it changes both delimiters: inside `#"…"#` a bare `"`
///   closes nothing and a bare `\` escapes nothing, while `\#(…)` still interpolates. The fence has
///   to be counted rather than looked for.
/// * **`"""` may span newlines and `"` may not.** Both are quoted with the same byte, so the triple
///   has to be recognised first; reading it as an empty string followed by another would put its
///   whole body back in the code.
/// * **nested block comments** are Swift's as much as Kotlin's: `/* a /* b */ c */` is one comment,
///   and reading it Java's way would leave ` c */` behind as code.
///
/// Swift has **no character literal**, which is the one thing it asks for less of: an apostrophe is
/// not a delimiter in this grammar at all, so `don't` in a stray line of English is ordinary
/// punctuation where the same byte declines Kotlin's whole mask.
///
/// # Why it compares bytes rather than slicing the source
///
/// Because the scan walks one **byte** at a time and a model's reply is not ASCII. `&src[at..]`
/// panics unless `at` falls on a character boundary, so an `é` inside a string would take the turn
/// down with a slice index error. Every delimiter here is ASCII, and an ASCII byte never appears
/// inside a multi-byte UTF-8 sequence, so a byte comparison finds exactly what a string comparison
/// would and cannot panic on the way.
pub(super) fn code_mask(src: &str) -> Option<CodeMask> {
    let bytes = src.as_bytes();
    let mut code = vec![true; bytes.len()];
    let mut index = 0usize;

    while index < bytes.len() {
        let byte = bytes[index];
        let next = bytes.get(index + 1).copied();
        match byte {
            b'/' if next == Some(b'/') => {
                let end = find(bytes, index, b"\n").unwrap_or(bytes.len());
                mark(&mut code, index..end);
                index = end;
            }
            b'/' if next == Some(b'*') => {
                index = comment_end(bytes, &mut code, index)?;
            }
            // A raw string is recognised at its **fence**, because the `"` of `#"…"#` is several
            // bytes further on and reading the `#` as ordinary code would lose the body.
            b'#' if opener(bytes, index).is_some() => {
                index = quoted(bytes, &mut code, index, opener(bytes, index)?)?;
            }
            b'"' => {
                index = quoted(bytes, &mut code, index, opener(bytes, index)?)?;
            }
            b'`' => {
                index = backquoted(bytes, &mut code, index)?;
            }
            _ => index += 1,
        }
    }
    Some(CodeMask::from_flags(code))
}

/// A string literal's opener: where its body starts, how many `#` its fence carries, and whether it
/// is the multi-line form.
struct Opener {
    /// The offset just past the opening quote.
    body: usize,
    /// How many `#` stand in front of the quote, and therefore how many must follow the closing one —
    /// and how many must follow a `\` for it to escape or interpolate.
    hashes: usize,
    /// Whether this is `"""…"""`, which is the one form that may carry a raw newline.
    multiline: bool,
}

impl Opener {
    /// The bytes that close this string, without its fence.
    fn quote(&self) -> &'static [u8] {
        match self.multiline {
            true => b"\"\"\"",
            false => b"\"",
        }
    }
}

/// The string literal opening at `at`, if one is — reading the `#` fence and the triple quote.
fn opener(bytes: &[u8], at: usize) -> Option<Opener> {
    let mut index = at;
    let mut hashes = 0usize;
    while bytes.get(index) == Some(&b'#') {
        hashes += 1;
        index += 1;
    }
    if bytes.get(index) != Some(&b'"') {
        return None;
    }
    let multiline = matches_at(bytes, index, b"\"\"\"");
    Some(Opener {
        body: index + if multiline { 3 } else { 1 },
        hashes,
        multiline,
    })
}

/// Where a **nested** block comment that opened at `from` ends, past its outermost `*/`.
fn comment_end(bytes: &[u8], code: &mut [bool], from: usize) -> Option<usize> {
    let mut depth = 0usize;
    let mut at = from;
    while at < bytes.len() {
        if matches_at(bytes, at, b"/*") {
            depth += 1;
            at += 2;
            continue;
        }
        if matches_at(bytes, at, b"*/") {
            depth -= 1;
            at += 2;
            if depth == 0 {
                mark(code, from..at);
                return Some(at);
            }
            continue;
        }
        at += 1;
    }
    None
}

/// Where the string that opened at `from` ends, past its closing fence — marking every byte of it as
/// not code, except an interpolation's, which is.
fn quoted(bytes: &[u8], code: &mut [bool], from: usize, opener: Opener) -> Option<usize> {
    mark(code, from..opener.body);
    let quote = opener.quote();
    let mut at = opener.body;
    while at < bytes.len() {
        // `\` escapes and `\(` interpolates only when the fence's own `#`s follow the backslash:
        // inside `#"…"#` it is `\#(…)`, and a bare `\` is an ordinary byte.
        if bytes[at] == b'\\' && fence(bytes, at + 1, opener.hashes) {
            let after = at + 1 + opener.hashes;
            if after >= bytes.len() {
                return None;
            }
            if bytes[after] == b'(' {
                mark(code, at..after);
                at = interpolation_end(bytes, code, after)?;
                continue;
            }
            mark(code, at..after + 1);
            at = after + 1;
            continue;
        }
        if !opener.multiline && bytes[at] == b'\n' {
            return None;
        }
        if matches_at(bytes, at, quote) && fence(bytes, at + quote.len(), opener.hashes) {
            let end = at + quote.len() + opener.hashes;
            mark(code, at..end);
            return Some(end);
        }
        mark(code, at..at + 1);
        at += 1;
    }
    None
}

/// Where a backquoted identifier that opened at `from` ends.
///
/// Its bytes are marked as **not code** for the reason Kotlin's are:
/// what stands between the backticks may be a brace or the word `import` and means neither.
fn backquoted(bytes: &[u8], code: &mut [bool], from: usize) -> Option<usize> {
    let mut at = from + 1;
    while at < bytes.len() {
        if bytes[at] == b'\n' {
            return None;
        }
        if bytes[at] == b'`' {
            mark(code, from..at + 1);
            return Some(at + 1);
        }
        at += 1;
    }
    None
}

/// Whether `hashes` `#` stand at `at` — the tail of a raw string's fence, wherever one is required.
fn fence(bytes: &[u8], at: usize, hashes: usize) -> bool {
    (0..hashes).all(|offset| bytes.get(at + offset) == Some(&b'#'))
}

/// Where a `\(…)` interpolation whose `(` stands at `at` ends, past its closing parenthesis —
/// leaving everything inside it marked as code, which is what it is.
fn interpolation_end(bytes: &[u8], code: &mut [bool], at: usize) -> Option<usize> {
    let mut depth = 0usize;
    let mut scan = at;
    while scan < bytes.len() {
        // A string inside an interpolation is skipped whole, which is what stops its quotes from
        // being read as the enclosing string's.
        let nested = match bytes[scan] {
            b'"' | b'#' => match opener(bytes, scan) {
                Some(inner) => Some(quoted(bytes, code, scan, inner)?),
                None => None,
            },
            b'/' if matches_at(bytes, scan, b"/*") => Some(comment_end(bytes, code, scan)?),
            _ => None,
        };
        if let Some(end) = nested {
            scan = end;
            continue;
        }
        match bytes[scan] {
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(scan + 1);
                }
            }
            _ => {}
        }
        scan += 1;
    }
    None
}

/// Whether `needle`'s bytes stand at `at`.
fn matches_at(bytes: &[u8], at: usize, needle: &[u8]) -> bool {
    bytes.len() >= at + needle.len() && &bytes[at..at + needle.len()] == needle
}

/// Where `needle` next stands at or after `from`.
fn find(bytes: &[u8], from: usize, needle: &[u8]) -> Option<usize> {
    (from..=bytes.len().saturating_sub(needle.len())).find(|at| matches_at(bytes, *at, needle))
}

/// Mark a run of bytes as not code.
fn mark(code: &mut [bool], range: std::ops::Range<usize>) {
    for flag in code.iter_mut().take(range.end).skip(range.start) {
        *flag = false;
    }
}
