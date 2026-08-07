//! **The program-language seam** — the one place gg says what a
//! [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) program is written in,
//! and everything that follows from the answer.
//!
//! gg used to have exactly one answer, spelled out in a dozen places: the type-strip was
//! TypeScript's, the committed component was TypeScript's, the signature catalogue's entries were
//! keyed on a field literally named `js`, and the system prompt said so in prose. That was true and
//! costless right up until the question became *does the language a model writes in change how well
//! it works?* — which is a question a harness answers by running two arms, and therefore a question
//! gg cannot answer at all while the language is a fact rather than a variable.
//!
//! So the language is a variable: a [`GgProgramLanguage`] configured per agent, recorded on the run,
//! and resolved here into one [`ProgramLanguage`] implementation that owns every answer that used to
//! be hard-coded.
//!
//! # What a language is, and what it is not
//!
//! It is **not** a source dialect. The wire — `crates/gg/wit/gg-sandbox.wit`, fourteen interfaces of
//! typed functions — is a language-neutral IDL that other guest toolchains bind directly, and
//! [`ToolApi`](super::ToolApi) on this side of it is already free of any language's fingerprints.
//! Nothing about either changes when a language is added, and neither is allowed to acquire a
//! generic `call(name, json)` door in the name of pluggability: the typed surface *is* the
//! capability model.
//!
//! What a language does own is everything between the model's text and that wire:
//!
//! * how a model's reply becomes source the guest can evaluate ([`ProgramLanguage::prepare_program`]);
//! * how a code [skill](crate::skills)'s or [memory](crate::memories)'s file becomes a namespace
//!   bound at `lib.<key>` ([`ProgramLanguage::prepare_module`]);
//! * which committed component evaluates it ([`ProgramLanguage::guest_component`]);
//! * and how its SDK spells the surface ([`ProgramLanguage::catalogue`]).
//!
//! # Why the registry is trait objects
//!
//! [`language`] is an exhaustive `match` handing back a `&'static dyn ProgramLanguage`, and
//! [`all_languages`] is *derived* from [`GgProgramLanguage::ALL`] rather than being a second list
//! somebody has to remember to extend. Adding a variant to the core enum therefore fails to compile
//! until this module has an arm for it, and the new arm is instantly in every iteration — the drift
//! gates, the healing invariant, the prompt registration. `ALL` itself is not a list anyone can
//! forget either: [`GgProgramLanguage::ordinal`] is a second exhaustive `match` whose every arm is
//! checked against `ALL` in a `const` block, so a variant that never reached the list is a build
//! failure rather than a language every gate here silently skips.
//!
//! Three alternatives were considered and rejected. An **enum with a big `match` per question** puts
//! every language's implementation in one shared file and makes adding one an edit to ten `match`es,
//! which is the opposite of additive. A **static table of `fn` pointers** cannot carry a language's
//! lazily-initialised state (its parsed catalogue, its compiled component), so that bookkeeping
//! would come back as a side table keyed by id — exactly what the trait removes. And a **generic
//! parameter** would infect every consumer with a type parameter for a choice made at run time from
//! a config file.
//!
//! Trait objects in `static`s are awkward only when the implementation needs data; here each is a
//! unit struct whose data is `const`/`static`/`OnceLock` at module scope, so
//! `static TYPESCRIPT: TypeScript = TypeScript;` is the whole of the machinery.

use test_cabinet_core::gg::{CAPABILITY_RESPONSES_AS_CODE, GgAgentConfig, GgProgramLanguage};

use crate::limits::TurnErrorType;

use super::signatures::SignatureCatalogue;

/// The **ground a prepare step compiles on** — the private per-preparation workspace, the isolated
/// compiler invocation, the exclusive-checkout pool for a warm compiler, and the one sanctioned
/// shared directory.
///
/// Not a language's own module because the isolation it provides is not any one language's business:
/// two silent-corruption bugs of exactly this shape were measured on real toolchains before a single
/// compiler was wired up here, so the seam owns the answer and every language is handed it.
#[path = "language/compile.rs"]
pub mod compile;

pub use compile::{
    CompilerCommand, CompilerDaemon, CompilerPool, CompilerReport, PrepareContext, Workspace,
    daemon, place, place_tree, shared_toolchain_dir,
};

#[path = "language/typescript.rs"]
mod typescript;

#[path = "language/javascript.rs"]
mod javascript;

#[path = "language/python.rs"]
mod python;

#[path = "language/ruby.rs"]
mod ruby;

#[path = "language/purescript.rs"]
mod purescript;

/// What the two **JVM** arms share: the JDK and TeaVM they both compile through, and the half of
/// gg's compiler driver that is the same whatever language the program was written in.
///
/// Not a language and not registered anywhere. It exists because [Java](java) and
/// [Kotlin](kotlin) reach the same guest by the same road, and one of TeaVM's two mandatory
/// settings fails *silently* when it goes missing — so a second copy of the code that sets it
/// would be a standing chance for one arm to lose it and for nobody to notice.
#[path = "language/jvm.rs"]
mod jvm;

#[path = "language/java.rs"]
mod java;

#[path = "language/kotlin.rs"]
mod kotlin;

/// The **cross-language agreement gate**: the assertion that every registered language describes the
/// same capabilities, and that only their spellings differ.
///
/// `#[cfg(test)]` because it is a gate rather than a runtime need — it reads committed artifacts and
/// compiles components, which is a test's budget and not a turn's. Its own module documentation says
/// why an A/B study is worthless without it.
#[cfg(test)]
#[path = "language/agreement.rs"]
mod agreement;

/// The **per-agent compiler isolation gate**: the assertion that preparing a program is a function of
/// that program alone, held under the concurrency a run really produces.
///
/// `#[cfg(test)]` for the same reason [`agreement`] is — it spawns compilers sixteen at a time, which
/// is a test's budget and not a turn's. Its module documentation carries the two measured
/// silent-corruption bugs it reproduces.
#[cfg(test)]
#[path = "language/isolation.rs"]
mod isolation;

/// A **second implementation of this trait, for tests only** — the thing that makes the seam an
/// abstraction rather than one implementation wearing a trait.
///
/// It is deliberately *not* in [`language`] or [`all_languages`]: it has no wire id, so it can never
/// be configured, resolved, recorded or compiled. See its module documentation for what it stands in
/// for.
#[cfg(test)]
#[path = "language/fixture.rs"]
pub(crate) mod fixture;

#[cfg(test)]
pub(crate) use fixture::fixture_languages;

