//! **Swift's [healing dialect](crate::healing::Dialect)** — the lexical half of
//! [response healing](crate::healing), answered in Swift's own terms.
//!
//! Three of its answers are worth naming before the code, because each of them is the same rule
//! reading a grammar the other arms do not have.
//!
//! **Nothing is done about an import, and this is the second arm where that is because the line
//! works.** [Rust](super::super::rust::healing) is the first. A program here is a whole *top-level
//! file* rather than a function body, `import` is a file-scope declaration Swift admits **anywhere**
//! in one — measured, not assumed: an `import Foundation` written half way down a file resolves for
//! the whole file — and every module of this arm's
//! [library set](super::compile::library_modules) is on the search path the program is compiled
//! with. So a model's `import Collections` is a line that does what the model meant, and deleting it
//! would be deleting work. A module that is *not* in the set is a located `error: no such module` on
//! the turn that wrote it, which is a better answer than a silent deletion.
//!
//! **The redeclaration proof rests on almost every declaration Swift has**, which is the opposite of
//! the Rust arm's answer and the reason the two are worth reading together. Rust shadows, so a second
//! `let` of one name is ordinary and the proof there had to retreat to items. Swift does not: a
//! second `let`, `var`, `func`, `struct`, `class`, `enum`, `actor`, `protocol` or `typealias` of one
//! name at one scope is *invalid redeclaration of …*, refused before a statement runs. That is
//! exactly the proof
//! [`drop-duplicate-program`](crate::healing::HealingStrategy::DropDuplicateProgram) needs, and it
//! makes this arm's version of that strategy the widest of any registered language's. `import` is
//! the one declaration excluded, because writing one twice is legal — and `extension`, because an
//! `extension` declares no name of its own and a type may have as many as it likes.
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
//! # The concurrency wrapper
//!
//! One shape: `Task { … }` as the whole program, named or not. It is a **measured** failure rather
//! than an assumed one — the artifact compiles, and then the body never runs, because a component's
//! `run` export returns as soon as the top-level code does and there is no executor left to drain the
//! task on. That is the worst failure shape there is: a clean turn over a program that did nothing.
//! So the wrapper comes off and the `await`s it implied go with it, which is what turns a silently
//! empty turn into the straight-line program the model meant.
//!
//! What is deliberately **not** recognised is `async let`, `withTaskGroup` and every other structured
//! form. Each of those is written *inside* an async context rather than being one, so a program made
//! of one is a program the compiler already refuses by name — and a strategy that deleted the
//! surrounding wrapper would leave the refusal in place with fewer lines around it.
//!
//! The `import` lines above a wrapper are **kept**, which is [Rust's answer](super::super::rust::healing)
//! reached from the same fact: they resolve where they are written and gg has nothing to gain by
//! deleting a line that works.
//!
//! # None of these is a parser
//!
//! Not one predicate here parses, for the reason every other dialect gives: healing runs on text that
//! is not yet known to be a program — it may be Markdown, prose, or two programs pasted together — so
//! a parser would fail on precisely the inputs healing exists to repair. `swiftc` is downstream of all
//! of this and is what actually reads the program; every answer here is a lexical shape test with its
//! errors pointed in the safe direction, and every one of them **declines** rather than guessing when
//! it cannot tell.

use crate::healing::{
    AsyncWrapper, CodeMask, Dialect, Unwrapped, common_prefix, lines_with_offsets,
};

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

    /// **`false`, always** — the second arm to answer so, and for
    /// [Rust's reason](super::super::rust::healing) rather than for want of a loader.
    ///
    /// A program here is a whole top-level file, and Swift admits an `import` anywhere in one. So
    /// `import Collections` written half way down a program brings the module into scope for the
    /// whole file, resolved against the same search path the program is compiled with. There is
    /// nothing to hoist and nothing to delete. gg's own surface needs no import either — the shell
    /// re-exports it into the model's file — so the line a model is most likely to write out of habit
    /// (`import gg`) is legal, redundant and harmless rather than something to repair.
    fn is_import_statement(&self, _line: &str) -> bool {
        false
    }

    /// Whether the repeated tail declares a name Swift refuses to see twice at one scope — the proof
    /// that the reply as sent could not have compiled and therefore ran nothing.
    ///
    /// The widest of any registered arm's, and deliberately so: see [`declares_lexically`].
    fn declares_a_redeclarable_binding(&self, text: &str, mask: &CodeMask, base: usize) -> bool {
        declares_lexically(text, mask, base).next().is_some()
    }

    /// `Task { … }` as the whole program ([`Immediate`](AsyncWrapper::Immediate)), and
    /// `let handle = Task { … }` followed by a wait on it ([`Declared`](AsyncWrapper::Declared)) —
    /// with any `import` lines above either kept.
    ///
    /// [`awaits`](Unwrapped::awaits) counts the `await`s deleted from the body, which in Swift is a
    /// **prefix** on the expression rather than a postfix on it.
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
/// code span (`` Use `view.openText` to show yourself a value ``) is the single most common prose
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
// Redeclaration
// ---------------------------------------------------------------------------------------------

