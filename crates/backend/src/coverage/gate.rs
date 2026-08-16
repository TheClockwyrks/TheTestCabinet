//! The rung gate: whether a ladder climber advances past a rung, is walled at it,
//! or is not decided yet.
//!
//! There is exactly **one** rule, parameterised — not a set of modes:
//!
//! ```text
//! advance when count(my runs on this rung rated FLOOR or better) >= THRESHOLD
//! ```
//!
//! [`Gate::floor`] is the worst [`Rating`] that still counts as a pass, and
//! [`Gate::threshold`] is either an absolute number of runs or a fraction of the
//! rung's completed runs. Between them they express the shapes a reviewer actually
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
//! Only the **requesting account's own** judgement. A run's stored rating is the
//! worst domain across *every* reviewer, so gating on it would let a stranger's
//! harsh review wall someone else's ladder. Callers must pass the worst domain
//! within the requester's single review as [`RungRun::rating`], and `None` when
//! that account has not reviewed the run at all.
//!
//! Two things are decided without a review:
//!
//! - A run whose build never loaded ([`RungRun::loaded`] is false) counts as
//!   [`Rating::Broken`] outright when [`Gate::unloaded_counts_as_broken`] is on
//!   (the default). There is nothing to play, so waiting for a human to say so
//!   only stalls the climb and holds a review-buffer slot.
//! - A failed or canceled **job** is never a wall at all and must not appear in
//!   `runs`. Infrastructure failures are retried (`job.attempt`); only completed
//!   runs feed the gate.
//!
//! ## Deciding early, or not
//!
//! [`Gate::early_stop`] is off by default: a rung completes **all** of its runs
//! even when the outcome is already certain, because the runs are evidence as much
//! as they are a gate — five runs of a case on a model are worth having in full.
//! Turned on, the gate decides the moment the outcome is determined and the caller
//! cancels the rung's still-queued runs.

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
/// advance.
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
    /// "always advance", but above it degrades to `1.0`, the strictest bar the rule
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
    /// Whether a run whose build never loaded counts as [`Rating::Broken`] without
    /// waiting for a review. On by default: there is nothing for a reviewer to
    /// judge, so counting it immediately keeps it from blocking the climb *and*
    /// from occupying a review-buffer slot.
    #[serde(default = "unloaded_counts_as_broken_default")]
    pub unloaded_counts_as_broken: bool,
    /// Whether the gate may decide on partial results and let the caller cancel the
    /// rung's still-queued runs. **Off** by default — the runs are evidence in
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
    /// The gentlest gate that still stops a hopeless climb: advance as long as a
    /// single run was playable at all, wall only when the whole rung is broken.
    fn default() -> Self {
        Self {
            floor: Rating::Scuffed,
            threshold: GateThreshold::Count { runs: 1 },
            unloaded_counts_as_broken: unloaded_counts_as_broken_default(),
            early_stop: false,
        }
    }
}

/// One completed run on a rung, as the gate sees it.
///
/// Only completed runs belong here — a failed or canceled job is retried, never
/// walled on.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RungRun {
    /// The **requesting account's** rating for this run: the worst domain within
    /// that one account's review. `None` when they have not reviewed it — which is
    /// not the same as a bad rating, and is why [`GateOutcome::Undecided`] exists.
    pub rating: Option<Rating>,
    /// Whether the produced build loaded (the run record's `validation.loaded`).
    /// A run that did not is judged without a reviewer when the gate says so.
    pub loaded: bool,
}

impl RungRun {
    /// The rating the gate actually counts for this run: [`Rating::Broken`] when
    /// the build never loaded and the gate treats that as broken, otherwise the
    /// requester's own rating (or `None` when they have not reviewed it).
    ///
    /// The unloaded verdict overrides a recorded review rather than being averaged
    /// with it: it is the harshest rating there is, and a review of a build that
    /// never loaded cannot be describing something that ran.
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
    Advance,
    /// The rung is failed; the climber stops here. Reversible by hand — a
    /// `promote` override advances past a wall — so this is a computed opinion,
    /// never a destroyed one.
    Wall,
    /// Not enough evidence yet: runs are still to complete, or completed runs are
    /// still waiting on the requester's review. The climber holds.
    Undecided,
}

/// The counts a gate decision is made from, exposed so a ladder dashboard can show
/// *why* a climber is walled or waiting without re-deriving the floor and
/// unloaded-run rules a second time (and getting them subtly different).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GateTally {
    /// Completed runs on the rung.
    pub completed: u32,
    /// Completed runs the gate has a rating for — reviewed by the requester, or
    /// decided as broken because the build never loaded.
    pub judged: u32,
    /// Completed runs still waiting on the requester's review.
    pub unjudged: u32,
    /// Judged runs rated at or above the gate's floor.
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
    let mut judged = 0u32;
    let mut passing = 0u32;
    for run in runs {
        if let Some(rating) = run.effective_rating(gate) {
            judged += 1;
            if rating.rank() <= gate.floor.rank() {
                passing += 1;
            }
        }
    }
    let pending = target.saturating_sub(completed);
    GateTally {
        completed,
        judged,
        unjudged: completed - judged,
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
/// - [`Advance`](GateOutcome::Advance) only when the runs already in hand clear the
///   bar — every still-unreviewed and still-running run could come back broken and
///   the answer would not change.
/// - [`Wall`](GateOutcome::Wall) only when they *cannot* clear it — every remaining
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
        return GateOutcome::Advance;
    }
    // The best case still open: every unreviewed run is judged a pass and every run
    // still to complete comes back a pass too.
    let best_case = counts
        .passing
        .saturating_add(counts.unjudged)
        .saturating_add(counts.pending);
    if f64::from(best_case) + FRACTION_EPSILON >= counts.required {
        GateOutcome::Undecided
    } else {
        GateOutcome::Wall
    }
}

#[cfg(test)]
#[path = "gate.test.rs"]
mod tests;
