//! **Responses as code** — the wasmtime sandbox that runs an agent's code-shaped response as a
//! *program over the tools*.
//!
//! Under the [responses-as-code](https://docs.testcabinet.ai/gg/responses-as-code/) capability a
//! model answers a turn by writing a whole **program**, and every gg tool is a distinct, typed
//! function in that program's scope. This module is the host: it prepares the program for its
//! guest through the run's [program language](mod@language), evaluates it inside that language's
//! committed [interpreter component](engine) under an execution-timeout and linear-memory ceiling,
//! and bridges each typed call across the [membrane] to gg's real toolset.
//!
//! ## Which language, and what that means here
//!
//! The language is a per-agent configuration knob rather than a fact about gg — the axis a
//! cross-language study compares its arms on. [`language`](mod@language) is the seam: it owns how a reply becomes
//! evaluable source, which committed component evaluates it, and how its SDK spells the surface.
//! Everything in *this* module is written against that seam, so nothing here knows which language is
//! running.
//!
//! What does not vary is the surface itself. The trust boundary is a **WIT interface** in which each
//! tool is its own typed function with its own typed result and its own typed failure, and every
//! language's hand-written SDK binds that same interface: what differs between two arms is the
//! spelling of a call, never which calls exist. Nothing the interface does not declare is reachable.
//!
//! ## The latency property
//!
//! The interpreter component embeds a JavaScript engine, is ~13.4 MB, and takes ~660 ms to compile
//! on a many-core machine (~4.8 s on one core). That compile happens **once per process and
//! language**: the [`Engine`](wasmtime::Engine) and each compiled
//! [`Component`](wasmtime::component::Component) live behind a `OnceLock`, and every program pays
//! only instantiate (24–124 µs) and invoke (0.7–3 ms). [`precompile`] moves even that one compile
//! off the first turn's critical path.
//!
//! What a turn *does* pay is its own language's prepare step. TypeScript's is two passes: the `oxc`
//! type-strip, in-process at ~0.2 ms, and a `tsc` type check that spawns `node` against the
//! committed checker at ~90 ms. That is a real per-turn cost on the hot path, which is why it is
//! measured rather than assumed — see [`SandboxOutcome::compile`].
//!
//! ## What a program costs, and what bounds it
//!
//! A program is bounded by a wall-clock **execution timeout** on the guest's own CPU (the
//! [default](limits::DEFAULT_TIMEOUT) is 30 s) and a linear-memory cap — not by a fuel count. The
//! timeout exists only to stop a program that does not terminate: even the heaviest *honest* program
//! measured, rewriting twenty 64 KiB files, spends about 1.8 s of guest CPU, so a 30 s ceiling is
//! reached only by a runaway (`while (true) {}` burns the guest's clock at wall-clock speed). Time a
//! program spends parked in a bridged tool call — a `shell` build that takes minutes — is **excluded**
//! from the measurement, so waiting on a build is never mistaken for a loop. Why a timeout replaced
//! the fuel the sandbox used to meter, and how the exclusion is enforced, is in [`limits`].
//!
//! ## What a program can say, and what it cannot
//!
//! A program has exactly one channel for putting something in front of its **model**: a
//! [view](crate::context::ViewKind) — `view.openText` for a value it computed, `view.openFile` for a
//! file. `console.log` still works and is still captured, but it writes to the **operator**: the
//! turn's [`CodeExecution`](test_cabinet_core::gg::GgTelemetryKind::CodeExecution) event carries
//! every line, which puts them on the run's stream, in the run record and on the console. A top-level `return` ends the
//! program the way it ends any function body, and a value handed to it is **discarded** — the model
//! is told so, once, rather than left to infer the rule from an absence. That is a deliberate
//! subtraction. A returned value bought nothing an opened view does not, and it cost a whole family
//! of rules the model had to learn and gg had to enforce: what happens to a cycle, to a function, to
//! a structure nested past what the host's parser accepts, to a `Promise`. One rule — open a view of
//! what you want to see — replaces all of them.
//!
//! ## What a run yields
//!
//! [`run_program`] returns a [`SandboxOutcome`] on **every** path: the tool calls the program
//! composed, the lines it logged, the pictures it read, the time it ran and the completion it
//! declared are handed back even when the sandbox trapped, because those are exactly what the model
//! needs to see next turn — and, for the completion, what the *loop* needs in order to honour an
//! ending the program already declared. Only [`SandboxOutcome::result`] splits — a [`ProgramResult`]
//! (ran to its end, or threw) or a [`SandboxError`] (could not be run at all). Neither is ever a
//! crash of the run. The whole taxonomy, and what the loop is meant to do with each part of it, lives
//! in [`outcome`].
//!
//! ## How a run ends
//!
//! Under this capability every reply is a program, so there is no prose turn that could mean "I am
//! done". [`FINISH_FUNCTION`] is what means it, and it is the only thing that does: it is a typed
//! membrane function like every tool, but it dispatches nothing and is bound whatever the run
//! enables. What it does is **set a flag in the agent's host-side context**
//! ([`MembraneState`](membrane)) and return. The program runs on; the loop reads the flag once the
//! program has ended. Which ending an agent may declare is its [role](membrane::RunEnding)'s, and
//! the membrane refuses one outside it — a verdict is the one declaration nothing downstream
//! re-examines.
//!
//! Two consequences follow, and both are the point. A completion cannot be lost to a `try`/`catch`,
//! because there is no exception to catch — gg holds the flag, not the guest. And a completion *is*
//! lost when the program then fails: a throw or a sandbox ceiling revokes it, because a program that
//! did not run to its end did not finish the checks its summary rests on. The model is told, and
//! gets another turn.

