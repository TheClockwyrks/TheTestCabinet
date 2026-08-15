//! **The program-language seam** — the one place gg says what a
//! [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) program is written in,
//! and everything that follows from the answer.
//!
//! gg used to have exactly one answer, spelled out in a dozen places: the type-strip was
//! TypeScript's, the prebuilt component was TypeScript's, the signature catalogue's entries were
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
//! * which prebuilt component evaluates it ([`ProgramLanguage::guest_component`]);
//! * how its SDK spells the surface ([`ProgramLanguage::catalogue`]);
//! * and the source gg **writes on the model's behalf** — the synthesized file view
//!   ([`ProgramLanguage::open_file_statement`]), the on-use script of a built-in family skill
//!   ([`ProgramLanguage::open_docs_views_statement`]), and the program that opens the session
//!   ([`ProgramLanguage::bootstrap_program`]).
//!
//! # What a language does not own: the prose
//!
//! There is **one** responses-as-code system prompt for every arm, registered in
//! [`prompts`](crate::prompts) and rendered from one `.hbs` file. A sentence that really is one
//! arm's — the shape of a reply, what a failed call does, how an optional argument is written — is a
//! segment of that template gated on the language's id, and anything a model can find by searching
//! is in no part of it. Its **spellings** are authored nowhere: a template quotes
//! `{{api.view.open_text.call}}` and the name is resolved from the rendering language's own
//! [catalogue](ProgramLanguage::catalogue) at render time, so there is one copy of each name rather
//! than two that have to agree, and no segment may write a call out in prose.
//!
//! Two things stay out of that template, each for its own reason. The refusals a language produces
//! while *preparing* a program belong to the prepare step, because they answer something the model
//! just wrote rather than standing in front of it. And a function's signature, description and
//! summary are reflected out of the declaration they describe into the arm's catalogue, because a
//! signature authored on gg's side is one nothing can compare against the code.
//!
//! # Why the registry is trait objects
//!
//! [`language`] is an exhaustive `match` handing back a `&'static dyn ProgramLanguage`, and
//! [`all_languages`] is *derived* from [`GgProgramLanguage::ALL`] rather than being a second list
//! somebody has to remember to extend. Adding a variant to the core enum therefore fails to compile
//! until this module has an arm for it, and the new arm is instantly in every iteration — the drift
//! gates, the healing invariant, the opening turn. `ALL` itself is not a list anyone can
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

use super::CodeModule;
use super::operations::OperationId;
use super::signatures::SignatureCatalogue;

#[path = "language/compile.rs"]
pub mod compile;

pub use compile::{
    CompilerCommand, CompilerDaemon, CompilerPool, CompilerReport, PrepareContext, Workspace,
    daemon, place, place_tree, shared_toolchain_dir,
};

#[path = "language/diagnostics.rs"]
mod diagnostics;

pub use diagnostics::library_set;

#[path = "language/typescript.rs"]
mod typescript;

#[path = "language/javascript.rs"]
mod javascript;

#[path = "language/python.rs"]
pub(super) mod python;

#[path = "language/ruby.rs"]
mod ruby;

#[path = "language/purescript.rs"]
mod purescript;

#[path = "language/jvm.rs"]
mod jvm;

#[path = "language/java.rs"]
mod java;

#[path = "language/kotlin.rs"]
mod kotlin;

#[path = "language/rust.rs"]
mod rust;

#[path = "language/swift.rs"]
pub(super) mod swift;

#[path = "language/cpp.rs"]
mod cpp;

#[path = "language/csharp.rs"]
mod csharp;

/// The **cross-arm capability gate**: the assertion that every registered language lets a model do
/// the same things, under the same conditions, whatever shape its SDK gives them.
///
/// `#[cfg(test)]` because it is a gate rather than a runtime need — it reads every arm's catalogue
/// and compiles components, which is a test's budget and not a turn's. Its own module documentation says
/// why an A/B study is worthless without it.
#[cfg(test)]
#[path = "language/agreement.rs"]
mod agreement;

/// The **documentation register gate**: the assertion that the prose an arm's SDK puts in front of a
/// model is written in the register gg chose — one line of brief, closed code spans, no narrative.
///
/// `#[cfg(test)]` for the reason [`agreement`] is: it reads every arm's catalogue and answers a
/// question about the prose in it, which is a test's budget rather than a turn's. Its module documentation says
/// why a policy about *text* is one implementation here instead of eleven in eleven reflectors.
#[cfg(test)]
#[path = "language/register.rs"]
mod register;

