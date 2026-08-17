//! **Java's [healing dialect](crate::healing::Dialect)** — the lexical half of
//! [response healing](crate::healing), answered in Java's own terms.
//!
//! Java's syntax is the closest of any registered arm to
//! [TypeScript's](super::super::typescript::healing), and it would have been easy to hand this arm
//! that dialect and move on. It would also have been wrong in two separate places, and each of
//! them is a place where the *same rule* reaches a different conclusion because the language is
//! different. They are the whole content of this file:
//!
//! **A `#` line is prose, and is deleted.** [Python's](super::super::python::healing) and
//! [Ruby's](super::super::ruby::healing) arms refuse to touch one, because `# Plan` is a comment in
//! those languages as well as a Markdown heading and nothing lexical tells the two apart. Java has
//! no `#` at all — it is not a comment, not an operator, not a legal token — so a `#` line is
//! certainly not Java, and leaving one in a program is a syntax error rather than a surviving
//! comment. This is [PureScript's](super::super::purescript::healing) answer arrived at from
//! Java's grammar rather than PureScript's. What is never prose here is a `//` or `/*` line.
//!
//! **A backtick is not code punctuation.** Every other C-shaped dialect lists `` ` `` among the
//! characters no prose line contains, because in ECMAScript it opens a template literal. Java has no
//! template literal and no backtick anywhere in its grammar, so a line carrying one is *certainly*
//! prose — which is what lets a lead-in like ``I'll read `Main.java` first.`` be deleted here where
//! TypeScript's dialect has to keep it.
//!
//! # None of these is a parser
//!
//! Not one predicate here parses, for the reason every other dialect gives: healing runs on text
//! that is **not yet known to be a program** — it may be Markdown, prose, or two programs pasted
//! together — so a parser would fail on precisely the inputs healing exists to repair. javac is
//! downstream of all of this and is what actually reads the program; every answer here is a lexical
//! shape test with its errors pointed in the safe direction, and every one of them **declines**
//! rather than guessing when it cannot tell.

use crate::healing::{CodeMask, Dialect};

/// Java's dialect. A unit struct: everything it "holds" is the `const` data below.
pub(in crate::sandbox::language) struct JavaDialect;

/// The one instance, held by [`Java`](super::Java) and handed out as `&'static dyn Dialect`.
pub(in crate::sandbox::language) static JAVA_DIALECT: JavaDialect = JavaDialect;

impl Dialect for JavaDialect {
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
/// `jshell` is deliberately **absent**, for the reason Python's dialect excludes `pycon` and Ruby's
/// excludes `irb`: it names a *transcript* of an interactive session, prompts and answers
/// interleaved, which is not a program and would not run as one.
const PROGRAM_TAGS: &[&str] = &["java", "jav"];

/// The statement and declaration keywords a line of Java code may open with, matched
/// **case-sensitively** at an identifier boundary.
///
/// Case-sensitivity is the difference between the `for` that opens a loop and the `For` that opens a
/// sentence — the same distinction a real reply turned on for TypeScript's arm.
///
/// It is deliberately generous, and generous is the safe direction in **both** places it is read. In
/// [`looks_like_code`] a false positive costs a fence that could have been unwrapped — one turn,
/// one located diagnostic. In [`is_prose_line`] it is what stops a statement from ever being deleted
/// as prose. So the primitive type names are here (they open the most common declaration a program
/// writes), the access modifiers are here (a program opens with `public final class Program`), and
/// the type declarations are here.
const STATEMENT_KEYWORDS: [&str; 45] = [
    "if",
    "else",
    "for",
    "while",
    "do",
    "switch",
    "case",
    "default",
    "break",
    "continue",
    "return",
    "try",
    "catch",
    "finally",
    "throw",
    "throws",
    "new",
    "class",
    "interface",
    "enum",
    "record",
    "import",
    "package",
    "static",
    "final",
    "public",
    "private",
    "protected",
    "abstract",
    "synchronized",
    "var",
    "void",
    "int",
    "long",
    "short",
    "byte",
    "char",
    "float",
    "double",
    "boolean",
    "this",
    "super",
    "assert",
    "yield",
    "instanceof",
];

/// The tokens a line of code may end with — a statement terminated, a block opened or closed, a
/// collection left open, or an expression continued onto the next line.
///
/// `->` is Java's lambda arrow, which is where TypeScript's list has `=>`.
const CODE_ENDINGS: [&str; 12] = [
    ";", "{", "}", ",", "(", "[", "->", "&&", "||", "+", "=", ":",
];

/// Characters no line of English prose contains.
///
/// The backtick is **absent**, and its absence is this dialect's own answer rather than an
/// oversight. Every C-shaped dialect before this one listed it, because in ECMAScript a backtick
/// opens a template literal and a line carrying one may well be code. Java has no template literal
/// and no backtick anywhere in its grammar, so a line carrying one is certainly *not* Java — which
/// is what lets a lead-in written with an inline code span be deleted here.
const NON_PROSE_CHARS: [char; 14] = [
    ';', '{', '}', '(', ')', '[', ']', '=', '<', '>', '|', '&', '$', '\\',
];

// ---------------------------------------------------------------------------------------------
// The predicates
// ---------------------------------------------------------------------------------------------

/// Whether `line` is **certainly** a line of Java — this dialect's answer to
/// [`Dialect::looks_like_code`].
///
/// Its errors are asymmetric on purpose. A false positive costs a fence that could have been
/// unwrapped (one turn, one located diagnostic); a false negative deletes a line of the model's
/// program. So every clause below is a shape that only code has.
///
/// # One shape deliberately absent, because a real reply contains it
///
/// **A leading `*`.** It is a Javadoc continuation line, and it is also how half the models that
/// write a bullet list write one. `strip-fences` declines outright when *any* line outside the
/// fences is code-shaped, so reading `* read the manifest` as code would send a reply of
/// prose-fence-prose to javac whole — which is the single most common real shape there is. Nothing
/// is lost by leaving it out: `strip-prose` only deletes *runs* from the two ends of a reply, and
/// the run that would reach a Javadoc block stops at its `/**` opener, which clause 3 does keep.
fn looks_like_code(line: &str) -> bool {
    let line = line.trim();
    if line.is_empty() {
        return false;
    }
    // 1. It ends the way a statement, an open block or a continued expression ends.
    if CODE_ENDINGS.iter().any(|ending| line.ends_with(ending)) {
        return true;
    }
    // 2. It opens with a statement or declaration keyword.
    if starts_with_keyword(line) {
        return true;
    }
    // 3. It opens with a closer, a comment or an annotation.
    if ["}", ")", "]", "//", "/*", "@"]
        .iter()
        .any(|prefix| line.starts_with(prefix))
    {
        return true;
    }
    // 4. It carries a lambda arrow or a method reference anywhere.
    if line.contains("->") || line.contains("::") {
        return true;
    }
    // 5. It contains a `;` that terminates a statement — nothing after it but a comment.
    if line.match_indices(';').any(|(at, _)| {
        let rest = line[at + 1..].trim_start();
        rest.is_empty() || rest.starts_with("//") || rest.starts_with("/*")
    }) {
        return true;
    }
    // 6. It opens with a call: an identifier or dotted chain immediately followed by `(`.
    opens_with_call(line)
}

/// Whether `line` opens with a Java statement keyword at an identifier boundary.
fn starts_with_keyword(line: &str) -> bool {
    STATEMENT_KEYWORDS.iter().any(|keyword| {
        line.strip_prefix(keyword)
            .is_some_and(|rest| rest.chars().next().is_none_or(|c| !is_ident_char(c)))
    })
}

/// Whether `line` opens with `identifier(`, `a.b(` or `a.b.c(` — `readFile(`, `System.out.println(`,
/// `entries.stream(`.
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

/// Whether `line` is **certainly** prose rather than Java — this dialect's answer to
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
    // 1. No punctuation that only code uses, and no comment opener. A backtick is deliberately not
    //    on that list — see `NON_PROSE_CHARS`.
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

/// Whether `c` may open a Java identifier.
///
/// ASCII-plus-Unicode-letters, which is close enough: a Unicode identifier is legal Java and is
/// simply never a keyword, which is all these readings decide.
fn is_ident_start(c: char) -> bool {
    c.is_alphabetic() || c == '_' || c == '$'
}

/// Whether `c` may continue one.
fn is_ident_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '$'
}

