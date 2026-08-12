//! **Rust's [healing dialect](crate::healing::Dialect)** — the lexical half of
//! [response healing](crate::healing), answered in Rust's own terms.
//!
//! What is this arm's own is all in its lexer, and it begins with a single character.
//!
//! **The lexer has to tell a character literal from a lifetime.** `'a'` is a `char` and `'a` is a
//! lifetime, and they open with the same byte — a hazard no other arm's `'` carries. A scan that
//! read the `'` of `&'static str` as an opening quote would swallow the rest of the program into a
//! string, and every reading built on the mask would then be of the wrong text. So a `'` here is a
//! literal **only** when what follows it is one character and then a closing `'`
//! ([`char_literal_end`]), and anything else is ordinary code. That rule has a second effect worth
//! having: an apostrophe in a stray line of English (`don't`) is code punctuation rather than an
//! unterminated literal, so a reply with prose around its program still lexes, where the same
//! apostrophe declines [Kotlin's](super::super::kotlin::healing) whole mask.
//!
//! # What its strings ask that no C-shaped arm's do
//!
//! A Rust string literal may **span newlines**, so a `"` still open at a `\n` is not evidence of a
//! lexer that has lost its place — which is the opposite of Java's and Kotlin's, where the same
//! state is what makes an apostrophe in prose decline the mask. And a **raw** string carries its own
//! fence: `r"…"`, `r#"…"#`, `r##"…"##`, with `b` and `c` prefixes in front of any of them. The
//! fence has to be counted, because the bytes inside `r#"…"#` may hold a `"` and mean nothing by it.
//!
//! # None of these is a parser
//!
//! Not one predicate here parses, for the reason every other dialect gives: healing runs on text that
//! is not yet known to be a program — it may be Markdown, prose, or two programs pasted together — so
//! a parser would fail on precisely the inputs healing exists to repair. `rustc` is downstream of all
//! of this and is what actually reads the program; every answer here is a lexical shape test with its
//! errors pointed in the safe direction, and every one of them **declines** rather than guessing when
//! it cannot tell.

use crate::healing::{CodeMask, Dialect};

/// Rust's dialect. A unit struct: everything it "holds" is the `const` data below.
pub(in crate::sandbox::language) struct RustDialect;

/// The one instance, held by [`Rust`](super::Rust) and handed out as `&'static dyn Dialect`.
pub(in crate::sandbox::language) static RUST_DIALECT: RustDialect = RustDialect;

