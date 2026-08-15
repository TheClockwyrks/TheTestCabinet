//! **The fixture language** — a second [`ProgramLanguage`] that exists only under `#[cfg(test)]`,
//! so that the seam has more than one implementation to be an abstraction *over*.
//!
//! # Why a fixture language exists at all
//!
//! A trait with exactly one implementation is not an abstraction; it is one implementation wearing a
//! trait, and nothing distinguishes the two until a second one arrives. Every property the
//! [seam](super) claims — that the healing skeleton asks a dialect rather than knowing TypeScript's
//! answers, that the source gg writes on a model's behalf is written in that model's own language,
//! that one language's embedded artifacts cannot reach another's consumer, that the
//! [capability gate](super::agreement) can be made to reject a surface at all —
//! is unfalsifiable while TypeScript is the only thing that implements it. The fixture is what
//! makes them falsifiable, a workflow before a second real language exists rather than a workflow
//! after.
//!
//! A second language being registered did **not** retire it. [`JavaScript`](super::javascript) is
//! TypeScript's arm with the type check removed: it shares that language's component, catalogue
//! spellings, strip and dialect by design, so asking it any of the questions above gets
//! TypeScript's answer back and proves nothing about who was asked. The fixture answers every one
//! of them differently, which is the whole of what it is for.
//!
//! # What it is
//!
//! A stand-in for the *shape* a second language would take, deliberately not an imitation of any
//! particular one:
//!
//! * **It offers gg's whole capability surface in a shape no registered arm chose.** The catalogue
//!   is [reshaped](reshape), at test time, out of a registered arm's committed one: every name is
//!   re-spelled in snake_case, one module is renamed, an operation is moved into a module of the
//!   fixture's own making, two free functions become methods on the types they operate on, and one
//!   operation is bound a second time as an alias. Nothing about which *operation* an entry binds
//!   changes, because that is the one thing the [gate](super::agreement) holds an arm to.
//!
//!   That combination is the whole point. The gate must **pass** a surface that offers the same
//!   capabilities in another shape — a different module, a different receiver, a different kind of
//!   declaration, a different number of functions — and must **fail** a surface missing one of
//!   them. A fixture that only re-spelled names could show the first half only for spelling, which
//!   is the dimension nothing was ever in danger of over-constraining.
//!
//!   It is derived rather than frozen, and that is what keeps it from rotting: a gg tool added
//!   tomorrow becomes an operation, the source arm binds it, and the fixture binds it too. The
//!   surface it is cut from does not matter and is not asserted — every arm commits the same
//!   normalized model — beyond its being one whose functions are free functions, so that the
//!   reshape into methods has somewhere to start.
//! * **Its syntax is line-oriented**: `#` starts a comment, `use x` imports, `def f` declares, and
//!   `??` is not a token. Nothing evaluates it — no component is ever compiled from
//!   [`guest_component`](ProgramLanguage::guest_component) — because everything under test here
//!   happens strictly *before* a guest: preparing, healing, prompting, cataloguing.
//! * **It has no wire id.** [`id`](ProgramLanguage::id) panics, on purpose: a
//!   [`GgProgramLanguage`](test_cabinet_core::gg::GgProgramLanguage) is a value an operator
//!   configures, a run records and a study slices by, and a fixture that could be named in a config
//!   file would be a fixture that could be *run*. The panic is also load-bearing as a test: it is
//!   what proves the fixture never reaches the one production path that keys on the wire id — the
//!   [component cache](crate::sandbox::engine) — because that path would panic loudly rather than
//!   quietly serving it TypeScript's compiled component out of TypeScript's slot.
//!
//! # Where it is *not*
//!
//! It is not in [`language`](super::language), not in [`all_languages`](super::all_languages), and
//! not reachable from any `cfg`-free path. `all_languages()` stays derived from
//! `GgProgramLanguage::ALL`, so the gates that iterate it keep costing exactly what the registered
//! set costs, and no production reader can be handed a language that does not exist.
//! [`fixture_languages`](super::fixture_languages) is the one accessor, `#[cfg(test)]` like
//! everything here, and the gates that walk every arm chain it on so that each of them is asked of a
//! surface no registered arm could have answered for.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use serde_json::{Value, json};
use test_cabinet_core::gg::GgProgramLanguage;

use crate::healing::{CodeMask, Dialect};
use crate::sandbox::signatures::SignatureCatalogue;

use super::{
    CodeModule, FileWindow, PrepareContext, PrepareError, PrepareFailure, PreparedModule,
    PreparedProgram, ProgramLanguage, spell,
};
use crate::docs::MAX_SEARCH_LIMIT;
use crate::sandbox::operations::{DOCS_SEARCH, VIEWS_OPEN_DOCS_VIEW, VIEWS_OPEN_FILE};

