//! **What gg puts around a code module's Swift**, and the one file it generates beside a program —
//! which is the whole of what this arm writes, because a **program** is written around by nothing at
//! all.
//!
//! # A program is not here, and that is the point
//!
//! Every other compiled arm has a wrapper in this position: Rust's program is a function body, the
//! JVM arms' is a class or a script preamble, and each of them pays a line offset for it. Swift's is
//! the model's reply, byte for byte, compiled as `main.swift`. Swift refuses `extension`, `protocol`
//! and `import` inside a function body, so a wrapper of that shape would forbid the construct the
//! language is built around; a top-level file is the only Swift context that admits declarations and
//! bare statements together. See [`compile`](super::compile) for how gg's shell reaches the entry
//! point Swift lowers such a file into.
//!
//! # A code module is a **file of the program's own module**, namespaced in place
//!
//! A code [skill](crate::skills)'s or [memory](crate::memories)'s namespace is bound at `lib.<key>`
//! for every program the agent writes afterwards, and on a compiled arm that binding is a **link**:
//! the module has to be built into the same artifact as the program that uses it. Rust says that with
//! a `mod`. Swift has no nested module, so the namespace is a **caseless `enum`** — the language's
//! own way of spelling one — and each of a module's top-level declarations is moved into it by being
//! wrapped, *where it stands*, in an `extension` of it:
//!
//! ```text
//! public func parse(_ text: String, delimiter: Character = ",") -> [Row] {   // as authored
//! extension lib.csvTools { public static func parse(_ text: String, …) -> [Row] {   // as compiled
//! ```
//!
//! Two things follow, and both are the reason this shape was chosen over the two alternatives.
//!
//! **Every line number is preserved.** The wrap is a prefix on the declaration's first line and a
//! suffix on its last, so a diagnostic in a module's own file is at the author's own line. Only two
//! columns per declaration move.
//!
//! **The declaration keeps everything a Swift declaration has.** Argument labels, default parameter
//! values, generic parameters, `where` clauses, `throws`, overloads: all of it survives, because
//! nothing is re-synthesized — the author's own text is what the compiler reads. The alternative
//! shape, compiling each module as its own Swift module and binding its exports into `lib` through
//! forwarders, was rejected for exactly this: a function bound as a value (`static let parse =
//! csvTools.parse`) **loses its argument labels**, which on the arm whose SDK is built around them is
//! the one thing that must not be quietly given up. It cannot bind an overload or a generic at all.
//!
//! What it costs is stated rather than hidden. A module's `import`, `extension`, `protocol` and
//! operator declarations **cannot** live inside a type, so they stay at file scope — which here is the
//! program's own module, so a `protocol` two code modules both declare is a redeclaration the turn's
//! compile reports. That is the narrowest of the three prices, and the two rejected shapes each paid a
//! wider one.
//!
//! # What refuses, and why it is the only refusal
//!
//! A `#if` at a module's top level. Its lines are not a declaration, they bracket declarations that
//! *are*, and a bracket whose halves land in two different `extension` bodies is a file that does not
//! parse — so it is refused by name rather than mis-wrapped. It is also the one construct with
//! nothing to lose: this arm compiles for exactly one target, so a module with a `#if` in it has a
//! branch that is never taken.

use std::fmt::Write as _;

use crate::sandbox::PrepareError;

use super::healing::{code_mask, declaration_keyword, identifier};

/// The file a code module is compiled under, given its binding key — `module_csvTools.swift`.
///
/// A fixed name per key inside a workspace that is private per preparation, on the same terms
/// [`PROGRAM_FILE`](super::compile::PROGRAM_FILE) is. The key is already a Swift identifier
/// ([`binding_name`](super::binding_name)) so it cannot produce a path component that is not one.
pub(super) fn module_file(key: &str) -> String {
    format!("{MODULE_FILE_PREFIX}{key}.swift")
}

/// What a code module's file name begins with — which is also how a diagnostic located in one is told
/// from a diagnostic located in gg's own generated file.
pub(super) const MODULE_FILE_PREFIX: &str = "module_";

/// The file that declares the `lib` namespace and one caseless `enum` inside it per module in scope.
///
/// gg's own, and named absolutely on the command line for that reason: a diagnostic in it is gg's
/// arrangement failing rather than the model's program, and the compile's
/// [classification](super::compile) reads exactly that distinction off the path.
pub(super) const LIB_FILE: &str = "gg-lib.swift";

/// The key a module is namespaced under while it is being **checked on its own**, before any program
/// has asked for it.
///
/// A module's own preparation is handed no key — the seam binds one when the module is loaded, not
/// when it is read — so the check compiles it under a fixed one. Which key it is changes nothing it
/// could catch: the wrap is the same shape for every key, and a name that resolves under one resolves
/// under all of them.
pub(super) const CHECK_KEY: &str = "module";