use std::time::{Duration, Instant};

use wasmtime::component::{HasSelf, Linker};
use wasmtime::{Store, UpdateDeadline};

mod engine;
mod invoker;
mod language;
mod limits;
mod membrane;
mod operations;
mod outcome;
pub(crate) mod signatures;

pub use invoker::ToolApi;
pub use language::{
    CONTEXT_ARCHIVE_THREAD, CONTEXT_COMPACT, CONTEXT_EVICT_FILE_VIEW, FileWindow, HARNESS_FINISH,
    MEMORY_CREATE_MEMORY, MEMORY_DELETE_MEMORY, MEMORY_EDIT_MEMORY, MEMORY_READ_MEMORY,
    MEMORY_UPDATE_MEMORY, MEMORY_WRITE_MEMORY, PROGRAMS_GET, PROGRAMS_RERUN, PrepareFailure,
    PreparedModule, PreparedProgram, ProgramLanguage, REVIEW_APPROVE, REVIEW_REQUEST_CHANGES,
    SurfaceCall, UnreachableTail, VIEW_CLOSE, all_languages, language, resolve_program_language,
    spell,
};

// Named only in documentation and in the seam's own tests today, but exported all the same: they
// are part of the contract a second language implements, and a type a reader has to reach into a
// private module to read is a type nobody reads. `#[allow(unused_imports)]` because the crate
// denies warnings and none is *called* from outside `sandbox` yet — `PrepareError` reaches its
// consumers wrapped in a `PrepareFailure`, and is named here because a language implementer picking
// which of its five shapes a diagnostic is has to be able to see them.
#[allow(unused_imports)]
pub use language::{
    CompilerCommand, CompilerDaemon, CompilerPool, CompilerReport, PrepareContext, PrepareError,
    PromptDialect, ResolvedProgramLanguage, VIEW_OPEN_DOCS_VIEW, VIEW_OPEN_FILE, VIEW_OPEN_TEXT,
    Workspace, daemon, place, place_tree, shared_toolchain_dir,
};

// The seam's second implementation, which exists only under test. Re-exported for the one consumer
// outside `sandbox` that has to know about it: the prompt engine cannot render a template it never
// registered, so its registration walks the fixtures as well as the registry.
#[cfg(test)]
pub(crate) use language::fixture_languages;

// The fixture language's module itself, for the tests outside `sandbox` that drive one of its
// sentinel sources: a crate-wide seam is exercised from the crate's other modules, and a test that
// spelled `"nocompiler"` as a literal would go on passing after the fixture stopped meaning it.
#[cfg(test)]
pub(crate) use language::fixture;

// gg's own vocabulary of model-facing operations: the gating identity every catalogue entry is
// resolved through, and the successor of the bare `(object, key)` enumeration that preceded it.
pub use operations::{Binding, operation_of};

// **What one agent was granted, and the one predicate that reads it.** The membrane holds one to
// decide whether a call is serviced or refused; the documentation runtime holds one to decide what
// a search may return. Two readers, one implementation — see [`Grants`](operations::Grants) — and
// one construction of the capability half of it, so the two cannot be built from different lists.
pub use operations::{Grants, family_of_module, operation_by_call, surface_capabilities};

// The whole table, for the gates that resolve every operation against every registered language and
// against what the membrane records. A production reader resolves one entry at a time through
// [`operation_of`], and never walks the set.
#[cfg(test)]
pub(crate) use operations::OPERATIONS;

pub use limits::SandboxLimits;

// The table's own types, which nothing outside `sandbox` names *yet* and which are exported all the
// same because they are what `operation_of` hands back and what its fields are: an `Operation`
// carries an `OperationId` and an `Applicability`, and a type a reader has to reach into a private
// module to read is a type nobody reads. `#[allow(unused_imports)]` because `sandbox` is a private
// module — so these re-exports are reachable only from inside the crate, where the stages that
// consume them have not landed — and the crate is built with warnings denied.
#[allow(unused_imports)]
pub use operations::{Applicability, Operation, OperationId};

pub use outcome::{
    ProgramCompletion, ProgramError, ProgramErrorKind, ProgramResult, SandboxError, SandboxOutcome,
};

// The rest of the sandbox's surface, re-exported so `sandbox` is the single name the loop and the
// prompt import from.
pub use {
    invoker::ApiIdentity, invoker::DocSearchQuery, invoker::DocSearchResult,
    invoker::FunctionSummary, invoker::PROGRAM_CALL_ID_PREFIX, invoker::SandboxViewOpened,
    invoker::ViewOpenOutcome, invoker::ViewRefusal, limits::resolve_sandbox_limits,
    membrane::RunEnding, signatures::CatalogueFunction, signatures::Parameter,
    signatures::ParameterKind, signatures::TypeDeclaration, signatures::catalogue_functions,
    signatures::type_declaration,
};

