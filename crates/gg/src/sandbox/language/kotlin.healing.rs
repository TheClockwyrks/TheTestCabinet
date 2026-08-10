//! **Kotlin's [healing dialect](crate::healing::Dialect)** — the lexical half of
//! [response healing](crate::healing), answered in Kotlin's own terms.
//!
//! This arm shares a compiler road, a guest and a classlib with [Java's](super::super::java), which
//! makes it the sharpest test the seam has of whether a dialect is *derived* or copied: two arms
//! that could hardly be closer downstream reach a **different answer to four questions**, and every
//! one of the four is the same rule reading a different grammar.
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
//! **Every declaration is keyword-led, so the redeclaration proof needs no deny list.** Java's has to
//! read "a type, a name and a terminator" and then subtract the two dozen statement keywords that
//! also match that shape — `return value;`, `throw failure;`, a second identical `import`. Kotlin
//! puts `val`, `var`, `fun`, `class`, `object`, `interface` or `typealias` in front of every one of
//! its declarations, so [`declares_lexically`] recognises a declaration by its keyword and everything
//! else declines by construction. It is also a **wider** proof than any other arm's: a program's top
//! level here is a *script's*, where the compiler refuses a second `fun`, `object` or `class` of the
//! same name as readily as a second `val` — measured, as `Overload resolution ambiguity` and
//! `Duplicate JVM class name`.
//!
//! **The import above a concurrency wrapper is deleted**, where Java's is kept — and that is the
//! divergence that shows the rule is about the *program* rather than about the language family. Java
//! keeps `import java.util.concurrent.CompletableFuture;` because `java.util.concurrent` is in that
//! arm's declared library set, so the line resolves and an unused import is legal. Kotlin's wrapper
//! reaches for `kotlinx.coroutines`, which this arm's program classpath deliberately does not carry —
//! `import kotlinx.coroutines.*` is `Unresolved reference 'kotlinx'` at the model's own line — so
//! leaving it would leave the one line of the repaired program that still fails. That is
//! [Python's answer](super::super::python::healing) and [Ruby's](super::super::ruby::healing),
//! reached from Kotlin's classpath rather than from theirs.
//!
//! # The concurrency wrapper, and the one arm that has a suspension token to delete
//!
//! Three shapes are recognised, and all three are measured failures rather than assumed ones:
//!
//! | What a model wrote | What happens without the repair |
//! | --- | --- |
//! | `runBlocking { … }` | `Unresolved reference 'kotlinx'` — the compile fails |
//! | `thread { … }` | TeaVM: `ThreadsKt$thread$thread$1.setContextClassLoader … was not found` |
//! | `Thread { … }.start()` | compiles, then `setTimeout is not available in the sandbox` before a line of the model's own work runs |
//!
//! And Kotlin is the first arm whose [`awaits`](Unwrapped::awaits) count can be **non-zero for a
//! reason other than an `await`**. The language has no suspension keyword at a *call* site — a
//! suspending call is written exactly like any other — but it has one on the **declaration**:
//! `suspend fun`. A `suspend fun` declared inside the wrapper cannot be called once the wrapper is
//! off, so [`unwrap_async`] deletes the modifier and counts it, which is what makes the repair
//! actually run. [Java's](super::super::java::healing) and [Ruby's](super::super::ruby::healing)
//! zero is the honest number for languages with no such token; this arm's count is the honest number
//! for one that has it in an unusual place.
//!
//! # Why this is not [the arm's other lexer](super::source)
//!
//! [`source`](super::source) already reads Kotlin closely enough to tell an `import` from the word
//! `import` inside a raw string, and it is deliberately **not** reused here, because the two answer
//! the same question under opposite contracts. That one runs over text already accepted as the
//! program, with the compiler downstream to locate anything it got wrong, so it is **total**: an
//! unterminated string simply runs to the end of the file and the compiler says so. This one runs
//! over text **not yet known to be a program**, and its answer decides whether gg deletes the
//! model's work — so it must be able to say *I lost my place*, and [`code_mask`] returns `None` for
//! an unterminated string, comment, character literal or backquoted name. It also reads `"` and `'`
//! as **line-bounded**, which Kotlin's grammar says they are and which is what makes an apostrophe in
//! a stray line of English decline the whole reading rather than swallow the program after it.
//!
//! # None of these is a parser
//!
//! Not one predicate here parses, for the reason every other dialect gives: healing runs on text that
//! is not yet known to be a program — it may be Markdown, prose, or two programs pasted together — so
//! a parser would fail on precisely the inputs healing exists to repair. The Kotlin compiler is
//! downstream of all of this and is what actually reads the program; every answer here is a lexical
//! shape test with its errors pointed in the safe direction, and every one of them **declines**
//! rather than guessing when it cannot tell.

