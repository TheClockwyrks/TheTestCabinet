//! **Python** — gg's third registered [program language](super::ProgramLanguage), and the first
//! whose guest carries its own interpreter rather than an engine gg lowers a program into.
//!
//! Everything this arm owns lives here or in one of this module's siblings:
//!
//! * [`prepare_program`](Python::prepare_program) — nothing at all, deliberately: the source crosses
//!   the membrane as the model wrote it and CPython is the first thing to read it;
//! * [`modules`](self::modules) — reading a code [skill](crate::skills)'s or
//!   [memory](crate::memories)'s own top level to say what its namespace offers;
//! * [`healing`](self::healing) — the [dialect](crate::healing::Dialect) response healing asks its
//!   lexical questions of: the fence tags, the two predicates, the mask, and the three-part
//!   `asyncio` wrapper;
//! * [`PROMPT`] — the responses-as-code system prompt and the "nothing shown" notice, both written
//!   in Python's syntax;
//! * `guests/python.component.wasm` — the committed `componentize-py` guest, CPython 3.14 linked
//!   against `crates/gg/wit/gg-sandbox.wit`, built by `packages/gg-sandbox-python/build.sh`;
//! * `guests/python.signatures.json` — the catalogue reflected out of that guest's hand-written SDK
//!   with `griffe`, Python's own documentation tool.
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
//! * **No [`UnreachableTail`](super::UnreachableTail).** That measurement counts top-level
//!   statements written after a statement that *ends the program*, which in the ECMAScript arms is a
//!   top-level `return` — the program is evaluated as a function body there. Python has no top-level
//!   `return` and no statement that ends a module early, so the shape does not exist here rather
//!   than going unmeasured.
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
//! interpreter's memory — so a test holds it to a size band rather than to a hash, and rebuilding
//! to check whether the committed artifact is current does not work. Its `build.sh` says so.
//!
//! What a program may `import` is settled by that build and by nothing at run time: the entry
//! module's import closure is what gets baked, so `packages/gg-sandbox-python/src/library.py` *is*
//! the library set. Around ninety modules — a **curated subset** of the standard library, not all
//! of it — plus two pinned pure-Python wheels are in; `asyncio`, `subprocess` and `multiprocessing`
//! are deliberately out.
//!
//! That set is model-facing text about this arm, so it obeys the rule the catalogue exists for: the
//! reflector reads those imports and emits them as the catalogue's `libraries` section, and
//! [`PROMPT`] renders that section. Nothing here describes the set in prose — the sentence that once
//! did claimed a whole standard library that was never baked.

use std::sync::OnceLock;

use test_cabinet_core::gg::GgProgramLanguage;

use crate::sandbox::signatures::SignatureCatalogue;

use super::{
    FileWindow, PrepareContext, PrepareFailure, PreparedModule, PreparedProgram, ProgramLanguage,
    PromptDialect, VIEW_OPEN_DOCS_VIEW, VIEW_OPEN_FILE, spell,
};

/// Reading a module's own top level for the names it leaves behind.
#[path = "python.modules.rs"]
mod modules;

/// The lexical reading of a reply — Python's answers to healing's questions, which differ from the
/// ECMAScript arm's in three places for reasons its own module documentation gives.
#[path = "python.healing.rs"]
pub(super) mod healing;

/// The committed interpreter component: the Python guest in `packages/gg-sandbox-python`, built by
/// its `build.sh` with `componentize-py` and committed here, exactly as gg's other wasm guests are
/// committed alongside their sources.
///
/// **Embedded in the binary**, like every other guest, because gg is copied as a single file into an
/// ephemeral run container and must carry everything it needs with it. It is the largest thing gg
/// carries by some way, and that is the price of an arm whose guest is a whole language runtime;
/// the alternative — a compiler installed in the run image — is what the gg toolchain layer exists
/// for, and is exactly what this arm does not need.
pub(super) const COMPONENT: &[u8] = include_bytes!("../guests/python.component.wasm");

