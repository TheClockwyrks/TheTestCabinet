//! Ladders: an **ordered, gated** climb through a series of test cases, and the
//! harness+model combinations that climb it.
//!
//! A [coverage plan](super::coverage) asks "run every one of these cases on every one
//! of these models until each cell has N runs". A ladder asks a different question:
//! *how far up does this model get?* Its cases are an ordered series of **rungs**, its
//! combinations are **climbers**, and a climber only reaches the next rung by clearing
//! the current one. It is a sibling of a plan, not a mode of one — it shares the
//! groups, the resolver, the matrix counts, the review buffer, the top-up scheduler,
//! and the halting controls, and differs in the one thing that matters: a plan spends
//! its whole budget on every cell, a ladder spends it only where a model is still
//! getting somewhere.
//!
//! ## The gate
//!
//! There is exactly **one** rule, parameterised — never a set of modes:
//!
//! ```text
//! advance when count(my runs on this rung rated FLOOR or better) >= THRESHOLD
//! ```
//!
//! It lives in [`crate::coverage::gate`], which owns the arithmetic, the
//! unloaded-build shortcut, and the deliberately conservative "not decided yet"
//! answer. This module gathers the evidence for it and records what it decided.
//!
//! ## Progress is per combination, and it is derived
//!
//! A ladder stores **no** current-rung pointer. How far a climber has got is derived
//! from its recorded [outcomes](crate::db::StoredLadderOutcome) — walk the rungs from
//! the bottom until one is not cleared — which is what lets a model added to a
//! standing ladder next month start at rung 1 while the models already halfway up
//! carry on, and what lets a re-review change history honestly. An outcome is keyed by
//! the case **version** it was decided against, so bumping a rung's pin neither erases
//! the verdict earned on the old content nor silently inherits it.
//!
//! Steering — climb this one first, watch it, stop it — is stored separately
//! ([`crate::db::StoredLadderClimber`]) precisely so it can never be confused with
//! progress. Manual verdict overrides live beside the automatic outcome rather than
//! replacing it, so a recompute can never quietly undo a human decision.
//!
//! ## The scope seam
//!
//! Identical to a plan's, and just as load-bearing: run and job **counts stay
//! global** (a run someone else produced still satisfies a rung's target and is never
//! re-requested), while **judgement is per-account** — a gate reads only the
//! requesting account's own review, never the run's stored rating, which is the worst
//! domain across every reviewer and would let a stranger wall someone else's climb.
//!
//! Console-only reviewer tooling, like the rest of the coverage surface.

use std::collections::HashMap;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};

use test_cabinet_core::run_record::HarnessSlug;
use test_cabinet_core::test_case::TestType;

use crate::auth::AuthUser;
use crate::coverage::gate::{self, Gate, GateOutcome, GateTally, GateThreshold, RungRun};
use crate::coverage::schedule::{CellDemand, outstanding_across, top_up as decide_top_up};
use crate::db::{
    JobOrigin, LadderOutcomeKind, StoredLadder, StoredLadderClimber, StoredLadderOutcome,
    StoredLadderRung, combination_key,
};
use crate::error::ApiError;

use super::AppState;
use super::coverage::{
    CoverageCell, CoverageQueue, HaltResult, MatrixCtx, PauseInput, QueueCell, ReviewPlanCase,
    ReviewPlanCombo, TopUpCell, TopUpResult, TopUpSkipped, cell_key, clamp_buffer_target,
    clamp_runs_per_cell, collect_queue, enqueue_top_up, group_index, halt_jobs, new_id, now,
    resolve_buffer_target, resolve_combos,
};

/// The most rungs one ladder may hold. A ladder is a curated progression a reviewer
/// reads top to bottom, not a sweep — past a few dozen steps it is a coverage plan
/// wearing a costume, and every climber's progress walk grows with it.
const MAX_LADDER_RUNGS: usize = 50;

/// The test types a rung may not hold, because a gate over them can never resolve and
/// the climber would stall forever without anything looking wrong.
///
/// - [`TestType::Performance`] is graded automatically. It is excluded from every
///   reviewer worklist (nobody can ever clear it), so its runs would stay unjudged
///   permanently — occupying the review buffer *and* leaving the gate undecided.
/// - [`TestType::GameJam`] is reviewed on a graded category scale (💩→💎) and records
///   no domain ratings at all, so a fully reviewed jam run still yields no
///   [`Rating`] for the gate to compare against its floor.
///
/// Both are rejected at author time with an explicit message rather than silently
/// stalling later, which is the failure mode that would be genuinely hard to diagnose.
const RUNG_INELIGIBLE_TEST_TYPES: [TestType; 2] = [TestType::Performance, TestType::GameJam];

// ---- Wire types ------------------------------------------------------------

/// Which axis a ladder's emission loop nests on — and therefore the order its runs
/// execute in, by the same mechanism a plan's axis works: emission order is queue
/// order is execution order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum LadderAxis {
    /// Bring every climber up one rung before anyone moves on — the board advances
    /// as a row. The default: it is what makes a ladder comparable across models.
    #[default]
    Rung,
    /// Take one climber as far up as it gets before starting the next — the board
    /// advances as a column. Answers "how far does *this* model get?" soonest.
    Combination,
}

impl LadderAxis {
    /// The stored/wire token for the axis.
    pub fn as_str(self) -> &'static str {
        match self {
            LadderAxis::Rung => "rung",
            LadderAxis::Combination => "combination",
        }
    }

    /// Parse a stored axis token, falling back to the default for anything else. The
    /// axis decides emission *order* only, so a row written by a newer build degrades
    /// to today's ordering rather than making the ladder unreadable.
    pub fn parse(token: &str) -> Self {
        match token {
            "combination" => LadderAxis::Combination,
            _ => LadderAxis::Rung,
        }
    }
}

/// How a ladder is **fed**, held apart from what it declares for exactly the reason
/// [`super::coverage::CoverageSchedule`] is: the two are edited by different gestures,
/// so saving an edited climb must never un-pause the ladder. The axis vocabulary is
/// the only difference between the two — a ladder has rungs where a plan has cases.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LadderSchedule {
    /// Which axis the emission loop nests on.
    #[serde(default)]
    pub outer_axis: LadderAxis,
    /// Whether topping up is suspended — the console calls this ladder **disabled**.
    ///
    /// A ladder is created suspended and enqueues nothing at all until the reviewer
    /// enables it: a climb is declared long before it is meant to start spending, and a
    /// ladder that launched runs the moment it was saved would have spent a buffer's
    /// worth of tokens before its author had finished reading it back.
    #[serde(default)]
    pub paused: bool,
    /// Whether submitting a review re-runs this ladder's top-up automatically.
    ///
    /// **On** by default, because it is the only thing that moves an enabled ladder
    /// along: a review is the verdict that decides a rung, and the moment it frees a
    /// buffer slot is exactly the moment the next rung's runs should be asked for.
    /// Enqueueing is already gated on the ladder being enabled at all, so this cannot
    /// make an untouched ladder start spending.
    #[serde(default)]
    pub auto_top_up: bool,
    /// This ladder's override of the account's review-buffer target, or null to
    /// inherit it. Null and `0` are different instructions — "no opinion" versus
    /// "never top up".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub buffer_target: Option<u32>,
}

impl Default for LadderSchedule {
    /// A new ladder climbs a rung at a time, starts **disabled**, tops itself up on
    /// every review once it is enabled, and has no opinion on the buffer target.
    ///
    /// The two halves are one decision: enabling is the single gesture that starts a
    /// climb, and from then on the reviews the reviewer is already submitting keep it
    /// moving. Splitting them — enabled but inert until someone finds the top-up
    /// button — is the shape that makes a ladder look broken.
    fn default() -> Self {
        Self {
            outer_axis: LadderAxis::Rung,
            paused: true,
            auto_top_up: true,
            buffer_target: None,
        }
    }
}