/// The **per-agent compiler isolation gate**: the assertion that preparing a program is a function of
/// that program alone, held under the concurrency a run really produces.
///
/// `#[cfg(test)]` for the same reason [`agreement`] is — it spawns compilers sixteen at a time, which
/// is a test's budget and not a turn's. Its module documentation carries the two measured
/// silent-corruption bugs it reproduces.
#[cfg(test)]
#[path = "language/isolation.rs"]
mod isolation;

// WHAT USED TO BE DECLARED HERE: `artifacts`, the hand-built artifact gate — the assertion that
// every committed binary gg carried was built from the sources of the checkout carrying it. It
// recomputed, from the tree, the SHA-256 of every source a `build.sh` had recorded in a manifest
// beside its output, and failed BY ARM NAME when the two had parted; and its last test inverted the
// question, walking `crates/gg/src/sandbox/{guests,checkers}` and demanding that every file found
// there be either described by a manifest or argued for by name.
//
// GG CARRIES NO COMMITTED BINARY ANY MORE, so it had no subject left. Ten crates under
// `crates/gg-sandbox-artifacts/` serve the eleven arms — `typescript` serves JavaScript too, because
// those two arms are one guest — each running its `build.sh` into a cargo `OUT_DIR`, and the arm
// modules `include_bytes!` from there — so a source edited without a rebuild is not a
// state the tree can reach, rather than a state a test reports. `guests/` no longer exists at all,
// and `checkers/` holds five files that are gg's own hand-written Java and its two JVM pins.
//
// The one test worth mourning is `every_committed_artifact_is_covered`, which existed to force
// somebody to SAY, in prose, why a newly committed blob needed no gate. It dies correctly: it was a
// question about committed files, and the answer it was pushing toward — "generate it during the
// build" — is the one every arm took. `scripts/gg-arms.sh`'s `--artifacts` list is what a twelfth
// arm must now be added to, and `gg-artifact-build` checks that list against what the build really
// wrote, which is the same forcing function one layer up and on the right side of the gap.