/// **The surface the fixture's own is reshaped out of** — a registered arm's catalogue, embedded
/// straight from the build's `OUT_DIR` rather than reached for through
/// [`TypeScript`](super::typescript), which keeps this module from needing anything of another
/// language's module to be public.
///
/// It is the same generated file that arm embeds, and it exists at compile time for the same reason:
/// `crates/gg/build.rs` reflects every arm's catalogue out of its SDK on the build that compiles
/// this. So the fixture is cut from a *live* surface, not from a snapshot of one — which is the
/// point of cutting it from a real arm at all.
///
/// Which arm it is does not matter and is not asserted, with one exception that is about the
/// reshape rather than about the arm: its functions are free functions, so [`reshape`] has somewhere
/// to start when it turns two of them into methods. Its `language` field says `typescript` and the
/// fixture is not TypeScript — the field is the wire enum, the fixture has no value in it, and that
/// is why catalogue provenance is asserted over *registered* languages only.
const SOURCE_SIGNATURES: &str = include_str!(concat!(
    env!("OUT_DIR"),
    "/signatures/typescript.signatures.json"
));

/// The stub that stands where a real language's component would be.
///
/// It is not a component and is never compiled: every consumer exercised against the fixture works
/// on text and catalogues, strictly before a guest. It is deliberately *different bytes* from
/// TypeScript's, which is what the "no language serves another's artifacts" assertion compares.
const COMPONENT: &[u8] = b"gg fixture language: not a component, never compiled";

/// What the agreeing fixture calls the thing that judges its programs — deliberately not `tsc`.
///
/// A checker's *name* is a spelling like every other, and this is the second one, so "gg names the
/// language's own compiler" is an observation over two answers rather than a restatement of
/// TypeScript's.
pub(crate) const FIXTURE_CHECKER: &str = "fxc";

/// The word that makes this language's "checker" reject a program it parsed cleanly — the fixture's
/// stand-in for a type error, which is the failure a checked language has and TypeScript does not.
pub(crate) const MISTYPED: &str = "mistyped";

/// The word that makes this language's "compiler" fall over instead of answering — the fixture's
/// stand-in for a `swiftc` that segfaults, a compile killed by its timeout, or a toolchain binary
/// that is not in the image. Nothing is decided about the program.
pub(crate) const NO_COMPILER: &str = "nocompiler";

/// The word that makes this language accept a source and then fail to carry it any further — the
/// fixture's stand-in for a transform of gg's own falling over, or gg's generated surface being
/// rejected by the very checker gg wrote it for.
///
/// Held apart from [`NO_COMPILER`] because the two are read by different people: a compiler missing
/// from the image is the operator's to fix, and this is a bug report about gg. What they share is
/// the half that matters to a model — its source was **not** judged — which is exactly the
/// distinction a consumer of the seam is liable to lose, since the diagnostic this carries *looks*
/// like a compiler's.
pub(crate) const UNLOWERABLE: &str = "unlowerable";

// ---------------------------------------------------------------------------------------------
// The language
// ---------------------------------------------------------------------------------------------

/// A second implementation of the [seam](ProgramLanguage), for tests only.
///
/// The catalogue is per instance rather than per process because the [teeth
/// tests](super::agreement) need instances that *disagree*: [`a_language_whose_catalogue`] hands
/// back a fixture built from a deliberately damaged catalogue, and each one has to be able to
/// coexist with the agreeing one inside a single test.
pub(crate) struct FixtureLanguage {
    /// This instance's catalogue, leaked so it can be handed out as `&'static`.
    catalogue: &'static SignatureCatalogue,
    /// What this instance answers [`checker`](ProgramLanguage::checker) with.
    ///
    /// Per instance because both answers need a subject, and one of them needs a subject the
    /// registry cannot supply: [`JavaScript`](super::javascript) names no checker, but it is
    /// TypeScript's arm rather than an independent implementation, so the free branch of the seam
    /// would be exercised only by a language that shares the checked one's every other answer.
    ///
    /// The name is deliberately not `tsc`. A second language that checks its programs and calls its
    /// checker something else is the only thing that can show gg is telling a model *its* compiler's
    /// name rather than TypeScript's.
    checker: Option<&'static str>,
}

impl ProgramLanguage for FixtureLanguage {
    /// **Panics.** The fixture has no wire id; see this module's documentation for why that is the
    /// design rather than an omission.
    fn id(&self) -> GgProgramLanguage {
        panic!(
            "the fixture language has no wire id: it is never configured, resolved, recorded or \
             compiled, and anything that keys on `GgProgramLanguage` is a path it must not reach"
        )
    }