impl LadderSchedule {
    /// Lift a stored schedule onto the wire, resolving its free-text axis token.
    fn from_db(stored: crate::db::LadderSchedule) -> Self {
        Self {
            outer_axis: LadderAxis::parse(&stored.outer_axis),
            paused: stored.paused,
            auto_top_up: stored.auto_top_up,
            buffer_target: stored.buffer_target.map(clamp_buffer_target),
        }
    }

    /// Lower this schedule to the store's shape, clamping the buffer override — the
    /// buffer is the only thing bounding a top-up's fan-out.
    fn to_db(&self) -> crate::db::LadderSchedule {
        crate::db::LadderSchedule {
            outer_axis: self.outer_axis.as_str().to_string(),
            paused: self.paused,
            auto_top_up: self.auto_top_up,
            buffer_target: self.buffer_target.map(clamp_buffer_target),
        }
    }
}

/// One rung: exactly one test case, pinned to an exact version and variant.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LadderRung {
    /// The rung's **stable opaque id**, minted when the rung is added and never
    /// reused.
    ///
    /// Emphatically not its position. Rungs get reordered and re-pinned, and every
    /// recorded verdict references this id — a positional identifier would silently
    /// reattribute a climber's verdicts to a different case the moment the ladder was
    /// rearranged.
    pub id: String,
    /// The test-case slug.
    pub slug: String,
    /// The pinned, exact version.
    pub version: String,
    /// The variant to climb.
    pub variant: String,
    /// This rung's override of the ladder's runs-per-cell target, or null to inherit
    /// it — so one pivotal step can demand more evidence without making the whole
    /// climb more expensive.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub runs: Option<u32>,
}

/// One rung in a create/update body. The id is optional: absent means "a new rung",
/// present means "this existing rung, wherever it now sits", which is what lets a
/// reorder or a version bump keep every climber's recorded progress.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LadderRungInput {
    /// The existing rung's stable id, or null to mint one.
    #[serde(default)]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub id: Option<String>,
    /// The test-case slug.
    pub slug: String,
    /// The pinned, exact version.
    pub version: String,
    /// The variant to climb.
    pub variant: String,
    /// This rung's override of the ladder's runs-per-cell target, or null to inherit.
    #[serde(default)]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub runs: Option<u32>,
}

/// A ladder **as declared**: the climb, the climbers, and the rule every rung is
/// judged by. How it is fed is [`LadderSchedule`]; how far anyone has got is derived,
/// and lives in [`LadderProgress`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct Ladder {
    /// The ladder's opaque id (minted on create).
    pub id: String,
    /// The reviewer-chosen display name.
    pub name: String,
    /// The default target number of runs for each `rung × combination` cell; a rung
    /// may raise it for itself via [`LadderRung::runs`].
    pub runs_per_cell: u32,
    /// The single parameterised rule every rung is judged by. Per ladder, not per
    /// rung: a ladder asks *one* question of an ordered series of cases, and only how
    /// many runs it takes to answer varies by rung.
    pub gate: Gate,
    /// The referenced combination groups' ids — the same `kind = "combo"` coverage
    /// groups a plan uses, so one saved set of models drives both and editing it
    /// reshapes both.
    pub combo_group_ids: Vec<String>,
    /// One-off combinations pinned directly on the ladder, unioned with the groups.
    pub combos: Vec<ReviewPlanCombo>,
    /// The rungs, low to high. The order **is** the climb.
    pub rungs: Vec<LadderRung>,
    /// RFC 3339 of when the ladder was last saved.
    pub updated_at: String,
}

/// One ladder as a reader sees it: declaration and schedule flattened into a single
/// object, exactly as [`super::coverage::CoveragePlanOut`] does for a plan.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LadderOut {
    /// The ladder's declaration.
    #[serde(flatten)]
    pub ladder: Ladder,
    /// How the ladder is being fed.
    #[serde(flatten)]
    pub schedule: LadderSchedule,
}

/// The create/update body for a ladder (the server assigns `id` and `updatedAt`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LadderInput {
    /// The reviewer-chosen display name.
    pub name: String,
    /// The default target number of runs for each `rung × combination` cell.
    pub runs_per_cell: u32,
    /// The rule every rung is judged by, or null for [`Gate::default`] — the gentlest
    /// gate that still stops a hopeless climb (advance as long as one run was playable
    /// at all).
    #[serde(default)]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub gate: Option<Gate>,
    /// The referenced combination groups' ids.
    #[serde(default)]
    pub combo_group_ids: Vec<String>,
    /// One-off combinations pinned directly on the ladder.
    #[serde(default)]
    pub combos: Vec<ReviewPlanCombo>,
    /// The rungs, low to high.
    #[serde(default)]
    pub rungs: Vec<LadderRungInput>,
    /// The schedule to apply along with this save, or null to leave it alone. Nested
    /// and optional for the same reason a plan's is: saving an edited climb must not
    /// un-pause the ladder as a side effect. On **create** an absent schedule means
    /// [`LadderSchedule::default`].
    #[serde(default)]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub schedule: Option<LadderSchedule>,
}

/// A resolved verdict on one rung, as the wire names it. The gate's third answer,
/// "not decided yet", is deliberately absent: an unresolved rung has *no* verdict,
/// and is reported as the absence of one rather than as a verdict of nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum LadderOutcome {
    /// The rung was cleared; the climber moved up.
    Advanced,
    /// The rung was failed; the climber stopped there.
    Walled,
}

impl LadderOutcome {
    /// Lift a stored verdict onto the wire.
    fn from_db(kind: LadderOutcomeKind) -> Self {
        match kind {
            LadderOutcomeKind::Advanced => LadderOutcome::Advanced,
            LadderOutcomeKind::Walled => LadderOutcome::Walled,
        }
    }

    /// Lower a wire verdict to the store's shape.
    fn to_db(self) -> LadderOutcomeKind {
        match self {
            LadderOutcome::Advanced => LadderOutcomeKind::Advanced,
            LadderOutcome::Walled => LadderOutcomeKind::Walled,
        }
    }
}

/// Where one climber stands. Five states, because "stopped" has three genuinely
/// different causes and conflating them makes a ladder impossible to act on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum ClimberStatus {
    /// Runs are still to complete on the current rung. The ladder will keep feeding
    /// this climber.
    Climbing,
    /// The current rung has run everything it was going to and is waiting on *your*
    /// review. Nothing will move until you look — this is the state a full review
    /// buffer is made of.
    AwaitingReview,
    /// The current rung was failed. Reversible by hand with a promote; the automatic
    /// verdict underneath is never destroyed.
    Walled,
    /// Stopped by hand. The automatic outcomes underneath are untouched, so clearing
    /// the hold resumes the climb from exactly where it stood.
    Held,
    /// Every rung cleared. There is nothing left to climb.
    ToppedOut,
}

/// The counts one gate decision was made from, so a dashboard can say *why* a climber
/// is walled or waiting without re-deriving the floor and unloaded-run rules a second
/// time and getting them subtly different.
///
/// The wire mirror of [`GateTally`], which is an internal type of the pure core.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct RungTally {
    /// Completed runs on the rung.
    pub completed: u32,
    /// Completed runs the gate has a rating for — reviewed by you, or decided as
    /// broken because the build never loaded.
    pub judged: u32,
    /// Completed runs still waiting on your review.
    pub unjudged: u32,
    /// Judged runs rated at or above the gate's floor.
    pub passing: u32,
    /// Runs the rung has yet to complete against its target.
    pub pending: u32,
    /// How many passing runs the threshold demands, as the whole number of runs it
    /// actually takes — a fractional bar of 2.5 means three.
    pub required: u32,
}

