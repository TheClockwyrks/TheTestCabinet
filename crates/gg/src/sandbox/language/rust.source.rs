//! **What gg puts around a model's Rust** before `rustc` sees it: the entry file, the one shape it
//! refuses, and the single line of offset that keeps every diagnostic in the model's own
//! coordinates.

use crate::sandbox::PrepareError;

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
const EPILOGUE: &str = "\n;\n::core::result::Result::Ok(())\n}\n";

/// How many lines of [`PROLOGUE`] precede the model's first — the number every diagnostic's line is
/// moved back by, and the number the guest's panic hook is told.
pub(super) const LINE_OFFSET: usize = 1;

/// The entry file for a model's `program`, and nothing else.
///
/// Line-preserving by construction: the model's text is copied verbatim between a one-line prologue
/// and an epilogue that begins on a line of its own, so the model's line *n* is line *n + 1* of the
/// file and no column moves at all.
pub(super) fn wrap(program: &str) -> Result<String, PrepareError> {
    refuse_main(program)?;
    Ok(format!("{}\n{program}{EPILOGUE}", prologue()))
}

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