    fn display_name(&self) -> &'static str {
        "Fixture"
    }

    /// Strip comments, refuse an import, refuse a token the fixture's grammar does not have — and
    /// stand in for the two failures only a **compiled** language has.
    ///
    /// Deliberately unlike TypeScript's in both directions: a `#` comment prepares cleanly here and
    /// is a syntax error there, while a type annotation is erased there and passed through
    /// untouched here. That asymmetry is what the "preparation is the language's" assertions read.
    ///
    /// The last three checks are the fixture's whole reason for declaring that it
    /// [compiles](Self::prepare_compiles). A source mentioning [`MISTYPED`] is a program this
    /// language's checker read and rejected — a [`PrepareError::Compile`], which the model is shown
    /// and can fix. A source mentioning [`NO_COMPILER`] is the compiler itself falling over — a
    /// [`PrepareFailure::Toolchain`], which the model is *not* blamed for. A source mentioning
    /// [`UNLOWERABLE`] is gg's own side of the seam falling over on a source this language had
    /// already accepted — a [`PrepareFailure::Lowering`], which the model is not blamed for either
    /// and which is nevertheless a different person's bug. No registered language produces any of
    /// them yet, so without a fixture that does, the split between them would be a taxonomy nothing
    /// had ever exercised.
    ///
    /// The checked instance also does what a compiled language really does with its
    /// [context](PrepareContext): it writes the source into its own private
    /// [workspace](super::Workspace) and reads the artifact back out of it, so the seam's
    /// per-preparation ground has a user under test that is not TypeScript's `tsc`, and so the
    /// [isolation gate](super::isolation) is driving a preparation that really touches a filesystem.
    /// The unchecked instance touches nothing, because a language that compiles nothing should pay
    /// nothing.
    fn prepare_program(
        &self,
        source: &str,
        _modules: &[CodeModule],
        context: &PrepareContext,
    ) -> Result<PreparedProgram, PrepareFailure> {
        if source.contains("??") {
            return Err(
                PrepareError::Syntax("`??` is not a token in this language".to_string()).into(),
            );
        }
        if let Some(line) = source.lines().find(|line| is_use(line)) {
            return Err(PrepareError::Unsupported(format!(
                "there is no module loader here, so `{}` cannot be resolved",
                line.trim()
            ))
            .into());
        }
        if source.contains(NO_COMPILER) {
            return Err(PrepareFailure::Toolchain(
                "`fixturec` exited with signal 11 (SIGSEGV)".to_string(),
            ));
        }
        if source.contains(UNLOWERABLE) {
            return Err(PrepareFailure::Lowering(
                "the fixture's lowering pass could not rewrite an accepted source".to_string(),
            ));
        }
        if source.contains(MISTYPED) {
            return Err(PrepareError::Compile(format!(
                "line 1: `{MISTYPED}` is not assignable to `Word`"
            ))
            .into());
        }
        Ok(PreparedProgram {
            source: self.build(&strip_comments(source), context)?,
            component: None,
        })
    }

    /// Whatever this instance was built to answer.
    ///
    /// The agreeing fixture names one and stands in for the **compiled** shape of a second
    /// language — it compiles nothing, of course, since nothing here evaluates anything, but that is
    /// what makes "a language that compiles has its programs timed, including the one its compiler
    /// rejected" an assertion rather than a promise.
    /// [`a_language_that_does_not_compile`] names none, and is the subject of the opposite claim
    /// that owes nothing to a checked language's answers.
    fn checker(&self) -> Option<&'static str> {
        self.checker
    }

    /// A module's namespace is whatever it `def`s, and its prepared source says so in a trailing
    /// comment — the fixture's analogue of the `return { … }` epilogue TypeScript generates.
    fn prepare_module(
        &self,
        source: &str,
        context: &PrepareContext,
    ) -> Result<PreparedModule, PrepareFailure> {
        let prepared = self.prepare_program(source, &[], context)?;
        let exports: Vec<String> = prepared
            .source
            .lines()
            .filter_map(|line| line.trim().strip_prefix("def "))
            .map(|rest| {
                rest.split(['(', ' '])
                    .next()
                    .unwrap_or_default()
                    .trim()
                    .to_string()
            })
            .filter(|name| !name.is_empty())
            .collect();
        Ok(PreparedModule {
            source: format!("{}\n# exports: {}", prepared.source, exports.join(", ")),
            exports,
        })
    }

    /// One extension, and one nothing else claims: a language whose modules only its own runtime
    /// could evaluate is the ordinary case, and the seam is exercised against it precisely because
    /// the two registered languages happen to be the exception.
    fn module_file_extensions(&self) -> &'static [&'static str] {
        &["fixture"]
    }

    fn guest_component(&self) -> Option<&'static [u8]> {
        Some(COMPONENT)
    }

    fn catalogue(&self) -> &'static SignatureCatalogue {
        self.catalogue
    }

    fn healing(&self) -> &'static dyn Dialect {
        &FIXTURE_DIALECT
    }

    /// `csv-tools` → `csv_tools` — this language's own convention, and deliberately not
    /// TypeScript's, so "the binding key is the language's" is an assertion rather than a
    /// restatement of one implementation.
    fn binding_name(&self, name: &str) -> String {
        let out: String = name
            .chars()
            .map(|ch| {
                if ch.is_ascii_alphanumeric() {
                    ch.to_ascii_lowercase()
                } else {
                    '_'
                }
            })
            .collect();
        if out.is_empty() {
            "module".to_string()
        } else {
            out
        }
    }

    /// `view.open_file("src/main.fx")`, with a window as **keyword arguments** and no terminator.
    ///
    /// Deliberately unlike TypeScript's in all three of the ways a language is free to differ — the
    /// function's spelling, the idiom for an optional argument, and how a statement ends — which is
    /// what makes "the synthesized turn is written in the agent's own language" an assertion rather
    /// than a restatement of one implementation.
    fn open_file_statement(&self, path: &str, window: Option<FileWindow>) -> String {
        let open_file = spell(self, VIEWS_OPEN_FILE);
        let path = Value::String(path.to_string());
        match window {
            Some(window) => format!(
                "{open_file}({path}, offset={}, limit={})",
                window.offset, window.limit
            ),
            None => format!("{open_file}({path})"),
        }
    }

    /// One statement per name, with no list literal and no loop — deliberately unlike TypeScript's,
    /// because "the program gg generates is written in the agent's own language" is only an
    /// assertion while two languages generate different programs.
    fn open_docs_views_statement(&self, names: &[&str]) -> String {
        let open_docs_view = spell(self, VIEWS_OPEN_DOCS_VIEW);
        names
            .iter()
            .map(|name| format!("{open_docs_view}({})\n", Value::String((*name).to_string())))
            .collect()
    }

    /// One search per module and one view per name, with no list literal and no loop — deliberately
    /// unlike every registered arm's, because "the opening turn is written in the agent's own
    /// language" is only an assertion while two languages generate different programs.
    ///
    /// The filters are keyword arguments and nothing terminates a statement, which is this
    /// language's own idiom in both of the places it is free to have one.
    fn bootstrap_program(&self, modules: &[&str], docs: &[&str]) -> String {
        let search = spell(self, DOCS_SEARCH);
        let open_docs_view = spell(self, VIEWS_OPEN_DOCS_VIEW);
        let searched: String = modules
            .iter()
            .map(|path| {
                format!(
                    "{search}(\"\", module={}, limit={MAX_SEARCH_LIMIT})\n",
                    Value::String((*path).to_string())
                )
            })
            .collect();
        let opened: String = docs
            .iter()
            .map(|name| format!("{open_docs_view}({})\n", Value::String((*name).to_string())))
            .collect();
        format!("{searched}{opened}")
    }
}

