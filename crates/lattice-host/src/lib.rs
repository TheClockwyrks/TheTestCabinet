//! The native wasm host for the **Lattice** performance test case (on-disk slug
//! `lattice`).
//!
//! This crate loads a single submission engine wasm module, hands it the
//! `scenario` JSON, runs it **once** under a wasmtime fuel ceiling and a
//! linear-memory cap, reads back the canonical `state` JSON, and reports both the
//! parsed [`Snapshot`]s and the fuel consumed. It also
//! [scores](score_submission) a submission against the [`lattice-core`](lattice_core)
//! oracle by comparing per-snapshot checksums.
//!
//! ## Why this lives here, not in the CLI or in core
//!
//! The host is factored into its own crate so it has exactly one implementation
//! (mirroring `foray-host`):
//!
//! - The [`lattice` CLI](../../../crates/lattice-cli) is a thin clap wrapper that
//!   reads files, parses the scenario, and calls [`run_submission`] /
//!   [`score_submission`].
//! - The core `PerformanceValidator` depends on this crate to score a submission,
//!   rather than re-implementing the host.
//!
//! `lattice-core` must stay wasm-compilable, so the wasmtime dependency lives
//! **here** and never in core. This crate marshals JSON across the wasm boundary;
//! it owns **no** simulation rule.
//!
//! ## The two semantic differences from Foray
//!
//! 1. The contract entry (`simulate`) is invoked **once per scenario**, not once
//!    per tick — a submission is handed the whole scenario and runs it to
//!    completion in one call (lead decision 5). Fuel is therefore set once before
//!    that single call, and the consumed fuel *is* the performance result.
//! 2. Scoring is **correctness (checksum) + fuel**, not a head-to-head match: a
//!    submission is correct iff every scheduled snapshot's checksum matches the
//!    oracle's, and the fuel is only meaningful when it is.

mod submission;

pub use submission::{InvokeError, LoadError, Submission};

use lattice_core::{Engine, Scenario, Snapshot};
use wasmtime::Config;

/// The per-scenario sandbox limits from the manifest's `[sandbox]` table. Applied
/// to the single `simulate` invocation.
#[derive(Debug, Clone, Copy)]
pub struct SandboxLimits {
    /// The wasmtime fuel ceiling for the **whole scenario**. Set once before the
    /// single `simulate` call (not refilled — there is exactly one call), so the
    /// fuel consumed (`fuel_limit - remaining`) is the performance result.
    pub fuel_limit: u64,
    /// The linear-memory cap in bytes. A `memory.grow` that would exceed it is
    /// denied, failing the run.
    pub max_memory_bytes: usize,
}

impl Default for SandboxLimits {
    /// The performance manifest's documented defaults (5,000,000,000 fuel; 256
    /// MiB). Note the fuel ceiling is per-scenario — orders of magnitude larger
    /// than Foray's per-tick budget because it covers the entire simulation.
    fn default() -> SandboxLimits {
        SandboxLimits {
            fuel_limit: 5_000_000_000,
            max_memory_bytes: 268_435_456,
        }
    }
}

/// The outcome of running a submission on one scenario: the snapshots it produced
/// and the fuel it consumed over the single `simulate` call.
#[derive(Debug, Clone)]
pub struct SubmissionRun {
    /// The snapshots the submission returned, one per scheduled snapshot tick (the
    /// host parses them but does not yet judge them — see [`score_submission`]).
    pub snapshots: Vec<Snapshot>,
    /// The fuel consumed over the single `simulate` call. This is the performance
    /// result the validator records when the submission is correct.
    pub fuel_consumed: u64,
}

/// The result of scoring a submission against the oracle on one scenario: whether
/// it is correct, the fuel it consumed (only meaningful when correct), and the
/// first mismatch detail when it is not.
#[derive(Debug, Clone)]
pub struct Score {
    /// `true` iff the submission produced every scheduled snapshot with the
    /// oracle's exact checksum.
    pub correct: bool,
    /// The fuel consumed over the single `simulate` call. Recorded even when
    /// incorrect (for diagnostics), but only counts toward the score when correct.
    pub fuel: u64,
    /// The tick of the first snapshot whose checksum diverged from the oracle, when
    /// the submission is incorrect for that reason. `None` when correct, or when the
    /// failure was structural (wrong snapshot count) rather than a checksum miss.
    pub first_mismatch_tick: Option<u64>,
    /// A human-readable explanation of an incorrect result (the mismatching
    /// checksums, or the structural problem). `None` when correct.
    pub detail: Option<String>,
}

