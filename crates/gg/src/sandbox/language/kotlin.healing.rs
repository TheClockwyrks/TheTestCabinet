//! **Kotlin's [healing dialect](crate::healing::Dialect)** — the lexical half of
//! [response healing](crate::healing), answered in Kotlin's own terms.
//!
//! This arm shares a compiler road, a canonical ABI and a classlib with
//! [Java's](super::super::java), which
//! makes it the sharpest test the seam has of whether a dialect is *derived* or copied: two arms
//! that could hardly be closer downstream reach a **different answer to both readings**, and each of
//! the two is the same rule reading a different grammar.
//!
//! **A backtick is code punctuation here, and on that arm it is not.** Java has no backtick anywhere
//! in its grammar, so [its dialect](super::super::java::healing) reads a line carrying one as
//! certainly prose and deletes a lead-in written with an inline code span. Kotlin has **backquoted
//! identifiers** — `` fun `a name with spaces`() `` is legal — so the same line may be code, and the
//! rule that every clause of [`is_prose_line`] must be a shape *only English has* puts the backtick
//! back on the non-prose list beside [TypeScript's](super::super::typescript::healing),
//! [Python's](super::super::python::healing) and [Ruby's](super::super::ruby::healing).
//!
//! **There is no statement terminator to lean on.** Java's strongest single reading of "this line is
//! code" is a `;` that ends a statement; Kotlin's statements simply end at the newline, so that
//! clause is nearly dead weight here and the whole reading rests on the keyword clause, the call
//! clause, and one clause no other C-shaped arm needs: a line that carries an **assignment**. Without
//! it `total += 1` is a line this dialect could say nothing about at all.
//!
//! # Why this is not [the arm's other lexer](super::source)
//!
//! [`source`](super::source) already reads Kotlin closely enough to tell an `import` from the word
//! `import` inside a raw string, and it is deliberately **not** reused here, because the two answer
//! the same question under opposite contracts. That one runs over text already accepted as the
//! program, with the compiler downstream to locate anything it got wrong, so it is **total**: an
//! unterminated string simply runs to the end of the file and the compiler says so. This one runs
//! over text **not yet known to be a program**, so it must be able to say *I lost my place*, and
//! [`code_mask`] returns `None` for an unterminated string, comment, character literal or backquoted
//! name. It also reads `"` and `'` as **line-bounded**, which Kotlin's grammar says they are and
//! which is what makes an apostrophe in a stray line of English decline the whole reading rather than
//! swallow the program after it.
//!
//! # None of these is a parser
//!
//! Not one predicate here parses, for the reason every other dialect gives: healing runs on text that
//! is not yet known to be a program — it may be Markdown, prose, or two programs pasted together — so
//! a parser would fail on precisely the inputs healing exists to repair. The Kotlin compiler is
//! downstream of all of this and is what actually reads the program; every answer here is a lexical
//! shape test with its errors pointed in the safe direction, and every one of them **declines**
//! rather than guessing when it cannot tell.

use crate::healing::{CodeMask, Dialect};

/// Kotlin's dialect. A unit struct: everything it "holds" is the `const` data below.
pub(in crate::sandbox::language) struct KotlinDialect;

/// The one instance, held by [`Kotlin`](super::Kotlin) and handed out as `&'static dyn Dialect`.
pub(in crate::sandbox::language) static KOTLIN_DIALECT: KotlinDialect = KotlinDialect;

