//! **Java's [healing dialect](crate::healing::Dialect)** — the lexical half of
//! [response healing](crate::healing), answered in Java's own terms.
//!
//! Java's syntax is the closest of any registered arm to
//! [TypeScript's](super::super::typescript::healing), and it would have been easy to hand this arm
//! that dialect and move on. It would also have been wrong in four separate places, and each of
//! them is a place where the *same rule* reaches a different conclusion because the language is
//! different. They are the whole content of this file:
//!
//! **An `import` is never deleted, and this arm is the reason the rule is a language's own.** On the
//! ECMAScript arms an `import` is dead text: the guest has no module loader, so nothing the line
//! names can ever resolve and dropping it can only help. Here it is a **working line** — gg's
//! [wrapper](super::source) lifts every `import` a model wrote into the compilation unit's header
//! before javac sees it, so `import java.util.stream.Collectors;` resolves and does its job.
//! [`is_import_statement`](Dialect::is_import_statement) therefore answers `false`,
//! [`drop-imports`](crate::healing::HealingStrategy::DropImports) never fires on this arm, and the
//! one repair that *would* have wanted an import gone — the concurrency wrapper — keeps it instead,
//! for the reason [`unwrap_async`] gives.
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
//! **The redeclaration proof is a local variable, not a `const`.** ECMAScript makes redeclaring a
//! `const` an early error; Java makes redeclaring a **local variable** in one block a compile error
//! (`variable x is already defined`), and a program's statements are one block. So a repeated tail
//! that declares `String plan = …` — or a local `class`, `record`, `interface` or `enum` — is a
//! reply that could not have compiled as sent, which is exactly the proof
//! [`drop-duplicate-program`](crate::healing::HealingStrategy::DropDuplicateProgram) needs. See
//! [`declares_lexically`] for what counts as a declaration and what deliberately does not.
//!
//! # The concurrency wrapper is a thread, and the sandbox refuses it
//!
//! Java has no `async` keyword and no suspension token — every call in the language already blocks —
//! so the shape a model wraps a whole program in is a `Thread` it creates and starts, or a
//! `CompletableFuture` it runs and joins. That wrapper is not merely redundant here: TeaVM schedules
//! a started thread with `setTimeout`, which this sandbox denies, so a program wearing one fails
//! before a line of the model's own work runs. [`unwrap_async`] recognises both the immediate and
//! the declared shape and reports **zero** tokens removed, because there is no `await` in this
//! language to remove and reporting one would be a count of something that never existed.
//!
//! # None of these is a parser
//!
//! Not one predicate here parses, for the reason every other dialect gives: healing runs on text
//! that is **not yet known to be a program** — it may be Markdown, prose, or two programs pasted
//! together — so a parser would fail on precisely the inputs healing exists to repair. javac is
//! downstream of all of this and is what actually reads the program; every answer here is a lexical
//! shape test with its errors pointed in the safe direction, and every one of them **declines**
//! rather than guessing when it cannot tell.