/// One program language gg can drive a responses-as-code agent in.
///
/// Object-safe on purpose: the registry hands out `&'static dyn ProgramLanguage`, so nothing that
/// consults a language is generic over it, and a second language is a new module plus one `match`
/// arm rather than a type parameter threaded through the sandbox.
///
/// Every implementation must keep the model-facing rules the TypeScript SDK keeps, because those
/// rules — not the syntax — are what a cross-language study holds constant: capabilities reach the
/// program as typed, standalone, namespaced bindings rather than a dispatcher taking a name as data;
/// every call is synchronous; a fixed choice is a typed value rather than a string; neither an
/// argument nor a result is a JSON document the program has to parse; optional arguments use the
/// language's own idiom while required ones stay positional.
pub trait ProgramLanguage: Send + Sync + 'static {
    /// The wire id this language is configured, recorded and sliced by.
    fn id(&self) -> GgProgramLanguage;

    /// This language's name as a **human** reads it — `"TypeScript"`.
    ///
    /// The operator-facing name: the launch warning that lists the languages gg can drive, the
    /// warm-up line that names which component compiled. What the *model* reads is its own prompt
    /// template, which is written in this language's syntax and names the language in its own words
    /// — so this is not the string a model is shown, and changing it changes no prompt.
    fn display_name(&self) -> &'static str;

    /// Turn a model's reply into the source the guest evaluates as a program.
    ///
    /// This is where a language spends whatever it must to make untrusted text safe to hand to a
    /// parser, and where it refuses — with a sentence the model can act on — anything the sandbox
    /// has no implementation of.
    ///
    /// A language that runs a **compiler** here must say which of the two failures it hit: a program
    /// the compiler read and rejected is a [`PrepareError::Compile`] the model is shown, and a
    /// compiler that could not finish at all is a [`PrepareFailure::Toolchain`] the model is not
    /// blamed for. Reporting the second as the first is how a model ends up rewriting a correct
    /// program to appease a broken image.
    ///
    /// # Concurrency: a compiler here must be isolated per invocation, by construction
    ///
    /// **This is called concurrently, and the concurrency is real.** A program's language is
    /// resolved per agent, agents run in parallel up to `limits.maxParallel`, and each turn may
    /// chain up to four programs — so several compilations of several agents' programs are in
    /// flight at once, in one process, routinely.
    ///
    /// The rule that follows is one sentence: **what this returns is a function of `source` alone**.
    /// Nothing an implementation compiles with may be reachable from another preparation running at
    /// the same time — not a working directory, not an output path, not a build cache, not a
    /// compiler daemon.
    ///
    /// The requirement is not theoretical: two silent-corruption bugs were measured while this
    /// capability was being designed. A shared build strategy handed four concurrent compilations to
    /// one builder and three of them produced no output while nothing threw; a shared compiler
    /// output tree interleaved two agents' programs into each other's artifacts. In both, every
    /// process exited zero. That is the failure mode to design against — not a crash, which the
    /// [toolchain band](PrepareFailure::Toolchain) already reports, but a run in which one agent
    /// silently evaluates another agent's program and every number the study collects is wrong.
    ///
    /// `context` is how the rule is kept without remembering it. It is minted per preparation by the
    /// sandbox and by nothing else, and it hands out the only ground the seam offers:
    /// [`workspace`](PrepareContext::workspace) is this preparation's own tree, and
    /// [`compiler`](PrepareContext::compiler) spawns a process whose working directory, `HOME`,
    /// `TMPDIR` and `XDG_*` roots are all inside it — so a toolchain that writes beside its input or
    /// into the user's cache is isolated without its language having thought about it. A warm
    /// compiler that must outlive one preparation belongs in a [`CompilerPool`], which lends an
    /// instance exclusively rather than sharing it. See [`compile`] for the whole contract, and the
    /// [isolation gate](isolation) for what enforces it.
    ///
    /// One thing this is *not*: a stall risk. This runs on a blocking task, so a compiler that takes
    /// seconds does not hold up the loop or any sibling agent. The hazard is contention and shared
    /// state, and designing against the wrong one costs isolation that is actually needed.
    fn prepare_program(
        &self,
        source: &str,
        context: &PrepareContext,
    ) -> Result<PreparedProgram, PrepareFailure>;

    /// What a program of this language is judged by, named the way this language's own users name
    /// it — `tsc`, `rustc`, `mypy` — or `None` for a language whose [prepare
    /// step](Self::prepare_program) invokes no **compiler** at all.
    ///
    /// The name is a **spelling**, and belongs to the language for the same reason every call's
    /// does: what two arms of a study share is that a program is checked before it runs, never what
    /// the thing doing the checking is called. A language names its checker in its own
    /// [system prompt](Self::prompt), because a model told its program is checked and not told by
    /// what has been given half a sentence — and declaring the name here is what lets the prompt
    /// gate hold *every* checked language to saying it, without holding them all to saying `tsc`.
    ///
    /// The answer decides one further thing: whether the sandbox reports what preparing this
    /// program took, as [`SandboxOutcome::compile`](super::SandboxOutcome::compile). A language
    /// that names a checker has every one of its programs timed, on the failing path as well as
    /// the succeeding one; a language that names none reports nothing, because a sub-millisecond
    /// zero on every turn is noise rather than a measurement. That is why the two are one method
    /// and not two: an arm cannot name a compiler and go untimed, or be timed and have nothing to
    /// tell its model.
    ///
    /// Required rather than defaulted, and answered by the language rather than inferred from a
    /// measurement, because the two arms of a cross-language study are compared on what compiling
    /// cost them: a language whose compile time went unrecorded because nobody remembered to
    /// declare it would be an arm that looks free and is not. A new language cannot be registered
    /// without answering.
    fn checker(&self) -> Option<&'static str>;

    /// Whether this language's [prepare step](Self::prepare_program) invokes a compiler — which is
    /// to say whether it [names one](Self::checker). Derived rather than declared, so the two can
    /// never disagree.
    fn prepare_compiles(&self) -> bool {
        self.checker().is_some()
    }

    /// Do whatever this language's [prepare step](Self::prepare_program) would otherwise do on its
    /// first call — unpack a toolchain, warm a cache — so the first code turn does not pay for it.
    ///
    /// Called once per run, from [`precompile`](super::precompile), on the same blocking task that
    /// compiles the interpreter component and for the same reason: a one-off cost that lands inside
    /// a turn is a cost a cross-language study reads as that turn's compile time. Best-effort and
    /// idempotent; a language whose prepare step needs no warming does nothing, which is why this
    /// has a default and [`prepare_compiles`](Self::prepare_compiles) does not — one is an
    /// optimisation and the other is a measurement.
    fn warm_prepare(&self) {}

    /// Turn a code skill's or code memory's source into the source the guest evaluates to produce
    /// that module's namespace, bound at `lib.<key>`.
    ///
    /// A module compiles exactly as a program does, so `context` means what it means there and the
    /// [isolation rule](Self::prepare_program#concurrency-a-compiler-here-must-be-isolated-per-invocation-by-construction)
    /// is the same rule. It is not a lesser path: a turn that reads three code skills compiles three
    /// modules beside its own program, and every one of those compilations is concurrent with every
    /// other agent's.
    fn prepare_module(
        &self,
        source: &str,
        context: &PrepareContext,
    ) -> Result<PreparedModule, PrepareFailure>;

    /// The file extensions a code [skill](crate::skills) directory spells this language's module and
    /// on-use script with — `skill.<ext>`, `on-use.<ext>` — **most preferred first**, and never
    /// empty.
    ///
    /// A skills directory is authored once and read by every agent in the run, and language is
    /// resolved *per agent*: one run may drive a Python agent and a C# agent over the same
    /// directory. A skill's code therefore cannot have one file name. It has one per language, the
    /// directory carries whichever of them its author wrote, and each agent reads its own — which
    /// is the only arrangement under which a skill's prose can be shared while its code is
    /// necessarily not.
    ///
    /// A list rather than a single extension because two languages may share a module runtime, and
    /// where they do, withholding a skill from one of them would be a difference between the arms
    /// far larger than the one a study of those two arms is measuring. [`TypeScript`](typescript)
    /// and [`JavaScript`](javascript) are that pair: one strip serves both, so each accepts the
    /// other's spelling and merely prefers its own. A language whose modules nothing else can
    /// evaluate names one extension and no more.
    ///
    /// The first entry is the spelling this language *writes* — what gg keys a generated on-use
    /// script under. The rest are spellings it will *read*.
    fn module_file_extensions(&self) -> &'static [&'static str];

    /// The extension this language writes: the first of its
    /// [module file extensions](Self::module_file_extensions).
    ///
    /// Derived rather than declared so the two can never name different spellings, and so that
    /// "which of these does gg write?" has exactly one answer.
    fn module_file_extension(&self) -> &'static str {
        self.module_file_extensions()
            .first()
            .copied()
            .expect("a language names at least one module file extension")
    }

    /// The identifier a code [skill](crate::skills) or [memory](crate::memories) called `name` is
    /// bound at — the `<key>` of `lib.<key>`.
    ///
    /// A skill's own name is authored prose (`csv-tools`, `my_helpers.v2`, `9lives`), and the key is
    /// a property a **program spells out** rather than one it looks up with a string, so it has to
    /// come out as an identifier the language will parse. Which identifier is the language's
    /// business: `csvTools` where the convention is camelCase, `csv_tools` where it is not. gg's
    /// only requirements are that the result is non-empty and stable for a given name, which is what
    /// lets it be minted once per agent and quoted back in the reply that names it.
    fn binding_name(&self, name: &str) -> String;

    /// The committed guest component that evaluates this language's prepared source, embedded in
    /// the binary — or `None` for a language that compiles **the program itself** into a component,
    /// per turn.
    ///
    /// Usually a language's own. It need not be: two languages that differ in what gg does to a
    /// program *before* handing it over, and not in what evaluates it, are entitled to one component
    /// — [`JavaScript`](javascript) serves [`TypeScript`](typescript)'s, and the seam's
    /// "no language serves another's artifacts" gate names that pair so the sharing is declared
    /// rather than inferred from a passing test.
    ///
    /// # Why `None` is a real answer and not an omission
    ///
    /// A committed component is what an **interpreted** arm has: Python's holds a whole CPython,
    /// Ruby's holds Opal, the ECMAScript one holds a JavaScript engine, and every program of that
    /// language crosses the membrane as a *string* the runtime inside evaluates. A **compiled** arm
    /// has no such thing to commit. `rustc` does not produce a Rust runtime that later runs a
    /// program; it produces the program, as a wasm module, and that module is the component. There
    /// is no artifact of that language that is not a particular program — so a language of this
    /// shape answers `None` here and hands its bytes back on
    /// [`PreparedProgram::component`](PreparedProgram::component) instead.
    ///
    /// The two are not both allowed to be present. A language that committed a component *and*
    /// compiled one per program would have two answers to "what evaluated this turn", and the run's
    /// record could only carry one of them.
    fn guest_component(&self) -> Option<&'static [u8]>;

    /// Whether this language's [prepare step](Self::prepare_program) produces the component its
    /// program is evaluated by, rather than handing source to a
    /// [committed](Self::guest_component) one. Derived rather than declared, so the two can never
    /// disagree.
    fn compiles_component(&self) -> bool {
        self.guest_component().is_none()
    }

    /// The committed signature catalogue for this language's SDK, parsed once per process.
    fn catalogue(&self) -> &'static SignatureCatalogue;

    /// The dialect [response healing](crate::healing) asks its language-shaped questions of.
    ///
    /// Healing is not part of the sandbox and does not import it — the trait is declared over there
    /// and implemented over here, so the arrow points one way and this module is the only thing that
    /// knows both halves exist.
    fn healing(&self) -> &'static dyn crate::healing::Dialect;

    /// The authored, model-facing prose and spellings that are written in this language's syntax.
    fn prompt(&self) -> &'static PromptDialect;

    /// The one statement a program writes to open a view of `path` — the whole file, or one
    /// `offset`/`limit` [window](FileWindow) of it — as this language spells it, terminated the way
    /// this language terminates a statement.
    ///
    /// A trait method rather than a spelling in [`PromptDialect`] because it is not a name. The
    /// optional half is an **arguments idiom** the seam explicitly leaves to each language (a
    /// trailing options object in TypeScript; keyword arguments where that is the idiom), and gg
    /// does not merely quote this call — it synthesizes it into the agent's own transcript, as an
    /// assistant turn the agent is meant to read as an example of its own output. A statement in
    /// another language's syntax would teach the model the wrong thing on turn one, which is exactly
    /// the confound a cross-language study cannot carry.
    ///
    /// The two callers are [autoload](crate::agent) and
    /// [agent persistence](crate::persistence::restore_file_views).
    fn open_file_statement(&self, path: &str, window: Option<FileWindow>) -> String;

    /// A whole **program** that opens one documentation view per name in `names`, as this language
    /// spells and structures it.
    ///
    /// The one place gg generates source rather than quoting a call, and it is not optional: it is
    /// the on-use script of every [built-in family skill](crate::skills), so a language that could
    /// not write it would be a language whose agents read a skill and are shown nothing. The set of
    /// names is exactly what `object.list()` would answer for that agent, which is why the program is
    /// generated at all — a skill that hard-coded a list would be a second answer to a question that
    /// already has one.
    ///
    /// A trait method rather than a `format!` in [`skills`](crate::skills) because every token of it
    /// is this language's: the list literal, the loop, the statement terminator, and the name of the
    /// call itself. The implementation is expected to resolve that name with
    /// [`spell`]`(self, `[`VIEW_OPEN_DOCS_VIEW`]`)` rather than writing it out, for the same reason
    /// nothing else does.
    fn open_docs_views_statement(&self, names: &[&str]) -> String;

    /// Replies this language contributes to the delete-only invariant corpus.
    ///
    /// `#[cfg(test)]`, and on the trait rather than beside the tests so that a language cannot be
    /// registered without contributing replies its own [dialect](Self::healing) has to survive. It
    /// delegates to [`Dialect::fixtures`](crate::healing::Dialect::fixtures), which is where a
    /// language actually authors them.
    #[cfg(test)]
    fn healing_fixtures(&self) -> &'static [&'static str] {
        self.healing().fixtures()
    }

    /// A **code module** in this language's own syntax, carrying `name` somewhere its prepared
    /// artifact will still hold it — the subject the [isolation gate](isolation) drives this
    /// language's [module step](Self::prepare_module) with.
    ///
    /// That gate drives *both* preparation steps sixteen ways, so it needs a source valid for each,
    /// and the seam guarantees exactly one whole program per language:
    /// [`open_docs_views_statement`](Self::open_docs_views_statement). Wherever a code module is
    /// **ordinary source of the language** — which is every arm but one — that program is a module
    /// too, so it is the default and no language has to answer this.
    ///
    /// The two JVM arms are the exceptions and are the reason this exists: a [Java](java) program is a
    /// sequence of statements and a Java code module is a **class body**, while a [Kotlin](kotlin)
    /// program is a script and a Kotlin code module is an ordinary file whose public top-level
    /// functions are its namespace. On neither is one shape the other, and on both the default is a
    /// module that offers nothing.
    ///
    /// A default rather than a required method, even though a default can be silently wrong,
    /// because the thing that would notice already does: the gate prepares every subject **alone**
    /// before any concurrency and reports the language whose baseline failed, by name and with the
    /// preparation's own diagnostic. A language for which the default is wrong finds out on the
    /// first run of the gate rather than by review.
    #[cfg(test)]
    fn isolation_module(&self, name: &str) -> String {
        self.open_docs_views_statement(&[name])
    }
}