/// Run a submission module on `scenario` once and return its snapshots plus the
/// fuel consumed. This is the reusable entry both the CLI and the validator call.
///
/// `module_wasm` is the submission core module's bytes. `limits`/`entry` come from
/// the manifest's `[sandbox]`/`[contract]`. A module that fails to load (does not
/// compile, cannot instantiate, or is missing a contract export) is a
/// build/legality failure, surfaced as [`RunError::Load`] — the simulation never
/// starts. A module that fails *during* the run (traps, runs out of fuel/memory,
/// or returns malformed `state` JSON) is surfaced as [`RunError::Invoke`].
pub fn run_submission(
    module_wasm: &[u8],
    scenario: &Scenario,
    limits: SandboxLimits,
    entry: &str,
) -> Result<SubmissionRun, RunError> {
    let engine = build_engine()?;

    let scenario_json =
        serde_json::to_vec(scenario).map_err(|e| RunError::Encode(e.to_string()))?;

    let mut submission = Submission::load(
        &engine,
        module_wasm,
        entry,
        limits.fuel_limit,
        limits.max_memory_bytes,
    )
    .map_err(RunError::Load)?;

    let (state_bytes, fuel_consumed) = submission
        .invoke(&scenario_json)
        .map_err(RunError::Invoke)?;

    let snapshots = serde_json::from_slice::<Vec<Snapshot>>(&state_bytes)
        .map_err(|e| RunError::Invoke(InvokeError::BadJson(e.to_string())))?;

    Ok(SubmissionRun {
        snapshots,
        fuel_consumed,
    })
}

/// Score a submission against the [`lattice-core`](lattice_core) oracle on
/// `scenario`: run both, compare per-snapshot checksums, and report
/// correct/incorrect plus the fuel. This is the single scoring path the CLI's
/// `run` subcommand and the core validator share, so they can never disagree on
/// what "correct" means.
///
/// The oracle is the [`Engine`]; the submission is run via [`run_submission`].
/// Correctness requires the submission to return exactly as many snapshots as the
/// schedule expects, each with the oracle's exact checksum string. The fuel is
/// recorded regardless but only counts when correct.
///
/// A load/host failure is propagated as [`RunError`] (the submission could not be
/// run at all); a *wrong but runnable* submission returns `Ok` with
/// `correct = false`.
pub fn score_submission(
    module_wasm: &[u8],
    scenario: &Scenario,
    limits: SandboxLimits,
    entry: &str,
) -> Result<Score, RunError> {
    let expected = Engine::solve(scenario);
    let run = run_submission(module_wasm, scenario, limits, entry)?;
    Ok(score_against(&expected, &run))
}

/// Compare a submission's run against the oracle's expected snapshots, producing a
/// [`Score`]. Split out so the CLI's `run` (which has the expected snapshots from
/// `lattice solve`) and the validator (which re-solves) share the exact comparison
/// rule. Correctness is purely a per-snapshot checksum equality plus a count check.
pub fn score_against(expected: &[Snapshot], run: &SubmissionRun) -> Score {
    if run.snapshots.len() != expected.len() {
        return Score {
            correct: false,
            fuel: run.fuel_consumed,
            first_mismatch_tick: None,
            detail: Some(format!(
                "expected {} snapshots, submission returned {}",
                expected.len(),
                run.snapshots.len()
            )),
        };
    }

    for (want, got) in expected.iter().zip(&run.snapshots) {
        if want.checksum != got.checksum {
            return Score {
                correct: false,
                fuel: run.fuel_consumed,
                first_mismatch_tick: Some(want.tick),
                detail: Some(format!(
                    "snapshot tick {}: expected {} got {}",
                    want.tick, want.checksum, got.checksum
                )),
            };
        }
    }

    Score {
        correct: true,
        fuel: run.fuel_consumed,
        first_mismatch_tick: None,
        detail: None,
    }
}

/// Build a fuel-metered wasmtime engine. Fuel metering must be enabled for the
/// per-scenario budget and the consumed-fuel reading to work; if this build of
/// wasmtime cannot enable it, that is a host error, not a submission failure.
fn build_engine() -> Result<wasmtime::Engine, RunError> {
    let mut config = Config::new();
    config.consume_fuel(true);
    wasmtime::Engine::new(&config).map_err(|e| RunError::Engine(e.to_string()))
}

/// Why a submission could not be *run*, or failed mid-run. Distinct from a
/// *correct/incorrect* judgement (which a runnable submission always produces via
/// [`Score`]) — these are failures of the host or the module itself.
#[derive(Debug, thiserror::Error)]
pub enum RunError {
    /// The wasm engine could not be configured (e.g. fuel metering unavailable in
    /// this build of wasmtime).
    #[error("failed to build the wasm engine: {0}")]
    Engine(String),
    /// The scenario could not be re-encoded to JSON to hand to the guest. (It was
    /// already a valid `Scenario`, so this is effectively unreachable.)
    #[error("failed to encode the scenario JSON: {0}")]
    Encode(String),
    /// The submission module failed to load (compile/instantiate/missing export).
    #[error("submission failed to load: {0}")]
    Load(#[source] LoadError),
    /// The submission failed during its single `simulate` call (trap, fuel/memory
    /// exhaustion, bad region, or malformed `state` JSON).
    #[error("submission failed during the run: {0}")]
    Invoke(#[source] InvokeError),
}

#[cfg(test)]
#[path = "lib.test.rs"]
mod tests;
