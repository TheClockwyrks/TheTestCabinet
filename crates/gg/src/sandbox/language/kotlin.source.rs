//! **What gg does to a model's Kotlin before the compiler sees it** — very little for a program, and
//! an export scan for a code module. Everything here is lexical and everything here is
//! line-preserving.
//!
//! # A program is a Kotlin *script*, and that is the whole design
//!
//! Kotlin has no place for a loose statement in an ordinary `.kt` file, so the obvious shape — the
//! one [Java's arm](super::super::java::source) takes — is to wrap a model's reply in the body of a
//! function gg declares. That shape was built and **measured**, and it is wrong for this language:
//! Kotlin's rules for what may be declared *locally* are far tighter than Java's, and each of the
//! following was refused by the real compiler inside a wrapper function:
//!
//! | What a model wrote | What Kotlin said |
//! | --- | --- |
//! | `object Registry { … }` | `LOCAL_OBJECT_NOT_ALLOWED` |
//! | `interface Shape`, and therefore `sealed interface Event` | `LOCAL_INTERFACE_NOT_ALLOWED` |
//! | `enum class Colour { … }` | `WRONG_MODIFIER_TARGET`: enum is not applicable to a local class |
//! | `companion object` inside a helper class | `WRONG_MODIFIER_CONTAINING_DECLARATION` |
//! | `typealias Rows = List<Int>` | `UNSUPPORTED_FEATURE`: local type aliases are experimental |
//! | `private fun helper() = 1` | `WRONG_MODIFIER_TARGET`: private is not applicable to a local function |
//!
//! Five of those six are ordinary modern Kotlin — a `sealed interface` with `data class` arms is
//! *the* idiom for a closed set of cases, and `private fun` is what a Kotlin author types without
//! thinking. An arm that refused them would be measuring how well a model copes with gg's wrapper
//! rather than how well it works in Kotlin, which is the one thing a language study must not do.
//!
//! So a program is compiled as a **script** (`Program.kts`), which is a real Kotlin compilation
//! shape in which statements and declarations sit side by side at the top level in any order.
//! Every one of the six above compiles. What that costs is one flag and four jars in the toolchain
//! (see [`compile`](super::compile)) and **nothing at all** in the model's source: a reply with no
//! `import` in it is compiled byte for byte as the model wrote it, which no other arm can say.
//!
//! # What is left to do to a program, then
//!
//! Two things, and both are the same ones Java's arm does:
//!
//! * an `import` is **hoisted** into the file's header and blanked where it stood, because a script's
//!   imports must precede its statements and a model that writes one half way down its reply has
//!   written a syntax error rather than a mistake worth failing a turn for. Blanking rather than
//!   deleting is what keeps every later line where the model put it;
//! * a `package` declaration is **refused by name**, because a program is one anonymous compilation
//!   unit and silently dropping one would leave a model wondering why its own names did not resolve.
//!
//! # Why a lexer rather than a regular expression
//!
//! Because the input is untrusted text a model wrote, and `import ` at the start of a line inside a
//! raw string is not an import. [`Lexer`] is the smallest thing that can tell code from a string, a
//! character literal, a comment, a raw string and a backquoted identifier.
//!
//! Kotlin needs three things Java's reading of the same question does not:
//!
//! * **string templates**. `"total: ${rows["n"]}"` is one string, and a scan that stopped at the
//!   quote before `n` would read the rest of the line as code — so a `${…}` is followed through with
//!   a brace counter, nested strings and all.
//! * **nested block comments**. `/* a /* b */ c */` is one comment in Kotlin and two in Java, and
//!   reading it Java's way leaves ` c */` as code.
//! * **backquoted identifiers**. `` fun `a name with spaces`() `` is legal, so the bytes between
//!   backticks are skipped like a string: they can hold a brace or the word `import` and mean
//!   neither.
//!
//! Everything it does is a **byte** comparison rather than a slice of the source, and that is not a
//! style: the scan walks one byte at a time, so `&source[at..]` panics on any index that is not a
//! character boundary. A single `é` in a string, a comment or an identifier would have taken the
//! turn down with a slice index error rather than reaching the compiler. Every delimiter it looks
//! for is ASCII, and an ASCII byte never appears inside a multi-byte UTF-8 sequence, so byte
//! comparisons find exactly what string comparisons would.

use super::super::{PrepareError, PrepareFailure};

/// The class a **program** compiles to, which is the script file's own name.
pub(super) const PROGRAM_CLASS: &str = "Program";

/// The class a code **module** compiles to: the file facade, renamed off the export name so the two
/// do not collide.
///
/// They must differ. TeaVM emits the exported class under one name and the translated class under
/// another, both in the bundle's scope — and when the two are the same word, the inner declaration
/// shadows the outer one and the namespace gg hands back is `undefined`. Measured, on a module whose
/// facade was called `GgModule` outright.
pub(super) const MODULE_CLASS: &str = "Module";

