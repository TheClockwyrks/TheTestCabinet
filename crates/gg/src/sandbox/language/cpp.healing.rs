//! **C++'s [healing dialect](crate::healing::Dialect)** — the lexical half of
//! [response healing](crate::healing), answered in C++'s own terms.
//!
//! Four of its answers are worth naming before the code, because each is the same rule reading a
//! grammar no other arm here has.
//!
//! **`#` is both Markdown's heading and C++'s preprocessor, and case is what tells them apart.**
//! Every other arm can keep `#` off its prose test and lose nothing; this one cannot, because
//! `#define MAX 10` and `#include <vector>` are lines a C++ author opens a file with and `# Heading`
//! is the single most common prose line a model writes above a fenced program. So `#` is *not* on
//! [`NON_PROSE_CHARS`] — a heading stays deletable — and a line whose `#` is followed by one of the
//! **fourteen directive words, spelled lower-case**, is read as code by both predicates. A heading
//! reading `# Include the manifest` is capital-I and is prose; `#include` is not. That is the same
//! distinction case-sensitivity already buys every arm's keyword list, reached in a second place.
//!
//! **Nothing is done about an `#include`, and this is the third arm where that is because the line
//! works.** [Rust](super::super::rust::healing) and [Swift](super::super::swift::healing) are the
//! first two. gg's whole surface and the standard library are in front of a program already, put
//! there by a **precompiled** prelude — so a model's `#include <vector>` is a second, redundant read
//! of a header the preamble has seen, which clang de-duplicates against the precompiled header for
//! nothing. A header the prelude does *not* carry is `error: no such file or directory` at the
//! model's own line, which is a better answer than a silent deletion.
//!
//! It is worth saying that this is the *program*'s answer and not the module's. A code module is
//! compiled inside `namespace lib::<key>`, `#include` is textual, and a header pulled into a
//! namespace is a different thing entirely — so a module carrying one is
//! [refused by name](super::source) while a program carrying one is left exactly as written. The
//! asymmetry is real and it is the language's rather than gg's.
//!
//! **The redeclaration proof is the strongest of any registered arm's, and this arm gets it for
//! free.** Every other language's version of it asks whether the repeated tail happens to declare
//! something the compiler refuses twice. A C++ program *must* define `main` — gg
//! [refuses one that does not](super::source::defines_main) — so a reply that is one program pasted
//! after an identical copy of itself always carries two definitions of `main`, which is
//! `redefinition of 'main'` before a statement runs. The reading below is wider than that, because a
//! doubled *fragment* is worth catching too, but the everyday case is decided by the shape of the
//! language.
//!
//! **There is no concurrency wrapper to unwrap**, and the reason is the grammar rather than the
//! library set. A reply's top level is a **translation unit** rather than a statement list, so the
//! shape the strategy looks for — a whole program that is one wrapper and nothing else — does not
//! exist in this language at all. The model's work is inside `main` either way, and a thread it
//! constructed there is a statement among statements rather than something wrapped around
//! everything.
//!
//! What this arm is *not* is one where concurrency cannot be written. `<thread>`, `<future>` and
//! `<atomic>` are off the [prelude](super::compile), and the prelude is what a program is compiled
//! *against* rather than an allowlist — the whole of libc++ is on the include path, so a program
//! that writes `#include <thread>` gets it. Measured against this arm's own flags: it compiles, it
//! links, and `std::thread`'s constructor throws `system_error: thread constructor failed: Not
//! supported` at run time. That is the same position the [Rust](super::super::rust::healing) arm is
//! in — `std::thread::spawn` compiles there too — with a better ending, a recoverable exception
//! carrying a sentence rather than a thread that silently never runs. What differs is only the
//! wrapper: Rust's shape exists and has to be deleted, and this one's never existed.
//!
//! # What its lexer asks that no other arm's does
//!
//! * **A raw string's fence is chosen by its author.** `R"gg(he said "no" \ here)gg"` is one string,
//!   and inside it neither `"` nor `\` means anything. The fence has to be *read* rather than looked
//!   for, and a scan that read that literal as three strings would leave every byte after it masked
//!   wrongly.
//! * **`'` is a digit separator as often as it is a quote.** `1'000'000` is C++14 and a model writes
//!   it. The rule that tells them apart is that a character literal cannot open where a *value* has
//!   just ended, so a `'` immediately behind an alphanumeric is a separator.
//! * **Block comments do not nest.** `/* a /* b */ c */` is one comment ending at the first `*/`,
//!   which is the opposite of [Swift's](super::super::swift::healing) and
//!   [Kotlin's](super::super::kotlin::healing) — reading it their way would leave ` c */` masked and
//!   the code after it lost.
//! * **A `<` is not a delimiter.** `#include <vector>` carries no string at all, and `a < b` is a
//!   comparison; angle brackets are ordinary code here in a way a naive include-aware scan gets
//!   wrong.
//!
//! # One scan, two readings
//!
//! [`scan`] is the only lexer this arm has, and it answers two different questions with one pass.
//! [`code_mask`] gives healing a mask **only when the scan ended cleanly**, because every strategy
//! that consults one is deciding whether to delete text and a reading already known to be wrong is
//! the worst possible basis for that. [`source::code_mask`](super::source::code_mask) takes the same
//! mask whatever happened, because the question *it* answers — does this reply define `main` — is
//! one whose errors are safe in the accepting direction. Two lexers would have been two chances to
//! disagree about what a raw string is.
//!
//! # None of these is a parser
//!
//! Not one predicate here parses, for the reason every other dialect gives: healing runs on text
//! that is not yet known to be a program — it may be Markdown, prose, or two programs pasted
//! together — so a parser would fail on precisely the inputs healing exists to repair. `clang++` is
//! downstream of all of this and is what actually reads the program; every answer here is a lexical
//! shape test with its errors pointed in the safe direction, and every one of them **declines**
//! rather than guessing when it cannot tell.

