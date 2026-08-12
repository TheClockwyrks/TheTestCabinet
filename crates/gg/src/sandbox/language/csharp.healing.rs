//! **C#'s [healing dialect](crate::healing::Dialect)** — the lexical half of
//! [response healing](crate::healing), answered in C#'s own terms.
//!
//! One of its answers is worth naming before the code, because it is the one place where a byte a
//! model really writes means opposite things in Markdown and in C#.
//!
//! **`#` is both Markdown's heading and C#'s preprocessor, and case is the whole of the
//! difference.** This is [C++](super::super::cpp::healing)'s problem in a milder form and it takes
//! the same answer: `#` is *not* on [`NON_PROSE_CHARS`], so a `# Heading` above a fenced program
//! stays deletable, and a line whose `#` is followed by one of thirteen directive words **spelled
//! lower-case** is code to both predicates. `#nullable enable` and `#region parsing` are lines a C#
//! author really writes; `# Nullable reference types` is a heading, and one letter's case is what
//! tells them apart.
//!
//! # What its lexer asks that no other arm's does
//!
//! * **A raw string's fence is a run of quotes chosen by its author.** `"""he said "no" here"""` is
//!   one string, and inside it neither `"` nor `\` means anything.
//! * **An interpolation hole is code again**, and it may contain another string:
//!   `$"{items.First(x => $"{x}")}"` is one expression a scanner that stopped at the second quote
//!   would read as three.
//! * **`@"…"` escapes a quote by doubling it**, so a run of them is that many pairs and, if the run
//!   is odd, the one that closes the literal.
//! * **`'` is only ever a character literal.** C# spells a digit separator `_`, so this arm needs
//!   none of [C++](super::super::cpp::healing)'s reasoning about `1'000'000`.
//!
//! All of that is [`source::scan`](super::source::scan)'s, which is the only lexer this arm has and
//! answers two questions with one pass: this module takes a mask **only when the scan ended
//! cleanly**, and the module reader takes the best reading whatever happened.
//!
//! # None of these is a parser
//!
//! Not one predicate here parses, for the reason every other dialect gives: healing runs on text
//! that is not yet known to be a program — it may be Markdown, prose, or two programs pasted
//! together — so a parser would fail on precisely the inputs healing exists to repair. `csc` is
//! downstream of all of this and is what actually reads the program; every answer here is a lexical
//! shape test with its errors pointed in the safe direction, and every one of them **declines**
//! rather than guessing when it cannot tell.

use crate::healing::{CodeMask, Dialect};

use super::source::{Mask, scan};

/// C#'s dialect. A unit struct: everything it "holds" is the `const` data below.
pub(in crate::sandbox::language) struct CSharpDialect;

/// The one instance, held by [`CSharp`](super::CSharp) and handed out as `&'static dyn Dialect`.
pub(in crate::sandbox::language) static CSHARP_DIALECT: CSharpDialect = CSharpDialect;