/// The model-facing **prose** that is written in one language's syntax: two Handlebars templates,
/// and nothing else.
///
/// The responses-as-code system prompt is written per language because its *sentences* are — how a
/// program is structured, what a statement ends with, what its example code looks like. Its
/// **spellings** are not written here or in the template: every function name and every signature a
/// template quotes is resolved from that language's own committed
/// [catalogue](super::signatures) at render time, so a template says `{{api.view.open_text.call}}`
/// and never `view.openText`. That is the whole rule — gg quotes what the SDK really binds, and
/// there is no second copy of a name to drift.
///
/// What is deliberately **not** here:
///
/// * The refusals a language produces while *preparing* a program (a module import where there is no
///   loader, an `await` where there is no event loop). Those belong to the prepare step and stay with
///   it, because they are answers to something the model just wrote rather than standing prose.
/// * Any function's **signature, description or summary**. All of it is reflected out of the
///   declaration it describes and arrives in the language's catalogue, `list` included — a signature
///   authored on gg's side is one nothing can compare against the code, which is exactly the defect
///   the catalogue exists to remove.
pub struct PromptDialect {
    /// This language's responses-as-code system prompt template, verbatim.
    pub system_template: &'static str,
    /// The name it is registered under: `system-code.<language id>`.
    pub system_template_name: &'static str,
    /// This language's "your program showed you nothing" notice template, verbatim.
    ///
    /// The one message a *successful* program can produce, and only because a request has to end on
    /// something for the model to answer. It is per language for the same reason the system prompt
    /// is: it names the calls that would have shown the model something.
    ///
    /// There is deliberately no counterpart for a program that *did* show itself something — the
    /// views are the report, and a covering note over them would be gg narrating what the model can
    /// already read.
    pub nothing_shown_template: &'static str,
    /// The name that is registered under: `code-nothing-shown.<language id>`.
    pub nothing_shown_template_name: &'static str,
}

