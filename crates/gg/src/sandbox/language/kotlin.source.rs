//! **What gg puts around a model's Kotlin before the compiler sees it: nothing.**
//!
//! A program on this arm is a whole Kotlin file — the `import` lines the model wrote and the
//! `fun main()` it declared. gg writes no prologue, no epilogue, no entry point and no import into
//! that file, so the compiler reads the bytes the model sent and every diagnostic, every stack frame
//! and every location is already in the model's own coordinates. There is nothing here to subtract.
//!
//! # The script is retired, and why that is the whole of the change
//!
//! A program used to be compiled as a Kotlin **script** (`Program.kts`), and the reason was real: the
//! shape it was compared against wrapped a model's reply in the body of a function gg declared, which
//! puts every declaration the model wrote in a *local* position — and Kotlin refuses five things
//! there that a Kotlin author writes without thinking (`object`, `interface`, `enum class`,
//! `typealias`, `private fun`). A script accepted all five.
//!
//! Under whole programs the wrapper is gone, so the local position is gone with it. A model writes an
//! ordinary `.kt` file, every one of those five is a top-level declaration, and the scripting plugin,
//! its four unversioned jars, the `kotlin-home` directory they were loaded through and the
//! `-Xallow-any-scripts-in-source-roots` flag all go with the problem they solved.
//!
//! # The one convention, and what enforces it
//!
//! The file is [`PROGRAM_FILE`](super::compile::PROGRAM_FILE) and the class gg's generated entry
//! class calls is [`PROGRAM_CLASS`] — the **file facade** the Kotlin compiler emits a file's
//! top-level declarations into, named for the file. So a program declares `fun main()` and nothing
//! else is asked of it, and the two ways of getting it wrong are both located diagnostics rather than
//! gg's opinion:
//!
//! * a `fun main(args: Array<String>)` compiles to `main(String[])` and no `main()`, so gg's entry
//!   class cannot resolve the call — measured: the no-argument form emits **both** methods and the
//!   argument form emits only one, and the `main(String[])` beside a `fun main()` is marked
//!   synthetic, which javac ignores;
//! * a file declaring no `main` at all, or renaming its facade with `@file:JvmName`, leaves the same
//!   call unresolved.
//!
//! Both are javac's own diagnostic about gg's own file, which [`compile`](super::compile) turns into
//! a refusal that quotes the convention back — a shape refusal shown to the model rather than
//! reported as a toolchain failure.
//!
//! # What is left in this file
//!
//! The names a compile is written under, the **code module** wrapper, and the export scan.
//!
//! A code module is
//! [outside the authorship rule](https://docs.testcabinet.ai/gg/responses-as-code/invariants/): its
//! author writes an ordinary Kotlin file whose public top-level functions are the namespace
//! `lib.<key>` binds. [`wrap_module`] is what puts that file in a package of its own, and it adds
//! **no line at all** — the `package` declaration shares the author's own first line, so the module's
//! line *n* is line *n* of the file and no diagnostic is moved by anything.
//!
//! What that package is *reached* by is nowhere in this file, because it is nothing gg writes: the
//! module is compiled on its own and its classes are handed to the program's compile as a
//! **classpath entry**, which is how this arm's own SDK jar reaches a program. The program writes
//! `lib.csvTools.slugify(…)` or its own `import lib.csvTools.*`, and gg writes neither.
//!
//! # Why a lexer rather than a regular expression
//!
//! Because the input is untrusted text a model wrote, and `fun ` at the start of a line inside a raw
//! string is not a declaration. [`Lexer`] is the smallest thing that can tell code from a string, a
//! character literal, a comment, a raw string and a backquoted identifier.
//!
//! Kotlin needs three things [Java's](super::super::java::source) reading of the same question does
//! not:
//!
//! * **string templates**. `"total: ${rows["n"]}"` is one string, and a scan that stopped at the
//!   quote before `n` would read the rest of the line as code — so a `${…}` is followed through with
//!   a brace counter, nested strings and all.
//! * **nested block comments**. `/* a /* b */ c */` is one comment in Kotlin and two in Java, and
//!   reading it Java's way leaves ` c */` as code.
//! * **backquoted identifiers**. `` fun `a name with spaces`() `` is legal, so the bytes between
//!   backticks are skipped like a string: they can hold a brace or the word `fun` and mean neither.
//!
//! Everything it does is a **byte** comparison rather than a slice of the source, and that is not a
//! style: the scan walks one byte at a time, so `&source[at..]` panics on any index that is not a
//! character boundary. A single `é` in a string, a comment or an identifier would have taken the
//! turn down with a slice index error rather than reaching the compiler. Every delimiter it looks
//! for is ASCII, and an ASCII byte never appears inside a multi-byte UTF-8 sequence, so byte
//! comparisons find exactly what string comparisons would.

