//! **C#'s [healing dialect](crate::healing::Dialect)** — the lexical half of
//! [response healing](crate::healing), answered in C#'s own terms.
//!
//! Four of its answers are worth naming before the code, because each is a rule this arm reaches for
//! a reason no other arm's has.
//!
//! **`#` is both Markdown's heading and C#'s preprocessor, and case is the whole of the
//! difference.** This is [C++](super::super::cpp::healing)'s problem in a milder form and it takes
//! the same answer: `#` is *not* on [`NON_PROSE_CHARS`], so a `# Heading` above a fenced program
//! stays deletable, and a line whose `#` is followed by one of thirteen directive words **spelled
//! lower-case** is code to both predicates. `#nullable enable` and `#region parsing` are lines a C#
//! author really writes; `# Nullable reference types` is a heading, and one letter's case is what
//! tells them apart.
//!
//! **Nothing is done about a `using`, and this is the fourth arm where that is because the line
//! works.** [Rust](super::super::rust::healing), [Swift](super::super::swift::healing) and
//! [C++](super::super::cpp::healing) are the first three. gg's whole surface is in front of a
//! program already, put there by a `global using Gg;` the [SDK](super::sdk) declares in its own
//! file — so a model's `using Gg;` is a redundant directive C# accepts in silence, and
//! `using System.Text;` is an ordinary line that resolves where it stands. A namespace the
//! reference set does not carry is `CS0246` at the model's own line, which is a better answer than
//! a silent deletion.
//!
//! As on the C++ arm, that is the *program*'s answer and not the module's. A code module is compiled
//! inside a `static class`, where a `using` is a syntax error, so gg [hoists](super::source) the run
//! of them at the top of a module out of the class body — an asymmetry that is the language's rather
//! than gg's.
//!
//! **The redeclaration proof is the language's own, and it is the everyday case rather than the
//! exotic one.** A C# program's top-level statements are **one scope**: `var total = 0;` written
//! twice is `CS0128`, *a local variable named 'total' is already defined in this scope*, before a
//! statement runs. So a reply that is one program pasted after an identical copy of itself is
//! refused by the compiler as long as the program declared anything at all — which is nearly every
//! program anyone writes. A type declaration is the same proof by a different error (`CS0101`), and
//! `partial` and `namespace`, the two shapes C# really does allow twice, are excluded by name.
//!
//! **There is no concurrency wrapper to unwrap, and here that is a measurement rather than a
//! grammar.** C++'s answer was that the shape cannot be written; C#'s is that it *can* be written
//! and it **works**. Roslyn lowers an `async Task Main` — and a top-level `await` — into a
//! synthesized synchronous entry point that blocks on the result, and that entry point is the one
//! the guest invokes. `csharp_runs_a_program_written_the_async_way_a_model_reaches_for` in
//! `csharp.substrate.test.rs` drives both shapes through the real `csc` and the real prebuilt guest
//! and requires each to run. Unwrapping a wrapper that works would delete a class declaration and
//! re-indent a body to no purpose, so this dialect declines.
//!
//! What that does *not* mean is that concurrency is reachable. `Task.Run` needs a thread pool this
//! guest has no thread to pump, so work a program defers is work that reports success and never
//! runs — the same position [Rust](super::super::rust::healing)'s `std::thread::spawn` is in, and a
//! run-time ending rather than a shape healing could remove. The prompt says so in its own words.
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