// The catalogue types nothing outside `sandbox` names *yet*, exported all the same because they are
// fields of types it does: an `ObjectDoc` comes back from `catalogue_objects`, a `SignatureEntry`
// hangs off every `CatalogueFunction`, and a `TypeMember` off every `TypeDeclaration`. A type a
// reader has to reach into a private module to read is a type nobody reads, and the crate denies
// warnings.
//
// The normalized doc model's own types are here for the same reason and one more: they are the
// shape each arm is converted *into*, one commit at a time, so the readers that move onto them
// arrive stage by stage rather than all at once. `SchemaVersion` is what a reader dispatches on,
// `ModuleView` and `catalogue_modules` are the module half of the projection, `Prose` is every
// piece of documentation in it, and `EntryKind`, `MemberKind`, `MemberFunction`, `ModuleDoc` and
// `TypeReference` are its fields.
//
// `catalogue_objects` is here for the opposite reason: every reader that must answer for both
// schemas has already moved onto `catalogue_modules`, and what is left of it is the gates whose
// subject is an API object specifically. Those are `#[cfg(test)]`, so a build genuinely has no
// caller for it, and it goes with the last v1 arm rather than being kept alive by a new one.
#[allow(unused_imports)]
pub use signatures::{
    EntryKind, LibraryGroup, MemberFunction, MemberKind, ModuleDoc, ModuleView, ObjectDoc, Prose,
    SchemaVersion, SignatureEntry, TypeMember, TypeReference, catalogue_modules, catalogue_objects,
};

/// One code module as the guest binds it: the key it is reached at under `lib`, and the source
/// whose evaluation — in whatever that guest evaluates — produces its exports.
///
/// It is the world's own `code-module` record, re-exported so the [knowledge
/// registry](crate::knowledge) that produces these builds the type the membrane takes rather than
/// converting at the boundary.
pub use membrane::CodeModule;

/// One membrane-refused call, and one serviced one, as a test builds an outcome carrying them.
/// Production code reads both only off a [`SandboxOutcome`], which owns them by value, so nothing
/// outside the tests needs to name either type.
#[cfg(test)]
pub use invoker::{SandboxRefusal, SandboxToolCall};

use crate::tools::ToolRegistry;
use membrane::{MembraneParts, MembraneState, Sandbox};

/// **Everything one program was granted**, as one value: what its run enabled, what its agent's role
/// declares, and which capabilities it holds — plus the code modules bound beside its scope.
///
/// They travel together because they *are* one thing, the answer to "may this agent call X" — and
/// because that answer is now enforced in exactly one place. No guest builds a program's scope out
/// of them: every arm's SDK is **static**, every function is bound into every program, and a call
/// this agent was not granted reaches the [membrane](membrane::MembraneState) and is refused there
/// with a sentence naming the capability that is missing. This value is what that membrane is built
/// from, and the [documentation runtime](crate::docs::DocsRuntime) is built from the same three
/// facts, so what a search may show and what the host will service are one set.
///
/// The guest is still *told* them — the WIT `run` takes all three — and on the four arms that used
/// to build a scope from them, nothing reads them. See the WIT's own note for why the parameters
/// stay.
#[derive(Clone, Copy)]
pub struct ProgramScope<'a> {
    /// The run's scope-bound gg tool names ([`scope_tools`]) — every operation bound by one of them
    /// is available to this program, and every operation bound by a tool outside this set is
    /// refused when it is called.
    pub enabled: &'a [String],
    /// The already-prepared code the agent has loaded by reading a code [skill](crate::skills) or
    /// [memory](crate::memories). The guest evaluates each one before the program and binds its
    /// exports at `lib.<name>`; an empty list binds no `lib` at all.
    ///
    /// The one field here that really is about *scope*: a code module's binding key is a name the
    /// program would not otherwise have, and a run with no modules has no `lib` identifier at all.
    pub modules: &'a [CodeModule],
    /// Which group of ending calls this agent may **declare**: its own
    /// [role](crate::ending::EndingRole), or [none at all](RunEnding::None) for an on-use script.
    /// Every ending call is bound in every program; this decides which the host accepts.
    pub ending: RunEnding,
    /// Whether this agent keeps a [program library](crate::programs), which is what buys the three
    /// `programs` calls. A flag rather than a tool name because the library is one of the two
    /// model-facing families a *capability* gates rather than the toolset.
    pub library: bool,
    /// Whether this agent holds [`docview-close`](test_cabinet_core::gg::CAPABILITY_DOCVIEW_CLOSE),
    /// which is what decides whether it may take a documentation view back out of its window.
    ///
    /// The other capability-gated family. Unlike [`library`](Self::library) it is not on the WIT's
    /// `run` at all — there was never a guest that needed to hear it, because no arm's SDK spells
    /// the close calls and because, since the surfaces went static, no guest acts on any of these
    /// three anyway.
    pub docview_close: bool,
}