/// One model-facing call, named the only way the seam is allowed to name a function: by the API
/// object it hangs off and the catalogue [key](super::signatures::CatalogueFunction::key) that is
/// its language-independent identity.
///
/// The **object** half is identity rather than spelling — `harness`, `review`, `judge` and `view`
/// are on the wire, the console groups by them, and no language may rename them. The function half
/// is a spelling, so it is not written down here at all: [`spell`] resolves it against the
/// language's own committed catalogue. That is the difference between "a test checks the two agree"
/// and "there is only one of them".
///
/// It is used for two things, and the second is why the table below covers the *whole* surface
/// rather than the handful gg quotes. It is what gg [spells](spell) when it names a call back at a
/// model — and it is the identity every call is **recorded** under, as the
/// [`ApiCall`](test_cabinet_core::gg::GgTelemetryKind::ApiCall) pair the
/// [membrane](super::membrane) brackets each host function with. One vocabulary for both, so the
/// count a console joins to a bound function is keyed on the same thing that named the function.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SurfaceCall {
    /// The API object it is grouped under in a program's scope.
    pub object: &'static str,
    /// Its catalogue key: `request_changes`, `open_text`. gg's own vocabulary, in `snake_case`,
    /// deliberately not any one SDK's spelling.
    pub key: &'static str,
}

impl SurfaceCall {
    /// The call `key` identifies on `object`.
    const fn new(object: &'static str, key: &'static str) -> Self {
        Self { object, key }
    }
}

/// Run a shell command in the workspace.
pub const SYSTEM_SHELL: SurfaceCall = SurfaceCall::new("system", "shell");

/// Read a workspace file, as the variant the tool returns.
pub const FS_READ_FILE: SurfaceCall = SurfaceCall::new("fs", "read_file");

/// Read a workspace file's text directly — the one helper, which shares
/// [`read_file`](crate::tools::READ_FILE_TOOL)'s tool and gate and has an identity of its own.
pub const FS_READ_TEXT_FILE: SurfaceCall = SurfaceCall::new("fs", "read_text_file");

/// Write a workspace file whole.
pub const FS_WRITE_FILE: SurfaceCall = SurfaceCall::new("fs", "write_file");

/// Replace one string in a workspace file.
pub const FS_EDIT_FILE: SurfaceCall = SurfaceCall::new("fs", "edit_file");