use crate::healing::{
    AsyncWrapper, CodeMask, Dialect, Unwrapped, common_prefix, lines_with_offsets,
};

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

    /// **`false`, always.** gg's [wrapper](super::source) hoists every `import` a model wrote into
    /// the compilation unit's header, so the line resolves and is doing its job — and an import
    /// javac cannot resolve is a *located compile error on the turn that wrote it*, which is a
    /// better answer than a silent deletion. There is no lexical shape here that is certainly dead,
    /// and deleting a working line is the one failure this subsystem exists not to commit.
    fn is_import_statement(&self, _line: &str) -> bool {
        false
    }

    /// Whether the repeated tail declares a **local variable** or a **local type** at its top
    /// level — the proof that the reply as sent could not have compiled and therefore ran nothing.
    fn declares_a_redeclarable_binding(&self, text: &str, mask: &CodeMask, base: usize) -> bool {
        declares_lexically(text, mask, base).next().is_some()
    }

    /// `new Thread(() -> { … }).start();` as the whole program
    /// ([`Immediate`](AsyncWrapper::Immediate)), and `Thread worker = new Thread(() -> { … });`
    /// followed by `worker.start();` ([`Declared`](AsyncWrapper::Declared)) — with
    /// `CompletableFuture.runAsync(…).join()` recognised in both shapes too.
    ///
    /// `awaits` is always **zero**. Java has no suspension token — every call in the language
    /// already blocks — so there is nothing of that kind to delete, and putting a count in front of
    /// the model would be reporting a repair that never happened.
    fn unwrap_async(&self, text: &str, mask: &CodeMask) -> Option<Unwrapped> {
        unwrap_async(text, mask)
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
/// writes), the access modifiers are here (a model writes them on a helper type even though a local
/// declaration may not carry one, and the resulting compile error is the model's to read rather than
/// gg's to hide), and the local type declarations are here.
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
// Redeclaration
// ---------------------------------------------------------------------------------------------

/// The words that may open a line and are **not** the type of a declaration.
///
/// Without this list every `return value;`, `throw failure;`, `assert ok;` and `import java.util.*;`
/// would read as "a type, a name, and a terminator" — and each of those may legally appear twice, so
/// treating one as a redeclaration would let `drop-duplicate-program` delete work the model asked to
/// have done. `import` is the sharpest of them: two identical imports are perfectly legal Java, and
/// gg hoists them both.
///
/// `final` is deliberately absent: it is a *modifier* on a declaration and is stripped before the
/// type is read, rather than being a head in its own right.
const NOT_A_TYPE: [&str; 26] = [
    "return",
    "throw",
    "throws",
    "assert",
    "yield",
    "import",
    "package",
    "new",
    "case",
    "break",
    "continue",
    "else",
    "do",
    "if",
    "for",
    "while",
    "switch",
    "try",
    "catch",
    "finally",
    "synchronized",
    "instanceof",
    "this",
    "super",
    "default",
    "void",
];

/// The keywords that open a **local type** declaration, whose name a block also refuses twice.
const LOCAL_TYPES: [&str; 4] = ["class", "record", "interface", "enum"];

/// Every name `text` declares at its **top level**, in source order.
///
/// "Top level" is read as *unindented*, which is what a top-level statement is in every program a
/// model writes and what keeps this from mistaking a declaration inside a loop body — legal, and
/// legal twice, because it is a different block — for a redeclaration. `base` is where `text` starts
/// inside the source `mask` was built over, so a caller may ask about a slice of it.
///
/// Two shapes count, and both are things Java refuses to see twice in one block:
///
/// * a **local variable** — an optional `final`, a type, a name, and then `=` or `;`. `int total =
///   1;`, `Map<String, List<Integer>> index = new TreeMap<>();`, `String[] parts;`, `var rows =
///   fs.listDir("src");`
/// * a **local type** — `class Helper {`, `record Point(int x, int y) {}`, `enum Mode {`
///
/// Everything else declines, and the declines are where the correctness is. A call is rejected
/// because the type scan stops at `(` and finds no whitespace after it (`System.out.println("hi");`);
/// an assignment is rejected because what follows the first word is `=` rather than a second name
/// (`total = 1;`); and a statement keyword is rejected outright by [`NOT_A_TYPE`], which is what
/// keeps `return value;` twice from reading as a redeclaration.
fn declares_lexically<'a>(
    text: &'a str,
    mask: &'a CodeMask,
    base: usize,
) -> impl Iterator<Item = &'a str> {
    lines_with_offsets(text).filter_map(move |(offset, line)| {
        if !mask.is_code(base + offset) || line.starts_with([' ', '\t']) {
            return None;
        }
        declared_name(line)
    })
}

/// The name `line` declares, if it declares one.
fn declared_name(line: &str) -> Option<&str> {
    let mut rest = line.trim();
    // A local declaration may carry `final`, and nothing else a local declaration may legally carry
    // changes what follows.
    while let Some(after) = keyword(rest, "final") {
        rest = after.trim_start();
    }
    for word in LOCAL_TYPES {
        if let Some(after) = keyword(rest, word) {
            let (name, _) = identifier(after.trim_start())?;
            return Some(name);
        }
    }
    let after_type = type_end(rest)?;
    // A type and its name are separated by whitespace; `foo(bar)` and `a.b` are not declarations.
    if !after_type.starts_with(|c: char| c.is_whitespace()) {
        return None;
    }
    let head = &rest[..rest.len() - after_type.len()];
    if NOT_A_TYPE.contains(&head) {
        return None;
    }
    let (name, after_name) = identifier(after_type.trim_start())?;
    // `String[] parts` may put the brackets on either side of the name.
    let mut after_name = after_name.trim_start();
    while let Some(stripped) = after_name.strip_prefix("[]") {
        after_name = stripped.trim_start();
    }
    (after_name.starts_with('=') && !after_name.starts_with("==") || after_name.starts_with(';'))
        .then_some(name)
}