/// The name a module's namespace is exported to JavaScript under, and the value evaluating a
/// prepared module hands back.
pub(super) const MODULE_GLOBAL: &str = "GgModule";

/// The class gg generates to hold the entry point and the catch chain.
pub(super) const ENTRY_CLASS: &str = "GgEntry";

/// A model's source, wrapped into something the compiler will read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Wrapped {
    /// The whole file.
    pub source: String,
    /// How many lines gg put in front of the model's first line. Every diagnostic located in this
    /// file is moved back by it, so the coordinate names the line of the reply the model wrote.
    pub shift: usize,
    /// The names a module's namespace offers, in source order. Empty for a program.
    pub exports: Vec<String>,
}

/// Wrap a model's **program** — statements and declarations, in whatever order it wrote them — into
/// the script the compiler reads.
///
/// "Wrap" overstates it: with no `import` to hoist there is nothing to add, and the source is the
/// model's own bytes with a shift of zero.
pub(super) fn wrap_program(source: &str) -> Result<Wrapped, PrepareFailure> {
    let (body, imports) = hoist(source)?;
    Ok(headed(&imports, &body, Vec::new()))
}

/// Wrap a code [skill](crate::skills)'s or [memory](crate::memories)'s **module** — an ordinary
/// Kotlin file — and say what its namespace will offer.
///
/// A module is a file rather than a script, and that is this arm's own answer rather than an
/// oversight: what `lib.<key>` binds is a namespace of functions, a Kotlin file's public top-level
/// functions are exactly that, and they compile to the static methods of one class that TeaVM can
/// export. A script's declarations are members of a script *instance*, which is a thing that would
/// have to be constructed before anything could be read off it.
///
/// Each exported function gets `@JSExport` inserted **inline**, so TeaVM emits it onto the namespace
/// object without a line moving.
pub(super) fn wrap_module(source: &str) -> Result<Wrapped, PrepareFailure> {
    let (body, imports) = hoist(source)?;
    let (body, exports) = mark_exports(&body);
    if exports.is_empty() {
        return Err(PrepareFailure::Program(PrepareError::Unsupported(
            "this module offers nothing: gg binds a code module's public top-level functions at \
             `lib.<key>`, and there are none. Declare at least one, as \
             `fun greet(who: String): String = \"hello \" + who`."
                .to_string(),
        )));
    }
    let mut header = vec![
        format!("@file:JvmName(\"{MODULE_CLASS}\")"),
        format!("@file:JSClass(name = \"{MODULE_GLOBAL}\")"),
        "import org.teavm.jso.JSClass".to_string(),
        "import org.teavm.jso.JSExport".to_string(),
    ];
    header.extend(imports);
    Ok(headed(&header, &body, exports))
}

/// A header and a body, joined so that the body's lines are exactly `header.len()` lines further
/// down than the model wrote them.
///
/// The empty header is its own case rather than an accident of `join`: a program with no `import`
/// gets **no** leading blank line and a shift of zero, so the bytes the model wrote are the bytes
/// the compiler reads.
fn headed(header: &[String], body: &str, exports: Vec<String>) -> Wrapped {
    match header.is_empty() {
        true => Wrapped {
            source: body.to_string(),
            shift: 0,
            exports,
        },
        false => Wrapped {
            source: format!("{}\n{body}", header.join("\n")),
            shift: header.len(),
            exports,
        },
    }
}

// ---------------------------------------------------------------------------------------------
// The import hoist
// ---------------------------------------------------------------------------------------------

/// Lift every `import` the source declares into the header, leaving a blank line where each stood.
///
/// A model writing Kotlin writes imports, and in a script they are only legal above the first
/// statement — so a reply that explains itself for three lines and then imports something is a
/// syntax error rather than a mistake. They are moved rather than refused, and blanking rather than
/// deleting is what keeps every later line where the model put it.
fn hoist(source: &str) -> Result<(String, Vec<String>), PrepareFailure> {
    let code = Lexer::new(source).code_mask();
    let mut body = String::with_capacity(source.len());
    let mut imports = Vec::new();
    let mut at = 0usize;
    for (number, line) in source.split_inclusive('\n').enumerate() {
        let start = at;
        at += line.len();
        let trimmed = line.trim();
        // Only a line that *starts* in code is a candidate: the first byte of `import` inside a raw
        // string is masked out, and so is a commented-out one.
        let offset = line.len() - line.trim_start().len();
        if !code.get(start + offset).copied().unwrap_or(false) {
            body.push_str(line);
            continue;
        }
        if let Some(rest) = keyword(trimmed, "package") {
            return Err(PrepareFailure::Program(PrepareError::Unsupported(format!(
                "line {}: a gg program is one anonymous compilation unit with no package, so \
                 `package {}` has nowhere to go. Remove it; every name you declare is already \
                 visible to the rest of your program.",
                number + 1,
                rest.trim(),
            ))));
        }
        // No trailing `;` to insist on: Kotlin's imports end at the line, and one written with a
        // semicolon is the same import.
        match keyword(trimmed, "import") {
            Some(_) => {
                imports.push(trimmed.trim_end_matches(';').trim_end().to_string());
                // The line's own terminator is kept, so the body has exactly as many lines as the
                // reply did.
                body.push_str(match line.ends_with('\n') {
                    true => "\n",
                    false => "",
                });
            }
            None => body.push_str(line),
        }
    }
    Ok((body, imports))
}