impl Dialect for RustDialect {
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
/// A closed, recognised list on the same terms every other dialect's is: a block tagged `json`,
/// `text`, `bash` or `toml` is context the model showed rather than the program, and tier 3 of the
/// candidacy ladder is what keeps the closed list from being a trap.
const PROGRAM_TAGS: &[&str] = &["rust", "rs"];

/// The statement and declaration keywords a line of Rust code may open with, matched
/// **case-sensitively** at an identifier boundary.
///
/// Case-sensitivity is the difference between the `for` that opens a loop and the `For` that opens a
/// sentence — the same distinction a real reply turned on for TypeScript's arm.
///
/// It is deliberately generous, and generous is the safe direction in **both** places it is read. In
/// [`looks_like_code`] a false positive costs a fence that could have been unwrapped — one turn, one
/// located diagnostic. In [`is_prose_line`] it is what stops a statement from ever being deleted as
/// prose.
///
/// **`use` is the one exclusion, and it is this arm's own.** Every other keyword here is a word no
/// English sentence opens with; `use` is a verb, and "Use `view::open_text` to show yourself a
/// value" is the single most common lead-in a model writes — gg's own system prompt writes it four
/// times. Listing it would make that line un-deletable as prose, which costs a turn, and would buy
/// nothing: every real `use` line ends in a `;`, which clause 1 reads anyway.
///
/// What is otherwise left out is the set of words that open no statement at all — `as`, `in`,
/// `where`, `dyn`, `ref`, `mut`, `move`, `self`, `super`, `crate` are operators, type-position words
/// or path segments, so listing them would buy nothing in the first reading and cost a great deal of
/// English in the second.
const STATEMENT_KEYWORDS: [&str; 24] = [
    "if", "else", "for", "while", "loop", "match", "return", "break", "continue", "let", "fn",
    "struct", "enum", "union", "trait", "impl", "mod", "pub", "const", "static", "type", "unsafe",
    "extern", "async",
];

/// The tokens a line of code may end with — a block opened or closed, a statement terminated, a
/// collection left open, or an expression continued onto the next line.
const CODE_ENDINGS: [&str; 13] = [
    ";", "{", "}", ",", "(", "[", "->", "=>", "&&", "||", "+", "=", ":",
];

/// Characters no line of English prose contains.
///
/// The backtick is **absent**, which is [Java's answer](super::super::java::healing) rather than
/// [Kotlin's](super::super::kotlin::healing): Rust has no backtick anywhere in its grammar — not a
/// string, not a quoted identifier, since a Rust identifier that needs escaping is written `r#type`
/// — so a line carrying one is certainly not Rust, and a lead-in written with an inline code span
/// may be deleted.
///
/// `#` is **absent** for the same reason it is on every other C-shaped arm, and in spite of `#[…]`
/// being real Rust punctuation: an attribute always carries a `[` and a `]`, both of which are on
/// this list, so nothing is lost by leaving `#` off — and leaving it on would make a Markdown
/// `# Heading` un-deletable as prose.
const NON_PROSE_CHARS: [char; 14] = [
    ';', '{', '}', '(', ')', '[', ']', '=', '<', '>', '|', '&', '$', '\\',
];

// ---------------------------------------------------------------------------------------------
// The predicates
// ---------------------------------------------------------------------------------------------

/// Whether `line` is **certainly** a line of Rust — this dialect's answer to
/// [`Dialect::looks_like_code`].
///
/// Its errors are asymmetric on purpose. A false positive costs a fence that could have been
/// unwrapped (one turn, one located diagnostic); a false negative deletes a line of the model's
/// program. So every clause below is a shape that only code has.
///
/// # One shape deliberately absent, because a real reply contains it
///
/// **A leading `*`.** It is a doc-comment continuation line, and it is also how half the models that
/// write a bullet list write one. `strip-fences` declines outright when *any* line outside the fences
/// is code-shaped, so reading `* read the manifest` as code would send a reply of prose-fence-prose
/// to the compiler whole — which is the single most common real shape there is.
fn looks_like_code(line: &str) -> bool {
    let line = line.trim();
    if line.is_empty() {
        return false;
    }
    // 1. It ends the way a statement, an open block or a continued expression ends. This is the
    //    clause that reads a `use` line, which `STATEMENT_KEYWORDS` deliberately does not.
    if CODE_ENDINGS.iter().any(|ending| line.ends_with(ending)) {
        return true;
    }
    // 2. It opens with a statement or declaration keyword.
    if starts_with_keyword(line) {
        return true;
    }
    // 3. It opens with a closer, a comment or an attribute.
    if ["}", ")", "]", "//", "/*", "*/", "#[", "#!["]
        .iter()
        .any(|prefix| line.starts_with(prefix))
    {
        return true;
    }
    // 4. It opens with a chain continuation — `.map(|row| …)`, `?.` is not Rust but `.await` is —
    //    which is how a Rust author breaks a long expression and is not how anyone writes a
    //    sentence. A bare `.` or an ellipsis is not one: an identifier has to follow.
    if line
        .strip_prefix('.')
        .is_some_and(|rest| rest.starts_with(is_ident_start))
    {
        return true;
    }
    // 5. It carries a path separator, a closure arrow, a match arrow or a reference-with-lifetime
    //    anywhere. `::` is Rust's most distinctive punctuation and appears in almost every line that
    //    calls anything.
    if line.contains("::") || line.contains("->") || line.contains("=>") {
        return true;
    }
    // 6. It assigns to something. `total += 1` would otherwise be a line this dialect could say
    //    nothing at all about.
    if carries_an_assignment(line) {
        return true;
    }
    // 7. It opens with a closure's parameter list — `|row| …`, `|| …`, `|a, b| …` — which is a
    //    shape English has no use for and which clause 5 misses when the body carries no path.
    if opens_with_closure(line) {
        return true;
    }
    // 8. It opens with a call: an identifier, path or dotted chain immediately followed by `(` or
    //    `!(` — the second being a macro, which is how a Rust author writes half their calls.
    opens_with_call(line)
}

/// Whether `line` opens with a Rust statement keyword at an identifier boundary.
fn starts_with_keyword(line: &str) -> bool {
    STATEMENT_KEYWORDS.iter().any(|keyword| {
        line.strip_prefix(keyword)
            .is_some_and(|rest| rest.chars().next().is_none_or(|c| !is_ident_char(c)))
    })
}

/// Whether `line` carries an assignment operator outside a comparison.
///
/// `==`, `!=`, `<=`, `>=` and `=>` are not assignments; a bare `=` and the compound forms are.
fn carries_an_assignment(line: &str) -> bool {
    for compound in ["+=", "-=", "*=", "/=", "%=", "|=", "&=", "^="] {
        if line.contains(compound) {
            return true;
        }
    }
    let bytes = line.as_bytes();
    line.match_indices('=').any(|(at, _)| {
        let before = at.checked_sub(1).map(|index| bytes[index]);
        let after = bytes.get(at + 1).copied();
        !matches!(
            before,
            Some(b'=' | b'!' | b'<' | b'>' | b'+' | b'-' | b'*' | b'/' | b'%')
        ) && !matches!(after, Some(b'=' | b'>'))
    })
}

/// Whether `line` opens with a closure's parameter list: `||`, or a `|` … `|` on one line whose
/// contents are only identifiers, commas and whitespace.
///
/// Deliberately narrow, because `|` is also Rust's bitwise-or and a `match` pattern's alternation —
/// and, far more importantly, because a table row written in prose (`| name | what it does |`) is a
/// shape a model really does emit. Requiring every character between the bars to be an identifier
/// character keeps a Markdown table out.
fn opens_with_closure(line: &str) -> bool {
    let Some(rest) = line.strip_prefix('|') else {
        return false;
    };
    if rest.starts_with('|') {
        return true;
    }
    let Some((parameters, after)) = rest.split_once('|') else {
        return false;
    };
    !parameters.is_empty()
        && parameters
            .chars()
            .all(|c| is_ident_char(c) || c == ',' || c == ' ')
        && after.starts_with(' ')
}

/// Whether `line` opens with `name(`, `a::b(`, `a.b(` or `name!(` — `view::open_text(`,
/// `entries.iter(`, `println!(`.
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
        // A separator continues the chain only when a further identifier follows it; otherwise the
        // chain ended at the previous character, which is what keeps `Done. Created …` prose.
        let separator = match c {
            '.' => Some(1),
            ':' if line[index..].starts_with("::") => Some(2),
            _ => None,
        };
        if let Some(width) = separator {
            let next = line[index + width..].chars().next();
            if next.is_some_and(is_ident_start) {
                for _ in 0..width {
                    chars.next();
                }
                continue;
            }
        }
        break;
    }
    let rest = &line[end..];
    rest.starts_with('(') || rest.starts_with("!(")
}

