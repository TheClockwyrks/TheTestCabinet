//! **Python** — gg's third registered [program language](super::ProgramLanguage), and the first
//! whose guest carries its own interpreter rather than an engine gg lowers a program into.
//!
//! Everything this arm owns lives here or in one of this module's siblings:
//!
//! * [`prepare_program`](Python::prepare_program) — nothing at all, deliberately: the source crosses
//!   the membrane as the model wrote it and CPython is the first thing to read it. What the guest
//!   evaluates it in is a namespace with nothing in it, so the SDK is reached through the
//!   [import](SURFACE_IMPORT) the program writes and the agent's own code modules through
//!   [theirs](LIB_IMPORT);
//! * [`modules`] — reading a code [skill](crate::skills)'s or [memory](crate::memories)'s own top
//!   level to say what its namespace offers;
//! * [`mask`] — the byte-level code mask [`modules`] reads, so a name written into a string or
//!   a docstring is never taken for a declaration;
//! * [`COMPONENT`] — the `componentize-py` guest, CPython 3.14 linked
//!   against `crates/gg/wit/gg-sandbox.wit`, built by `packages/gg-sandbox-python/build.sh`;
//! * the **signature catalogue** — reflected out of that guest's hand-written SDK with `griffe`,
//!   Python's own documentation tool, and generated into this build's `OUT_DIR` rather than
//!   committed anywhere (see `crates/gg/build.rs`).
//!
//! # Eval in the guest: what this arm has instead of a compiler
//!
//! Both ECMAScript arms hand the guest something gg produced: a parse, a type-strip, and — for
//! [TypeScript](super::typescript) — a `tsc` pass over the model's own source. This arm hands the
//! guest the model's bytes. There is no host-side Python, so there is nothing between the reply and
//! `compile(program, "program.py", "exec")` inside the component, and three things follow from that
//! rather than from a preference:
//!
//! * **[`checker`](Python::checker) is `None`.** Nothing judges a program before it runs, so
//!   [`SandboxOutcome::compile`](crate::sandbox::SandboxOutcome::compile) is absent rather than
//!   `Some(0)` — "there is no compiler on this path" is a different claim from "compiled, in under
//!   a millisecond", and a study comparing a checked arm against an unchecked one is a study about
//!   exactly that difference. It is the peer of [JavaScript](super::javascript) in that respect and
//!   of nothing else.
//! * **A syntax error arrives from the guest, not from the prepare step.** It is reported as a
//!   located [`ProgramError`](crate::sandbox::ProgramError) carrying CPython's own message and the
//!   program's own line and column, rather than as a
//!   [`PrepareError::Syntax`](super::PrepareError::Syntax). The model reads the same thing either
//!   way; the [turn error](crate::limits::TurnErrorType) it is recorded under is the run-time band
//!   rather than the `transpile` one, and that is the honest recording for an arm where nothing
//!   read the program before it ran.
//!
//! Adding a Python parser to the host was considered and rejected. It would buy the `transpile`
//! band and a marginally earlier diagnostic, and it would cost the one thing that cannot be
//! recovered: a *second* implementation of Python's grammar, lagging the interpreter that actually
//! runs the program, refusing valid programs written in syntax the guest accepts. CPython 3.14
//! accepts template strings; no third-party parser does yet. A false rejection is a turn the model
//! spends rewriting a correct program, which is the misattribution this codebase spends the most
//! effort not making.
//!
//! # Why the guest is a componentized CPython
//!
//! `componentize-py` links a real CPython against gg's WIT world directly, so the wire needed
//! nothing added to it and the run container needs nothing installed in it — a program crosses as a
//! string and the interpreter is already inside the artifact. The cost is the artifact: ~24 MiB
//! against the ECMAScript guest's 13.4 MB, because it carries an interpreter, a curated standard
//! library and the SDK. The build is **not byte-reproducible** — it snapshots a running
//! interpreter's memory — so a test holds it to a size band rather than to a hash. That is also why
//! this arm could never have been covered by a regenerate-and-diff gate, and therefore part of the
//! reason the component is cut by the build rather than committed: two runs of one checkout differ
//! by tens of kilobytes, so "rebuild it and compare" answers nothing. Its `build.sh` says so.
//!
//! What a program may `import` is settled by that build and by nothing at run time: the entry
//! module's import closure is what gets baked, so `packages/gg-sandbox-python/src/library.py` *is*
//! the library set. Around ninety modules — a **curated subset** of the standard library, not all
//! of it — plus two pinned pure-Python wheels are in; `asyncio`, `subprocess` and `multiprocessing`
//! are deliberately out.
//!
//! That set is model-facing text about this arm, so it obeys the rule the catalogue exists for: the
//! reflector reads those imports and emits them as the catalogue's
//! [`libraries`](crate::sandbox::signatures::SignatureCatalogue) section, which is structured data
//! gg hands a model at the moment an import of something else fails rather than a list standing in
//! front of every program. Nothing here describes the set in prose — the sentence that once did
//! claimed a whole standard library that was never baked.