/// **Gate G8**: the assertion that a runtime failure reaches the model — on every arm, for all five
/// shapes a failure takes.
///
/// `#[cfg(test)]` because it drives eleven real toolchains through five real failures each, which is
/// a gate's budget and not a turn's. Its module documentation carries the table of every cell that
/// is not satisfied today and why the table fails in both directions.
#[cfg(test)]
#[path = "language/g8.rs"]
mod g8;

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

    /// How this language writes the step from an **API object** to one of its functions —
    /// `"."` for almost everyone, `"::"` for a language whose objects are modules.
    ///
    /// A spelling, and one of the few the seam has to know about rather than resolve from a
    /// catalogue: every function's *name* comes out of the catalogue, but the punctuation between an
    /// object and its function is not a name and appears in no declaration. gg quotes qualified calls
    /// in its own sentences ([`spell`]) and in the system prompt (`{{api.view.open_text.call}}`), so
    /// a language that writes `view::open_text` and is quoted as `view.open_text` is one whose model
    /// reads a prompt full of code that does not compile.
    ///
    /// The **object** half is still identity and no language may rename it. This is only how the two
    /// halves are joined. `"."` is the default because it is what every arm but one writes.
    fn member_separator(&self) -> &'static str {
        "."
    }

    /// **How a program reaches one export of a module bound at `lib.<key>`**, in this arm's own
    /// spelling, with `<name>` standing in for the export.
    ///
    /// This is the sentence the reply to a [code skill or memory](crate::knowledge)'s read is built
    /// from, and it is the **only** place a model learns it: `lib` binds no catalogued function, so
    /// there is nothing to search for, and the system prompt states what a model cannot be told at
    /// the moment it matters rather than what it can. The moment it matters is the read that bound
    /// the module, so the read is what says it.
    ///
    /// The default is a path, which is what eight arms write. The three that reach a module **by
    /// string** — because it is compiled separately and there is no import for their compiler to
    /// check a program against — override it, and a family of calls that differ by what they hand
    /// back is written `<text|number|flag|run>` rather than as one of its members, so a model
    /// reading the note is not shown one arm of a choice it has to make.
    fn lib_access(&self, key: &str) -> String {
        let step = self.member_separator();
        format!("lib{step}{key}{step}<name>")
    }

    /// This language's name as a **human** reads it — `"TypeScript"`.
    ///
    /// Read by the operator — the launch warning that lists the languages gg can drive, the warm-up
    /// line that names which component compiled — **and by the model**: one system prompt serves
    /// every arm, so the sentence that tells an agent which language its reply is read as is
    /// rendered from this name rather than written out eleven times. Changing it changes what an
    /// agent is told it is writing.
    fn display_name(&self) -> &'static str;

    /// Turn a model's reply into the source the guest evaluates as a program.
    ///
    /// This is where a language spends whatever it must to make untrusted text safe to hand to a
    /// parser, and where it refuses — with a sentence the model can act on — anything the sandbox
    /// has no implementation of.
    ///
    /// # Why the modules are here
    ///
    /// `modules` is what this agent has already loaded by reading a code
    /// [skill](crate::skills) or [memory](crate::memories) — each one already through
    /// [`prepare_module`](Self::prepare_module) — and it is passed to the **program's** preparation
    /// because for one shape of arm the two cannot be prepared apart.
    ///
    /// An **interpreted** arm ignores it entirely: its guest is handed the same list on the wire and
    /// evaluates each module before the program, so the binding at `lib.<key>` is made at run time
    /// and a program's preparation has no business knowing what is in scope. A **compiled** arm has
    /// no such moment. Rust's module is Rust, Rust is compiled, and a compiled module is only
    /// reachable from the program that was linked against it — so on that arm the modules are
    /// *inputs to the program's compile*, and a seam that withheld them would be a seam on which a
    /// code skill silently bound nothing.
    ///
    /// The list is the modules **in scope**, in binding order, which is exactly what
    /// [`ProgramScope::modules`](super::ProgramScope) carries to the guest. An implementation that
    /// does not need them is not required to say so; ignoring the parameter is the whole of what an
    /// interpreted arm does with it.
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
    /// isolation gate (`language/isolation.rs`) for what enforces it.
    ///
    /// One thing this is *not*: a stall risk. This runs on a blocking task, so a compiler that takes
    /// seconds does not hold up the loop or any sibling agent. The hazard is contention and shared
    /// state, and designing against the wrong one costs isolation that is actually needed.
    fn prepare_program(
        &self,
        source: &str,
        modules: &[CodeModule],
        context: &PrepareContext,
    ) -> Result<PreparedProgram, PrepareFailure>;

    /// What a program of this language is judged by, named the way this language's own users name
    /// it — `tsc`, `rustc`, `mypy` — or `None` for a language whose [prepare
    /// step](Self::prepare_program) invokes no **compiler** at all.
    ///
    /// The name is a **spelling**, and belongs to the language for the same reason every call's
    /// does: what two arms of a study share is that a program is checked before it runs, never what
    /// the thing doing the checking is called. The one system prompt renders the name from here,
    /// because a model told its program is checked and not told by what has been given half a
    /// sentence — and answering `None` is what takes the sentence away entirely on an arm where
    /// nothing reads a program before it runs, rather than leaving a promise no compiler keeps.
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
    /// [isolation rule](Self::prepare_program)
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

    /// The prebuilt guest component that evaluates this language's prepared source, embedded in
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
    /// A prebuilt component is what an **interpreted** arm has: Python's holds a whole CPython,
    /// Ruby's holds Opal, the ECMAScript one holds a JavaScript engine, and every program of that
    /// language crosses the membrane as a *string* the runtime inside evaluates. A **compiled** arm
    /// has no such thing to commit. `rustc` does not produce a Rust runtime that later runs a
    /// program; it produces the program, as a wasm module, and that module is the component. There
    /// is no artifact of that language that is not a particular program — so a language of this
    /// shape answers `None` here and hands its bytes back on
    /// [`PreparedProgram::component`](PreparedProgram::component) instead.
    ///
    /// The two are not both allowed to be present. A language that declares a prebuilt component *and*
    /// compiled one per program would have two answers to "what evaluated this turn", and the run's
    /// record could only carry one of them.
    fn guest_component(&self) -> Option<&'static [u8]>;

    /// Whether this language's [prepare step](Self::prepare_program) produces the component its
    /// program is evaluated by, rather than handing source to a
    /// [prebuilt](Self::guest_component) one. Derived rather than declared, so the two can never
    /// disagree.
    fn compiles_component(&self) -> bool {
        self.guest_component().is_none()
    }

    /// This language's signature catalogue, parsed once per process.
    ///
    /// Every implementation answers with a `&'static str` embedded from the build's own `OUT_DIR`:
    /// `crates/gg/build.rs` reflects all eleven out of their SDKs as a step of compiling this crate,
    /// so the surface a model is told about is the surface the SDK in this checkout declares, and
    /// there is no committed copy that could disagree with it. What each arm still asserts here is
    /// that it got *its own* — eleven reflectors write eleven stems into one directory, and a
    /// catalogue read under the wrong stem would be a prompt describing a sandbox nobody has.
    fn catalogue(&self) -> &'static SignatureCatalogue;

    /// The dialect [response healing](crate::healing) asks its language-shaped questions of.
    ///
    /// Healing is not part of the sandbox and does not import it — the trait is declared over there
    /// and implemented over here, so the arrow points one way and this module is the only thing that
    /// knows both halves exist.
    fn healing(&self) -> &'static dyn crate::healing::Dialect;

    /// The one statement a program writes to open a view of `path` — the whole file, or one
    /// `offset`/`limit` [window](FileWindow) of it — as this language spells it, terminated the way
    /// this language terminates a statement.
    ///
    /// A trait method rather than something resolved out of the catalogue because it is not a name.
    /// The optional half is an **arguments idiom** the seam explicitly leaves to each language (a
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
    /// One of the two whole programs gg generates rather than quoting — the other opens the session
    /// ([`bootstrap_program`](Self::bootstrap_program)) — and it is not optional: it is
    /// the on-use script of every [built-in family skill](crate::skills), so a language that could
    /// not write it would be a language whose agents read a skill and are shown nothing. The set of
    /// names is exactly the family this agent binds, which is why the program is generated at all —
    /// a skill that hard-coded a list would be a second answer to a question the catalogue already
    /// answers.
    ///
    /// A trait method rather than a `format!` in [`skills`](crate::skills) because every token of it
    /// is this language's: the list literal, the loop, the statement terminator, and the name of the
    /// call itself. The implementation is expected to resolve that name with
    /// [`spell`]`(self, `[`VIEWS_OPEN_DOCS_VIEW`](super::VIEWS_OPEN_DOCS_VIEW)`)` rather than
    /// writing it out, for the same reason nothing else does.
    fn open_docs_views_statement(&self, names: &[&str]) -> String;

    /// A whole **program** that lists each module in `modules` and opens a documentation view of
    /// each name in `docs`, as this language spells and structures it.
    ///
    /// It is gg's [opening turn](crate::bootstrap): the program is pushed into the agent's window as
    /// the assistant message the session opens on, and *then* prepared and run. That order is the
    /// window's rather than the work's convenience — the reply comes first and everything its own
    /// calls placed comes after it, which is how a transcript reads when a turn really happened. So
    /// the first example of its own output a model reads is a program that provably ran, and the
    /// documentation beside it was placed by that program's own calls rather than by gg reaching
    /// around it.
    ///
    /// Two groups, in the order the model reads them: every search first, then every documentation
    /// view. Each search is a **whole-module lookup** rather than a query — an empty query string,
    /// one module as the filter, and an explicit limit of
    /// [`MAX_SEARCH_LIMIT`](crate::docs::MAX_SEARCH_LIMIT), because the default page would silently
    /// truncate the listing of a large module and a truncated listing is a function the agent never
    /// learns it has.
    ///
    /// Both names are resolved with [`spell`]`(self, …)` rather than written out, exactly as
    /// [`open_docs_views_statement`](Self::open_docs_views_statement) resolves its one. What an
    /// implementation owns is the syntax around them, and it owes this program two things a quoted
    /// call does not owe: it must be **idiomatic**, because a model copies the shape it is shown;
    /// and it must handle failure the way this arm's programs handle it — propagating on a `Result`
    /// arm, letting it escape on a throwing one — because a bootstrap that swallowed a failure
    /// would open the window on a program the model would be wrong to imitate, and would leave a
    /// [failure that is gg's](crate::bootstrap) looking like a turn that worked.
    ///
    /// Not a concatenation of two generated statements: on several arms a program is one module,
    /// one `main` or one translation unit, so two programs do not add up to one.
    fn bootstrap_program(&self, modules: &[&str], docs: &[&str]) -> String;

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
    /// artifact will still hold it — the subject the isolation gate (`language/isolation.rs`) drives this
    /// language's [module step](Self::prepare_module) with.
    ///
    /// That gate drives *both* preparation steps sixteen ways, so it needs a source valid for each,
    /// and it takes the shorter of the two whole programs the seam guarantees, which is the one that
    /// carries a name it can look for afterwards:
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

    /// This arm's prepared artifact **made readable for the isolation gate's marker search**
    /// (`language/isolation.rs`): with any transport encoding taken back off, and nothing else done
    /// to it.
    ///
    /// Identity by default, and identity is what every arm but one wants: an interpreted arm's
    /// artifact is the source it hands the guest, and the arms whose compilers emit wasm keep the
    /// marker in the module's data section as the bytes the model wrote. It is applied to whichever
    /// half a language filled in — the [component](PreparedProgram::component) a compiled arm
    /// produced, or the [source](PreparedProgram::source) every other arm hands over — because the
    /// gate's question is the same for both.
    ///
    /// It exists because [C#](csharp) is neither of the seam's two shapes: its artifact is an IL
    /// **assembly**, and it rides over the wire's `program` string as base64 because that is the only
    /// channel the world has for it. Left encoded, the gate would be searching an alphabet no marker
    /// can survive, and would report every well-isolated C# preparation as one whose output does not
    /// carry its own input.
    ///
    /// **The contract runs one way: an implementation may only show the gate more.** Decode,
    /// unwrap, unpack — anything that reveals bytes the artifact really holds. It may never drop,
    /// mask, reorder or summarise any part of it, because everything downstream of here is a search
    /// for a marker, and a byte hidden here is a byte another agent's program could have been hiding
    /// in. Input this cannot make sense of is handed back untouched rather than replaced by
    /// nothing: a preparation that produced something unreadable is a failure the gate should see
    /// whole, and an empty artifact carries no marker at all.
    #[cfg(test)]
    fn isolation_readable(&self, artifact: Vec<u8>) -> Vec<u8> {
        artifact
    }

    /// Every way the isolation gate's marker (`language/isolation.rs`) may be **spelled inside** this arm's
    /// prepared program — the forms it accepts as "this artifact carries its own input", and rejects
    /// as "this artifact carries somebody else's".
    ///
    /// The marker itself for almost every arm, and that is not an assumption worth a hook on its
    /// own: an interpreted arm's artifact *is* source, and the three arms whose compilers emit wasm
    /// keep a string literal in the module's data section as the bytes the model wrote, so a
    /// byte-for-byte search finds it.
    ///
    /// It exists because [C#](csharp) does not. A .NET assembly keeps its user strings in the `#US`
    /// metadata heap as **UTF-16**, so the marker a model wrote as `gg-isolation-000-marker` is
    /// `g\0g\0-\0…` in the artifact — measured, not assumed — and a gate searching for the ASCII
    /// bytes would report every well-isolated C# preparation as one whose output does not carry its
    /// own input. That is a fact about how a compiler stores a string, which is exactly the kind of
    /// thing the seam has each arm declare rather than the gate guess at.
    ///
    /// An implementation must return forms that are **derived from the marker**, so that a form
    /// belonging to one input can never be found in another input's artifact. Returning something
    /// constant, or something every artifact carries, would turn this gate off.
    #[cfg(test)]
    fn isolation_marker_forms(&self, marker: &str) -> Vec<String> {
        vec![marker.to_string()]
    }
}

