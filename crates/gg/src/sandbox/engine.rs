//! The process-wide wasm engine and one compiled copy of each registered
//! [language](mod@super::language)'s interpreter component — the statics that make a code turn cost
//! microseconds instead of a second.

use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use test_cabinet_core::gg::GgProgramLanguage;
use wasmtime::component::Component;
use wasmtime::{Config, Engine, OptLevel, Store, WasmBacktraceDetails};
use wasmtime_wasi::I32Exit;

use super::SandboxError;
use super::invoker::OperationApi;
use super::language::ProgramLanguage;
use super::limits::SandboxLimits;
use super::membrane::MembraneState;
use super::outcome::with_guest_stderr;

/// The process-wide wasm engine.
static ENGINE: OnceLock<Engine> = OnceLock::new();

/// The compiled component for each registered language, compiled at most once per process each.
///
/// A fixed-size array indexed by the language enum's discriminant, not a bytes- or id-keyed cache
/// behind a `Mutex`: the set of languages is closed and known at compile time, so this keeps the
/// race-idempotent [`OnceLock`] semantics below — and with them the "no lock held across a
/// multi-second compile" property — while the hashing and the eviction policy stay absent.
///
/// A run compiles exactly one of these, because an agent writes in one language all session. The
/// array exists so that a run whose *subagents* are configured differently pays one compile per
/// language it actually drives, rather than recompiling on every alternation.
///
/// One slot per language rather than one per distinct set of component bytes, which costs a run
/// driving **both** ECMAScript arms at once a second compile of an identical artifact. That is the
/// price of keeping this an index into a fixed array — which is what makes it impossible to get out
/// of step with the enum — and it is paid once, overlapped with a model request by
/// [`precompile`](super::precompile), by a configuration nobody has a reason to write: the pair
/// exists to be run as two arms of a study, not as two agents of one run.
static COMPONENTS: [OnceLock<Component>; GgProgramLanguage::COUNT] =
    [const { OnceLock::new() }; GgProgramLanguage::COUNT];

/// The cache slot one language's compiled component lives in.
///
/// Indexed by [`GgProgramLanguage::ordinal`], which is the language's own position in
/// [`GgProgramLanguage::ALL`] and is checked against that list at compile time. That is what makes
/// this array impossible to get out of step with the enum: a variant that is not in `ALL` does not
/// compile, so there is no index here that can be out of bounds.
fn slot(id: GgProgramLanguage) -> &'static OnceLock<Component> {
    &COMPONENTS[id.ordinal()]
}

/// How many times this process asked for component bytes to be made a [`Component`]. Read only by
/// tests, which is how the "never recompiled per program" property is asserted **without timing
/// anything**.
///
/// Under test a request may be served from the on-disk cache (`engine.cache.rs`) rather than
/// compiled, and it counts the same: what the assertions are about is how often gg *asks* — once
/// per language per process, never per program — which is the property production depends on,
/// whatever answered.
static COMPILES: AtomicU64 = AtomicU64::new(0);