use std::sync::OnceLock;

use test_cabinet_core::gg::GgProgramLanguage;

use crate::sandbox::signatures::SignatureCatalogue;

use super::{
    CodeModule, FileWindow, PrepareContext, PrepareFailure, PreparedModule, PreparedProgram,
    ProgramLanguage, spell,
};

/// The one line a program writes to reach gg's surface, and the line every module of this arm's
/// catalogue states.
///
/// `gg` is an ordinary Python package baked into the guest, so this is an ordinary import and the
/// name it binds is the package itself. Everything gg quotes back at a model is written from that
/// package root — `gg.files.read_file` in a search hit, in a documentation view, in a refusal and in
/// the programs gg synthesizes — so one line makes every string a model reads a string it can type.
///
/// [`LIB_IMPORT`] is the other line, and it is the agent's own code rather than gg's surface.
pub(super) const SURFACE_IMPORT: &str = "import gg";

/// The line a program writes to reach the code [skills](crate::skills) and
/// [memories](crate::memories) this session has read.
///
/// `lib` is a package the guest supplies per turn out of the modules gg handed it, so it is reached
/// the way any other package is and the way [gg's own surface](SURFACE_IMPORT) is. Supplying it puts
/// no name in the program's scope and runs no line of a module: a program that writes no line for it
/// has no `lib`, and a module's body executes on the import that reaches it. The line is quoted in
/// the [documentation view](crate::docs) of the module and of each declaration it exports, which is
/// the moment it matters.
pub(super) const LIB_IMPORT: &str = "import lib";
use crate::docs::MAX_SEARCH_LIMIT;
use crate::sandbox::operations::{DOCS_SEARCH, VIEWS_OPEN_DOCS_VIEW, VIEWS_OPEN_FILE};

#[path = "python.modules.rs"]
mod modules;

#[path = "python.mask.rs"]
pub(super) mod mask;

/// The interpreter component: the Python guest in `packages/gg-sandbox-python`, built by that
/// package's `build.sh` with `componentize-py`.
///
/// **Embedded in the binary**, like every other guest, because gg is copied as a single file into an
/// ephemeral run container and must carry everything it needs with it. At ~25 MB it is the largest
/// thing gg carries, and that is the price of an arm whose guest is a whole language runtime; the
/// alternative — a compiler installed in the run image — is what the gg toolchain layer exists for,
/// and is exactly what this arm does not need.
///
/// It is not committed. `gg-artifact-python` runs that `build.sh` as a step of building this crate
/// and this line embeds what it wrote into that crate's `OUT_DIR`, so the guest a program is
/// evaluated in is baked out of the SDK sources in this checkout, on the build that compiles the
/// module describing it — the same guarantee, and the same idiom, as [`SIGNATURES`] below. This arm
/// bakes more into its guest than any other: `build.sh` vendors the wheels `requirements.txt` pins
/// and `componentize-py` keeps only the modules the shim's import closure actually reached, so what
/// is importable at run time is decided at build time. A stale component is therefore a *library
/// set* the prompt names at one version and the guest carries at another, which is not a shape any
/// build error would report.
pub(super) const COMPONENT: &[u8] = include_bytes!(concat!(
    env!("GG_ARTIFACTS_PYTHON"),
    "/python.component.wasm"
));