/// The keywords that open a declaration whose name the compiler refuses to see **twice** at one
/// scope.
///
/// Measured against `swiftc` rather than reasoned about: a second `let`, `var`, `func`, `struct`,
/// `class`, `enum`, `actor`, `protocol` or `typealias` of one name in one file is *invalid
/// redeclaration of …*, and it stops the build before a statement runs — which is exactly the proof
/// [`drop-duplicate-program`](crate::healing::HealingStrategy::DropDuplicateProgram) needs.
///
/// **`let` and `var` are here**, and that is the sharpest divergence from
/// [Rust's](super::super::rust::healing) list, which had to leave its `let` out because Rust shadows.
/// Swift does not shadow at one scope, so the everyday duplicated program — the one made of nothing
/// but bindings and calls — is provably refused here where it would have run there.
///
/// `import` is excluded because writing one twice is legal, and `extension` because it declares no
/// name of its own: a type may carry as many as an author likes, which is how this arm binds a code
/// module in the first place.
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
/// mean a declaration goes unrecognised, and an unrecognised declaration means
/// `drop-duplicate-program` declines, which is the safe direction.
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

/// Every declaration `text` makes at its **top level**, in source order.
///
/// "Top level" is read as *unindented*, which is what a top-level declaration is in every program a
/// model writes and what keeps this from mistaking a declaration inside a type, an `extension` or a
/// function body — legal, and legal twice, because it is a different scope — for a redeclaration.
/// `base` is where `text` starts inside the source `mask` was built over, so a caller may ask about a
/// slice of it.
///
/// The reading is: an optional run of [modifiers](DECLARATION_MODIFIERS), one
/// [declaration keyword](DECLARATION_KEYWORDS), and then a name.
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
    let (keyword, after) = declaration_keyword(line.trim())?;
    let _ = keyword;
    identifier(after.trim_start()).map(|(name, _)| name)
}

/// The declaration keyword `text` opens with once its modifiers are consumed, and what follows it.
///
/// Shared with [the module namespacer](super::source), which asks the same question of a code
/// module's own lines and answers a different one with it: one reading of what opens a Swift
/// declaration, used by everything here that needs it.
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
// The concurrency wrapper
// ---------------------------------------------------------------------------------------------

/// Take the concurrency wrapper off a program that is entirely made of one, keeping the imports
/// above it and deleting the `await`s inside it.
fn unwrap_async(text: &str, mask: &CodeMask) -> Option<Unwrapped> {
    let (prefix, body_start) = import_prefix(text, mask);
    let (wrapper, body) = match_wrapper(text, mask, body_start)?;
    let inner = dedented(text, mask, body);
    let (inner, awaits) = without_await(&inner);
    let program = match prefix.trim().is_empty() {
        true => inner,
        false => format!("{}\n\n{inner}", prefix.trim_end()),
    };
    Some(Unwrapped {
        wrapper,
        text: program,
        awaits,
    })
}

/// The leading run of `import` lines and blank lines, and the offset the wrapper may start at.
///
/// They are **kept** rather than deleted, which is [Rust's answer](super::super::rust::healing) and
/// reached from the same fact: an `import` of this arm's library set resolves where it stands, so
/// deleting one would delete a line that works.
fn import_prefix<'a>(text: &'a str, mask: &CodeMask) -> (&'a str, usize) {
    let mut end = 0usize;
    for (offset, line) in lines_with_offsets(text) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let indent = line.len() - line.trim_start().len();
        let import = mask.is_code(offset + indent) && keyword(trimmed, "import").is_some();
        if !import {
            break;
        }
        end = offset + line.len();
    }
    (&text[..end], end)
}