/// Run one program end to end: prepare it for its guest, instantiate that guest's interpreter
/// component, evaluate it, and report everything that happened.
///
/// `language` is the [program language](ProgramLanguage) this agent writes in — which decides how
/// `program` is prepared and which committed component evaluates it — `program` is the source the
/// model emitted, `scope` is everything the evaluated function's parameters are built from, and
/// `deadline` is the run's wall-clock budget, consulted before every bridged call so a program
/// cannot outlive the run it belongs to. Synchronous and CPU-bound, so the [loop](crate::agent) runs
/// it on `spawn_blocking`; every effect a *program* has goes through `invoker`, and the only work
/// this function does outside the engine is the language's own
/// [prepare step](ProgramLanguage::prepare_program) — which for a language that
/// [compiles](ProgramLanguage::prepare_compiles) is a compiler, and is timed as
/// [`SandboxOutcome::compile`](outcome::SandboxOutcome::compile) precisely because it is not free.
pub fn run_program<A: ToolApi>(
    language: &'static dyn ProgramLanguage,
    program: &str,
    scope: ProgramScope<'_>,
    limits: SandboxLimits,
    deadline: Option<Instant>,
    api: A,
) -> (SandboxOutcome, A) {
    // A test may have armed one of the failures gg's own machinery would have to be broken to
    // produce; see `force_next_program_fault`. The `api` is handed straight back — this fault is a
    // stand-in for a before-start failure, which never runs the program and never touches state.
    #[cfg(test)]
    if let Some(error) = forced_fault() {
        return (SandboxOutcome::before_start(error, None), api);
    }

    // A program that does not prepare never touches the engine: no store, no instantiate, no timer.
    // It may still have cost real time: for a language that compiles, this is the compiler, and the
    // reading is taken around both outcomes because a rejected program is the one whose cost would
    // otherwise be reported as nothing.
    let started = Instant::now();
    let prepared = prepare_program(language, program, scope.modules);
    let compile = language.prepare_compiles().then(|| started.elapsed());
    let prepared = match prepared {
        Ok(prepared) => prepared,
        // Whose failure it was is the language's answer, not this function's: a program the compiler
        // rejected and a compiler that could not finish arrive here as different variants and stay
        // different all the way to the turn's record.
        Err(failure) => {
            return (
                SandboxOutcome::before_start(SandboxError::from(failure), compile),
                api,
            );
        }
    };
    evaluate(language, prepared, scope, limits, deadline, api, compile)
}

/// Run a program that has **already been prepared** — the on-use script of a code
/// [skill](crate::skills) or [memory](crate::memories), which was prepared at the read so that
/// whoever wrote it got a located diagnostic there rather than two turns later.
///
/// It exists because a preparation is not repeatable in general. Preparing an already-prepared
/// program happens to be harmless on an arm whose output is source in the same language it read
/// (TypeScript's strip is idempotent), and is nonsense on every other shape: a Java arm handed its
/// own translated JavaScript back would refuse it, and a **compiled** arm's prepared program is not
/// source at all — Rust's is a wasm component and its
/// [`source`](PreparedProgram::source) is empty, so re-preparing it would compile the empty program
/// and report a clean run over a script that did nothing.
///
/// [`compile`](SandboxOutcome::compile) is `None` here, and that is an absence rather than a
/// missing measurement: what preparing this script cost was charged where it was spent, at the read,
/// onto [`KnowledgeModules::take_compile`](crate::knowledge::KnowledgeModules::take_compile).
pub fn run_prepared_program<A: ToolApi>(
    language: &'static dyn ProgramLanguage,
    prepared: PreparedProgram,
    scope: ProgramScope<'_>,
    limits: SandboxLimits,
    deadline: Option<Instant>,
    api: A,
) -> (SandboxOutcome, A) {
    #[cfg(test)]
    if let Some(error) = forced_fault() {
        return (SandboxOutcome::before_start(error, None), api);
    }
    evaluate(language, prepared, scope, limits, deadline, api, None)
}

