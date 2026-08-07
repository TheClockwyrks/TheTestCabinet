//! **Rust's [healing dialect](crate::healing::Dialect)** — the lexical half of
//! [response healing](crate::healing), answered in Rust's own terms.
//!
//! Three of its answers are ones no other registered arm gives, and every one of them is the same
//! rule reading a different grammar.
//!
//! **`let` is not part of the redeclaration proof.** On every other arm the keyword that opens a
//! binding is the whole of that proof — a second `const`, `val`, `def` or `let` of one name is
//! refused before a statement runs, which is exactly what
//! [`drop-duplicate-program`](crate::healing::HealingStrategy::DropDuplicateProgram) needs. Rust
//! **shadows**: `let total = 1; let total = 2;` is ordinary, deliberate, everyday Rust, and a
//! duplicated program made only of `let`s and calls runs its work twice rather than being refused.
//! So the proof here rests on *items* instead — `fn`, `struct`, `enum`, `union`, `trait`, `type`,
//! `const`, `static`, `mod`, each of which is `E0428` twice in one block — and on `use`, which is
//! `E0252`. Both were measured against `rustc` rather than reasoned about. A duplicated program with
//! no item and no import in it declines, which is the honest answer: it would have run.
//!
//! **Nothing is done about an import, and nothing needs to be.** Every other arm either deletes the
//! model's `import` lines (they have no loader) or hoists them somewhere they resolve (the JVM
//! arms). Rust needs neither: a program here is a function body, Rust admits an **item** wherever a
//! statement may stand, and `use std::collections::HashMap;` therefore resolves exactly where the
//! model wrote it against the same extern prelude the program is compiled with. This is the one arm
//! where [`is_import_statement`] answers `false` because the line *works*, rather than because gg
//! moved it.
//!
//! **The lexer has to tell a character literal from a lifetime.** `'a'` is a `char` and `'a` is a
//! lifetime, and they open with the same byte — a hazard no other arm's `'` carries. A scan that
//! read the `'` of `&'static str` as an opening quote would swallow the rest of the program into a
//! string and every strategy that consults the mask would then be reading the wrong text. So a `'`
//! here is a literal **only** when what follows it is one character and then a closing `'`
//! ([`char_literal_end`]), and anything else is ordinary code. That rule has a second effect worth
//! having: an apostrophe in a stray line of English (`don't`) is code punctuation rather than an
//! unterminated literal, so a reply with prose around its program still lexes, where the same
//! apostrophe declines [Kotlin's](super::super::kotlin::healing) whole mask.
//!
//! # What its strings ask that no C-shaped arm's do
//!
//! A Rust string literal may **span newlines**, so a `"` still open at a `\n` is not evidence of a
//! lexer that has lost its place — which is the opposite of Java's and Kotlin's, where the same
//! state is what makes an apostrophe in prose decline the mask. And a **raw** string carries its own
//! fence: `r"…"`, `r#"…"#`, `r##"…"##`, with `b` and `c` prefixes in front of any of them. The
//! fence has to be counted, because the bytes inside `r#"…"#` may hold a `"` and mean nothing by it.
//!
//! # The concurrency wrapper
//!
//! One shape, and it is a **measured** failure rather than an assumed one: `std::thread::spawn`
//! compiles for `wasm32-unknown-unknown` and then panics at run time, because that target has no
//! threads and `spawn` unwraps the `Unsupported` its builder returns. With this arm's
//! [panic hook](super::source) the model is told `panicked: failed to spawn thread` at the line it
//! wrote — which is a clear diagnostic and still a lost turn, so the repair is worth making.
//!
//! What is deliberately **not** recognised is every `async` shape: `block_on(async { … })` needs
//! `futures` or `tokio`, neither of which is in this arm's
//! [library set](super::compile), so a program that reaches for one gets `E0433` naming the crate
//! before it runs. That is already the best diagnostic available, and a healing strategy that
//! deleted the wrapper would replace it with a program full of `.await`s in a body that is not
//! `async`.
//!
//! The `use` lines above a wrapper are **kept**, which is [Java's answer](super::super::java::healing)
//! and not [Kotlin's](super::super::kotlin::healing), reached from this arm's own library set:
//! `std::thread` is in it, the line resolves, and gg has already silenced the unused-import warning
//! — so deleting it would be deleting a line that works.
//!
//! # None of these is a parser
//!
//! Not one predicate here parses, for the reason every other dialect gives: healing runs on text that
//! is not yet known to be a program — it may be Markdown, prose, or two programs pasted together — so
//! a parser would fail on precisely the inputs healing exists to repair. `rustc` is downstream of all
//! of this and is what actually reads the program; every answer here is a lexical shape test with its
//! errors pointed in the safe direction, and every one of them **declines** rather than guessing when
//! it cannot tell.