use crate::healing::{CodeMask, Dialect, Unwrapped, lines_with_offsets};

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

    /// **`false`, always** — the fourth arm to answer so, and for
    /// [Rust's reason](super::super::rust::healing) rather than for want of a loader.
    ///
    /// A `using` in a program resolves where it stands and costs nothing: gg's surface arrives
    /// through a `global using` the SDK declares, so a model's own `using Gg;` is redundant and
    /// accepted, and a namespace the reference set does not carry is a located `CS0246` naming it.
    /// There is nothing to hoist and nothing to delete.
    fn is_import_statement(&self, _line: &str) -> bool {
        false
    }

    /// Whether the repeated tail **declares** something C# refuses to see declared twice in one
    /// compilation — the proof that the reply as sent could not have compiled and therefore ran
    /// nothing.
    ///
    /// See [`declares_lexically`]: the everyday case is a top-level local, because a C# program's
    /// top-level statements are one scope.
    fn declares_a_redeclarable_binding(&self, text: &str, mask: &CodeMask, base: usize) -> bool {
        declares_lexically(text, mask, base).next().is_some()
    }

    /// **`None`, always.** This arm has no whole-program concurrency wrapper to take off, and the
    /// reason is written out in this module's own documentation: the wrapper a model reaches for
    /// here — `class Program { static async Task Main() { … } }`, or a top-level `await` — is
    /// lowered by Roslyn into a **synchronous** entry point that blocks on the result, and it is
    /// that entry point the guest invokes. It works, so taking it off would delete a declaration
    /// and re-indent a body to no purpose.
    ///
    /// Not because concurrency is useful. A `Task.Run` compiles and queues onto a thread pool
    /// nothing in this guest will pump, which is a run-time ending this arm reports rather than a
    /// shape healing could remove.
    fn unwrap_async(&self, _text: &str, _mask: &CodeMask) -> Option<Unwrapped> {
        None
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
// Redeclaration
// ---------------------------------------------------------------------------------------------

/// Every **declaration** `text` makes at its top level, in source order.
///
/// The proof [`drop-duplicate-program`](crate::healing::HealingStrategy::DropDuplicateProgram)
/// rests on, and on this arm it is the language's own rather than a shape that had to be found. A C#
/// program's top-level statements share **one scope**, so a local declared twice is `CS0128`, *a
/// local variable named 'x' is already defined in this scope* — before a statement runs. A type
/// declared twice is `CS0101` for the same reason. So a reply that is one program pasted after an
/// identical copy of itself could not have compiled as long as the program declared anything, which
/// is nearly every program anyone writes.
///
/// "Top level" is read as *unindented*, which is what a top-level statement is in every program a
/// model writes and what keeps this from mistaking a declaration inside a method, a class or a block
/// — legal, and legal twice, because it is a different scope — for a redeclaration. `base` is where
/// `text` starts inside the source `mask` was built over, so a caller may ask about a slice of it.
fn declares_lexically<'a>(
    text: &'a str,
    mask: &'a CodeMask,
    base: usize,
) -> impl Iterator<Item = &'a str> {
    lines_with_offsets(text).filter_map(move |(offset, line)| {
        if !mask.is_code(base + offset) || line.starts_with([' ', '\t']) {
            return None;
        }
        declares_something(line.trim_end()).then_some(line)
    })
}

/// The keywords that open a line which is **not** a declaration of a name C# refuses twice, however
/// much it may look like one.
///
/// `partial` is the one that matters and it is the reason this list exists at all: a `partial class`
/// may be declared as many times as an author likes, so reading one as a redeclaration would let
/// `drop-duplicate-program` delete a tail that would have run. `namespace` is the same shape — a
/// namespace may be reopened — and so is `using`, which is a directive rather than a declaration and
/// may be written twice. The control-flow words are here because a `for (…) {` at an unindented top
/// level is a line inside somebody's method that the *slice* this runs over happened to begin at.
const NOT_A_DECLARATION: [&str; 20] = [
    "partial",
    "namespace",
    "using",
    "global",
    "if",
    "else",
    "for",
    "foreach",
    "while",
    "do",
    "switch",
    "case",
    "try",
    "catch",
    "finally",
    "return",
    "throw",
    "yield",
    "lock",
    "await",
];

/// The kinds of declaration whose name is the identifier that follows the keyword.
const TYPE_KEYWORDS: [&str; 6] = ["class", "record", "struct", "enum", "interface", "delegate"];

