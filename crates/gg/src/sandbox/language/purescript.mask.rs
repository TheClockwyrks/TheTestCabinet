//! **PureScript's code mask** — the byte-level lexer behind [this arm's module
//! analysis](super::modules), which must not take a declaration written inside a string or a
//! comment for one the module makes. See [`CodeMask`] for the shape
//! of the answer.

use super::super::mask::CodeMask;

/// Where the scan currently is.
enum Mode {
    /// Ordinary code.
    Code,
    /// Inside a `--` comment, until the next newline.
    Line,
    /// Inside a `{- … -}` comment, which **nests** — so the depth is carried.
    Block { depth: usize },
    /// Inside a `"…"` string, which a newline ends uncleanly.
    Str,
    /// Inside a `"""…"""` string, which is raw and which a newline does not end.
    Raw,
}

/// Lex `src` into its [code mask](CodeMask).
///
/// `None` means the source did not lex cleanly, and every caller that needs the mask goes without
/// it — [the module scan](super::modules) reads such a source as though it were all code. Three
/// states end a scan uncleanly: an ordinary string still open at a newline, a triple-quoted string
/// still open at the end of input, and a block comment still open at the end of input.
///
/// # The four shapes it reads, and the two subtleties in them
///
/// `"…"` with backslash escapes, `"""…"""` raw strings, `-- …` to the newline, and `{- … -}`
/// nested block comments.
///
/// **A `--` is not always a comment.** PureScript operators are built out of symbol characters, so
/// `-->` and `<--` are names a program may define and use, and only a run of dashes followed by
/// something that is *not* a symbol character opens a comment. Reading `x --> y` as a comment would
/// mask the rest of the line, and everything declared on it would go unread.
///
/// **A `'` is usually a prime.** `total'` is an ordinary identifier and `'a'` is a character literal,
/// and the two are told apart the only way they can be: a quote that follows an identifier character
/// continues a name, and one that does not opens a literal *only if* the literal closes within the
/// one character plus escape a character literal can be. Anything else is left as code, because a
/// mis-read quote would open a string that never closes and cost the whole source its mask.
///
/// # Why it compares bytes rather than slicing the source
///
/// Because the scan walks one **byte** at a time and a model's reply is not ASCII. `&src[at..]`
/// panics unless `at` falls on a character boundary, so an `é` inside a comment would take the turn
/// down with a slice index error. Every delimiter here is ASCII, and an ASCII byte never appears
/// inside a multi-byte UTF-8 sequence, so a byte comparison finds exactly what a string comparison
/// would and cannot panic on the way.
pub(super) fn code_mask(src: &str) -> Option<CodeMask> {
    let bytes = src.as_bytes();
    let mut code = vec![true; bytes.len()];
    let mut mode = Mode::Code;
    let mut index = 0;

    while index < bytes.len() {
        let byte = bytes[index];
        match mode {
            Mode::Code => match byte {
                b'-' if opens_line_comment(bytes, index) => {
                    code[index] = false;
                    mode = Mode::Line;
                    index += 1;
                }
                b'{' if bytes.get(index + 1) == Some(&b'-') => {
                    code[index] = false;
                    code[index + 1] = false;
                    mode = Mode::Block { depth: 1 };
                    index += 2;
                }
                b'"' => {
                    let triple =
                        bytes.get(index + 1) == Some(&b'"') && bytes.get(index + 2) == Some(&b'"');
                    let width = if triple { 3 } else { 1 };
                    for offset in 0..width {
                        code[index + offset] = false;
                    }
                    mode = if triple { Mode::Raw } else { Mode::Str };
                    index += width;
                }
                b'\'' => match character_literal(src, index) {
                    Some(end) => {
                        for slot in code.iter_mut().take(end).skip(index) {
                            *slot = false;
                        }
                        index = end;
                    }
                    // A prime on an identifier, or a quote this scan cannot account for. Either way
                    // it is code, and reading it as a literal would lose the rest of the source.
                    None => index += 1,
                },
                _ => index += 1,
            },
            Mode::Line => {
                if byte == b'\n' {
                    mode = Mode::Code;
                } else {
                    code[index] = false;
                }
                index += 1;
            }
            Mode::Block { depth } => {
                code[index] = false;
                if byte == b'{' && bytes.get(index + 1) == Some(&b'-') {
                    code[index + 1] = false;
                    mode = Mode::Block { depth: depth + 1 };
                    index += 2;
                } else if byte == b'-' && bytes.get(index + 1) == Some(&b'}') {
                    code[index + 1] = false;
                    mode = match depth {
                        0 | 1 => Mode::Code,
                        _ => Mode::Block { depth: depth - 1 },
                    };
                    index += 2;
                } else {
                    index += 1;
                }
            }
            Mode::Str => {
                code[index] = false;
                match byte {
                    // A backslash escapes whatever follows it, a newline included — which is how a
                    // PureScript string gap legally spans two lines.
                    b'\\' => {
                        if index + 1 >= bytes.len() {
                            return None;
                        }
                        code[index + 1] = false;
                        index += 2;
                    }
                    b'\n' => return None,
                    b'"' => {
                        mode = Mode::Code;
                        index += 1;
                    }
                    _ => index += 1,
                }
            }
            Mode::Raw => {
                code[index] = false;
                if byte == b'"'
                    && bytes.get(index + 1) == Some(&b'"')
                    && bytes.get(index + 2) == Some(&b'"')
                {
                    code[index + 1] = false;
                    code[index + 2] = false;
                    mode = Mode::Code;
                    index += 3;
                } else {
                    index += 1;
                }
            }
        }
    }

    // A line comment is closed by end of input; the other three are not, and an open one means the
    // scan lost its place.
    matches!(mode, Mode::Code | Mode::Line).then_some(CodeMask::from_flags(code))
}