impl RungTally {
    /// Lift a core tally onto the wire, rounding the fractional requirement to the
    /// run count it actually takes. The decision itself compares the fractional value;
    /// only the display rounds.
    fn from_gate(tally: GateTally) -> Self {
        Self {
            completed: tally.completed,
            judged: tally.judged,
            unjudged: tally.unjudged,
            passing: tally.passing,
            pending: tally.pending,
            required: tally.required_runs(),
        }
    }
}

/// The rung a climber currently stands on: the coverage cell it is filling, the gate
/// evidence gathered so far, and what the gate makes of it right now.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LadderCell {
    /// Which rung, by its stable id.
    pub rung_id: String,
    /// The rung's position in the climb, from zero.
    pub position: u32,
    /// The cell's counts — the same shape a coverage plan's matrix reports, because it
    /// is the same question asked of the same three grouped reads.
    #[serde(flatten)]
    pub cell: CoverageCell,
    /// The gate evidence gathered so far.
    pub tally: RungTally,
    /// What the gate makes of that evidence *now*, including its "not decided yet"
    /// answer — which a recorded outcome can never express.
    pub outcome: GateOutcome,
}

/// One recorded (or freshly computed) verdict on one rung for one climber.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LadderRungOutcome {
    /// Which rung, by its stable id.
    pub rung_id: String,
    /// The exact case version the verdict was decided against.
    ///
    /// Part of the verdict's identity, not decoration: bumping a rung to a newer case
    /// neither erases the verdict earned on the old one nor silently inherits it, and
    /// re-pinning back restores it.
    pub decided_version: String,
    /// What the gate computed. Recomputable at any time from your reviews.
    pub outcome: LadderOutcome,
    /// Your manual override of that result, or null for none. Kept beside the
    /// automatic verdict rather than replacing it, so a recompute can never silently
    /// undo it and clearing it reverses the override exactly.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub override_outcome: Option<LadderOutcome>,
    /// The verdict that actually governs the climb: the override when there is one,
    /// else the automatic outcome.
    pub effective: LadderOutcome,
    /// RFC 3339 of when the automatic outcome was computed.
    pub decided_at: String,
    /// RFC 3339 of when the override was applied, or null when there is none.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub override_at: Option<String>,
    /// Whether this verdict was decided against a version the rung no longer pins —
    /// history kept honest across a bump, and never allowed to govern the climb.
    pub stale: bool,
    /// Whether the verdict is stored, or was computed live for this response and will
    /// be written down by the next top-up. A read never writes.
    pub recorded: bool,
}

/// One climber's whole standing on the ladder.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LadderClimber {
    /// The combination's canonical key (`harness|model|provider`), which is how
    /// steering and verdicts reference it.
    pub key: String,
    /// The harness.
    pub harness: HarnessSlug,
    /// The canonical model id.
    pub model: String,
    /// The provider for a provider-routed harness, or null.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub provider: Option<String>,
    /// Climb-order weight; higher goes first, zero is the default. Pushes one model to
    /// the front without reordering the ladder — which would change what every *other*
    /// climber is measured against.
    pub priority: i32,
    /// The reviewer's "watch this one" flag, and the tiebreak between equal
    /// priorities.
    pub focused: bool,
    /// Whether the climber is stopped by hand.
    pub held: bool,
    /// Where the climber stands.
    pub status: ClimberStatus,
    /// The rung it stands on, or null once it has topped out.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub current_rung: Option<LadderCell>,
    /// Every verdict this climber has on the ladder, in climb order, with any decided
    /// against a superseded version flagged and trailing.
    pub outcomes: Vec<LadderRungOutcome>,
}

/// One rung as the progress board describes it: the declaration plus how its pin has
/// aged.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LadderProgressRung {
    /// The rung's declaration.
    #[serde(flatten)]
    pub rung: LadderRung,
    /// Its position in the climb, from zero.
    pub position: u32,
    /// The newest ingested version of this case. Empty when the case is not ingested.
    pub latest_version: String,
    /// Whether the pinned version is not the newest ingested one — a hint that the
    /// rung could be bumped, and a warning that doing so re-opens every verdict on it.
    pub stale: bool,
}

/// The ladder's board: the climb, every climber's standing, and the roll-ups the
/// dashboard header shows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LadderProgress {
    /// The ladder's id.
    pub ladder_id: String,
    /// The axis the climbers below are ordered on, and the order runs are emitted in.
    pub outer_axis: LadderAxis,
    /// The rungs, low to high.
    pub rungs: Vec<LadderProgressRung>,
    /// Every climber, in the order the ladder would feed them.
    pub climbers: Vec<LadderClimber>,
    /// How many climbers have cleared every rung.
    pub climbers_topped_out: u32,
    /// How many climbers are walled.
    pub climbers_walled: u32,
    /// The runs still to trigger across every climber's current rung.
    pub runs_missing: u32,
    /// The completed runs across those rungs the requester has not reviewed.
    pub runs_unreviewed: u32,
    /// The review-buffer occupancy: in-flight jobs plus unreviewed runs. When this has
    /// reached `bufferTarget`, a top-up deliberately enqueues nothing — which is the
    /// difference between a finished ladder and a full one.
    pub runs_outstanding: u32,
    /// The buffer target in force (the ladder's override, else the account's setting,
    /// else the backend default).
    pub buffer_target: u32,
}

/// The `POST /ladders/{id}/climbers` body: one combination's steering, written whole.
///
/// Whole rather than field-by-field because it is one decision — "climb this one first
/// and watch it" — and a partial update can leave a combination focused-but-forgotten.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LadderClimberInput {
    /// Which combination to steer. Identified by the combination itself rather than by
    /// its key, because a model id contains slashes and has no business in a URL path.
    pub combination: ReviewPlanCombo,
    /// Climb-order weight; higher goes first.
    #[serde(default)]
    pub priority: i32,
    /// The "watch this one" flag.
    #[serde(default)]
    pub focused: bool,
    /// Whether to stop this climber where it stands — the downward half of manual
    /// control. Reversible: the automatic outcomes underneath are never touched, so
    /// clearing it resumes exactly where the climb left off.
    #[serde(default)]
    pub held: bool,
}

/// The `POST /ladders/{id}/outcomes` body: apply (or clear) a manual override of one
/// recorded verdict — the upward half of manual control.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LadderOverrideInput {
    /// Which combination.
    pub combination: ReviewPlanCombo,
    /// Which rung, by its stable id.
    pub rung_id: String,
    /// The verdict to impose, or null to clear the override and restore exactly what
    /// the gate itself says.
    #[serde(default)]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub outcome: Option<LadderOutcome>,
}

/// The `POST /ladders/{id}/rungs/order` body: the rungs' stable ids in their new
/// climb order.
///
/// Ids rather than a list of rungs, because a reorder must not be able to edit a rung
/// in passing — and because reordering by stable id is precisely what keeps every
/// climber's recorded verdicts attached to the case that earned them.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LadderRungOrderInput {
    /// Every one of the ladder's rung ids, in the new order. Must be a permutation of
    /// what the ladder currently holds: a reorder that adds or drops a rung is an edit,
    /// and edits go through `PUT /ladders/{id}` where the consequences are visible.
    pub rung_ids: Vec<String>,
}

// ---- CRUD ------------------------------------------------------------------