/// List a workspace directory.
pub const FS_LIST_DIR: SurfaceCall = SurfaceCall::new("fs", "list_dir");

/// Read an authored skill.
pub const SKILLS_READ_SKILL: SurfaceCall = SurfaceCall::new("skills", "read_skill");

/// Write the agent's single scratchpad memory.
pub const MEMORY_WRITE_MEMORY: SurfaceCall = SurfaceCall::new("memory", "write_memory");

/// Update an existing memory whole.
pub const MEMORY_UPDATE_MEMORY: SurfaceCall = SurfaceCall::new("memory", "update_memory");

/// Create a new memory.
pub const MEMORY_CREATE_MEMORY: SurfaceCall = SurfaceCall::new("memory", "create_memory");

/// Read one memory.
pub const MEMORY_READ_MEMORY: SurfaceCall = SurfaceCall::new("memory", "read_memory");

/// Replace one string in a memory.
pub const MEMORY_EDIT_MEMORY: SurfaceCall = SurfaceCall::new("memory", "edit_memory");

/// Search the memory index by keyword.
pub const MEMORY_SEARCH_MEMORIES: SurfaceCall = SurfaceCall::new("memory", "search_memories");

/// Delete a memory.
pub const MEMORY_DELETE_MEMORY: SurfaceCall = SurfaceCall::new("memory", "delete_memory");

/// Add a task to the agent's own list.
pub const TASKS_ADD_TASK: SurfaceCall = SurfaceCall::new("tasks", "add_task");

/// Patch a task.
pub const TASKS_UPDATE_TASK: SurfaceCall = SurfaceCall::new("tasks", "update_task");

/// Re-state a task's dependencies.
pub const TASKS_SET_BLOCKED_BY: SurfaceCall = SurfaceCall::new("tasks", "set_blocked_by");

/// Mark a task done.
pub const TASKS_COMPLETE_TASK: SurfaceCall = SurfaceCall::new("tasks", "complete_task");

/// Drop a task.
pub const TASKS_REMOVE_TASK: SurfaceCall = SurfaceCall::new("tasks", "remove_task");

/// Open an epic on the board.
pub const PROJECT_CREATE_EPIC: SurfaceCall = SurfaceCall::new("project", "create_epic");

/// File an issue on the board.
pub const PROJECT_CREATE_ISSUE: SurfaceCall = SurfaceCall::new("project", "create_issue");

/// Patch an issue.
pub const PROJECT_UPDATE_ISSUE: SurfaceCall = SurfaceCall::new("project", "update_issue");

/// Re-state an issue's dependencies.
pub const PROJECT_SET_ISSUE_BLOCKED_BY: SurfaceCall =
    SurfaceCall::new("project", "set_issue_blocked_by");

/// Remove an epic.
pub const PROJECT_REMOVE_EPIC: SurfaceCall = SurfaceCall::new("project", "remove_epic");

/// Remove an issue.
pub const PROJECT_REMOVE_ISSUE: SurfaceCall = SurfaceCall::new("project", "remove_issue");

/// Register a deferred wait on a board issue.
pub const PROJECT_WAIT_FOR_ISSUE: SurfaceCall = SurfaceCall::new("project", "wait_for_issue");

/// Reclaim a file view from the agent's own window.
pub const CONTEXT_EVICT_FILE_VIEW: SurfaceCall = SurfaceCall::new("context", "evict_file_view");

/// Archive a range of the agent's own thread.
pub const CONTEXT_ARCHIVE_THREAD: SurfaceCall = SurfaceCall::new("context", "archive_thread");

/// Search what the agent has archived.
pub const CONTEXT_SEARCH_ARCHIVE: SurfaceCall = SurfaceCall::new("context", "search_archive");

/// Register a compaction of the agent's own window.
pub const CONTEXT_COMPACT: SurfaceCall = SurfaceCall::new("context", "compact");

/// Spawn a child agent.
pub const AGENTS_SPAWN_SUBAGENT: SurfaceCall = SurfaceCall::new("agents", "spawn_subagent");

/// Block until child agents return.
pub const AGENTS_WAIT_FOR_SUBAGENTS: SurfaceCall = SurfaceCall::new("agents", "wait_for_subagents");

/// Send a message to a running child.
pub const AGENTS_SEND_MESSAGE: SurfaceCall = SurfaceCall::new("agents", "send_message");

/// Declare a move to another state of this agent's machine.
pub const AGENTS_TRANSITION_STATE: SurfaceCall = SurfaceCall::new("agents", "transition_state");

/// Declare that this session continues as another agent.
pub const AGENTS_EXEC: SurfaceCall = SurfaceCall::new("agents", "exec");

/// Register a copy of this agent.
pub const AGENTS_FORK: SurfaceCall = SurfaceCall::new("agents", "fork");

/// Read a workspace file **and** show it to the agent. Bridged to
/// [`read_file`](crate::tools::READ_FILE_TOOL) and recorded as itself: what the model wrote is
/// `view.openFile`, and the tool underneath it is the execution layer's business.
pub const VIEW_OPEN_FILE: SurfaceCall = SurfaceCall::new("view", "open_file");

/// The call that shows the agent a value it computed — quoted in the prompt's account of the
/// message kinds an agent receives.
pub const VIEW_OPEN_TEXT: SurfaceCall = SurfaceCall::new("view", "open_text");

/// Show the agent one function's documentation.
pub const VIEW_OPEN_DOCS_VIEW: SurfaceCall = SurfaceCall::new("view", "open_docs_view");

/// The call that closes a view — what the context-pressure block points an agent at when text views
/// are holding window it could reclaim.
pub const VIEW_CLOSE: SurfaceCall = SurfaceCall::new("view", "close");

/// What is open in the agent's window right now.
pub const VIEW_CURRENT: SurfaceCall = SurfaceCall::new("view", "current");

/// The [program library](crate::programs)'s own directory.
pub const PROGRAMS_HISTORY: SurfaceCall = SurfaceCall::new("programs", "history");

/// The program-library call that fetches a program the agent already ran.
pub const PROGRAMS_GET: SurfaceCall = SurfaceCall::new("programs", "get");

/// The program-library call that hands gg a program to run in place of the current one — quoted in
/// every notice about a hand-over gg did not honour.
pub const PROGRAMS_RERUN: SurfaceCall = SurfaceCall::new("programs", "rerun");

/// The [standard](crate::ending::EndingRole::Standard) role's ending call.
pub const HARNESS_FINISH: SurfaceCall = SurfaceCall::new("harness", "finish");