impl Dialect for CSharpDialect {
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
/// `c#` is here because it is what the language is called, and `cs` because it is the file
/// extension models reach for when a tool's tag list has no `#` in it. `c` is deliberately **not**
/// among them, for [C++'s reason](super::super::cpp::healing): a block a model tagged `c` is C, and
/// far more often somebody else's source shown as context than it is this reply's own program.
const PROGRAM_TAGS: &[&str] = &["csharp", "c#", "cs"];

/// The statement, declaration and modifier keywords a line of C# code may open with, matched
/// **case-sensitively** at an identifier boundary.
///
/// Case-sensitivity is the difference between the `for` that opens a loop and the `For` that opens a
/// sentence — the same distinction a real reply turned on for TypeScript's arm.
///
/// It is deliberately generous, and generous is the safe direction in **both** places it is read. In
/// [`looks_like_code`] a false positive costs a fence that could have been unwrapped — one turn, one
/// located diagnostic. In [`is_prose_line`] it is what stops a declaration from ever being deleted
/// as prose.
///
/// **The type names are here and the English words are not.** `var`, `int`, `bool`, `string`,
/// `void`, `double` and `object` open the majority of the declarations a C# author writes, and not
/// one of them opens an English sentence. `new`, `this`, `is`, `in`, `as`, `out` and `base` are left
/// out for the opposite reason: each is an ordinary English word a model writes constantly ("this
/// reads the manifest", "as the list grows"), and each appears in the middle of the expressions that
/// really use it, where clause 5 and clause 7 already read the line.
const STATEMENT_KEYWORDS: [&str; 49] = [
    "if",
    "else",
    "for",
    "foreach",
    "while",
    "do",
    "switch",
    "case",
    "default",
    "return",
    "break",
    "continue",
    "goto",
    "try",
    "catch",
    "finally",
    "throw",
    "yield",
    "lock",
    "checked",
    "unchecked",
    "fixed",
    "unsafe",
    "var",
    "const",
    "readonly",
    "static",
    "public",
    "private",
    "protected",
    "internal",
    "sealed",
    "abstract",
    "virtual",
    "override",
    "partial",
    "extern",
    "class",
    "struct",
    "record",
    "enum",
    "interface",
    "delegate",
    "namespace",
    "using",
    "void",
    "int",
    "bool",
    "string",
];

/// The tokens a line of code may end with — a statement terminated, a block opened or closed, a
/// collection left open, an expression continued onto the next line, or a lambda arrow.
///
/// The `;` is first, and on this arm it is the strongest single signal there is: C# terminates every
/// statement with one and English never ends a sentence with one.
const CODE_ENDINGS: [&str; 13] = [
    ";", "{", "}", ",", "(", "[", "=>", "&&", "||", "+", "=", ":", "?",
];

/// Characters no line of English prose contains.
///
/// `#` is **absent**, which is this arm's own call and the one that took the most thought, for
/// [C++'s reason](super::super::cpp::healing): a Markdown `# Heading` is the most common prose line
/// above a fenced program and must stay deletable, while `#nullable`, `#region` and `#pragma` are
/// lines this language really opens a file with. So the preprocessor is read by
/// [`opens_a_directive`] instead — lower-case, at a word boundary — which catches every directive a
/// program writes and no heading anybody capitalises.
///
/// `<` and `>` are **present**, as they are on every other arm whose language has generics, and they
/// carry more here than on most: `List<string>`, `IReadOnlyList<DirEntry>` and a comparison all use
/// them, and English does not. What it costs is a line of prose containing one, which is a shape
/// almost nothing a model writes has.
///
/// The backtick is absent for [Rust's reason](super::super::rust::healing): a lead-in written with
/// an inline code span (`` Use `Views.OpenText` to show yourself a value ``) is the single most
/// common prose line there is, and one that could never be deleted would cost a repair on almost
/// every fenced reply.
const NON_PROSE_CHARS: [char; 15] = [
    ';', '{', '}', '(', ')', '[', ']', '=', '<', '>', '|', '&', '$', '\\', '~',
];

/// The preprocessor directives a line's `#` may introduce, lower-cased.
///
/// A **closed** list, and lower-case is what does the work: `#nullable` is a directive and
/// `# Nullable reference types` is a Markdown heading, and the two are the same bytes but for one
/// letter's case. Being wrong here can only make a heading un-deletable, which costs a repair.
const DIRECTIVES: [&str; 13] = [
    "if",
    "else",
    "elif",
    "endif",
    "define",
    "undef",
    "warning",
    "error",
    "line",
    "region",
    "endregion",
    "pragma",
    "nullable",
];

/// Whether `line`'s own text is a preprocessor directive — `#nullable enable`, `#  region parsing`.
///
/// The `#` may be separated from its word by whitespace, which is legal C# and something a scan
/// looking for the token `#region` would miss.
fn opens_a_directive(line: &str) -> bool {
    let Some(rest) = line.trim_start().strip_prefix('#') else {
        return false;
    };
    let rest = rest.trim_start();
    DIRECTIVES.iter().any(|directive| {
        rest.strip_prefix(directive)
            .is_some_and(|after| !after.starts_with(is_ident_char))
    })
}

// ---------------------------------------------------------------------------------------------
// The predicates
// ---------------------------------------------------------------------------------------------

/// Whether `line` is **certainly** a line of C# — this dialect's answer to
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
    // 1. It ends the way a terminated statement, an open block, a closed block, a lambda or a
    //    continued expression ends. `;` is the strongest of them and is what most lines of C# end
    //    with.
    if CODE_ENDINGS.iter().any(|ending| line.ends_with(ending)) {
        return true;
    }
    // 2. It opens with a statement, declaration or modifier keyword.
    if starts_with_keyword(line) {
        return true;
    }
    // 3. It is a preprocessor directive — lower-cased, which is what tells `#region` from a Markdown
    //    `# Region of interest`.
    if opens_a_directive(line) {
        return true;
    }
    // 4. It opens with a closer, a comment or an attribute. `///` is C#'s documentation comment and
    //    is caught by the `//` it starts with.
    if ["}", ")", "]", "//", "/*", "*/", "["]
        .iter()
        .any(|prefix| line.starts_with(prefix))
    {
        return true;
    }
    // 5. It carries a null-conditional access, a null-coalescing operator or a lambda arrow
    //    anywhere. None of the three has an English reading at all.
    if line.contains("?.") || line.contains("??") || line.contains("=>") {
        return true;
    }
    // 6. It assigns to something. `total += 1` would otherwise be a line this dialect could say
    //    nothing at all about.
    if carries_an_assignment(line) {
        return true;
    }
    // 7. It opens with a call: an identifier or a dotted chain immediately followed by `(`.
    opens_with_call(line)
}