/// This arm's catalogue, reflected out of the SDK's own docstrings by
/// `packages/gg-sandbox-python/tools/signatures.py` with `griffe`.
///
/// It is not committed. `crates/gg/build.rs` runs that reflection as a step of building this
/// crate and this line embeds what it wrote into the build's own `OUT_DIR`, so what a model is
/// told about this arm is reflected out of the SDK sources in this checkout, on the build that
/// compiles the module telling it.
const SIGNATURES: &str = include_str!(concat!(
    env!("OUT_DIR"),
    "/signatures/python.signatures.json"
));

/// The parsed catalogue, parsed once per process.
static CATALOGUE: OnceLock<SignatureCatalogue> = OnceLock::new();

/// The one instance of this language. A unit struct, so the `static` costs nothing and coerces
/// straight to `&'static dyn ProgramLanguage`.
pub(super) static PYTHON: Python = Python;

/// Python: handed to the embedded `componentize-py` guest as the model wrote it, and evaluated
/// there by a CPython that is inside the artifact.
pub(super) struct Python;

impl ProgramLanguage for Python {
    fn id(&self) -> GgProgramLanguage {
        GgProgramLanguage::Python
    }

    fn display_name(&self) -> &'static str {
        GgProgramLanguage::Python.display_name()
    }

    /// **Nothing.** The source the guest evaluates is the source the model wrote.
    ///
    /// This is what "eval in the guest" means, and it is a whole answer rather than a placeholder:
    /// CPython is inside the component, so the first thing to read a Python program is the
    /// interpreter that runs it, and every diagnostic a host-side pass could produce is one the
    /// guest produces better — at the program's own coordinates, with the failing line quoted, in
    /// the interpreter's own words. See this module's documentation for the three consequences and
    /// for why a second Python grammar on the host would be a liability rather than a feature.
    ///
    /// It takes no [context](PrepareContext) because it opens nothing: this arm creates no
    /// workspace and spawns no process, so the ground the seam offers a preparation costs it not
    /// one syscall and the isolation gate (`language/isolation.rs`) has nothing to catch it doing.
    fn prepare_program(
        &self,
        source: &str,
        _modules: &[CodeModule],
        _context: &PrepareContext,
    ) -> Result<PreparedProgram, PrepareFailure> {
        Ok(PreparedProgram {
            source: source.to_string(),
            component: None,
        })
    }

    /// **None.** There is no host-side Python, so nothing judges a program before it runs.
    ///
    /// The peer of [JavaScript](super::javascript) in the one respect that matters to a study:
    /// programs on this arm report no compile time at all, because there is no compiler on the path
    /// to report one for.
    fn checker(&self) -> Option<&'static str> {
        None
    }

    /// The module's source unchanged, and the public names its own top level leaves behind.
    ///
    /// A Python module's namespace **is** its exports — there is no `export` keyword to read and
    /// nothing for gg to append — so the source crosses untouched and the shim binds whatever the
    /// module body defined. See [`modules`] for what is read out of it and for the one name it
    /// deliberately does not report.
    fn prepare_module(
        &self,
        _key: &str,
        source: &str,
        _context: &PrepareContext,
    ) -> Result<PreparedModule, PrepareFailure> {
        Ok(PreparedModule {
            source: source.to_string(),
            exports: modules::exports(source),
        })
    }

    /// `.py`, and nothing else.
    ///
    /// One extension, unlike the ECMAScript pair: nothing else in the registry can evaluate a Python
    /// module, so a skill whose code is spelled `skill.ts` is a skill this arm's agents are not
    /// offered — which is the ordinary case the seam is built for, rather than the exception those
    /// two arms happen to be.
    fn module_file_extensions(&self) -> &'static [&'static str] {
        &["py"]
    }

    /// [snake_case](self::binding_name) — this SDK's convention, and Python's.
    fn binding_name(&self, name: &str) -> String {
        binding_name(name)
    }

    fn guest_component(&self) -> Option<&'static [u8]> {
        Some(COMPONENT)
    }

    /// This language's catalogue, parsed once and checked to be **this** language's.
    ///
    /// Every registered language's build reflects one of these under its own stem into the one
    /// `OUT_DIR`, and each carries the language it was generated for; checking it here is what stops
    /// a catalogue written — or embedded — under the wrong stem from reaching a model as a system
    /// prompt describing a sandbox nobody has.
    fn catalogue(&self) -> &'static SignatureCatalogue {
        CATALOGUE.get_or_init(|| {
            let catalogue = SignatureCatalogue::parse(SIGNATURES)
                .expect("the generated signature catalogue is valid JSON of the expected shape");
            assert_eq!(
                catalogue.language,
                GgProgramLanguage::Python,
                "`signatures/python.signatures.json` was generated for another program language",
            );
            catalogue
        })
    }

    /// [`gg.views.open_file("src/main.py")`](self::open_file_statement), with the window as keyword
    /// arguments and no terminator — this language's idiom for all three of the things a
    /// synthesized statement gets to differ in.
    fn open_file_statement(&self, path: &str, window: Option<FileWindow>) -> String {
        open_file_statement(&spell(self, VIEWS_OPEN_FILE), path, window)
    }

    /// The statements, under the [import](SURFACE_IMPORT) that makes the call in them resolve.
    ///
    /// The default statement list would be a program with an unbound `gg` in it, which is the one
    /// thing a synthesized turn must not teach: gg pushes this into the agent's own transcript as an
    /// example of its own output.
    fn open_file_program(&self, views: &[(&str, Option<FileWindow>)]) -> String {
        let statements: Vec<String> = views
            .iter()
            .map(|(path, window)| self.open_file_statement(path, *window))
            .collect();
        format!("{SURFACE_IMPORT}\n\n{}", statements.join("\n"))
    }

    /// [A list of names and a `for` over
    /// it](self::open_docs_views_statement), each iteration opening one documentation view.
    fn open_docs_views_statement(&self, names: &[&str]) -> String {
        open_docs_views_statement(&spell(self, VIEWS_OPEN_DOCS_VIEW), names)
    }

    /// [`import lib`](LIB_IMPORT), whatever the key — the line a program writes to reach a loaded
    /// module, and the same mechanism the [SDK](SURFACE_IMPORT) is supplied by.
    ///
    /// Key-independent because `lib` is one package with a submodule per key, so
    /// [`lib.<key>.<name>`](super::ProgramLanguage::lib_access) resolves off that one line and
    /// `from lib import <key>` and `import lib.<key>` resolve off the package's own machinery.
    fn lib_import(&self, _key: &str) -> Option<String> {
        Some(LIB_IMPORT.to_string())
    }

    /// [One search and one `for` over a list](self::bootstrap_program), with both calls resolved
    /// from this language's own catalogue and the module filter written as a keyword argument.
    fn bootstrap_program(&self, modules: &[&str], docs: &[&str]) -> String {
        bootstrap_program(
            &spell(self, DOCS_SEARCH),
            &spell(self, VIEWS_OPEN_DOCS_VIEW),
            modules,
            docs,
        )
    }
}