/// The heads this dialect recognises as a whole-program wrapper, longest spelling first so a
/// qualified spelling is matched whole rather than as its unqualified prefix.
///
/// A closed list rather than "anything followed by a trailing closure", because the match is
/// **anchored**: the text between where the wrapper may start and the closure's `{` is required to be
/// one of these and nothing else. Swift is full of calls that take a trailing closure —
/// `rows.map { … }`, `withUnsafePointer { … }` — so without the anchor a program whose *last*
/// statement happened to be one would have every statement above it deleted, which is the one failure
/// this strategy must not have.
const WRAPPERS: [&str; 3] = ["Task.detached", "Task.init", "Task"];

/// The property and method a program reads to wait on a declared task, with the `await` that must
/// stand in front of either already consumed.
const RUNNERS: [&str; 2] = ["value", "result"];

/// The wrapper `text` is entirely made of from `from` onwards, and the byte range of its body between
/// the closure's braces.
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

/// `Task { … }` as the whole program — one expression, with no name and nothing after it.
fn match_immediate(
    text: &str,
    mask: &CodeMask,
    from: usize,
) -> Option<(AsyncWrapper, std::ops::Range<usize>)> {
    let (open, close, after) = task_call(text, mask, from)?;
    let tail = text.get(after..)?.trim_start();
    let tail = tail.strip_prefix(';').unwrap_or(tail);
    tail.trim()
        .is_empty()
        .then_some((AsyncWrapper::Immediate, open + 1..close))
}

/// `let handle = Task { … }` followed by exactly a wait on it — `await handle.value`, or the same
/// discarded with `_ =`, or wrapped in a `try`.
///
/// The trailing wait is **required**, which is one thing this shape asks that the immediate one does
/// not: a handle a program never touches is a program whose author may have meant something else
/// entirely, and declining costs nothing but a repair that was not certain.
fn match_declared(
    text: &str,
    mask: &CodeMask,
    from: usize,
) -> Option<(AsyncWrapper, std::ops::Range<usize>)> {
    let rest = text.get(from..)?;
    let at = from + (rest.len() - rest.trim_start().len());
    let first = text.get(at..)?.lines().next()?;
    let bound = binding_name_of(first)?.to_string();
    let equals = at + first.find('=')?;
    let (open, close, after) = task_call(text, mask, equals + 1)?;
    let mut tail = text.get(after..)?.trim_start();
    tail = tail.strip_prefix(';').unwrap_or(tail).trim_start();
    // `_ = await handle.value`, `try await handle.value`, `await handle.value` — the prefixes a wait
    // may carry, consumed in whatever order they were written.
    loop {
        let stripped = ["_", "=", "try", "await"]
            .iter()
            .find_map(|token| strip_token(tail, token));
        match stripped {
            Some(rest) => tail = rest.trim_start(),
            None => break,
        }
    }
    let after_name = tail
        .strip_prefix(bound.as_str())
        .filter(|rest| !rest.starts_with(is_ident_char))?
        .trim_start();
    let runner = after_name
        .strip_prefix('.')
        .and_then(|rest| identifier(rest.trim_start()))
        .filter(|(name, _)| RUNNERS.contains(name))?;
    let stripped = runner.1.trim_start();
    // `handle.result` and `handle.value` are properties; `handle.value()` is not a thing anyone
    // writes, so an empty argument list is accepted and nothing else is.
    let stripped = match stripped.strip_prefix("()") {
        Some(rest) => rest,
        None => stripped,
    };
    let stripped = stripped.trim_start();
    let stripped = stripped.strip_prefix(';').unwrap_or(stripped);
    stripped
        .trim()
        .is_empty()
        .then_some((AsyncWrapper::Declared, open + 1..close))
}