/// The [review](crate::ending::EndingRole::Review) role's approval.
pub const REVIEW_APPROVE: SurfaceCall = SurfaceCall::new("review", "approve");

/// The review role's change request.
pub const REVIEW_REQUEST_CHANGES: SurfaceCall = SurfaceCall::new("review", "request_changes");

/// **Every model-facing call gg has**, in catalogue order — the vocabulary the membrane records
/// under and gg quotes from.
///
/// Enumerated rather than derived because it is one half of an agreement: the
/// [gate](super::signatures) asserts this table and every registered language's committed catalogue
/// name exactly the same set of `(object, key)` pairs. A call that reached a program with no entry
/// here would be recorded under nothing; an entry here that no language binds would put a sentence
/// in front of a model naming a call its scope does not hold. Deriving one from the other would
/// prove neither.
///
/// [`list`](crate::docs::LIST_FUNCTION) is deliberately **not** here. It is the
/// [documentation carve-out](crate::docs)'s own meta function, seeded onto *every* object the guest
/// creates rather than catalogued on one, so its object is a runtime argument and there is no fixed
/// pair to write down — see `MembraneState::recorded_on`.
///
/// `#[cfg(test)]` because it is a gate rather than a runtime need: production reaches for one call
/// by name, and the whole set is only ever walked to prove the two halves agree.
#[cfg(test)]
pub(crate) const MODEL_FACING_CALLS: [SurfaceCall; 47] = [
    SYSTEM_SHELL,
    FS_READ_FILE,
    FS_READ_TEXT_FILE,
    FS_WRITE_FILE,
    FS_EDIT_FILE,
    FS_LIST_DIR,
    SKILLS_READ_SKILL,
    MEMORY_WRITE_MEMORY,
    MEMORY_UPDATE_MEMORY,
    MEMORY_CREATE_MEMORY,
    MEMORY_READ_MEMORY,
    MEMORY_EDIT_MEMORY,
    MEMORY_SEARCH_MEMORIES,
    MEMORY_DELETE_MEMORY,
    TASKS_ADD_TASK,
    TASKS_UPDATE_TASK,
    TASKS_SET_BLOCKED_BY,
    TASKS_COMPLETE_TASK,
    TASKS_REMOVE_TASK,
    PROJECT_CREATE_EPIC,
    PROJECT_CREATE_ISSUE,
    PROJECT_UPDATE_ISSUE,
    PROJECT_SET_ISSUE_BLOCKED_BY,
    PROJECT_REMOVE_EPIC,
    PROJECT_REMOVE_ISSUE,
    PROJECT_WAIT_FOR_ISSUE,
    CONTEXT_EVICT_FILE_VIEW,
    CONTEXT_ARCHIVE_THREAD,
    CONTEXT_SEARCH_ARCHIVE,
    CONTEXT_COMPACT,
    AGENTS_SPAWN_SUBAGENT,
    AGENTS_WAIT_FOR_SUBAGENTS,
    AGENTS_SEND_MESSAGE,
    AGENTS_TRANSITION_STATE,
    AGENTS_EXEC,
    AGENTS_FORK,
    VIEW_OPEN_FILE,
    VIEW_OPEN_TEXT,
    VIEW_OPEN_DOCS_VIEW,
    VIEW_CLOSE,
    VIEW_CURRENT,
    PROGRAMS_HISTORY,
    PROGRAMS_GET,
    PROGRAMS_RERUN,
    HARNESS_FINISH,
    REVIEW_APPROVE,
    REVIEW_REQUEST_CHANGES,
];

/// How `language` spells `call`, qualified exactly as a program writes it —
/// `review.requestChanges`.
///
/// Resolved from that language's own committed catalogue by the call's language-independent
/// [key](SurfaceCall::key), so a language that renamed a function renames it in gg's sentences too,
/// with nothing to keep in step. A catalogue that carries no such key falls back to the key itself:
/// the [agreement gate](agreement) proves every [model-facing call](MODEL_FACING_CALLS) resolves in
/// every registered language, so the fallback is unreachable — and degrading one word of a notice is
/// the right failure anyway, where panicking mid-run is not.
pub fn spell(language: &dyn ProgramLanguage, call: SurfaceCall) -> String {
    let name = super::signatures::spelling(language, call).unwrap_or(call.key);
    format!("{}.{name}", call.object)
}

/// The `offset`/`limit` window a synthesized file-view call re-opens — the same pair the model would
/// have passed itself. `None` at the call sites means the whole file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileWindow {
    /// The 1-based first line.
    pub offset: u64,
    /// How many lines.
    pub limit: u64,
}

/// The one instance of each registered language.
///
/// A unit struct in a `static` is the whole of the machinery: no allocation, no lazy init, and
/// `&TYPESCRIPT` coerces to `&'static dyn ProgramLanguage`. The `match` is exhaustive, so a language
/// added to [`GgProgramLanguage`] does not compile until it is registered here.
pub fn language(id: GgProgramLanguage) -> &'static dyn ProgramLanguage {
    match id {
        GgProgramLanguage::TypeScript => &typescript::TYPESCRIPT,
        GgProgramLanguage::JavaScript => &javascript::JAVASCRIPT,
        GgProgramLanguage::Python => &python::PYTHON,
        GgProgramLanguage::Ruby => &ruby::RUBY,
        GgProgramLanguage::PureScript => &purescript::PURESCRIPT,
        GgProgramLanguage::Java => &java::JAVA,
        GgProgramLanguage::Kotlin => &kotlin::KOTLIN,
    }
}

/// Every registered language, in registration order.
///
/// **Derived** from [`GgProgramLanguage::ALL`] rather than kept as a second slice, so there is no
/// list to forget: a new variant arrives here the moment [`language`] has an arm for it, and every
/// gate that iterates languages covers it without being edited.
///
/// It is exactly the registered set, under test as in production: the
/// [fixture language](fixture) the seam's own tests are written against is deliberately **not** here,
/// so nothing that iterates this pays for it and nothing that reads it can be handed a language an
/// operator could not have configured.
pub fn all_languages() -> impl Iterator<Item = &'static dyn ProgramLanguage> {
    GgProgramLanguage::ALL.iter().copied().map(language)
}