/// The process-wide wasm engine.
///
/// # Why one `Engine` for the whole process
///
/// A [`Component`] is bound to the [`Engine`] that compiled it, so sharing one engine is the *only*
/// thing that makes a compiled component reusable — for free, in memory — by every later program.
/// A fresh engine per run would mean recompiling a 13.4 MB component on every single turn: ~660 ms
/// against a ~30 µs instantiate. Per-run resource limits live on the [`Store`], never on the
/// engine, precisely so one shared engine stays sound for programs with different ceilings.
///
/// [`OptLevel::None`] is deliberate: programs are short-lived, so optimising the generated code
/// buys little while its compile latency is paid on a turn's critical path.
///
/// # Why there is no on-disk compilation cache
///
/// wasmtime can persist compiled artifacts to disk, and this is exactly the workload that would
/// seem to want it. It is not enabled, and the `cache` feature is deliberately left off gg's
/// wasmtime dependency: gg runs **one process per run, inside an ephemeral container**, so a disk
/// cache would be written once and thrown away with the container. The process-wide
/// [`COMPONENTS`] already delivers the only property that matters — the second program of a run
/// pays nothing — and the feature would pull `zstd`'s C compile into a musl-static release binary
/// to buy nothing.
///
/// The test suite is the opposite workload — one process per test, thousands of them compiling the
/// same bytes — so under `#[cfg(test)]` [`compile_bytes`] goes through a cache of its own
/// (`engine.cache.rs`), keyed on the bytes' content and this engine's configuration and written
/// with nothing but [`Component::serialize`] and [`Component::deserialize_file`].
///
/// # The compile cost is core-count sensitive
///
/// Measured on the embedded artifact at `OptLevel::None`: **658 ms** on 18 cores, 1.29 s on 4,
/// 2.36 s on 2, and **4.84 s** on 1. A run container given one or two cores therefore does not
/// *hide* the compile behind [`precompile`](super::precompile) so much as overlap it with the
/// first model request — worth knowing before concluding that a cold turn is slow for some other
/// reason.
fn engine() -> &'static Engine {
    ENGINE.get_or_init(|| {
        let mut config = Config::new();
        config.wasm_component_model(true);
        // Epoch interruption — not fuel — is the runaway guard: a program's execution is bounded by
        // a wall-clock timeout rather than an instruction count. The [`ticker`] below advances the
        // engine's epoch on a fixed cadence, each [`Store`] arms a deadline against it, and the
        // guest traps when its own execution time (parked-in-host time excluded) outruns the
        // ceiling. The deadline is only ever delivered where the guest is running wasm, so it does
        // not reach one parked in a synchronous WASI call. See [`limits`](super::limits) for why a
        // timeout replaced fuel, and for what that exclusion costs a language that can block.
        config.epoch_interruption(true);
        config.cranelift_opt_level(OptLevel::None);
        // Under test, one compile thread per process. Production compiles in parallel because it is
        // one process per run with the machine to itself and the compile is latency it pays. A test
        // run is the opposite shape: nextest runs a process per test and fills every core with them,
        // so a compile fanned out across every core competes with the other tests for the same cores,
        // and the fan-out's own overhead — a thread pool whose idle workers spin while they look for
        // work — is paid on top. Measured on one Swift test compiling five programs, parallel
        // compilation cost several times the CPU of compiling them one thread at a time, for the same
        // artifacts. The thread count changes no compiled code.
        #[cfg(test)]
        config.parallel_compilation(false);
        // Symbolicate a trap's frames out of the artifact's own DWARF rather than reporting them as
        // addresses. It is off by default in wasmtime, and gg turns it on because on a compiled arm
        // with no exception mechanism a trap is how an ORDINARY program failure arrives — and for
        // the [Swift](super::language::swift) arm it is the whole error surface, not a nicety: that
        // compiler encodes `Swift runtime failure: Index out of range` as the name of a synthetic
        // inlined frame rather than printing it anywhere, so without this a model is told
        // `program.wasm!main` and nothing else. Inlined frames are what make that legible, and they
        // are the same feature.
        //
        // It costs nothing for a guest carrying no debug information — the embedded interpreter
        // components carry none — and the work is done only where a trap is actually being
        // rendered, never on the path a program takes when it succeeds.
        config.wasm_backtrace_details(WasmBacktraceDetails::Enable);
        // The wasm **exception-handling** proposal, which is what makes `throw`, `try` and `catch`
        // work in a [C++](super::language::cpp) program. It is off by default in wasmtime and gg
        // turns it on for one arm, because the alternative for that arm is `-fno-exceptions` —
        // under which every `try` a model writes is a compile error, and the arm measures gg's flag
        // rather than the language.
        //
        // It costs the other guests nothing: enabling a proposal widens what a module MAY contain,
        // and every artifact here is produced by a toolchain gg pins. What it did cost is a build
        // feature — wasmtime gates this setter behind `gc`, because an exception reference is a
        // GC-managed value — and that feature is shared with `foray-host` and `lattice-host`, which
        // turn `gc_support` back off on their own engines rather than inheriting a wider validation
        // surface from a decision made here. See the root `Cargo.toml`.
        config.wasm_exceptions(true);
        // **How much host stack a guest may spend before wasmtime traps it**, raised from wasmtime's
        // 512 KiB default to 1 MiB for one arm's sake and measured rather than chosen.
        //
        // A JavaScript recursion on the ECMAScript guest (`packages/gg-sandbox/guest`) spends TWO
        // stacks at once: quickjs's own, which lives in the guest's linear memory and is what the
        // engine measures a recursion against, and the wasm call stack under it, which is this. If
        // this one runs out first the store dies with `wasm trap: call stack exhausted` and the model
        // reads nothing at all; if the engine's does, the model reads `RangeError: Maximum call stack
        // size exceeded` with its own frames, which is the whole point. Measured on that guest, the
        // recursion depth reached before the engine reports the overflow itself:
        //
        //     JavaScript ceiling  |  512 KiB here  |  1 MiB here  |  2 MiB here
        //     128 KiB             |  452           |  452         |  452
        //     256 KiB             |  907           |  907         |  907
        //     512 KiB             |  host trap     |  1817        |  1817
        //     1 MiB               |  host trap     |  host trap   |  3637
        //
        // The guest's ceiling is 512 KiB, so this is the 1 MiB row. NOT 2 MiB, although wasmtime
        // accepts it: this engine runs wasm on whatever thread called it, and a Rust test thread's
        // default stack is 2 MiB — a ceiling equal to the whole thread stack would turn a guest
        // overflow into a native one, which is not a trap but a crash.
        //
        // It widens what every other arm may spend before being trapped, by half a megabyte, and
        // costs them nothing else: the limit is a ceiling, not an allocation.
        config.max_wasm_stack(1024 * 1024);
        // A fixed, known-valid configuration: nothing here depends on the host, the run, or any
        // input, so a failure would be a programming error rather than a runtime condition.
        let engine = Engine::new(&config).expect("the fixed wasmtime Config is valid");
        spawn_ticker(engine.clone());
        engine
    })
}