use crate::healing::{
    AsyncWrapper, CodeMask, Dialect, Unwrapped, common_prefix, lines_with_offsets,
};

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

    /// **`false`, always** — the same answer [Java's arm](super::super::java::healing) gives, for
    /// the same reason.
    ///
    /// gg's own [preparation](super::source) hoists every `import` a model wrote into the script's
    /// header before the compiler sees it, so the line resolves and is doing its job, and one the
    /// compiler cannot resolve is a *located compile error on the turn that wrote it* — which is a
    /// better answer than a silent deletion. The one import that is certainly dead here, the
    /// `kotlinx.coroutines` line that makes a `runBlocking` wrapper reachable, is not left behind
    /// either: it is part of [the wrapper](unwrap_async) and comes off with it.
    fn is_import_statement(&self, _line: &str) -> bool {
        false
    }

    /// Whether the repeated tail declares anything at its top level — the proof that the reply as
    /// sent could not have compiled and therefore ran nothing.
    ///
    /// Wider than any other arm's, because a program here is a **script** whose top level is a
    /// class body rather than a block: a second `fun`, `object`, `class` or `typealias` of one name
    /// is refused exactly as a second `val` is. See [`declares_lexically`].
    fn declares_a_redeclarable_binding(&self, text: &str, mask: &CodeMask, base: usize) -> bool {
        declares_lexically(text, mask, base).next().is_some()
    }

    /// `runBlocking { … }`, `thread { … }` and `Thread { … }.start()` as the whole program
    /// ([`Immediate`](AsyncWrapper::Immediate)), and `val worker = Thread { … }` followed by
    /// `worker.start()` ([`Declared`](AsyncWrapper::Declared)) — with the `kotlinx.coroutines` or
    /// `kotlin.concurrent` imports above any of them deleted alongside.
    ///
    /// [`awaits`](Unwrapped::awaits) counts the `suspend` modifiers deleted from the body, which is
    /// this language's suspension token in the one place it lives: on a declaration rather than at a
    /// call site.
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
/// `kts` is here and is not a mistake: a program on this arm really is compiled as a **Kotlin
/// script**, so a model that tagged its block with the script extension tagged it correctly.
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
// Redeclaration
// ---------------------------------------------------------------------------------------------

/// The keywords that open a declaration whose name the compiler refuses to see twice at a script's
/// top level.
///
/// Measured against the real compiler rather than reasoned about, because a script's top level is
/// neither a file's nor a block's: a second `val` or `var` is `Overload resolution ambiguity`, a
/// second `fun` is the same, and a second `class`, `object` or `data class` is
/// `Duplicate JVM class name`. All of them stop the build before a statement runs, which is exactly
/// the proof [`drop-duplicate-program`](crate::healing::HealingStrategy::DropDuplicateProgram)
/// needs.
const DECLARATION_KEYWORDS: [&str; 7] = [
    "val",
    "var",
    "fun",
    "class",
    "object",
    "interface",
    "typealias",
];

/// Every modifier that may stand in front of one of those, and nothing else.
///
/// A **closed** list, read left to right and stopping at the first word that is not on it — so an
/// ordinary identifier ends the run rather than being read as part of it. Being wrong here can only
/// mean a declaration goes unrecognised, and an unrecognised declaration means
/// `drop-duplicate-program` declines, which is the safe direction.
const DECLARATION_MODIFIERS: [&str; 19] = [
    "public",
    "private",
    "internal",
    "protected",
    "data",
    "sealed",
    "enum",
    "annotation",
    "value",
    "inline",
    "suspend",
    "open",
    "abstract",
    "final",
    "external",
    "tailrec",
    "operator",
    "infix",
    "const",
];