use crate::healing::{CodeMask, Dialect, Unwrapped, lines_with_offsets};

/// C++'s dialect. A unit struct: everything it "holds" is the `const` data below.
pub(in crate::sandbox::language) struct CppDialect;

/// The one instance, held by [`Cpp`](super::Cpp) and handed out as `&'static dyn Dialect`.
pub(in crate::sandbox::language) static CPP_DIALECT: CppDialect = CppDialect;

impl Dialect for CppDialect {
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

    /// **`false`, always** — the third arm to answer so, and for
    /// [Rust's reason](super::super::rust::healing) rather than for want of a loader.
    ///
    /// A `#include` in a program resolves where it stands and costs nothing: gg's surface and the
    /// standard library are already in front of the model's first line, put there by a precompiled
    /// prelude, so a redundant include is de-duplicated against that header and a header the prelude
    /// does not carry is a located diagnostic naming it. There is nothing to hoist and nothing to
    /// delete.
    fn is_import_statement(&self, _line: &str) -> bool {
        false
    }

    /// Whether the repeated tail **defines** something C++ refuses to see defined twice in one
    /// translation unit — the proof that the reply as sent could not have compiled and therefore ran
    /// nothing.
    ///
    /// The strongest of any registered arm's, and mostly by the shape of the language: see
    /// [`defines_lexically`].
    fn declares_a_redeclarable_binding(&self, text: &str, mask: &CodeMask, base: usize) -> bool {
        defines_lexically(text, mask, base).next().is_some()
    }