/// How `language` spells the [operation](super::operations::OperationId) `id`, qualified exactly as
/// a program writes it — `session.requestChanges`, or `Gg.Session.RequestChanges` on an arm whose
/// surface is modules.
///
/// **Both halves are the arm's**, resolved together from its own catalogue by the operation's
/// language-independent identity, so a language that renamed a function — or regrouped it — renames
/// it in gg's sentences too, with nothing to keep in step. Taking the qualifier from the operation's
/// own [namespace](super::operations::OperationId::namespace) instead would have gg quoting its own
/// vocabulary at a program that has no `views` to call anything on.
///
/// A catalogue that carries no such call falls back to gg's own id: the
/// [operation gate](super::operations) proves every model-facing call resolves in every registered
/// language, so the fallback is unreachable — and degrading one word of a notice is the right
/// failure anyway, where panicking mid-run is not.
pub fn spell(language: &dyn ProgramLanguage, id: OperationId) -> String {
    let (group, name) = super::signatures::spelling(language, id).unwrap_or((id.namespace, id.key));
    format!("{group}{}{name}", language.member_separator())
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
        GgProgramLanguage::Rust => &rust::RUST,
        GgProgramLanguage::Swift => &swift::SWIFT,
        GgProgramLanguage::Cpp => &cpp::CPP,
        GgProgramLanguage::CSharp => &csharp::CSHARP,
    }
}

