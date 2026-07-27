//! The process-wide wasm engine and the one compiled copy of the interpreter component — the two
//! statics that make a code turn cost microseconds instead of a second.

use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use wasmtime::component::Component;
use wasmtime::{Config, Engine, OptLevel, Store, Trap};

use super::SandboxError;
use super::invoker::ToolApi;
use super::limits::SandboxLimits;
use super::membrane::MembraneState;

/// The committed interpreter component: the TypeScript guest in `packages/gg-sandbox`, built by its
/// `build.sh` with `componentize-js` and committed here, exactly as gg's other wasm guests are
/// committed alongside their sources.
///
/// It is ~13.4 MB because it embeds a JavaScript engine, and it is **embedded in the binary**
/// rather than read from disk because gg is copied as a single file into an ephemeral run
/// container and must carry everything it needs with it. Committing it zstd-compressed (~4 MB) was
/// considered and rejected: it would drag a C toolchain onto a binary that is release-built for
/// Linux, Windows and macOS and statically linked against musl, in order to shrink a developer/CI
/// artifact nobody downloads on a budget.
const SANDBOX_COMPONENT: &[u8] = include_bytes!("gg-sandbox.component.wasm");

/// The process-wide wasm engine.
static ENGINE: OnceLock<Engine> = OnceLock::new();

/// The compiled component, compiled at most once per process.
///
/// gg has exactly one guest, embedded in the binary, so this is a `OnceLock` rather than a
/// bytes-keyed cache — the same "compiled once" property with the hashing, the mutex and the
/// eviction policy removed.
static COMPONENT: OnceLock<Component> = OnceLock::new();

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
/// [`COMPONENT`] already delivers the only property that matters — the second program of a run
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
        config.consume_fuel(true);
        config.cranelift_opt_level(OptLevel::None);
        // A fixed, known-valid configuration: nothing here depends on the host, the run, or any
        // input, so a failure would be a programming error rather than a runtime condition.
        Engine::new(&config).expect("the fixed wasmtime Config is valid")
    })
}

/// The engine every [`Store`] in this process is created against.
pub(crate) fn shared_engine() -> &'static Engine {
    engine()
}

/// The compiled interpreter component, compiling it on first use — and how long the caller spent
/// getting it.
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
pub(crate) fn component() -> Result<(&'static Component, Option<Duration>), SandboxError> {
    if let Some(component) = COMPONENT.get() {
        return Ok((component, None));
    }
    let started = Instant::now();
    let compiled = compile_bytes(SANDBOX_COMPONENT)?;
    let _ = COMPONENT.set(compiled);
    Ok((
        COMPONENT
            .get()
            .expect("the component was just set, and a `OnceLock` never unsets"),
        Some(started.elapsed()),
    ))
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
/// Called with [`SANDBOX_COMPONENT`] in production; the tests additionally call it with bytes that
/// are not a component at all, which is the only way to see the failure path of an artifact that —
/// by construction, because the test suite compiles it — is always valid in a real build.
pub(crate) fn compile_bytes(bytes: &[u8]) -> Result<Component, SandboxError> {
    COMPILES.fetch_add(1, Ordering::Relaxed);
    Component::new(engine(), bytes).map_err(|err| SandboxError::Compile(err.to_string()))
}

/// The committed component's bytes, for the test that guards its size band.
///
/// `#[cfg(test)]` because production never wants the bytes, only the compiled
/// [`Component`](component) — an ungated accessor with one test caller is dead code in a released
/// build.
#[cfg(test)]
pub(crate) fn component_bytes() -> &'static [u8] {
    SANDBOX_COMPONENT
}

/// Map a wasmtime error onto the right [`SandboxError`].
///
/// Fuel first — a fuel trap downcasts to [`Trap::OutOfFuel`], and a store left pinned at zero fuel
/// is the same condition reported a different way — then the memory cap, which is read from the
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
/// `non_fuel` is what an unclassified failure becomes, and it differs by phase — an error from
/// [`instantiate`](wasmtime::component::Linker) means the committed artifact and the membrane have
/// drifted apart, while one from the call is an ordinary trap — so the caller names it.
pub(crate) fn classify<A: ToolApi>(
    store: &Store<MembraneState<A>>,
    limits: SandboxLimits,
    err: &wasmtime::Error,
    non_fuel: fn(String) -> SandboxError,
) -> SandboxError {
    if err.downcast_ref::<Trap>() == Some(&Trap::OutOfFuel)
        || store.get_fuel().is_ok_and(|remaining| remaining == 0)
    {
        return SandboxError::OutOfFuel { limit: limits.fuel };
    }
    if store.data().memory_denied() {
        return SandboxError::OutOfMemory {
            limit: limits.max_memory_bytes,
        };
    }
    non_fuel(err.to_string())
}

#[cfg(test)]
#[path = "engine.test.rs"]
mod tests;