use crate::healing::{
    AsyncWrapper, CodeMask, Dialect, Unwrapped, common_prefix, lines_with_offsets,
};

/// Rust's dialect. A unit struct: everything it "holds" is the `const` data below.
pub(in crate::sandbox::language) struct RustDialect;

/// The one instance, held by [`Rust`](super::Rust) and handed out as `&'static dyn Dialect`.
pub(in crate::sandbox::language) static RUST_DIALECT: RustDialect = RustDialect;

impl Dialect for RustDialect {
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

    /// **`false`, always** — and this is the one arm that answers so because the import *works*.
    ///
    /// A program here is the body of a function gg declares, and Rust admits an item wherever a
    /// statement may stand: `use std::collections::HashMap;` written half way down a program brings
    /// `HashMap` into scope for the whole block, resolved against the same extern prelude the
    /// program is compiled with. There is nothing to hoist and nothing to delete. A `use` naming
    /// something outside this arm's library set is a located `E0432` on the turn that wrote it,
    /// which is a better answer than a silent deletion — and `use gg::…` is not even that, since
    /// Rust lets an explicit `use` shadow the glob gg wrote above the program.
    fn is_import_statement(&self, _line: &str) -> bool {
        false
    }

    /// Whether the repeated tail declares an **item** or imports a name — the proof that the reply
    /// as sent could not have compiled and therefore ran nothing.
    ///
    /// Narrower than every other arm's in the one place it matters: a `let` is **not** a
    /// declaration for this purpose, because Rust shadows. See [`declares_lexically`].
    fn declares_a_redeclarable_binding(&self, text: &str, mask: &CodeMask, base: usize) -> bool {
        declares_lexically(text, mask, base).next().is_some()
    }

