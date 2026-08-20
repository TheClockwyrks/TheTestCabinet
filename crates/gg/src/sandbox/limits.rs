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
//! filesystem or socket API. It is **reachable today** from the [Python](super::language()) arm, where
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
//! measurements, is in `apps/docs/src/content/docs/gg/responses-as-code/sandbox.md`.

use std::time::Duration;

use serde_json::Value;
use test_cabinet_core::gg::{CAPABILITY_RESPONSES_AS_CODE, GgAgentConfig};
use wasmtime::ResourceLimiter;

/// The two params this module reads, re-exported from the crate that owns gg's configuration
/// vocabulary: the spelling a document is written in and the spelling gg reads it by are one
/// constant, so a key cannot be renamed on one side of the wire alone.
///
/// The names are **contract-visible** — they are what the console's capability catalogue offers and
/// what persisted run data records — so they do not change with the sandbox underneath them.
pub use test_cabinet_core::gg::{PARAM_MAX_MEMORY_BYTES, PARAM_TIMEOUT_SECS};

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

impl SandboxLimits {
    /// **No program runs under these** — what an agent whose profile does not switch
    /// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) on carries.
    ///
    /// A tool-calling agent allocates no `Store` and evaluates nothing, so there is nothing here
    /// for a ceiling to bound and no ceiling for its profile to have written. Zero on both is the
    /// statement rather than a figure: were a program somehow reached with these, it would be
    /// stopped before its first back-edge and loudly, which is the failure mode to want.
    pub const NO_PROGRAM: Self = Self {
        timeout: Duration::ZERO,
        max_memory_bytes: 0,
    };

    /// The ceilings a resolver hands back once it has [refused the launch](crate::validate).
    ///
    /// Its name rather than its value is the point: the run it belongs to does not start, so no
    /// program is ever run under it, and the next reader of the line that produced it can see that
    /// gg armed no ceiling of its own choosing.
    pub const LAUNCH_REFUSED: Self = Self::NO_PROGRAM;

    /// **Ceilings wide enough that no honest program approaches either** — 30 s of guest CPU and
    /// 256 MiB of linear memory — which is what gg's own cases run a fixture program under.
    ///
    /// The heaviest honest program measured, reading and rewriting twenty 64 KiB files, spends
    /// about 1.8 s of guest CPU; 256 MiB is ≈25× the 10.3 MiB the ECMAScript guest engine occupies
    /// at rest.
    ///
    /// `#[cfg(test)]`, because it is a fixture and not a figure gg would stand in for an absent
    /// one: a run's ceilings come from that run's own document or the launch is refused.
    #[cfg(test)]
    pub(crate) const AMPLE: Self = Self {
        timeout: Duration::from_secs(30),
        max_memory_bytes: 268_435_456,
    };
}

/// Resolve the [sandbox limits](SandboxLimits) from **one agent's**
/// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) capability params —
/// [`timeoutSecs`](PARAM_TIMEOUT_SECS) and [`maxMemoryBytes`](PARAM_MAX_MEMORY_BYTES).
///
/// **An enabled capability writes both.** Neither has an "off" a program could run under, and gg
/// arms no ceiling nobody wrote: a study that deliberately starves the sandbox to measure what that
/// does would otherwise run at ceilings of gg's choosing under the starved arm's name, and every
/// program in it would succeed for the wrong reason. An absent or `null` param, and one that is
/// present and names no ceiling gg can arm — a non-number, a zero, a negative, an infinity —
/// [refuse the launch](crate::validate) on exactly the same terms.
///
/// An **absent** capability runs no program, so it resolves to [`NO_PROGRAM`](SandboxLimits::NO_PROGRAM)
/// and nothing is required of it. A capability that is present and **disabled** requires nothing of
/// itself either, and the ceilings written on one are still read and still refused if gg could not
/// arm them, which is what keeps the on and off arms of one comparison the same document with one
/// switch moved. Having reported, this resolver hands back
/// [`LAUNCH_REFUSED`](SandboxLimits::LAUNCH_REFUSED), which is what keeps it total for the per-turn
/// calls that re-read it.
///
/// It takes an [agent profile](GgAgentConfig) and not the run's whole set on purpose:
/// responses-as-code is a per-agent capability, so a reviewer agent may run under ceilings its
/// spawner does not. Every caller resolves the profile of the agent whose turn is about to run
/// (`Orchestrator::code_setup`), which is what makes these per-agent rather than per-run.
///
/// There is deliberately **no clamping** of any param: a study may starve the sandbox on purpose
/// to measure what that does. What protects the operator from a mystifying failure is the error
/// message, which names the configured limit.
pub fn resolve_sandbox_limits(
    profile: &GgAgentConfig,
    report: &mut crate::validate::LaunchReport,
) -> SandboxLimits {
    let Some(capability) = profile.capability(CAPABILITY_RESPONSES_AS_CODE) else {
        return SandboxLimits::NO_PROGRAM;
    };
    if !capability.enabled {
        // Read for the refusals alone: a switched-off capability bounds no program, and what it
        // writes is judged now rather than on the launch that flips the switch.
        positive_secs(&capability.params, false, report);
        max_memory_bytes(&capability.params, false, report);
        return SandboxLimits::NO_PROGRAM;
    }
    // Both are read before either absence is answered, so one refusal names every ceiling the
    // profile is short of rather than the first.
    let (Some(timeout), Some(max_memory_bytes)) = (
        positive_secs(&capability.params, true, report),
        max_memory_bytes(&capability.params, true, report),
    ) else {
        return SandboxLimits::LAUNCH_REFUSED;
    };
    SandboxLimits {
        timeout,
        max_memory_bytes,
    }
}