    /// **`None`, always.** This arm has no whole-program concurrency wrapper to take off, and the
    /// reason is written out in this module's own documentation: a reply's top level is a
    /// **translation unit** rather than a statement list, so the shape the strategy looks for — a
    /// whole program that is one wrapper and nothing else — cannot be written in this language. The
    /// model's work is inside `main` either way.
    ///
    /// Not because concurrency is unreachable. A program may `#include <thread>` and it will
    /// compile; what it will not do is run a thread. That is a run-time ending this arm reports
    /// rather than a shape healing could remove.
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
/// `text`, `bash` or `cmake` is context the model showed rather than the program, and tier 3 of the
/// candidacy ladder is what keeps the closed list from being a trap.
///
/// Four spellings because models really do write all four, and `c` is deliberately **not** among
/// them: a block a model tagged `c` is C rather than this arm's C++, and it is far more often a
/// snippet of somebody else's source shown as context than it is the reply's own program.
const PROGRAM_TAGS: &[&str] = &["cpp", "c++", "cxx", "cc"];

/// The statement, declaration and specifier keywords a line of C++ code may open with, matched
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
/// **The type names are here and the English words are not.** `int`, `bool`, `char`, `void`,
/// `auto`, `const` and `unsigned` open the majority of the declarations a C++ author writes, and not
/// one of them opens an English sentence. `new`, `delete` and `this` are left out for the opposite
/// reason: each is an ordinary English word a model writes constantly ("delete the file", "this
/// reads the manifest"), and each appears in the middle of the expressions that really use it, where
/// clause 6 and clause 7 already read the line.
const STATEMENT_KEYWORDS: [&str; 48] = [
    "if",
    "else",
    "for",
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
    "throw",
    "auto",
    "const",
    "constexpr",
    "consteval",
    "constinit",
    "static",
    "inline",
    "extern",
    "thread_local",
    "mutable",
    "virtual",
    "explicit",
    "friend",
    "template",
    "typename",
    "concept",
    "requires",
    "namespace",
    "using",
    "typedef",
    "struct",
    "class",
    "union",
    "enum",
    "public",
    "private",
    "protected",
    "operator",
    "void",
    "bool",
    "char",
    "int",
    "unsigned",
];

/// The tokens a line of code may end with — a statement terminated, a block opened or closed, a
/// collection left open, or an expression continued onto the next line.
///
/// The `;` is first, and on this arm it is the strongest single signal there is: C++ terminates
/// every statement with one and English never ends a sentence with one.
const CODE_ENDINGS: [&str; 13] = [
    ";", "{", "}", ",", "(", "[", "->", "&&", "||", "+", "=", ":", "\\",
];

/// Characters no line of English prose contains.
///
/// `#` is **absent**, which is this arm's own call and the one that took the most thought: a
/// Markdown `# Heading` is the most common prose line above a fenced program and must stay
/// deletable, while `#include` and `#define` are lines this language really opens a file with. So
/// the preprocessor is read by [`opens_a_directive`] instead — lower-case, at a word boundary —
/// which catches every directive a program writes and no heading anybody capitalises.
///
/// `<` and `>` are **present**, as they are on every other C-shaped arm, and they carry more here
/// than anywhere: a template argument list, a `#include`'s angle brackets and a comparison all use
/// them, and English does not. What it costs is a line of prose containing one, which is a shape
/// almost nothing a model writes has.
///
/// The backtick is absent for [Rust's reason](super::super::rust::healing): a lead-in written with
/// an inline code span (`` Use `views::open_text` to show yourself a value ``) is the single most
/// common prose line there is, and one that could never be deleted would cost a repair on almost
/// every fenced reply.
const NON_PROSE_CHARS: [char; 15] = [
    ';', '{', '}', '(', ')', '[', ']', '=', '<', '>', '|', '&', '$', '\\', '~',
];

/// The preprocessor directives a line's `#` may introduce, lower-cased.
///
/// A **closed** list, and lower-case is what does the work: `#include` is a directive and
/// `# Include the manifest` is a Markdown heading, and the two are the same bytes but for one
/// letter's case. Being wrong here can only make a heading un-deletable, which costs a repair.
const DIRECTIVES: [&str; 14] = [
    "include", "define", "undef", "if", "ifdef", "ifndef", "elif", "elifdef", "elifndef", "else",
    "endif", "pragma", "error", "line",
];

/// Whether `line`'s own text is a preprocessor directive — `#include <vector>`, `#  define MAX 10`.
///
/// The `#` may be separated from its word by whitespace, which is legal C++ and something a scan
/// looking for the token `#include` would miss.
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

/// Every **definition** `text` makes at its top level, in source order.
///
/// A definition rather than a declaration, and that distinction is C++'s own: `int helper();`
/// written twice is legal, and `int helper() { … }` written twice is *redefinition of 'helper'*
/// before a statement runs — which is exactly the proof
/// [`drop-duplicate-program`](crate::healing::HealingStrategy::DropDuplicateProgram) needs.
///
/// The everyday case is decided by something stronger than any reading here: a C++ program must
/// define `main` or gg refuses it, so a reply that is one program pasted after an identical copy of
/// itself carries two definitions of `main` and could never have run a statement. What the wider
/// reading below buys is the doubled *fragment* — a pair of helper functions, a pasted `struct` —
/// which is the shape a model produces when it drafts twice and sends both.
///
/// "Top level" is read as *unindented*, which is what a namespace-scope definition is in every
/// program a model writes and what keeps this from mistaking a definition inside a class, a
/// namespace or a function body — legal, and legal twice, because it is a different scope — for a
/// redefinition. `base` is where `text` starts inside the source `mask` was built over, so a caller
/// may ask about a slice of it.
fn defines_lexically<'a>(
    text: &'a str,
    mask: &'a CodeMask,
    base: usize,
) -> impl Iterator<Item = &'a str> {
    lines_with_offsets(text).filter_map(move |(offset, line)| {
        if !mask.is_code(base + offset) || line.starts_with([' ', '\t']) {
            return None;
        }
        defines_something(line.trim_end()).then_some(line)
    })
}