impl Dialect for KotlinDialect {
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
/// `text`, `bash` or `xml` is context the model showed rather than the program, and tier 3 of the
/// candidacy ladder is what keeps the closed list from being a trap.
///
/// `kts` is here on purpose, though a program is compiled as an ordinary `.kt` file: a model that
/// reached for the script extension has still written the Kotlin its block holds, and refusing to
/// read the block over its tag would cost a turn for a label.
const PROGRAM_TAGS: &[&str] = &["kotlin", "kt", "kts"];

/// The statement and declaration keywords a line of Kotlin code may open with, matched
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
/// What is left out is the set of **soft keywords that open no statement at all**: `it`, `in`, `is`,
/// `as`, `by`, `to`, `where` and `out` are operators, infix functions or type-position words, so
/// listing them would buy nothing in the first reading and cost a great deal of English in the
/// second — every one of them opens an ordinary sentence. `value` is left out on the same grounds
/// with one addition: `value class` is the rarest declaration the language has, and every real line
/// of it carries a `(` or a `{` that another clause reads anyway.
const STATEMENT_KEYWORDS: [&str; 45] = [
    "if",
    "else",
    "for",
    "while",
    "do",
    "when",
    "return",
    "break",
    "continue",
    "throw",
    "try",
    "catch",
    "finally",
    "val",
    "var",
    "fun",
    "class",
    "interface",
    "object",
    "enum",
    "data",
    "sealed",
    "annotation",
    "typealias",
    "companion",
    "constructor",
    "init",
    "import",
    "package",
    "private",
    "public",
    "internal",
    "protected",
    "open",
    "abstract",
    "final",
    "override",
    "inline",
    "suspend",
    "operator",
    "infix",
    "lateinit",
    "const",
    "vararg",
    "this",
];

/// The tokens a line of code may end with — a block opened or closed, a collection left open, or an
/// expression continued onto the next line.
///
/// `;` is on the list and earns almost nothing, which is the point: Kotlin has no statement
/// terminator, so the reading that carries most of Java's dialect carries hardly any of this one and
/// the weight moves to [`starts_with_keyword`], [`opens_with_call`] and
/// [`carries_an_assignment`].
const CODE_ENDINGS: [&str; 12] = [
    "{", "}", "(", "[", ",", "->", "&&", "||", "+", "=", ":", ";",
];

/// Characters no line of English prose contains.
///
/// The backtick **is** here, which is where this dialect parts company with
/// [Java's](super::super::java::healing) and rejoins every other one: Kotlin has backquoted
/// identifiers, so a line carrying a backtick may perfectly well be code, and the rule that every
/// clause of [`is_prose_line`] be a shape only English has does not allow it to be read as prose.
///
/// `#` is deliberately **absent**, which is Java's and PureScript's answer against Python's and
/// Ruby's: Kotlin has no `#` token at all — not a comment, not an operator — so a `#` line is
/// certainly not Kotlin, and leaving one in a program is a syntax error rather than a surviving
/// comment.
const NON_PROSE_CHARS: [char; 15] = [
    ';', '{', '}', '(', ')', '[', ']', '=', '<', '>', '|', '&', '$', '\\', '`',
];

// ---------------------------------------------------------------------------------------------
// The predicates
// ---------------------------------------------------------------------------------------------

/// Whether `line` is **certainly** a line of Kotlin — this dialect's answer to
/// [`Dialect::looks_like_code`].
///
/// Its errors are asymmetric on purpose. A false positive costs a fence that could have been
/// unwrapped (one turn, one located diagnostic); a false negative deletes a line of the model's
/// program. So every clause below is a shape that only code has.
///
/// # One shape deliberately absent, because a real reply contains it
///
/// **A leading `*`.** It is a KDoc continuation line, and it is also how half the models that write
/// a bullet list write one. `strip-fences` declines outright when *any* line outside the fences is
/// code-shaped, so reading `* read the manifest` as code would send a reply of prose-fence-prose to
/// the compiler whole — which is the single most common real shape there is. Nothing is lost by
/// leaving it out: `strip-prose` only deletes *runs* from the two ends of a reply, and the run that
/// would reach a KDoc block stops at its `/**` opener, which clause 3 does keep.
fn looks_like_code(line: &str) -> bool {
    let line = line.trim();
    if line.is_empty() {
        return false;
    }
    // 1. It ends the way an open block or a continued expression ends. Worth far less here than on
    //    any other C-shaped arm, because Kotlin's statements end at the newline.
    if CODE_ENDINGS.iter().any(|ending| line.ends_with(ending)) {
        return true;
    }
    // 2. It opens with a statement or declaration keyword.
    if starts_with_keyword(line) {
        return true;
    }
    // 3. It opens with a closer, a comment or an annotation.
    if ["}", ")", "]", "//", "/*", "*/", "@"]
        .iter()
        .any(|prefix| line.starts_with(prefix))
    {
        return true;
    }
    // 4. It opens with a chain continuation — `.map { … }`, `?.let { … }` — which is how a Kotlin
    //    author breaks a long expression and is not how anyone writes a sentence. A bare `.` or an
    //    ellipsis is not one: an identifier has to follow.
    if chain_continuation(line) {
        return true;
    }
    // 5. It carries a lambda arrow or a callable reference anywhere.
    if line.contains("->") || line.contains("::") {
        return true;
    }
    // 6. It assigns to something. This clause is Kotlin's own: with no statement terminator to read,
    //    `total += 1` would otherwise be a line this dialect could say nothing at all about.
    if carries_an_assignment(line) {
        return true;
    }
    // 7. It opens with a call: an identifier or dotted chain immediately followed by `(`.
    opens_with_call(line)
}

/// Whether `line` opens with a Kotlin statement keyword at an identifier boundary.
fn starts_with_keyword(line: &str) -> bool {
    STATEMENT_KEYWORDS.iter().any(|keyword| {
        line.strip_prefix(keyword)
            .is_some_and(|rest| rest.chars().next().is_none_or(|c| !is_ident_char(c)))
    })
}

/// Whether `line` opens with `.name`, `?.name` or `!!.name` — a chain continued from the line above.
fn chain_continuation(line: &str) -> bool {
    let rest = line
        .strip_prefix("?.")
        .or_else(|| line.strip_prefix("!!."))
        .or_else(|| line.strip_prefix('.'));
    rest.is_some_and(|rest| rest.starts_with(is_ident_start))
}

/// Whether `line` carries an assignment operator outside a comparison.
///
/// `==`, `!=`, `<=`, `>=` and `===` are comparisons and none of them is one; a bare `=` and the
/// compound forms are.
fn carries_an_assignment(line: &str) -> bool {
    for compound in ["+=", "-=", "*=", "/=", "%="] {
        if line.contains(compound) {
            return true;
        }
    }
    let bytes = line.as_bytes();
    line.match_indices('=').any(|(at, _)| {
        let before = at.checked_sub(1).map(|index| bytes[index]);
        let after = bytes.get(at + 1).copied();
        !matches!(before, Some(b'=' | b'!' | b'<' | b'>')) && after != Some(b'=')
    })
}

/// Whether `line` opens with `identifier(`, `a.b(` or `a.b.c(` — `println(`, `fs.readFile(`,
/// `rows.stream(`.
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
        // ended at the previous character, which is what keeps `Done. Created …` prose.
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

/// Whether `line` is **certainly** prose rather than Kotlin — this dialect's answer to
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
    // 1. No punctuation that only code uses, and no comment opener. The backtick is on that list
    //    here and is not on Java's — see `NON_PROSE_CHARS`.
    if line.contains(NON_PROSE_CHARS) || line.contains("//") || line.contains("/*") {
        return false;
    }
    // 2. Not a statement.
    if starts_with_keyword(line) {
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

/// Whether `c` may open a Kotlin identifier.
///
/// ASCII-plus-Unicode-letters, which is close enough: a Unicode identifier is legal Kotlin and is
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
/// on it. Four states end a scan uncleanly: an unterminated block comment, an unterminated raw
/// string, a string, character literal or backquoted name still open at a newline — which Kotlin
/// forbids — and a backslash with nothing after it.
///
/// Kotlin asks three things of a lexer that [Java's](super::super::java::healing) does not, and each
/// of them is a place a Java-shaped scan silently loses the source:
///
/// * **string templates.** `"total: ${rows["n"]}"` is one string, and a scan that stopped at the
///   quote before `n` would read the rest of the line as code — so a `${…}` is followed through with
///   a brace counter, nested strings and all, and its contents are marked **code** because they are.
/// * **nested block comments.** `/* a /* b */ c */` is one comment in Kotlin and two in Java, and
///   reading it Java's way leaves ` c */` behind as code.
/// * **backquoted identifiers.** The bytes between backticks may hold a brace or a keyword and mean
///   neither.
///
/// `$name` — the template form with no braces — is deliberately left as string bytes. The name
/// inside it is an identifier and nothing this module reads cares about one; what a mask must not
/// lose is a **delimiter**, and only the braced form can carry one.
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
            // A raw string first: `"""` also starts with `"`, and reading it as an empty string
            // followed by one would put its whole body back in the code.
            b'"' if matches_at(bytes, index, b"\"\"\"") => {
                index = quoted(bytes, &mut code, index, b"\"\"\"", true, false)?;
            }
            b'"' => {
                index = quoted(bytes, &mut code, index, b"\"", false, true)?;
            }
            b'\'' => {
                index = quoted(bytes, &mut code, index, b"'", false, true)?;
            }
            b'`' => {
                index = quoted(bytes, &mut code, index, b"`", true, true)?;
            }
            _ => index += 1,
        }
    }
    Some(CodeMask::from_flags(code))
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