/// The `lib` namespace and the caseless `enum` each module's declarations are moved into.
///
/// One file rather than a declaration per module file, because `lib` itself is declared once and an
/// `enum` nested in it cannot be added by an `extension` from the same module — and because a module
/// that failed to prepare must still leave the keys of the ones that did.
///
/// `public` throughout, though a program and its modules are one Swift module and `internal` would
/// reach: a module's author writes `public func`, and a `public` member of an `internal` type is a
/// declaration Swift will warn about. Making the namespace public makes the author's own spelling the
/// correct one.
///
/// Empty for an agent that has loaded nothing, so an ordinary program's compile is exactly what it
/// was before code modules existed.
pub(super) fn lib_declarations(keys: impl Iterator<Item = impl AsRef<str>>) -> String {
    let mut inner = String::new();
    for key in keys {
        let _ = writeln!(inner, "    public enum {} {{}}", key.as_ref());
    }
    match inner.is_empty() {
        true => String::new(),
        false => format!("public enum lib {{\n{inner}}}\n"),
    }
}

/// A code module's own file: the author's source with each of its top-level declarations moved into
/// `lib.<key>`, in place.
///
/// This is what a program's compile writes beside the entry file, and it is **source rather than an
/// artifact** — which is what a linked language's module has to be. A module cannot be compiled into
/// anything reachable on its own: Swift links, so the only artifact a module can end up in is the
/// artifact of a program that was built against it. What the module's own preparation buys is the
/// *check* — the author gets `swiftc`'s diagnostic at the read, at the module's own lines, rather
/// than a program that stops compiling for reasons in somebody else's file.
pub(super) fn namespaced(source: &str, key: &str) -> Result<String, PrepareError> {
    let Some(items) = declarations(source)? else {
        // The source did not lex, which means an unterminated string or comment, which means
        // `swiftc` is about to say so at the author's own line. Handing it over untouched is what
        // lets it: a namespace guessed at from a reading already known to be wrong would put gg's
        // own braces in front of the compiler's account of the real fault.
        return Ok(source.to_string());
    };
    let lines: Vec<&str> = source.lines().collect();
    let mut opens = vec![false; lines.len()];
    let mut closes = vec![false; lines.len()];
    let mut statics = vec![false; lines.len()];
    for item in &items {
        let Some(namespaced) = item.namespaced.as_ref() else {
            continue;
        };
        opens[item.first] = true;
        closes[item.last] = true;
        if namespaced.needs_static {
            statics[namespaced.keyword_line] = true;
        }
    }

    let mut out = String::with_capacity(source.len() + items.len() * 32);
    for (number, line) in lines.iter().enumerate() {
        let mut rendered = (*line).to_string();
        if statics[number] {
            rendered = with_static(&rendered);
        }
        if opens[number] {
            rendered = format!("extension lib.{key} {{ {}", rendered.trim_start());
        }
        if closes[number] {
            rendered.push_str(" }");
        }
        out.push_str(&rendered);
        out.push('\n');
    }
    // A source with no trailing newline is given one rather than losing its last line: `lines()`
    // drops the distinction and nothing downstream depends on it.
    Ok(out)
}

/// The names a code module's namespace offers, in source order — what the reply that binds it tells
/// the model it may call.
///
/// Read from the module's **own source** rather than out of anything the compiler produced, for the
/// reason every other arm reads its own: these are what the skill's author is *told* the namespace
/// holds, and a second reading of the same fact is a second chance for the two to disagree.
///
/// Every top-level declaration that is moved into the namespace is one of its names, whatever kind it
/// is — `func`, `struct`, `enum`, `class`, `actor`, `typealias`, `let`, `var` — which is wider than
/// the function lists the interpreted arms report and is right for the same reason Rust's is: a Swift
/// module whose namespace is a `struct` and its methods offers that type, and a listing that named
/// only its functions would be describing something else.
///
/// What is **not** listed is what a program could not reach: a `private` or `fileprivate` declaration
/// is invisible outside the module's own file, and an `extension`, `protocol` or operator stays at
/// file scope and is reached without the namespace at all.
pub(super) fn exports(source: &str) -> Vec<String> {
    let Ok(Some(items)) = declarations(source) else {
        return Vec::new();
    };
    let mut names: Vec<String> = Vec::new();
    for item in items {
        let Some(namespaced) = item.namespaced else {
            continue;
        };
        let Some(name) = namespaced.name.filter(|_| namespaced.exported) else {
            continue;
        };
        if !names.contains(&name) {
            names.push(name);
        }
    }
    names
}