// ---------------------------------------------------------------------------------------------
// The lexer
// ---------------------------------------------------------------------------------------------

/// Lex `src` into its [code mask](CodeMask) — this dialect's answer to [`Dialect::code_mask`].
///
/// `None` means the source did not lex cleanly, and every caller that needs the mask declines on
/// it. Four states end a scan uncleanly: an unterminated block comment, an unterminated text block,
/// a string or character literal still open at a newline — which Java forbids — and a backslash with
/// nothing after it.
///
/// Handles `"…"`, `'…'`, `"""…"""` text blocks, `//…\n`, `/*…*/` and backslash escapes. There is no
/// interpolation to re-enter, which is the one thing that makes this simpler than
/// [TypeScript's](super::super::typescript::healing): Java has no template literal, so a string is a
/// run of bytes with no code inside it and the scan never has to count braces to come back out.
///
/// # The one shape it does not lex
///
/// A `'` that is neither a character literal nor closed on its line — an apostrophe in a stray line
/// of English that reached this far. The scan returns `None` and the reading is given up whole,
/// which is the correct failure mode for one already known to be wrong. It is not the same exposure
/// TypeScript's regular-expression hole is, because Java has no `/`-delimited literal for a quote to
/// hide inside.
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
                let end = find(bytes, index + 2, b"*/")? + 2;
                mark(&mut code, index..end);
                index = end;
            }
            // A text block first: `"""` also starts with `"`, and reading it as an empty string
            // followed by one would put its whole body back in the code.
            b'"' if matches_at(bytes, index, b"\"\"\"") => {
                let end = quoted_end(bytes, index + 3, b"\"\"\"", false)?;
                mark(&mut code, index..end);
                index = end;
            }
            b'"' => {
                let end = quoted_end(bytes, index + 1, b"\"", true)?;
                mark(&mut code, index..end);
                index = end;
            }
            b'\'' => {
                let end = quoted_end(bytes, index + 1, b"'", true)?;
                mark(&mut code, index..end);
                index = end;
            }
            _ => index += 1,
        }
    }
    Some(CodeMask::from_flags(code))
}

/// Where a quoted run that opened at `from` ends, past its closing `terminator`.
///
/// `single_line` is what a string and a character literal have and a text block does not: Java
/// forbids either from carrying a raw newline, so one still open at a `\n` is a scan that has lost
/// its place and the whole mask is given up.
fn quoted_end(bytes: &[u8], from: usize, terminator: &[u8], single_line: bool) -> Option<usize> {
    let mut at = from;
    while at < bytes.len() {
        if bytes[at] == b'\\' {
            if at + 1 >= bytes.len() {
                return None;
            }
            at += 2;
            continue;
        }
        if single_line && bytes[at] == b'\n' {
            return None;
        }
        if matches_at(bytes, at, terminator) {
            return Some(at + terminator.len());
        }
        at += 1;
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
#[path = "java.healing.test.rs"]
mod tests;