/// Every registered language, in registration order.
///
/// **Derived** from [`GgProgramLanguage::ALL`] rather than kept as a second slice, so there is no
/// list to forget: a new variant arrives here the moment [`language`] has an arm for it, and every
/// gate that iterates languages covers it without being edited.
///
/// It is exactly the registered set, under test as in production: the
/// fixture language (`language/fixture.rs`) the seam's own tests are written against is deliberately **not** here,
/// so nothing that iterates this pays for it and nothing that reads it can be handed a language an
/// operator could not have configured.
pub fn all_languages() -> impl Iterator<Item = &'static dyn ProgramLanguage> {
    GgProgramLanguage::ALL.iter().copied().map(language)
}

/// A program that prepared cleanly: what the guest is handed, in whichever of the two shapes this
/// arm produces.
///
/// It carries no observation *about* the model's text, and that absence is the contract rather than
/// an omission. A preparation reads a program and either accepts it or refuses it with a diagnostic
/// the model can act on; anything else it thought it noticed on the way past would be gg's account
/// of a program in front of the language's own.
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
    /// **The component that evaluates this program**, for a language that compiled one *for this
    /// program* — `None` for every language whose programs are evaluated by a
    /// [prebuilt](ProgramLanguage::guest_component) one.
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
/// The four kinds are the ones every language's prepare step distinguishes, whatever its toolchain
/// calls them, and they are kept apart because they have *different causes*: a syntax error is a
/// typo, a semantic error is almost always two programs in one reply, a compile error is a program
/// the language's checker read whole and rejected, and a refusal is gg declining something the
/// sandbox has no implementation of. Telling them apart in the telemetry is how each shows up as a
/// rate rather than as anecdote.
///
/// Two failures are **not** here, and both are absent for the same reason — neither is the model's,
/// so neither may be recorded as the model's:
///
/// * a compiler that could not finish — a `swiftc` that crashed, a toolchain binary that is not
///   installed, a compile that outran its own timeout. There is no diagnostic to show, so it is
///   [`PrepareFailure::Toolchain`] and the run ends on it;
/// * a **lowering** failure, where the transform over a source the language already accepted fell
///   over, or the surface gg generated for the model to write against was itself rejected. That is
///   gg's own defect, so it is [`PrepareFailure::Lowering`] and the run ends on it.
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
    /// [`SandboxError::Compile`](super::SandboxError::Compile), which is the embedded interpreter
    /// component failing to compile — an artifact defect that ends the session.
    ///
    /// Every arm with a compiler in front of it raises it: TypeScript's prepare step runs `tsc` over
    /// the model's own source against the SDK's declarations, and the checked arms beside it run
    /// their own. What each hands back is that compiler's diagnostics, in the program's own
    /// coordinates — the one line number the wrapper it was checked in made wrong is corrected, and
    /// nothing else about the text is.
    ///
    /// It is **bounded**, and this is the type that makes the bound necessary. The `Display` above
    /// is `"{0}"` and nothing downstream shortens it: what an arm renders here is what the next
    /// request to the model carries, and goes on carrying for the rest of the session. So the size
    /// of a compiler's opinion is settled in the one place that knows what a diagnostic of that
    /// compiler costs — the arm — and the arms settle it through a shared cap, which shows the first
    /// few distinct diagnostics and closes with a count of the ones it did not. See the `diagnostics`
    /// module beside them for the measurement the number came out of.
    #[error("{0}")]
    Compile(String),
    /// It asks for something the sandbox will not run it with, and is refused with an explanation of
    /// what to write instead — a module import where there is no loader, an `await` where there is
    /// no event loop, a nesting depth the host's parser is not given room for.
    #[error("{0}")]
    Unsupported(String),
}

