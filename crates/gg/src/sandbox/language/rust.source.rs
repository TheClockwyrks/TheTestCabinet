//! **What gg puts around a model's Rust** before `rustc` sees it: nothing.
//!
//! A program on this arm is a whole Rust program — the `use` lines it wrote and the `fn main` it
//! declared — compiled as a **binary crate** under the name below. gg writes no prologue, no
//! epilogue, no entry point and no import, so `rustc` reads the bytes the model sent and reports
//! every diagnostic in the model's own coordinates. There is nothing here to subtract.
//!
//! What is left in this file is the two names a compile is written under, the declarations that put
//! a **code module** in scope below the program, and the reading of a module's own exports. Code
//! modules are the one thing gg still writes into the entry file, and they go *below* the model's
//! last line — see [`module_declarations`].

use crate::sandbox::CodeModule;

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
/// `gg::files::read_file`, `use gg::views;`. `--extern` puts it in the **extern prelude**, which is packaging on the same
/// terms a jar on a classpath is: it makes the crate reachable and puts no name in a program's own
/// scope. Everything under it is written either in full or under a `use` line the program wrote.
pub(super) const SDK_CRATE: &str = "gg";

/// The entry file for a model's `program`: the model's own bytes, with the code
/// [modules](CodeModule) in scope declared below them.
///
/// Byte-for-byte by construction when the agent has loaded no code modules, and line-preserving
/// always: the declarations come after everything the model wrote, so the model's line *n* is line
/// *n* of the file and no column moves at all.
pub(super) fn wrap(program: &str, modules: &[CodeModule]) -> String {
    format!("{program}{}", module_declarations(modules))
}

// ---------------------------------------------------------------------------------------------
// Code modules
// ---------------------------------------------------------------------------------------------

/// The file a code module is compiled under, given its binding key — `module_csv_tools.rs`.
///
/// A fixed name per key inside a workspace that is private per preparation, on the same terms
/// [`PROGRAM_FILE`] is. The key is already a Rust identifier ([`binding_name`](super::binding_name))
/// so it cannot produce a path component that is not one.
pub(super) fn module_file(key: &str) -> String {
    format!("module_{key}.rs")
}

/// The declarations that put every module in scope at `lib::<key>`, written below the program.
///
/// Two items per module rather than one, and the shape is forced by `#[path]`'s own resolution
/// rules: a `#[path]` on a `mod` **inside an inline module block** of a crate root is resolved
/// relative to a directory named after the inline module, so `mod lib { #[path = "…"] pub mod x; }`
/// would send `rustc` looking in `lib/`. Declaring each module at the crate root — where `#[path]`
/// is relative to the file's own directory — and re-exporting it into `lib` puts the file where it
/// is and the name where a model was told it would be.
///
/// `lib` is a module rather than an object because that is what a namespace is in Rust:
/// `lib::csv_tools::parse(…)` is a path, checked at compile time, and a key that does not exist is a
/// diagnostic on the turn that wrote it rather than a failure at run time. That is the divergence
/// from every interpreted arm, where `lib.csvTools` is a property looked up on a value the guest
/// built — and it is spelling rather than identity: the same modules, bound under the same keys.
///
/// Empty for an agent that has loaded nothing, which is what makes [`wrap`] the identity function
/// on an ordinary program. [Ruling D5](https://docs.testcabinet.ai/gg/responses-as-code/invariants/)
/// is what admits these two items into a file gg otherwise writes nothing into: a code module's
/// binding is outside the authorship rule.
fn module_declarations(modules: &[CodeModule]) -> String {
    if modules.is_empty() {
        return String::new();
    }
    let mut declared = String::new();
    let mut exported = String::new();
    for module in modules {
        declared.push_str(&format!(
            "#[path = {:?}] mod {MODULE_PREFIX}{};\n",
            module_file(&module.name),
            module.name
        ));
        exported.push_str(&format!(
            "    pub(crate) use super::{MODULE_PREFIX}{0} as {0};\n",
            module.name
        ));
    }
    format!("{declared}#[allow(unused_imports)] mod lib {{\n{exported}}}\n")
}

/// What the crate-root declaration of a code module is named, so that a module called `lib`, or one
/// called the same thing as an item the model's own program declares at the top level, cannot
/// collide with it.
const MODULE_PREFIX: &str = "__gg_module_";

/// The names a code module's namespace offers, in source order — what the reply that binds it tells
/// the model it may call.
///
/// Read from the module's **own source** rather than out of anything the compiler produced, for the
/// reason every other arm reads its own: these are what the skill's author is *told* the namespace
/// holds, and a second reading of the same fact is a second chance for the two to disagree.
///
/// A public item at the module's top level is one of its names, whatever kind it is — `pub fn`,
/// `pub struct`, `pub enum`, `pub const`, `pub static`, `pub type`, `pub trait`, `pub mod`, and the
/// restricted forms (`pub(crate)`, `pub(super)`) that are still visible to the program, since a
/// module and its program are one crate here. That is wider than the function lists the interpreted
/// arms report, and it is right: a Rust module whose namespace is a `struct` and its `impl` offers
/// that type, and a listing that named only its functions would be describing something else.
///
/// The scan is lexical and **unindented-only**, like every other reading in this arm: a `pub fn`
/// nested inside an `impl` or a `mod` is indented, is not a name the program reaches directly, and
/// is not reported.
pub(super) fn exports(source: &str) -> Vec<String> {
    let mut names = Vec::new();
    for line in source.lines() {
        if line.starts_with([' ', '\t']) {
            continue;
        }
        let Some(name) = exported_name(line) else {
            continue;
        };
        if !names.iter().any(|seen| seen == name) {
            names.push(name.to_string());
        }
    }
    names
}

/// The name `line` makes public, if it makes one.
fn exported_name(line: &str) -> Option<&str> {
    let rest = line.trim().strip_prefix("pub")?;
    // `pub(crate)`, `pub(super)`, `pub(in …)` — visible to the program, which is in the same crate.
    let rest = match rest.strip_prefix('(') {
        Some(inner) => inner.split_once(')')?.1,
        None => rest,
    };
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
    (end > 0).then(|| &after[..end])
}

/// The item keywords whose declaration names something a program may reach through `lib::<key>`.
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