/// Every declaration `text` makes at its **top level**, in source order.
///
/// "Top level" is read as *unindented*, which is what a top-level statement is in every program a
/// model writes and what keeps this from mistaking a declaration inside a lambda body — legal, and
/// legal twice, because it is a different scope — for a redeclaration. `base` is where `text` starts
/// inside the source `mask` was built over, so a caller may ask about a slice of it.
///
/// The reading is: an optional run of [modifiers](DECLARATION_MODIFIERS), one
/// [declaration keyword](DECLARATION_KEYWORDS), and then a name — or, after `val` or `var`, the `(`
/// of a destructuring declaration, which declares several names at once and is refused twice for
/// each of them.
///
/// Everything else declines, and it declines **by construction** rather than by a deny list, which
/// is the whole difference from [Java's reading](super::super::java::healing) of the same question.
/// `return value`, `throw failure`, `import kotlin.math.abs`, `total = 1` and `println("hi")` are
/// each rejected because their first word is neither a modifier nor a declaration keyword, and every
/// one of them may legally be written twice.
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
///
/// A destructuring `val (a, b) = pair` answers with `(`, which is not a name and is not meant to be
/// read as one: the caller asks only *whether* something was declared, and a slice that never
/// escapes this module is the cheapest way to say "yes, and it has no single name".
fn declared_name(line: &str) -> Option<&str> {
    let mut rest = line.trim();
    loop {
        let (word, after) = identifier(rest)?;
        let trimmed = after.trim_start();
        if DECLARATION_KEYWORDS.contains(&word) {
            if (word == "val" || word == "var") && trimmed.starts_with('(') {
                return Some(&trimmed[..1]);
            }
            return identifier(trimmed).map(|(name, _)| name);
        }
        if !DECLARATION_MODIFIERS.contains(&word) {
            return None;
        }
        // A modifier and what follows it are separated by whitespace; `data.load()` is a call and
        // `sealed_rows` is a name.
        if trimmed.len() == after.len() {
            return None;
        }
        rest = trimmed;
    }
}

// ---------------------------------------------------------------------------------------------
// The concurrency wrapper
// ---------------------------------------------------------------------------------------------

/// Take the concurrency wrapper off a program that is entirely made of one, and with it the imports
/// that made the wrapper reachable and the `suspend` modifiers the wrapper allowed.
fn unwrap_async(text: &str, mask: &CodeMask) -> Option<Unwrapped> {
    let body_start = import_prefix(text, mask);
    let (wrapper, body) = match_wrapper(text, mask, body_start)?;
    let inner = dedented(text, mask, body.clone());
    let (program, awaits) = without_suspend(&inner);
    Some(Unwrapped {
        wrapper,
        text: program,
        awaits,
    })
}

/// The offset the wrapper may start at, past a leading run of blank lines and imports that name the
/// wrapper's **own** libraries.
///
/// Those imports are deleted with the wrapper rather than kept, and that is the opposite of
/// [Java's answer](super::super::java::healing) on the same compiler road. `kotlinx.coroutines` is
/// not on this arm's program classpath at all and `kotlin.concurrent.thread` is refused by TeaVM, so
/// each of those lines is one the repaired program would still fail on. An import naming anything
/// else ends the run where it stands — and since a wrapper cannot begin with an `import`, the match
/// then declines, which is the right answer: a program with a working import above its wrapper is
/// not a program that is *entirely* made of one.
fn import_prefix(text: &str, mask: &CodeMask) -> usize {
    let mut end = 0usize;
    for (offset, line) in lines_with_offsets(text) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let indent = line.len() - line.trim_start().len();
        let ours = mask.is_code(offset + indent)
            && keyword(trimmed, "import").is_some_and(|rest| {
                let named = rest.trim_start().trim_end_matches(';').trim_end();
                WRAPPER_PACKAGES.iter().any(|package| {
                    named
                        .strip_prefix(*package)
                        .is_some_and(|rest| rest.is_empty() || rest.starts_with('.'))
                })
            });
        if !ours {
            break;
        }
        end = offset + line.len();
    }
    end
}

/// The package prefixes an import above a wrapper may name, each written as far as the dot that
/// makes it unambiguous.
const WRAPPER_PACKAGES: [&str; 2] = ["kotlinx.coroutines", "kotlin.concurrent"];

/// One recognised whole-program wrapper: what a model writes in front of the lambda, and whether
/// constructing it already runs it.
struct Head {
    /// The text that must stand where the wrapper starts.
    call: &'static str,
    /// Whether writing it is enough to run the body — `runBlocking` blocks and `thread` starts by
    /// default, while a bare `Thread` has to be told to.
    runs_itself: bool,
}