/// A program that prepared cleanly: the source the guest evaluates, and what preparing it observed
/// about the model's own text on the way past.
///
/// The observation rides with the source rather than being recovered later because it is a fact
/// about the **model's** text, in the model's own coordinates, and the only place both that text and
/// the language's own understanding of it exist together is inside the prepare step.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedProgram {
    /// The source the guest evaluates. For TypeScript, the type-stripped JavaScript.
    ///
    /// Empty for a language that [compiled its own component](Self::component): there is no source
    /// left to evaluate, because the program *is* the artifact. The `program` parameter of the
    /// world's `run` is handed it anyway rather than being made optional — a guest that does not
    /// read it costs nothing to pass an empty string to, and making the wire's shape depend on the
    /// arm would be a difference between two arms of a study in the one place there must not be one.
    pub source: String,
    /// Top-level statements the program wrote that cannot execute, when it wrote any. See
    /// [`UnreachableTail`].
    pub unreachable: Option<UnreachableTail>,
    /// **The component that evaluates this program**, for a language that compiled one *for this
    /// program* — `None` for every language whose programs are evaluated by a
    /// [committed](ProgramLanguage::guest_component) one.
    ///
    /// Two shapes of arm, and the seam carries both because the languages that have each are not
    /// negotiable. An interpreted arm (Python, Ruby, the ECMAScript pair) ships one component
    /// holding a whole language runtime, compiles it once per process, and hands it a string every
    /// turn. A **compiled** arm has no runtime to ship: `rustc` emits a wasm module *for the
    /// program*, and the artifact and the program are the same object. There is nothing to commit
    /// and nothing to cache — every turn produces different bytes — so the per-process
    /// [component cache](super::engine) is bypassed for these and the compile is paid inside the
    /// turn, where [`SandboxOutcome::compile_wait`](super::SandboxOutcome::compile_wait) records it.
    ///
    /// It rides on the prepared program rather than being asked for separately because it *is* the
    /// preparation's output: a second call would be a second compile, and a language that cached the
    /// answer between the two would be caching one program's artifact where the next program could
    /// reach it — the exact failure [`compile`] exists to prevent.
    pub component: Option<Vec<u8>>,
}

/// A code module that prepared cleanly: the source whose evaluation produces the module's namespace,
/// and the names that namespace offers.
///
/// The names travel beside the source rather than being read back out of it, because they are what
/// the model is *told* it can call — and a second reading of the same fact is a second chance for
/// the two to disagree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedModule {
    /// The source the guest evaluates to produce the module's namespace.
    pub source: String,
    /// The exported names, in source order, as the namespace lists them. A renaming export is listed
    /// under the name the namespace gives it.
    pub exports: Vec<String>,
}

/// Top-level statements a program wrote **after** a statement that ends it — code that provably
/// never runs.
///
/// This is not an error and nothing is refused: a language whose program body may end early is
/// entitled to dead code after the statement that ends it. It exists because of what it is a symptom
/// of. A model that drafts two programs and pastes the second after the first produces exactly this
/// shape, and without a word about it gg reports "your program ran to completion" over a reply whose
/// second half — the half that wrote the deliverable and ended the run — never executed. Round 1
/// proved that silent discard is the one failure a model cannot recover from, so gg counts what did
/// not run and says so.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnreachableTail {
    /// How many top-level statements followed it that could have done something. Declarations the
    /// language hoists into scope before the first statement runs, and declarations that do not
    /// exist at run time at all, are excluded: calling either "did not run" would be false.
    pub statements: usize,
    /// The 1-based line of the first such statement, in the **program's** coordinates.
    pub line: usize,
    /// The first such statement's own source text, trimmed and capped — what lets a model recognise
    /// the half of its reply that never ran without counting lines.
    pub excerpt: String,
}

/// Why a source could not be prepared for its guest — because of what the **model wrote**.
///
/// Every variant is **recoverable and model-facing** — the model wrote something it can fix, is told
/// exactly what, and writes another program next turn. None of them is a run-ending failure, and
/// none of them costs any *engine* work: a program that does not prepare never reaches the
/// component, so there is no store, no instantiate and no guest. A language whose prepare step
/// invokes a compiler does spend that compiler's time on the way here, which is why the sandbox
/// [times the step](super::SandboxOutcome::compile) on the failing path as well as the succeeding
/// one; "no engine work" is not "free".
///
/// The five kinds are the ones every language's prepare step distinguishes, whatever its toolchain
/// calls them, and they are kept apart because they have *different causes*: a syntax error is a
/// typo, a semantic error is almost always two programs in one reply, a compile error is a program
/// the language's checker read whole and rejected, a lowering failure is a defect in the pipeline
/// rather than in the reply, and a refusal is gg declining something the sandbox has no
/// implementation of. Telling them apart in the telemetry is how each shows up as a rate rather
/// than as anecdote.
///
/// What is **not** here is a compiler that could not finish — a `swiftc` that crashed, a toolchain
/// binary that is not installed, a compile that outran its own timeout. That is not the model's
/// program and there is no diagnostic to show it, so it is [`PrepareFailure::Toolchain`] rather
/// than a variant of this enum.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PrepareError {
    /// The source is not valid in this language — the parser's own diagnostics, located in the
    /// program's own coordinates so the model sees *where* rather than only *what*.
    #[error("{0}")]
    Syntax(String),
    /// It parses, but breaks a rule the language enforces before any statement runs: a `const`
    /// declared twice, a duplicate binding in a destructuring pattern. Carries the same located
    /// rendering a syntax error does.
    #[error("{0}")]
    Semantic(String),
    /// A **compiler read the whole program and rejected it** on grounds that are neither a parse
    /// failure nor an early error the language enforces before any statement runs: a type error, a
    /// borrow error, a name that does not resolve, an interface a class does not satisfy. Carries
    /// the compiler's own diagnostics, located in the program's own coordinates.
    ///
    /// Kept apart from [`Syntax`](Self::Syntax) and [`Semantic`](Self::Semantic) rather than folded
    /// into either, because the three have different causes and want different answers. A syntax
    /// error is a typo and a semantic error is almost always two programs in one reply; a compile
    /// error is a program the model wrote *whole and coherently* and got wrong about the surface it
    /// was writing against — which is the single most interesting thing a checked language's arm can
    /// tell a study about the SDK it was handed. Folding it into one of the others would destroy a
    /// distinction that already earns its keep.
    ///
    /// It is **recoverable**, like every variant here: the model is handed the diagnostic and writes
    /// another program. A model's own type error must never reach
    /// [`SandboxError::Compile`](super::SandboxError::Compile), which is the committed interpreter
    /// component failing to compile — an artifact defect that ends the session.
    ///
    /// TypeScript raises it: its prepare step runs `tsc` over the model's own source against the
    /// SDK's declarations, and hands back the compiler's diagnostics unaltered but for the one line
    /// number the wrapper it is checked in made wrong.
    #[error("{0}")]
    Compile(String),
    /// It could not be lowered into what the guest evaluates. Distinct from
    /// [`Syntax`](Self::Syntax) because it is not the model's text that failed but the transform
    /// over it — a distinction worth keeping when one of the two starts happening and the other does
    /// not.
    #[error("{0}")]
    Lowering(String),
    /// It asks for something the sandbox will not run it with, and is refused with an explanation of
    /// what to write instead — a module import where there is no loader, an `await` where there is
    /// no event loop, a nesting depth the host's parser is not given room for.
    #[error("{0}")]
    Unsupported(String),
}