impl FixtureLanguage {
    /// "Compile" `lowered` — which for this fixture means write it into this preparation's own
    /// workspace under a fixed name and read the artifact back out.
    ///
    /// A round trip through a file is a strange thing for a comment-stripper to do, and it is here
    /// on purpose: the [isolation gate](super::isolation) can only prove the seam's private ground
    /// works if something under test actually stands on it, and TypeScript's `tsc` is a subprocess
    /// with its own isolation. The fixed file name is the *point* — a language is
    /// meant to name its files whatever it likes and rely on the directory being its own, and a
    /// fixture that invented a unique name per preparation would be proving nothing.
    ///
    /// Only the checked instance does it. A language that names no compiler opens no workspace.
    fn build(&self, lowered: &str, context: &PrepareContext) -> Result<String, PrepareFailure> {
        if self.checker.is_none() {
            return Ok(lowered.to_string());
        }
        let workspace = context.workspace().map_err(PrepareFailure::Toolchain)?;
        let path = workspace
            .write("program.fx", lowered)
            .map_err(PrepareFailure::Toolchain)?;
        std::fs::read_to_string(&path).map_err(|error| {
            PrepareFailure::Toolchain(format!(
                "`{FIXTURE_CHECKER}` could not read back {}: {error}",
                path.display()
            ))
        })
    }
}

/// The one agreeing fixture: gg's whole capability surface, [reshaped](reshape).
pub(crate) fn fixture_language() -> &'static FixtureLanguage {
    static FIXTURE: OnceLock<FixtureLanguage> = OnceLock::new();
    FIXTURE.get_or_init(|| FixtureLanguage {
        catalogue: leak(reshaped_catalogue(|_| {})),
        checker: Some(FIXTURE_CHECKER),
    })
}