    /// `std::thread::spawn(|| { … })` as the whole program
    /// ([`Immediate`](AsyncWrapper::Immediate)), and `let handle = std::thread::spawn(|| { … });`
    /// followed by `handle.join()…` ([`Declared`](AsyncWrapper::Declared)) — with any `use` lines
    /// above either kept.
    ///
    /// [`awaits`](Unwrapped::awaits) counts the `.await`s deleted from the body, which is Rust's
    /// suspension token in the one place it lives: after the expression rather than in front of it.
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
/// `text`, `bash` or `toml` is context the model showed rather than the program, and tier 3 of the
/// candidacy ladder is what keeps the closed list from being a trap.
const PROGRAM_TAGS: &[&str] = &["rust", "rs"];

/// The statement and declaration keywords a line of Rust code may open with, matched
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
/// **`use` is the one exclusion, and it is this arm's own.** Every other keyword here is a word no
/// English sentence opens with; `use` is a verb, and "Use `view::open_text` to show yourself a
/// value" is the single most common lead-in a model writes — gg's own system prompt writes it four
/// times. Listing it would make that line un-deletable as prose, which costs a turn, and would buy
/// nothing: every real `use` line ends in a `;`, which clause 1 reads anyway.
///
/// What is otherwise left out is the set of words that open no statement at all — `as`, `in`,
/// `where`, `dyn`, `ref`, `mut`, `move`, `self`, `super`, `crate` are operators, type-position words
/// or path segments, so listing them would buy nothing in the first reading and cost a great deal of
/// English in the second.
const STATEMENT_KEYWORDS: [&str; 24] = [
    "if", "else", "for", "while", "loop", "match", "return", "break", "continue", "let", "fn",
    "struct", "enum", "union", "trait", "impl", "mod", "pub", "const", "static", "type", "unsafe",
    "extern", "async",
];

/// The tokens a line of code may end with — a block opened or closed, a statement terminated, a
/// collection left open, or an expression continued onto the next line.
const CODE_ENDINGS: [&str; 13] = [
    ";", "{", "}", ",", "(", "[", "->", "=>", "&&", "||", "+", "=", ":",
];

/// Characters no line of English prose contains.
///
/// The backtick is **absent**, which is [Java's answer](super::super::java::healing) rather than
/// [Kotlin's](super::super::kotlin::healing): Rust has no backtick anywhere in its grammar — not a
/// string, not a quoted identifier, since a Rust identifier that needs escaping is written `r#type`
/// — so a line carrying one is certainly not Rust, and a lead-in written with an inline code span
/// may be deleted.
///
/// `#` is **absent** for the same reason it is on every other C-shaped arm, and in spite of `#[…]`
/// being real Rust punctuation: an attribute always carries a `[` and a `]`, both of which are on
/// this list, so nothing is lost by leaving `#` off — and leaving it on would make a Markdown
/// `# Heading` un-deletable as prose.
const NON_PROSE_CHARS: [char; 14] = [
    ';', '{', '}', '(', ')', '[', ']', '=', '<', '>', '|', '&', '$', '\\',
];

// ---------------------------------------------------------------------------------------------
// Redeclaration
// ---------------------------------------------------------------------------------------------

/// The keywords that open an **item** whose name the compiler refuses to see twice in one block.
///
/// Measured against `rustc` rather than reasoned about: a second `fn`, `struct`, `enum`, `union`,
/// `trait`, `type`, `const`, `static` or `mod` of one name in a block is `E0428`, *the name … is
/// defined multiple times*, and it stops the build before a statement runs — which is exactly the
/// proof [`drop-duplicate-program`](crate::healing::HealingStrategy::DropDuplicateProgram) needs.
///
/// **`let` is not here**, and its absence is this dialect's sharpest divergence. Rust shadows: a
/// second `let` of one name is legal, idiomatic and extremely common, so a duplicated program made
/// only of `let`s and calls is a program that runs its work twice rather than one the compiler
/// refuses. Reading a `let` as a redeclaration would let this strategy delete work the model asked
/// to have done.
///
/// `impl` is not here either, for a different reason: it declares no name of its own.
const ITEM_KEYWORDS: [&str; 9] = [
    "fn", "struct", "enum", "union", "trait", "type", "const", "static", "mod",
];

/// Every modifier that may stand in front of one of those, and nothing else.
///
/// A **closed** list, read left to right and stopping at the first word that is not on it — so an
/// ordinary identifier ends the run rather than being read as part of it. Being wrong here can only
/// mean an item goes unrecognised, and an unrecognised item means `drop-duplicate-program` declines,
/// which is the safe direction.
const ITEM_MODIFIERS: [&str; 4] = ["unsafe", "async", "extern", "default"];

/// Every declaration `text` makes at its **top level**, in source order.
///
/// "Top level" is read as *unindented*, which is what a top-level statement is in every program a
/// model writes and what keeps this from mistaking an item inside a nested block, an `impl` or a
/// `mod` — legal, and legal twice, because it is a different scope — for a redeclaration. `base` is
/// where `text` starts inside the source `mask` was built over, so a caller may ask about a slice of
/// it.
///
/// The reading is: an optional `pub` with its optional restriction, an optional run of
/// [modifiers](ITEM_MODIFIERS), one [item keyword](ITEM_KEYWORDS), and then a name — or a `use` that
/// imports exactly one name, which is `E0252` twice.
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
/// A `use` answers with `use`, which is not a name and is not meant to be read as one: the caller
/// asks only *whether* something was declared, and a fixed slice is the cheapest way to say "yes,
/// and reading which name out of a path is not this function's job".
fn declared_name(line: &str) -> Option<&str> {
    let mut rest = line.trim();
    if let Some(after) = keyword(rest, "use") {
        return imports_one_name(after).then_some("use");
    }
    // `pub`, `pub(crate)`, `pub(super)`, `pub(in …)`.
    if let Some(after) = rest.strip_prefix("pub") {
        let after = match after.strip_prefix('(') {
            Some(inner) => inner.split_once(')')?.1,
            None => after,
        };
        rest = after.strip_prefix(char::is_whitespace)?.trim_start();
    }
    loop {
        let (word, after) = identifier(rest)?;
        let trimmed = after.trim_start();
        // `const` is both an item keyword and a modifier: `const K: u32 = 1` declares `K`, while
        // `const fn helper()` declares `helper`. What follows it decides which.
        let modifier = ITEM_MODIFIERS.contains(&word)
            || (word == "const" && identifier(trimmed).is_some_and(|(next, _)| next == "fn"));
        if !modifier && ITEM_KEYWORDS.contains(&word) {
            return identifier(trimmed).map(|(name, _)| name);
        }
        if !modifier {
            return None;
        }
        // A modifier and what follows it are separated by whitespace; `async_reader` is a name.
        if trimmed.len() == after.len() {
            return None;
        }
        rest = trimmed;
    }
}

/// Whether a `use`'s tail imports exactly one name, so that writing it twice is refused.
///
/// A **glob** (`use std::fmt::*;`) and an anonymous import (`use std::io::Write as _;`) are the two
/// that may legally be written twice, and both are excluded — reading either as a redeclaration
/// would let `drop-duplicate-program` delete a program that would have run.
fn imports_one_name(tail: &str) -> bool {
    let path = tail.trim().trim_end_matches(';').trim_end();
    !path.is_empty() && !path.ends_with('*') && !path.ends_with("as _")
}

// ---------------------------------------------------------------------------------------------
// The concurrency wrapper
// ---------------------------------------------------------------------------------------------

/// Take the concurrency wrapper off a program that is entirely made of one, keeping the imports
/// above it and deleting the `.await`s inside it.
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

/// The leading run of `use` lines and blank lines, and the offset the wrapper may start at.
///
/// They are **kept** rather than deleted, which is [Java's answer](super::super::java::healing) and
/// the opposite of [Kotlin's](super::super::kotlin::healing), and the difference is this arm's
/// library set rather than its family: `std::thread` is in it, so `use std::thread;` resolves, and
/// an import left unused is a warning gg has already silenced with `-Awarnings`. Deleting a line
/// that works would be deleting more than the repair needs.
fn import_prefix<'a>(text: &'a str, mask: &CodeMask) -> (&'a str, usize) {
    let mut end = 0usize;
    for (offset, line) in lines_with_offsets(text) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let indent = line.len() - line.trim_start().len();
        let import = mask.is_code(offset + indent)
            && keyword(trimmed, "use").is_some()
            && trimmed.ends_with(';');
        if !import {
            break;
        }
        end = offset + line.len();
    }
    (&text[..end], end)
}