// ---------------------------------------------------------------------------------------------
// The syntax this arm writes
// ---------------------------------------------------------------------------------------------

/// `csv-tools` → `csv_tools`, `my_helpers.v2` → `my_helpers_v2`, `9lives` → `_9lives`.
///
/// snake_case because that is what this SDK spells every other bound function in, so a program
/// reaching `lib.csv_tools.parse` reads like the rest of its own scope. Any separator — `-`, `.`,
/// or anything a name should not have had — becomes an underscore rather than surviving into an
/// identifier that would not parse; runs of them collapse, because `lib.csv__tools` is not a name a
/// model would write from memory. A name that is nothing but separators becomes `module`, and a
/// leading digit is prefixed, because the result has to be a valid identifier whatever the author
/// wrote.
///
/// Deliberately ASCII-only, though Python identifiers are Unicode: the key is read by the model in
/// the [documentation view](crate::docs) of the module and then typed out in every program that
/// uses it, and a name a model has to reproduce exactly is one that should have no characters it
/// could get wrong.
pub(super) fn binding_name(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut pending = false;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            if pending && !out.is_empty() {
                out.push('_');
            }
            pending = false;
            out.extend(ch.to_lowercase());
        } else {
            pending = true;
        }
    }
    if out.is_empty() {
        return "module".to_string();
    }
    if out.starts_with(|ch: char| ch.is_ascii_digit()) {
        out.insert(0, '_');
    }
    out
}