/// The committed catalogue, reflected out of the SDK's own docstrings by
/// `packages/gg-sandbox-python/tools/signatures.py` with `griffe`.
const SIGNATURES: &str = include_str!("../guests/python.signatures.json");

/// The parsed catalogue, parsed once per process.
static CATALOGUE: OnceLock<SignatureCatalogue> = OnceLock::new();

/// Everything gg *says* about a Python program that is written in Python's own syntax.
///
/// The two templates are embedded from `crates/gg/templates/`, exactly as every other gg prompt is.
/// Individual function spellings are **not** here and not in the templates either: every name and
/// signature they quote is resolved from this language's committed catalogue when the template
/// renders, so `fs.read_file` and `fs.readFile` each reach their own model without either being
/// written down twice.
static PROMPT: PromptDialect = PromptDialect {
    system_template: include_str!("../../../templates/system-code.python.hbs"),
    system_template_name: "system-code.python",
    nothing_shown_template: include_str!("../../../templates/code-nothing-shown.python.hbs"),
    nothing_shown_template_name: "code-nothing-shown.python",
};

/// The one instance of this language. A unit struct, so the `static` costs nothing and coerces
/// straight to `&'static dyn ProgramLanguage`.
pub(super) static PYTHON: Python = Python;

/// Python: handed to the committed `componentize-py` guest as the model wrote it, and evaluated
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
    /// workspace and spawns no process, so the seam's per-preparation ground costs it not one
    /// syscall and the [isolation gate](super::isolation) has nothing to catch it doing.
    fn prepare_program(
        &self,
        source: &str,
        _context: &PrepareContext,
    ) -> Result<PreparedProgram, PrepareFailure> {
        Ok(PreparedProgram {
            source: source.to_string(),
            // A Python module has no statement that ends it early — there is no top-level `return`
            // to write anything after — so the shape this field records does not exist on this arm.
            unreachable: None,
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
    /// module body defined. See [`modules`](self::modules) for what is read out of it and for the
    /// one name it deliberately does not report.
    fn prepare_module(
        &self,
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

    /// The committed catalogue, parsed once and checked to be **this** language's.
    ///
    /// Every registered language commits one of these under its own stem, and each carries the
    /// language it was generated for; checking it here is what stops a catalogue filed — or
    /// regenerated — under the wrong stem from reaching a model as a system prompt describing a
    /// sandbox nobody has.
    fn catalogue(&self) -> &'static SignatureCatalogue {
        CATALOGUE.get_or_init(|| {
            let catalogue = SignatureCatalogue::parse(SIGNATURES)
                .expect("the committed signature catalogue is valid JSON of the expected shape");
            assert_eq!(
                catalogue.language,
                GgProgramLanguage::Python,
                "`guests/python.signatures.json` was generated for another program language",
            );
            catalogue
        })
    }

    fn healing(&self) -> &'static dyn crate::healing::Dialect {
        &healing::PYTHON_DIALECT
    }

    fn prompt(&self) -> &'static PromptDialect {
        &PROMPT
    }

    /// [`view.open_file("src/main.py")`](self::open_file_statement), with the window as keyword
    /// arguments and no terminator — this language's idiom for all three of the things a
    /// synthesized statement gets to differ in.
    fn open_file_statement(&self, path: &str, window: Option<FileWindow>) -> String {
        open_file_statement(&spell(self, VIEW_OPEN_FILE), path, window)
    }

    /// [A list of names and a `for` over
    /// it](self::open_docs_views_statement), each iteration opening one documentation view.
    fn open_docs_views_statement(&self, names: &[&str]) -> String {
        open_docs_views_statement(&spell(self, VIEW_OPEN_DOCS_VIEW), names)
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
/// Deliberately ASCII-only, though Python identifiers are Unicode: the key is quoted back to the
/// model in the reply that binds it and then typed out by the model in every program that uses it,
/// and a name a model has to reproduce exactly is one that should have no characters it could get
/// wrong.
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

/// A list of names and a `for` over it, each iteration opening one documentation view.
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
    format!("functions = [\n{entries}]\nfor name in functions:\n    {open_docs_view}(name)\n")
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