/// The text after the type at the front of `line`, or `None` when there is no type there.
///
/// A type is an identifier, optionally qualified with dots, optionally carrying a balanced `<…>`
/// argument list, and optionally suffixed with `[]`s. The balance is what lets `Map<String,
/// List<Integer>>` be read as one token rather than as an inequality.
///
/// Scanned by **character** rather than by byte, because a model's reply is not ASCII and a byte
/// scan lands mid-character: `line[at..]` panics unless `at` is a character boundary, so a single
/// `é` anywhere on the line would take the turn down with a slice index error instead of being read
/// as the ordinary identifier character Java says it is.
fn type_end(line: &str) -> Option<&str> {
    if !line.starts_with(is_ident_start) {
        return None;
    }
    let mut at = run_end(line, 0, |character| {
        is_ident_char(character) || character == '.'
    });
    if line[at..].starts_with('<') {
        let mut depth = 0usize;
        // An unbalanced `<` is a comparison rather than a type argument list, and there is no type
        // here to have found — which is what leaving `closed` as `None` says.
        let mut closed = None;
        for (index, character) in line[at..].char_indices() {
            match character {
                '<' => depth += 1,
                '>' => {
                    depth -= 1;
                    if depth == 0 {
                        closed = Some(at + index + 1);
                        break;
                    }
                }
                _ => {}
            }
        }
        at = closed?;
    }
    while line[at..].starts_with("[]") {
        at += 2;
    }
    Some(&line[at..])
}

/// Where the run of characters `accept`s, starting at `from`, ends.
fn run_end(line: &str, from: usize, accept: impl Fn(char) -> bool) -> usize {
    for (index, character) in line[from..].char_indices() {
        if !accept(character) {
            return from + index;
        }
    }
    line.len()
}

/// The identifier at the front of `text` and what follows it.
fn identifier(text: &str) -> Option<(&str, &str)> {
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

/// The rest of `text` when it opens with `word` at an identifier boundary.
fn keyword<'a>(text: &'a str, word: &str) -> Option<&'a str> {
    text.strip_prefix(word)
        .filter(|rest| rest.starts_with(|c: char| c.is_whitespace()))
}

// ---------------------------------------------------------------------------------------------
// The concurrency wrapper
// ---------------------------------------------------------------------------------------------

/// Take the thread wrapper off a program that is entirely made of one.
///
/// # Why the imports above it stay
///
/// [Python's arm](super::super::python::healing) deletes the `import asyncio` that made its runner
/// reachable, and [Ruby's](super::super::ruby::healing) deletes the `require "thread"`, because in
/// both cases the line names something the guest does **not** carry: leaving it would leave the one
/// line of the repaired program that still fails. Java is the opposite. `Thread` is `java.lang` and
/// needs no import at all, and `java.util.concurrent` is in [the declared library
/// set](super::super) — so `import java.util.concurrent.CompletableFuture;` resolves, an unused
/// import is legal Java rather than an error, and deleting it would be deleting a working line to
/// no purpose. So a leading run of imports is allowed **in front of** the wrapper and kept verbatim,
/// which is also what makes the `CompletableFuture` shape reachable at all: without it, the import
/// the shape needs would mean the text is not "entirely made of the wrapper" and this would decline.
fn unwrap_async(text: &str, mask: &CodeMask) -> Option<Unwrapped> {
    let (prefix, body_start) = import_prefix(text, mask);
    let (wrapper, body) = match_wrapper(text, mask, body_start)?;
    let inner = dedented(text, mask, body);
    let program = match prefix.trim().is_empty() {
        true => inner,
        false => format!("{}\n\n{inner}", prefix.trim_end()),
    };
    Some(Unwrapped {
        wrapper,
        text: program,
        // Zero, and it is the honest number: Java has no suspension token, so nothing of that kind
        // was deleted and a count would report a repair that never happened.
        awaits: 0,
    })
}