use super::super::{ModuleExport, ModuleExportKind, PrepareError, PrepareFailure};

/// The class a **program** compiles to: the file facade the Kotlin compiler emits `Program.kt`'s
/// top-level declarations into, which is the file's name with `Kt` on the end.
///
/// It is the one name gg's generated entry class has to write, and the only thing this arm asks of a
/// model beyond "write Kotlin".
pub(super) const PROGRAM_CLASS: &str = "ProgramKt";

/// The package one code module's file is compiled into, given its binding key — which is what makes
/// a program reach it at `lib.<key>.<name>` and import it at `import lib.<key>.*`.
///
/// A package rather than a wrapping object or a generated accessor, because a Kotlin file's public
/// top-level functions already *are* a namespace and a package is what names one. A package is also
/// what a **classpath entry** can carry: the module is compiled on its own into a directory of class
/// files, and that directory is handed to the program's compile the way this arm's SDK jar is, which
/// is the one mechanism gg has for making a library available without putting a name in scope.
pub(super) fn module_package(key: &str) -> String {
    format!("lib.{key}")
}

/// The file one code module is compiled from, named for the key it is bound at.
///
/// The name is what every diagnostic about the module carries in its file position, so the one
/// coordinate a model has for code it did not write names the module to fix or to stop loading.
pub(super) fn module_file(key: &str) -> String {
    format!("{key}.kt")
}

/// A code module's file, put in a package of its own, and the names its namespace offers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Wrapped {
    /// The whole `.kt` file.
    pub source: String,
    /// What the module's namespace offers, in source order.
    pub exports: Vec<ModuleExport>,
}

/// Put a code [skill](crate::skills)'s or [memory](crate::memories)'s **module** — an ordinary Kotlin
/// file — into `package`, and say what its namespace will offer.
///
/// Its public top-level functions become the namespace and everything else is the module's own
/// business, which is the visibility rule a Kotlin author already writes.
///
/// **Nothing gg writes here takes a line.** The `package` declaration goes on the front of the
/// author's own first line, terminated with the semicolon Kotlin allows so that an author whose first
/// line is an `import` still parses, so the file has exactly as many lines as the module did and
/// every one of them is where its author put it. There is no offset for any diagnostic to be moved
/// back by, which is what
/// [rule D11](https://docs.testcabinet.ai/gg/responses-as-code/invariants/) asks of a location.
///
/// A `package` the author wrote is refused rather than moved: gg names the one this file goes in, and
/// two would not parse.
pub(super) fn wrap_module(source: &str, package: &str) -> Result<Wrapped, PrepareFailure> {
    refuse_package(source)?;
    let exports = exports(source);
    if exports.is_empty() {
        return Err(PrepareFailure::Program(PrepareError::Unsupported(
            "this module offers nothing: gg binds a code module's public top-level functions at \
             `lib.<key>`, and there are none. Declare at least one, as \
             `fun greet(who: String): String = \"hello \" + who`."
                .to_string(),
        )));
    }
    Ok(Wrapped {
        source: format!("package {package}; {source}"),
        exports,
    })
}