/// Whether `line` is **certainly** prose rather than Rust — this dialect's answer to
/// [`Dialect::is_prose_line`], and the test `strip-prose` uses to delete a line.
///
/// The mirror image of [`looks_like_code`]: here a false positive deletes the model's code, so every
/// clause is a shape that only English has. The two predicates are **not** complements and are not
/// disjoint — a line may satisfy both, or neither — and the pipeline's fixpoint loop is what
/// resolves the overlap.
fn is_prose_line(line: &str) -> bool {
    let line = line.trim();
    if line.is_empty() {
        return false;
    }
    // 1. No punctuation that only code uses, and no comment opener. The backtick is *not* on that
    //    list here — see `NON_PROSE_CHARS`.
    if line.contains(NON_PROSE_CHARS) || line.contains("//") || line.contains("/*") {
        return false;
    }
    // 2. Not a statement.
    if starts_with_keyword(line) {
        return false;
    }
    // 3. Not a path, which is Rust's most distinctive punctuation and carries no `(` when it names
    //    a type or a constant.
    if line.contains("::") {
        return false;
    }
    // 4. A sentence, or a single terminated word.
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

/// Whether `c` may open a Rust identifier.
///
/// ASCII-plus-Unicode-letters, which is close enough: a Unicode identifier is legal Rust and is
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

/// Lex `src` into its [code mask](CodeMask) — this dialect's answer to [`Dialect::code_mask`].
///
/// `None` means the source did not lex cleanly, and every caller that needs the mask declines to act
/// on it. Two states end a scan uncleanly, and both are an unterminated *opener*: a block comment or
/// a string literal that runs to the end of the text.
///
/// Rust asks three things of a lexer that [Java's](super::super::java::healing) does not:
///
/// * **a string may span newlines**, so a `"` still open at a `\n` is not evidence of anything. That
///   is the opposite of every other C-shaped arm here, where the same state is what makes an
///   apostrophe in prose decline the whole mask.
/// * **raw strings carry a fence.** `r"…"`, `r#"…"#`, `r##"…"##`, each optionally prefixed `b` or
///   `c`, and inside one a `"` closes nothing — so the fence has to be counted rather than looked
///   for.
/// * **`'` is ambiguous.** `'a'` is a `char` and `'a` is a lifetime, and reading the second as an
///   opening quote would swallow the rest of the program. See [`char_literal_end`].
///
/// Nested block comments are Rust's as much as Kotlin's: `/* a /* b */ c */` is one comment, and
/// reading it Java's way would leave ` c */` behind as code.
///
/// # Why it compares bytes rather than slicing the source
///
/// Because the scan walks one **byte** at a time and a model's reply is not ASCII. `&src[at..]`
/// panics unless `at` falls on a character boundary, so an `é` inside a string would take the turn
/// down with a slice index error. Every delimiter here is ASCII, and an ASCII byte never appears
/// inside a multi-byte UTF-8 sequence, so a byte comparison finds exactly what a string comparison
/// would and cannot panic on the way.
fn code_mask(src: &str) -> Option<CodeMask> {
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
            // A prefixed literal is recognised at its **prefix**, because the `"` of `r#"…"#` is
            // several bytes further on and reading it as a plain string would put the fence's own
            // `#`s back in the code and lose the body.
            b'b' | b'c' | b'r' if !preceded_by_identifier(bytes, index) => {
                match literal(bytes, index) {
                    Some(opener) => index = quoted(bytes, &mut code, index, opener)?,
                    None => index += 1,
                }
            }
            b'"' => {
                let opener = literal(bytes, index)?;
                index = quoted(bytes, &mut code, index, opener)?;
            }
            b'\'' => match char_literal_end(src, index) {
                Some(end) => {
                    mark(&mut code, index..end);
                    index = end;
                }
                // A lifetime, a loop label, or an apostrophe in a line of English — all ordinary
                // bytes, none of them the start of anything the mask has to follow.
                None => index += 1,
            },
            _ => index += 1,
        }
    }
    Some(CodeMask::from_flags(code))
}