/// The agreeing fixture's surface, from a language whose prepare step **compiles nothing**.
///
/// The subject of every assertion about the free branch of the seam: that such a language reports
/// `None` for what preparing a program cost, rather than `Some(0)`. The two are different claims —
/// "compiled, in under a millisecond" against "there is no compiler on this path at all" — and a
/// zero on every turn of every run would put a column of noise in front of the one study the field
/// exists for.
pub(crate) fn a_language_that_does_not_compile() -> &'static FixtureLanguage {
    static FIXTURE: OnceLock<FixtureLanguage> = OnceLock::new();
    FIXTURE.get_or_init(|| FixtureLanguage {
        catalogue: leak(reshaped_catalogue(|_| {})),
        checker: None,
    })
}

/// A fixture whose catalogue has been damaged by `edit` — the input to every assertion that the
/// [agreement gate](super::agreement) has teeth.
///
/// `edit` sees the catalogue **after** the reshape, so a row damages the surface an arm would really
/// commit rather than the one it was cut from.
///
/// Each call leaks one catalogue, which is what lets a single test hold a healthy fixture and a
/// damaged one at once. A test binary that runs a handful of these leaks a handful of catalogues
/// and then exits.
pub(crate) fn a_language_whose_catalogue(
    edit: impl FnOnce(&mut Value),
) -> &'static FixtureLanguage {
    Box::leak(Box::new(FixtureLanguage {
        catalogue: leak(reshaped_catalogue(edit)),
        checker: Some(FIXTURE_CHECKER),
    }))
}

/// Every fixture language, for the `#[cfg(test)]` consumers that must know about them — the gates
/// that walk every arm and would otherwise be walking one implementation eleven times.
pub(crate) fn fixture_languages() -> impl Iterator<Item = &'static dyn ProgramLanguage> {
    std::iter::once(fixture_language() as &'static dyn ProgramLanguage)
}

// ---------------------------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------------------------

/// The module the fixture files the wait-for-an-issue operation under — **a module of its own
/// making**, and the one an arm's grouping is proved free by.
///
/// gg's own vocabulary files that operation under `board`, and the source arm agrees. An arm is
/// nonetheless free to group its documentation how it likes: the cross-arm join is the operation
/// id, so a gate that noticed this at all would be a gate imposing gg's module layout on eleven
/// SDKs — which is the shape parity the whole reshape exists to retire.
const WAITING: &str = "waiting";

/// The module whose **path** the fixture renames, so that a module's id and the path a model reads
/// are demonstrably two strings rather than one.
const FILES: &str = "files";

/// What the fixture calls it — deliberately a word out of this arm's own vocabulary rather than
/// gg's, since a fixture that renamed a module to another of gg's names would be showing that a
/// grouping may be re-spelled rather than that it may be *chosen*.
const WORKSPACE: &str = "workspace";

/// The operation the fixture binds **twice**: once canonically, and once as an alias.
///
/// It is the case the schema's `aliasOf` was written for — a free function beside the method on the
/// type it operates on — so the fixture binds the method canonically and keeps the free function as
/// the second way in.
///
/// The canonical method takes **no parameters**: the view it closes is the receiver, which is the
/// shape a language with methods reaches for and the one the [gate](super::agreement::takes_input)
/// has to be able to accept. An arm that documents no argument because its argument is the thing
/// the call hangs off is not an arm that forgot to document one.
const CLOSE: &str = "views.close";

/// The operation the fixture turns into a **method on a handle**, renaming it in the process.
const SEND_MESSAGE: &str = "delegation.send_message";

/// The operation the fixture **moves into another module**.
const WAIT_FOR_ISSUE: &str = "board.wait_for_issue";

/// The source surface, [reshaped](reshape) and then damaged by `edit`, as JSON.
fn reshaped_catalogue(edit: impl FnOnce(&mut Value)) -> String {
    let mut document: Value =
        serde_json::from_str(SOURCE_SIGNATURES).expect("the source catalogue is valid JSON");
    reshape(&mut document);
    edit(&mut document);
    document.to_string()
}