/// The symbol characters a PureScript operator is built out of.
const SYMBOL_BYTES: &[u8] = br":!#$%&*+./<=>?@\^|";

/// Whether the run of dashes at `index` opens a line comment.
///
/// Two or more dashes, followed by something that is not a symbol character — which is exactly
/// Haskell's rule, and is what keeps `-->` an operator. The character *before* matters too: `<--` is
/// one operator, not a `<` and a comment.
fn opens_line_comment(bytes: &[u8], index: usize) -> bool {
    if bytes.get(index + 1) != Some(&b'-') {
        return false;
    }
    if index > 0 && (SYMBOL_BYTES.contains(&bytes[index - 1]) || bytes[index - 1] == b'-') {
        return false;
    }
    let mut end = index;
    while bytes.get(end) == Some(&b'-') {
        end += 1;
    }
    bytes
        .get(end)
        .is_none_or(|byte| !SYMBOL_BYTES.contains(byte))
}

/// The end offset of the character literal opening at `index`, or `None` when this quote is a prime
/// on an identifier or a shape this scan will not guess at.
///
/// A character literal is one character between quotes — `'x'`, `'é'`, `'—'` — or one of the escapes
/// that run to a handful of bytes (`'\x2764'`), so the search is bounded rather than open-ended: an
/// unbounded one is how a prime swallows the rest of a program. The bound on the unescaped shape is
/// the width of the character that follows the quote, so a literal holding a character outside ASCII
/// closes where an ASCII one does.
fn character_literal(src: &str, index: usize) -> Option<usize> {
    let bytes = src.as_bytes();
    // A quote directly after an identifier character is a prime — `total'`, `x''`, `café'`.
    if src[..index]
        .chars()
        .next_back()
        .is_some_and(|character| character.is_alphanumeric() || character == '_')
    {
        return None;
    }
    let escaped = bytes.get(index + 1) == Some(&b'\\');
    // `index + 1` is a character boundary, since the byte at `index` is the ASCII quote.
    let limit = match escaped {
        true => 8,
        false => src[index + 1..].chars().next().map_or(1, char::len_utf8) + 1,
    };
    let mut at = index + 1 + usize::from(escaped);
    let end = (index + 1 + limit).min(bytes.len());
    while at < end {
        if bytes[at] == b'\'' {
            return Some(at + 1);
        }
        if bytes[at] == b'\n' {
            return None;
        }
        at += 1;
    }
    None
}

#[cfg(test)]
#[path = "purescript.mask.test.rs"]
mod tests;