/// How often the [ticker](spawn_ticker) advances the engine's epoch. Each tick is the resolution of
/// every execution timeout: a 30 s ceiling is 300 ticks, and a program is stopped within one tick of
/// its deadline. A tenth of a second is far finer than a timeout sized in tens of seconds needs, and
/// coarse enough that the ticker's own cost — one atomic increment — is utterly negligible.
pub(crate) const EPOCH_TICK: Duration = Duration::from_millis(100);

/// **How far ahead of gg's own ceiling a guest that can stop itself is told its budget ends** — the
/// head start that decides which of the two answers a runaway loop, and therefore whether the model
/// reads `InternalError: interrupted` with its own frames or an epoch trap that names nothing.
///
/// It has to cover everything that happens between the moment gg's clock starts and the moment the
/// guest has finished writing its report: the guest engine's own start-up inside the call, the
/// interrupt handler's check interval, rendering the error, and the flush to standard error. All of
/// that measures a few milliseconds on an idle machine — and it is wall clock, so on a machine that
/// is loaded, thermally throttled, or paging it stretches by whatever factor the scheduler applies.
///
/// **It used to be one [`EPOCH_TICK`], and one tick was not enough.** A full workspace run on a
/// throttled laptop stretched a ~5 ms path past 100 ms and gg's ceiling answered first: the ECMAScript
/// arm's `a_runaway_loop_is_stopped_by_the_engine_rather_than_by_an_epoch_trap` came back with an
/// empty standard error and `Timeout { limit: 400ms }`, which is exactly the opaque stop the guest's
/// self-interrupt exists to replace. Half a second is a hundred times the idle cost of that path,
/// and it is charged against a budget sized in tens of seconds: the default 30 s ceiling becomes
/// 29.5 s of program, which no honest program is anywhere near — the heaviest one measured spends
/// about 1.8 s. The other half of that fix is [`MembraneState::start_program`](super::membrane::MembraneState::start_program),
/// which keeps gg's own instantiation from being charged against this head start before the program
/// has run a statement.
///
/// A flat duration rather than a fraction of the timeout, because what it covers is a fixed amount
/// of work rather than a share of the program's budget: a run configured with a two-second ceiling
/// needs the same milliseconds a thirty-second one does. [`guest_deadline`](super::membrane::guest_deadline)
/// keeps its own floor for the case where that flat duration is most of the budget.
pub(crate) const GUEST_HEAD_START: Duration = Duration::from_millis(500);

