//! The rung gate: whether a ladder climber passes a rung, fails it, or is not decided
//! yet.
//!
//! There is exactly **one** rule, parameterised — not a set of modes:
//!
//! ```text
//! pass when count(runs on this rung rated FLOOR or better) >= THRESHOLD
//! ```
//!
//! [`Gate::floor`] is the worst [`Rating`] that still counts as a pass, and
//! [`Gate::threshold`] is either an absolute number of runs or a fraction of the
//! rung's completed runs. Between them they express the shapes a ladder's owner actually
//! wants, without any of them being a special case in the code:
//!
//! | intent | floor | threshold |
//! | --- | --- | --- |
//! | stop when over half are broken | [`Rating::Scuffed`] | [`GateThreshold::Fraction`] `0.5` |
//! | stop when all are broken | [`Rating::Scuffed`] | [`GateThreshold::Count`] `1` |
//! | pass if any run is passable or better | [`Rating::Passable`] | [`GateThreshold::Count`] `1` |
//!
//! ## What the gate is allowed to read
//!
//! Only the **validators'** rating of each run: the functional rating the validator
//! scripts decided from the run record and the case version's checklist, with the
//! toolchain gate on top and **no** reviewer's override folded in. The scripts are
//! assumed correct, so this rating is the verdict, and a climb is the same whoever
//! looks at its runs. Callers pass it as [`RungRun::rating`] (the lifted
//! `run.validator_rating`), and `None` when the run carries none. Never the run's
//! stored `rating`, which folds in every reviewer's overrides, and never a review.
//!
//! Two more rules apply:
//!
//! - A run whose build never loaded ([`RungRun::loaded`] is false) counts as
//!   [`Rating::Broken`] outright when [`Gate::unloaded_counts_as_broken`] is on
//!   (the default). There was nothing to play.
//! - A run that ended on the model's own failure — catastrophic, timed out, harness
//!   error, limit exceeded, hung — is in `runs` as a [`Rating::Broken`] run whose
//!   build never loaded. The model had its attempt at the rung and produced nothing
//!   that works, and no rating can ever arrive for it; leaving it out would have the
//!   rung relaunched for as long as the model keeps failing it.
//! - An **infrastructure** failure or a canceled run never fails a rung and must
//!   not appear in `runs`. Neither says anything about the model: infrastructure
//!   failures are retried (`job.attempt`), and a cancel was somebody's decision.
//!
//! ## Deciding early, or not
//!
//! [`Gate::early_stop`] is off by default: a rung completes **all** of its runs
//! even when the outcome is already certain, because the runs are evidence as much
//! as they are a gate — five runs of a case on a model are worth having in full.
//! Turned on, the gate decides the moment the outcome is determined and the caller
//! cancels the cell's runs that have not started yet (`queued` and `pending`).

use serde::{Deserialize, Serialize};

use test_cabinet_core::review::Rating;

/// Slack allowed when comparing a run count against a
/// [fractional](GateThreshold::Fraction) requirement.
///
/// `fraction * completed` is computed in binary floating point, where a product
/// that is a whole number in decimal need not be one in binary: `(3.0 / 17.0) * 85`
/// lands a hair *above* fifteen, which without this would demand a sixteenth run
/// that can never exist. The round fractions and small rungs a reviewer actually
/// types are exact, so this only ever absorbs representation error — it is many
/// orders of magnitude smaller than the smallest gap that can carry meaning (one
/// run in a rung), and so can never absorb a real shortfall.
const FRACTION_EPSILON: f64 = 1e-9;

/// How many of a rung's runs must clear the [floor](Gate::floor) for the climber to
/// pass the rung.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GateThreshold {
    /// An absolute number of runs, independent of how many the rung ran. `1` is
    /// "any run clearing the floor is enough", which is how "stop only when
    /// everything is broken" is expressed.
    Count {
        /// The number of runs that must clear the floor.
        runs: u32,
    },
    /// A share of the rung's completed runs, compared as
    /// `count >= fraction * completed`. Values outside `0.0..=1.0` are clamped into
    /// it, and a non-finite value (which cannot come from valid JSON but can from a
    /// corrupt row) reads as `0.0`.
    ///
    /// Clamping is not the same as neutralising: below the range it degrades to
    /// "always pass", but above it degrades to `1.0`, the strictest bar the rule
    /// can express — every completed run must clear the floor. That is deliberate.
    /// A fraction over one is a typo, not an instruction, and the nearest expressible
    /// reading of "more than all of them" is "all of them"; inventing a permissive
    /// answer instead would let a mistyped gate wave every climber through.
    Fraction {
        /// The share of completed runs that must clear the floor.
        fraction: f64,
    },
}

