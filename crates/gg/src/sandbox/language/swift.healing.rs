//! **Swift's [healing dialect](crate::healing::Dialect)** — the lexical half of
//! [response healing](crate::healing), answered in Swift's own terms.
//!
//! One of its answers is worth naming before the code, because it is the same rule reading a
//! grammar the other arms do not have.
//!
//! **A single-line string may not span a newline and a multi-line one must.** `"…"` closed by a `\n`
//! is a scan that has lost its place, exactly as it is on the JVM arms; `"""…"""` is the shape that
//! *is* allowed to carry one; and a **raw** string carries a `#` fence — `#"…"#`, `##"…"##`,
//! `#"""…"""#` — inside which neither a `"` nor a `\` means anything. The fence has to be counted
//! rather than looked for. Swift has no character literal at all, so an apostrophe in a stray line of
//! English is ordinary punctuation here and a reply of prose around a program still lexes, where the
//! same apostrophe declines [Kotlin's](super::super::kotlin::healing) whole mask.
//!
//! # Interpolation is a paren count, not a brace count
//!
//! `"total: \(rows["n"])"` is one string, and a scan that stopped at the quote before `n` would read
//! the rest of the line as code. Swift splices with `\(…)`, so the counter is over **parentheses**
//! rather than braces, and inside a raw string the escape carries the fence too: `#"\#(value)"#`. Its
//! contents are marked *code*, because they are.
//!
//! # None of these is a parser
//!
//! Not one predicate here parses, for the reason every other dialect gives: healing runs on text that
//! is not yet known to be a program — it may be Markdown, prose, or two programs pasted together — so
//! a parser would fail on precisely the inputs healing exists to repair. `swiftc` is downstream of all
//! of this and is what actually reads the program; every answer here is a lexical shape test with its
//! errors pointed in the safe direction, and every one of them **declines** rather than guessing when
//! it cannot tell.

use crate::healing::{CodeMask, Dialect};

/// Swift's dialect. A unit struct: everything it "holds" is the `const` data below.
pub(in crate::sandbox::language) struct SwiftDialect;

/// The one instance, held by [`Swift`](super::Swift) and handed out as `&'static dyn Dialect`.
pub(in crate::sandbox::language) static SWIFT_DIALECT: SwiftDialect = SwiftDialect;