/// Refuse a `package` a module's author wrote, naming it.
///
/// gg puts the module in a package of its own so that a program reaches it at `lib.<key>`, and a
/// second `package` line is not a thing a Kotlin file may have. Refusing it by name is what stops an
/// author wondering why their own names did not resolve.
fn refuse_package(source: &str) -> Result<(), PrepareFailure> {
    let code = Lexer::new(source).code_mask();
    let mut at = 0usize;
    for (number, line) in source.split_inclusive('\n').enumerate() {
        let start = at;
        at += line.len();
        let trimmed = line.trim();
        let offset = line.len() - line.trim_start().len();
        if !code.get(start + offset).copied().unwrap_or(false) {
            continue;
        }
        if let Some(rest) = keyword(trimmed, "package") {
            return Err(PrepareFailure::Program(PrepareError::Unsupported(format!(
                "line {}: gg compiles a code module into a package of its own so that a program \
                 reaches it at `lib.<key>`, so `package {}` has nowhere to go. Remove it; every \
                 name you declare is already visible to the rest of the module.",
                number + 1,
                rest.trim().trim_end_matches(';').trim(),
            ))));
        }
    }
    Ok(())
}

/// Refuse a **program** that moves its own file facade, naming what moved it.
///
/// gg reaches a program by calling [`PROGRAM_CLASS`]`.main()`, which is the facade the Kotlin
/// compiler emits `Program.kt`'s top-level declarations into. Two legal Kotlin lines move that
/// facade somewhere the call cannot resolve: a `package` declaration puts it in that package, and a
/// `@file:JvmName` renames it. Both then fail inside gg's own generated entry class, where javac's
/// only complaint is that it cannot resolve `ProgramKt` — which reads as "you did not declare
/// `fun main()`" to a model that plainly did.
///
/// Nothing is rewritten and nothing is moved: the refusal names the line and the model writes the
/// file again. What is left to javac is the shape it can actually diagnose, a missing `main` or one
/// that takes parameters.
pub(super) fn refuse_moved_facade(source: &str) -> Result<(), PrepareFailure> {
    let code = Lexer::new(source).code_mask();
    let mut at = 0usize;
    for (number, line) in source.split_inclusive('\n').enumerate() {
        let start = at;
        at += line.len();
        let trimmed = line.trim();
        let offset = line.len() - line.trim_start().len();
        if !code.get(start + offset).copied().unwrap_or(false) {
            continue;
        }
        let moved = match keyword(trimmed, "package") {
            Some(rest) => format!("`package {}`", rest.trim().trim_end_matches(';').trim()),
            None if trimmed.starts_with("@file:JvmName") => "`@file:JvmName`".to_string(),
            None => continue,
        };
        return Err(PrepareFailure::Program(PrepareError::Unsupported(format!(
            "line {}: {moved} moves the program out of the root package, and gg's entry call \
             `{PROGRAM_CLASS}.main()` resolves only there. Write the reply as one Kotlin file in \
             the root package.",
            number + 1,
        ))));
    }
    Ok(())
}

/// The rest of `line` when it opens with `word` followed by whitespace — `None` otherwise, so
/// `packages()` is not read as a `package`.
fn keyword<'a>(line: &'a str, word: &str) -> Option<&'a str> {
    line.strip_prefix(word)
        .filter(|rest| rest.starts_with(char::is_whitespace))
}

// ---------------------------------------------------------------------------------------------
// The export scan
// ---------------------------------------------------------------------------------------------

/// Kotlin's visibility modifiers that keep a declaration out of a module's namespace.
///
/// `protected` is not among them because it is not applicable to a top-level declaration at all —
/// the compiler refuses it, which is a located error the author reads rather than a name gg quietly
/// dropped.
const HIDDEN: [&str; 2] = ["private", "internal"];

/// Every modifier that may stand between the start of a declaration and its `fun`.
///
/// A closed list on purpose: the scan walks backwards from `fun` and stops at the first word that is
/// not one of these, so an unknown word ends the run rather than being read as part of it. Being
/// wrong here can only mean gg *fails to see* a `private` — and that direction is a name reported to
/// an author that a program then cannot reach, rather than a name silently missing.
const MODIFIERS: [&str; 12] = [
    "public",
    "private",
    "internal",
    "protected",
    "inline",
    "suspend",
    "external",
    "tailrec",
    "operator",
    "infix",
    "expect",
    "actual",
];