/// The calls this dialect recognises as a whole-program wrapper, longest spelling first so a
/// qualified call is matched whole rather than as its unqualified tail.
///
/// A closed list rather than "anything taking a closure", because the match is **anchored**: the
/// text between where the wrapper may start and the closure's `{` is required to be one of these and
/// nothing else. Rust is full of calls that take a closure — `iter().map(|row| { … })`,
/// `unwrap_or_else(|| { … })` — so without the anchor a program whose *last* statement happened to
/// be one would have every statement above it deleted, which is the one failure this strategy must
/// not have.
const WRAPPERS: [&str; 2] = ["std::thread::spawn", "thread::spawn"];

/// The no-argument calls that may trail a wrapper: waiting on it, and unwrapping what the wait
/// returned.
const RUNNERS: [&str; 4] = ["join", "unwrap", "expect", "ok"];

/// The wrapper `text` is entirely made of from `from` onwards, and the byte range of its body
/// between the closure's braces.
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

/// `std::thread::spawn(|| { … }).join().unwrap();` as the whole program — one expression, run where
/// it is written, with no name.
fn match_immediate(
    text: &str,
    mask: &CodeMask,
    from: usize,
) -> Option<(AsyncWrapper, std::ops::Range<usize>)> {
    let (open, close, after) = spawn_call(text, mask, from)?;
    let tail = strip_runners(text.get(after..)?.trim_start());
    let tail = tail.strip_prefix(';').unwrap_or(tail);
    tail.trim()
        .is_empty()
        .then_some((AsyncWrapper::Immediate, open + 1..close))
}