/// The [`maxMemoryBytes`](PARAM_MAX_MEMORY_BYTES) param as a **byte count**, or `None` once the
/// launch is refused — because the capability is on and wrote none, or because what it wrote names
/// no cap.
///
/// `enabled` is whether the capability carrying these params is switched on, which is the whole of
/// what makes the param required: a disabled capability is short of nothing, and what it did write
/// is read on the ordinary terms.
fn max_memory_bytes(
    params: &Value,
    enabled: bool,
    report: &mut crate::validate::LaunchReport,
) -> Option<usize> {
    const STARVED: &str = "a guest given no memory at all could not run even its own setup, so \
                           every turn would fail identically";
    let bytes = if enabled {
        crate::validate::required_positive_count_param(
            params,
            CAPABILITY_RESPONSES_AS_CODE,
            PARAM_MAX_MEMORY_BYTES,
            STARVED,
            report,
        )?
    } else {
        crate::validate::positive_count_param(
            params,
            CAPABILITY_RESPONSES_AS_CODE,
            PARAM_MAX_MEMORY_BYTES,
            STARVED,
            report,
        )?
    };
    // A cap wider than this platform's address space is not a cap; saturating keeps the configured
    // intent ("as much as possible") rather than wrapping it into something small.
    Some(usize::try_from(bytes).unwrap_or(usize::MAX))
}

/// The sandbox half of one profile's contribution to the
/// [launch pass](crate::validate::validate_launch): the two ceilings it declares, read exactly as
/// the run will read them.
pub fn check_launch(profile: &GgAgentConfig, report: &mut crate::validate::LaunchReport) {
    resolve_sandbox_limits(profile, report);
}

/// The [`timeoutSecs`](PARAM_TIMEOUT_SECS) param as a **duration**, or `None` once the launch is
/// refused — because the capability is on and wrote none, or because what it wrote names no
/// ceiling.
///
/// `enabled` is whether the capability carrying these params is switched on, which is the whole of
/// what makes the param required: a disabled capability is short of nothing, and what it did write
/// is read on the ordinary terms.
///
/// A **fractional value is honoured** — `{"timeoutSecs": 0.5}` is half a second — because the param
/// is a wall-clock time and a study measuring a very short ceiling has every reason to ask for one.
/// This is the one numeric capability param that is not read as a count, which is why it does not go
/// through [`required_count_param`](crate::validate::required_count_param). A value so large it
/// overflows a `Duration` saturates at the near-eternal [`Duration::MAX`], keeping the configured
/// intent ("effectively no timeout") rather than wrapping it into something small.
///
/// Zero, a negative, an infinity and anything that is not a number are [reported](crate::validate)
/// and refuse the launch: none of them names a ceiling, and gg arms none of its own in their place.
fn positive_secs(
    params: &Value,
    enabled: bool,
    report: &mut crate::validate::LaunchReport,
) -> Option<Duration> {
    let value = if enabled {
        crate::validate::required_param(
            params,
            CAPABILITY_RESPONSES_AS_CODE,
            PARAM_TIMEOUT_SECS,
            report,
        )?
    } else {
        params
            .get(PARAM_TIMEOUT_SECS)
            .filter(|value| !value.is_null())?
    };
    match value.as_f64() {
        Some(secs) if secs.is_finite() && secs > 0.0 => {
            Some(Duration::try_from_secs_f64(secs).unwrap_or(Duration::MAX))
        }
        _ => {
            report.report(crate::validate::LaunchDefect::run_level(
                crate::validate::param_locus(CAPABILITY_RESPONSES_AS_CODE, PARAM_TIMEOUT_SECS),
                crate::validate::as_written(value),
                format!(
                    "the `{PARAM_TIMEOUT_SECS}` param bounds one program's guest CPU in seconds \
                     and must be a positive number; gg cannot read a ceiling from this, and it \
                     arms none of its own in place of one nobody wrote."
                ),
            ));
            None
        }
    }
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