/// Instantiate the component this program is evaluated by and run it — everything both entry points
/// do once there is a [`PreparedProgram`] in hand.
fn evaluate<A: ToolApi>(
    language: &'static dyn ProgramLanguage,
    prepared: PreparedProgram,
    scope: ProgramScope<'_>,
    limits: SandboxLimits,
    deadline: Option<Instant>,
    api: A,
    compile: Option<Duration>,
) -> (SandboxOutcome, A) {
    let ProgramScope {
        enabled,
        modules,
        ending,
        library,
        docview_close: _,
    } = scope;
    let unreachable = prepared.unreachable;
    // Either the language's committed component, or — for an arm whose prepare step compiled the
    // program itself into one — this program's own. The wait is reported the same way for both.
    let (component, compile_wait) = match engine::program_component(language, prepared.component) {
        Ok(component) => component,
        Err(error) => return (SandboxOutcome::before_start(error, compile), api),
    };

    let linker = match linker::<A>() {
        Ok(linker) => linker,
        Err(error) => return (SandboxOutcome::before_start(error, compile), api),
    };
    let mut store = bounded_store(
        MembraneState::new(api, language, scope, limits, deadline),
        limits,
    );

    let bound = match Sandbox::instantiate(&mut store, component.get(), &linker) {
        Ok(bound) => bound,
        Err(error) => {
            // An instantiation failure is either the memory cap denying the guest its heap or the
            // committed artifact importing something this membrane does not provide — i.e. the
            // component and the WIT have drifted apart.
            let error = engine::classify(&store, limits, &error, SandboxError::Instantiate);
            return reclaim(store, Err(error), unreachable, compile, compile_wait);
        }
    };

    let returned = bound
        .call_run(
            &mut store,
            &prepared.source,
            modules,
            enabled,
            ending.into(),
            library,
        )
        .map_err(|error| engine::classify(&store, limits, &error, SandboxError::Trap));
    // A program the sandbox stopped did not run to its end, so an ending it declared on the way is
    // revoked here for the same reason a throw revokes one in the guest's `catch`: `finish` is a
    // flag, and a flag set by a program that was then killed rests on checks that never completed.
    // The guest cannot do this half — a trap gives it no code to run — so the host does both.
    if returned.is_err() {
        store.data_mut().revoke_completion();
    }
    let returned = keep_reported_error(returned, &store);
    reclaim(store, returned, unreachable, compile, compile_wait)
}

/// Keep a **failure the program already reported** rather than replacing it with the trap that
/// followed.
///
/// A guest with an exception mechanism catches its own throw, calls `feedback.report-error` with a
/// message and a location, and returns normally — so the trap and the error never coexist and this
/// changes nothing for it. A guest without one cannot: `wasm32-unknown-unknown` has no unwinder, so
/// a Rust program's panic runs its hook and then **aborts**, which traps the store. The hook's host
/// call completes first and gg has the message, the class and the model's own line and column
/// already recorded; taking the trap as the verdict would throw all of that away and tell the model
/// "your program trapped" over a panic gg can describe exactly.
///
/// Only an ordinary [`Trap`](SandboxError::Trap) is displaced. A
/// [timeout](SandboxError::Timeout) and an [out-of-memory](SandboxError::OutOfMemory) are ceilings
/// gg imposed rather than anything the program said about itself, and a program that reported an
/// error and *then* ran away must be reported as the runaway — otherwise a loop after a caught
/// failure would be recorded as the caught failure.
fn keep_reported_error<A: ToolApi>(
    returned: Result<(), SandboxError>,
    store: &Store<MembraneState<A>>,
) -> Result<(), SandboxError> {
    match returned {
        Err(SandboxError::Trap(_)) if store.data().reported_error() => Ok(()),
        other => other,
    }
}

/// A linker carrying the whole membrane, and the host's WASI beside it.
///
/// The membrane is every one of the thirty-two typed gg tool functions, the four model-facing
/// carve-outs that are not tools (the [`finish`](FINISH_FUNCTION) that ends the run, the
/// documentation lookups, the view calls a program puts material into its own window with, and the
/// [program library](crate::programs) it reaches back through for a program it already ran), and the
/// shim's feedback channel. That is the whole of what a program can ask *gg* for. Everything a
/// guest's own language runtime reaches for is the WASI half below.
///
/// Building it per run rather than once per process is deliberate and nearly free: the whole thing,
/// WASI included, measures ~50 µs — the same order as the instantiate it precedes, and a couple of
/// percent of a typical invoke — and the expensive artifact (the compiled
/// [`Component`](wasmtime::component::Component)) is the one that is cached. Sharing a linker would
/// buy microseconds and cost the guarantee that a run's imports are assembled from nothing but its
/// own state.
///
/// # Why WASI is here at all, and why it is ambient
///
/// A guest toolchain emits a component that imports the WASI p2 surface —
/// `wasi:io`, `wasi:filesystem`, `wasi:clocks`, `wasi:random`, `wasi:sockets`, `wasi:cli` — whether
/// or not a program touches any of it, so a linker that defined none of it could not instantiate
/// one at all. gg therefore defines the whole surface, for every guest, unconditionally: a model
/// reaching for its language's ordinary file APIs instead of an SDK call is a model using the
/// language it was told to write in, and an agent already has [`shell`](crate::tools) in nearly
/// every configuration, so withholding the guest's own filesystem would deny nothing.
///
/// A component is only affected by the imports it *declares*, and the two namespaces do not
/// overlap, so what a guest does not ask for costs it nothing. The TypeScript guest asks for part of
/// this surface and not the rest: it imports `wasi:clocks`, `wasi:random` and `wasi:io` — which is
/// how a program's `Date.now()` and `crypto.randomUUID()` read the host's own clock and entropy —
/// and imports neither `wasi:filesystem` nor `wasi:sockets`, because its component is baked without
/// them. Those two are therefore *unused* by it rather than withheld from it, a distinction that
/// stopped being hypothetical with the committed `componentize-py` guest, which imports the whole
/// surface — twenty WASI interfaces to TypeScript's seven — and would not instantiate against a
/// linker built to that guest's appetite. The exact lists are asserted by
/// `the_committed_component_imports_the_membrane_and_the_wasi_it_was_baked_with` and by
/// `the_committed_guest_imports_the_whole_membrane_and_the_whole_wasi_surface`.
///
/// The one thing the host does not hand over is **stdout**: gg's telemetry stream *is* this
/// process's stdout (`crate::telemetry`, newline-delimited JSON), so a guest write to fd 1 would
/// corrupt the run's event stream. [`MembraneState`]'s context is built without it, and
/// `console.*` is rebound to the feedback channel instead.
fn linker<A: ToolApi>() -> Result<Linker<MembraneState<A>>, SandboxError> {
    let mut linker = Linker::new(engine::shared_engine());
    Sandbox::add_to_linker::<_, HasSelf<_>>(&mut linker, |state| state)
        .map_err(|error| SandboxError::Engine(error.to_string()))?;
    wasmtime_wasi::p2::add_to_linker_sync(&mut linker)
        .map_err(|error| SandboxError::Engine(error.to_string()))?;
    Ok(linker)
}