/// `let handle = std::thread::spawn(|| { … });` followed by exactly the calls that wait on it.
///
/// The trailing chain is **required**, which is one thing this shape asks that the immediate one
/// does not: a handle a program never touches is a program whose author may have meant something
/// else entirely, and declining costs nothing but a repair that was not certain.
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
    let (open, close, after) = spawn_call(text, mask, equals + 1)?;
    let mut tail = text.get(after..)?.trim_start();
    tail = tail.strip_prefix(';').unwrap_or(tail).trim_start();
    let after_name = tail
        .strip_prefix(bound.as_str())
        .filter(|rest| !rest.starts_with(is_ident_char))?
        .trim_start();
    let stripped = strip_runners(after_name);
    // A runner must actually have been consumed: `let handle = spawn(…); handle;` is a program that
    // never waited on anything, and unwrapping it would be a guess rather than a repair.
    if stripped.len() == after_name.len() {
        return None;
    }
    let stripped = stripped.strip_prefix(';').unwrap_or(stripped);
    stripped
        .trim()
        .is_empty()
        .then_some((AsyncWrapper::Declared, open + 1..close))
}

/// The name a `let` binds on `line`, when the line is a plain `let name = …`.
///
/// Deliberately not [`declared_name`], which answers about *items* and says nothing about a `let` —
/// this is the one place in the dialect that has to read one, because a declared wrapper is bound to
/// a name the trailing call then uses.
fn binding_name_of(line: &str) -> Option<&str> {
    let rest = keyword(line.trim(), "let")?.trim_start();
    let rest = match keyword(rest, "mut") {
        Some(after) => after.trim_start(),
        None => rest,
    };
    identifier(rest).map(|(name, _)| name)
}

/// The `spawn(|| { … })` call standing at `from`: where its body opens and closes, and the offset
/// just past the call's closing parenthesis.
///
/// The closure is **inside** the parentheses, which is where Rust puts it and where
/// [Kotlin's](super::super::kotlin::healing) trailing lambda is not — so this reads
/// `head` `(` `move`? `||` `{` body `}` `)` rather than a head followed by a block.
fn spawn_call(text: &str, mask: &CodeMask, from: usize) -> Option<(usize, usize, usize)> {
    let rest = text.get(from..)?.trim_start();
    let at = text.len() - rest.len();
    let head = WRAPPERS.iter().find(|head| {
        rest.strip_prefix(**head)
            .is_some_and(|after| !after.starts_with(is_ident_char))
    })?;
    let after_head = text.get(at + head.len()..)?.trim_start();
    let rest = after_head.strip_prefix('(')?.trim_start();
    // `move ||` and `move||` are both what a Rust author writes, so the boundary is "not an
    // identifier character" rather than "whitespace".
    let rest = match rest
        .strip_prefix("move")
        .filter(|after| !after.starts_with(is_ident_char))
    {
        Some(after) => after.trim_start(),
        None => rest,
    };
    let rest = rest.strip_prefix("||")?.trim_start();
    if !rest.starts_with('{') {
        return None;
    }
    let open = text.len() - rest.len();
    let close = matching_brace(text, mask, open)?;
    let after = text.get(close + 1..)?.trim_start().strip_prefix(')')?;
    Some((open, close, text.len() - after.len()))
}

/// The trailing chain of no-argument [runner](RUNNERS) calls at the front of `tail`, and what is
/// left after it: `.join()`, `.unwrap()`, `.expect("worker panicked")`.
fn strip_runners(tail: &str) -> &str {
    let mut rest = tail;
    while let Some(after) = rest.strip_prefix('.') {
        let Some((call, after)) = identifier(after.trim_start()) else {
            break;
        };
        if !RUNNERS.contains(&call) {
            break;
        }
        let after = after.trim_start();
        let Some(after) = after.strip_prefix('(') else {
            break;
        };
        // `expect` takes a message, so the argument list is skipped whole rather than required to be
        // empty. It cannot carry a nested parenthesis in any shape a model writes here, and a
        // miscount can only make the match decline.
        let Some(end) = after.find(')') else {
            break;
        };
        rest = after[end + 1..].trim_start();
    }
    rest
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
/// A line that begins inside a raw string carries data rather than indentation, so it is left where
/// the model put it — which is the whole reason this consults the mask instead of trimming every
/// line, and it matters more here than on an arm whose strings cannot span a newline.
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

/// The unwrapped body with every `.await` deleted, and how many went.
///
/// Rust marks suspension **after** the expression rather than in front of it, so what comes off is
/// the whole postfix — the dot included, because `foo().await` without it is `foo().` and not a
/// program. It is a repair rather than tidying: an `.await` outside an `async` context is `E0728` at
/// the model's own line, so leaving one behind would leave the one part of the repaired program that
/// still fails.
///
/// The mask is rebuilt over the dedented body rather than reused, because dedenting moved every
/// offset the original one was indexed by. A body that no longer lexes is left exactly as it is,
/// which is the same decline every strategy here makes.
fn without_await(body: &str) -> (String, usize) {
    const AWAIT: &str = ".await";
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
        let suspension = mask.is_code(index)
            && rest.starts_with(AWAIT)
            && !rest[AWAIT.len()..].starts_with(is_ident_char);
        if !suspension {
            out.push(character);
            at = index + character.len_utf8();
            continue;
        }
        deleted += 1;
        at = index + AWAIT.len();
    }
    (out, deleted)
}

