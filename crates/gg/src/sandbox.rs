//! **Responses as code** — the wasmtime sandbox that runs an agent's code-shaped response as a
//! *program over the tools*.
//!
//! Under the [responses-as-code](https://docs.testcabinet.ai/gg/responses-as-code/) capability a
//! model writes **TypeScript**, and every gg tool is a distinct, typed function in that program's
//! scope. This module is the host: it type-strips the program with [`transpile`], evaluates it
//! inside a committed [interpreter component](engine) under an execution-timeout and linear-memory
//! ceiling, and bridges each typed call across the [membrane] to gg's real toolset.
//!
//! ## Why a componentized JavaScript guest (and not an interpreter we wrote)
//!
//! A model cannot emit wasm, so something must interpret its program. Writing that interpreter — a
//! language, a parser, a tree-walker — makes gg's surface a dialect nothing was trained on and
//! forces every tool through one untyped door. Componentizing a real JavaScript engine instead
//! means the model writes the language it already knows, and the trust boundary becomes a **WIT
//! interface** in which each tool is its own typed function with its own typed result and its own
//! typed failure. Nothing the interface does not declare is reachable: the component is built with
//! every WASI capability disabled, so inside the guest there is no filesystem, no clock, no
//! randomness, no network and no module system — only the membrane.
//!
//! ## Stripped, not checked
//!
//! The program is TypeScript, but nothing type-*checks* it: [`transpile`] erases the types and
//! hands the JavaScript to the guest. The signatures the system prompt shows are therefore a
//! contract the SDK enforces at run time (an options object that arrived as a bare number, a
//! negative `offset`) rather than one a compiler enforced beforehand.
//!
//! ## The latency property
//!
//! The interpreter component embeds a JavaScript engine, is ~13.4 MB, and takes ~660 ms to compile
//! on a many-core machine (~4.8 s on one core). That compile happens **once per process**: the
//! [`Engine`](wasmtime::Engine) and the compiled [`Component`](wasmtime::component::Component) both
//! live behind a `OnceLock`, and every program pays only instantiate (24–124 µs) and invoke
//! (0.7–3 ms). [`precompile`] moves even that one compile off the first turn's critical path.
//! Nothing on the hot path shells out — the TypeScript type-strip is `oxc`, in-process, at ~0.2 ms.
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
//! program has ended.
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
mod limits;
mod membrane;
mod outcome;
mod signatures;
mod transpile;

pub use invoker::{ToolApi, WorkflowStageInput};
pub use limits::SandboxLimits;
pub use outcome::{
    ProgramCompletion, ProgramError, ProgramErrorKind, ProgramResult, SandboxError, SandboxOutcome,
};

// The rest of the sandbox's surface, re-exported so `sandbox` is the single name the loop and the
// prompt import from.
pub use {
    invoker::FunctionSummary, invoker::PROGRAM_CALL_ID_PREFIX, invoker::SandboxViewOpened,
    invoker::ViewOpenOutcome, invoker::ViewRefusal, limits::resolve_sandbox_limits,
    signatures::CatalogueFunction, signatures::catalogue_functions, signatures::type_declaration,
    transpile::UnreachableTail,
};

use crate::ending::EndingRole;
use crate::tools::ToolRegistry;
use membrane::{MembraneParts, MembraneState, Sandbox};