/// The number of [epoch ticks](EPOCH_TICK) that span `budget`, for
/// [`Store::set_epoch_deadline`](wasmtime::Store::set_epoch_deadline) and the deadline callback's
/// re-arming. Rounded up, and never zero, so a deadline is always strictly in the future; saturated
/// at [`u64::MAX`] so a near-eternal configured timeout does not wrap into a short one.
pub(crate) fn epoch_deadline_ticks(budget: Duration) -> u64 {
    let ticks = budget
        .as_millis()
        .div_ceil(EPOCH_TICK.as_millis())
        .try_into()
        .unwrap_or(u64::MAX);
    ticks.max(1)
}

/// Advance `engine`'s epoch once per [`EPOCH_TICK`], forever, on a detached daemon thread.
///
/// The thread is spawned exactly once, when the process-wide [`engine`] is first built, and it is
/// never joined: a process that exits abandons it, which is correct, because gg is one process per
/// run and the ticker is meaningful only while a program is running. [`Engine`] is a cheap `Arc`
/// handle, so the clone the thread holds costs nothing and keeps the engine alive for as long as the
/// process — which it would be anyway, behind its [`OnceLock`].
///
/// Its only job is to make time observable to the guest: epoch interruption checks the counter at
/// the guest's loop back-edges and function entries, so a program that never yields (a `while (true)
/// {}`) is stopped, which a wall-clock deadline the host merely *holds* could never do.
fn spawn_ticker(engine: Engine) {
    std::thread::Builder::new()
        .name("gg-sandbox-epoch".into())
        .spawn(move || {
            loop {
                std::thread::sleep(EPOCH_TICK);
                engine.increment_epoch();
            }
        })
        .expect("spawning the sandbox epoch ticker");
}

/// The engine every [`Store`] in this process is created against.
pub(crate) fn shared_engine() -> &'static Engine {
    engine()
}

/// `language`'s compiled interpreter component, compiling it on first use — and how long the caller
/// spent getting it.
///
/// Race-idempotent rather than locked: two threads arriving together may both compile, the first
/// [`OnceLock::set`] wins and the loser's [`Component`] is dropped. That costs one wasted compile
/// in a window that a real run — which compiles from
/// [`precompile`](super::precompile) before the first turn — never enters, and it avoids holding a
/// lock across a multi-second compile.
///
/// The duration is `None` when the component was already compiled, which is every call of a healthy
/// run after the first, and `Some` when *this* caller had to compile it. It exists because
/// [`precompile`](super::precompile) **overlaps** the compile with the first model request rather
/// than eliminating it: a model that answers in under a second, on a container with one or two
/// cores, gets its first program back before the warm-up has finished, and that program then pays
/// the whole compile inside its own span. Without this figure the only way to tell that apart from
/// a slow program is forensic timestamp analysis — which is exactly what it cost the last time the
/// question was asked.
pub(crate) fn component(
    language: &'static dyn ProgramLanguage,
) -> Result<(&'static Component, Option<Duration>), SandboxError> {
    let Some(bytes) = language.guest_component() else {
        return Err(SandboxError::Compile(format!(
            "{} compiles a component per program and has no prebuilt one to share",
            language.id()
        )));
    };
    let slot = slot(language.id());
    if let Some(component) = slot.get() {
        return Ok((component, None));
    }
    let started = Instant::now();
    let compiled = compile_bytes(bytes)?;
    let _ = slot.set(compiled);
    Ok((
        slot.get()
            .expect("the component was just set, and a `OnceLock` never unsets"),
        Some(started.elapsed()),
    ))
}