/// The key a module is checked under on its own, and the `lib` declaration that check needs.
pub(super) fn check_files(source: &str) -> Result<(String, String), PrepareError> {
    Ok((
        namespaced(source, CHECK_KEY)?,
        lib_declarations(std::iter::once(CHECK_KEY)),
    ))
}

// ---------------------------------------------------------------------------------------------
// Reading a module's top level
// ---------------------------------------------------------------------------------------------

/// One top-level declaration of a code module: the lines it spans, and what gg does with it.
struct Item {
    /// The 0-based line it starts on.
    first: usize,
    /// The 0-based line it ends on — the last line before the next declaration that is neither blank
    /// nor a comment, so a doc comment written above the next declaration is not swallowed by this
    /// one's namespace.
    last: usize,
    /// How it is namespaced, or `None` for a declaration that must stay at file scope.
    namespaced: Option<Namespaced>,
}

/// What a declaration that goes into `lib.<key>` needs doing to it.
#[derive(Clone)]
struct Namespaced {
    /// The line its declaration keyword stands on — not always [`Item::first`], because an attribute
    /// may be written on a line of its own above it.
    keyword_line: usize,
    /// Whether a `static` has to be inserted: a `func`, `var` or `let` becomes a **type** member and
    /// an instance member of a caseless `enum` is unreachable, having no instances to be a member of.
    needs_static: bool,
    /// The name it declares, when it declares one gg can read.
    name: Option<String>,
    /// Whether a program may reach it — false for `private` and `fileprivate`, which are visible only
    /// inside the module's own file.
    exported: bool,
}

/// Every top-level declaration `source` makes, in order — or `None` when the source did not lex.
///
/// "Top level" is read as *brace depth zero in code context*, which is what the seam's own lexer
/// already answers: [`code_mask`] is the same reading response healing makes of a reply, so a
/// module and a program are read by one lexer rather than two.
fn declarations(source: &str) -> Result<Option<Vec<Item>>, PrepareError> {
    let Some(mask) = code_mask(source) else {
        return Ok(None);
    };
    let mut starts: Vec<(usize, Option<Namespaced>)> = Vec::new();
    let mut substantial: Vec<bool> = Vec::new();
    let mut depth = 0usize;
    let mut offset = 0usize;
    // An attribute written on a line of its own — `@discardableResult` above `public func …` — opens
    // the declaration below it, and the wrap has to start at the attribute or it would be detached
    // from what it decorates. So the line is remembered rather than treated as a declaration of its
    // own, and whatever declaration comes next claims it.
    let mut attribute: Option<usize> = None;
    // `split_inclusive` rather than `lines`, because the offsets below index a mask built over the
    // source's own bytes: a line's terminator is part of what precedes the next one, and a `\r\n`
    // ending would put every offset after the first one out by a byte if the newline were assumed.
    // The item count is the same either way, which is what lets the line *numbers* here be the ones
    // `namespaced` writes by.
    for (number, raw) in source.split_inclusive('\n').enumerate() {
        let line = raw.trim_end_matches(['\n', '\r']);
        let indent = line.len() - line.trim_start().len();
        let trimmed = line.trim_start();
        let at_top = depth == 0 && mask.is_code(offset + indent);
        if at_top && let Some(directive) = conditional_directive(trimmed) {
            return Err(PrepareError::Unsupported(format!(
                "line {}: this code module writes `{directive}` at its top level, and gg cannot bind \
                 a module that does. Its declarations are moved into `lib.<key>` where they stand, \
                 and a compiler directive brackets declarations rather than being one — so its two \
                 halves would land in two different scopes. Delete the conditional: this sandbox \
                 compiles for one target, so only one of its branches was ever going to be taken.",
                number + 1
            )));
        }
        if at_top {
            match opens_a_declaration(trimmed, number) {
                Some(Opening::Attribute) => attribute = attribute.or(Some(number)),
                Some(Opening::Declaration(namespaced)) => {
                    starts.push((attribute.take().unwrap_or(number), namespaced));
                }
                // A line that opens nothing continues whatever came before it — and, if an attribute
                // was waiting, ends the run rather than letting it reach a declaration further down.
                None if !trimmed.is_empty() => attribute = None,
                None => {}
            }
        }
        substantial.push(!trimmed.is_empty() && !trimmed.starts_with("//"));
        for (index, byte) in line.bytes().enumerate() {
            if !mask.is_code(offset + index) {
                continue;
            }
            match byte {
                b'{' => depth += 1,
                b'}' => depth = depth.saturating_sub(1),
                _ => {}
            }
        }
        offset += raw.len();
    }

    let mut items = Vec::with_capacity(starts.len());
    for (index, (first, namespaced)) in starts.iter().enumerate() {
        let bound = starts
            .get(index + 1)
            .map(|(next, _)| *next)
            .unwrap_or(substantial.len());
        // Back off over the blank and comment lines that belong to whatever comes next, so a doc
        // comment written above the following declaration stays outside this one's namespace.
        let mut last = bound.saturating_sub(1);
        while last > *first && !substantial[last] {
            last -= 1;
        }
        items.push(Item {
            first: *first,
            last,
            namespaced: namespaced.clone(),
        });
    }
    Ok(Some(items))
}

