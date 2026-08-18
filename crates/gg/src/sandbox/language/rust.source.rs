//! **What gg puts around a model's Rust** before `rustc` sees it: nothing.
//!
//! A program on this arm is a whole Rust program — the `use` lines it wrote and the `fn main` it
//! declared — compiled as a **binary crate** under the name below. gg writes no prologue, no
//! epilogue, no entry point and no import, so `rustc` reads the bytes the model sent and reports
//! every diagnostic in the model's own coordinates. There is nothing here to subtract, and nothing
//! a code module in scope adds: a module is a **crate of its own**, named to the program's compiler
//! on `--extern`, which is packaging and writes no line into anybody's file.
//!
//! What is left in this file is the names a compile is written under, the file and artifact names a
//! code module's own crate is built under, and the reading of a module's exports out of its author's
//! source.

use crate::sandbox::{ModuleExport, ModuleExportKind};

/// The file a program is compiled under, and the one its diagnostics are located in.
///
/// A fixed name inside a workspace that is private per preparation — which is the seam's rule, and
/// the reason the name may be fixed at all. It is also the file name a model reads in a panic:
/// `thread 'main' (1) panicked at program.rs:6:5:` is `std`'s own sentence about the model's own
/// file, with no correction applied to it by anybody.
pub(super) const PROGRAM_FILE: &str = "program.rs";

/// The crate name the program is compiled under.
///
/// Named rather than left to be derived from the file, because `rustc` derives it from the output
/// path and the output path is `program.wasm` — a coincidence that would silently change if the
/// artifact were ever renamed. It is also the crate a model is named in the one diagnostic gg no
/// longer has to produce for itself: a program with no entry point is
/// `error[E0601]: main function not found in crate program`.
pub(super) const CRATE_NAME: &str = "program";

/// The crate a program is compiled against, as `--extern` names it.
///
/// One word, because it is the first word of every Rust program in the study:
/// `gg::files::read_file`, `use gg::views;`. `--extern` puts it in the **extern prelude**, which is
/// packaging on the same terms a jar on a classpath is: it makes the crate reachable and puts no
/// name in a program's own scope. Everything under it is written either in full or under a `use`
/// line the program wrote.
pub(super) const SDK_CRATE: &str = "gg";

// ---------------------------------------------------------------------------------------------
// Code modules
// ---------------------------------------------------------------------------------------------

/// The file a code module's crate is compiled from, given its binding key — `module_csv_tools.rs`.
///
/// A fixed name per key inside a workspace that is private per preparation, on the same terms
/// [`PROGRAM_FILE`] is. The key is already a Rust identifier ([`binding_name`](super::binding_name))
/// so it cannot produce a path component that is not one.
pub(super) fn module_file(key: &str) -> String {
    format!("module_{key}.rs")
}

/// The `.rlib` a code module's crate is compiled into, given its binding key.
///
/// `lib<key>.rlib` is what `rustc` would name a library crate itself, and naming it explicitly is
/// what lets the `--extern <key>=…` that reaches it be written before the compiler has run.
pub(super) fn module_artifact(key: &str) -> String {
    format!("lib{key}.rlib")
}

/// The names a code module's crate offers, in source order — the declarations a program may call
/// through `<key>::<name>`, and the entries a use of the skill opens a documentation view of.
///
/// Read from the module's **own source** rather than out of anything the compiler produced, for the
/// reason every other arm reads its own: these are what the skill's author is *told* the crate
/// holds, and a second reading of the same fact is a second chance for the two to disagree.
///
/// A `pub` item at the module's top level is one of its names, whatever kind it is — `pub fn`,
/// `pub struct`, `pub enum`, `pub const`, `pub static`, `pub type`, `pub trait` and `pub mod`. That
/// is wider than the function lists the interpreted arms report, and it is right: a Rust module
/// whose namespace is a `struct` and its `impl` offers that type, and a listing that named only its
/// functions would be describing something else.
///
/// A restricted item (`pub(crate)`, `pub(super)`, `pub(in …)`) is **not** one of them. A module is
/// its own crate, so a restriction to that crate is a restriction against the program, and
/// advertising one would be offering a call `rustc` refuses.
///
/// The scan is lexical and **unindented-only**, like every other reading in this arm: a `pub fn`
/// nested inside an `impl` or a `mod` is indented, is not a name the program reaches directly, and
/// is not reported.
pub(super) fn exports(source: &str) -> Vec<ModuleExport> {
    let lines: Vec<&str> = source.lines().collect();
    let mut out: Vec<ModuleExport> = Vec::new();
    for (number, line) in lines.iter().enumerate() {
        if line.starts_with([' ', '\t']) {
            continue;
        }
        let Some((name, keyword)) = exported_name(line) else {
            continue;
        };
        if out.iter().any(|seen| seen.name == name) {
            continue;
        }
        // An attribute stands between an item's documentation and the item, and belongs to the item:
        // `#[inline]` under three lines of `///` has not detached them from each other.
        let above = super::super::comments::above(&lines, number, |line| line.starts_with("#["));
        let declaration = super::super::heads::head(line);
        let (returns, parameters) = signature_types(&declaration, keyword);
        out.push(ModuleExport {
            name: name.to_string(),
            kind: kind(keyword),
            doc: super::super::comments::line_doc(&lines, above, &["///"]),
            declaration,
            returns,
            parameters,
        });
    }
    out
}