/// **The component one program is evaluated by**, and how long this caller spent getting it.
///
/// The one place the two shapes of arm meet. A language whose prepare step
/// [compiled a component for this program](super::PreparedProgram::component) has its bytes
/// compiled here, now, for this turn and no other; every other language gets the process-wide
/// [prebuilt](component) one, compiled at most once.
///
/// The duration means the same thing in both cases — *what this caller waited for a component* —
/// and it is `Some` on every turn of a compiled arm rather than only the first. That is not a
/// defect to be optimised away later: a wasm module that is a different program every turn has
/// nothing a cache could hold, and the honest thing is to report the cost on every turn so a
/// cross-language comparison reads it rather than losing it in the response residual.
pub(crate) fn program_component(
    language: &'static dyn ProgramLanguage,
    prepared: Option<Vec<u8>>,
) -> Result<(ProgramComponent, Option<Duration>), SandboxError> {
    let Some(bytes) = prepared else {
        let (component, waited) = component(language)?;
        return Ok((ProgramComponent::Shared(component), waited));
    };
    let started = Instant::now();
    let compiled = compile_bytes(&bytes)?;
    Ok((
        ProgramComponent::PerProgram(compiled),
        Some(started.elapsed()),
    ))
}

/// The compiled component one program is evaluated by, and where it came from.
///
/// Two variants rather than one `Cow`-shaped borrow because the lifetimes genuinely differ: a
/// embedded component lives in a process-wide [`OnceLock`] and is `&'static`, while a program's own
/// is owned by the turn that compiled it and is dropped with it. Nothing downstream cares which —
/// [`get`](Self::get) is the whole interface — but the store that instantiates it must be able to
/// hold either.
pub(crate) enum ProgramComponent {
    /// The language's embedded component, compiled once per process and shared by every program it
    /// evaluates.
    Shared(&'static Component),
    /// A component compiled for this program alone, and dropped when the turn ends.
    PerProgram(Component),
}

impl ProgramComponent {
    /// The component, whichever it is.
    pub(crate) fn get(&self) -> &Component {
        match self {
            Self::Shared(component) => component,
            Self::PerProgram(component) => component,
        }
    }
}

/// How many times this process compiled a component. The assertion behind
/// [HR2](super#the-latency-property): a counter, so the property is checked rather than inferred
/// from a stopwatch on a shared machine.
///
/// `#[cfg(test)]` for the same reason [`component_bytes`] is: a run never asks how many compiles
/// happened, it just uses the cached one, so an ungated accessor with one test caller would be dead
/// code in a released build.
#[cfg(test)]
pub(crate) fn compiles() -> u64 {
    COMPILES.load(Ordering::Relaxed)
}

/// Compile component bytes against the shared engine, counting the compile — under test, through
/// the on-disk cache (`engine.cache.rs`), which may map in a copy another test process already
/// compiled.
///
/// Called with a language's own [`guest_component`](ProgramLanguage::guest_component) in production;
/// the tests additionally call it with bytes that are not a component at all, which is the only way
/// to see the failure path of an artifact that — by construction, because the test suite compiles it
/// — is always valid in a real build.
pub(crate) fn compile_bytes(bytes: &[u8]) -> Result<Component, SandboxError> {
    COMPILES.fetch_add(1, Ordering::Relaxed);
    obtain(bytes)
}

/// Production compiles every time it is asked. An embedded guest is asked for once per language per
/// process, through [`COMPONENTS`]; a compiled arm's program once per turn, through
/// [`program_component`].
#[cfg(not(test))]
fn obtain(bytes: &[u8]) -> Result<Component, SandboxError> {
    compile(bytes)
}

/// The test suite goes through its on-disk cache (`engine.cache.rs`), which maps in a copy another
/// test process already compiled from the same bytes.
#[cfg(test)]
fn obtain(bytes: &[u8]) -> Result<Component, SandboxError> {
    cache::load_or_compile(engine(), bytes, cache::directory(), compile)
        .map(|(component, _)| component)
}

/// Cranelift-compile component bytes against the shared engine.
fn compile(bytes: &[u8]) -> Result<Component, SandboxError> {
    // Through [`failure_reason`] like every other wasmtime error path here: a component that will
    // not compile fails with the validator's own sentence buried in the chain, and `to_string()`
    // hands back the outer link alone.
    Component::new(engine(), bytes).map_err(|err| SandboxError::Compile(failure_reason(&err)))
}

/// One language's embedded component bytes, for the test that guards its size band.
///
/// `#[cfg(test)]` because production never wants the bytes, only the compiled
/// [`Component`](component) — an ungated accessor with one test caller is dead code in a released
/// build.
#[cfg(test)]
pub(crate) fn component_bytes(language: &'static dyn ProgramLanguage) -> &'static [u8] {
    language
        .guest_component()
        .expect("a language whose size band is under test commits a component")
}

/// Map a wasmtime error onto the right [`SandboxError`].
///
/// Timeout first — the epoch-deadline callback records it on the [membrane state](MembraneState)'s
/// [`timed_out`](MembraneState::timed_out) flag before it traps the guest, because the trap it
/// raises carries no distinguishing code — then the memory cap, which is read from the
/// [limiter](super::limits::MemoryLimiter)'s denial flag rather than from a memory's size, because
/// a component has no single named memory to measure. That flag catches both shapes a denial takes:
/// an instantiation failure when the cap sits below the guest engine's ~10 MiB floor, and a trap
/// when a running program outgrows it.
///
/// The flag means *the last growth this run asked for was refused*, not *a growth was refused at
/// some point*: a refusal does not trap, so a guest can be denied, collect garbage, retry smaller
/// and carry on. Reading a stale denial would blame the memory cap for whatever the program
/// eventually did wrong instead.
///
/// Both ceilings are read before the error itself, because both are things **gg** did to a program
/// that was still running and neither leaves a distinguishable trap behind. Only then is the error
/// asked whether it is an explicit [`exit`](wasmtime_wasi::I32Exit) — which a program chose, and
/// which arrives as a trap carrying a backtrace and no mention of the word "exit" or the status. It
/// is named by [`exit_message`] and reported as a [`Trap`](SandboxError::Trap) whichever phase it
/// came from, because a guest that exited is a program that stopped itself and never the artifact
/// drift `fallback` names on the instantiate path.
///
/// [What the guest said](MembraneState::stderr_kept) rides on **every** one of those paths. It used
/// to ride on the last one alone, so the two early returns above threw it away: a Swift program
/// stopped at the memory cap had already written `Fatal error: failed to allocate 33554440 bytes of
/// memory with alignment 4`, and gg had already located it at `main.swift:3:32`, and the model was
/// shown neither.
///
/// `fallback` is what an unclassified failure becomes, and it differs by phase — an error from
/// [`instantiate`](wasmtime::component::Linker) means the embedded artifact and the membrane have
/// drifted apart, while one from the call is an ordinary trap — so the caller names it.
pub(crate) fn classify<A: OperationApi>(
    store: &Store<MembraneState<A>>,
    limits: SandboxLimits,
    err: &wasmtime::Error,
    fallback: fn(String) -> SandboxError,
) -> SandboxError {
    let said = store.data().stderr_kept();
    if store.data().timed_out() || spent_its_budget(store, limits) {
        return SandboxError::Timeout {
            limit: limits.timeout,
            said,
        };
    }
    if store.data().memory_denied() {
        return SandboxError::OutOfMemory {
            limit: limits.max_memory_bytes,
            said,
        };
    }
    if let Some(exit) = err.downcast_ref::<I32Exit>() {
        return SandboxError::Trap(with_guest_stderr(exit_message(exit.0), &said));
    }
    let reason = failure_reason(err);
    let reason = match store.data().language().wasm_frames_are_located() {
        true => reason,
        false => without_frame_locations(&reason),
    };
    fallback(with_guest_stderr(without_nameless_frames(&reason), &said))
}

/// **Whether the guest stopped itself because it reached the budget gg gave it.**
///
/// gg states its execution ceiling to a guest that can stop itself
/// ([`GUEST_DEADLINE`](super::membrane::GUEST_DEADLINE)), one epoch tick short of its own, so that a
/// runaway program is answered by the engine — in the engine's words, at the model's own line —
/// rather than by an epoch trap that names nothing. What that costs is the flag: gg's own deadline
/// callback never fires, because the store is already dead when it would have.
///
/// So the ceiling is recognised here instead, on the same terms the memory cap is: a guest that
/// spent at least the budget gg handed it and then stopped, stopped for the reason gg set. The time
/// is [`guest_elapsed`](MembraneState::guest_elapsed) — the guest's own execution, with the time
/// parked in bridged calls subtracted — which is the same clock the budget was written from.
///
/// **Only for an arm whose guest actually reads that budget**
/// ([`stops_itself_at_ggs_deadline`](ProgramLanguage::stops_itself_at_ggs_deadline)). On any other
/// arm gg's own deadline is the only ceiling and its flag always fires, so this would be pure
/// heuristic: a panic, a trap or an allocation failure in the last tick of a program's budget would
/// be reported to the model as a timeout rather than as what it was.
fn spent_its_budget<A: OperationApi>(
    store: &Store<MembraneState<A>>,
    limits: SandboxLimits,
) -> bool {
    store.data().language().stops_itself_at_ggs_deadline()
        && store.data().guest_elapsed() >= super::membrane::guest_deadline(limits)
}

/// The same failure with every **nameless** wasm frame struck, and the backtrace header with them
/// when nothing survives under it.
///
/// wasmtime writes a frame as `0: 0x1a2b - <module>!<function>`, taking both names from the module's
/// name section. An artifact built without one renders every frame as
/// `<unknown>!<wasm function 1785>`, which names neither a place nor a thing: on the arms whose
/// guest is an *engine* rather than the program, those indices are quickjs's own internals, and six
/// lines of them follow the engine's own located rendering on every runtime failure.
///
/// Struck rather than counted, on the same terms [`without_frame_locations`] drops a misattributed
/// location: a frame with no name and no location is not a shorter account of the failure, it is no
/// account of it, and a count of how many there were is the same nothing one line longer. That is
/// the [invariants page](https://docs.testcabinet.ai/gg/responses-as-code/invariants/)'s
/// distinction between a strike and a trim, and it is why a
/// [trim](super::membrane::GuestStderr) beside it does count.
///
/// A frame the name section does name is kept, which is every frame on the arms whose program is
/// the wasm module.
fn without_nameless_frames(reason: &str) -> String {
    /// What wasmtime renders for a frame it has no name for.
    const NAMELESS: &str = "<unknown>!<wasm function ";
    /// The line wasmtime opens a backtrace with.
    const HEADER: &str = "error while executing at wasm backtrace:";

    let mut kept: Vec<&str> = Vec::new();
    for line in reason.lines() {
        if line.contains(NAMELESS) {
            continue;
        }
        // The header, once every frame beneath it has gone. `lines()` has already consumed the
        // blank line that separated it from the reason, so that goes too.
        if line.trim() == HEADER
            && !reason
                .lines()
                .skip_while(|earlier| earlier.trim() != HEADER)
                .skip(1)
                .any(|frame| !frame.trim().is_empty() && !frame.contains(NAMELESS))
        {
            while kept.last().is_some_and(|last| last.trim().is_empty()) {
                kept.pop();
            }
            continue;
        }
        kept.push(line);
    }
    while kept.last().is_some_and(|last| last.trim().is_empty()) {
        kept.pop();
    }
    kept.join("\n")
}

/// The same failure with every frame's **file and line struck out**, for an arm whose DWARF is
/// misattributed — see [`ProgramLanguage::wasm_frames_are_located`].
///
/// wasmtime renders a located frame over two lines: the address and the function name, then an
/// indented `at <file>:<line>:<column>`. The function names come from the module's name section and
/// are right; only the second line is the lie, so only the second line goes. A strike rather than a
/// trim, and it closes without a count for the reason [`without_nameless_frames`] gives. What is left is the
/// reason, the frames a model can recognise, and no claim about where in its own source they are —
/// which for the JVM arms is what the guest's own standard error already says, correctly.
fn without_frame_locations(reason: &str) -> String {
    let kept: Vec<&str> = reason
        .lines()
        .filter(|line| {
            let trimmed = line.trim_start();
            // An `at …:<line>:<column>` line, and nothing else: the guest's own stderr is not in
            // this string at all (it rides beside it), and a reason of gg's own never has this
            // shape.
            !(line.starts_with(' ')
                && trimmed.starts_with("at ")
                && trimmed
                    .rsplit(':')
                    .take(2)
                    .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit())))
        })
        .collect();
    kept.join("\n")
}