/// **Turn a registered arm's surface into a second arm's**, in every dimension an idiomatic SDK is
/// free to differ in — and in none that it is not.
///
/// What moves:
///
/// * every module `path`, which loses the source arm's namespace prefix, and one of which
///   ([`FILES`]) is renamed outright to [`WORKSPACE`];
/// * every function's `name`, into snake_case, with the head of each of its signatures — which by
///   the catalogue's own rule begins with that name — following it;
/// * [`WAIT_FOR_ISSUE`], into a module ([`WAITING`]) the source arm does not have;
/// * [`SEND_MESSAGE`] and [`CLOSE`], from free functions into **methods** on the types they operate
///   on, the second of them losing its parameter list to its receiver and keeping the free function
///   it displaced as an alias;
/// * every fully-qualified name and every resolved type reference, so that the names still say where
///   the things are.
///
/// What does not move is the `operation` each entry binds. That is the one thing the
/// [gate](super::agreement) holds an arm to, so a fixture free to change it would be a fixture that
/// could not show the gate catching anything.
///
/// # Why it minds what the source arm already did
///
/// It is derived from a *real arm's* catalogue, reflected out of that arm's SDK on every build, so
/// the surface it is cut from changes under it — and the changes that matter are the ones in the
/// same direction as the reshape. The source arm has
/// since grown exactly the shapes this reshape produces: an `OpenView.close` method and a
/// `SubagentHandle.send` one, spelled the way the promotions below spell them. Conditioning each
/// promotion on the entry being the arm's **canonical** binding was not enough on its own, because
/// the arm's own method then survives beside the promoted one under the same fully-qualified name,
/// and the tests that read the fixture fail with a sentence about the *gate*.
///
/// So the reshape is a function of the source arm's **canonical bindings alone**: every second way
/// the arm offers is [dropped](displaced) before anything is re-spelled, and the one alias the
/// fixture has is the one cut here. That is what makes it blind to the direction the arm is
/// actually moving in — an arm may grow as many convenience helpers as its idiom wants, in whatever
/// spelling it wants, and this surface does not move — which is the one kind of drift it is
/// guaranteed to meet.
fn reshape(document: &mut Value) {
    displaced(document);
    let paths = modules(document);
    let resolved = types(document, &paths);

    let mut alias: Option<Value> = None;
    for function in document["functions"]
        .as_array_mut()
        .expect("the source catalogue files every call in `functions`")
    {
        let operation = string(&function["operation"]);
        // Every entry still here is one the source arm binds canonically, because [`displaced`]
        // dropped the rest before this loop began. So no promotion below has to ask, and none of
        // them can collide with a second way in that the arm happened to spell the same way.
        let mut name = snake_case(&string(&function["name"]));
        let mut module = string(&function["module"]);
        match operation.as_str() {
            SEND_MESSAGE => {
                function["kind"] = json!("method");
                function["receiver"] = json!("SubagentHandle");
                name = "send".to_string();
            }
            CLOSE => {
                function["kind"] = json!("method");
                function["receiver"] = json!("OpenView");
            }
            WAIT_FOR_ISSUE => {
                module = WAITING.to_string();
                function["module"] = json!(WAITING);
            }
            _ => {}
        }
        rename(function, &name);
        let path = paths.get(&module).unwrap_or(&module);
        function["fqn"] = json!(qualified(path, function["receiver"].as_str(), &name));
        for reference in references(function) {
            requalify(reference, &resolved);
        }
        if operation == CLOSE {
            // The free function the method displaced, kept as the second way to reach the one
            // operation — which is what an arm does when both spellings read well and neither is
            // worth withholding. It is cut **before** the method gives its argument up to its
            // receiver, so the two shapes differ in the way two real spellings of one capability
            // do: `close_view(selector)` names what to close, and `view.close()` is the view.
            let mut second = function.clone();
            second["aliasOf"] = json!(CLOSE);
            second["kind"] = json!("function");
            second["receiver"] = Value::Null;
            rename(&mut second, "close_view");
            second["fqn"] = json!(qualified(path, None, "close_view"));
            alias = Some(second);
            receive_the_argument(function, &name);
        }
    }
    if let Some(alias) = alias {
        document["functions"]
            .as_array_mut()
            .expect("an array")
            .push(alias);
    }
}

/// Drop every second way into an operation that the source arm offers, and every member function
/// its types list, leaving the arm's canonical bindings and nothing else.
///
/// This is what keeps the fixture still while the arm moves. The source arm offers five convenience
/// helpers today, two of them (`SubagentHandle.send` and `OpenView.close`) in exactly the shape the
/// promotions above produce and under exactly the fully-qualified name they produce it under — so
/// left in place they would be a second entry with one key, and the tests that read the fixture
/// would fail with a sentence about the *gate* rather than about the collision. Rather than special
/// -casing those two, the reshape takes its input from what an arm cannot vary: which operations it
/// binds canonically. Every alias it then has is one this file cut.
///
/// The member-function listings go with them, for the same reason a type's `fqn` is re-qualified:
/// a fixture listing members whose entries it does not carry would be describing a surface nobody
/// could call.
fn displaced(document: &mut Value) {
    document["functions"]
        .as_array_mut()
        .expect("the source catalogue files every call in `functions`")
        .retain(|function| function["aliasOf"].is_null());
    for declaration in document["types"].as_array_mut().expect("an array") {
        if let Some(members) = declaration["memberFunctions"].as_array_mut() {
            members.clear();
        }
    }
}