// ---------------------------------------------------------------------------------------------
// The predicates
// ---------------------------------------------------------------------------------------------

/// Whether `line` is **certainly** a line of Rust — this dialect's answer to
/// [`Dialect::looks_like_code`](crate::healing::Dialect::looks_like_code).
///
/// Its errors are asymmetric on purpose. A false positive costs a fence that could have been
/// unwrapped (one turn, one located diagnostic); a false negative deletes a line of the model's
/// program. So every clause below is a shape that only code has.
///
/// # One shape deliberately absent, because a real reply contains it
///
/// **A leading `*`.** It is a doc-comment continuation line, and it is also how half the models that
/// write a bullet list write one. `strip-fences` declines outright when *any* line outside the fences
/// is code-shaped, so reading `* read the manifest` as code would send a reply of prose-fence-prose
/// to the compiler whole — which is the single most common real shape there is.
fn looks_like_code(line: &str) -> bool {
    let line = line.trim();
    if line.is_empty() {
        return false;
    }
    // 1. It ends the way a statement, an open block or a continued expression ends. This is the
    //    clause that reads a `use` line, which `STATEMENT_KEYWORDS` deliberately does not.
    if CODE_ENDINGS.iter().any(|ending| line.ends_with(ending)) {
        return true;
    }
    // 2. It opens with a statement or declaration keyword.
    if starts_with_keyword(line) {
        return true;
    }
    // 3. It opens with a closer, a comment or an attribute.
    if ["}", ")", "]", "//", "/*", "*/", "#[", "#!["]
        .iter()
        .any(|prefix| line.starts_with(prefix))
    {
        return true;
    }
    // 4. It opens with a chain continuation — `.map(|row| …)`, `?.` is not Rust but `.await` is —
    //    which is how a Rust author breaks a long expression and is not how anyone writes a
    //    sentence. A bare `.` or an ellipsis is not one: an identifier has to follow.
    if line
        .strip_prefix('.')
        .is_some_and(|rest| rest.starts_with(is_ident_start))
    {
        return true;
    }
    // 5. It carries a path separator, a closure arrow, a match arrow or a reference-with-lifetime
    //    anywhere. `::` is Rust's most distinctive punctuation and appears in almost every line that
    //    calls anything.
    if line.contains("::") || line.contains("->") || line.contains("=>") {
        return true;
    }
    // 6. It assigns to something. `total += 1` would otherwise be a line this dialect could say
    //    nothing at all about.
    if carries_an_assignment(line) {
        return true;
    }
    // 7. It opens with a closure's parameter list — `|row| …`, `|| …`, `|a, b| …` — which is a
    //    shape English has no use for and which clause 5 misses when the body carries no path.
    if opens_with_closure(line) {
        return true;
    }
    // 8. It opens with a call: an identifier, path or dotted chain immediately followed by `(` or
    //    `!(` — the second being a macro, which is how a Rust author writes half their calls.
    opens_with_call(line)
}

/// Whether `line` opens with a Rust statement keyword at an identifier boundary.
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

/// Whether `line` opens with a closure's parameter list: `||`, or a `|` … `|` on one line whose
/// contents are only identifiers, commas and whitespace.
///
/// Deliberately narrow, because `|` is also Rust's bitwise-or and a `match` pattern's alternation —
/// and, far more importantly, because a table row written in prose (`| name | what it does |`) is a
/// shape a model really does emit. Requiring every character between the bars to be an identifier
/// character keeps a Markdown table out.
fn opens_with_closure(line: &str) -> bool {
    let Some(rest) = line.strip_prefix('|') else {
        return false;
    };
    if rest.starts_with('|') {
        return true;
    }
    let Some((parameters, after)) = rest.split_once('|') else {
        return false;
    };
    !parameters.is_empty()
        && parameters
            .chars()
            .all(|c| is_ident_char(c) || c == ',' || c == ' ')
        && after.starts_with(' ')
}