/// The constructors this dialect recognises, longest spelling first so a qualified call is matched
/// whole rather than as its unqualified tail.
///
/// A closed list rather than "anything with a trailing lambda", because the match is **anchored**:
/// the text between where the wrapper may start and the lambda's `{` is required to be one of these
/// and nothing else. Kotlin's trailing-lambda syntax makes `something { … }` an extremely common
/// shape — `rows.forEach { … }`, `runCatching { … }` — so without the anchor a program whose *last*
/// statement happened to be one would have every statement above it deleted, which is the one
/// failure this strategy must not have.
static WRAPPERS: [Head; 5] = [
    Head {
        call: "kotlinx.coroutines.runBlocking",
        runs_itself: true,
    },
    Head {
        call: "kotlin.concurrent.thread",
        runs_itself: true,
    },
    Head {
        call: "runBlocking",
        runs_itself: true,
    },
    Head {
        call: "thread",
        runs_itself: true,
    },
    Head {
        call: "Thread",
        runs_itself: false,
    },
];

/// The calls that run a wrapper once it has been constructed.
const RUNNERS: [&str; 4] = ["start", "run", "join", "get"];

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

/// `runBlocking { … }`, `thread { … }` or `Thread { … }.start()` as the whole program — one
/// expression, run where it is written, with no name.
fn match_immediate(
    text: &str,
    mask: &CodeMask,
    from: usize,
) -> Option<(AsyncWrapper, std::ops::Range<usize>)> {
    let (head, after_head) = wrapper_head(text, from)?;
    let (open, close) = lambda_body(text, mask, after_head)?;
    let (tail, ran) = strip_runners(text.get(close + 1..)?.trim_start());
    (tail.trim().is_empty() && (ran || head.runs_itself))
        .then_some((AsyncWrapper::Immediate, open + 1..close))
}

/// `val worker = Thread { … }` followed by exactly the calls that run it.
///
/// The trailing call is **required** whatever the head is, which is one thing this shape asks that
/// the immediate one does not: a `thread { … }` written where it stands has already started, but one
/// bound to a name and never started ran nothing, so unwrapping it would not repair a broken program
/// — it would execute statements the response never asked to execute.
fn match_declared(
    text: &str,
    mask: &CodeMask,
    from: usize,
) -> Option<(AsyncWrapper, std::ops::Range<usize>)> {
    // The blank line an import run leaves behind is skipped here rather than in `import_prefix`,
    // which reports where the *imports* ended; `wrapper_head` trims for itself and this is the one
    // reading that starts from a whole line.
    let rest = text.get(from..)?;
    let at = from + (rest.len() - rest.trim_start().len());
    let first = text.get(at..)?.lines().next()?;
    let declared = declared_name(first)?.to_string();
    let equals = at + first.find('=')?;
    let (_, after_head) = wrapper_head(text, equals + 1)?;
    let (open, close) = lambda_body(text, mask, after_head)?;
    let mut tail = text.get(close + 1..)?.trim_start();
    tail = tail.strip_prefix(';').unwrap_or(tail).trim_start();
    // `worker.start()`, then any number of further no-argument calls on the same name — `join()` is
    // the one a model writes, and requiring it would refuse the shape that leaves it off.
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
        let rest = rest.trim_start();
        ran |= call == "start" || call == "run";
        tail = rest.strip_prefix(';').unwrap_or(rest).trim_start();
    }
    (ran && tail.trim().is_empty()).then_some((AsyncWrapper::Declared, open + 1..close))
}

/// The [head](Head) standing at `from`, and the offset just past it and its optional argument list.
///
/// The argument list is optional because Kotlin's trailing-lambda syntax puts the block *outside*
/// the parentheses: `runBlocking(Dispatchers.Default) { … }` and `thread(start = false) { … }` are
/// both this shape, where the same wrapper in Java would have had the lambda inside the call.
fn wrapper_head(text: &str, from: usize) -> Option<(&'static Head, usize)> {
    let rest = text.get(from..)?.trim_start();
    let at = text.len() - rest.len();
    let head = WRAPPERS.iter().find(|head| {
        rest.strip_prefix(head.call)
            .is_some_and(|after| !after.starts_with(is_ident_char))
    })?;
    let mut after = at + head.call.len();
    let arguments = text.get(after..)?.trim_start();
    if arguments.starts_with('(') {
        let opened = text.len() - arguments.len();
        after = matching(text, opened, b'(', b')')? + 1;
    }
    Some((head, after))
}