impl Dialect for SwiftDialect {
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
/// `text`, `bash` or `swiftui` is context the model showed rather than the program, and tier 3 of the
/// candidacy ladder is what keeps the closed list from being a trap.
const PROGRAM_TAGS: &[&str] = &["swift"];

/// The statement, declaration and modifier keywords a line of Swift code may open with, matched
/// **case-sensitively** at an identifier boundary.
///
/// Case-sensitivity is the difference between the `for` that opens a loop and the `For` that opens a
/// sentence — the same distinction a real reply turned on for TypeScript's arm.
///
/// It is deliberately generous, and generous is the safe direction in **both** places it is read. In
/// [`looks_like_code`] a false positive costs a fence that could have been unwrapped — one turn, one
/// located diagnostic. In [`is_prose_line`] it is what stops a declaration from ever being deleted as
/// prose.
///
/// **`open` is the one exclusion, and it is this arm's own.** Every other word here opens no English
/// sentence; `open` is a verb, and "open a view of the value" is a lead-in a model writes constantly
/// — gg's own system prompt writes it repeatedly. Listing it would make that line un-deletable as
/// prose, which costs a repair, and would buy almost nothing: `open` is a declaration modifier that
/// is only meaningful across module boundaries, and a program of this arm has none.
///
/// `some` and `any` are left out for the same reason with less to lose: both are English determiners
/// and neither opens a declaration — they stand in *type* position, always with a declaration keyword
/// somewhere to their left on the same line.
const STATEMENT_KEYWORDS: [&str; 47] = [
    "if",
    "else",
    "for",
    "while",
    "repeat",
    "switch",
    "case",
    "default",
    "guard",
    "return",
    "break",
    "continue",
    "fallthrough",
    "defer",
    "do",
    "catch",
    "throw",
    "let",
    "var",
    "func",
    "struct",
    "class",
    "enum",
    "actor",
    "protocol",
    "extension",
    "typealias",
    "associatedtype",
    "init",
    "deinit",
    "subscript",
    "import",
    "operator",
    "precedencegroup",
    "public",
    "private",
    "internal",
    "fileprivate",
    "static",
    "final",
    "lazy",
    "indirect",
    "mutating",
    "nonisolated",
    "convenience",
    "override",
    "required",
];

/// The tokens a line of code may end with — a block opened or closed, a collection left open, or an
/// expression continued onto the next line.
///
/// There is **no `;`**, and its absence is this arm's own: Swift terminates a statement with a
/// newline, so a semicolon is a thing a Swift author almost never writes and a line ending in one is
/// no more code-shaped than any other. Every other C-shaped arm here reads that character first.
const CODE_ENDINGS: [&str; 12] = [
    "{", "}", ",", "(", "[", "->", "=>", "&&", "||", "+", "=", ":",
];

/// Characters no line of English prose contains.
///
/// The backtick is **absent**, which is [Rust's answer](super::super::rust::healing) rather than
/// [Kotlin's](super::super::kotlin::healing), and it is a closer call here because Swift really does
/// quote an identifier with backticks (`` let `class` = 1 ``). It is still the right call: an escaped
/// identifier is a rarity a model writes approximately never, while a lead-in written with an inline
/// code span (`` Use `views.openText` to show yourself a value ``) is the single most common prose
/// line there is, and one that could never be deleted would cost a repair on almost every fenced
/// reply.
///
/// `#` is **absent** in spite of `#"…"#`, `#if` and `#file` all being real Swift punctuation, for the
/// reason every other arm gives: a Markdown `# Heading` is a line that must stay deletable, and every
/// Swift shape that carries a `#` carries a `"`, a `(` or a keyword this list or
/// [`STATEMENT_KEYWORDS`] already reads.
const NON_PROSE_CHARS: [char; 14] = [
    ';', '{', '}', '(', ')', '[', ']', '=', '<', '>', '|', '&', '$', '\\',
];

// ---------------------------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------------------------

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

/// Whether `line` is **certainly** a line of Swift — this dialect's answer to
/// [`Dialect::looks_like_code`].
///
/// Its errors are asymmetric on purpose. A false positive costs a fence that could have been
/// unwrapped (one turn, one located diagnostic); a false negative deletes a line of the model's
/// program. So every clause below is a shape that only code has.
///
/// # One shape deliberately absent, because a real reply contains it
///
/// **A leading `*`.** It is a block-comment continuation line, and it is also how half the models
/// that write a bullet list write one. `strip-fences` declines outright when *any* line outside the
/// fences is code-shaped, so reading `* read the manifest` as code would send a reply of
/// prose-fence-prose to the compiler whole — which is the single most common real shape there is.
fn looks_like_code(line: &str) -> bool {
    let line = line.trim();
    if line.is_empty() {
        return false;
    }
    // 1. It ends the way an open block, a closed block or a continued expression ends. Deliberately
    //    without a `;`: Swift ends a statement with a newline.
    if CODE_ENDINGS.iter().any(|ending| line.ends_with(ending)) {
        return true;
    }
    // 2. It opens with a statement, declaration or modifier keyword.
    if starts_with_keyword(line) {
        return true;
    }
    // 3. It opens with a closer, a comment, an attribute or a compiler directive.
    if [
        "}", ")", "]", "//", "/*", "*/", "@", "#if", "#else", "#endif",
    ]
    .iter()
    .any(|prefix| line.starts_with(prefix))
    {
        return true;
    }
    // 4. It opens with a chain continuation — `.map { … }`, `.filter(…)` — which is how a Swift
    //    author breaks a long expression and is not how anyone writes a sentence. A bare `.` or an
    //    ellipsis is not one: an identifier has to follow.
    if line
        .strip_prefix('.')
        .is_some_and(|rest| rest.starts_with(is_ident_start))
    {
        return true;
    }
    // 5. It carries a return arrow, a trailing-closure arrow or an optional chain anywhere. `->` is
    //    in every signature a Swift author writes and `?.` is in a great many calls.
    if line.contains("->") || line.contains("?.") || line.contains("??") {
        return true;
    }
    // 6. It assigns to something. `total += 1` would otherwise be a line this dialect could say
    //    nothing at all about.
    if carries_an_assignment(line) {
        return true;
    }
    // 7. It opens with a call: an identifier or dotted chain immediately followed by `(` — or by a
    //    trailing closure's `{`, which is how a Swift author writes half their calls — behind an
    //    optional `try`, which is what stands in front of every call on gg's own surface.
    opens_with_call(line)
}

/// The `try`, `try!`, `try?` and `await` a call may stand behind, taken off the front of `line`.
///
/// Read here rather than added to [`STATEMENT_KEYWORDS`], and the difference is the whole reason
/// this function exists. `try` opens every gg call a Swift program writes, so a dialect that could
/// not see past one would say nothing about the most common line on this arm. It also opens an
/// English sentence — "try the following" — and listing it as a keyword would make that lead-in
/// un-deletable as prose, which costs a repair on a great many replies. Consuming it *only* in front
/// of something that is then shaped like a call gets both: `try views.openText(…)` is code and `try
/// the following:` is not.
fn past_try(line: &str) -> &str {
    let mut rest = line;
    loop {
        let stripped = ["try!", "try?", "try", "await"]
            .into_iter()
            .find_map(|token| {
                rest.strip_prefix(token)
                    .filter(|after| after.starts_with(char::is_whitespace))
            });
        match stripped {
            Some(after) => rest = after.trim_start(),
            None => return rest,
        }
    }
}

/// Whether `line` opens with a Swift keyword at an identifier boundary.
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

/// Whether `line` opens with `name(`, `a.b(` or `name {` — `views.openText(`, `entries.map {`.
fn opens_with_call(line: &str) -> bool {
    let line = past_try(line);
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
        if c == '.' {
            let next = line[index + 1..].chars().next();
            if next.is_some_and(is_ident_start) {
                chars.next();
                continue;
            }
        }
        break;
    }
    let rest = line[end..].trim_start();
    // A trailing closure is only read as a call when the brace is glued to the name or one space
    // behind it — `rows.map {`. Anything further out is a sentence that happened to end in a brace,
    // and clause 1 has already read that shape anyway.
    rest.starts_with('(') || (line[end..].starts_with([' ', '{']) && rest.starts_with('{'))
}