/// A store for one program, with both ceilings installed **before** anything is instantiated.
///
/// The memory limiter must be in place first because the guest engine allocates its ~10 MiB heap
/// while it initialises — which is why a cap below that floor fails at *instantiation* rather than
/// at the first allocation a program makes, and why the limiter's denial flag is what tells those
/// two apart.
///
/// # The execution timeout
///
/// The [timeout](SandboxLimits::timeout) is enforced by wasmtime **epoch interruption**: the store's
/// epoch deadline is armed against the process-wide [ticker](engine), and the callback below decides,
/// each time the deadline is reached, whether the guest has genuinely outrun its budget.
///
/// The decision is what makes the timeout bound the guest's *own* execution rather than raw wall
/// clock. A program parked in a long `shell` build accrues real time, so its deadline is reached
/// while it did nothing wrong — but [`guest_elapsed`](MembraneState::guest_elapsed) subtracts the
/// time spent in bridged calls, so the callback sees the guest is under budget and re-arms the
/// deadline for the remainder. Only a program burning the *guest's* clock — a runaway loop —
/// eventually reaches the deadline with its guest time genuinely spent, and only then does the
/// callback mark the state timed-out and trap. It never fails, so the store is returned directly.
///
/// An epoch deadline can only be *delivered* where the guest is executing wasm, so this bounds a
/// runaway loop and not a guest parked inside a synchronous WASI call — a `wasi:io/poll` sleep, a
/// blocking socket read. No guest gg ships today can reach that; the ones being added can. See
/// [`limits`](limits#what-the-timeout-cannot-stop-and-who-has-to-care) for what closing it takes.
fn bounded_store<A: ToolApi>(
    state: MembraneState<A>,
    limits: SandboxLimits,
) -> Store<MembraneState<A>> {
    let mut store = Store::new(engine::shared_engine(), state);
    store.limiter(|state| state.limiter());

    let timeout = limits.timeout;
    store.set_epoch_deadline(engine::epoch_deadline_ticks(timeout));
    store.epoch_deadline_callback(move |mut ctx| {
        let guest_elapsed = ctx.data().guest_elapsed();
        if guest_elapsed >= timeout {
            // The guest's own clock is spent: this is a runaway. Record it so `classify` can name
            // the cause after the trap unwinds — the trap itself carries no distinguishing code —
            // and trap by returning an error.
            ctx.data_mut().mark_timed_out();
            Err(wasmtime::Error::msg(
                "the program's execution timeout was reached",
            ))
        } else {
            // Time was spent parked in host calls, not looping. Re-arm for the guest budget that is
            // actually left, so waiting on a build is never mistaken for a runaway.
            Ok(UpdateDeadline::Continue(engine::epoch_deadline_ticks(
                timeout - guest_elapsed,
            )))
        }
    });
    store
}

/// Compile `language`'s interpreter component into the process-wide cache, and warm whatever its
/// [prepare step](ProgramLanguage::warm_prepare) would otherwise unpack on its first call, without
/// running anything — so the first code turn pays neither on its critical path.
///
/// Best-effort and idempotent (the `OnceLock` makes a second call free): fired once when
/// [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) is enabled, never by a
/// subagent. A failure is returned for logging, never propagated into the run — a run whose warm-up
/// failed simply pays the compile on its first code turn, and fails there in a way the model is
/// told about.
///
/// The [`Duration`] is how long the compile itself took, and `None` means it was already done — the
/// warm-up arrived second, which only happens when a code turn beat it. The run logs the figure,
/// because "how long is the one compile on *this* machine?" is what makes a slow first turn
/// interpretable, and it is core-count sensitive by a factor of seven (see [`engine`]).
pub fn precompile(
    language: &'static dyn ProgramLanguage,
) -> Result<Option<Duration>, SandboxError> {
    // Before the component, because it is the cheaper of the two and a failure in it is not
    // reported here at all: a language that could not warm its prepare step fails in the step
    // itself, on a turn, where the failure is classified and the model is told.
    language.warm_prepare();
    // A language that compiles a component **per program** has none to warm: there is no artifact
    // of it that is not a particular turn's program, so the only thing warming could compile here
    // is bytes no turn will use. Its warm-up is entirely its prepare step's, which is where its
    // toolchain and library set are unpacked.
    if language.compiles_component() {
        return Ok(None);
    }
    engine::component(language).map(|(_, compiled_in)| compiled_in)
}

