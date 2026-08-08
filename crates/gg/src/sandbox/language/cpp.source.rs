//! **What gg reads out of a model's C++ before handing it to the compiler**, which on this arm is
//! exactly one thing: whether the reply defines a `main`.
//!
//! Nothing here rewrites the model's text. A C++ program is compiled
//! [verbatim](super::compile::PROGRAM_FILE), so this module is a *reader* rather than a lowering,
//! and the lexer below is the same shape the arm's future
//! [healing dialect](crate::healing::Dialect) will need — which is why it masks strings and
//! comments properly rather than scanning the raw bytes.
//!
//! # Why gg has to look at all
//!
//! Because `wasm-ld` will not. wasi-libc's `__main_void.o` — the object that adapts clang's two
//! spellings of an entry point to one symbol — references `main` **weakly**, so a program that
//! defines none *links successfully*: the reference resolves to a stub that traps, the compiler
//! exits zero, and what a model gets back is an opaque trap on a turn whose program never ran.
//!
//! That was measured rather than assumed, and so were the ways round it. `-Wl,--undefined=main`
//! does nothing, because a weak undefined symbol is a resolution `wasm-ld` considers complete;
//! `--unresolved-symbols=report-all` does nothing for the same reason; and `--export=main` fails
//! for `int main()` and *also* fails for `int main(int, char **)`, because the two are lowered to
//! different symbols and neither is called `main`. There is no linker flag that asks this question.
//!
//! So gg asks it, and refuses the program with a sentence at prepare time — which is the same
//! answer the [Rust](super::super::rust) arm gives to the opposite shape. Rust has no `main` and
//! refuses a program that defines one; C++ has nowhere else to put a statement and refuses a
//! program that does not.
//!
//! # Why the reading can only be wrong in the safe direction
//!
//! The scan looks for the *token* `main` followed by an open parenthesis, anywhere in the reply's
//! **code** bytes. It is deliberately not a parse:
//!
//! * A refusal happens only when there is no such token **anywhere** in the code. A reply that
//!   defines `main` cannot fail to contain one, so a false refusal would take a lexer that mistook
//!   real code for a string or a comment — which is what the masking below is for, and what its
//!   tests are about.
//! * The reverse — a reply that has the token and no definition (a member function called `main`,
//!   a forward declaration and nothing else) — is accepted, compiled, and traps. That is the same
//!   outcome as not looking at all, so the scan can only improve on it.
//!
//! Being wrong in that direction is the rule this whole subsystem is built on: a model told to fix
//! a program that was never wrong is the misattribution this codebase spends the most effort not
//! making.

/// Whether `source` defines an entry point the [shell](super::compile) can call.
///
/// The token `main` in code, followed by an open parenthesis. See this module's own documentation
/// for why that is the question and why it is asked lexically.
pub(super) fn defines_main(source: &str) -> bool {
    let bytes = source.as_bytes();
    let code = code_mask(source);
    let mut at = 0;
    while let Some(found) = find_token(bytes, &code, at, b"main") {
        at = found + 4;
        // Whatever follows, skipping the whitespace and comments a declaration may carry between
        // the name and its parameter list — `int main /* entry */ ()` is one declaration.
        let mut after = at;
        while after < bytes.len() && (!code[after] || bytes[after].is_ascii_whitespace()) {
            after += 1;
        }
        if bytes.get(after) == Some(&b'(') {
            return true;
        }
    }
    false
}

/// The next occurrence of `token` in `bytes` at or after `from` that is **code** and stands on its
/// own — not part of a longer identifier, and not reached through `.`, `->` or `::`.
///
/// The qualification test is what keeps `std::main`-shaped text and `object.main(…)` from counting
/// as a definition of the entry point. It is not a correctness requirement — accepting one would
/// only mean a program that traps instead of being refused — but it is free and it makes the
/// refusal fire on the replies it is for.
fn find_token(bytes: &[u8], code: &[bool], from: usize, token: &[u8]) -> Option<usize> {
    let mut at = from;
    while at + token.len() <= bytes.len() {
        let found = bytes[at..]
            .windows(token.len())
            .position(|window| window == token)?
            + at;
        at = found + 1;
        if !code[found] {
            continue;
        }
        let before = bytes[..found]
            .iter()
            .rposition(|byte| !byte.is_ascii_whitespace());
        let follows = found + token.len();
        let identifier = |byte: u8| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'$';
        if found > 0 && identifier(bytes[found - 1]) {
            continue;
        }
        if bytes.get(follows).is_some_and(|byte| identifier(*byte)) {
            continue;
        }
        // `.main(`, `->main(`, `::main(`: a call or a qualified name, not this program's entry
        // point. `::main` at namespace scope really is the entry point, but a reply that writes it
        // that way also writes the definition it refers to, so nothing is lost by declining here.
        if let Some(before) = before
            && (bytes[before] == b'.'
                || bytes[before] == b':'
                || (bytes[before] == b'>' && before > 0 && bytes[before - 1] == b'-'))
        {
            continue;
        }
        return Some(found);
    }
    None
}

