//! What one program is allowed to consume: a wall-clock **execution timeout** on guest CPU and a
//! **linear-memory** cap, plus the [limiter](MemoryLimiter) that enforces the second one and
//! remembers that it did.
//!
//! Both are per-[`Store`](wasmtime::Store) — never per engine — which is precisely what lets the
//! whole process share one compiled component while each ceiling stays private. A store is built
//! per **program**, so both are per-program budgets, re-armed every turn: a run of fifty turns
//! allows every program its own full timeout, and nothing accumulates across them.
//!
//! Both are **size** ceilings. There is deliberately no count ceiling here or anywhere else — not
//! on views of any kind, not on the pictures resident in a window, not on the view operations one
//! program may make. What makes a window too full is tokens, which every view reports and the
//! fullness signal totals, and a count is a proxy for that which is wrong in both directions: fifty
//! one-line views are nothing and four large ones are most of a small model's window. A count cap
//! also has to *refuse*, which leaves the model unable to show itself the thing it just decided to
//! look at, in exchange for a bound the accounting was already reporting honestly.
//!
//! # Why a timeout, and not a fuel count
//!
//! The sandbox used to meter the guest with wasmtime **fuel** — a deterministic instruction
//! budget. Fuel is exact, but its cost model is invisible to the model writing the program: lowering
//! a string *out* of the guest cost ≈300× lifting one in, so a program that merely wrote a few large
//! files could exhaust a fuel ceiling that a runaway loop would take seconds to reach, and the
//! ceiling had to be sized by measuring the interpreter. That made a limit meant only to stop
//! **infinite loops** into something an honest program could trip.
//!
//! The timeout removes that failure mode by construction. It is **non-deterministic** — it measures
//! elapsed guest-CPU time rather than counting instructions — and it is set far longer than any
//! honest program's execution (milliseconds, occasionally a second or two) needs, so a program that
//! reaches it is almost always one that does not terminate. It bounds only the guest's *own*
//! execution: time a program spends parked in a bridged tool call (a long `shell` build) is
//! excluded, exactly as fuel excluded it, so a program waiting minutes on a build is never mistaken
//! for a runaway. That exclusion is enforced by [`MembraneState`](super::membrane)'s epoch-deadline
//! callback, which extends the deadline by whatever time was spent in host calls.
//!
//! # What the timeout cannot stop, and who has to care
//!
//! The timeout is enforced by **epoch interruption**, which by construction can only fire where the
//! guest is executing wasm: at a loop back-edge or a function entry. A guest parked inside a
//! *synchronous WASI host call* is executing none, so the deadline cannot reach it. `wasi:io/poll`
//! on a monotonic-clock pollable — which is what `time.sleep`, `Thread.sleep` and every idiomatic
//! "wait a second" compiles to — is exactly that shape, and so is a blocking socket read or a
//! blocking read of a large file. The membrane's own deadline guard is not a backstop either: it
//! refuses at the *next* bridged call, and a sleeping program makes none.
//!
//! This was unreachable before the linker went ambient, because the only way for a program to block
//! at all was a bridged tool call, which the epoch callback accounts for explicitly. It is
//! unreachable from the ECMAScript guest too: the timers are shadowed and the JS engine exposes no
//! filesystem or socket API. It is **reachable today** from the [Python](super::language) arm, where
//! `time.sleep(60)` is an ordinary thing for a model to write.
//!
//! What that costs was measured, and the measurement says the overrun is bounded by the longest
//! single park rather than by the budget. `time.sleep(8)` against a 2 s budget ran the **whole 8 s**
//! in five of five runs (8.02 s elapsed); `time.sleep(4)` against a 1 s budget ran the whole 4 s in
//! eight of eight. A program parking in short hops is a different story and the same rule: 200
//! `time.sleep(0.05)`s — ten seconds of sleeping — against a 1 s budget stopped at 1.00–1.09 s,
//! because the deadline lands at the first hop that returns to wasm. So a program is always stopped
//! and the elapsed figure is always honest, but the deadline bounds the guest's *execution* and not
//! the wall clock: it can only fire between parks, never inside one. Both halves are pinned by
//! `the_interpreters_own_landmines_are_defused`.
//!
//! (An earlier note here quoted a 2.5–9.4 s spread for that first case. Those figures were the first
//! program run in a test process, whose budget the ~1 s component compile had already spent — they
//! measured the compile, not the sleep.)
//!
//! # The decision, settled with the first arm that can reach it
//!
//! **gg does not extend the timeout to a parked WASI call. The bound on a parked turn is the
//! run-level idle watchdog**, `test_cabinet_core::exec_stream::HARNESS_IDLE_TIMEOUT` (30 minutes),
//! and this ceiling stays what it says it is: a bound on the guest's own *execution*.
//!
//! The reason that is an acceptance rather than a gap is that the underlying behaviour — a program
//! may wait a long time — is neither new nor unusual. `system.shell("sleep 3600")` parks for an hour
//! on every arm gg has ever had, and the epoch callback deliberately excludes that time so a real
//! build is never mistaken for a runaway. What a sleeping guest adds is a *second door* to the same
//! behaviour, and what genuinely differs is that gg does not record it: a `shell` wait is a bridged
//! call in the run's telemetry, and a `time.sleep` is nothing at all.
//!
//! What is not at risk is the thing this ceiling exists for. A runaway that **computes** is stopped
//! exactly as intended — a Python `while True:` traps on the deadline every time, and that case has
//! a test — and a parked program can do no further gg work either, because
//! [`MembraneState`](super::membrane)'s deadline guard refuses every bridged call once the budget is
//! spent. Nothing stalls: [`run_program`](super::run_program) runs on a blocking thread, so sibling
//! agents are unaffected.
//!
//! Both candidate closures were weighed and neither is worth its cost yet:
//!
//! * **Async WASI with `call_async`**, so a park becomes a yield the host can cancel. It is the
//!   right answer eventually and it is a change to how *every* guest is driven — the sandbox becomes
//!   async end to end, the blocking-thread property above changes shape, and every existing arm has
//!   to be re-validated against it. That is not a change to make on the way past while registering a
//!   language.
//! * **Abandoning the thread from a wall-clock watchdog.** Cheaper, and wrong: the store would
//!   outlive the turn gg reported, and while the membrane would refuse it every gg tool, it would
//!   still hold the ambient filesystem. A leaked program writing files after gg has moved on is a
//!   worse failure than a turn that waits.
//!
//! **Reopen it** when a parked turn is observed in a real run, or when an arm can block in a way a
//! model reaches by accident rather than by writing a sleep. The full statement, with the
//! measurements, is in `apps/docs/src/content/docs/gg/program-languages.md`.