/// The rest of `line` when it opens with `word` followed by whitespace — `None` otherwise, so
/// `importantThing()` is not read as an `import`.
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
/// wrong here can only mean gg *fails to see* a `private` — and that direction is a compile error
/// about an exported private function, not a silently missing member.
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

/// Insert `@JSExport` before every public top-level function of a module, and report their names in
/// source order.
///
/// Inline insertion, because the annotation must not cost a line. What counts is a `fun` at the
/// file's own level whose modifier run holds neither `private` nor `internal` and which reaches a
/// name before its parameter list — so `fun interface Greeter` is not a function, an anonymous
/// `fun(x: Int)` has no name to bind, and a top-level `val` is a property rather than something a
/// namespace of functions offers.
fn mark_exports(body: &str) -> (String, Vec<String>) {
    let functions = Lexer::new(body).top_level_functions();
    let mut out = String::with_capacity(body.len() + functions.len() * 11);
    let mut exports = Vec::new();
    let mut copied = 0usize;
    for function in functions {
        if function.hidden {
            continue;
        }
        out.push_str(&body[copied..function.at]);
        out.push_str("@JSExport ");
        copied = function.at;
        exports.push(function.name);
    }
    out.push_str(&body[copied..]);
    (out, exports)
}

/// One top-level function declaration.
#[derive(Debug, PartialEq, Eq)]
struct Function {
    /// The byte offset of its `fun` keyword, which is where gg's annotation goes.
    at: usize,
    /// The name it declares — the last identifier before its parameter list, so an extension
    /// function is known by its own name rather than by its receiver's.
    name: String,
    /// Whether a visibility modifier keeps it out of the namespace.
    hidden: bool,
}

// ---------------------------------------------------------------------------------------------
// The lexer
// ---------------------------------------------------------------------------------------------

/// The smallest reading of Kotlin that can tell **code** from everything that merely looks like it.
///
/// It answers two questions and no others: which bytes are code (so a line that opens with `import`
/// inside a raw string is not an import), and where each top-level function of a file begins (so an
/// annotation can be inserted in front of one). It is not a parser and does not try to be — the
/// Kotlin compiler is downstream of it and is what actually reads the program.
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
        let name = self.declared_name(end, spans)?;
        Some(Function {
            at,
            name,
            hidden: self
                .modifiers_before(at)
                .iter()
                .any(|word| HIDDEN.iter().any(|hidden| word == hidden)),
        })
    }

    /// The name declared after a `fun` keyword: the last identifier before the parameter list.
    ///
    /// `None` when the next thing of substance is `interface` (a `fun interface` is a type), or when
    /// the parameter list opens with no name in front of it (an anonymous function), or when no
    /// parameter list arrives at all — each of which is something other than a function this
    /// namespace could offer.
    fn declared_name(&self, from: usize, spans: &[(usize, usize)]) -> Option<String> {
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
                b'(' => return last,
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

    /// The run of modifier words immediately before `at`.
    ///
    /// Walks backwards over whitespace and words, stopping at the first thing that is not a
    /// [modifier](MODIFIERS) — a `)`, a `}`, an unknown word — so a `private` belonging to the
    /// *previous* declaration is never read as this one's.
    fn modifiers_before(&self, at: usize) -> Vec<String> {
        let mut words = Vec::new();
        let mut scan = at;
        loop {
            while scan > 0 && self.bytes[scan - 1].is_ascii_whitespace() {
                scan -= 1;
            }
            let end = scan;
            while scan > 0 && is_identifier_byte(self.bytes[scan - 1]) {
                scan -= 1;
            }
            if scan == end {
                return words;
            }
            let word = &self.source[scan..end];
            if !MODIFIERS.contains(&word) {
                return words;
            }
            words.push(word.to_string());
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