/// Hand one entry's argument list to its **receiver**: no documented parameters, and a signature
/// whose brackets are empty.
///
/// This is the shape the fixture exists to make the gate accept. A method whose receiver *is* the
/// thing the call operates on documents no argument and still takes input, which is idiomatic in
/// every language with methods and which a rule reading only the parameter list would read as an
/// arm that had forgotten to document one.
fn receive_the_argument(function: &mut Value, name: &str) {
    for shape in function["signatures"]
        .as_array_mut()
        .expect("every entry carries at least one signature")
    {
        let signature = string(&shape["signature"]);
        let tail = signature
            .find('(')
            .and_then(|open| signature[open..].find(')').map(|close| open + close + 1))
            .map_or("", |end| &signature[end..]);
        shape["signature"] = json!(format!("{name}(){tail}"));
        shape["parameters"] = json!([]);
    }
}

/// Re-spell every module's path, add the fixture's own [module](WAITING), and hand back the path
/// each module id now answers to.
fn modules(document: &mut Value) -> BTreeMap<String, String> {
    let mut paths: BTreeMap<String, String> = BTreeMap::new();
    let modules = document["modules"]
        .as_array_mut()
        .expect("the source catalogue declares its modules");
    for module in modules.iter_mut() {
        let id = string(&module["id"]);
        // The source arm nests everything under one namespace segment; this one does not, and one
        // module is renamed outright — a module's id is gg's word and its path is the arm's, and
        // two strings that are always equal are one string nobody has noticed yet.
        let path = match id.as_str() {
            FILES => WORKSPACE.to_string(),
            _ => string(&module["path"])
                .rsplit('.')
                .next()
                .expect("a path has a last segment")
                .to_string(),
        };
        module["path"] = json!(path);
        paths.insert(id, path);
    }
    modules.push(json!({
        "id": WAITING,
        "path": WAITING,
        "brief": "Wait on work somebody else was given.",
        "detail": null,
        "import": null,
    }));
    paths.insert(WAITING.to_string(), WAITING.to_string());
    paths
}

/// Re-qualify every declared type under its module's new path, and hand back the map from the name
/// each one used to answer to onto the one it answers to now.
fn types(document: &mut Value, paths: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    let mut resolved: BTreeMap<String, String> = BTreeMap::new();
    for declaration in document["types"].as_array_mut().expect("an array") {
        let module = string(&declaration["module"]);
        let name = string(&declaration["name"]);
        let path = paths.get(&module).unwrap_or(&module);
        let fqn = format!("{path}.{name}");
        resolved.insert(string(&declaration["fqn"]), fqn.clone());
        declaration["fqn"] = json!(fqn);
    }
    resolved
}

/// Every [type reference](crate::sandbox::signatures::TypeReference) one entry carries, in both
/// positions it carries them.
fn references(function: &mut Value) -> impl Iterator<Item = &mut Value> {
    // Filtered out of one walk of the entry rather than reached for by name twice, because both
    // arrays are `&mut` fields of one `Value` and the borrow checker will not hand out two at once.
    function
        .as_object_mut()
        .expect("an entry is an object")
        .iter_mut()
        .filter(|(key, _)| *key == "returns" || *key == "types")
        .filter_map(|(_, value)| value.as_array_mut())
        .flatten()
}

/// Point one type reference at the name its type now answers to, leaving the spelling a signature
/// writes exactly as it was — that half is what a model reads at the call site, and it did not move.
fn requalify(reference: &mut Value, resolved: &BTreeMap<String, String>) {
    let Some(fqn) = reference["fqn"].as_str() else {
        return;
    };
    if let Some(moved) = resolved.get(fqn) {
        reference["fqn"] = json!(moved);
    }
}

/// Re-spell one entry: the name a program calls it by, and the head of every signature it offers,
/// which by the catalogue's own rule begins with that name.
fn rename(function: &mut Value, name: &str) {
    let previous = string(&function["name"]);
    for shape in function["signatures"]
        .as_array_mut()
        .expect("every entry carries at least one signature")
    {
        let signature = string(&shape["signature"]);
        shape["signature"] = json!(match signature.strip_prefix(previous.as_str()) {
            Some(rest) => format!("{name}{rest}"),
            None => signature,
        });
    }
    function["name"] = json!(name);
}

/// One fully-qualified name: the module path, the type a member hangs off where there is one, and
/// the name a program writes.
fn qualified(path: &str, receiver: Option<&str>, name: &str) -> String {
    match receiver {
        Some(receiver) => format!("{path}.{receiver}.{name}"),
        None => format!("{path}.{name}"),
    }
}