/// Whether `line` is **certainly** prose rather than Swift — this dialect's answer to
/// [`Dialect::is_prose_line`], and the test `strip-prose` uses to delete a line.
///
/// The mirror image of [`looks_like_code`]: here a false positive deletes the model's code, so every
/// clause is a shape that only English has. The two predicates are **not** complements and are not
/// disjoint — a line may satisfy both, or neither — and the pipeline's fixpoint loop is what resolves
/// the overlap.
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
    // 2. Not a statement, a declaration or a modifier.
    if starts_with_keyword(line) {
        return false;
    }
    // 3. Not a return arrow or an optional chain, neither of which English has any use for.
    if line.contains("->") || line.contains("?.") {
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

/// Lex `src` into its [code mask](CodeMask) — this dialect's answer to [`Dialect::code_mask`], and
/// the one reading [a code module's own scan](super::source) shares.
///
/// `None` means the source did not lex cleanly, and every reader of the mask declines on it. Four
/// states end a scan uncleanly: an unterminated block comment, an unterminated string of any
/// kind, a single-line string still open at a newline — which Swift forbids — and a backslash with
/// nothing after it.
///
/// Swift asks four things of a lexer that [Java's](super::super::java::healing) does not:
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
/// Its bytes are marked as **not code** for the reason [Kotlin's](super::super::kotlin::healing) are:
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

#[cfg(test)]
#[path = "swift.healing.test.rs"]
mod tests;