/// The names a module's file offers: every public top-level function of it, in source order.
///
/// A **reading** rather than a rewriting: nothing is inserted, because a program reaches an export
/// by naming it. What this produces is the list the module's author is *told* the namespace holds.
///
/// The type names each declaration writes are read off the same span, in return position and in
/// parameter position, which is what an agent's `docViewTypes` flags open beside the function.
fn exports(source: &str) -> Vec<ModuleExport> {
    let lines: Vec<&str> = source.lines().collect();
    Lexer::new(source)
        .top_level_functions()
        .into_iter()
        .filter(|function| !function.hidden)
        .map(|function| {
            let declaration = source[function.start..function.end].trim();
            let signature = Signature::read(
                declaration,
                function.parameters.saturating_sub(function.start),
            );
            ModuleExport {
                name: function.name,
                // Only a `fun` reaches here: a top-level property or class of the author's own is
                // not what this arm binds, so there is no other kind to report.
                kind: ModuleExportKind::Function,
                declaration: declaration.to_string(),
                doc: {
                    // The line its first modifier stands on — and above it, past any annotation
                    // written on a line of its own, whatever prose its author wrote.
                    let line = source[..function.start].matches('\n').count();
                    let above =
                        super::super::comments::above(&lines, line, |line| line.starts_with('@'));
                    super::super::comments::block_doc(&lines, above)
                        .or_else(|| super::super::comments::line_doc(&lines, above, &["///", "//"]))
                },
                returns: signature.returns,
                parameters: signature.parameters,
            }
        })
        .collect()
}

// ---------------------------------------------------------------------------------------------
// The types a declaration writes
// ---------------------------------------------------------------------------------------------

/// The type names one `fun` declaration writes, in the two positions a documentation view asks
/// about.
///
/// Kotlin writes a type after a `:` in both positions, so this arm answers both. What is recorded is
/// what the author *wrote*, reduced to identifiers: `Map<String, List<Row>>` is `Map`, `String`,
/// `List` and `Row`, because each is a name a view can be opened under.
///
/// A `fun` that declares no return type returns `Unit`, and nothing is recorded for it: the type a
/// view would open is one the author did not write, and this reads a declaration rather than
/// inferring one.
#[derive(Debug, Default, PartialEq, Eq)]
struct Signature {
    /// The names written in return position.
    returns: Vec<String>,
    /// The names written in parameter position, in source order.
    parameters: Vec<String>,
}

impl Signature {
    /// Read `declaration`, whose parameter list opens at `open`.
    ///
    /// Both halves are found from that one offset rather than by searching for a `(`, because the
    /// scan that produced the declaration already knows where the list opens and a second reading
    /// could disagree with the first — an extension receiver and a default value both write
    /// parentheses of their own.
    fn read(declaration: &str, open: usize) -> Self {
        if declaration.as_bytes().get(open) != Some(&b'(') {
            return Self::default();
        }
        let close = enclosed(declaration, open);
        // `get` rather than an index: a declaration whose parameter list never closes is a module
        // the compiler is about to refuse, and reading it must not take the turn down before it can.
        let list = declaration.get(open + 1..close).unwrap_or_default();
        let mut signature = Self {
            returns: named(returned(declaration, close)),
            parameters: Vec::new(),
        };
        for parameter in split_top_level(list) {
            for name in named(declared_type(parameter)) {
                if !signature.parameters.contains(&name) {
                    signature.parameters.push(name);
                }
            }
        }
        signature
    }
}

/// The return type of a declaration, given where its parameter list closed.
///
/// A `:` after the `)` opens it and it runs to the end of the declaration, which the scan already
/// ended at the `{` or the `=` that opens the body. A declaration with no `:` there returns `Unit`
/// and writes nothing, so nothing is read.
fn returned(declaration: &str, close: usize) -> &str {
    let after = declaration
        .get(close + 1..)
        .unwrap_or_default()
        .trim_start();
    match after.strip_prefix(':') {
        // A `where` clause bounds a type parameter and is not the return type, so the type stops
        // where one begins.
        Some(returned) => match returned.find(" where ") {
            Some(at) => returned[..at].trim(),
            None => returned.trim(),
        },
        None => "",
    }
}

