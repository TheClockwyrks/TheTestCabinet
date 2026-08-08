//! **What gg puts around a model's Rust** before `rustc` sees it: the entry file, the one shape it
//! refuses, the single line of offset that keeps every diagnostic in the model's own coordinates —
//! and the same three answers for a **code module**, which on this arm is a second file compiled
//! into the same crate.

use crate::sandbox::{CodeModule, PrepareError};

/// The file a program is compiled under, and the one its diagnostics are located in.
///
/// A fixed name inside a workspace that is private per preparation — which is the seam's rule, and
/// the reason the name may be fixed at all. It is also what the guest's panic hook compares
/// `Location::file()` against, so a panic raised inside a library gg linked is not attributed to
/// whichever of the model's lines happens to share its number.
pub(super) const PROGRAM_FILE: &str = "program.rs";

/// The crate name the program is compiled under.
///
/// Named rather than left to be derived from the file, because `rustc` derives it from the output
/// path and the output path is `program.wasm` — a coincidence that would silently change if the
/// artifact were ever renamed.
pub(super) const CRATE_NAME: &str = "program";

/// The crate a program is compiled against, as `--extern` names it.
///
/// One word, because it is the first word of every Rust program in the study: `gg::fs::read_file`,
/// `use gg::view;`.
pub(super) const SDK_CRATE: &str = "gg";

/// Everything gg writes **before** the model's first line — on exactly one line, which is the whole
/// of the arithmetic that keeps diagnostics located.
///
/// One line rather than twenty because every alternative is worse. Rewriting `rustc`'s spans by a
/// twenty-line offset is the same subtraction with more to get wrong; `#[line]` does not exist in
/// Rust; and leaving the offset uncorrected would put every diagnostic twenty lines below the code
/// it is about. So the wrapper is dense on purpose, a model never sees it, and the correction is
/// [`LINE_OFFSET`] — one.
///
/// What it does, in order: brings the SDK's whole surface into scope; declares the type the world's
/// `run` and `bound-tools` are exported on; installs the panic hook that gets a located failure out
/// of an aborting guest, telling it which file and how many lines of gg's own text precede the
/// model's; calls the model's program and reports an `Err` it returned; answers `bound-tools` out of
/// the SDK's own table; and invokes the `export!` macro the prebuilt library set carries, which is
/// what makes this crate *be* the component rather than a library inside one.
///
/// The import is a **glob**, and that is what makes it safe to write into someone else's program.
/// Rust lets an explicit `use` shadow a glob-imported name, so a model that writes `use std::fs;`
/// gets the standard library's `fs` and not this SDK's — where a list of explicit imports would have
/// made that program an `E0252` about a name gg introduced. It also means a program never opens with
/// an import line of its own: `fs::read_file("main.rs", ReadOptions::default())` is the first thing
/// a model can write.
///
/// `__gg_program`'s return type is what makes `?` work. A wrapper returning `()` would make the
/// operator a Rust author reaches for first a hard `E0277` on the first line of the first program of
/// the arm.
///
/// Built with `format!` rather than written out as a literal so the file name and the offset it
/// hands the guest are the same two constants everything else here reads. It must stay **one line**:
/// [`LINE_OFFSET`] is what it costs, and the assertion that it costs exactly that is a test.
fn prologue() -> String {
    format!(
        "use ::{SDK_CRATE}::prelude::*; \
         struct __GgProgram; \
         impl ::{SDK_CRATE}::bindings::Guest for __GgProgram {{ \
         fn run(_program: ::std::string::String, \
         _modules: ::std::vec::Vec<::{SDK_CRATE}::bindings::CodeModule>, \
         _tools: ::std::vec::Vec<::std::string::String>, \
         _ending: ::{SDK_CRATE}::bindings::EndingKind, \
         _library: bool) {{ \
         ::{SDK_CRATE}::program::begin({PROGRAM_FILE:?}, {LINE_OFFSET}); \
         if let ::core::result::Result::Err(failure) = __gg_program() {{ \
         ::{SDK_CRATE}::program::report(&failure); }} }} \
         fn bound_tools() -> ::std::vec::Vec<::std::string::String> {{ \
         ::{SDK_CRATE}::program::bound_tools() }} }} \
         ::{SDK_CRATE}::bindings::export!(__GgProgram); \
         fn __gg_program() -> ::core::result::Result<(), ::{SDK_CRATE}::Failure> {{"
    )
}

/// What gg writes **after** the model's last line.
///
/// It opens with a `;` on a line of its own, which is not decoration: a program whose last line is a
/// trailing expression (`total`, `values.len()`) would otherwise run straight into the `Ok(())` and
/// fail to parse — a syntax error in gg's wrapper reported against the model's own last line. The
/// separator makes a trailing expression a statement, which is what a program's last line means
/// here anyway: a value a program computes and does not open a view of is discarded.
///
/// Everything gg adds that is not part of the program's body goes **here**, below the model's last
/// line, and that is the whole reason the [module declarations](module_declarations) are written
/// after it rather than before the prologue: an item added above the model's text would move every
/// line of it and falsify [`LINE_OFFSET`].
const EPILOGUE: &str = "\n;\n::core::result::Result::Ok(())\n}\n";