/// `open_file("src/main.py")`, or `open_file("src/main.py", offset=400, limit=200)` for a window —
/// with `open_file` already spelled by the language that asked.
///
/// Deliberately the plainest statement that does the job: no binding, no loop, no printing. It is
/// synthesized into the agent's own transcript and read by the model as an example of its own
/// output, so anything clever in it is a style the run did not intend to teach. The window is a pair
/// of **keyword arguments**, which is this language's idiom for optional arguments and the same
/// shape the system prompt teaches; the path is rendered through [`serde_json`] so a quote or a
/// backslash in one cannot produce a program that would not parse — Python's string literals accept
/// exactly the escapes JSON's do.
///
/// No trailing semicolon, because Python does not terminate a statement with one and a model shown
/// one in its own transcript would learn a habit its language does not have.
pub(super) fn open_file_statement(
    open_file: &str,
    path: &str,
    window: Option<FileWindow>,
) -> String {
    let path = serde_json::Value::String(path.to_string());
    match window {
        Some(window) => format!(
            "{open_file}({path}, offset={}, limit={})",
            window.offset, window.limit
        ),
        None => format!("{open_file}({path})"),
    }
}

/// A list of names and a `for` over it, each iteration opening one documentation view, under the
/// [import](SURFACE_IMPORT) the call in it needs.
///
/// A loop rather than one statement per name because the list is as long as the family — eleven
/// calls written out would be a program a model reads as a style to copy. The names are rendered
/// through [`serde_json`] for the reason a path is: a name carrying a quote would otherwise produce
/// a program that does not parse.
pub(super) fn open_docs_views_statement(open_docs_view: &str, names: &[&str]) -> String {
    let entries: String = names
        .iter()
        .map(|name| format!("    {},\n", serde_json::Value::String((*name).to_string())))
        .collect();
    format!(
        "{SURFACE_IMPORT}\n\nfunctions = [\n{entries}]\nfor name in functions:\n    \
         {open_docs_view}(name)\n"
    )
}

/// The opening turn: one search naming every module in `modules` at once, then one list of names
/// opened as documentation views, with a `for` over it.
///
/// **One** call rather than one per module, because the filter names a union — an entry in any of
/// them is a hit — so a whole granted surface is listed by a single lookup, and a loop asking module
/// by module would teach a model to spend a call on each of the things one call already answers. The
/// filter and the limit are **keyword arguments**, which is this language's idiom for optional ones
/// and what the module's own signatures are declared with; nothing is passed for the query, because
/// a search carrying a filter and no words is that filter's whole directory rather than a ranking.
///
/// The documentation views keep their list and their loop: that group is as long as the family gg
/// opens, and a dozen calls written out is a shape a model would copy for its own work.
///
/// An agent holding neither of the two modules the opening listing covers is handed an **empty**
/// `modules`, and the search is left out of the program altogether rather than written with nothing
/// to ask for: no query and no filter at all is `invalid-argument`, so the one program gg promises
/// ran would be the one program that failed.
///
/// A failed call raises and is left to, which is this arm's failure model: a bootstrap that caught
/// its own failure would be a worked example of swallowing one.
pub(super) fn bootstrap_program(
    search: &str,
    open_docs_view: &str,
    modules: &[&str],
    docs: &[&str],
) -> String {
    let quoted = |name: &str| serde_json::Value::String(name.to_string()).to_string();
    let listing = if modules.is_empty() {
        String::new()
    } else {
        let paths: Vec<String> = modules.iter().copied().map(quoted).collect();
        format!(
            "{search}(modules=[{}], limit={MAX_SEARCH_LIMIT})\n\n",
            paths.join(", ")
        )
    };
    let functions: String = docs
        .iter()
        .copied()
        .map(|name| format!("    {},\n", quoted(name)))
        .collect();
    format!(
        "{SURFACE_IMPORT}\n\
         \n\
         {listing}functions = [\n{functions}]\nfor name in functions:\n    \
         {open_docs_view}(name)\n"
    )
}

#[cfg(test)]
#[path = "python.test.rs"]
mod tests;

/// **The Python guest's execution substrate and its SDK**, driven end to end through gg's real
/// linker, membrane and store.
///
/// A second test file rather than more of [`tests`], because these are a different kind of test: each
/// one compiles a 25 MB component and instantiates it, which is seconds rather than microseconds,
/// where everything next door is a pure function over text.
#[cfg(test)]
#[path = "python.substrate.test.rs"]
mod substrate_tests;