/// One parameter's declared type: everything after the `:` that binds its name.
///
/// A default value is dropped with it, because `rows: List<Row> = emptyList()` writes a type and an
/// expression and only the type is a name a view opens. A `vararg` or an annotation in front of the
/// name is dropped by taking what follows the `:` at all.
fn declared_type(parameter: &str) -> &str {
    let Some(at) = top_level(parameter, ':') else {
        return "";
    };
    let written = &parameter[at + 1..];
    match top_level(written, '=') {
        Some(default) => written[..default].trim(),
        None => written.trim(),
    }
}

/// The offset of the first `wanted` character written at the top level of `text` — outside any
/// `<>`, `()` or `[]` run.
fn top_level(text: &str, wanted: char) -> Option<usize> {
    let mut depth = 0i32;
    for (at, character) in text.char_indices() {
        if depth == 0 && character == wanted {
            return Some(at);
        }
        match character {
            '<' | '(' | '[' => depth += 1,
            '>' | ')' | ']' => depth -= 1,
            _ => {}
        }
    }
    None
}

/// `text` split at the commas written at its top level, dropping whatever is only whitespace.
fn split_top_level(text: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut depth = 0i32;
    let mut start = 0usize;
    for (at, character) in text.char_indices() {
        match character {
            '<' | '(' | '[' => depth += 1,
            '>' | ')' | ']' => depth -= 1,
            ',' if depth == 0 => {
                parts.push(&text[start..at]);
                start = at + 1;
            }
            _ => {}
        }
    }
    parts.push(&text[start..]);
    parts
        .into_iter()
        .filter(|part| !part.trim().is_empty())
        .collect()
}

/// The identifiers a type expression names, each reduced to the last segment of its qualified name
/// and listed once.
///
/// `kotlin.collections.Map<String, List<Row>?>` is `Map`, `String`, `List` and `Row`. A type
/// variable is kept, because it is a name the declaration writes and resolving one is the
/// documentation surface's business rather than this scan's.
fn named(written: &str) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    for word in written.split(|character: char| !is_type_char(character)) {
        // The last segment that is a name at all, so `kotlin.collections.Map` is `Map`.
        let Some(name) = word.split('.').rfind(|part| !part.is_empty()) else {
            continue;
        };
        if name.starts_with(|character: char| character.is_ascii_digit()) {
            continue;
        }
        if !names.iter().any(|seen| seen == name) {
            names.push(name.to_string());
        }
    }
    names
}

/// Whether a character may stand in a written type name — an identifier's own characters and the
/// `.` that qualifies one.
fn is_type_char(character: char) -> bool {
    character.is_alphanumeric() || character == '_' || character == '.'
}

/// Where the parameter list opening at `open` in `declaration` closes, as the offset of its `)`.
///
/// Nesting is counted, so a default value's own parentheses do not close it early. An unbalanced
/// list closes at the end of the declaration, which the compiler is about to refuse anyway.
fn enclosed(declaration: &str, open: usize) -> usize {
    let mut depth = 0i32;
    for (at, character) in declaration[open..].char_indices() {
        match character {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    return open + at;
                }
            }
            _ => {}
        }
    }
    declaration.len()
}

/// One top-level function declaration.
#[derive(Debug, PartialEq, Eq)]
struct Function {
    /// The name it declares — the last identifier before its parameter list, so an extension
    /// function is known by its own name rather than by its receiver's.
    name: String,
    /// Whether a visibility modifier keeps it out of the namespace.
    hidden: bool,
    /// Where it begins: the first byte of its modifier run, or of `fun` where it carries none.
    start: usize,
    /// Where its signature ends — at the `{` or the `=` that opens its body, or at the end of the
    /// line when it has neither. `source[start..end]` is the declaration and nothing else.
    end: usize,
    /// Where its parameter list opens, so the [signature reading](Signature::read) can tell the
    /// parameters behind that `(` from the return type after the matching `)` without searching for
    /// either.
    parameters: usize,
}

// ---------------------------------------------------------------------------------------------
// The lexer
// ---------------------------------------------------------------------------------------------