/// `GET /ladders` — every ladder the token account owns, each with its schedule.
pub async fn list(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<Vec<LadderOut>>, ApiError> {
    let stored = state
        .db
        .list_ladders(&user.0.id)
        .await
        .map_err(ApiError::from)?;
    let mut out = Vec::with_capacity(stored.len());
    for ladder in stored {
        let schedule = schedule_of(&state, &user.0.id, &ladder.id).await?;
        out.push(LadderOut {
            ladder: ladder_to_wire(ladder),
            schedule,
        });
    }
    Ok(Json(out))
}

/// `GET /ladders/{id}` — one ladder's declaration and schedule. 404 when the id is
/// not the caller's.
pub async fn get(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<LadderOut>, ApiError> {
    let stored = load_ladder(&state, &user.0.id, &id).await?;
    let schedule = schedule_of(&state, &user.0.id, &id).await?;
    Ok(Json(LadderOut {
        ladder: ladder_to_wire(stored),
        schedule,
    }))
}

/// `POST /ladders` — create a ladder. Targets are clamped, the gate is sanitized, and
/// every rung's case type is checked so a rung that could never resolve is refused up
/// front rather than stalling a climb weeks later.
///
/// Creating a ladder enqueues **nothing**: an absent schedule is
/// [`LadderSchedule::default`], which is disabled. Saving a climb is describing the
/// question, not asking it — the ladder starts spending when it is enabled, and never
/// before.
pub async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Json(input): Json<LadderInput>,
) -> Result<Json<LadderOut>, ApiError> {
    let schedule = input.schedule.clone().unwrap_or_default();
    let stored = ladder_from_input(new_id(), input, &now()?)?;
    reject_ineligible_rungs(&state, &stored.rungs)?;
    state
        .db
        .insert_ladder(&user.0.id, &stored, &schedule.to_db())
        .await
        .map_err(ApiError::from)?;
    Ok(Json(LadderOut {
        ladder: ladder_to_wire(stored),
        schedule,
    }))
}

/// `PUT /ladders/{id}` — update a ladder's declaration in place, reconciling its
/// rungs. 404 when the id is not the caller's.
///
/// Rungs are matched on their stable ids and **reconciled, never replaced**: a rung
/// still present keeps its recorded verdicts, a new one is inserted, and only a rung
/// genuinely dropped from the climb takes its verdicts with it — which is what
/// dropping it means. The schedule is written only when the body carried one.
pub async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(input): Json<LadderInput>,
) -> Result<Json<LadderOut>, ApiError> {
    let requested_schedule = input.schedule.clone();
    let stored = ladder_from_input(id.clone(), input, &now()?)?;
    reject_ineligible_rungs(&state, &stored.rungs)?;
    let updated = state
        .db
        .update_ladder(&user.0.id, &stored)
        .await
        .map_err(ApiError::from)?;
    if !updated {
        return Err(ApiError::not_found("ladder not found"));
    }
    let schedule = match requested_schedule {
        Some(schedule) => {
            state
                .db
                .set_ladder_schedule(&user.0.id, &id, &schedule.to_db())
                .await
                .map_err(ApiError::from)?;
            schedule
        }
        None => schedule_of(&state, &user.0.id, &id).await?,
    };
    Ok(Json(LadderOut {
        ladder: ladder_to_wire(stored),
        schedule,
    }))
}

/// `DELETE /ladders/{id}` — delete a ladder and, by cascade, its rungs, steering, and
/// verdicts. 404 when the id is not the caller's.
///
/// Jobs the ladder launched are deliberately left alone: they record the ladder only
/// as their origin, and deleting the ladder you launched from is not a reason to throw
/// away runs that already cost money. Halt first if that is what you meant.
pub async fn delete(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let deleted = state
        .db
        .delete_ladder(&user.0.id, &id)
        .await
        .map_err(ApiError::from)?;
    if !deleted {
        return Err(ApiError::not_found("ladder not found"));
    }
    Ok(StatusCode::NO_CONTENT)
}

/// `POST /ladders/{id}/rungs/order` — reorder the climb without editing it. 404 when
/// the id is not the caller's; 400 when the body is not a permutation of the ladder's
/// current rungs.
pub async fn reorder_rungs(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(input): Json<LadderRungOrderInput>,
) -> Result<Json<Vec<LadderRung>>, ApiError> {
    let mut stored = load_ladder(&state, &user.0.id, &id).await?;
    if input.rung_ids.len() != stored.rungs.len() {
        return Err(ApiError::bad_request(format!(
            "a reorder must list every rung exactly once (ladder has {}, body listed {})",
            stored.rungs.len(),
            input.rung_ids.len()
        )));
    }
    // Drained by id as the new order is read, so a rung named twice finds nothing the
    // second time — which is the same error as naming a rung that is not on the ladder,
    // and both mean the body was not a permutation.
    let mut by_id: HashMap<String, StoredLadderRung> = stored
        .rungs
        .iter()
        .map(|rung| (rung.id.clone(), rung.clone()))
        .collect();
    let mut reordered = Vec::with_capacity(stored.rungs.len());
    for rung_id in &input.rung_ids {
        let rung = by_id.remove(rung_id).ok_or_else(|| {
            ApiError::bad_request(format!(
                "`{rung_id}` is not a rung of this ladder, or is listed twice"
            ))
        })?;
        reordered.push(rung);
    }
    stored.rungs = reordered;
    stored.updated_at = now()?;
    let updated = state
        .db
        .update_ladder(&user.0.id, &stored)
        .await
        .map_err(ApiError::from)?;
    if !updated {
        return Err(ApiError::not_found("ladder not found"));
    }
    Ok(Json(stored.rungs.iter().map(rung_to_wire).collect()))
}

// ---- Schedule --------------------------------------------------------------