/// The compiler directive `line` opens, if it opens one.
///
/// Every `#` directive that has a *bracketing* half is refused, and the ones that do not (`#warning`,
/// `#error`) are not — those are single declarations and go through the ordinary path, at file scope,
/// where they mean exactly what their author wrote.
fn conditional_directive(line: &str) -> Option<&'static str> {
    ["#if", "#elseif", "#else", "#endif", "#sourceLocation"]
        .into_iter()
        .find(|directive| {
            line.strip_prefix(directive)
                .is_some_and(|rest| !rest.starts_with(|c: char| c.is_alphanumeric()))
        })
}

/// What a top-level line opens.
enum Opening {
    /// An attribute on a line of its own, which decorates whatever declaration comes next.
    Attribute,
    /// A declaration: `Some` for one that moves into the namespace, `None` for one Swift admits only
    /// at file scope.
    Declaration(Option<Namespaced>),
}

/// Whether `line` opens a top-level declaration, and how it is namespaced if it does.
///
/// `None` is a line that opens nothing and therefore continues whatever came before it.
fn opens_a_declaration(line: &str, number: usize) -> Option<Opening> {
    if line.starts_with('@') {
        return Some(Opening::Attribute);
    }
    if FILE_SCOPE_KEYWORDS
        .iter()
        .any(|keyword| opens_with(line, keyword))
    {
        return Some(Opening::Declaration(None));
    }
    let (keyword, after) = declaration_keyword(line)?;
    let needs_static = matches!(keyword, "func" | "var" | "let");
    let name = identifier(after.trim_start()).map(|(name, _)| name.to_string());
    let exported =
        !opens_with_modifier(line, "private") && !opens_with_modifier(line, "fileprivate");
    Some(Opening::Declaration(Some(Namespaced {
        keyword_line: number,
        needs_static,
        name,
        exported,
    })))
}

/// The declarations Swift admits only at **file scope**, which therefore stay where their author
/// wrote them.
///
/// `extension` and `protocol` cannot be nested inside a type at all, an `import` is file-scoped by
/// definition, and an operator or a precedence group is global by design. Leaving them is not a
/// compromise for the first three — an `extension` of a type is reached through the type, and a
/// `protocol` through its own name — and for the last two it is what those declarations mean.
const FILE_SCOPE_KEYWORDS: [&str; 6] = [
    "import",
    "extension",
    "protocol",
    "operator",
    "precedencegroup",
    "macro",
];

/// Whether `line` opens with `word` at an identifier boundary — including behind an operator's own
/// placement modifier, since `infix operator ***` opens with `infix`.
fn opens_with(line: &str, word: &str) -> bool {
    let mut rest = line;
    for placement in ["infix", "prefix", "postfix"] {
        if let Some(after) = rest
            .strip_prefix(placement)
            .filter(|after| after.starts_with(char::is_whitespace))
        {
            rest = after.trim_start();
        }
    }
    rest.strip_prefix(word)
        .is_some_and(|after| after.chars().next().is_none_or(|c| !c.is_alphanumeric()))
}

/// Whether `line` opens with the access modifier `word`, before any other modifier.
fn opens_with_modifier(line: &str, word: &str) -> bool {
    line.strip_prefix(word)
        .is_some_and(|after| after.starts_with(char::is_whitespace))
}

/// `line` with a `static` inserted immediately in front of its declaration keyword.
///
/// In front of the keyword rather than in front of the line, so `public func parse` becomes
/// `public static func parse` — which is what an author would have written — rather than
/// `static public func parse`, which Swift accepts and no Swift author writes.
fn with_static(line: &str) -> String {
    let mut at = line.len() - line.trim_start().len();
    loop {
        let rest = &line[at..];
        let Some((word, after)) = identifier(rest) else {
            break;
        };
        if matches!(word, "func" | "var" | "let") {
            break;
        }
        let trimmed = after.trim_start();
        if trimmed.len() == after.len() {
            break;
        }
        at = line.len() - trimmed.len();
    }
    format!("{}static {}", &line[..at], &line[at..])
}

#[cfg(test)]
#[path = "swift.source.test.rs"]
mod tests;