/// The smallest reading of Kotlin that can tell **code** from everything that merely looks like it.
///
/// It answers two questions and no others: which bytes are code (so a line that opens with `package`
/// inside a raw string is not a package declaration), and which top-level functions a file declares
/// (so a module's namespace can be reported). It is not a parser and does not try to be — the Kotlin
/// compiler is downstream of it and is what actually reads the module.
struct Lexer<'a> {
    /// The source.
    source: &'a str,
    /// Its bytes.
    bytes: &'a [u8],
}

impl<'a> Lexer<'a> {
    /// Read `source`.
    fn new(source: &'a str) -> Self {
        Self {
            source,
            bytes: source.as_bytes(),
        }
    }

    /// One `bool` per byte: `true` where the byte is code rather than a string, a character literal,
    /// a raw string, a comment or a backquoted identifier.
    fn code_mask(&self) -> Vec<bool> {
        let mut mask = vec![true; self.bytes.len()];
        for (start, end) in self.spans() {
            for byte in mask.iter_mut().take(end).skip(start) {
                *byte = false;
            }
        }
        mask
    }

    /// Every top-level `fun` declaration, in source order.
    fn top_level_functions(&self) -> Vec<Function> {
        let spans = self.spans();
        let mut found = Vec::new();
        let mut depth = 0usize;
        let mut at = 0usize;
        // The spans arrive in order and this scan only ever moves forward, so the next one to
        // consider is the next one in the list. A search per byte would be quadratic in the size of
        // a module, and a code skill is a file an author wrote rather than a line.
        let mut span = 0usize;
        while at < self.bytes.len() {
            while span < spans.len() && spans[span].1 <= at {
                span += 1;
            }
            if let Some((start, end)) = spans.get(span)
                && at >= *start
            {
                at = *end;
                continue;
            }
            match self.bytes[at] {
                b'{' => {
                    depth += 1;
                    at += 1;
                }
                b'}' => {
                    depth = depth.saturating_sub(1);
                    at += 1;
                }
                byte if is_identifier_start(byte) => {
                    let end = self.identifier_end(at);
                    if depth == 0
                        && &self.source[at..end] == "fun"
                        && let Some(function) = self.function_at(at, end, &spans)
                    {
                        found.push(function);
                    }
                    at = end;
                }
                _ => at += 1,
            }
        }
        found
    }

    /// The declaration whose `fun` keyword runs from `at` to `end`, when it declares a named
    /// function.
    fn function_at(&self, at: usize, end: usize, spans: &[(usize, usize)]) -> Option<Function> {
        let (name, parameters) = self.declared_name(end, spans)?;
        let (modifiers, start) = self.modifiers_before(at);
        Some(Function {
            name,
            hidden: modifiers
                .iter()
                .any(|word| HIDDEN.iter().any(|hidden| word == hidden)),
            start,
            end: self.signature_end(parameters, spans),
            parameters,
        })
    }

    /// Where the signature whose parameter list opens at `parameters` ends: past its own `)`, then
    /// at the `{` or the `=` that opens the body — or at the end of the line, for a declaration
    /// whose body is written on the next one.
    ///
    /// The parameter list is walked by counting its own brackets, so a default value's parentheses
    /// do not close it early, and the spans are stepped over so a `)` inside a string is not one.
    fn signature_end(&self, parameters: usize, spans: &[(usize, usize)]) -> usize {
        let mut at = parameters;
        let mut depth = 0usize;
        let mut closed = false;
        while at < self.bytes.len() {
            if let Some((_, end)) = spans.iter().find(|(start, end)| at >= *start && at < *end) {
                at = *end;
                continue;
            }
            match self.bytes[at] {
                b'(' if !closed => depth += 1,
                b')' if !closed => {
                    depth = depth.saturating_sub(1);
                    closed = depth == 0;
                }
                b'{' | b'=' | b'\n' if closed => return at,
                _ => {}
            }
            at += 1;
        }
        self.bytes.len()
    }