impl GateThreshold {
    /// The number of runs this threshold demands when the rung ends with `total`
    /// completed runs. Fractional by design: `0.5` of five runs is `2.5`, which
    /// three runs clear and two do not — exactly "over half".
    fn required(self, total: u32) -> f64 {
        match self {
            GateThreshold::Count { runs } => f64::from(runs),
            GateThreshold::Fraction { fraction } => {
                let fraction = if fraction.is_finite() {
                    fraction.clamp(0.0, 1.0)
                } else {
                    0.0
                };
                fraction * f64::from(total)
            }
        }
    }
}

/// The rule one ladder applies at every rung.
///
/// Stored per ladder (not per rung): a ladder is a single question asked of an
/// ordered series of cases, so the bar it sets is the ladder's, and a rung only
/// varies how many runs it takes to answer.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct Gate {
    /// The worst rating that still counts as clearing the rung. A run rated this
    /// or better passes; anything worse does not.
    pub floor: Rating,
    /// How many runs must clear [`Self::floor`].
    pub threshold: GateThreshold,
    /// Whether a run whose build never loaded counts as [`Rating::Broken`] outright,
    /// whatever its validator rating says. On by default: there was nothing to play.
    #[serde(default = "unloaded_counts_as_broken_default")]
    pub unloaded_counts_as_broken: bool,
    /// Whether the gate may decide on partial results, the caller then cancelling the
    /// cell's jobs that have not started yet. **Off** by default — the runs are evidence in
    /// their own right, so a rung finishes what it started even when the verdict is
    /// already certain.
    #[serde(default)]
    pub early_stop: bool,
}

/// The default for [`Gate::unloaded_counts_as_broken`], as a function so serde can
/// name it when the field is absent from a stored gate.
fn unloaded_counts_as_broken_default() -> bool {
    true
}

impl Default for Gate {
    /// The gentlest gate that still stops a hopeless climb: pass as long as a single
    /// run was playable at all, fail only when the whole rung is broken.
    fn default() -> Self {
        Self {
            floor: Rating::Scuffed,
            threshold: GateThreshold::Count { runs: 1 },
            unloaded_counts_as_broken: unloaded_counts_as_broken_default(),
            early_stop: false,
        }
    }
}

/// One run on a rung, as the gate sees it.
///
/// Completed runs belong here, and so do the model's own failures, passed as a
/// [`Rating::Broken`] run that never loaded. An infrastructure failure or a canceled
/// run does not — the first is retried and the second was a person's decision, so
/// neither ever fails a rung.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RungRun {
    /// The run's **validator rating**: the functional rating its validators decided,
    /// with no review override folded in. `None` when the run carries none (it was
    /// pushed while the backend did not hold its case version) — which is not the
    /// same as a bad rating, and counts as a possible pass.
    pub rating: Option<Rating>,
    /// Whether the produced build loaded (the run record's `validation.loaded`).
    /// A run that did not counts as broken when the gate says so.
    pub loaded: bool,
}

impl RungRun {
    /// The rating the gate actually counts for this run: [`Rating::Broken`] when
    /// the build never loaded and the gate treats that as broken, otherwise the
    /// validators' rating (or `None` when the run carries none).
    ///
    /// The unloaded verdict overrides the validators' figure rather than being
    /// averaged with it: it is the harshest rating there is, and a verdict on a build
    /// that never loaded cannot be describing something that ran.
    fn effective_rating(&self, gate: &Gate) -> Option<Rating> {
        if !self.loaded && gate.unloaded_counts_as_broken {
            return Some(Rating::Broken);
        }
        self.rating
    }
}