/// A string literal's opener: where its body starts, how many `#` its fence carries, and whether a
/// `\` escapes inside it.
struct Opener {
    /// The offset just past the opening `"`.
    body: usize,
    /// How many `#` stand between the `r` and the `"`, and therefore how many must follow the
    /// closing one.
    hashes: usize,
    /// Whether this is a **raw** string, in which a `\` is an ordinary byte.
    raw: bool,
}

/// The string literal opening at `at`, if one is — reading the `b`, `c` and `r` prefixes and the
/// raw fence.
fn literal(bytes: &[u8], at: usize) -> Option<Opener> {
    let mut index = at;
    // `b"…"`, `c"…"`, `br"…"`, `cr"…"` — one optional prefix letter, and only when what follows it
    // could open a string.
    if matches!(bytes.get(index), Some(b'b' | b'c'))
        && matches!(bytes.get(index + 1), Some(b'r' | b'"'))
    {
        index += 1;
    }
    let raw = bytes.get(index) == Some(&b'r');
    if raw {
        index += 1;
    }
    let mut hashes = 0usize;
    if raw {
        while bytes.get(index) == Some(&b'#') {
            hashes += 1;
            index += 1;
        }
    }
    (bytes.get(index) == Some(&b'"')).then_some(Opener {
        body: index + 1,
        hashes,
        raw,
    })
}