/// Run one program end to end: type-strip it, instantiate the interpreter component, evaluate it
/// against exactly `enabled`'s tools, and report everything that happened.
///
/// `program` is the **TypeScript** the model emitted. `enabled` is the run's scope-bound gg tool
/// names ([`scope_tools`]) and `role` the agent's [ending role](EndingRole) — together, exactly what
/// the program's scope is built from. `deadline` is the run's wall-clock budget, consulted before
/// every bridged call so a program cannot outlive the run it belongs to. Synchronous and CPU-bound, so
/// the [loop](crate::agent) runs it on `spawn_blocking`; it performs no I/O of its own — every
/// effect goes through `invoker`.
pub fn run_program<A: ToolApi>(
    program: &str,
    enabled: &[String],
    role: EndingRole,
    limits: SandboxLimits,
    deadline: Option<Instant>,
    api: A,
) -> (SandboxOutcome, A) {
    // A test may have armed one of the failures gg's own machinery would have to be broken to
    // produce; see `force_next_program_fault`. The `api` is handed straight back — this fault is a
    // stand-in for a before-start failure, which never runs the program and never touches state.
    #[cfg(test)]
    if let Some(error) = forced_fault() {
        return (SandboxOutcome::before_start(error), api);
    }

    // A program that does not compile never touches the engine: no store, no instantiate, no timer.
    let transpiled = match transpile::transpile_ts(program) {
        Ok(transpiled) => transpiled,
        Err(error) => {
            return (
                SandboxOutcome::before_start(SandboxError::Transpile(error)),
                api,
            );
        }
    };
    let unreachable = transpiled.unreachable;
    let (component, compile_wait) = match engine::component() {
        Ok(component) => component,
        Err(error) => return (SandboxOutcome::before_start(error), api),
    };

    let linker = match linker() {
        Ok(linker) => linker,
        Err(error) => return (SandboxOutcome::before_start(error), api),
    };
    let mut store = bounded_store(
        MembraneState::new(api, enabled, role, limits, deadline),
        limits,
    );

    let bound = match Sandbox::instantiate(&mut store, component, &linker) {
        Ok(bound) => bound,
        Err(error) => {
            // An instantiation failure is either the memory cap denying the guest its heap or the
            // committed artifact importing something this membrane does not provide — i.e. the
            // component and the WIT have drifted apart.
            let error = engine::classify(&store, limits, &error, SandboxError::Instantiate);
            return reclaim(store, Err(error), unreachable, compile_wait);
        }
    };

    let returned = bound
        .call_run(&mut store, &transpiled.js, enabled, role.into())
        .map_err(|error| engine::classify(&store, limits, &error, SandboxError::Trap));
    // A program the sandbox stopped did not run to its end, so an ending it declared on the way is
    // revoked here for the same reason a throw revokes one in the guest's `catch`: `finish` is a
    // flag, and a flag set by a program that was then killed rests on checks that never completed.
    // The guest cannot do this half — a trap gives it no code to run — so the host does both.
    if returned.is_err() {
        store.data_mut().revoke_completion();
    }
    reclaim(store, returned, unreachable, compile_wait)
}

/// A linker carrying the whole membrane and nothing else: every one of the thirty-two typed gg tool
/// functions, the three model-facing carve-outs that are not tools (the
/// [`finish`](FINISH_FUNCTION) that ends the run, the documentation lookups, and the view calls a
/// program puts material into its own window with), and the shim's feedback channel.
///
/// Building it per run rather than once per process is deliberate and free: a `Linker` is cheap,
/// and the expensive artifact (the compiled [`Component`](wasmtime::component::Component)) is the
/// one that is cached. Sharing a linker would buy microseconds and cost the guarantee that a run's
/// imports are assembled from nothing but its own state.
fn linker<A: ToolApi>() -> Result<Linker<MembraneState<A>>, SandboxError> {
    let mut linker = Linker::new(engine::shared_engine());
    Sandbox::add_to_linker::<_, HasSelf<_>>(&mut linker, |state| state)
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

/// Compile the interpreter component into the process-wide cache without running anything, so the
/// first code turn does not pay the cold compile on its critical path.
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
pub fn precompile() -> Result<Option<Duration>, SandboxError> {
    engine::component().map(|(_, compiled_in)| compiled_in)
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

/// The gg tool names the **committed component itself** says it can bind.
///
/// This asks the artifact rather than a source file, which is the one drift no compiler and no
/// source-level test can catch: a tool added, renamed or removed in gg with a stale `.wasm` still
/// checked in. It exists only for that test — a run never needs to ask, because the run's own
/// enabled set is what it passes in.
#[cfg(test)]
pub(crate) fn component_bound_tools() -> Result<Vec<String>, SandboxError> {
    let (component, _) = engine::component()?;
    let linker = linker()?;
    let limits = SandboxLimits::default();
    let log = fake::CallLog::default();
    // No tools are bound: the guest reports what it *can* bind, which does not depend on what this
    // particular store enables.
    let state = MembraneState::new(
        fake::FakeToolApi::new(&log),
        &[],
        EndingRole::Standard,
        limits,
        None,
    );
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
            refusals,
            refusals_suppressed,
            logs,
            logs_suppressed,
            views_opened,
            views_closed,
            view_refusals,
            views_suppressed,
            deferred_note,
            returned_value,
            completion,
            revoked_completion,
            program_error,
        },
    ) = store.into_data().api_and_parts();

    let outcome = SandboxOutcome {
        tool_calls: calls,
        tool_calls_suppressed: calls_suppressed,
        refusals,
        refusals_suppressed,
        logs,
        logs_suppressed,
        views_opened,
        views_closed,
        view_refusals,
        views_suppressed,
        deferred_note,
        returned_value,
        // Carried out of the group that survives every exit path, because the flag lives in the
        // agent's context rather than in the program: a trap destroys the guest, not the fact that
        // this agent declared itself done — and whether that declaration survives the trap is
        // settled before this, by `revoke_completion`.
        completion,
        revoked_completion,
        elapsed,
        unreachable,
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