/// Whether `line` opens with `name(`, `a::b(`, `a.b(` or `name!(` — `view::open_text(`,
/// `entries.iter(`, `println!(`.
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
        // A separator continues the chain only when a further identifier follows it; otherwise the
        // chain ended at the previous character, which is what keeps `Done. Created …` prose.
        let separator = match c {
            '.' => Some(1),
            ':' if line[index..].starts_with("::") => Some(2),
            _ => None,
        };
        if let Some(width) = separator {
            let next = line[index + width..].chars().next();
            if next.is_some_and(is_ident_start) {
                for _ in 0..width {
                    chars.next();
                }
                continue;
            }
        }
        break;
    }
    let rest = &line[end..];
    rest.starts_with('(') || rest.starts_with("!(")
}

/// Whether `line` is **certainly** prose rather than Rust — this dialect's answer to
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
    // 1. No punctuation that only code uses, and no comment opener. The backtick is *not* on that
    //    list here — see `NON_PROSE_CHARS`.
    if line.contains(NON_PROSE_CHARS) || line.contains("//") || line.contains("/*") {
        return false;
    }
    // 2. Not a statement.
    if starts_with_keyword(line) {
        return false;
    }
    // 3. Not a path, which is Rust's most distinctive punctuation and carries no `(` when it names
    //    a type or a constant.
    if line.contains("::") {
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

/// Whether `c` may open a Rust identifier.
///
/// ASCII-plus-Unicode-letters, which is close enough: a Unicode identifier is legal Rust and is
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

/// Lex `src` into its [code mask](CodeMask) — this dialect's answer to
/// [`Dialect::code_mask`](crate::healing::Dialect::code_mask).
///
/// `None` means the source did not lex cleanly, and every strategy that needs the mask declines on
/// it. Two states end a scan uncleanly, and both are an unterminated *opener*: a block comment or a
/// string literal that runs to the end of the text.
///
/// Rust asks three things of a lexer that [Java's](super::super::java::healing) does not:
///
/// * **a string may span newlines**, so a `"` still open at a `\n` is not evidence of anything. That
///   is the opposite of every other C-shaped arm here, where the same state is what makes an
///   apostrophe in prose decline the whole mask.
/// * **raw strings carry a fence.** `r"…"`, `r#"…"#`, `r##"…"##`, each optionally prefixed `b` or
///   `c`, and inside one a `"` closes nothing — so the fence has to be counted rather than looked
///   for.
/// * **`'` is ambiguous.** `'a'` is a `char` and `'a` is a lifetime, and reading the second as an
///   opening quote would swallow the rest of the program. See [`char_literal_end`].
///
/// Nested block comments are Rust's as much as Kotlin's: `/* a /* b */ c */` is one comment, and
/// reading it Java's way would leave ` c */` behind as code.
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
            // A prefixed literal is recognised at its **prefix**, because the `"` of `r#"…"#` is
            // several bytes further on and reading it as a plain string would put the fence's own
            // `#`s back in the code and lose the body.
            b'b' | b'c' | b'r' if !preceded_by_identifier(bytes, index) => {
                match literal(bytes, index) {
                    Some(opener) => index = quoted(bytes, &mut code, index, opener)?,
                    None => index += 1,
                }
            }
            b'"' => {
                let opener = literal(bytes, index)?;
                index = quoted(bytes, &mut code, index, opener)?;
            }
            b'\'' => match char_literal_end(src, index) {
                Some(end) => {
                    mark(&mut code, index..end);
                    index = end;
                }
                // A lifetime, a loop label, or an apostrophe in a line of English — all ordinary
                // bytes, none of them the start of anything the mask has to follow.
                None => index += 1,
            },
            _ => index += 1,
        }
    }
    Some(CodeMask::from_flags(code))
}

/// A string literal's opener: where its body starts, how many `#` its fence carries, and whether a
/// `\` escapes inside it.
struct Opener {
    /// The offset just past the opening `"`.
    body: usize,
    /// How many `#` stand between the `r` and the `"`, and therefore how many must follow the
    /// closing one.
    hashes: usize,
    /// Whether this is a **raw** string, in which a `\` is an ordinary byte.
    raw: bool,
}