/// Prepare a model's reply for `language`'s guest — the source it evaluates as a program, plus what
/// preparing it observed about the model's own text.
///
/// A free function dispatching through the trait, rather than a method callers reach for directly,
/// so that "prepare a program" reads the same at every call site whatever the run is configured
/// with.
///
/// It is also where a preparation's [context](PrepareContext) is minted — one per call, here and
/// nowhere else, because the context *is* the private ground a compiler runs on and one shared
/// between two preparations would be the corruption it exists to prevent. The context is dropped
/// when this returns, which is what removes the workspace; a language that wants an artifact must
/// read it before it hands one back.
///
/// `modules` is what the agent has loaded from code skills and memories, already prepared. Every
/// language is handed it; only one whose programs are **compiled** reads it, because only there is a
/// module something the program has to be built against rather than something its guest evaluates
/// beside it. See [`ProgramLanguage::prepare_program`].
pub fn prepare_program(
    language: &'static dyn ProgramLanguage,
    source: &str,
    modules: &[CodeModule],
) -> Result<PreparedProgram, PrepareFailure> {
    language.prepare_program(source, modules, &PrepareContext::new())
}

/// Prepare a code [skill](crate::skills)'s or [memory](crate::memories)'s source for `language`'s
/// guest — the source whose evaluation produces the namespace bound at `lib.<key>`, and the names
/// that namespace offers.
///
/// Its own [context](PrepareContext), for the reason a program's is its own: a turn that loads three
/// code skills compiles three modules, and two of them sharing a working directory is the same bug
/// as two agents sharing one.
pub fn prepare_module(
    language: &'static dyn ProgramLanguage,
    source: &str,
) -> Result<PreparedModule, PrepareFailure> {
    language.prepare_module(source, &PrepareContext::new())
}

/// The gg tool names to bind into a program's scope for `registry`: **every** tool the run offers.
///
/// There is no class of call a program is denied. gg once withheld the three *turn-level*
/// transitions — they changed the loop's mode rather than producing a value a program could use —
/// but those tools are gone, and nothing has replaced them, so a program's scope and a
/// tool-calling session's toolset are now the same set.
///
/// Derived from the registry rather than from a list, so a capability toggle or a per-tool ablation
/// changes the program's scope and the system prompt together — they are the same source.
pub fn scope_tools(registry: &ToolRegistry) -> Vec<String> {
    registry.tool_names()
}

/// The name of the one model-facing sandbox function that is **not** a gg tool: the call that ends
/// the run.
///
/// Declared here rather than in [`ALL_TOOL_NAMES`](crate::tools::ALL_TOOL_NAMES) because it is not a
/// tool — no capability offers it, nothing dispatches it, and it is bound into every program's scope
/// including one in a run that enables no tools at all, which must still be able to end.
/// `no_gg_tool_binds_the_name_finish` asserts the two vocabularies stay disjoint, so a gg tool can
/// never shadow it in a program's scope.
///
/// It is also the name the membrane reports a second, superseded completion under: that failure has
/// to name *something*, and naming a tool would put a word in the model's feedback that is not in its
/// toolset.
pub const FINISH_FUNCTION: &str = "finish";

/// The gg tool names `language`'s **component itself** says it can bind.
///
/// This asks the artifact rather than a source file, which is the one drift no compiler and no
/// source-level test can catch: a tool added, renamed or removed in gg with a stale `.wasm` still
/// checked in. It exists only for that test — a run never needs to ask, because the run's own
/// enabled set is what it passes in.
///
/// `artifact` is how a language that [compiles a component per program](ProgramLanguage) is asked:
/// it has no committed artifact to interrogate, so the caller compiles one program and hands the
/// bytes in. `None` means "the committed one", which is every other arm. The artifact is *stronger*
/// evidence in the compiled case rather than weaker — it cannot be stale, because it was built from
/// this checkout's SDK moments earlier.
#[cfg(test)]
pub(crate) fn component_bound_tools(
    language: &'static dyn ProgramLanguage,
    artifact: Option<Vec<u8>>,
) -> Result<Vec<String>, SandboxError> {
    let (holder, _) = engine::program_component(language, artifact)?;
    let component = holder.get();
    let linker = linker::<fake::FakeToolApi>()?;
    let limits = SandboxLimits::default();
    let log = fake::CallLog::default();
    // Nothing at all is offered: the guest reports what it *can* bind, which does not depend on
    // what this particular store enables.
    let scope = ProgramScope {
        enabled: &[],
        modules: &[],
        ending: RunEnding::None,
        library: false,
        docview_close: false,
    };
    let state = MembraneState::new(fake::FakeToolApi::new(&log), language, scope, limits, None);
    let mut store = bounded_store(state, limits);

    let bound = Sandbox::instantiate(&mut store, component, &linker)
        .map_err(|error| engine::classify(&store, limits, &error, SandboxError::Instantiate))?;
    bound
        .call_bound_tools(&mut store)
        .map_err(|error| engine::classify(&store, limits, &error, SandboxError::Trap))
}