    /// The name declared after a `fun` keyword: the last identifier before the parameter list.
    ///
    /// `None` when the next thing of substance is `interface` (a `fun interface` is a type), or when
    /// the parameter list opens with no name in front of it (an anonymous function), or when no
    /// parameter list arrives at all — each of which is something other than a function this
    /// namespace could offer.
    fn declared_name(&self, from: usize, spans: &[(usize, usize)]) -> Option<(String, usize)> {
        let mut at = from;
        let mut last: Option<String> = None;
        let mut angles = 0usize;
        let mut span = 0usize;
        while at < self.bytes.len() {
            while span < spans.len() && spans[span].1 <= at {
                span += 1;
            }
            // A backquoted name is a span, and it is also the declaration's own name.
            if let Some((start, end)) = spans.get(span)
                && at >= *start
            {
                if self.bytes[*start] == b'`' && angles == 0 {
                    last = Some(self.source[*start + 1..end.saturating_sub(1)].to_string());
                }
                at = *end;
                continue;
            }
            match self.bytes[at] {
                b'(' => return last.map(|name| (name, at)),
                // A type parameter list stands between `fun` and the name, and the identifiers in
                // it are types rather than the declaration's own name.
                b'<' => angles += 1,
                b'>' => angles = angles.saturating_sub(1),
                b'{' | b'}' | b'=' | b';' => return None,
                byte if is_identifier_start(byte) => {
                    let end = self.identifier_end(at);
                    let word = &self.source[at..end];
                    if word == "interface" {
                        return None;
                    }
                    if angles == 0 {
                        last = Some(word.to_string());
                    }
                    at = end;
                    continue;
                }
                _ => {}
            }
            at += 1;
        }
        None
    }

    /// The run of modifier words immediately before `at`, and where that run begins — which is `at`
    /// itself for a declaration that carries none.
    ///
    /// Walks backwards over whitespace and words, stopping at the first thing that is not a
    /// [modifier](MODIFIERS) — a `)`, a `}`, an unknown word — so a `private` belonging to the
    /// *previous* declaration is never read as this one's.
    fn modifiers_before(&self, at: usize) -> (Vec<String>, usize) {
        let mut words = Vec::new();
        let mut scan = at;
        let mut start = at;
        loop {
            while scan > 0 && self.bytes[scan - 1].is_ascii_whitespace() {
                scan -= 1;
            }
            let end = scan;
            while scan > 0 && is_identifier_byte(self.bytes[scan - 1]) {
                scan -= 1;
            }
            if scan == end {
                return (words, start);
            }
            let word = &self.source[scan..end];
            if !MODIFIERS.contains(&word) {
                return (words, start);
            }
            words.push(word.to_string());
            start = scan;
        }
    }

    /// Where the identifier starting at `at` ends.
    fn identifier_end(&self, at: usize) -> usize {
        let mut end = at;
        while end < self.bytes.len() && is_identifier_byte(self.bytes[end]) {
            end += 1;
        }
        end
    }

    /// Every run of bytes that is **not** code, in order, as `[start, end)`.
    ///
    /// # Why this compares bytes rather than slicing the source
    ///
    /// Because `at` walks one **byte** at a time and a model's Kotlin is not ASCII. `&source[at..]`
    /// panics unless `at` falls on a character boundary, so a single `é` — in a string, in a
    /// comment, in an identifier, anywhere — would take the whole turn down with a slice index error
    /// rather than reaching the compiler. Every delimiter this looks for is ASCII, and an ASCII byte
    /// never appears inside a multi-byte UTF-8 sequence, so a byte comparison finds exactly what a
    /// string comparison would and cannot panic on the way.
    fn spans(&self) -> Vec<(usize, usize)> {
        let mut spans = Vec::new();
        let mut at = 0usize;
        while at < self.bytes.len() {
            if let Some(end) = self.span_at(at) {
                spans.push((at, end));
                at = end;
                continue;
            }
            at += 1;
        }
        spans
    }