/// The string literal opening at `at`, if one is — reading the `b`, `c` and `r` prefixes and the
/// raw fence.
fn literal(bytes: &[u8], at: usize) -> Option<Opener> {
    let mut index = at;
    // `b"…"`, `c"…"`, `br"…"`, `cr"…"` — one optional prefix letter, and only when what follows it
    // could open a string.
    if matches!(bytes.get(index), Some(b'b' | b'c'))
        && matches!(bytes.get(index + 1), Some(b'r' | b'"'))
    {
        index += 1;
    }
    let raw = bytes.get(index) == Some(&b'r');
    if raw {
        index += 1;
    }
    let mut hashes = 0usize;
    if raw {
        while bytes.get(index) == Some(&b'#') {
            hashes += 1;
            index += 1;
        }
    }
    (bytes.get(index) == Some(&b'"')).then_some(Opener {
        body: index + 1,
        hashes,
        raw,
    })
}

/// Whether the byte before `at` may continue an identifier — which is what tells the `r` of a raw
/// string from the `r` at the end of `for`.
fn preceded_by_identifier(bytes: &[u8], at: usize) -> bool {
    at > 0 && (bytes[at - 1].is_ascii_alphanumeric() || bytes[at - 1] == b'_')
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
/// not code.
///
/// There is no interpolation to follow: Rust's `format!("{name}")` captures a name rather than
/// splicing an expression, and the braces are macro syntax read by the macro rather than delimiters
/// a mask must come back out of. So the whole body is string bytes, which is what it is.
///
/// A newline does **not** end the scan, because Rust admits one in every string it has. What ends it
/// uncleanly is the end of the text.
fn quoted(bytes: &[u8], code: &mut [bool], from: usize, opener: Opener) -> Option<usize> {
    mark(code, from..opener.body);
    let mut at = opener.body;
    while at < bytes.len() {
        if !opener.raw && bytes[at] == b'\\' {
            if at + 1 >= bytes.len() {
                return None;
            }
            mark(code, at..at + 2);
            at += 2;
            continue;
        }
        if bytes[at] == b'"' && closing_fence(bytes, at + 1, opener.hashes) {
            let end = at + 1 + opener.hashes;
            mark(code, at..end);
            return Some(end);
        }
        mark(code, at..at + 1);
        at += 1;
    }
    None
}

/// Whether `hashes` `#` stand at `at` — the tail of a raw string's closing fence.
fn closing_fence(bytes: &[u8], at: usize, hashes: usize) -> bool {
    (0..hashes).all(|offset| bytes.get(at + offset) == Some(&b'#'))
}

/// Where the character literal opening at `at` ends, past its closing `'` — or `None` when the `'`
/// opens no literal at all.
///
/// This is the reading that keeps a lifetime from being read as a quote, and it is the whole reason
/// this arm's lexer survives text no other C-shaped arm's does. `&'static str`, `impl<'a>`,
/// `'outer: for …` and the apostrophe in `don't` all answer `None` and are left as ordinary code,
/// where a scan that took every `'` as an opener would swallow everything after them.
///
/// A literal is one of exactly two shapes: an escape (`'\n'`, `'\''`, `'\u{1f600}'`), or **one
/// character** followed immediately by a closing `'`. Nothing else is one.
fn char_literal_end(src: &str, at: usize) -> Option<usize> {
    let rest = src.get(at + 1..)?;
    if let Some(escaped) = rest.strip_prefix('\\') {
        // `\u{…}` is the one escape whose length is not fixed; every other is a single character.
        let after = match escaped.strip_prefix('u') {
            Some(braced) => &braced[braced.find('}')? + 1..],
            None => &escaped[escaped.chars().next()?.len_utf8()..],
        };
        return after.strip_prefix('\'').map(|tail| src.len() - tail.len());
    }
    let character = rest.chars().next()?;
    // A newline is not a character literal's content in any shape a model writes, and reading one as
    // such is how a scan loses a line.
    if character == '\n' || character == '\'' {
        return None;
    }
    rest[character.len_utf8()..]
        .strip_prefix('\'')
        .map(|tail| src.len() - tail.len())
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
#[path = "rust.healing.test.rs"]
mod tests;
