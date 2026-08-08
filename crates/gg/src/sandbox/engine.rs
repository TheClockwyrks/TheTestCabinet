//! The process-wide wasm engine and one compiled copy of each registered
//! [language](super::language)'s interpreter component — the statics that make a code turn cost
//! microseconds instead of a second.

use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use test_cabinet_core::gg::GgProgramLanguage;
use wasmtime::component::Component;
use wasmtime::{Config, Engine, OptLevel, Store, WasmBacktraceDetails};

use super::SandboxError;
use super::invoker::ToolApi;
use super::language::ProgramLanguage;
use super::limits::SandboxLimits;
use super::membrane::MembraneState;

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

/// How many times this process compiled the component. Read only by tests, which is how the "never
/// recompiled per program" property is asserted **without timing anything**.
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
/// # The compile cost is core-count sensitive
///
/// Measured on the committed artifact at `OptLevel::None`: **658 ms** on 18 cores, 1.29 s on 4,
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
        // Symbolicate a trap's frames out of the artifact's own DWARF rather than reporting them as
        // addresses. It is off by default in wasmtime, and gg turns it on because on a compiled arm
        // with no exception mechanism a trap is how an ORDINARY program failure arrives — and for
        // the [Swift](super::language::swift) arm it is the whole error surface, not a nicety: that
        // compiler encodes `Swift runtime failure: Index out of range` as the name of a synthetic
        // inlined frame rather than printing it anywhere, so without this a model is told
        // `program.wasm!main` and nothing else. Inlined frames are what make that legible, and they
        // are the same feature.
        //
        // It costs nothing for a guest carrying no debug information — the committed interpreter
        // components carry none — and the work is done only where a trap is actually being
        // rendered, never on the path a program takes when it succeeds.
        config.wasm_backtrace_details(WasmBacktraceDetails::Enable);
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
const EPOCH_TICK: Duration = Duration::from_millis(100);

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
            "{} compiles a component per program and has no committed one to share",
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
/// [committed](component) one, compiled at most once.
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
/// committed component lives in a process-wide [`OnceLock`] and is `&'static`, while a program's own
/// is owned by the turn that compiled it and is dropped with it. Nothing downstream cares which —
/// [`get`](Self::get) is the whole interface — but the store that instantiates it must be able to
/// hold either.
pub(crate) enum ProgramComponent {
    /// The language's committed component, compiled once per process and shared by every program it
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

/// Compile component bytes against the shared engine, counting the compile.
///
/// Called with a language's own [`guest_component`](ProgramLanguage::guest_component) in production;
/// the tests additionally call it with bytes that are not a component at all, which is the only way
/// to see the failure path of an artifact that — by construction, because the test suite compiles it
/// — is always valid in a real build.
pub(crate) fn compile_bytes(bytes: &[u8]) -> Result<Component, SandboxError> {
    COMPILES.fetch_add(1, Ordering::Relaxed);
    Component::new(engine(), bytes).map_err(|err| SandboxError::Compile(err.to_string()))
}

/// One language's committed component bytes, for the test that guards its size band.
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
/// `fallback` is what an unclassified failure becomes, and it differs by phase — an error from
/// [`instantiate`](wasmtime::component::Linker) means the committed artifact and the membrane have
/// drifted apart, while one from the call is an ordinary trap — so the caller names it.
pub(crate) fn classify<A: ToolApi>(
    store: &Store<MembraneState<A>>,
    limits: SandboxLimits,
    err: &wasmtime::Error,
    fallback: fn(String) -> SandboxError,
) -> SandboxError {
    if store.data().timed_out() {
        return SandboxError::Timeout {
            limit: limits.timeout,
        };
    }
    if store.data().memory_denied() {
        return SandboxError::OutOfMemory {
            limit: limits.max_memory_bytes,
        };
    }
    fallback(with_guest_stderr(
        err.to_string(),
        store.data().stderr_tail(),
    ))
}

/// What the guest said about itself, in front of the engine's account of what happened to it.
///
/// The order is the point. On a guest with an exception mechanism the engine's account is the whole
/// story, because a throw was caught, reported and never became a trap. On one without — the
/// [Swift](super::language::swift) arm, where an index out of range, a force-unwrapped `nil` and a
/// `fatalError` are all unrecoverable by design — the *only* description of the failure is the line
/// the runtime wrote to stderr on its way down, and burying it under a wasm backtrace would be
/// showing a model the machinery instead of the fault. See
/// [`GuestStderr`](MembraneState::stderr_tail).
fn with_guest_stderr(error: String, said: String) -> String {
    match said.is_empty() {
        true => error,
        false => format!("{said}\n\n{error}"),
    }
}

#[cfg(test)]
#[path = "engine.test.rs"]
mod tests;
