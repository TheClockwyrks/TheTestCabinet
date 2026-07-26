//! What one program is allowed to consume: a wasmtime **fuel** ceiling on guest CPU and a
//! **linear-memory** cap, plus the [limiter](MemoryLimiter) that enforces the second one and
//! remembers that it did.
//!
//! Both are per-[`Store`](wasmtime::Store) — never per engine — which is precisely what lets the
//! whole process share one compiled component while each ceiling stays private. A store is built
//! per **program**, so both are per-program budgets, re-armed every turn: a run of fifty turns is
//! allowed fifty times the fuel, and nothing accumulates across them.

use serde_json::Value;
use test_cabinet_core::gg::{CAPABILITY_RESPONSES_AS_CODE, GgCapabilitySet};
use wasmtime::ResourceLimiter;

/// The sandbox limits one program runs under.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SandboxLimits {
    /// The fuel ceiling for **one program**: instantiation, the shim's setup, the program itself,
    /// and every value marshalled across the membrane. Set once before instantiation and never
    /// refilled *within* a program, so one that would loop forever is stopped by it — and re-armed
    /// for the next turn, because it bounds a `Store` and every turn gets a fresh one.
    pub fuel: u64,
    /// The linear-memory cap in bytes. A `memory.grow` that would exceed it is denied — which
    /// fails the run rather than letting a runaway allocation inside the guest disturb the host.
    pub max_memory_bytes: usize,
}

impl Default for SandboxLimits {
    /// Sized from measurement against the real interpreter component, not by analogy with the
    /// interpreter this sandbox replaces.
    ///
    /// The guest is a full JavaScript engine and fuel is the ONLY guard on runaway guest CPU (the
    /// tree-walking interpreter this replaces had a softer step budget doing that job). The
    /// measured cost model is in the [module docs](super); the two numbers that set this ceiling
    /// are:
    ///
    /// * the heaviest *honest* program measured — reading, rewriting and writing back twenty
    ///   64 KiB files — costs **24.3 G** fuel and 1.8 s of CPU, because lowering a string out of
    ///   the guest costs ≈14,600 fuel per byte against ≈46 to lift one in; and
    /// * a runaway (`while (true) {}`) burns ≈20 G fuel per second, so the ceiling is also a
    ///   wall-clock bound on a program that calls nothing.
    ///
    /// 2×10¹¹ gives the heaviest honest program ≈8× headroom (≈160 files of that size in one
    /// program) while stopping a runaway in ≈10 s of container CPU. gg's previous default of
    /// 2×10⁹ was sized for a different guest and is ≈0.1 s here — tight enough that an honest
    /// program which writes anything at all would trap. Raising it is a correction, not a
    /// preference, and
    /// `a_write_heavy_program_uses_under_a_fifth_of_the_default_fuel` locks the headroom in.
    ///
    /// Fuel meters only the GUEST: a program that spends ten minutes waiting on `shell` builds
    /// costs single-digit millions of fuel. What bounds *that* is the run's wall-clock deadline,
    /// which the [membrane](super::membrane) consults before every bridged call.
    ///
    /// 256 MiB of linear memory is ≈25× the 10.3 MiB the guest engine occupies at rest, which
    /// leaves ample room for the strings a real program builds while still denying a runaway
    /// allocation long before it can disturb the host. It is also what the previous default
    /// happened to be, so no configured run changes behaviour.
    fn default() -> Self {
        Self {
            fuel: 200_000_000_000,
            max_memory_bytes: 268_435_456,
        }
    }
}

/// Resolve the [sandbox limits](SandboxLimits) from the
/// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) capability's params — `fuel` and
/// `maxMemoryBytes` — each falling back to the [default](SandboxLimits::default) when the
/// capability is absent, the param is absent, or the value is non-numeric or non-positive.
///
/// The param NAMES are contract-visible (they are what the console's capability catalogue offers
/// and what persisted run data records), so they do not change with the sandbox underneath them.
///
/// There is deliberately **no clamping** of `maxMemoryBytes`: a study may starve the sandbox on
/// purpose to measure what that does. What protects the operator from a mystifying failure is the
/// error message, which names the configured cap and says the guest engine needs about 10 MiB of
/// heap before a program runs at all.
pub fn resolve_sandbox_limits(set: &GgCapabilitySet) -> SandboxLimits {
    let mut limits = SandboxLimits::default();
    let Some(capability) = set.capability(CAPABILITY_RESPONSES_AS_CODE) else {
        return limits;
    };

    if let Some(fuel) = positive(capability.params.get("fuel")) {
        limits.fuel = fuel;
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
/// Zero is treated as "not configured" rather than as "no fuel at all": a run configured with a
/// ceiling of zero could not execute even the guest's own setup, so every turn would fail
/// identically — which is never what a study meant to ask for.
///
/// A **float is honoured**, truncated towards zero. `{"fuel": 5e10}` is a perfectly ordinary way
/// for a JSON- or JavaScript-authored sweep config to write fifty billion, and JSON has no integer
/// type to distinguish it from `50000000000` — so reading only the integer form would silently run
/// the default arm under the configured arm's name, which is precisely the failure this module's
/// docs open by warning about. Anything not finite, and anything under one, still falls back.
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