/// The keywords that open a line which is **not** a definition of a name, however much it may look
/// like one.
///
/// `namespace` is the one that matters and it is the reason this list exists at all: a namespace may
/// be **reopened** as many times as an author likes, so `namespace helpers {` written twice is
/// ordinary C++ and reading it as a redefinition would let `drop-duplicate-program` delete a tail
/// that would have run. `extern "C" {` is the same shape. The control-flow words are here because a
/// `for (…) {` at an unindented top level is a line inside somebody's function that the *slice* this
/// runs over happened to begin at.
const NOT_A_DEFINITION: [&str; 18] = [
    "namespace",
    "extern",
    "using",
    "typedef",
    "friend",
    "template",
    "concept",
    "requires",
    "static_assert",
    "if",
    "else",
    "for",
    "while",
    "do",
    "switch",
    "try",
    "catch",
    "return",
];

/// Whether `line` **defines** something at namespace scope.
///
/// Three shapes and nothing else, each chosen so that a false positive would take a line that no
/// C++ author writes twice:
///
/// * a tag definition — `struct row {`, `enum class kind {` — which is a `{` on the line that names
///   it, where a forward declaration ends in `;`;
/// * a function definition — a `(` and a `{` on one line that does **not** end in `;`, which is the
///   one shape a declaration cannot have and a call cannot either;
/// * a variable definition with an initialiser — a plain `=` and a `;`.
fn defines_something(line: &str) -> bool {
    let line = line.trim();
    if line.is_empty() || line.starts_with(['#', '}', ')', '/', '*']) {
        return false;
    }
    if NOT_A_DEFINITION
        .iter()
        .any(|word| keyword(line, word).is_some())
    {
        return false;
    }
    for tag in ["struct", "class", "union", "enum"] {
        if keyword(line, tag).is_some() {
            return line.contains('{');
        }
    }
    if line.contains('(') && line.contains('{') && !line.ends_with(';') {
        return true;
    }
    line.ends_with(';') && carries_an_assignment(line)
}

// ---------------------------------------------------------------------------------------------
// The predicates
// ---------------------------------------------------------------------------------------------

/// Whether `line` is **certainly** a line of C++ — this dialect's answer to
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
    // 1. It ends the way a terminated statement, an open block, a closed block or a continued
    //    expression ends. `;` is the strongest of them and is what most lines of C++ end with.
    if CODE_ENDINGS.iter().any(|ending| line.ends_with(ending)) {
        return true;
    }
    // 2. It opens with a statement, declaration or specifier keyword.
    if starts_with_keyword(line) {
        return true;
    }
    // 3. It is a preprocessor directive — lower-cased, which is what tells `#include` from a
    //    Markdown `# Include the manifest`.
    if opens_a_directive(line) {
        return true;
    }
    // 4. It opens with a closer, a comment or an attribute.
    if ["}", ")", "]", "//", "/*", "*/", "[["]
        .iter()
        .any(|prefix| line.starts_with(prefix))
    {
        return true;
    }
    // 5. It carries a scope resolution, a member arrow or a stream insertion anywhere. `::` is in
    //    every qualified name a C++ author writes — `files::read_file`, `std::vector` — and is the
    //    one
    //    piece of punctuation this language uses that English has no version of at all.
    if line.contains("::") || line.contains("->") || line.contains("<<") {
        return true;
    }
    // 6. It assigns to something. `total += 1` would otherwise be a line this dialect could say
    //    nothing at all about.
    if carries_an_assignment(line) {
        return true;
    }
    // 7. It opens with a call: an identifier or qualified chain immediately followed by `(`.
    opens_with_call(line)
}

/// Whether `line` opens with a C++ keyword at an identifier boundary.
fn starts_with_keyword(line: &str) -> bool {
    STATEMENT_KEYWORDS
        .iter()
        .any(|word| keyword(line, word).is_some())
}