/// `text` with `token` taken off its front, when it stands there at a token boundary.
fn strip_token<'a>(text: &'a str, token: &str) -> Option<&'a str> {
    let rest = text.strip_prefix(token)?;
    let boundary = match token.chars().next() {
        Some(first) if is_ident_start(first) => !rest.starts_with(is_ident_char),
        _ => true,
    };
    boundary.then_some(rest)
}

/// The name a `let` or `var` binds on `line`, when the line is a plain `let name = …`.
fn binding_name_of(line: &str) -> Option<&str> {
    let rest = keyword(line.trim(), "let")
        .or_else(|| keyword(line.trim(), "var"))?
        .trim_start();
    identifier(rest).map(|(name, _)| name)
}

/// The `Task { … }` standing at `from`: where its body opens and closes, and the offset just past its
/// closing brace.
///
/// The closure is a **trailing** one, which is where Swift puts it and where
/// [Rust's](super::super::rust::healing) is not — so this reads `head` `{` body `}` rather than a
/// head, a parenthesis and a closure inside it. A leading `(priority:)` argument list is accepted and
/// skipped, because `Task(priority: .high) { … }` is a shape a model writes.
fn task_call(text: &str, mask: &CodeMask, from: usize) -> Option<(usize, usize, usize)> {
    let rest = text.get(from..)?.trim_start();
    let at = text.len() - rest.len();
    let head = WRAPPERS.iter().find(|head| {
        rest.strip_prefix(**head)
            .is_some_and(|after| !after.starts_with(is_ident_char) && !after.starts_with('.'))
    })?;
    let mut rest = text.get(at + head.len()..)?.trim_start();
    if let Some(after) = rest.strip_prefix('(') {
        // A miscount here can only make the match decline, and no argument a model passes `Task`
        // carries a nested parenthesis.
        let end = after.find(')')?;
        rest = after[end + 1..].trim_start();
    }
    if !rest.starts_with('{') {
        return None;
    }
    let open = text.len() - rest.len();
    let close = matching_brace(text, mask, open)?;
    Some((open, close, close + 1))
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
/// A line that begins inside a multi-line string carries data rather than indentation, so it is left
/// where the model put it — which is the whole reason this consults the mask instead of trimming
/// every line, and it matters here because `"""` is a shape a Swift author reaches for constantly.
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

/// The unwrapped body with every `await` deleted, and how many went.
///
/// Swift marks suspension **in front of** the expression rather than after it, so what comes off is
/// the keyword and the space behind it. It is a repair rather than tidying: an `await` outside an
/// async context is *'async' call in a function that does not support concurrency* at the model's own
/// line, so leaving one behind would leave the one part of the repaired program that still fails.
///
/// The mask is rebuilt over the dedented body rather than reused, because dedenting moved every
/// offset the original one was indexed by. A body that no longer lexes is left exactly as it is,
/// which is the same decline every strategy here makes.
fn without_await(body: &str) -> (String, usize) {
    const AWAIT: &str = "await";
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
        // A keyword at both ends: `awaiting` is not one, and neither is `reawait`.
        let opens = index == 0 || !body[..index].chars().next_back().is_some_and(is_ident_char);
        let suspension = mask.is_code(index)
            && opens
            && rest.starts_with(AWAIT)
            && rest[AWAIT.len()..].starts_with(char::is_whitespace);
        if !suspension {
            out.push(character);
            at = index + character.len_utf8();
            continue;
        }
        deleted += 1;
        // The keyword and exactly the one space behind it, so `await foo()` becomes `foo()` and an
        // `await` at the end of a line takes its newline with it rather than leaving a ragged one.
        at = index + AWAIT.len() + 1;
    }
    (out, deleted)
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
/// of something that is then shaped like a call gets both: `try view.openText(…)` is code and `try
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

/// Whether `line` opens with `name(`, `a.b(` or `name {` — `view.openText(`, `entries.map {`.
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

/// The rest of `text` when it opens with `word` at an identifier boundary.
fn keyword<'a>(text: &'a str, word: &str) -> Option<&'a str> {
    text.strip_prefix(word)
        .filter(|rest| rest.starts_with(|c: char| c.is_whitespace()))
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
/// the one reading [the module namespacer](super::source) shares.
///
/// `None` means the source did not lex cleanly, and every strategy that needs the mask declines on
/// it. Four states end a scan uncleanly: an unterminated block comment, an unterminated string of any
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