/// The single exit point: reclaim everything the program accumulated, whatever happened to it.
///
/// The elapsed reading has to happen before the store is consumed, and the accumulated calls, logs,
/// pictures and completion have to be reclaimed even when the run trapped — so both live here rather
/// than at each of the three places a run can end.
///
/// It is named `reclaim` and not `finish` because `finish` now means something specific to a reader
/// of this crate: the one model-facing call that ends the run ([`FINISH_FUNCTION`]). Two unrelated
/// meanings of that word inside one module is exactly the confusion this rename removes.
fn reclaim<A: ToolApi>(
    store: Store<MembraneState<A>>,
    returned: Result<(), SandboxError>,
    unreachable: Option<UnreachableTail>,
    compile: Option<Duration>,
    compile_wait: Option<Duration>,
) -> (SandboxOutcome, A) {
    // Read the guest's own execution time before the store is consumed — the same figure the
    // timeout is measured against, and the efficiency signal that replaces the fuel reading.
    let elapsed = store.data().guest_elapsed();
    let (
        api,
        MembraneParts {
            calls,
            calls_suppressed,
            api_calls,
            refusals,
            refusals_suppressed,
            logs,
            logs_suppressed,
            views_opened,
            views_closed,
            view_refusals,
            views_suppressed,
            deferred_note,
            module_errors,
            returned_value,
            completion,
            revoked_completion,
            program_error,
            rerun,
            revoked_rerun,
        },
    ) = store.into_data().api_and_parts();

    let outcome = SandboxOutcome {
        tool_calls: calls,
        tool_calls_suppressed: calls_suppressed,
        api_calls,
        refusals,
        refusals_suppressed,
        logs,
        logs_suppressed,
        views_opened,
        views_closed,
        view_refusals,
        views_suppressed,
        deferred_note,
        module_errors,
        returned_value,
        // Carried out of the group that survives every exit path, because the flag lives in the
        // agent's context rather than in the program: a trap destroys the guest, not the fact that
        // this agent declared itself done — and whether that declaration survives the trap is
        // settled before this, by `revoke_completion`.
        completion,
        revoked_completion,
        rerun,
        revoked_rerun,
        elapsed,
        unreachable,
        compile,
        compile_wait,
        result: returned.map(|()| ProgramResult {
            error: program_error,
        }),
    };
    (outcome, api)
}

// ---------------------------------------------------------------------------------------------
// The fault seam
// ---------------------------------------------------------------------------------------------

/// The failure [`run_program`] must report instead of running, when a test has armed one.
///
/// # Why this exists
///
/// [`SandboxError::Engine`], [`SandboxError::Host`] and the two artifact-defect variants are the
/// inputs to the one branch of the [turn taxonomy](crate::limits::TurnOutcome) that keeps gg's own
/// failures **off** the model's error budget — and every one of them is, by construction, absent
/// from a healthy build. The committed component compiles and instantiates (the suite proves it on
/// every run), the engine's [`Config`](wasmtime::Config) is a fixed constant with no runtime input,
/// and the blocking task only fails to join if the host panicked. There is therefore no program a
/// test can write that reaches that branch, and without a seam it is the single arm of the loop with
/// no end-to-end proof — which is precisely the arm in which a regression would be silent, because
/// its whole purpose is to *not* charge the model for something.
///
/// # What keeps it honest
///
/// It is `#[cfg(test)]`, so it does not exist in a released binary. It is process-wide and one-shot,
/// which is what it stands in for: a component that will not compile is a property of the process
/// rather than of a turn, and the loop ends the session on the first occurrence anyway. And
/// `cargo nextest` runs one process per test, so arming it in one test can never reach another.
#[cfg(test)]
static FORCED_FAULT: std::sync::Mutex<Option<SandboxError>> = std::sync::Mutex::new(None);

/// Make the next [`run_program`] in this process report `error` instead of running the program.
///
/// See [`FORCED_FAULT`] for why the seam exists and what bounds it.
#[cfg(test)]
pub(crate) fn force_next_program_fault(error: SandboxError) {
    *FORCED_FAULT
        .lock()
        .expect("the fault seam holds no lock across a panic") = Some(error);
}

/// Take the armed fault, if a test armed one. Taking rather than reading is what makes it one-shot.
#[cfg(test)]
fn forced_fault() -> Option<SandboxError> {
    FORCED_FAULT
        .lock()
        .expect("the fault seam holds no lock across a panic")
        .take()
}

#[cfg(test)]
#[path = "sandbox/fake.test.rs"]
pub(crate) mod fake;

#[cfg(test)]
#[path = "sandbox.test.rs"]
mod tests;

#[cfg(test)]
#[path = "sandbox.errors.test.rs"]
mod error_tests;