/// What a program that called its language's `exit` is told, in place of the backtrace that carried
/// neither the word "exit" nor the status.
///
/// Two facts, because they are the two a model can act on: that it stopped itself, and that
/// returning is how a program ends. `exit(0)` is not spared — it is a program that stopped before
/// its own last statement — and it is the one status this sentence names, because it is the one gg
/// is told.
///
/// # Why a non-zero status is not a number here
///
/// **Because gg is never handed one.** Every arm that can reach an exit at all reaches it through
/// the pinned `wasi_snapshot_preview1` adapter, whose `proc_exit` is
///
/// ```text
/// let status = if rval == 0 { Ok(()) } else { Err(()) };
/// crate::bindings::wasi::cli::exit::exit(status); // does not return
/// ```
///
/// — `crates/wasi-preview1-component-adapter/src/lib.rs` at the pinned release and on `main` alike.
/// The import it calls, `wasi:cli/exit.exit`, carries a `result` and not a status, and the host end
/// of it (`wasmtime_wasi`'s `p2::host::exit`) turns that back into `I32Exit(0)` or `I32Exit(1)`. So
/// a program's `exit(3)` and its `exit(7)` arrive here as the same integer, and that integer is not
/// one either program chose.
///
/// The interface does carry an `exit-with-code(u8)` that would survive, and the host implements it;
/// no adapter calls it, so nothing gg runs can produce one. Reaching it would mean gg building its
/// own adapter out of a patched upstream source — replacing the one input a component's ABI is
/// pinned by with a binary of gg's own making — and that is a worse trade than a sentence that says
/// what is true.
///
/// So the number is not printed. A model reading `exit(1)` after writing `exit(3)` would be reading
/// gg's report of a program other than its own, which is the thing
/// [the invariants](https://docs.testcabinet.ai/gg/responses-as-code/invariants/) forbid; a model
/// told the status did not survive knows both that it stopped itself and that the value it picked
/// is not a channel back to gg. Gate G8 holds the five arms that can reach this to what they read.
///
/// It is composed here rather than being a [`SandboxError`] variant of its own for the reason
/// [`Trap`](SandboxError::Trap) states: a recordable variant is one-to-one with a **published** turn
/// error type, and minting `sandbox_exit` is a contract change rather than a classification fix.
fn exit_message(status: i32) -> String {
    match status {
        0 => "the program called exit(0) instead of returning; nothing after the call ran"
            .to_string(),
        _ => "the program called exit with a non-zero status instead of returning; nothing \
              after the call ran, and the status number does not cross the sandbox boundary"
            .to_string(),
    }
}