use std::time::Duration;

use serde_json::Value;
use test_cabinet_core::gg::{CAPABILITY_RESPONSES_AS_CODE, GgAgentConfig};
use wasmtime::ResourceLimiter;

/// The sandbox limits one program runs under.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SandboxLimits {
    /// The wall-clock ceiling on **one program's** guest-CPU execution: the guest's setup, the
    /// program itself, and every value marshalled across the membrane, but **not** time parked in a
    /// bridged tool call. Armed once before the program runs and re-armed for the next turn, because
    /// it bounds a `Store` and every turn gets a fresh one, so a program that would loop forever is
    /// stopped by it while one that merely does a lot of honest work never approaches it.
    pub timeout: Duration,
    /// The linear-memory cap in bytes. A `memory.grow` that would exceed it is denied — which
    /// fails the run rather than letting a runaway allocation inside the guest disturb the host.
    pub max_memory_bytes: usize,
}

/// The [default](SandboxLimits::default) execution timeout: **30 seconds** of guest CPU.
///
/// This is a pure infinite-loop guard, not a work ration. The heaviest *honest* program measured —
/// reading, rewriting and writing back twenty 64 KiB files — spends about 1.8 s of guest CPU, so
/// 30 s leaves it more than an order of magnitude of headroom while still stopping a `while (true)
/// {}` in about half a minute. It is deliberately far longer than any single response needs, so it
/// is never reached outside a program that does not terminate.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

impl Default for SandboxLimits {
    /// The [default timeout](DEFAULT_TIMEOUT) and a 256 MiB linear-memory cap.
    ///
    /// 256 MiB of linear memory is ≈25× the 10.3 MiB the guest engine occupies at rest, which
    /// leaves ample room for the strings a real program builds while still denying a runaway
    /// allocation long before it can disturb the host.
    fn default() -> Self {
        Self {
            timeout: DEFAULT_TIMEOUT,
            max_memory_bytes: 268_435_456,
        }
    }
}

/// Resolve the [sandbox limits](SandboxLimits) from **one agent's**
/// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) capability params — `timeoutSecs` and
/// `maxMemoryBytes` — each falling back to the [default](SandboxLimits::default) when the
/// capability is absent, the param is absent, or the value is non-numeric or non-positive.
///
/// It takes an [agent profile](GgAgentConfig) and not the run's whole set on purpose:
/// responses-as-code is a per-agent capability, so a reviewer agent may run under ceilings its
/// spawner does not. Every caller resolves the profile of the agent whose turn is about to run
/// (`Orchestrator::code_setup`), which is what makes these per-agent rather than per-run.
///
/// The param NAMES are contract-visible (they are what the console's capability catalogue offers
/// and what persisted run data records), so they do not change with the sandbox underneath them.
///
/// There is deliberately **no clamping** of any param: a study may starve the sandbox on purpose
/// to measure what that does. What protects the operator from a mystifying failure is the error
/// message, which names the configured limit.
pub fn resolve_sandbox_limits(set: &GgAgentConfig) -> SandboxLimits {
    let mut limits = SandboxLimits::default();
    let Some(capability) = set.capability(CAPABILITY_RESPONSES_AS_CODE) else {
        return limits;
    };

    if let Some(secs) = positive_secs(capability.params.get("timeoutSecs")) {
        limits.timeout = secs;
    }
    if let Some(bytes) = positive(capability.params.get("maxMemoryBytes")) {
        // A cap wider than this platform's address space is not a cap; saturating keeps the
        // configured intent ("as much as possible") rather than wrapping it into something small.
        limits.max_memory_bytes = usize::try_from(bytes).unwrap_or(usize::MAX);
    }
    limits
}