/// The leading run of `import` lines and blank lines, and the offset the wrapper may start at.
fn import_prefix<'a>(text: &'a str, mask: &CodeMask) -> (&'a str, usize) {
    let mut end = 0usize;
    for (offset, line) in lines_with_offsets(text) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let indent = line.len() - line.trim_start().len();
        let import = mask.is_code(offset + indent)
            && keyword(trimmed, "import").is_some()
            && trimmed.ends_with(';');
        if !import {
            break;
        }
        end = offset + line.len();
    }
    (&text[..end], end)
}

/// The constructors this dialect recognises as a whole-program wrapper, each written exactly as the
/// text that must stand immediately in front of the lambda.
///
/// A closed list rather than "anything with a lambda in it", because the match is **anchored**: the
/// text between where the wrapper may start and the lambda's `{` is required to be one of these and
/// nothing else. Without that anchor a program whose *last* statement happened to be
/// `new Thread(…).start();` would have every statement above it deleted, which is the one failure
/// this strategy must not have.
const WRAPPERS: [&str; 3] = [
    "new Thread(",
    "CompletableFuture.runAsync(",
    "CompletableFuture.supplyAsync(",
];

/// The wrapper `text` is entirely made of from `from` onwards, and the byte range of its body
/// between the braces.
fn match_wrapper(
    text: &str,
    mask: &CodeMask,
    from: usize,
) -> Option<(AsyncWrapper, std::ops::Range<usize>)> {
    if let Some(matched) = match_declared(text, mask, from) {
        return Some(matched);
    }
    match_immediate(text, mask, from)
}

/// `new Thread(() -> { … }).start();` or `CompletableFuture.runAsync(() -> { … }).join();` as the
/// whole program — one expression, run where it is written, with no name.
fn match_immediate(
    text: &str,
    mask: &CodeMask,
    from: usize,
) -> Option<(AsyncWrapper, std::ops::Range<usize>)> {
    let after_constructor = wrapper_head(text, from)?;
    let (open, close) = lambda_body(text, mask, after_constructor)?;
    // The lambda's own closing paren, then the call that runs it, and nothing else.
    let tail = text.get(close + 1..)?.trim_start().strip_prefix(')')?;
    let tail = strip_runner(tail.trim_start())?;
    tail.trim()
        .is_empty()
        .then_some((AsyncWrapper::Immediate, open + 1..close))
}

/// `Thread worker = new Thread(() -> { … });` followed by exactly the calls that run it.
///
/// The trailing call is **required**, for the reason TypeScript's declared shape requires one: a
/// wrapper that is only constructed runs nothing, so unwrapping it would not repair a broken program
/// — it would execute statements the response never asked to execute.
fn match_declared(
    text: &str,
    mask: &CodeMask,
    from: usize,
) -> Option<(AsyncWrapper, std::ops::Range<usize>)> {
    let head = text.get(from..)?;
    let first = head.lines().next()?;
    let declared = declared_name(first)?.to_string();
    let equals = from + first.find('=')?;
    let after_constructor = wrapper_head(text, equals + 1)?;
    let (open, close) = lambda_body(text, mask, after_constructor)?;
    let tail = text.get(close + 1..)?.trim_start().strip_prefix(')')?;
    let mut tail = tail.trim_start().strip_prefix(';')?.trim_start();
    // `worker.start();`, then any number of further no-argument calls on the same name — `join()`
    // is the one a model writes, and requiring it would refuse the shape that leaves it off.
    let mut ran = false;
    while let Some(rest) = tail.strip_prefix(declared.as_str()) {
        let Some(rest) = rest.trim_start().strip_prefix('.') else {
            break;
        };
        let Some((call, rest)) = identifier(rest.trim_start()) else {
            break;
        };
        let Some(rest) = rest.trim_start().strip_prefix("()") else {
            break;
        };
        let Some(rest) = rest.trim_start().strip_prefix(';') else {
            break;
        };
        ran |= call == "start" || call == "run";
        tail = rest.trim_start();
    }
    (ran && tail.trim().is_empty()).then_some((AsyncWrapper::Declared, open + 1..close))
}