/// What a program does with the item `keyword` opens.
///
/// `mod` is the one that does not fit and it is a [`Value`](ModuleExportKind::Value): a program
/// reaches a module by writing its name and going on, which is what it does with a constant. The
/// alternative was a fourth kind for the one arm that has them.
fn kind(keyword: &str) -> ModuleExportKind {
    match keyword {
        "fn" => ModuleExportKind::Function,
        "struct" | "enum" | "trait" | "type" => ModuleExportKind::Type,
        _ => ModuleExportKind::Value,
    }
}

/// The type names `declaration` writes in return position and in parameter position — the two lists
/// a [`docViewTypes`](crate::config) flag opens a view of beside the function's own.
///
/// Read for a `fn` and for nothing else, because a documentation view opens the types around a
/// **function**: the type on a `const` is that constant's own type rather than something it returns,
/// and reporting it here would put a name in a list whose one reader asks a question about calls.
///
/// What is collected is the **last segment of every path** the type writes, so
/// `Result<Vec<gg::files::FileRead>, ApiError>` reports `Result`, `Vec`, `FileRead` and `ApiError`.
/// Wider than the outermost name, deliberately: a name that resolves to nothing — a generic
/// parameter, a primitive, a container the surface does not document — is dropped by the resolver
/// that reads this, and the one it *can* resolve is the one the model wanted. Narrowing to the
/// outermost would withhold `FileRead` from every function handing back a `Result` of one, which is
/// most of them.
///
/// Lifetimes and the words a type writes that are not type names (`dyn`, `impl`, `mut`, `as`) are
/// skipped, and `self` with them: a method's receiver is not a parameter type.
fn signature_types(declaration: &str, keyword: &str) -> (Vec<String>, Vec<String>) {
    if keyword != "fn" {
        return (Vec::new(), Vec::new());
    }
    let Some((parameters, rest)) = parameter_list(declaration) else {
        return (Vec::new(), Vec::new());
    };
    let returned = rest
        .trim_start()
        .strip_prefix("->")
        .map(|returned| match returned.find(" where ") {
            Some(at) => &returned[..at],
            None => returned,
        })
        .unwrap_or("");
    let mut parameter_types = Vec::new();
    for parameter in split_parameters(parameters) {
        // `name: Type` — the type is what follows the first colon at the top level of the
        // parameter, which is where a `self` receiver and a `_` binding both drop out: neither
        // writes one.
        let Some(typed) = after_binding(&parameter) else {
            continue;
        };
        collect_type_names(typed, &mut parameter_types);
    }
    let mut returns = Vec::new();
    collect_type_names(returned, &mut returns);
    (returns, parameter_types)
}

/// The text between a declaration's own parentheses, and everything after them.
///
/// The opening parenthesis is the first one outside the generic list, because a bound may write one
/// of its own — `pub fn apply<F: Fn(u8) -> u8>(f: F)` opens its parameters at the second `(` — and
/// the closing one is depth-counted for the same reason: `pub fn apply(f: fn(u8) -> u8)`.
fn parameter_list(declaration: &str) -> Option<(&str, &str)> {
    let open = opening_parenthesis(declaration)?;
    let mut depth = 0usize;
    for (at, character) in declaration[open..].char_indices() {
        match character {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    return Some((
                        &declaration[open + 1..open + at],
                        &declaration[open + at + 1..],
                    ));
                }
            }
            _ => {}
        }
    }
    None
}

/// Where a declaration's parameter list opens: the first `(` written outside a generic list.
///
/// The `>` of a `->` closes nothing, which is what keeps a bound's own return type from taking the
/// scan out of the generic list one angle bracket early.
fn opening_parenthesis(declaration: &str) -> Option<usize> {
    let mut angle = 0usize;
    let mut previous = ' ';
    for (at, character) in declaration.char_indices() {
        match character {
            '<' => angle += 1,
            '>' if previous != '-' => angle = angle.saturating_sub(1),
            '(' if angle == 0 => return Some(at),
            _ => {}
        }
        previous = character;
    }
    None
}

/// One parameter per element, split on the commas that are the list's own.
///
/// A comma inside a generic argument, a tuple or a slice belongs to the type it is written in —
/// `pub fn merge(rows: Vec<(u8, u8)>, limit: usize)` is two parameters and not three — so every
/// bracket the language has is counted.
fn split_parameters(parameters: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut depth = 0usize;
    let mut current = String::new();
    for character in parameters.chars() {
        match character {
            '(' | '[' | '<' => depth += 1,
            ')' | ']' | '>' => depth = depth.saturating_sub(1),
            ',' if depth == 0 => {
                out.push(std::mem::take(&mut current));
                continue;
            }
            _ => {}
        }
        current.push(character);
    }
    out.push(current);
    out
}