/// A byte-for-byte mask of `source`: `true` where the byte is **code**, `false` where it is inside
/// a string literal, a character literal or a comment.
///
/// The four shapes C++ hides text in, and each is a place a naive scan loses the source:
///
/// * `//` to the end of the line, and `/* … */`, which does **not** nest in C++ (unlike Swift's);
/// * `"…"` and `'…'` with backslash escapes — and `'` is a quote here rather than Rust's lifetime
///   tick or PureScript's prime, so it is read as one;
/// * a **raw string**, `R"delim(…)delim"`, whose delimiter is chosen by the author and whose body
///   may contain anything at all including `"` and `\`. A scan that read `R"(he said "no")"` as
///   three strings would leave the rest of the file masked wrongly, so the fence is *read* rather
///   than looked for.
///
/// Everything else — a preprocessor line, a `#include <vector>`'s angle brackets, a digit
/// separator — is code, which is what this is for: `<vector>` is not a string and the `'` in
/// `1'000'000` is a digit separator rather than a character literal. The separator case is handled
/// by the one rule that distinguishes them: a character literal opens where a *value* cannot
/// already have ended, so a `'` immediately after an alphanumeric is a separator.
pub(super) fn code_mask(source: &str) -> Vec<bool> {
    let bytes = source.as_bytes();
    let mut mask = vec![true; bytes.len()];
    let mut at = 0;
    while at < bytes.len() {
        match bytes[at] {
            b'/' if bytes.get(at + 1) == Some(&b'/') => {
                while at < bytes.len() && bytes[at] != b'\n' {
                    mask[at] = false;
                    at += 1;
                }
            }
            b'/' if bytes.get(at + 1) == Some(&b'*') => {
                let end = find(bytes, at + 2, b"*/").map_or(bytes.len(), |found| found + 2);
                mask[at..end].fill(false);
                at = end;
            }
            // A raw string, whose delimiter is whatever stands between `R"` and `(`. The prefix may
            // carry an encoding (`LR"…"`, `u8R"…"`), and the byte before `R` decides whether this
            // is a raw string at all or the tail of an identifier ending in `R`.
            b'R' if bytes.get(at + 1) == Some(&b'"')
                && !at
                    .checked_sub(1)
                    .is_some_and(|before| is_identifier_tail(bytes[before])) =>
            {
                let open = at + 2;
                let Some(paren) = bytes[open..]
                    .iter()
                    .position(|byte| *byte == b'(')
                    .map(|found| open + found)
                else {
                    mask[at..].fill(false);
                    break;
                };
                let mut fence = Vec::with_capacity(paren - open + 2);
                fence.push(b')');
                fence.extend_from_slice(&bytes[open..paren]);
                fence.push(b'"');
                let end = find(bytes, paren + 1, &fence).map_or(bytes.len(), |f| f + fence.len());
                mask[at..end].fill(false);
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
                mask[at] = false;
                at += 1;
                while at < bytes.len() {
                    mask[at] = false;
                    match bytes[at] {
                        b'\\' => at += 2,
                        byte if byte == quote => {
                            at += 1;
                            break;
                        }
                        // A newline ends an unterminated literal rather than swallowing the rest of
                        // the program: a `"` a model left open is a compile error the compiler will
                        // report, and masking everything after it would make this scan answer for
                        // the whole file.
                        b'\n' => {
                            at += 1;
                            break;
                        }
                        _ => at += 1,
                    }
                }
                if at > bytes.len() {
                    break;
                }
            }
            _ => at += 1,
        }
    }
    mask
}

/// Whether `byte` may appear inside an identifier — used to tell `R"…"` from the `R` that ends one.
fn is_identifier_tail(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
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

#[cfg(test)]
#[path = "cpp.source.test.rs"]
mod tests;