impl PrepareError {
    /// The [turn error type](TurnErrorType) this failure is recorded as.
    ///
    /// It lives here, beside the enum, rather than in the turn loop's `match`: the four causes this
    /// type exists to keep apart are this module's knowledge, and a caller re-deriving them would be
    /// a second place for them to be got wrong. Every one lands under
    /// [`Transpile`](crate::limits::TurnErrorKind::Transpile) at the base level, so the wire value
    /// persisted run data reads is untouched.
    ///
    /// It is total, and it can be: every variant of this enum is the model's, so every variant has
    /// an error type. The failures that have none are the ones that are not the model's, and they
    /// are not in this enum — [`Toolchain`](PrepareFailure::Toolchain) and
    /// [`Lowering`](PrepareFailure::Lowering) are charged to nothing at all, because each ends the
    /// run.
    pub fn turn_error_type(&self) -> TurnErrorType {
        match self {
            Self::Syntax(_) => TurnErrorType::TranspileSyntax,
            Self::Semantic(_) => TurnErrorType::TranspileSemantic,
            Self::Compile(_) => TurnErrorType::TranspileCompile,
            Self::Unsupported(_) => TurnErrorType::TranspileUnsupported,
        }
    }
}

/// Why one of a language's [prepare steps](ProgramLanguage::prepare_program) did not hand back a
/// prepared source — split by **whose failure it was**.
///
/// The three arms are not three flavours of one thing, and the split is the whole reason this type
/// exists. A [`Program`](Self::Program) failure is the model's: its text was read and found wanting,
/// there is a diagnostic to hand back, and the next turn's program may well be fine because the
/// model changed it. A [`Toolchain`](Self::Toolchain) failure is the run **image's**: nothing was
/// decided about the program at all and there is no diagnostic, so there is nobody to hand it back
/// to. A [`Lowering`](Self::Lowering) failure is **gg's**, for the same reason one step further in.
/// Only the first has a next turn worth taking.
///
/// Before a language compiled, the distinction had no producer and the seam carried
/// [`PrepareError`] directly. It does now: a compiler is a process, and a process that segfaults, is
/// killed by its timeout, or is missing from the image is a failure with no model-facing content —
/// and reporting it to the model as "your program did not compile" would send a model rewriting a
/// program that was never wrong, which is the one misattribution this codebase spends the most
/// effort not making.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PrepareFailure {
    /// The **program** is what failed, in one of the [four ways](PrepareError) a language tells
    /// apart. Recoverable and model-facing.
    #[error("{0}")]
    Program(#[from] PrepareError),
    /// **gg** is what failed: the transform over a source this language had already parsed and
    /// checked fell over, or the surface gg generated for the model to write against was itself
    /// rejected by the checker. The model's text was accepted and something on gg's side of the
    /// seam then could not carry it any further.
    ///
    /// It is neither of the other two, and lived as one of them until the run's
    /// [attribution](crate::fault) was taken seriously. It is not a [`Program`](Self::Program)
    /// failure: handing this diagnostic back under the `Compiler error` heading tells a model its
    /// program was rejected when the program was fine, files gg's bug in the model's `transpile`
    /// bucket, counts it against the model's error ceilings, and can end the session
    /// `limit_exceeded` with gg's defect recorded as the model's failure to write a compiling
    /// program. It is not a [`Toolchain`](Self::Toolchain) failure either: both end the run, and
    /// they are held apart because a bug in gg's pipeline and a compiler missing from the run's
    /// image are read, reported and fixed by different people.
    ///
    /// So it ends the run, at [`SandboxError::Lowering`](super::SandboxError::Lowering) and the
    /// [fault latch](crate::fault) behind it. The alternative is a turn the model paid for, told
    /// nothing about, and repeats — and a tree with a hole in it that is scored as though the model
    /// had produced the hole.
    ///
    /// Carries what gg can say about the failure for the run's **operator** and for nobody else —
    /// the one string in this enum with a single reader, and therefore the one bounded by what an
    /// operator can read rather than by what a model would be charged to read again every turn.
    #[error("{0}")]
    Lowering(String),
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

/// The [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) capability param naming the language an
/// agent writes its programs in. Absent takes [`GgProgramLanguage::default`].
pub const PARAM_LANGUAGE: &str = "language";

/// Resolve the [program language](GgProgramLanguage) from the
/// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) capability's [`language`](PARAM_LANGUAGE)
/// param.
///
/// | `params.language` | Language |
/// | --- | --- |
/// | absent / `null` / `"typescript"` | [`TypeScript`](GgProgramLanguage::TypeScript) — the default |
/// | `"javascript"` | [`JavaScript`](GgProgramLanguage::JavaScript) — the same surface, unchecked |
/// | `"python"` | [`Python`](GgProgramLanguage::Python) — a committed CPython, evaluating the reply as written |
/// | `"ruby"` | [`Ruby`](GgProgramLanguage::Ruby) — compiled to JavaScript by the embedded Opal, then evaluated |
/// | `"purescript"` | [`PureScript`](GgProgramLanguage::PureScript) — type-checked and compiled to JavaScript by the image's `purs`, bundled, then evaluated |
/// | `"java"` | [`Java`](GgProgramLanguage::Java) — compiled by `javac` and TeaVM in a warm JVM, then evaluated |
/// | `"kotlin"` | [`Kotlin`](GgProgramLanguage::Kotlin) — compiled as a script by the Kotlin compiler and TeaVM in a warm JVM, then evaluated |
/// | `"rust"` | [`Rust`](GgProgramLanguage::Rust) — compiled by `rustc` into the wasm component the turn is evaluated by |
/// | `"swift"` | [`Swift`](GgProgramLanguage::Swift) — compiled by `swiftc`, byte for byte, into the wasm component the turn is evaluated by |
/// | `"cpp"` | [`Cpp`](GgProgramLanguage::Cpp) — compiled by `clang++`, byte for byte, into the wasm component the turn is evaluated by |
/// | `"csharp"` | [`CSharp`](GgProgramLanguage::CSharp) — compiled by `csc`, byte for byte, into the IL assembly a committed Mono interpreter loads |
/// | anything else | **refused** — the launch does not start |
///
/// Read literally — with only surrounding whitespace forgiven — and [refused](crate::validate) on
/// mismatch, for a sharper version of the reason
/// [`resolve_assistant_messages`](crate::healing::resolve_assistant_messages) is: reading `"pythn"`
/// as Python would be bad, but reading it as TypeScript would record the run under a language nobody
/// chose — and the language is the very axis a cross-language study slices on. The default comes
/// back anyway to keep the resolver total for the per-turn calls that re-read it.
///
/// The vocabulary a refusal offers back is read off the [registry](all_languages) rather than off
/// the enum, so an operator is told the languages gg can actually drive rather than the ones it
/// merely knows the names of.
///
/// Per **agent**, like [`resolve_sandbox_limits`](super::resolve_sandbox_limits) and
/// [`resolve_healing`](crate::healing::resolve_healing): responses-as-code is a per-agent
/// capability, so one run may drive a root in one language and a reviewer in another.
///
/// The value is read whether the capability is switched **on or off**, like every other param in
/// the set — a disabled capability records the configuration the arm would have used, so the two
/// arms of one comparison stay symmetric, and a typo skipped because a switch happened to be off is
/// a typo that surfaces on the launch where it is flipped. It changes nothing about what the run
/// does: an agent without responses-as-code writes no programs, so the language it resolved to is
/// never asked for.
pub fn resolve_program_language(
    profile: &GgAgentConfig,
    report: &mut crate::validate::LaunchReport,
) -> GgProgramLanguage {
    let Some(capability) = profile.capability(CAPABILITY_RESPONSES_AS_CODE) else {
        return GgProgramLanguage::default();
    };
    let Some(value) = capability.params.get(PARAM_LANGUAGE) else {
        return GgProgramLanguage::default();
    };

    let unreadable = |written: String, report: &mut crate::validate::LaunchReport| {
        report.report(
            crate::validate::LaunchDefect::run_level(
                crate::validate::param_locus(CAPABILITY_RESPONSES_AS_CODE, PARAM_LANGUAGE),
                written,
                format!(
                    "the `{PARAM_LANGUAGE}` param names the language this agent writes its \
                     programs in; gg cannot drive that one, and writing {} instead would record \
                     the run under a language nobody chose.",
                    language(GgProgramLanguage::default()).display_name()
                ),
            )
            .known(all_languages().map(|language| language.id().id())),
        );
        GgProgramLanguage::default()
    };

    match value {
        serde_json::Value::Null => GgProgramLanguage::default(),
        serde_json::Value::String(id) => match GgProgramLanguage::from_id(id.trim()) {
            Some(language) => language,
            None => unreadable(id.clone(), report),
        },
        other => unreadable(other.to_string(), report),
    }
}

/// The language half of one profile's contribution to the
/// [launch pass](crate::validate::validate_launch): the [program language](GgProgramLanguage) it
/// declares, read exactly as the run will read it.
pub fn check_launch(profile: &GgAgentConfig, report: &mut crate::validate::LaunchReport) {
    resolve_program_language(profile, report);
}

#[cfg(test)]
#[path = "language.test.rs"]
mod tests;
