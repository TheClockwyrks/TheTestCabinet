//! **C++'s byte-level scan** — the lexer behind [this arm's source reading](super::source):
//! which bytes of a source are code rather than string, character, raw-string or comment text.

/// Whether `character` may continue one.
fn is_ident_char(character: char) -> bool {
    character.is_alphanumeric() || character == '_'
}

/// What one pass of this arm's lexer found: which bytes are code.
///
/// Always the scan's best reading, even where the source did not lex cleanly — its one
/// [reader](super::source::code_mask) has its errors safe in the accepting direction.
pub(super) struct Scan {
    /// Per byte: `true` where the byte is code, `false` where it is inside a string literal, a
    /// character literal, a raw string or a comment.
    pub(super) code: Vec<bool>,
}

/// Lex `src`, marking the bytes that are code and recording whether the reading holds together.
///
/// The four shapes C++ hides text in, and each is a place a naive scan loses the source:
///
/// * `//` to the end of the line, and `/* … */`, which does **not** nest in C++;
/// * `"…"` and `'…'` with backslash escapes — and `'` is a quote here rather than
///   Rust's lifetime tick, so it is read as one;
/// * a **raw string**, `R"delim(…)delim"`, whose delimiter is chosen by the author and whose body
///   may contain anything at all including `"` and `\`. A scan that read `R"(he said "no")"` as
///   three strings would leave the rest of the file masked wrongly, so the fence is *read* rather
///   than looked for.
///
/// Everything else — a preprocessor line, a `#include <vector>`'s angle brackets, a digit separator
/// — is code, which is what this is for: `<vector>` is not a string and the `'` in `1'000'000` is a
/// digit separator rather than a character literal. The separator case is handled by the one rule
/// that distinguishes them: a character literal opens where a *value* cannot already have ended, so
/// a `'` immediately after an alphanumeric is a separator.
///
/// # Why it compares bytes rather than slicing the source
///
/// Because the scan walks one **byte** at a time and a model's reply is not ASCII. `&src[at..]`
/// panics unless `at` falls on a character boundary, so an `é` inside a string would take the turn
/// down with a slice index error. Every delimiter here is ASCII, and an ASCII byte never appears
/// inside a multi-byte UTF-8 sequence, so a byte comparison finds exactly what a string comparison
/// would and cannot panic on the way.
pub(super) fn scan(src: &str) -> Scan {
    let bytes = src.as_bytes();
    let mut code = vec![true; bytes.len()];
    let mut at = 0usize;
    while at < bytes.len() {
        match bytes[at] {
            b'/' if bytes.get(at + 1) == Some(&b'/') => {
                while at < bytes.len() && bytes[at] != b'\n' {
                    code[at] = false;
                    at += 1;
                }
            }
            b'/' if bytes.get(at + 1) == Some(&b'*') => {
                let end = match find(bytes, at + 2, b"*/") {
                    Some(found) => found + 2,
                    None => bytes.len(),
                };
                mark(&mut code, at..end);
                at = end;
            }
            // A raw string, whose delimiter is whatever stands between `R"` and `(`. The prefix may
            // carry an encoding (`LR"…"`, `u8R"…"`), and the byte before `R` decides whether this is
            // a raw string at all or the tail of an identifier ending in `R`.
            b'R' if bytes.get(at + 1) == Some(&b'"')
                && !at
                    .checked_sub(1)
                    .is_some_and(|before| is_ident_char(bytes[before] as char)) =>
            {
                let open = at + 2;
                let Some(paren) = bytes[open..]
                    .iter()
                    .position(|byte| *byte == b'(')
                    .map(|found| open + found)
                else {
                    mark(&mut code, at..bytes.len());
                    break;
                };
                let mut fence = Vec::with_capacity(paren - open + 2);
                fence.push(b')');
                fence.extend_from_slice(&bytes[open..paren]);
                fence.push(b'"');
                let end = match find(bytes, paren + 1, &fence) {
                    Some(found) => found + fence.len(),
                    None => bytes.len(),
                };
                mark(&mut code, at..end);
                at = end;
            }
            quote @ (b'"' | b'\'') => {
                // `1'000'000` and `0x1'0000`: a digit separator, not a literal. The rule is that a
                // character literal cannot open where a value has just ended.
                if quote == b'\''
                    && at
                        .checked_sub(1)
                        .is_some_and(|before| bytes[before].is_ascii_alphanumeric())
                {
                    at += 1;
                    continue;
                }
                code[at] = false;
                at += 1;
                while at < bytes.len() {
                    code[at] = false;
                    match bytes[at] {
                        b'\\' => at += 2,
                        byte if byte == quote => {
                            at += 1;
                            break;
                        }
                        // A newline ends an unterminated literal rather than swallowing the rest of
                        // the program: a `"` a model left open is a compile error the compiler will
                        // report, and masking everything after it would make this lexer's reader
                        // answer for the whole file.
                        b'\n' => break,
                        _ => at += 1,
                    }
                }
                if at > bytes.len() {
                    // A trailing backslash walked the cursor past the end; nothing is left to read.
                    break;
                }
            }
            _ => at += 1,
        }
    }
    Scan { code }
}

/// The next occurrence of `needle` in `haystack` at or after `from`.
fn find(haystack: &[u8], from: usize, needle: &[u8]) -> Option<usize> {
    if from >= haystack.len() || needle.is_empty() {
        return None;
    }
    haystack[from..]
        .windows(needle.len())
        .position(|window| window == needle)
        .map(|found| found + from)
}

/// Mark a run of bytes as not code.
fn mark(code: &mut [bool], range: std::ops::Range<usize>) {
    for flag in code.iter_mut().take(range.end).skip(range.start) {
        *flag = false;
    }
}