/// How many lines of [`prologue`] precede the model's first — the number every diagnostic's line is
/// moved back by, and the number the guest's panic hook is told.
pub(super) const LINE_OFFSET: usize = 1;

/// The entry file for a model's `program`, with the code [modules](CodeModule) in scope declared
/// below it.
///
/// Line-preserving by construction: the model's text is copied verbatim between a one-line prologue
/// and an epilogue that begins on a line of its own, so the model's line *n* is line *n + 1* of the
/// file and no column moves at all — and the module declarations come after all of it, where they
/// move nothing.
pub(super) fn wrap(program: &str, modules: &[CodeModule]) -> Result<String, PrepareError> {
    refuse_main(program)?;
    Ok(format!(
        "{}\n{program}{EPILOGUE}{}",
        prologue(),
        module_declarations(modules)
    ))
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

/// Everything gg writes **before** a code module's first line — the same one-line glob the program
/// gets, for the same reason and with the same [offset](LINE_OFFSET).
///
/// A module is its own file, so nothing the program imported reaches it: without this, a skill's
/// code could not call `fs::read_file` at all. It is the same glob rather than a list, so a module
/// that writes `use std::fs;` wins over gg's `fs` exactly as a program does.
fn module_prologue() -> String {
    format!("use ::{SDK_CRATE}::prelude::*;")
}

/// A code module's own file: the one-line prologue, then the author's source verbatim.
///
/// This is what [`PreparedModule::source`](crate::sandbox::PreparedModule) carries on this arm, and
/// it is **source rather than an artifact** — which is what a compiled arm's module has to be. A
/// module cannot be compiled into anything reachable on its own: Rust links, so the only artifact a
/// module can end up in is the artifact of a program that was built against it, and that program is
/// compiled a turn later by [`wrap`]. What the module's own preparation buys is the *check* — the
/// author gets `rustc`'s diagnostic at the read, in the module's own coordinates, rather than a
/// program that stops compiling for reasons in somebody else's file.
pub(super) fn wrap_module(source: &str) -> String {
    format!("{}\n{source}", module_prologue())
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
/// Empty for an agent that has loaded nothing, so an ordinary program's entry file is exactly what
/// it was before code modules existed.
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

/// Refuse a program that defines `fn main` and expects gg to call it.
///
/// There is no `main` on this arm. A program is a **sequence of statements**, as on every gg arm but
/// PureScript, and the statements are what run — so a model that put its work inside `fn main` has
/// written a local function nothing calls, and gg would report a clean turn over a program that did
/// nothing. Round 1 of this project established that a silent discard is the one failure a model
/// cannot recover from, and this is exactly that shape.
///
/// Refused rather than *called*, which is the tempting alternative. Calling it would mean a program
/// with both statements and a `main` runs both, in an order gg chose, and a model debugging why its
/// output appeared twice would be debugging gg's wrapper.
///
/// The scan is deliberately shallow: a line whose own text begins the definition. A `fn main` inside
/// a string literal or behind a line comment does not begin a line's text and is not matched, and a
/// `fn main` nested inside a `mod` the model wrote is — which is correct, because gg would not call
/// that one either.
fn refuse_main(program: &str) -> Result<(), PrepareError> {
    let Some((number, _)) = program
        .lines()
        .enumerate()
        .find(|(_, line)| defines_main(line))
    else {
        return Ok(());
    };
    Err(PrepareError::Unsupported(format!(
        "line {}: your program defines `fn main`, and gg does not call it. A program on this arm \
         is a sequence of statements evaluated in order, the way the body of a function is — so \
         write the work at the top level and it runs. Everything Rust allows in a function body is \
         allowed here: `use`, `struct`, `enum`, `impl`, `fn`, `const` and `#[derive(…)]` all work \
         where you wrote them. Move `main`'s body out to the top level and delete it.",
        number + 1
    )))
}

/// Whether `line`'s own text begins a definition of `main`.
fn defines_main(line: &str) -> bool {
    let mut line = line.trim_start();
    // The modifiers a `main` can legally carry here, in the order Rust admits them. `const` and
    // `unsafe` are included because a model that wrote either still wrote a function nothing calls.
    for modifier in [
        "pub(crate)",
        "pub(super)",
        "pub",
        "const",
        "async",
        "unsafe",
    ] {
        if let Some(rest) = line.strip_prefix(modifier)
            && rest.starts_with(char::is_whitespace)
        {
            line = rest.trim_start();
        }
    }
    let Some(rest) = line
        .strip_prefix("fn")
        .filter(|rest| rest.starts_with(char::is_whitespace))
    else {
        return false;
    };
    // `fn main(` and `fn main<`; not `fn mainline(`, and not a `fn main` that is the start of a
    // longer identifier this line goes on to finish.
    rest.trim_start()
        .strip_prefix("main")
        .is_some_and(|tail| tail.starts_with('(') || tail.starts_with('<'))
}

#[cfg(test)]
#[path = "rust.source.test.rs"]
mod tests;