/// Whether `line` opens with a C# keyword at an identifier boundary.
fn starts_with_keyword(line: &str) -> bool {
    STATEMENT_KEYWORDS
        .iter()
        .any(|word| keyword(line, word).is_some())
}

/// Whether `line` carries an assignment operator outside a comparison.
///
/// `==`, `!=`, `<=`, `>=` and `=>` are not assignments; a bare `=` and the compound forms are.
fn carries_an_assignment(line: &str) -> bool {
    for compound in [
        "+=", "-=", "*=", "/=", "%=", "|=", "&=", "^=", "<<=", ">>=", "??=",
    ] {
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
            Some(b'=' | b'!' | b'<' | b'>' | b'+' | b'-' | b'*' | b'/' | b'%' | b'&' | b'|' | b'^')
        ) && !matches!(after, Some(b'=' | b'>'))
    })
}

/// Whether `line` opens with `Name(`, `a.b(` — `Views.OpenText(`, `Console.WriteLine(`.
fn opens_with_call(line: &str) -> bool {
    let mut chars = line.char_indices().peekable();
    let Some((_, first)) = chars.peek().copied() else {
        return false;
    };
    if !is_ident_start(first) {
        return false;
    }
    let mut end = 0;
    while let Some((index, character)) = chars.peek().copied() {
        if is_ident_char(character) {
            end = index + character.len_utf8();
            chars.next();
            continue;
        }
        // A `.` continues the chain only when a further identifier follows it; otherwise the chain
        // ended at the previous character, which is what keeps `Done. Created the file` prose.
        if character == '.' && line[index + 1..].starts_with(is_ident_start) {
            chars.next();
            continue;
        }
        break;
    }
    line[end..].trim_start().starts_with('(')
}

/// Whether `line` is **certainly** prose rather than C# — this dialect's answer to
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
    // 1. No punctuation that only code uses, and no comment opener. `#` is *not* on that list —
    //    see `NON_PROSE_CHARS` — so a Markdown heading reaches clause 5 and is deletable.
    if line.contains(NON_PROSE_CHARS) || line.contains("//") || line.contains("/*") {
        return false;
    }
    // 2. Not a statement, a declaration or a modifier.
    if starts_with_keyword(line) {
        return false;
    }
    // 3. Not a preprocessor directive, which is the half of `#` that is code.
    if opens_a_directive(line) {
        return false;
    }
    // 4. Not a null-conditional access, a null-coalescing operator or a lambda arrow, none of which
    //    English has any use for.
    if line.contains("?.") || line.contains("??") || line.contains("=>") {
        return false;
    }
    // 5. A sentence, or a single terminated word.
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
    for character in token.chars() {
        run = if character.is_alphabetic() {
            run + 1
        } else {
            0
        };
        if run >= 3 {
            return true;
        }
    }
    false
}

/// The rest of `text` when it opens with `word` at an identifier boundary.
fn keyword<'a>(text: &'a str, word: &str) -> Option<&'a str> {
    text.trim_start()
        .strip_prefix(word)
        .filter(|rest| !rest.starts_with(is_ident_char))
}

/// Whether `character` may open a C# identifier.
fn is_ident_start(character: char) -> bool {
    character.is_alphabetic() || character == '_'
}

/// Whether `character` may continue one.
fn is_ident_char(character: char) -> bool {
    character.is_alphanumeric() || character == '_'
}

// ---------------------------------------------------------------------------------------------
// The lexer
// ---------------------------------------------------------------------------------------------

/// Lex `src` into its [code mask](CodeMask) — this dialect's answer to [`Dialect::code_mask`].
///
/// `None` means the source did not lex cleanly, and a caller that needs the mask declines to act on
/// it. That is the correct failure mode for a lexer that has lost its place: the alternative is
/// acting on a reading already known to be wrong. What ends a scan uncleanly is
/// [`Scan::clean`](super::source::Scan)'s business — an unterminated block comment, a literal still
/// open at the end, or a `"…"` or `'…'` still open at a newline.
///
/// An **interpolation hole is code**, and that is the one place this differs from the reading
/// [`source`](super::source) takes of the same scan: over there a hole is kept apart so its braces
/// are not counted as a class body's, and here there is no brace counting and a hole is exactly what
/// it is — an expression, whose text is code as surely as if it had been written outside the string
/// altogether.
pub(super) fn code_mask(src: &str) -> Option<CodeMask> {
    let scanned = scan(src);
    scanned.clean.then(|| {
        CodeMask::from_flags(
            scanned
                .mask
                .into_iter()
                .map(|byte| matches!(byte, Mask::Code | Mask::Hole))
                .collect(),
        )
    })
}

#[cfg(test)]
#[path = "csharp.healing.test.rs"]
mod tests;