/// One string field of a catalogue entry, which every field read here is.
fn string(value: &Value) -> String {
    value
        .as_str()
        .unwrap_or_else(|| panic!("a catalogue field this reshape reads is a string: {value}"))
        .to_string()
}

/// `readFile` → `read_file`. The whole of the fixture's "language design".
fn snake_case(name: &str) -> String {
    let mut out = String::with_capacity(name.len() + 4);
    for character in name.chars() {
        if character.is_ascii_uppercase() {
            if !out.is_empty() {
                out.push('_');
            }
            out.push(character.to_ascii_lowercase());
        } else {
            out.push(character);
        }
    }
    out
}

/// Parse a catalogue and leak it, so a per-instance catalogue can satisfy the `&'static` the trait
/// hands out. Tests are short-lived processes; a leaked catalogue is freed by exiting.
fn leak(json: String) -> &'static SignatureCatalogue {
    Box::leak(Box::new(
        SignatureCatalogue::parse(&json).expect("the fixture catalogue is well-formed"),
    ))
}

// ---------------------------------------------------------------------------------------------
// The healing dialect
// ---------------------------------------------------------------------------------------------

/// The fixture's [dialect](Dialect): the same questions, different answers.
///
/// Every method here disagrees with TypeScript's on some input the tests exercise — a different
/// fence tag, a different shape of code, a different comment marker — which is what turns "the
/// skeleton asks the dialect" from a claim into an observation.
pub(crate) static FIXTURE_DIALECT: FixtureDialect = FixtureDialect;

/// The fixture language's lexical rules.
pub(crate) struct FixtureDialect;

impl Dialect for FixtureDialect {
    /// Not `ts`. A reply carrying one fenced block of each language's is the crispest evidence that
    /// the tag list is read from the dialect and not from a constant in the skeleton.
    fn program_fence_tags(&self) -> &'static [&'static str] {
        &["fixture", "fx"]
    }

    fn looks_like_code(&self, line: &str) -> bool {
        let trimmed = line.trim();
        trimmed.starts_with("def ")
            || trimmed.starts_with('#')
            || is_use(trimmed)
            || trimmed.contains(" = ")
    }

    fn is_prose_line(&self, line: &str) -> bool {
        let trimmed = line.trim();
        trimmed.ends_with('.') && trimmed.contains(' ') && !trimmed.contains('=')
    }

    /// Everything is code except a `#` comment's run to the end of its line. The fixture language
    /// has no string literals, which is itself a difference worth having: a dialect is allowed to
    /// answer a question its language does not raise.
    fn code_mask(&self, src: &str) -> Option<CodeMask> {
        let mut flags = Vec::with_capacity(src.len());
        let mut in_comment = false;
        for byte in src.bytes() {
            match byte {
                b'#' => in_comment = true,
                b'\n' => in_comment = false,
                _ => {}
            }
            flags.push(!in_comment && byte != b'#');
        }
        Some(CodeMask::from_flags(flags))
    }

    /// Replies in this language that the delete-only invariant is re-asserted over.
    ///
    /// One per repair the dialect can drive, plus the shapes where it must decline: a fenced
    /// program under each of its two tags, the first of them with prose around it; a bare program
    /// pasted out twice with a blank line between the copies; a bare program carrying a `use` line
    /// and a comment; a reply that is nothing but prose; and the empty reply.
    fn fixtures(&self) -> &'static [&'static str] {
        &[
            "Here is the program.\n\n```fixture\ndef main\n  total = 1 + 2\n```\n\nThat should do it.",
            "```fx\nuse tools\ntotal = 1 + 2\n```",
            "def main\n  total = 1 + 2\n\ndef main\n  total = 1 + 2",
            "use tools\ndef main\n  x = 1 # a comment\n",
            "I have finished the task. Everything works.",
            "",
        ]
    }
}

// ---------------------------------------------------------------------------------------------
// The fixture language's own grammar helpers
// ---------------------------------------------------------------------------------------------

/// Whether a trimmed line is the fixture language's module import.
fn is_use(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed
        .strip_prefix("use ")
        .is_some_and(|rest| !rest.trim().is_empty())
}

/// Drop each line's `#` comment, and any line that is nothing but one — the fixture's answer to
/// TypeScript's type-strip.
fn strip_comments(source: &str) -> String {
    let mut out = String::with_capacity(source.len());
    for line in source.lines() {
        let code = match line.split_once('#') {
            Some((before, _)) => before.trim_end(),
            None => line,
        };
        if code.trim().is_empty() {
            continue;
        }
        out.push_str(code);
        out.push('\n');
    }
    out
}