/// Whether the byte before `at` may continue an identifier — which is what tells the `r` of a raw
/// string from the `r` at the end of `for`.
fn preceded_by_identifier(bytes: &[u8], at: usize) -> bool {
    at > 0 && (bytes[at - 1].is_ascii_alphanumeric() || bytes[at - 1] == b'_')
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
/// not code.
///
/// There is no interpolation to follow: Rust's `format!("{name}")` captures a name rather than
/// splicing an expression, and the braces are macro syntax read by the macro rather than delimiters
/// a mask must come back out of. So the whole body is string bytes, which is what it is.
///
/// A newline does **not** end the scan, because Rust admits one in every string it has. What ends it
/// uncleanly is the end of the text.
fn quoted(bytes: &[u8], code: &mut [bool], from: usize, opener: Opener) -> Option<usize> {
    mark(code, from..opener.body);
    let mut at = opener.body;
    while at < bytes.len() {
        if !opener.raw && bytes[at] == b'\\' {
            if at + 1 >= bytes.len() {
                return None;
            }
            mark(code, at..at + 2);
            at += 2;
            continue;
        }
        if bytes[at] == b'"' && closing_fence(bytes, at + 1, opener.hashes) {
            let end = at + 1 + opener.hashes;
            mark(code, at..end);
            return Some(end);
        }
        mark(code, at..at + 1);
        at += 1;
    }
    None
}

/// Whether `hashes` `#` stand at `at` — the tail of a raw string's closing fence.
fn closing_fence(bytes: &[u8], at: usize, hashes: usize) -> bool {
    (0..hashes).all(|offset| bytes.get(at + offset) == Some(&b'#'))
}

/// Where the character literal opening at `at` ends, past its closing `'` — or `None` when the `'`
/// opens no literal at all.
///
/// This is the reading that keeps a lifetime from being read as a quote, and it is the whole reason
/// this arm's lexer survives text no other C-shaped arm's does. `&'static str`, `impl<'a>`,
/// `'outer: for …` and the apostrophe in `don't` all answer `None` and are left as ordinary code,
/// where a scan that took every `'` as an opener would swallow everything after them.
///
/// A literal is one of exactly two shapes: an escape (`'\n'`, `'\''`, `'\u{1f600}'`), or **one
/// character** followed immediately by a closing `'`. Nothing else is one.
fn char_literal_end(src: &str, at: usize) -> Option<usize> {
    let rest = src.get(at + 1..)?;
    if let Some(escaped) = rest.strip_prefix('\\') {
        // `\u{…}` is the one escape whose length is not fixed; every other is a single character.
        let after = match escaped.strip_prefix('u') {
            Some(braced) => &braced[braced.find('}')? + 1..],
            None => &escaped[escaped.chars().next()?.len_utf8()..],
        };
        return after.strip_prefix('\'').map(|tail| src.len() - tail.len());
    }
    let character = rest.chars().next()?;
    // A newline is not a character literal's content in any shape a model writes, and reading one as
    // such is how a scan loses a line.
    if character == '\n' || character == '\'' {
        return None;
    }
    rest[character.len_utf8()..]
        .strip_prefix('\'')
        .map(|tail| src.len() - tail.len())
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

#[cfg(test)]
#[path = "rust.healing.test.rs"]
mod tests;