/// What a rung's evidence says about one climber.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GateOutcome {
    /// The rung is passed; the climber moves to the next one.
    Passed,
    /// The rung is failed; the climber stops here. The validators are assumed correct,
    /// so this is the climber's result for that version of the case.
    Failed,
    /// Not enough evidence yet: runs are still to complete, or completed runs carry
    /// no validator rating. The climber stays on the rung.
    Undecided,
}

/// The counts a gate decision is made from, exposed so a ladder dashboard can show
/// *why* a climber failed or is still running without re-deriving the floor and
/// unloaded-run rules a second time (and getting them subtly different).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GateTally {
    /// Completed runs on the rung.
    pub completed: u32,
    /// Completed runs the gate has a rating for — carrying a validator rating, or
    /// decided as broken because the build never loaded.
    pub rated: u32,
    /// Completed runs with no validator rating.
    pub unrated: u32,
    /// Rated runs rated at or above the gate's floor.
    pub passing: u32,
    /// Runs the rung has yet to complete against its target. Zero once the rung has
    /// run everything it was going to.
    pub pending: u32,
    /// How many passing runs the threshold demands, measured against the run count
    /// the rung will finish with. Fractional; see [`Self::required_runs`].
    pub required: f64,
}

impl GateTally {
    /// [`Self::required`] as the whole number of runs it actually takes — `2.5`
    /// means three. For display; the decision itself compares the fractional value.
    pub fn required_runs(&self) -> u32 {
        let rounded = (self.required - FRACTION_EPSILON).ceil();
        if rounded <= 0.0 { 0 } else { rounded as u32 }
    }
}

/// Tally a rung's completed `runs` against its `target` and the `gate`'s floor.
///
/// `target` is how many runs the rung is meant to end with (the ladder's per-cell
/// target, or the rung's override); anything above the completed count is still
/// coming. The threshold is measured against `max(completed, target)` — the run
/// count the rung will finish with — so a fractional bar does not drift as runs
/// land one by one.
pub fn tally(runs: &[RungRun], target: u32, gate: &Gate) -> GateTally {
    let completed = runs.len() as u32;
    let mut rated = 0u32;
    let mut passing = 0u32;
    for run in runs {
        if let Some(rating) = run.effective_rating(gate) {
            rated += 1;
            if rating.rank() <= gate.floor.rank() {
                passing += 1;
            }
        }
    }
    let pending = target.saturating_sub(completed);
    GateTally {
        completed,
        rated,
        unrated: completed - rated,
        passing,
        pending,
        required: gate.threshold.required(completed.saturating_add(pending)),
    }
}

/// Evaluate the gate for one climber on one rung.
///
/// `runs` is every **completed** run the climber has on the rung, `target` how many
/// the rung is meant to end with, and `gate` the ladder's rule.
///
/// The decision is deliberately conservative in both directions, so an outcome
/// never has to be taken back as more evidence lands:
///
/// - [`Passed`](GateOutcome::Passed) only when the runs already in hand clear the
///   bar — every still-unrated and still-running run could come back broken and
///   the answer would not change.
/// - [`Failed`](GateOutcome::Failed) only when they *cannot* clear it — every remaining
///   run could come back flawless and it would still fall short.
/// - [`Undecided`](GateOutcome::Undecided) in between, which is also the answer
///   whenever [`Gate::early_stop`] is off and the rung has runs left to complete,
///   however certain the outcome already is.
pub fn evaluate(runs: &[RungRun], target: u32, gate: &Gate) -> GateOutcome {
    let counts = tally(runs, target, gate);
    // Default behaviour: a rung finishes its runs before it is judged at all. The
    // outcome may be obvious already; the runs are still worth having.
    if !gate.early_stop && counts.pending > 0 {
        return GateOutcome::Undecided;
    }
    if f64::from(counts.passing) + FRACTION_EPSILON >= counts.required {
        return GateOutcome::Passed;
    }
    // The best case still open: every unrated run turns out a pass and every run
    // still to complete comes back a pass too.
    let best_case = counts
        .passing
        .saturating_add(counts.unrated)
        .saturating_add(counts.pending);
    if f64::from(best_case) + FRACTION_EPSILON >= counts.required {
        GateOutcome::Undecided
    } else {
        GateOutcome::Failed
    }
}

#[cfg(test)]
#[path = "gate.test.rs"]
mod tests;