/// The trailing chain of no-argument [runner](RUNNERS) calls at the front of `tail`, and whether one
/// of them actually started the wrapper: `.start()`, `.join();`, `.get()`.
fn strip_runners(tail: &str) -> (&str, bool) {
    let mut rest = tail;
    let mut ran = false;
    while let Some(after) = rest.strip_prefix('.') {
        let Some((call, after)) = identifier(after.trim_start()) else {
            break;
        };
        if !RUNNERS.contains(&call) {
            break;
        }
        let Some(after) = after.trim_start().strip_prefix("()") else {
            break;
        };
        let after = after.trim_start();
        ran |= call == "start" || call == "run";
        rest = after.strip_prefix(';').unwrap_or(after).trim_start();
    }
    (rest, ran)
}

/// The braces of the trailing `{ … }` lambda a wrapper was given, given the offset just past the
/// wrapper's head.
fn lambda_body(text: &str, mask: &CodeMask, from: usize) -> Option<(usize, usize)> {
    let rest = text.get(from..)?.trim_start();
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

/// The offset of the `close` that matches the `open` at `from`, counting every byte.
///
/// Used for a wrapper's **argument list**, which stands between the head and the lambda and is
/// therefore before anything a mask has been consulted about. A quote inside one is vanishingly rare
/// and a miscount can only make the match decline.
fn matching(text: &str, from: usize, open: u8, close: u8) -> Option<usize> {
    let mut depth = 0usize;
    for (index, byte) in text.bytes().enumerate().skip(from) {
        if byte == open {
            depth += 1;
        } else if byte == close {
            depth -= 1;
            if depth == 0 {
                return Some(index);
            }
        }
    }
    None
}

/// The wrapper's body, dedented by the common indentation of the lines that begin in code context.
///
/// A line that begins inside a raw string carries data rather than indentation, so it is left where
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

/// The unwrapped body with every `suspend` modifier deleted, and how many went.
///
/// This is the arm's own answer to a question every other one answers with zero, and it is a
/// **repair** rather than tidying: a `suspend fun` declared inside the wrapper can only be called
/// from a coroutine, so leaving the modifier behind would leave a program the compiler refuses at
/// the model's own line with `Suspend function … should be called only from a coroutine`. Deleting
/// the modifier is what makes the unwrapped program run.
///
/// It deletes the token **and the whitespace after it**, for the reason
/// [Python's `await`](super::super::python::healing) takes its own: deleting more is still deleting,
/// so the [invariant](crate::healing::Dialect) holds exactly, and what is left reads as a Kotlin
/// author would have written it.
///
/// The mask is rebuilt over the dedented body rather than reused, because dedenting moved every
/// offset the original one was indexed by. A body that no longer lexes is left exactly as it is,
/// which is the same decline every strategy here makes.
fn without_suspend(body: &str) -> (String, usize) {
    const SUSPEND: &str = "suspend";
    let Some(mask) = code_mask(body) else {
        return (body.to_string(), 0);
    };
    let mut out = String::with_capacity(body.len());
    let mut deleted = 0usize;
    let mut at = 0usize;
    for (index, character) in body.char_indices() {
        if index < at {
            continue;
        }
        let rest = &body[index..];
        let modifier = mask.is_code(index)
            && rest.starts_with(SUSPEND)
            && !body[..index].ends_with(is_ident_char)
            && rest[SUSPEND.len()..].starts_with(char::is_whitespace);
        if !modifier {
            out.push(character);
            at = index + character.len_utf8();
            continue;
        }
        deleted += 1;
        at = index + SUSPEND.len();
        while body[at..].starts_with([' ', '\t']) {
            at += 1;
        }
    }
    (out, deleted)
}

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

/// Whether `line` opens with `identifier(`, `a.b(` or `a.b.c(` — `println(`, `fs.readTextFile(`,
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
/// `None` means the source did not lex cleanly, and every strategy that needs the mask declines on
/// it. Four states end a scan uncleanly: an unterminated block comment, an unterminated raw string,
/// a string, character literal or backquoted name still open at a newline — which Kotlin forbids —
/// and a backslash with nothing after it.
///
/// Kotlin asks three things of a lexer that [Java's](super::super::java::healing) does not, and each
/// of them is a place a Java-shaped scan silently loses the source:
///
/// * **string templates.** `"total: ${rows["n"]}"` is one string, and a scan that stopped at the
///   quote before `n` would read the rest of the line as code — so a `${…}` is followed through with
///   a brace counter, nested strings and all, and its contents are marked **code** because they are.
/// * **nested block comments.** `/* a /* b */ c */` is one comment in Kotlin and two in Java, and
///   reading it Java's way leaves ` c */` behind as code.
/// * **backquoted identifiers.** The bytes between backticks may hold a brace or the word `import`
///   and mean neither.
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