/// Whether `line` carries an assignment operator outside a comparison.
///
/// `==`, `!=`, `<=`, `>=` and `=>` are not assignments; a bare `=` and the compound forms are.
fn carries_an_assignment(line: &str) -> bool {
    for compound in ["+=", "-=", "*=", "/=", "%=", "|=", "&=", "^=", "<<=", ">>="] {
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

/// Whether `line` opens with `name(`, `a::b(` or `a.b(` — `views::open_text(`, `entries.size(`.
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
        // A separator continues the chain only when a further identifier follows it; otherwise the
        // chain ended at the previous character, which is what keeps `Done. Created …` prose.
        let separator = match character {
            '.' => Some(1),
            ':' if line[index..].starts_with("::") => Some(2),
            _ => None,
        };
        if let Some(width) = separator
            && line[index + width..].starts_with(is_ident_start)
        {
            for _ in 0..width {
                chars.next();
            }
            continue;
        }
        break;
    }
    line[end..].trim_start().starts_with('(')
}

/// Whether `line` is **certainly** prose rather than C++ — this dialect's answer to
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
    // 1. No punctuation that only code uses, and no comment opener. `#` is *not* on that list —
    //    see `NON_PROSE_CHARS` — so a Markdown heading reaches clause 4 and is deletable.
    if line.contains(NON_PROSE_CHARS) || line.contains("//") || line.contains("/*") {
        return false;
    }
    // 2. Not a statement, a declaration or a specifier.
    if starts_with_keyword(line) {
        return false;
    }
    // 3. Not a preprocessor directive, which is the half of `#` that is code.
    if opens_a_directive(line) {
        return false;
    }
    // 4. Not a qualified name, a member arrow or a stream insertion, none of which English has any
    //    use for.
    if line.contains("::") || line.contains("->") || line.contains("<<") {
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

/// Whether `character` may open a C++ identifier.
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
/// deleting text on the strength of a reading already known to be wrong. Four states end a scan
/// uncleanly — an unterminated block comment, an unterminated raw string, a single-line string or
/// character literal still open at a newline (which C++ forbids), and a backslash with nothing after
/// it.
pub(super) fn code_mask(src: &str) -> Option<CodeMask> {
    let scanned = scan(src);
    scanned.clean.then(|| CodeMask::from_flags(scanned.code))
}

/// What one pass of this arm's lexer found: which bytes are code, and whether it ever lost its
/// place.
pub(super) struct Scan {
    /// Per byte: `true` where the byte is code, `false` where it is inside a string literal, a
    /// character literal, a raw string or a comment.
    pub(super) code: Vec<bool>,
    /// Whether every construct the scan opened was closed. A scan that ended inside something is
    /// still handed back with its best reading, because one of this lexer's two
    /// [readers](super::source::code_mask) wants that and the other wants to decline.
    pub(super) clean: bool,
}

/// Lex `src`, marking the bytes that are code and recording whether the reading holds together.
///
/// The four shapes C++ hides text in, and each is a place a naive scan loses the source:
///
/// * `//` to the end of the line, and `/* … */`, which does **not** nest in C++;
/// * `"…"` and `'…'` with backslash escapes — and `'` is a quote here rather than
///   [Rust's](super::super::rust::healing) lifetime tick, so it is read as one;
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
    let mut clean = true;
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
                    None => {
                        clean = false;
                        bytes.len()
                    }
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
                    clean = false;
                    break;
                };
                let mut fence = Vec::with_capacity(paren - open + 2);
                fence.push(b')');
                fence.extend_from_slice(&bytes[open..paren]);
                fence.push(b'"');
                let end = match find(bytes, paren + 1, &fence) {
                    Some(found) => found + fence.len(),
                    None => {
                        clean = false;
                        bytes.len()
                    }
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
                let mut closed = false;
                while at < bytes.len() {
                    code[at] = false;
                    match bytes[at] {
                        b'\\' => at += 2,
                        byte if byte == quote => {
                            at += 1;
                            closed = true;
                            break;
                        }
                        // A newline ends an unterminated literal rather than swallowing the rest of
                        // the program: a `"` a model left open is a compile error the compiler will
                        // report, and masking everything after it would make one of this lexer's two
                        // readers answer for the whole file. It is still not a clean reading, which
                        // is what makes the other one decline.
                        b'\n' => break,
                        _ => at += 1,
                    }
                }
                if !closed {
                    clean = false;
                }
                if at > bytes.len() {
                    // A trailing backslash walked the cursor past the end. Nothing is left to read
                    // and the reading did not hold together.
                    clean = false;
                    break;
                }
            }
            _ => at += 1,
        }
    }
    Scan { code, clean }
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

#[cfg(test)]
#[path = "cpp.healing.test.rs"]
mod tests;