/// `GET /ladders/{id}/schedule` — how one ladder is being fed. 404 when the id is not
/// the caller's.
pub async fn schedule(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<LadderSchedule>, ApiError> {
    Ok(Json(schedule_of(&state, &user.0.id, &id).await?))
}

/// `PUT /ladders/{id}/schedule` — replace how one ladder is being fed, without
/// re-sending (or racing) its climb. 404 when the id is not the caller's.
pub async fn set_schedule(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(schedule): Json<LadderSchedule>,
) -> Result<Json<LadderSchedule>, ApiError> {
    let updated = state
        .db
        .set_ladder_schedule(&user.0.id, &id, &schedule.to_db())
        .await
        .map_err(ApiError::from)?;
    if !updated {
        return Err(ApiError::not_found("ladder not found"));
    }
    Ok(Json(schedule))
}

// ---- Progress --------------------------------------------------------------

/// `GET /ladders/{id}/progress` — the ladder's board: every climber's status, the rung
/// it stands on, and its verdicts. 404 when the id is not the caller's.
///
/// A **read**: verdicts the gate has resolved but nobody has written down yet are
/// computed live and flagged [`LadderRungOutcome::recorded`] false. They are persisted
/// by the next top-up, which is a write endpoint — a `GET` that silently mutated the
/// board would make a dashboard refresh part of the climb.
pub async fn progress(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<LadderProgress>, ApiError> {
    let board = load_board(&state, &user, &id, false).await?;
    Ok(Json(board.progress))
}

// ---- Top-up ----------------------------------------------------------------

/// `POST /ladders/{id}/topup` — refill the ladder's review buffer: resolve where every
/// climber stands (recording any verdict that has become decidable), then enqueue whole
/// cells of the rungs they are on until the requester has `bufferTarget` runs
/// outstanding.
///
/// Only a climber's **current** rung is ever launched — that is what makes this a
/// ladder rather than a plan. Serialized per ladder by a claim on the ladder row, for
/// the same reason a plan's top-up is: two tabs would otherwise both observe the same
/// shortfall and both enqueue for it. 404 when the id is not the caller's.
pub async fn top_up(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<TopUpResult>, ApiError> {
    let schedule = schedule_of(&state, &user.0.id, &id).await?;
    let buffer_target = resolve_buffer_target(&state, &user.0.id, schedule.buffer_target).await?;
    if schedule.paused {
        return Ok(Json(TopUpResult::skipped_by(
            TopUpSkipped::Paused,
            buffer_target,
        )));
    }
    let claimed = state
        .db
        .claim_ladder_top_up(&user.0.id, &id, &now()?)
        .await
        .map_err(ApiError::from)?;
    if !claimed {
        return Ok(Json(TopUpResult::skipped_by(
            TopUpSkipped::Busy,
            buffer_target,
        )));
    }

    // Everything from here to the release runs under the claim. The release is
    // unconditional: a claim nobody releases only expires after the store's lease, and
    // stalling the ladder that long because one request failed would turn a bad
    // moment into a wedged ladder.
    let worked = top_up_locked(&state, &user, &id, buffer_target).await;
    let released = state.db.release_ladder_top_up(&id).await;
    let result = worked?;
    released.map_err(ApiError::from)?;
    Ok(Json(result))
}

/// The body of [`top_up`], run while this caller holds the ladder's claim.
async fn top_up_locked(
    state: &AppState,
    user: &AuthUser,
    id: &str,
    buffer_target: u32,
) -> Result<TopUpResult, ApiError> {
    // `record = true`: a top-up is a write, and the whole point of resolving the board
    // here is to write down the verdicts that let climbers move up.
    let board = load_board(state, user, id, true).await?;

    let demands: Vec<CellDemand> = board
        .active
        .iter()
        .map(|active| board.ctx.demand(active.target, &active.case, &active.combo))
        .collect();
    let outstanding = outstanding_across(&demands);
    let launches = decide_top_up(&demands, buffer_target, outstanding);

    let cells: Vec<TopUpCell<'_>> = launches
        .iter()
        .map(|launch| {
            let active = &board.active[launch.cell];
            TopUpCell {
                rung_id: Some(active.rung_id.clone()),
                case: &active.case,
                combo: &active.combo,
                runs: launch.runs,
            }
        })
        .collect();
    let launched = enqueue_top_up(state, user, &JobOrigin::Ladder(id.to_string()), &cells).await?;

    Ok(TopUpResult {
        skipped: None,
        buffer_target,
        outstanding: Some(outstanding),
        enqueued: launched.iter().map(|cell| cell.runs).sum(),
        cells: launched,
    })
}

// ---- Scoped review queue ---------------------------------------------------

/// `GET /ladders/{id}/queue` — the completed runs on the climbers' current rungs that
/// the requesting account has not reviewed, **in the ladder's own order**.
///
/// A ladder's buffer is filled deliberately — a rung's repeats arrive together so they
/// can be judged against each other, and a walled climber is what the next review
/// decides — so reviewing it newest-first, as the global Unreviewed page does, throws
/// away the only ordering that mattered. 404 when the id is not the caller's.
pub async fn queue(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<CoverageQueue>, ApiError> {
    let board = load_board(&state, &user, &id, false).await?;
    let cells: Vec<QueueCell<'_>> = board
        .active
        .iter()
        .map(|active| QueueCell {
            rung_id: Some(active.rung_id.clone()),
            case: &active.case,
            combo: &active.combo,
            unreviewed: board.ctx.unreviewed_for(&active.case, &active.combo),
        })
        .collect();
    Ok(Json(collect_queue(&state, &user.0.id, &cells).await?))
}

// ---- Halting ---------------------------------------------------------------

/// `POST /ladders/{id}/pause` — suspend (or resume) topping this ladder up, leaving
/// the queue untouched. This is the ladder's **disable / enable** control, and a new
/// ladder starts on the suspended side of it. 404 when the id is not the caller's.
///
/// Enabling deliberately does not enqueue anything by itself: it says the ladder *may*
/// spend, and the caller that enabled it follows with a top-up. Keeping the two apart is
/// what keeps top-up the one endpoint that launches runs, so there is exactly one place
/// where a ladder can start costing money.
pub async fn pause(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(input): Json<PauseInput>,
) -> Result<Json<LadderSchedule>, ApiError> {
    let mut schedule = schedule_of(&state, &user.0.id, &id).await?;
    schedule.paused = input.paused;
    state
        .db
        .set_ladder_schedule(&user.0.id, &id, &schedule.to_db())
        .await
        .map_err(ApiError::from)?;
    Ok(Json(schedule))
}

/// `POST /ladders/{id}/halt` — pause the ladder **and** cancel the jobs it launched
/// that have cost nothing yet (`queued` and `pending`).
///
/// The common case, and it needs no confirmation precisely because it throws nothing
/// away: those jobs have no driver and have spent no tokens. It reaches only jobs whose
/// origin is this ladder, so a run launched by hand is never swept up. 404 when the id
/// is not the caller's.
pub async fn halt(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<HaltResult>, ApiError> {
    halt_inner(state, user, id, false).await
}

/// `POST /ladders/{id}/halt-all` — pause the ladder and cancel **every** job it
/// launched, including the ones already dispatched, starting, or running.
///
/// The rare control: those jobs are partly or wholly paid for, so the console must
/// confirm before calling it and must never make it the default. 404 when the id is not
/// the caller's.
pub async fn halt_all(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<HaltResult>, ApiError> {
    halt_inner(state, user, id, true).await
}

/// The shared body of [`halt`] and [`halt_all`], differing only in how far into the
/// in-flight states the cancel reaches.
async fn halt_inner(
    state: AppState,
    user: AuthUser,
    id: String,
    include_active: bool,
) -> Result<Json<HaltResult>, ApiError> {
    let mut schedule = schedule_of(&state, &user.0.id, &id).await?;
    // Pause first: a halt that emptied the queue and left the ladder topping itself up
    // would refill exactly what it just cancelled.
    schedule.paused = true;
    state
        .db
        .set_ladder_schedule(&user.0.id, &id, &schedule.to_db())
        .await
        .map_err(ApiError::from)?;
    let canceled = halt_jobs(
        &state,
        &JobOrigin::Ladder(id.clone()),
        include_active,
        "canceled by a ladder halt",
    )
    .await?;
    Ok(Json(HaltResult {
        canceled,
        included_active: include_active,
    }))
}

// ---- Manual control --------------------------------------------------------

/// `POST /ladders/{id}/climbers` — set one combination's steering: its climb priority,
/// its focus flag, and whether it is held.
///
/// This is the **downward** half of manual control. A hold stops the climber where it
/// stands without pretending a rung was decided, so clearing it resumes from exactly
/// where the climb left off. 404 when the id is not the caller's.
pub async fn set_climber(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(input): Json<LadderClimberInput>,
) -> Result<Json<StoredClimberOut>, ApiError> {
    // Resolving the ladder first is what scopes the write to the caller's account: the
    // child tables are keyed by ladder id alone and inherit the ladder's ownership.
    load_ladder(&state, &user.0.id, &id).await?;
    let climber = StoredLadderClimber {
        combination_key: combination_key(&input.combination),
        priority: input.priority,
        focused: input.focused,
        held: input.held,
        updated_at: now()?,
    };
    state
        .db
        .set_ladder_climber(&id, &climber)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(StoredClimberOut {
        key: climber.combination_key,
        priority: climber.priority,
        focused: climber.focused,
        held: climber.held,
        updated_at: climber.updated_at,
    }))
}

/// One combination's stored steering, echoed back after a write.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct StoredClimberOut {
    /// The combination's canonical key.
    pub key: String,
    /// Climb-order weight; higher goes first.
    pub priority: i32,
    /// The "watch this one" flag.
    pub focused: bool,
    /// Whether the climber is stopped by hand.
    pub held: bool,
    /// RFC 3339 of when the steering was written.
    pub updated_at: String,
}

/// `POST /ladders/{id}/outcomes` — apply or clear a manual override of one recorded
/// verdict: promote a climber past a rung its runs failed, wall one its runs passed, or
/// take either back.
///
/// This is the **upward** half of manual control, and it is deliberately an override
/// stored *beside* the automatic verdict rather than a rewrite of it: a later recompute
/// can never silently undo it, clearing it restores exactly what the gate says, and the
/// disagreement between reviewer and gate stays legible.
///
/// 404 when the ladder is not the caller's; 409 when the rung has no verdict to
/// override yet — an undecided rung has nothing to promote *past*, and the control for
/// "stop here regardless" is a hold, which does not pretend a rung was decided.
pub async fn set_outcome(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(input): Json<LadderOverrideInput>,
) -> Result<Json<LadderRungOutcome>, ApiError> {
    let ladder = load_ladder(&state, &user.0.id, &id).await?;
    let rung = ladder
        .rungs
        .iter()
        .find(|rung| rung.id == input.rung_id)
        .ok_or_else(|| ApiError::not_found("rung not found on this ladder"))?;
    let key = combination_key(&input.combination);
    let now = now()?;

    // A verdict the gate has resolved but no top-up has written down yet has nothing to
    // hang an override on. Record it first — it is derived, so writing it is only
    // materializing what the reviews already say — and then override that.
    if !state
        .db
        .set_ladder_outcome_override(
            &id,
            &rung.id,
            &key,
            &rung.version,
            input.outcome.map(LadderOutcome::to_db),
            &now,
        )
        .await
        .map_err(ApiError::from)?
    {
        let case = rung_case(rung);
        let runs = rung_runs(&state, &user.0.id, &case, &input.combination).await?;
        let target = rung.runs_override.unwrap_or(ladder.runs_per_cell);
        let decided = LadderOutcomeKind::from_gate(gate::evaluate(&runs, target, &ladder.gate))
            .ok_or_else(|| {
                ApiError::conflict(
                    "this rung has no verdict yet — there is nothing to promote past. \
                     Wait for its runs and reviews, or hold the climber to stop it here.",
                )
            })?;
        state
            .db
            .record_ladder_outcome(&id, &rung.id, &key, &rung.version, decided, &now)
            .await
            .map_err(ApiError::from)?;
        state
            .db
            .set_ladder_outcome_override(
                &id,
                &rung.id,
                &key,
                &rung.version,
                input.outcome.map(LadderOutcome::to_db),
                &now,
            )
            .await
            .map_err(ApiError::from)?;
    }

    let stored = state
        .db
        .list_ladder_outcomes(&id)
        .await
        .map_err(ApiError::from)?
        .into_iter()
        .find(|outcome| {
            outcome.rung_id == rung.id
                && outcome.combination_key == key
                && outcome.decided_version == rung.version
        })
        .ok_or_else(|| ApiError::internal("the recorded verdict vanished mid-request"))?;
    Ok(Json(outcome_to_wire(&stored, false, true)))
}

// ---- The board -------------------------------------------------------------

/// One climber's current rung, resolved into the cell a top-up or a queue walks.
struct ActiveCell {
    /// The rung's stable id.
    rung_id: String,
    /// The rung's case, at its pinned version.
    case: ReviewPlanCase,
    /// The combination climbing it.
    combo: ReviewPlanCombo,
    /// How many runs the rung wants (its override, else the ladder's target).
    target: u32,
}

/// Everything one ladder read produces: the board for display, the cells that are
/// actually live (in emission order), and the loaded counts both were derived from.
struct Board {
    /// The dashboard's view.
    progress: LadderProgress,
    /// The climbers' current rungs, in the ladder's emission order. Only these are
    /// ever launched or reviewed — that is what makes a ladder a ladder.
    active: Vec<ActiveCell>,
    /// The counts the cells were tallied from, kept so a caller can re-derive a demand
    /// without another round-trip.
    ctx: MatrixCtx,
}

/// Resolve a whole ladder: its climbers, where each stands, and the cells that are
/// live. `record` says whether verdicts that have become decidable are written down —
/// true for the top-up (a write), false for the dashboard and the queue (reads).
///
/// The cost is deliberately shaped: recorded verdicts come from one query for the whole
/// board, and the gate is evaluated live only for the rungs a climber has reached that
/// have no verdict yet — which is normally exactly one per climber, because the walk
/// stops at the first rung that is not cleared.
async fn load_board(
    state: &AppState,
    user: &AuthUser,
    id: &str,
    record: bool,
) -> Result<Board, ApiError> {
    let ladder = load_ladder(state, &user.0.id, id).await?;
    let schedule = schedule_of(state, &user.0.id, id).await?;
    let buffer_target = resolve_buffer_target(state, &user.0.id, schedule.buffer_target).await?;

    let groups = group_index(state, &user.0.id).await?;
    let combos = resolve_combos(&ladder.combo_group_ids, &ladder.combos, &groups);
    let steering: HashMap<String, StoredLadderClimber> = state
        .db
        .list_ladder_climbers(id)
        .await
        .map_err(ApiError::from)?
        .into_iter()
        .map(|climber| (climber.combination_key.clone(), climber))
        .collect();
    let recorded = state
        .db
        .list_ladder_outcomes(id)
        .await
        .map_err(ApiError::from)?;

    let slugs: Vec<String> = ladder.rungs.iter().map(|rung| rung.slug.clone()).collect();
    // A gate that decides an unloaded build without a reviewer must not let those runs
    // occupy a review-buffer slot — there is nothing for a human to look at.
    let ctx = MatrixCtx::load(
        state,
        slugs,
        &user.0.id,
        ladder.gate.unloaded_counts_as_broken,
    )
    .await?;

    let order = climb_order(&combos, &steering);

    let mut climbers: Vec<LadderClimber> = Vec::with_capacity(combos.len());
    // Collected as `(rung position, ActiveCell)` so the rung-major axis can be produced
    // by a stable sort on the position alone.
    let mut active: Vec<(usize, ActiveCell)> = Vec::new();
    let mut climbers_topped_out = 0u32;
    let mut climbers_walled = 0u32;
    for index in order {
        let combo = &combos[index];
        let key = combination_key(combo);
        let steer = steering.get(&key);
        let held = steer.map(|s| s.held).unwrap_or(false);
        let climb = walk_climb(state, user, id, &ladder, combo, &recorded, &ctx, record).await?;

        let status = if held {
            ClimberStatus::Held
        } else {
            climb.status
        };
        match status {
            ClimberStatus::ToppedOut => climbers_topped_out += 1,
            ClimberStatus::Walled => climbers_walled += 1,
            _ => {}
        }
        // Only a climber that is actually working a rung contributes a live cell. A
        // held, walled, or topped-out climber is not fed, which is the whole economy of
        // a ladder: budget goes where a model is still getting somewhere.
        if matches!(
            status,
            ClimberStatus::Climbing | ClimberStatus::AwaitingReview
        ) && let Some(current) = &climb.current
        {
            let rung = &ladder.rungs[current.position];
            active.push((
                current.position,
                ActiveCell {
                    rung_id: rung.id.clone(),
                    case: rung_case(rung),
                    combo: combo.clone(),
                    target: rung.runs_override.unwrap_or(ladder.runs_per_cell),
                },
            ));
        }

        climbers.push(LadderClimber {
            key,
            harness: combo.harness,
            model: combo.model.clone(),
            provider: combo.provider.clone(),
            priority: steer.map(|s| s.priority).unwrap_or(0),
            focused: steer.map(|s| s.focused).unwrap_or(false),
            held,
            status,
            current_rung: climb.current.map(|current| current.cell),
            outcomes: climb.outcomes,
        });
    }

    if schedule.outer_axis == LadderAxis::Rung {
        // Bring the whole board up a rung before anyone moves on. A stable sort keeps
        // the steering order within each rung, so priority still decides who goes first
        // among the climbers standing on the same step.
        active.sort_by_key(|(position, _)| *position);
    }
    let active: Vec<ActiveCell> = active.into_iter().map(|(_, cell)| cell).collect();

    let mut runs_missing = 0u32;
    let mut runs_unreviewed = 0u32;
    let mut runs_outstanding = 0u32;
    for cell in &active {
        let demand = ctx.demand(cell.target, &cell.case, &cell.combo);
        runs_missing += demand.missing();
        runs_unreviewed += demand.unreviewed;
        runs_outstanding += demand.outstanding();
    }

    let progress = LadderProgress {
        ladder_id: ladder.id.clone(),
        outer_axis: schedule.outer_axis,
        rungs: ladder
            .rungs
            .iter()
            .enumerate()
            .map(|(position, rung)| {
                let latest_version = ctx.latest_version(&rung.slug);
                LadderProgressRung {
                    // A case that is not ingested has no newer version to point at, so
                    // it is not flagged: there is nothing for the reviewer to bump to.
                    stale: !latest_version.is_empty() && latest_version != rung.version,
                    rung: rung_to_wire(rung),
                    position: position as u32,
                    latest_version,
                }
            })
            .collect(),
        climbers,
        climbers_topped_out,
        climbers_walled,
        runs_missing,
        runs_unreviewed,
        runs_outstanding,
        buffer_target,
    };
    Ok(Board {
        progress,
        active,
        ctx,
    })
}

/// The order the ladder feeds its climbers: the reviewer's steering first (higher
/// priority, then focused), with resolved declaration order as the stable tiebreak.
///
/// Returned as indices into `combos` so the caller keeps the resolved list as the single
/// source of truth for what the ladder's members are. A combination with no steering row
/// sorts as priority `0`, unfocused — which is how a model added to a standing ladder
/// takes its place at the back without anyone writing a row for it.
fn climb_order(
    combos: &[ReviewPlanCombo],
    steering: &HashMap<String, StoredLadderClimber>,
) -> Vec<usize> {
    let mut order: Vec<usize> = (0..combos.len()).collect();
    order.sort_by_key(|&index| {
        let steer = steering.get(&combination_key(&combos[index]));
        (
            std::cmp::Reverse(steer.map(|s| s.priority).unwrap_or(0)),
            std::cmp::Reverse(steer.map(|s| s.focused).unwrap_or(false)),
            index,
        )
    });
    order
}

/// Which flavour of "not decided yet" a rung is in.
///
/// The two are completely different problems and must not be conflated: runs still to
/// complete are the *ladder's* to solve (top up and wait), while runs that came back
/// and have not been looked at are the *reviewer's* — and it is the second that a full
/// review buffer is made of.
fn undecided_status(tally: &GateTally) -> ClimberStatus {
    if tally.pending > 0 {
        ClimberStatus::Climbing
    } else {
        ClimberStatus::AwaitingReview
    }
}

/// Where one climber stands, and how it got there.
struct Climb {
    /// The status the gates imply, before any manual hold is applied.
    status: ClimberStatus,
    /// The rung it stands on, or `None` once every rung is cleared.
    current: Option<CurrentRung>,
    /// Its verdicts, in climb order, with superseded-version ones flagged and trailing.
    outcomes: Vec<LadderRungOutcome>,
}

/// The rung a climber is on, with the cell the dashboard renders for it.
struct CurrentRung {
    /// Its index in the ladder's rungs.
    position: usize,
    /// The cell, counts and gate evidence included.
    cell: LadderCell,
}

/// Walk one climber up the ladder until it hits a rung it has not cleared.
///
/// Recorded verdicts are consulted first and cost nothing; the gate is evaluated live
/// only where a rung at its **current pin** has no verdict, and the walk stops at the
/// first rung that is not cleared — so a climber halfway up costs one evidence query,
/// not one per rung.
#[allow(clippy::too_many_arguments)]
async fn walk_climb(
    state: &AppState,
    user: &AuthUser,
    ladder_id: &str,
    ladder: &StoredLadder,
    combo: &ReviewPlanCombo,
    recorded: &[StoredLadderOutcome],
    ctx: &MatrixCtx,
    record: bool,
) -> Result<Climb, ApiError> {
    let key = combination_key(combo);
    let mine: Vec<&StoredLadderOutcome> = recorded
        .iter()
        .filter(|outcome| outcome.combination_key == key)
        .collect();

    let mut outcomes: Vec<LadderRungOutcome> = Vec::new();
    let mut current: Option<CurrentRung> = None;
    let mut status = ClimberStatus::ToppedOut;

    for (position, rung) in ladder.rungs.iter().enumerate() {
        // A verdict recorded against the version the rung pins *now* governs the climb;
        // one recorded against a version it used to pin is history, appended below.
        let at_pin = mine
            .iter()
            .find(|outcome| outcome.rung_id == rung.id && outcome.decided_version == rung.version);
        if let Some(stored) = at_pin.copied() {
            outcomes.push(outcome_to_wire(stored, false, true));
            if stored.effective() == LadderOutcomeKind::Advanced {
                continue;
            }
            status = ClimberStatus::Walled;
            current = Some(
                rung_state(
                    state,
                    user,
                    ladder,
                    position,
                    rung,
                    combo,
                    ctx,
                    GateOutcome::Wall,
                )
                .await?,
            );
            break;
        }

        let case = rung_case(rung);
        let runs = rung_runs(state, &user.0.id, &case, combo).await?;
        let target = rung.runs_override.unwrap_or(ladder.runs_per_cell);
        let tally = gate::tally(&runs, target, &ladder.gate);
        let outcome = gate::evaluate(&runs, target, &ladder.gate);
        if record && let Some(kind) = LadderOutcomeKind::from_gate(outcome) {
            state
                .db
                .record_ladder_outcome(ladder_id, &rung.id, &key, &rung.version, kind, &now()?)
                .await
                .map_err(ApiError::from)?;
        }
        match outcome {
            GateOutcome::Advance => {
                outcomes.push(live_outcome(rung, LadderOutcome::Advanced, &now()?));
                continue;
            }
            GateOutcome::Wall => {
                outcomes.push(live_outcome(rung, LadderOutcome::Walled, &now()?));
                status = ClimberStatus::Walled;
            }
            GateOutcome::Undecided => status = undecided_status(&tally),
        }
        current = Some(CurrentRung {
            position,
            cell: LadderCell {
                rung_id: rung.id.clone(),
                position: position as u32,
                cell: ctx.cell(target, &case, combo),
                tally: RungTally::from_gate(tally),
                outcome,
            },
        });
        break;
    }

    // History last: verdicts earned against versions the rungs no longer pin. They are
    // kept so a bump does not erase what a model actually achieved, and flagged so
    // nothing mistakes them for the current standing.
    for stored in mine {
        let superseded = !ladder
            .rungs
            .iter()
            .any(|rung| rung.id == stored.rung_id && rung.version == stored.decided_version);
        if superseded && ladder.rungs.iter().any(|rung| rung.id == stored.rung_id) {
            outcomes.push(outcome_to_wire(stored, true, true));
        }
    }
    Ok(Climb {
        status,
        current,
        outcomes,
    })
}

/// The cell for a rung whose verdict is already recorded, so a walled climber's
/// dashboard entry still shows the evidence the wall was built from.
#[allow(clippy::too_many_arguments)]
async fn rung_state(
    state: &AppState,
    user: &AuthUser,
    ladder: &StoredLadder,
    position: usize,
    rung: &StoredLadderRung,
    combo: &ReviewPlanCombo,
    ctx: &MatrixCtx,
    outcome: GateOutcome,
) -> Result<CurrentRung, ApiError> {
    let case = rung_case(rung);
    let runs = rung_runs(state, &user.0.id, &case, combo).await?;
    let target = rung.runs_override.unwrap_or(ladder.runs_per_cell);
    Ok(CurrentRung {
        position,
        cell: LadderCell {
            rung_id: rung.id.clone(),
            position: position as u32,
            cell: ctx.cell(target, &case, combo),
            tally: RungTally::from_gate(gate::tally(&runs, target, &ladder.gate)),
            outcome,
        },
    })
}

/// The gate's evidence for one `rung × combination` cell: the requesting account's own
/// verdict on every completed run of it, oldest first.
///
/// Never `run.rating`, which is the worst domain across **all** reviewers — gating on
/// that would let a stranger's harsh review wall someone else's climb.
async fn rung_runs(
    state: &AppState,
    user_id: &str,
    case: &ReviewPlanCase,
    combo: &ReviewPlanCombo,
) -> Result<Vec<RungRun>, ApiError> {
    Ok(state
        .db
        .cell_run_ratings(&cell_key(case, combo), user_id)
        .await
        .map_err(ApiError::from)?
        .iter()
        .map(|run| run.as_rung_run())
        .collect())
}

// ---- Small helpers ---------------------------------------------------------

/// Load one ladder, scoped to the requesting account, 404-ing when the id is unknown or
/// owned by someone else. Both are the same answer on purpose: a ladder the caller does
/// not own must not be distinguishable from one that does not exist.
async fn load_ladder(state: &AppState, user_id: &str, id: &str) -> Result<StoredLadder, ApiError> {
    state
        .db
        .get_ladder(user_id, id)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found("ladder not found"))
}

/// One ladder's schedule, 404-ing when the id is not the caller's.
async fn schedule_of(
    state: &AppState,
    user_id: &str,
    id: &str,
) -> Result<LadderSchedule, ApiError> {
    state
        .db
        .ladder_schedule(user_id, id)
        .await
        .map_err(ApiError::from)?
        .map(LadderSchedule::from_db)
        .ok_or_else(|| ApiError::not_found("ladder not found"))
}

/// A rung as the coverage machinery names a case, so a ladder cell and a plan cell are
/// counted by exactly the same key.
fn rung_case(rung: &StoredLadderRung) -> ReviewPlanCase {
    ReviewPlanCase {
        slug: rung.slug.clone(),
        version: rung.version.clone(),
        variant: rung.variant.clone(),
    }
}

/// A stored rung on the wire.
fn rung_to_wire(rung: &StoredLadderRung) -> LadderRung {
    LadderRung {
        id: rung.id.clone(),
        slug: rung.slug.clone(),
        version: rung.version.clone(),
        variant: rung.variant.clone(),
        runs: rung.runs_override,
    }
}

/// A stored ladder on the wire.
fn ladder_to_wire(stored: StoredLadder) -> Ladder {
    Ladder {
        id: stored.id,
        name: stored.name,
        runs_per_cell: stored.runs_per_cell,
        gate: stored.gate,
        combo_group_ids: stored.combo_group_ids,
        combos: stored.combos,
        rungs: stored.rungs.iter().map(rung_to_wire).collect(),
        updated_at: stored.updated_at,
    }
}

/// A stored verdict on the wire.
fn outcome_to_wire(stored: &StoredLadderOutcome, stale: bool, recorded: bool) -> LadderRungOutcome {
    LadderRungOutcome {
        rung_id: stored.rung_id.clone(),
        decided_version: stored.decided_version.clone(),
        outcome: LadderOutcome::from_db(stored.outcome),
        override_outcome: stored.override_outcome.map(LadderOutcome::from_db),
        effective: LadderOutcome::from_db(stored.effective()),
        decided_at: stored.decided_at.clone(),
        override_at: stored.override_at.clone(),
        stale,
        recorded,
    }
}

/// A verdict the gate resolved during this request but that is not stored (a read, or a
/// rung whose write is still to come). Flagged `recorded: false` so nothing mistakes it
/// for something on disk.
fn live_outcome(rung: &StoredLadderRung, outcome: LadderOutcome, now: &str) -> LadderRungOutcome {
    LadderRungOutcome {
        rung_id: rung.id.clone(),
        decided_version: rung.version.clone(),
        outcome,
        override_outcome: None,
        effective: outcome,
        decided_at: now.to_string(),
        override_at: None,
        stale: false,
        recorded: false,
    }
}

/// Build a stored ladder from a create/update body: clamp the targets, sanitize the
/// gate, and mint ids for new rungs.
///
/// Three things are rejected rather than accepted-and-broken, because every one of them
/// fails *silently* later: an empty climb, a climb longer than the cap, and a duplicated
/// rung id (which would make two rungs share one set of recorded verdicts). The fourth
/// check — a rung whose case type no gate can ever resolve — needs the definition store
/// and lives in [`reject_ineligible_rungs`], so this stays pure.
fn ladder_from_input(
    id: String,
    input: LadderInput,
    updated_at: &str,
) -> Result<StoredLadder, ApiError> {
    if input.rungs.is_empty() {
        return Err(ApiError::bad_request(
            "a ladder needs at least one rung — an empty climb has nothing to gate",
        ));
    }
    if input.rungs.len() > MAX_LADDER_RUNGS {
        return Err(ApiError::bad_request(format!(
            "a ladder may hold at most {MAX_LADDER_RUNGS} rungs (got {})",
            input.rungs.len()
        )));
    }

    let mut seen_ids: Vec<String> = Vec::with_capacity(input.rungs.len());
    let mut rungs = Vec::with_capacity(input.rungs.len());
    for rung in input.rungs {
        if rung.slug.trim().is_empty() || rung.version.trim().is_empty() {
            return Err(ApiError::bad_request(
                "every rung needs a test-case slug and an exact version",
            ));
        }
        let rung_id = rung.id.unwrap_or_else(new_id);
        if seen_ids.iter().any(|seen| seen == &rung_id) {
            return Err(ApiError::bad_request(format!(
                "rung id `{rung_id}` is listed twice; two rungs sharing an id would share \
                 one set of recorded verdicts"
            )));
        }
        seen_ids.push(rung_id.clone());
        rungs.push(StoredLadderRung {
            id: rung_id,
            slug: rung.slug,
            version: rung.version,
            variant: rung.variant,
            runs_override: rung.runs.map(clamp_runs_per_cell),
        });
    }

    Ok(StoredLadder {
        id,
        name: input.name,
        runs_per_cell: clamp_runs_per_cell(input.runs_per_cell),
        gate: sanitize_gate(input.gate.unwrap_or_default()),
        combo_group_ids: input.combo_group_ids,
        combos: input.combos,
        rungs,
        updated_at: updated_at.to_string(),
    })
}

/// Refuse any rung whose case type can never resolve a gate, naming the type and the
/// reason.
///
/// A case version that is not ingested is **allowed**: whether it resolves at all is the
/// driver's call at run time, and it reports that far better than an author-time guess
/// would. The check is a guard against a silent stall, not a second catalog.
fn reject_ineligible_rungs(state: &AppState, rungs: &[StoredLadderRung]) -> Result<(), ApiError> {
    for rung in rungs {
        let Ok(manifest) = state.store.read_manifest(&rung.slug, &rung.version) else {
            continue;
        };
        if !RUNG_INELIGIBLE_TEST_TYPES.contains(&manifest.test_type) {
            continue;
        }
        let reason = match manifest.test_type {
            TestType::Performance => {
                "it is graded automatically and never appears in a review queue, so its runs \
                 would stay unjudged forever"
            }
            _ => {
                "it is reviewed on a graded category scale and records no domain rating for a \
                 gate to compare against its floor"
            }
        };
        return Err(ApiError::bad_request(format!(
            "`{}` is a {} case and cannot be a ladder rung: {reason}. Cover it with a coverage \
             plan instead.",
            rung.slug,
            manifest.test_type.as_str()
        )));
    }
    Ok(())
}

/// Clamp a submitted gate into the range the backend will honour.
///
/// A fractional threshold outside `0..=1` is meaningless, and an absolute count above
/// [`super::coverage`]'s per-cell ceiling can never be met by a rung that is not allowed
/// to run that many times — it would wall every climber forever, which is a silent
/// failure rather than a loud one.
fn sanitize_gate(gate: Gate) -> Gate {
    Gate {
        floor: gate.floor,
        threshold: match gate.threshold {
            GateThreshold::Count { runs } => GateThreshold::Count {
                runs: clamp_runs_per_cell(runs.max(1)),
            },
            GateThreshold::Fraction { fraction } => GateThreshold::Fraction {
                fraction: if fraction.is_finite() {
                    fraction.clamp(0.0, 1.0)
                } else {
                    0.0
                },
            },
        },
        unloaded_counts_as_broken: gate.unloaded_counts_as_broken,
        early_stop: gate.early_stop,
    }
}

#[cfg(test)]
#[path = "ladders.test.rs"]
mod tests;