/// Where a quoted run that opened at `from` ends, past its closing `close` — marking every byte of
/// it as not code, except a `${…}` template's, which is.
///
/// `raw` says whether a `\` is an escape: it is not, inside a raw string or a backquoted name.
/// `single_line` is what a string, a character literal and a backquoted name have and a raw string
/// does not: Kotlin forbids a raw newline in any of the three, so one still open at a `\n` is a scan
/// that has lost its place and the whole mask is given up.
fn quoted(
    bytes: &[u8],
    code: &mut [bool],
    from: usize,
    close: &[u8],
    raw: bool,
    single_line: bool,
) -> Option<usize> {
    mark(code, from..from + close.len());
    let templates = close != b"`";
    let mut at = from + close.len();
    while at < bytes.len() {
        if !raw && bytes[at] == b'\\' {
            if at + 1 >= bytes.len() {
                return None;
            }
            mark(code, at..at + 2);
            at += 2;
            continue;
        }
        if single_line && bytes[at] == b'\n' {
            return None;
        }
        if matches_at(bytes, at, close) {
            mark(code, at..at + close.len());
            return Some(at + close.len());
        }
        if templates && matches_at(bytes, at, b"${") {
            at = template_end(bytes, code, at + 2)?;
            continue;
        }
        mark(code, at..at + 1);
        at += 1;
    }
    None
}

/// Where a `${…}` template that opened at `at` ends, past its closing brace — leaving everything
/// inside it marked as code, which is what it is.
fn template_end(bytes: &[u8], code: &mut [bool], at: usize) -> Option<usize> {
    let mut depth = 1usize;
    let mut scan = at;
    while scan < bytes.len() {
        // A string inside a template is skipped whole, which is what stops its quotes from being
        // read as the enclosing string's.
        let nested = match bytes[scan] {
            b'"' if matches_at(bytes, scan, b"\"\"\"") => {
                Some(quoted(bytes, code, scan, b"\"\"\"", true, false)?)
            }
            b'"' => Some(quoted(bytes, code, scan, b"\"", false, true)?),
            b'\'' => Some(quoted(bytes, code, scan, b"'", false, true)?),
            b'`' => Some(quoted(bytes, code, scan, b"`", true, true)?),
            b'/' if matches_at(bytes, scan, b"/*") => Some(comment_end(bytes, code, scan)?),
            _ => None,
        };
        if let Some(end) = nested {
            scan = end;
            continue;
        }
        match bytes[scan] {
            b'{' => depth += 1,
            b'}' => {
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
#[path = "kotlin.healing.test.rs"]
mod tests;