impl PrepareError {
    /// The [turn error type](TurnErrorType) this failure is recorded as.
    ///
    /// It lives here, beside the enum, rather than in the turn loop's `match`: the five causes this
    /// type exists to keep apart are this module's knowledge, and a caller re-deriving them would be
    /// a second place for them to be got wrong. Every one lands under
    /// [`Transpile`](crate::limits::TurnErrorKind::Transpile) at the base level, so the wire value
    /// persisted run data reads is untouched.
    pub fn turn_error_type(&self) -> TurnErrorType {
        match self {
            Self::Syntax(_) => TurnErrorType::TranspileSyntax,
            Self::Semantic(_) => TurnErrorType::TranspileSemantic,
            Self::Compile(_) => TurnErrorType::TranspileCompile,
            Self::Lowering(_) => TurnErrorType::TranspileLowering,
            Self::Unsupported(_) => TurnErrorType::TranspileUnsupported,
        }
    }
}

/// Why one of a language's [prepare steps](ProgramLanguage::prepare_program) did not hand back a
/// prepared source — split by **whose failure it was**.
///
/// The two halves are not two flavours of one thing, and the split is the whole reason this type
/// exists. A [`Program`](Self::Program) failure is the model's: its text was read and found wanting,
/// there is a diagnostic to hand back, and the next turn's program may well be fine because the
/// model changed it. A [`Toolchain`](Self::Toolchain) failure is the *compiler's*: nothing was
/// decided about the program at all, there is no diagnostic, and the next turn's program may well be
/// fine because nothing was ever wrong with this one.
///
/// Before a language compiled, the distinction had no producer and the seam carried
/// [`PrepareError`] directly. It does now: a compiler is a process, and a process that segfaults, is
/// killed by its timeout, or is missing from the image is a failure with no model-facing content —
/// and reporting it to the model as "your program did not compile" would send a model rewriting a
/// program that was never wrong, which is the one misattribution this codebase spends the most
/// effort not making.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PrepareFailure {
    /// The **program** is what failed, in one of the [five ways](PrepareError) a language tells
    /// apart. Recoverable and model-facing.
    #[error("{0}")]
    Program(#[from] PrepareError),
    /// The **compiler could not finish**: it crashed, was killed by its own timeout, or is not
    /// installed in this image. Recoverable — the next turn may compile — but not the model's fault
    /// and not answered with a diagnostic, because there is none.
    ///
    /// Carries what gg can say about the failure for the run's *operator*: the exit status, the
    /// signal, the tail of the compiler's stderr. It reaches the model only as a system notice
    /// saying its program was not run, never as a compiler error.
    ///
    /// TypeScript raises it: its checker is `node` running a committed `tsc`, and a `node` that is
    /// not on `PATH`, a check that outran its timeout, and a compiler killed by a signal are all
    /// failures with nothing in them for a model to fix.
    #[error("{0}")]
    Toolchain(String),
}

/// A resolved [program language](GgProgramLanguage) together with the `language` value gg could not
/// read, if any — the same shape [`ResolvedHealing`](crate::healing::ResolvedHealing) takes, and
/// reported the same way at launch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedProgramLanguage {
    /// The language this agent's programs are written in.
    pub language: GgProgramLanguage,
    /// The bare `language` key, when its value named no language gg has. Reported at `warn` when the
    /// run starts.
    pub unknown_params: Vec<String>,
}

/// Resolve the [program language](GgProgramLanguage) from the
/// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) capability's `language` param.
///
/// | `params.language` | Language |
/// | --- | --- |
/// | absent / `null` / `"typescript"` | [`TypeScript`](GgProgramLanguage::TypeScript) — the default |
/// | `"javascript"` | [`JavaScript`](GgProgramLanguage::JavaScript) — the same surface, unchecked |
/// | `"python"` | [`Python`](GgProgramLanguage::Python) — a committed CPython, evaluating the reply as written |
/// | `"ruby"` | [`Ruby`](GgProgramLanguage::Ruby) — compiled to JavaScript by the committed Opal, then evaluated |
/// | `"purescript"` | [`PureScript`](GgProgramLanguage::PureScript) — type-checked and compiled to JavaScript by the image's `purs`, bundled, then evaluated |
/// | `"java"` | [`Java`](GgProgramLanguage::Java) — compiled by `javac` and TeaVM in a warm JVM, then evaluated |
/// | `"kotlin"` | [`Kotlin`](GgProgramLanguage::Kotlin) — compiled as a script by the Kotlin compiler and TeaVM in a warm JVM, then evaluated |
/// | anything else | [`TypeScript`](GgProgramLanguage::TypeScript), and the value is reported |
///
/// Read literally and reported on mismatch for the same reason
/// [`resolve_assistant_messages`](crate::healing::resolve_assistant_messages) is: the value is
/// contract-visible (the console's capability catalogue writes it, persisted run data records it),
/// so a typo must change *nothing* silently rather than quietly run an arm the study did not ask
/// for. Reading `"pythn"` as Python would be bad; reading it as TypeScript **without saying so**
/// would be worse, because the run would then be recorded under a language nobody chose.
///
/// Per **agent**, like [`resolve_sandbox_limits`](super::resolve_sandbox_limits) and
/// [`resolve_healing`](crate::healing::resolve_healing): responses-as-code is a per-agent
/// capability, so one run may drive a root in one language and a reviewer in another. A capability
/// that is present but **disabled** configures nothing.
pub fn resolve_program_language(profile: &GgAgentConfig) -> ResolvedProgramLanguage {
    let mut resolved = ResolvedProgramLanguage {
        language: GgProgramLanguage::default(),
        unknown_params: Vec::new(),
    };
    let Some(capability) = profile
        .capability(CAPABILITY_RESPONSES_AS_CODE)
        .filter(|capability| capability.enabled)
    else {
        return resolved;
    };
    let Some(value) = capability.params.get("language") else {
        return resolved;
    };

    match value {
        serde_json::Value::Null => {}
        serde_json::Value::String(id) => match GgProgramLanguage::from_id(id) {
            Some(language) => resolved.language = language,
            None => resolved.unknown_params.push("language".to_string()),
        },
        _ => resolved.unknown_params.push("language".to_string()),
    }
    resolved
}

#[cfg(test)]
#[path = "language.test.rs"]
mod tests;