/// A capability param as a positive count, or `None` when it is absent, null, non-numeric, or
/// smaller than one.
///
/// Zero is treated as "not configured" rather than as "no memory at all": a run configured with a
/// ceiling of zero could not execute even the guest's own setup, so every turn would fail
/// identically — which is never what a study meant to ask for.
///
/// A **float is honoured**, truncated towards zero. `{"maxMemoryBytes": 5e8}` is a perfectly
/// ordinary way for a JSON- or JavaScript-authored sweep config to write half a gigabyte, and JSON
/// has no integer type to distinguish it from `500000000` — so reading only the integer form would
/// silently run the default arm under the configured arm's name. Anything not finite, and anything
/// under one, still falls back.
fn positive(param: Option<&Value>) -> Option<u64> {
    let param = param?;
    param
        .as_u64()
        .or_else(|| {
            param
                .as_f64()
                .filter(|value| value.is_finite() && *value >= 1.0)
                // Saturating rather than wrapping: a param wider than a `u64` means "as much as
                // possible", and the `as` cast on a float saturates at the type's bounds.
                .map(|value| value as u64)
        })
        .filter(|&value| value > 0)
}

/// A capability param as a positive **duration in seconds**, or `None` when it is absent, null,
/// non-numeric, or not strictly positive.
///
/// A **fractional value is honoured** — `{"timeoutSecs": 0.5}` is half a second — because the param
/// is a wall-clock time and a study measuring a very short ceiling has every reason to ask for one.
/// A value so large it overflows a `Duration` saturates at the near-eternal [`Duration::MAX`], which
/// keeps the configured intent ("effectively no timeout") rather than wrapping it into something
/// small. Zero, a negative, and anything not finite fall back to the default.
fn positive_secs(param: Option<&Value>) -> Option<Duration> {
    let secs = param?.as_f64()?;
    if !secs.is_finite() || secs <= 0.0 {
        return None;
    }
    Some(Duration::try_from_secs_f64(secs).unwrap_or(Duration::MAX))
}

/// Caps guest linear-memory growth, and **remembers whether the last growth it saw was refused** so
/// the sandbox can name the cause of a failure. Consulted by wasmtime before each `memory.grow`.
///
/// A component has no single named `memory` export, so — unlike gg's core-module wasm hosts — the
/// sandbox cannot look at a memory's size after a trap to decide whether the cap was the cause.
/// Measured, a denial surfaces two different ways: as an **instantiation** failure when the cap is
/// below the guest engine's ~10 MiB floor (the engine allocates its heap while it initialises), and
/// as a **trap** when a running program outgrows it. One flag classifies both, and costs a bool.
///
/// # Why the flag is cleared again
///
/// Returning `Ok(false)` does not trap: wasmtime turns it into a `-1` from `memory.grow`, and a
/// JavaScript engine that gets one typically collects garbage and retries with a smaller request.
/// So a denial can be **survivable**, and a run that was denied once, recovered, and later failed
/// for an unrelated reason would be reported as an out-of-memory naming a cap that had nothing to
/// do with it. Clearing the flag on the next *successful* growth makes it mean what the classifier
/// needs it to mean: the last thing this limiter did was refuse.
pub(crate) struct MemoryLimiter {
    /// The ceiling growth is measured against.
    max_memory_bytes: usize,
    /// Whether the most recent growth decision was a refusal — i.e. whether the cap is where the
    /// guest was left when it stopped.
    denied: bool,
}

impl MemoryLimiter {
    /// A limiter capping linear memory at `max_memory_bytes`, having denied nothing yet.
    pub(crate) fn new(max_memory_bytes: usize) -> Self {
        Self {
            max_memory_bytes,
            denied: false,
        }
    }

    /// Whether this limiter's most recent decision was to refuse a growth — the sandbox's evidence
    /// that the memory cap, and not something else, is where the run ended.
    pub(crate) fn denied(&self) -> bool {
        self.denied
    }
}

impl ResourceLimiter for MemoryLimiter {
    fn memory_growing(
        &mut self,
        _current: usize,
        desired: usize,
        _maximum: Option<usize>,
    ) -> wasmtime::Result<bool> {
        self.denied = desired > self.max_memory_bytes;
        Ok(!self.denied)
    }

    fn table_growing(
        &mut self,
        _current: usize,
        _desired: usize,
        _maximum: Option<usize>,
    ) -> wasmtime::Result<bool> {
        // Tables hold function references, not data: the component's table is fixed by its own
        // shape and a program cannot grow it, so there is nothing here for a ceiling to protect.
        Ok(true)
    }
}

#[cfg(test)]
#[path = "limits.test.rs"]
mod tests;