/// **Why** a wasmtime error happened, in front of the frames it happened in.
///
/// A [`wasmtime::Error`] is an `anyhow`-shaped chain, and wasmtime attaches the wasm backtrace as
/// the **outermost** context with the reason as its source. `Display` renders the outermost link
/// alone, so reporting `err.to_string()` — which is what this replaced — showed a model `error while
/// executing at wasm backtrace:` and a wall of frames, while `wasm trap: integer divide by zero`,
/// `wasm trap: call stack exhausted` and `out of bounds memory access` sat in the chain and reached
/// nobody. Measured that way on the C++, Swift and Rust arms.
///
/// `{err:#}` prints the whole chain, and in that same order: the frames lead and the reason lands
/// last, behind them. A model reads the first line, so this walks the chain and leads with the
/// **innermost** cause — the reason — putting the outer links after it, blank-line separated.
///
/// The backtrace is kept rather than dropped because on a compiled arm it is the only line and
/// column a program failure has: [`WasmBacktraceDetails::Enable`] symbolicates it out of the guest's
/// own DWARF for exactly that, and on the Swift arm the runtime's message is encoded in an inlined
/// frame's name and lives nowhere else.
fn failure_reason(err: &wasmtime::Error) -> String {
    // Outermost first, and never empty — the error is always its own first link.
    let mut chain: Vec<String> = err.chain().map(ToString::to_string).collect();
    let reason = chain.pop().unwrap_or_else(|| err.to_string());
    match chain.is_empty() {
        true => reason,
        false => format!("{reason}\n\n{}", chain.join("\n\n")),
    }
}

#[cfg(test)]
#[path = "engine.cache.rs"]
mod cache;

#[cfg(test)]
#[path = "engine.test.rs"]
mod tests;