/// The offset just past the `(` of a recognised [wrapper constructor](WRAPPERS) at `from`, skipping
/// leading whitespace.
fn wrapper_head(text: &str, from: usize) -> Option<usize> {
    let head = text.get(from..)?.trim_start();
    let at = text.len() - head.len();
    WRAPPERS
        .iter()
        .find(|wrapper| head.starts_with(*wrapper))
        .map(|wrapper| at + wrapper.len())
}

/// The call that runs an immediately-constructed wrapper: `.start();`, `.run();`, `.join();` or
/// `.get();`, chained onto it and terminated.
fn strip_runner(tail: &str) -> Option<&str> {
    let rest = tail.strip_prefix('.')?.trim_start();
    let (call, rest) = identifier(rest)?;
    if !["start", "run", "join", "get"].contains(&call) {
        return None;
    }
    let rest = rest.trim_start().strip_prefix("()")?.trim_start();
    Some(rest.strip_prefix(';').unwrap_or(rest))
}

/// The braces of the `() -> { … }` lambda a wrapper's constructor was given, given the offset just
/// past that constructor's `(`.
///
/// Deliberately requires the lambda to have a **block** body. `new Thread(() -> doWork()).start();`
/// is a wrapper too, but its body is one expression rather than a program, so there is nothing there
/// worth the risk of unwrapping.
fn lambda_body(text: &str, mask: &CodeMask, from: usize) -> Option<(usize, usize)> {
    let rest = text.get(from..)?.trim_start();
    let rest = rest.strip_prefix('(')?.trim_start();
    let rest = rest.strip_prefix(')')?.trim_start();
    let rest = rest.strip_prefix("->")?.trim_start();
    let open = text.len() - rest.len();
    if !rest.starts_with('{') {
        return None;
    }
    let close = matching_brace(text, mask, open)?;
    Some((open, close))
}

/// The offset of the `}` that closes the `{` at `open`, counting braces in code context only.
fn matching_brace(text: &str, mask: &CodeMask, open: usize) -> Option<usize> {
    let mut depth = 0usize;
    for (index, byte) in text.bytes().enumerate().skip(open) {
        if !mask.is_code(index) {
            continue;
        }
        match byte {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(index);
                }
            }
            _ => {}
        }
    }
    None
}

/// The wrapper's body, dedented by the common indentation of the lines that begin in code context.
///
/// A line that begins inside a text block carries data rather than indentation, so it is left where
/// the model put it — which is the whole reason this consults the mask instead of trimming every
/// line.
fn dedented(text: &str, mask: &CodeMask, body: std::ops::Range<usize>) -> String {
    let inner = &text[body.clone()];
    let base = body.start;
    let indent = lines_with_offsets(inner)
        .filter(|(offset, line)| !line.trim().is_empty() && mask.is_code(base + offset))
        .map(|(_, line)| &line[..line.len() - line.trim_start().len()])
        .reduce(common_prefix)
        .unwrap_or_default()
        .to_string();

    let mut out = String::with_capacity(inner.len());
    let mut offset = 0usize;
    for raw in inner.split_inclusive('\n') {
        let start = offset;
        offset += raw.len();
        out.push_str(match mask.is_code(base + start) {
            true => raw.strip_prefix(indent.as_str()).unwrap_or(raw),
            false => raw,
        });
    }
    out.trim().to_string()
}

// ---------------------------------------------------------------------------------------------
// The predicates
// ---------------------------------------------------------------------------------------------

/// Whether `line` is **certainly** a line of Java — this dialect's answer to
/// [`Dialect::looks_like_code`](crate::healing::Dialect::looks_like_code).
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
/// [`Dialect::is_prose_line`](crate::healing::Dialect::is_prose_line), and the test `strip-prose`
/// uses to delete a line.
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

/// Lex `src` into its [code mask](CodeMask) — this dialect's answer to
/// [`Dialect::code_mask`](crate::healing::Dialect::code_mask).
///
/// `None` means the source did not lex cleanly, and every strategy that needs the mask declines on
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
/// of English that reached this far. The scan returns `None` and every strategy declines, which is
/// the correct failure mode for a reading already known to be wrong. It is not the same exposure
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