/// The type half of `name: Type`, or `None` for a parameter that writes no type.
///
/// The colon searched for is the one at the parameter's own top level: a bound written inline
/// (`f: impl Fn(u8) -> u8`) puts none inside a bracket, but a defaulted const generic could, and
/// counting brackets costs nothing.
fn after_binding(parameter: &str) -> Option<&str> {
    let mut depth = 0usize;
    for (at, character) in parameter.char_indices() {
        match character {
            '(' | '[' | '<' => depth += 1,
            ')' | ']' | '>' => depth = depth.saturating_sub(1),
            ':' if depth == 0 => return Some(&parameter[at + 1..]),
            _ => {}
        }
    }
    None
}

/// Every type name `text` writes, appended to `out` in the order they were written, without
/// repeats.
///
/// An identifier followed by `::` is a path segment rather than the name at its end, so it is
/// dropped and the segment after it is taken. An identifier after a `'` is a lifetime.
fn collect_type_names(text: &str, out: &mut Vec<String>) {
    let bytes: Vec<char> = text.chars().collect();
    let mut at = 0usize;
    while at < bytes.len() {
        let character = bytes[at];
        if character == '\'' {
            // A lifetime, and the identifier after the quote is its name rather than a type's.
            at += 1;
            while at < bytes.len() && (bytes[at].is_alphanumeric() || bytes[at] == '_') {
                at += 1;
            }
            continue;
        }
        if !(character.is_alphabetic() || character == '_') {
            at += 1;
            continue;
        }
        let start = at;
        while at < bytes.len() && (bytes[at].is_alphanumeric() || bytes[at] == '_') {
            at += 1;
        }
        let word: String = bytes[start..at].iter().collect();
        let mut after = at;
        while after < bytes.len() && bytes[after].is_whitespace() {
            after += 1;
        }
        // A path prefix: what the model reaches is the segment this one qualifies.
        if bytes[after..].starts_with(&[':', ':']) {
            at = after + 2;
            continue;
        }
        if NOT_A_TYPE_NAME.contains(&word.as_str()) || out.contains(&word) {
            continue;
        }
        out.push(word);
    }
}

/// The words a Rust type may write that name no type.
///
/// `self` is here because a receiver is not a parameter type, and the three type-position keywords
/// because `dyn Reader` names `Reader`. `where` never reaches this: a return type is cut at its
/// clause before the scan starts.
const NOT_A_TYPE_NAME: [&str; 6] = ["dyn", "impl", "mut", "ref", "self", "as"];

/// The name `line` makes public and the keyword that says what it is, if it makes one.
fn exported_name(line: &str) -> Option<(&str, &str)> {
    let rest = line.trim().strip_prefix("pub")?;
    // A restricted item is visible inside the module's own crate and nowhere else, and the program
    // is another crate — so `pub(crate) fn` declares nothing a program may write.
    if rest.starts_with('(') {
        return None;
    }
    let mut rest = rest.strip_prefix(char::is_whitespace)?.trim_start();
    // The modifiers a public item may carry between `pub` and the keyword that says what it is,
    // consumed in whatever order they were written (`async unsafe fn`, `unsafe extern fn`).
    //
    // `const` is deliberately absent from that list and handled below instead, because it is the one
    // word that is both a modifier and an item keyword: `const fn helper()` declares `helper` and
    // `const LIMIT: usize = 10` declares `LIMIT`.
    loop {
        let (word, after) = rest.split_once(char::is_whitespace)?;
        if word == "const" && after.trim_start().starts_with("fn ") {
            rest = after.trim_start();
            continue;
        }
        if !["unsafe", "async", "extern", "default"].contains(&word) {
            break;
        }
        rest = after.trim_start();
    }
    let (keyword, after) = rest.split_once(char::is_whitespace)?;
    if !ITEM_KEYWORDS.contains(&keyword) {
        return None;
    }
    let after = after.trim_start();
    let end = after
        .find(|c: char| !(c.is_alphanumeric() || c == '_'))
        .unwrap_or(after.len());
    (end > 0).then(|| (&after[..end], keyword))
}

/// The item keywords whose declaration names something a program may reach through `<key>::<name>`.
///
/// `impl` is deliberately absent: it declares no name of its own, and the type it is written for is
/// already listed by its own declaration. `use` is absent for the opposite reason — a `pub use` is a
/// re-export whose name is the *end* of a path rather than the word after the keyword, which this
/// lexical scan cannot read correctly, and reporting the wrong half of one would be worse than
/// leaving it out.
const ITEM_KEYWORDS: [&str; 8] = [
    "fn", "struct", "enum", "trait", "const", "static", "type", "mod",
];

#[cfg(test)]
#[path = "rust.source.test.rs"]
mod tests;
