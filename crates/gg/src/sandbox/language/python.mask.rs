//! **Python's code mask** — the byte-level lexer behind [this arm's module
//! analysis](super::modules), which must not take a `def` written inside a docstring for one the
//! module declares. See [`CodeMask`] for the shape of the answer.

use super::super::mask::CodeMask;

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

/// Lex `src` into its [code mask](CodeMask).
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
pub(super) fn code_mask(src: &str) -> Option<CodeMask> {
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