/// Whether `line` **declares** a name in the compilation unit's own scope.
///
/// Two shapes and nothing else, each chosen so that a false positive would take a line no C# author
/// writes twice:
///
/// * a **type** — `record Point(int X, int Y);`, `class Parser {`, `enum Kind {` — which is a type
///   keyword with an identifier after it;
/// * a **local** or a **local function**, which is a type and then a name: `var total = 0;`,
///   `List<string> names = [];`, `string Slug(string text) => …;`.
///
/// **Two whitespace-separated words is the whole of the rule** that tells a declaration from an
/// assignment, and it is what the everyday false positives fail. `total = 0;` re-binds nothing;
/// `rows[0] = "a";`, `counts["word"] = 1;` and `entry.Kind = …;` assign into something that already
/// exists — every one of them is a single word before the `=`, where a declaration always has the
/// thing's type in front of its name. The last of those words must be a plain **identifier**, which
/// is what keeps `rows[0]` from reading as `rows` and `0`.
fn declares_something(line: &str) -> bool {
    let line = line.trim();
    if line.is_empty() || line.starts_with(['#', '}', ')', ']', '/', '*', '[', '@']) {
        return false;
    }
    if NOT_A_DECLARATION
        .iter()
        .any(|word| keyword(line, word).is_some())
    {
        return false;
    }
    let head = without_generics(match line.find(['=', '(', '{', ';']) {
        Some(cut) => &line[..cut],
        None => line,
    });
    let mut words = head.split_whitespace().peekable();
    // `partial` anywhere in front of a type is the one modifier that makes a declaration legal
    // twice, so it is read out of the whole head rather than only off its first word.
    if head.split_whitespace().any(|word| word == "partial") {
        return false;
    }
    while let Some(word) = words.peek() {
        if !MODIFIERS.contains(word) {
            break;
        }
        words.next();
    }
    let rest: Vec<&str> = words.collect();
    let Some(first) = rest.first() else {
        return false;
    };
    if TYPE_KEYWORDS.contains(first) {
        // `record class Point` names the identifier after the second word.
        let named = match rest.get(1) {
            Some(second) if TYPE_KEYWORDS.contains(second) => rest.get(2),
            other => other,
        };
        return named.is_some_and(|name| is_identifier(name));
    }
    // A local or a local function: its type, then its name. One word alone is an assignment target,
    // a call or an expression statement rather than a binding.
    rest.len() >= 2 && is_identifier(rest[rest.len() - 1])
}

/// Whether `word` is a bare C# identifier — no brackets, no dots, no digits leading.
fn is_identifier(word: &str) -> bool {
    let mut characters = word.chars();
    characters.next().is_some_and(is_ident_start) && characters.all(is_ident_char)
}

/// Modifiers a declaration may carry before the thing that names it — read past rather than counted
/// as the type or the name.
const MODIFIERS: &[&str] = &[
    "public",
    "private",
    "protected",
    "internal",
    "static",
    "readonly",
    "const",
    "sealed",
    "abstract",
    "virtual",
    "override",
    "new",
    "unsafe",
    "extern",
    "required",
    "volatile",
    "ref",
    "scoped",
    "file",
];

/// `line` with every `<…>` cut out, so the identifiers left are the declaration's own —
/// `List<string> names` is two words rather than three.
fn without_generics(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut depth = 0usize;
    for character in line.chars() {
        match character {
            '<' => depth += 1,
            '>' => depth = depth.saturating_sub(1),
            _ if depth == 0 => out.push(character),
            _ => {}
        }
    }
    out
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
/// `None` means the source did not lex cleanly, and every strategy that needs the mask declines on
/// it. That is the correct failure mode for a lexer that has lost its place: the alternative is
/// deleting text on the strength of a reading already known to be wrong. What ends a scan uncleanly
/// is [`Scan::clean`](super::source::Scan)'s business — an unterminated block comment, a literal
/// still open at the end, or a `"…"` or `'…'` still open at a newline.
///
/// An **interpolation hole is code**, and that is the one place this differs from the reading
/// [`source`](super::source) takes of the same scan: over there a hole is kept apart so its braces
/// are not counted as a class body's, and here there is no brace counting and a hole is exactly what
/// it is — an expression, whose `using` or whose declaration is as real as one written outside a
/// string.
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