    /// The end of the non-code run starting at `at`, when one starts there.
    fn span_at(&self, at: usize) -> Option<usize> {
        if self.matches(at, b"//") {
            return Some(self.find(at, b"\n").unwrap_or(self.bytes.len()));
        }
        if self.matches(at, b"/*") {
            return Some(self.comment_end(at));
        }
        // A raw string first: `"""` also starts with `"`, and reading it as an empty string followed
        // by one would put its whole body back in the code.
        if self.matches(at, b"\"\"\"") {
            return Some(self.string_end(at + 3, b"\"\"\"", true));
        }
        if self.matches(at, b"\"") {
            return Some(self.string_end(at + 1, b"\"", false));
        }
        if self.matches(at, b"'") {
            return Some(self.string_end(at + 1, b"'", false));
        }
        if self.matches(at, b"`") {
            return Some(self.string_end(at + 1, b"`", true));
        }
        None
    }

    /// The end of a block comment, counting **nested** openers: `/* a /* b */ c */` is one comment
    /// in Kotlin, and reading it as Java would leave ` c */` behind as code.
    fn comment_end(&self, at: usize) -> usize {
        let mut depth = 0usize;
        let mut scan = at;
        while scan < self.bytes.len() {
            if self.matches(scan, b"/*") {
                depth += 1;
                scan += 2;
                continue;
            }
            if self.matches(scan, b"*/") {
                depth -= 1;
                scan += 2;
                if depth == 0 {
                    return scan;
                }
                continue;
            }
            scan += 1;
        }
        self.bytes.len()
    }

    /// The end of a quoted run that began at `at`, past its closing `close`.
    ///
    /// `raw` says whether a `\` is an escape (it is not, in a raw string or a backquoted name). A
    /// `${` opens a **template**, whose contents are Kotlin — including, quite legally, more strings
    /// — and which is followed through with a brace counter so that `"total: ${rows["n"]}"` is one
    /// string rather than two with a stray `]}` between them.
    fn string_end(&self, at: usize, close: &[u8], raw: bool) -> usize {
        let mut scan = at;
        while scan < self.bytes.len() {
            if !raw && self.bytes[scan] == b'\\' {
                scan += 2;
                continue;
            }
            if self.matches(scan, close) {
                return scan + close.len();
            }
            if close != b"`" && self.matches(scan, b"${") {
                scan = self.template_end(scan + 2);
                continue;
            }
            scan += 1;
        }
        self.bytes.len()
    }

    /// The end of a `${…}` template that began at `at`, past its closing brace.
    fn template_end(&self, at: usize) -> usize {
        let mut depth = 1usize;
        let mut scan = at;
        while scan < self.bytes.len() {
            // A string inside a template is skipped whole, which is what stops its quotes from
            // being read as the enclosing string's.
            if let Some(end) = self.span_at(scan) {
                scan = end;
                continue;
            }
            match self.bytes[scan] {
                b'{' => depth += 1,
                b'}' => {
                    depth -= 1;
                    if depth == 0 {
                        return scan + 1;
                    }
                }
                _ => {}
            }
            scan += 1;
        }
        self.bytes.len()
    }

    /// Whether `needle`'s bytes stand at `at`.
    fn matches(&self, at: usize, needle: &[u8]) -> bool {
        self.bytes.len() >= at + needle.len() && &self.bytes[at..at + needle.len()] == needle
    }

    /// Where `needle` next stands at or after `from`.
    fn find(&self, from: usize, needle: &[u8]) -> Option<usize> {
        (from..=self.bytes.len().saturating_sub(needle.len())).find(|at| self.matches(*at, needle))
    }
}

/// Whether `byte` may start an identifier.
fn is_identifier_start(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || byte == b'_' || !byte.is_ascii()
}

/// Whether `byte` may continue one.
///
/// Every non-ASCII byte counts, because Kotlin identifiers may be written in any script and a
/// function called `café` must be reported under its own name rather than under `caf` — which is
/// what a namespace would then fail to offer. This stays a byte comparison: every byte of a
/// multi-byte UTF-8 sequence is non-ASCII, so a run of them ends exactly where the next ASCII byte
/// begins, which is a character boundary and therefore safe to slice at.
fn is_identifier_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || !byte.is_ascii()
}

#[cfg(test)]
#[path = "kotlin.source.test.rs"]
mod tests;
