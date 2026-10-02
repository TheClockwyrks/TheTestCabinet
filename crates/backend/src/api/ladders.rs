//! Ladders: an **ordered, gated** climb through a series of test cases, and the
//! combinations that climb it.
//!
//! A [coverage plan](super::coverage) asks "run every one of these cases on every one
//! of these models until each cell has N runs". A ladder asks a different question:
//! *how far up does this model get?* Its cases are an ordered series of **rungs**, its
//! combinations are **climbers**, and a climber only reaches the next rung by clearing
//! the current one. A climber is either shape a
//! [combination](super::coverage::ReviewPlanCombo) takes, so a saved gg configuration
//! climbs beside a third-party harness and is measured against the same gate — which is
//! why every climber is resolved into a [`PlanMember`] before anything counts, launches,
//! or queues it. It is a sibling of a plan, not a mode of one — it shares the
//! groups, the resolver, the matrix counts, the buffer target, the top-up scheduler,
//! and the halting controls, and differs in the one thing that matters: a plan spends
//! its whole budget on every cell, a ladder spends it only where a model is still
//! getting somewhere.
//!
//! A ladder is an **automated** climb. The validators rate every run as it is pushed,
//! the gate reads those ratings, and the backend tops the ladder up itself whenever a
//! run of one of its cells finishes ([`feed_ladders`]), its owner edits it
//! ([`spawn_refeed`]), or the backend starts ([`spawn_startup_feed`]), so a climber goes
//! on until it clears every rung or walls on one without anyone reviewing anything. Reviews are
//! labels added after the fact and never gate or move a climb.
//!
//! ## The gate
//!
//! There is exactly **one** rule, parameterised — never a set of modes:
//!
//! ```text
//! advance when count(runs on this rung rated FLOOR or better) >= THRESHOLD
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
//! carry on. An outcome is keyed by
//! the case **version** it was decided against, so bumping a rung's pin neither erases
//! the verdict earned on the old content nor silently inherits it.
//!
//! Both are keyed by the climber's [`climber_key`]: `harness|model|provider` for a
//! harness climber, and the configuration plus its slot bindings for a gg one, so two
//! climbers running one configuration on different models keep separate histories.
//!
//! Steering — climb this one first, watch it, stop it — is stored separately
//! ([`crate::db::StoredLadderClimber`]) precisely so it can never be confused with
//! progress. Manual verdict overrides live beside the automatic outcome rather than
//! replacing it, so a recompute can never quietly undo a human decision.
//!
//! ## The scope seam
//!
//! Run and job **counts stay global**, as a plan's do: a run someone else produced still
//! satisfies a rung's target and is never re-requested. **Judgement is the
//! validators'**: a gate reads each run's lifted `run.validator_rating`, never the run's
//! stored `rating` (which folds in every reviewer's checklist overrides) and never a
//! review, so a climb is the same whoever looks at its runs and whatever they conclude.
//! Only the review queue is per-account, and it decides nothing.
//!
//! ## Feeding and reviewing are different sets of rungs
//!
//! A ladder only ever **launches** a climber's current rung — that is the economy that
//! makes it a ladder. What it **offers for review**, and what its runs-in-flight cap is
//! measured over, is every rung a climber has reached: a rung early stop decided may
//! still have a run executing, and a decided rung's completed runs are still worth an
//! aesthetic label. See [`cell_sets`].
//!
//! Console-only reviewer tooling, like the rest of the coverage surface.

use std::collections::{BTreeMap, HashMap, HashSet};

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};

use test_cabinet_core::run_record::HarnessSlug;
use test_cabinet_core::test_case::TestType;

use crate::auth::AuthUser;
use crate::coverage::gate::{self, Gate, GateOutcome, GateTally, GateThreshold, RungRun};
use crate::coverage::schedule::{BufferTarget, CellDemand, top_up as decide_top_up};
use crate::db::{
    CANCELABLE_WAITING_STATES, CellKey, JobCancelFilter, JobOrigin, LadderOutcomeKind,
    StoredLadder, StoredLadderClimber, StoredLadderOutcome, StoredLadderRung, combination_key,
};
use crate::error::ApiError;

use super::AppState;
use super::coverage::{
    CoverageCell, CoverageQueue, GgLibrary, HaltResult, MatrixCounting, MatrixCtx, PauseInput,
    PlanMember, QueueCell, ReviewPlanCase, ReviewPlanCombo, TopUpBlocked, TopUpCell, TopUpResult,
    TopUpSkipped, blocked_cell, cell_key, clamp_buffer_target, clamp_runs_per_cell, collect_queue,
    enqueue_top_up, for_read, for_storage, gg_library, group_index, halt_jobs, launchable_demand,
    new_id, now, read_gg_library, reject_unstorable_members, resolve_buffer_target, resolve_combos,
    resolve_member,
};

/// The most rungs one ladder may hold. A ladder is a curated progression a reviewer
/// reads top to bottom, not a sweep — past a few dozen steps it is a coverage plan
/// wearing a costume, and every climber's progress walk grows with it.
const MAX_LADDER_RUNGS: usize = 50;

/// The test types a rung may not hold, because a gate over them can never resolve and
/// the climber would stall forever without anything looking wrong.
///
/// - [`TestType::Performance`] is graded on its own scale and records no functional
///   rating, so its runs would stay unrated permanently and the gate undecided.
/// - [`TestType::GameJam`] is reviewed on a graded category scale (💩→💎) and records
///   no domain ratings at all, so a jam run never yields a
///   [`Rating`](test_cabinet_core::Rating) for the gate to compare against its floor.
///
/// Both are rejected at author time with an explicit message rather than silently
/// stalling later, which is the failure mode that would be genuinely hard to diagnose.
/// A **legacy** case version is refused on the same grounds by [`rung_ineligibility`]:
/// only a reviewer rates its runs, and a ladder's gate reads validator ratings.
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
    /// Whether the backend tops this ladder up itself whenever a job of one of its
    /// cells finishes — "keep climbing as runs finish".
    ///
    /// **On** by default, because it is what moves an enabled ladder along without
    /// anyone watching: the run that finishes is the evidence that may decide a rung,
    /// and the moment it lands is exactly the moment the next rung's runs should be
    /// asked for. Off means the ladder is fed only by enabling it and by an explicit
    /// top-up. Enqueueing is already gated on the ladder being enabled at all, so this
    /// cannot make an untouched ladder start spending.
    #[serde(default)]
    pub auto_top_up: bool,
    /// This ladder's override of the account's buffer target, or null to inherit it.
    /// On a ladder the target caps the runs **in flight** at once (queued through
    /// running); completed runs never occupy it, reviewed or not. Null, a bound of `0`,
    /// and `unbounded` are three different instructions — "no opinion", "never launch
    /// automatically", and "launch every rung as soon as it is earned". On a ladder the
    /// last is the natural choice more often than on a plan: the gate is already what
    /// stops a hopeless climb.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub buffer_target: Option<BufferTarget>,
}

impl Default for LadderSchedule {
    /// A new ladder climbs a rung at a time, starts **disabled**, keeps climbing by
    /// itself as runs finish once it is enabled, and has no opinion on the buffer
    /// target.
    ///
    /// The two halves are one decision: enabling is the single gesture that starts a
    /// climb, and from then on every finished run keeps it moving. Splitting them —
    /// enabled but inert until someone finds the top-up button — is the shape that
    /// makes a ladder look broken.
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

/// One rung: exactly one [pinned case](ReviewPlanCase) — a slug, an exact version, a
/// variant, and the engine its runs are built on.
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
    /// The engine to climb on, or null for the `none` engine.
    ///
    /// Part of the rung's identity within the climb, because clearing a case with a
    /// runtime underneath is a different achievement from clearing it with nothing: one
    /// ladder holds the same case at the same version and variant twice when the two
    /// pins name different engines.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub engine: Option<String>,
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
    /// The engine to climb on, or null for the `none` engine.
    #[serde(default)]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub engine: Option<String>,
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
    /// The rule every rung is decided by, or null for [`Gate::default`] — the gentlest
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

/// Where one climber stands. Five states, because "stopped" has several genuinely
/// different causes and conflating them makes a ladder impossible to act on.
///
/// There is no "waiting on a review" state: the validators rate every completed run, so
/// a rung the ladder can still feed is `climbing`, and one nothing the ladder does can
/// move is `blocked`, with the reason in [`LadderClimber::blocked`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum ClimberStatus {
    /// The current rung is undecided and the ladder can still feed it: runs are still
    /// to complete, and the backend launches them as earlier ones finish.
    Climbing,
    /// The current rung is undecided and nothing the ladder does will move it. Why,
    /// and what fixes it, is [`LadderClimber::blocked`].
    Blocked,
    /// The current rung was failed. Reversible by hand with a promote; the automatic
    /// verdict underneath is never destroyed.
    Walled,
    /// Stopped by hand. The automatic outcomes underneath are untouched, so clearing
    /// the hold resumes the climb from exactly where it stood.
    Held,
    /// Every rung cleared. There is nothing left to climb.
    ToppedOut,
}

/// Why a climber is [`blocked`](ClimberStatus::Blocked), each reason naming its fix.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum ClimberBlock {
    /// The rung's case version is not validator-rated (or is a performance or game-jam
    /// case), so no run of it is ever rated and the ladder never launches it. A stored
    /// ladder can still hold one, since the check runs only when a ladder is saved.
    /// Fix: replace or remove the rung.
    UnsupportedRung {
        /// The rung's stable id.
        #[serde(rename = "rungId")]
        rung_id: String,
    },
    /// The combination cannot be launched at all, and nothing of it is in flight. Fix:
    /// fix or drop the combination.
    Unlaunchable {
        /// Why, in the words the top-up reports it with.
        reason: String,
    },
    /// The cell's most recent terminal jobs all failed, and nothing of it is in flight.
    /// A run finishing no longer relaunches it. Fix: "Top up now" once the cause is
    /// fixed, which relaunches it.
    Failing {
        /// How many failed jobs in a row marked it failing.
        attempts: u32,
    },
    /// Every run the rung will get has completed and the rung is still undecided,
    /// because `runs` of them carry no validator rating (pushed while the backend did
    /// not hold the case version). Fix: re-push the runs, or replace the rung.
    Unrated {
        /// How many of the rung's completed runs carry no validator rating.
        runs: u32,
    },
}

/// The counts one gate decision was made from, so a dashboard can say *why* a climber
/// is walled or still climbing without re-deriving the floor and unloaded-run rules a
/// second time and getting them subtly different.
///
/// The wire mirror of [`GateTally`], which is an internal type of the pure core.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct RungTally {
    /// Completed runs on the rung.
    pub completed: u32,
    /// Completed runs the gate has a rating for — carrying a validator rating, or
    /// decided as broken because the build never loaded.
    pub rated: u32,
    /// Completed runs with no validator rating.
    pub unrated: u32,
    /// Rated runs rated at or above the gate's floor.
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
            rated: tally.rated,
            unrated: tally.unrated,
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
    /// What the gate computed. Recomputable at any time from the rung's validator
    /// ratings.
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
    /// The combination's canonical key — the text this ladder's steering and every one of
    /// its verdicts is stored against.
    ///
    /// Its shape follows the shape of the combination: a harness climber's key is its
    /// `harness|model|provider` triple, and a gg climber's names the configuration and the
    /// models it binds, because two climbers running one configuration on different models
    /// are exactly the two arms a ladder exists to separate. It is written and compared,
    /// never parsed — a client reproduces it by echoing this field, not by assembling one.
    pub key: String,
    /// The harness the climber runs — `gg` on a gg climber.
    pub harness: HarnessSlug,
    /// The model the climber's runs are attributed to: the harness climber's own, and for a
    /// gg climber the model its bound configuration's root agent runs.
    pub model: String,
    /// The provider for a provider-routed harness, or null.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub provider: Option<String>,
    /// The gg configuration this climber runs (`saved:<id>`), or null on a harness climber.
    /// This is what makes a climber a gg climber.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub gg_config_id: Option<String>,
    /// That configuration's current display name, or null on a harness climber. Resolved on
    /// every read rather than stored, so a renamed configuration renames its climbers at
    /// once.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub gg_config_name: Option<String>,
    /// The model bound to each of the configuration's launch slots, keyed by slot name.
    /// Empty on a harness climber. These are half of what the key distinguishes, so a board
    /// can label two climbers of one configuration without re-deriving them.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub gg_slot_models: BTreeMap<String, String>,
    /// Climb-order weight; higher goes first, zero is the default. Pushes one model to
    /// the front without reordering the ladder — which would change what every *other*
    /// climber is measured against.
    pub priority: i32,
    /// The reviewer's "watch this one" flag, and the tiebreak between equal
    /// priorities.
    pub focused: bool,
    /// Whether the climber is stopped by hand.
    pub held: bool,
    /// Why this climber cannot be launched at all, or null when it can.
    ///
    /// A ladder is where an unlaunchable member is hardest to see: a climber that cannot
    /// launch simply stops moving, and a rung it is stuck on looks exactly like one still
    /// waiting on its runs — for as long as anyone leaves it there. So the reason is carried on
    /// the climber itself rather than only on the rung it happens to stand on, which a topped
    /// out or walled climber does not have at all.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub unlaunchable: Option<String>,
    /// Where the climber stands.
    pub status: ClimberStatus,
    /// Why the climber is blocked, naming the fix, or null when it is not. Kept under a
    /// hold too, so the reason stays visible while the climber is stopped by hand.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub blocked: Option<ClimberBlock>,
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
    /// Whether a ladder can climb this rung: false for a stored rung whose case version
    /// the backend holds and which is not validator-rated (or is a performance or
    /// game-jam case). Such a rung is never launched, and a climber that reaches it
    /// without a recorded verdict is `blocked` as `unsupportedRung`. A version the
    /// backend has not ingested is reported supported, as it is allowed at author time.
    pub supported: bool,
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
    /// How many climbers are blocked (not counting a held one).
    pub climbers_blocked: u32,
    /// The runs still to trigger across every climber's current rung.
    pub runs_missing: u32,
    /// The completed runs the requester has not reviewed, across every rung every
    /// climber has **reached** — exactly what `GET /ladders/{id}/queue` offers, so the
    /// two always describe the same runs. Information only: reviews are labels added
    /// after the fact, and this neither blocks nor feeds the climb.
    pub runs_unreviewed: u32,
    /// The runs in flight (jobs `queued` through `running`) across every rung every
    /// climber has reached — the occupancy `bufferTarget` caps. When this has reached
    /// it, a top-up deliberately enqueues nothing, and the climb moves on as those runs
    /// finish. Completed runs never count, reviewed or not.
    pub runs_in_flight: u32,
    /// The buffer target in force (the ladder's override, else the account's setting,
    /// else the backend default): the most runs the ladder keeps in flight at once.
    /// When it is `unbounded`, `runsInFlight` never stops a top-up.
    pub buffer_target: BufferTarget,
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
    ///
    /// A climber read off the board can be handed straight back: the key is taken from the
    /// member as it would be stored, so the derived fields a read filled in
    /// (`model`, `ggConfigName`) make no difference to which climber is addressed.
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
    /// Which combination, in either shape and either — stored or read — form; the same
    /// normalization [`LadderClimberInput::combination`] describes applies.
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
    let library = read_gg_library(
        &state,
        &user.0.id,
        stored.iter().flat_map(|ladder| ladder.combos.iter()),
    )
    .await?;
    let mut out = Vec::with_capacity(stored.len());
    for ladder in stored {
        let schedule = schedule_of(&state, &user.0.id, &ladder.id).await?;
        out.push(LadderOut {
            ladder: ladder_to_wire(ladder, &library),
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
    let library = read_gg_library(&state, &user.0.id, stored.combos.iter()).await?;
    Ok(Json(LadderOut {
        ladder: ladder_to_wire(stored, &library),
        schedule,
    }))
}

/// `POST /ladders` — create a ladder. Targets are clamped, the gate is sanitized, and
/// every rung's case type is checked so a rung that could never resolve is refused up
/// front rather than stalling a climb weeks later.
///
/// A climber is refused on the same terms a plan's member is (`400`, naming the
/// configuration and the slot): a gg climber pointing at a configuration the account does
/// not own, or leaving one of its launch slots unbound, could never produce a run, and a
/// ladder is precisely where that would be invisible — the climber would simply never move.
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
    let library = reject_unstorable_members(&state, &user.0.id, &input.combos, &[]).await?;
    let stored = ladder_from_input(new_id(), input, &now()?)?;
    reject_ineligible_rungs(&state, &stored.rungs)?;
    state
        .db
        .insert_ladder(&user.0.id, &stored, &schedule.to_db())
        .await
        .map_err(ApiError::from)?;
    Ok(Json(LadderOut {
        ladder: ladder_to_wire(stored, &library),
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
///
/// `400` for a climber the account cannot launch, exactly as [`create`] refuses one.
pub async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(input): Json<LadderInput>,
) -> Result<Json<LadderOut>, ApiError> {
    let requested_schedule = input.schedule.clone();
    // The climbers already on the ladder, exempt from re-judgement — see
    // [`reject_unstorable_members`]. A ladder is the place a member sits longest, so a
    // configuration gaining a launch slot must not make the whole ladder unsavable.
    let climbing = state
        .db
        .get_ladder(&user.0.id, &id)
        .await
        .map_err(ApiError::from)?
        .map(|ladder| ladder.combos)
        .unwrap_or_default();
    let library = reject_unstorable_members(&state, &user.0.id, &input.combos, &climbing).await?;
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
    spawn_refeed(&state, &user.0.id, &id);
    Ok(Json(LadderOut {
        ladder: ladder_to_wire(stored, &library),
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
    spawn_refeed(&state, &user.0.id, &id);
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
    spawn_refeed(&state, &user.0.id, &id);
    Ok(Json(schedule))
}

// ---- Progress --------------------------------------------------------------

/// `GET /ladders/{id}/progress` — the ladder's board: every climber's status, the rung
/// it stands on, and its verdicts. 404 when the id is not the caller's.
///
/// A **read**: verdicts the gate has resolved but nobody has written down yet are
/// computed live and flagged [`LadderRungOutcome::recorded`] false. They are persisted
/// by the next top-up, which is a write — a `GET` that silently mutated the board would
/// make a dashboard refresh part of the climb.
pub async fn progress(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<LadderProgress>, ApiError> {
    let board = load_board(&state, &user.0.id, &id, false).await?;
    Ok(Json(board.progress))
}

// ---- Top-up ----------------------------------------------------------------

/// What asked for a ladder top-up. The two differ in one respect: a top-up the backend
/// ran on its own skips a [failing](FAILING_STREAK) cell, while one somebody asked for
/// relaunches it, since asking is the gesture that says the cause is fixed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TopUpTrigger {
    /// The owner enabled the ladder or pressed "Top up now".
    Requested,
    /// The backend fed the ladder by itself: a job of one of its cells reached a
    /// terminal state ([`feed_ladders`]), its owner changed what the climb is
    /// ([`spawn_refeed`]), or the backend started ([`spawn_startup_feed`]).
    Automatic,
}

/// How many failed jobs in a row, with no completed run between them, mark a cell as
/// failing. An automatic top-up then stops relaunching it, so a cell whose every run
/// fails cannot relaunch itself forever; the owner's top-up still does.
const FAILING_STREAK: u32 = 3;

/// The most top-up passes one claim holder runs for the requests that arrived while it
/// held the claim. Each pass sees every run that landed before it started, so a burst
/// of finishes collapses into a pass or two; the bound only stops a pathological stream
/// from pinning one task. A request still standing when the bound is reached is handed
/// to a fresh top-up of its own ([`spawn_pending_top_up`]), never left for a trigger that
/// may not come.
const MAX_TOP_UP_PASSES: u32 = 5;

/// `POST /ladders/{id}/topup` — launch the runs the climb needs: resolve where every
/// climber stands (recording any verdict that has become decidable, and with
/// `earlyStop` on cancelling a decided rung's runs that have not started), then enqueue
/// whole cells of the rungs they are on, up to the in-flight cap.
///
/// Only a climber's **current** rung is ever launched — that is what makes this a
/// ladder rather than a plan. Serialized per ladder by a claim on the ladder row, for
/// the same reason a plan's top-up is: two callers would otherwise both observe the
/// same shortfall and both enqueue for it. Unlike an automatic top-up, this one also
/// relaunches a rung whose runs kept failing. 404 when the id is not the
/// caller's.
pub async fn top_up(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<TopUpResult>, ApiError> {
    Ok(Json(
        top_up_ladder(&state, &user.0.id, &id, TopUpTrigger::Requested).await?,
    ))
}

/// Top one ladder up as `user_id`, its owner: the body of [`top_up`], and what
/// [`feed_ladders`] runs when a job finishes with no console open.
///
/// A disabled ladder answers `skipped: paused` and takes no claim. When another top-up
/// holds the claim, this one leaves a request for another pass (saying whether its
/// owner asked) and tries the claim once more: the holder checks for requests after it
/// releases the claim, so a request is always seen either by the holder or, when the
/// claim came free in between, by this caller, which then serves it itself. Only when
/// the second attempt also finds the claim held does it answer `skipped: busy`. The
/// passes one call runs are merged into one result.
pub(crate) async fn top_up_ladder(
    state: &AppState,
    user_id: &str,
    id: &str,
    trigger: TopUpTrigger,
) -> Result<TopUpResult, ApiError> {
    let schedule = schedule_of(state, user_id, id).await?;
    let buffer_target = resolve_buffer_target(state, user_id, schedule.buffer_target).await?;
    if schedule.paused {
        return Ok(TopUpResult::skipped_by(TopUpSkipped::Paused, buffer_target));
    }

    let mut merged: Option<TopUpResult> = None;
    let mut passes = 0u32;
    let mut requested = false;
    loop {
        let claimed = state
            .db
            .claim_ladder_top_up(user_id, id, &now()?)
            .await
            .map_err(ApiError::from)?;
        if !claimed {
            if requested {
                return Ok(merged.unwrap_or_else(|| {
                    TopUpResult::skipped_by(TopUpSkipped::Busy, buffer_target)
                }));
            }
            // Whoever holds the claim runs one more pass for this request before it
            // lets go, so the evidence that prompted this call is not lost. The holder
            // may already be past its last check, though, so the claim is tried once
            // more: either it is still held, and the holder's check after its release
            // sees the request, or it came free, and this caller serves the request.
            state
                .db
                .request_ladder_top_up(id, trigger == TopUpTrigger::Requested)
                .await
                .map_err(ApiError::from)?;
            requested = true;
            continue;
        }

        // Everything from here to the release runs under the claim. The release is
        // unconditional: a claim nobody releases only expires after the store's lease,
        // and stalling the ladder that long because one pass failed would turn a bad
        // moment into a wedged ladder.
        let worked = top_up_passes(
            state,
            user_id,
            id,
            buffer_target,
            trigger,
            &mut passes,
            &mut merged,
        )
        .await;
        let released = state.db.release_ladder_top_up(id).await;

        // A request that landed between the last check and the release found the claim
        // still held, so it is this caller's to serve. One this caller cannot serve —
        // its passes are spent, or the last one failed — goes to a fresh top-up rather
        // than waiting on a trigger that may never come: the last runs of a climb
        // finishing together are exactly when nothing else will.
        let pending = match released {
            Ok(()) => pass_requested(state, user_id, id).await,
            Err(err) => Err(ApiError::from(err)),
        };
        match (worked, pending) {
            (Ok(()), Ok(true)) if passes < MAX_TOP_UP_PASSES => {
                requested = false;
                continue;
            }
            (worked, Ok(true)) => {
                spawn_pending_top_up(state, user_id, id);
                worked?;
            }
            (worked, pending) => {
                worked?;
                pending?;
            }
        }
        break;
    }
    Ok(merged.unwrap_or_else(|| TopUpResult::skipped_by(TopUpSkipped::Busy, buffer_target)))
}

/// Serve a ladder's pending top-up request on a task of its own, for a holder that has
/// to let it go: its passes are spent, or its last pass failed. It runs as an automatic
/// top-up, and the request it takes upgrades its pass to the owner's when the owner
/// made it ([`top_up_passes`]).
///
/// It cannot loop: it only runs a pass when it takes a request, and a request is only
/// left by a trigger, so a ladder nobody is feeding settles after one more pass.
fn spawn_pending_top_up(state: &AppState, user_id: &str, id: &str) {
    let state = state.clone();
    let user_id = user_id.to_string();
    let id = id.to_string();
    let task: std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> =
        Box::pin(async move {
            match top_up_ladder(&state, &user_id, &id, TopUpTrigger::Automatic).await {
                Ok(result) => tracing::info!(
                    ladder = %id,
                    enqueued = result.enqueued,
                    skipped = ?result.skipped,
                    "served a ladder's pending top-up request"
                ),
                Err(err) => tracing::warn!(
                    ladder = %id,
                    error = %err.message,
                    "could not serve a ladder's pending top-up request"
                ),
            }
        });
    tokio::spawn(task);
}

/// Run top-up passes while the claim is held: one, and another for every request that
/// arrived meanwhile, up to [`MAX_TOP_UP_PASSES`] in all.
///
/// A pass runs as the stronger of the caller's trigger and the request it took: a
/// request the owner made ("Top up now" finding the claim held) is served as the
/// owner's top-up, so it still relaunches a failing rung.
async fn top_up_passes(
    state: &AppState,
    user_id: &str,
    id: &str,
    buffer_target: BufferTarget,
    trigger: TopUpTrigger,
    passes: &mut u32,
    merged: &mut Option<TopUpResult>,
) -> Result<(), ApiError> {
    loop {
        // Taken before the pass reads anything, so a request made during the pass is
        // still standing when it ends.
        let taken = state
            .db
            .take_ladder_top_up_request(id)
            .await
            .map_err(ApiError::from)?;
        let pass_trigger = if taken == Some(true) {
            TopUpTrigger::Requested
        } else {
            trigger
        };
        let result = top_up_locked(state, user_id, id, buffer_target, pass_trigger).await?;
        *merged = Some(match merged.take() {
            None => result,
            Some(earlier) => merge_top_ups(earlier, result),
        });
        *passes += 1;
        if *passes >= MAX_TOP_UP_PASSES || !pass_requested(state, user_id, id).await? {
            return Ok(());
        }
    }
}

/// Whether another pass is wanted: one was requested, and the ladder is still enabled
/// (a halt in the meantime pauses it, and must not be followed by a refill).
async fn pass_requested(state: &AppState, user_id: &str, id: &str) -> Result<bool, ApiError> {
    if !state
        .db
        .ladder_top_up_requested(id)
        .await
        .map_err(ApiError::from)?
    {
        return Ok(false);
    }
    Ok(!schedule_of(state, user_id, id).await?.paused)
}

/// Two passes' results as one: what both enqueued and could not launch, the later
/// pass's view of the buffer, and every early-stop cancel.
fn merge_top_ups(earlier: TopUpResult, later: TopUpResult) -> TopUpResult {
    let mut cells = earlier.cells;
    cells.extend(later.cells);
    let mut unlaunchable = earlier.unlaunchable;
    unlaunchable.extend(later.unlaunchable);
    TopUpResult {
        skipped: later.skipped,
        buffer_target: later.buffer_target,
        outstanding: later.outstanding.or(earlier.outstanding),
        enqueued: earlier.enqueued + later.enqueued,
        cells,
        unlaunchable,
        early_stop_canceled: earlier.early_stop_canceled + later.early_stop_canceled,
    }
}

/// One top-up pass, run while this caller holds the ladder's claim.
async fn top_up_locked(
    state: &AppState,
    user_id: &str,
    id: &str,
    buffer_target: BufferTarget,
    trigger: TopUpTrigger,
) -> Result<TopUpResult, ApiError> {
    // `record = true`: a top-up is a write, and the whole point of resolving the board
    // here is to write down the verdicts that let climbers move up.
    let board = load_board(state, user_id, id, true).await?;

    let mut demands: Vec<CellDemand> = Vec::with_capacity(board.active.len());
    // Climbers whose member never resolved. A ladder is where this is easiest to miss —
    // a climber that cannot launch simply stops moving — so the reason is reported
    // beside the launches rather than left to be inferred from a board that stopped
    // advancing.
    let mut unlaunchable: Vec<TopUpBlocked> = Vec::new();
    for active in &board.active {
        let demand = board
            .ctx
            .demand(active.target, &active.case, &active.member);
        // Only worth reporting on a rung that actually wanted runs: a rung already at its
        // target is not being held up by anything.
        if let Some(reason) = &active.member.unlaunchable
            && demand.missing() > 0
        {
            unlaunchable.push(blocked_cell(
                Some(active.rung_id.clone()),
                &active.case,
                &active.member,
                reason.clone(),
            ));
        }
        let demand = launchable_demand(demand, &active.member);
        // An automatic top-up does not relaunch a cell whose runs keep failing — that is how
        // a cell that always fails would relaunch itself forever. Its owner's top-up does.
        if trigger == TopUpTrigger::Automatic
            && active.failing
            && active.member.unlaunchable.is_none()
        {
            if demand.missing() > 0 {
                unlaunchable.push(blocked_cell(
                    Some(active.rung_id.clone()),
                    &active.case,
                    &active.member,
                    format!(
                        "its last {FAILING_STREAK} runs failed; top up by hand once the \
                         cause is fixed"
                    ),
                ));
            }
            demands.push(CellDemand {
                target: 0,
                ..demand
            });
            continue;
        }
        demands.push(demand);
    }
    // A ladder's buffer caps the runs in flight across every rung a climber has reached,
    // never completed runs, so a climb never waits on a person. Taking the board's total
    // rather than re-tallying the launchable cells keeps the number the dashboard shows
    // and the number the top-up obeys from ever disagreeing.
    let in_flight = board.progress.runs_in_flight;
    let launches = decide_top_up(
        &demands,
        board.ctx.harness_capacity(),
        buffer_target,
        in_flight,
    );

    let cells: Vec<TopUpCell<'_>> = launches
        .iter()
        .map(|launch| {
            let active = &board.active[launch.cell];
            TopUpCell {
                rung_id: Some(active.rung_id.clone()),
                case: &active.case,
                member: &active.member,
                runs: launch.runs,
            }
        })
        .collect();
    // A halt does not take the claim: it disables the ladder and then cancels its
    // waiting jobs. A pass that began before the halt may therefore reach this point
    // after it, and must not refill the queue the halt just emptied. Checked before the
    // enqueue, and again after it, because the halt can land in between: either the
    // halt's cancel comes after these jobs exist and reaches them, or the check below
    // sees the ladder disabled and cancels them itself.
    let origin = JobOrigin::Ladder(id.to_string());
    if schedule_of(state, user_id, id).await?.paused {
        return Ok(TopUpResult {
            early_stop_canceled: board.early_stop_canceled,
            ..TopUpResult::skipped_by(TopUpSkipped::Paused, buffer_target)
        });
    }
    let enqueued = enqueue_top_up(state, user_id, &origin, &cells).await?;
    if !enqueued.launched.is_empty() && schedule_of(state, user_id, id).await?.paused {
        // Only what this pass just enqueued: a plain disable stops new work and leaves
        // the runs queued before it alone, and a halt cancels those itself.
        let ids: Vec<String> = enqueued
            .launched
            .iter()
            .flat_map(|cell| cell.job_ids.iter().cloned())
            .collect();
        super::jobs::sweep_cancel(
            state,
            &JobCancelFilter {
                states: &CANCELABLE_WAITING_STATES,
                origin: Some(&origin),
                user_id: None,
                cell: None,
                ids: Some(&ids),
            },
            "canceled: the ladder was disabled while this run was being enqueued",
        )
        .await?;
        return Ok(TopUpResult {
            early_stop_canceled: board.early_stop_canceled,
            ..TopUpResult::skipped_by(TopUpSkipped::Paused, buffer_target)
        });
    }
    unlaunchable.extend(enqueued.blocked);

    Ok(TopUpResult {
        skipped: None,
        buffer_target,
        outstanding: Some(in_flight),
        enqueued: enqueued.launched.iter().map(|cell| cell.runs).sum(),
        cells: enqueued.launched,
        unlaunchable,
        early_stop_canceled: board.early_stop_canceled,
    })
}

/// Feed the ladders a job that just reached a terminal state belongs to: every enabled
/// ladder with `autoTopUp` on whose rungs pin the job's case, version, variant and
/// engine, plus the ladder its `origin` names, each topped up as its owner.
///
/// This is what makes a ladder climb by itself. There is no background daemon: the run
/// that finishes is the evidence that may decide a rung, so its arrival is the moment to
/// record the verdict and launch the next rung. The combination is not matched up
/// front — which climbers a ladder has is its board's to resolve — so a ladder whose
/// climbers do not include this job's combination simply finds nothing new to do.
///
/// Never fails: a ladder that cannot be topped up is logged and the rest are still fed,
/// because this runs after a driver's status report is stored and must never be the
/// reason that report fails.
pub(crate) async fn feed_ladders(state: &AppState, job: &test_cabinet_entities::job::Model) {
    let origin = job
        .origin
        .as_deref()
        .and_then(JobOrigin::parse)
        .and_then(|origin| match origin {
            JobOrigin::Ladder(id) => Some(id),
            JobOrigin::Plan(_) => None,
        });
    let engine = job
        .engine_slug
        .as_deref()
        .unwrap_or(test_cabinet_core::engine::NONE_SLUG);
    let ladders = match state
        .db
        .ladders_fed_by(
            &job.test_case_slug,
            &job.test_case_version,
            &job.variant,
            engine,
            origin.as_deref(),
        )
        .await
    {
        Ok(ladders) => ladders,
        Err(err) => {
            tracing::warn!(job = %job.id, error = %err, "could not find the ladders a finished run feeds");
            return;
        }
    };
    for (ladder_id, owner) in ladders {
        match top_up_ladder(state, &owner, &ladder_id, TopUpTrigger::Automatic).await {
            Ok(result) => tracing::info!(
                job = %job.id,
                ladder = %ladder_id,
                enqueued = result.enqueued,
                skipped = ?result.skipped,
                early_stop_canceled = result.early_stop_canceled,
                "topped up a ladder after one of its runs finished"
            ),
            Err(err) => tracing::warn!(
                job = %job.id,
                ladder = %ladder_id,
                error = %err.message,
                "could not top up a ladder after one of its runs finished"
            ),
        }
    }
}

/// Top a ladder up on a task of its own after its owner changed what its climb is —
/// its rungs, its climbers, their steering, a verdict, or its schedule — when it is
/// enabled and has `autoTopUp` on.
///
/// Such an edit can reopen a climb that has nothing in flight: a rung replaced or bumped,
/// a climber promoted past a wall or released from a hold, a combination fixed, a rung
/// or climber added, the in-flight cap raised. No run of the ladder is coming to finish
/// and feed it, so without this the climb would sit still until somebody pressed "Top up
/// now". Spawned rather than awaited, so the edit answers at once and never fails
/// because of the top-up; it runs as an [automatic](TopUpTrigger::Automatic) one, so a
/// rung whose runs keep failing still waits for its owner.
pub(crate) fn spawn_refeed(state: &AppState, user_id: &str, id: &str) {
    let state = state.clone();
    let user_id = user_id.to_string();
    let id = id.to_string();
    tokio::spawn(async move {
        refeed(&state, &user_id, &id, "an edit").await;
    });
}

/// Feed every enabled ladder with `autoTopUp` on once, on a task of its own, as soon
/// as the definition store is servable.
///
/// A ladder is otherwise fed only when something happens to it, and a restart loses
/// some of those moments: the single-box reconciliation fails the jobs a restart
/// orphaned without feeding anyone, and a feed that was spawned but had not finished
/// dies with the process. A ladder left with nothing in flight would then never move
/// again. Topping every such ladder up once at boot puts each back to where its runs
/// say it should be, and costs nothing for one that is already fed: a top-up only
/// launches what is missing. It waits for the store, because a top-up reads the
/// rungs' manifests and an empty store would make every rung look ingestible.
pub(crate) fn spawn_startup_feed(state: AppState) {
    tokio::spawn(async move {
        while !state.ready.is_ready() {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
        let ladders = match state.db.ladders_fed_automatically().await {
            Ok(ladders) => ladders,
            Err(err) => {
                tracing::warn!(error = %err, "could not list the ladders to feed at startup");
                return;
            }
        };
        for (id, owner) in ladders {
            refeed(&state, &owner, &id, "startup").await;
        }
    });
}

/// One automatic top-up of a ladder that is enabled and has `autoTopUp` on, logged
/// rather than returned. `cause` names what prompted it, for the log.
async fn refeed(state: &AppState, user_id: &str, id: &str, cause: &str) {
    match schedule_of(state, user_id, id).await {
        Ok(schedule) if !schedule.paused && schedule.auto_top_up => {}
        Ok(_) => return,
        Err(err) => {
            tracing::warn!(ladder = %id, cause, error = %err.message, "could not read a ladder's schedule to feed it");
            return;
        }
    }
    match top_up_ladder(state, user_id, id, TopUpTrigger::Automatic).await {
        Ok(result) => tracing::info!(
            ladder = %id,
            cause,
            enqueued = result.enqueued,
            skipped = ?result.skipped,
            "topped up a ladder"
        ),
        Err(err) => tracing::warn!(
            ladder = %id,
            cause,
            error = %err.message,
            "could not top up a ladder"
        ),
    }
}

// ---- Scoped review queue ---------------------------------------------------

/// `GET /ladders/{id}/queue` — the completed runs on every rung the climbers have
/// reached that the requesting account has not reviewed, **in the ladder's own order**.
///
/// The queue is there for labelling after the fact — an aesthetic rating, a writeup —
/// and neither blocks nor feeds the climb, which the validators decide. It keeps the
/// ladder's order because a rung's repeats arrive together and are best looked at side
/// by side. 404 when the id is not the caller's.
pub async fn queue(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<CoverageQueue>, ApiError> {
    let board = load_board(&state, &user.0.id, &id, false).await?;
    let cells: Vec<QueueCell<'_>> = board
        .reviewable
        .iter()
        .map(|cell| QueueCell {
            rung_id: Some(cell.rung_id.clone()),
            case: &cell.case,
            member: &cell.member,
            unreviewed: board.ctx.unreviewed_for(&cell.case, &cell.member),
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
        combination_key: climber_key(&input.combination),
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
    spawn_refeed(&state, &user.0.id, &id);
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
    let key = climber_key(&input.combination);
    let now = now()?;

    // A verdict the gate has resolved but no top-up has written down yet has nothing to
    // hang an override on. Record it first — it is derived, so writing it is only
    // materializing what the validator ratings already say — and then override that.
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
        // The override names one member, so it is resolved on its own rather than through a
        // whole board: the gate reads the runs of that member's cell, which for a gg member
        // is not a cell the stored combination alone identifies. A harness member needs no
        // configuration at all, and the read is skipped for it.
        let library =
            read_gg_library(&state, &user.0.id, std::iter::once(&input.combination)).await?;
        let member = resolve_member(&input.combination, &library);
        let runs = rung_runs(&state, &case, &member).await?;
        let target = rung.runs_override.unwrap_or(ladder.runs_per_cell);
        let decided = LadderOutcomeKind::from_gate(gate::evaluate(&runs, target, &ladder.gate))
            .ok_or_else(|| ApiError::conflict("this rung has no verdict yet"))?;
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
    spawn_refeed(&state, &user.0.id, &id);
    Ok(Json(outcome_to_wire(&stored, false, true)))
}

// ---- The board -------------------------------------------------------------

/// One climber's rung, resolved into the cell a top-up or a queue walks.
struct RungCell {
    /// The rung's stable id.
    rung_id: String,
    /// The rung's case, at its pinned version.
    case: ReviewPlanCase,
    /// The resolved climber working it.
    member: PlanMember,
    /// How many runs the rung wants (its override, else the ladder's target).
    target: u32,
    /// Whether the cell's most recent terminal jobs all failed (see
    /// [`FAILING_STREAK`]). Only ever set on a cell a top-up may feed.
    failing: bool,
}

/// Everything one ladder read produces: the board for display, the cells a top-up may
/// feed, the cells a review queue may offer, and the loaded counts all three were
/// derived from.
struct Board {
    /// The dashboard's view.
    progress: LadderProgress,
    /// The current rungs of the climbers still working one, in the ladder's emission
    /// order. Only these are ever **launched** — that is what makes a ladder a ladder
    /// rather than a plan.
    active: Vec<RungCell>,
    /// Every rung every climber has **reached**, in the same order — a wider set than
    /// [`Self::active`], and the one the runs-in-flight cap and the review queue are
    /// measured over. See [`cell_sets`] for why the two differ.
    reviewable: Vec<RungCell>,
    /// The counts the cells were tallied from, kept so a caller can re-derive a demand
    /// without another round-trip.
    ctx: MatrixCtx,
    /// How many not-yet-started jobs this read cancelled because an early-stopping gate
    /// decided their rung. Always `0` on a read that does not record.
    early_stop_canceled: u32,
}

/// What every climber's walk shares: the ladder, what is recorded about it, the counts,
/// and what this read is allowed to do.
struct WalkCtx<'a> {
    state: &'a AppState,
    ladder: &'a StoredLadder,
    /// Every recorded verdict on the ladder.
    recorded: &'a [StoredLadderOutcome],
    /// The run and job counts.
    ctx: &'a MatrixCtx,
    /// Whether verdicts that have become decidable are written down (a top-up), or only
    /// reported (a read).
    record: bool,
    /// Whether each rung, by position, can be climbed at all ([`rung_supported`]).
    supported: &'a [bool],
    /// The cells this ladder still has waiting (`queued` or `pending`) jobs in, read
    /// only when this walk records and the gate stops early — the only case in which a
    /// decided rung's waiting jobs are cancelled.
    waiting: Option<&'a crate::db::CellCounts>,
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
    user_id: &str,
    id: &str,
    record: bool,
) -> Result<Board, ApiError> {
    let ladder = load_ladder(state, user_id, id).await?;
    let schedule = schedule_of(state, user_id, id).await?;
    let buffer_target = resolve_buffer_target(state, user_id, schedule.buffer_target).await?;

    let groups = group_index(state, user_id).await?;
    let library = gg_library(state, user_id).await?;
    let mut combos = resolve_combos(&ladder.combo_group_ids, &ladder.combos, &groups, &library);
    // Only when this read is about to launch. A board that is merely being looked at does not
    // resolve model facts: the resolution can reach out to OpenRouter, and nothing on a read
    // spends anything that a failure would have to be refunded from.
    if record {
        super::coverage::resolve_launch_facts(state, &mut combos).await;
    }
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
    let supported: Vec<bool> = ladder
        .rungs
        .iter()
        .map(|rung| rung_supported(state, rung))
        .collect();
    let waiting = if record && ladder.gate.early_stop {
        Some(
            state
                .db
                .waiting_job_cells(&JobOrigin::Ladder(id.to_string()))
                .await
                .map_err(ApiError::from)?,
        )
    } else {
        None
    };

    let slugs: Vec<String> = ladder.rungs.iter().map(|rung| rung.slug.clone()).collect();
    // A rung's runs are the ones its gate reads, the model's own failures included, so a
    // rung that keeps failing uses up its target instead of relaunching itself.
    let counting = MatrixCounting::Ladder {
        unloaded_counts_as_broken: ladder.gate.unloaded_counts_as_broken,
    };
    let mut ctx = MatrixCtx::load(state, slugs.clone(), user_id, counting).await?;

    let order = climb_order(&combos, &steering);

    let walk = WalkCtx {
        state,
        ladder: &ladder,
        recorded: &recorded,
        ctx: &ctx,
        record,
        supported: &supported,
        waiting: waiting.as_ref(),
    };
    let mut climbers: Vec<LadderClimber> = Vec::with_capacity(combos.len());
    // Where each climber ended up, kept so both cell sets are built from the whole
    // board at once — in the ladder's order rather than the walk's.
    let mut standings: Vec<Standing> = Vec::with_capacity(combos.len());
    let mut climbers_topped_out = 0u32;
    let mut climbers_walled = 0u32;
    let mut climbers_blocked = 0u32;
    let mut early_stop_canceled = 0u32;
    for index in order {
        let member = &combos[index];
        let combo = &member.combo;
        let key = climber_key(combo);
        let steer = steering.get(&key);
        let held = steer.map(|s| s.held).unwrap_or(false);
        let climb = walk_climb(&walk, id, member).await?;
        early_stop_canceled += climb.canceled;

        let status = if held {
            ClimberStatus::Held
        } else {
            climb.status
        };
        match status {
            ClimberStatus::ToppedOut => climbers_topped_out += 1,
            ClimberStatus::Walled => climbers_walled += 1,
            ClimberStatus::Blocked => climbers_blocked += 1,
            _ => {}
        }
        standings.push(Standing {
            index,
            status,
            blocked: climb.blocked.clone(),
            failing: climb.failing,
            current: climb.current.as_ref().map(|current| current.position),
            reached: climb.reached,
        });

        climbers.push(climber_row(
            key,
            member,
            steer,
            status,
            climb.blocked,
            climb.current.map(|current| current.cell),
            climb.outcomes,
        ));
    }

    // Cancelled jobs are no longer in flight. Counting them anyway would hold back the
    // very rung the early decision just opened, so the counts are read again.
    if early_stop_canceled > 0 {
        ctx = MatrixCtx::load(state, slugs, user_id, counting).await?;
    }

    let standings: Vec<ClimberStanding<'_>> = standings
        .iter()
        .map(|standing| ClimberStanding {
            member: &combos[standing.index],
            status: standing.status,
            blocked: standing.blocked.as_ref(),
            failing: standing.failing,
            current: standing.current,
            reached: &standing.reached,
        })
        .collect();
    let (active, reviewable) = cell_sets(&ladder, schedule.outer_axis, &standings);

    // What is still to launch is asked of the cells a top-up may feed: a rung the
    // ladder has moved past is not missing anything, whatever its runs came back as.
    let mut runs_missing = 0u32;
    for cell in &active {
        runs_missing += ctx.demand(cell.target, &cell.case, &cell.member).missing();
    }
    // The runs in flight, in contrast, are measured over every rung a climber has
    // reached: a rung early stop decided may still have a run executing, and that run is
    // spending money the cap exists to bound.
    let mut runs_unreviewed = 0u32;
    let mut runs_in_flight = 0u32;
    for cell in &reviewable {
        let demand = ctx.demand(cell.target, &cell.case, &cell.member);
        runs_unreviewed += demand.unreviewed;
        runs_in_flight += demand.in_flight;
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
                    // it is not flagged: there is nothing for the owner to bump to.
                    stale: !latest_version.is_empty() && latest_version != rung.version,
                    rung: rung_to_wire(rung),
                    position: position as u32,
                    latest_version,
                    supported: supported[position],
                }
            })
            .collect(),
        climbers,
        climbers_topped_out,
        climbers_walled,
        climbers_blocked,
        runs_missing,
        runs_unreviewed,
        runs_in_flight,
        buffer_target,
    };
    Ok(Board {
        progress,
        active,
        reviewable,
        ctx,
        early_stop_canceled,
    })
}

/// Whether a cell's most recent [`FAILING_STREAK`] terminal jobs all failed on
/// infrastructure — no completed (or cancelled) job among them, and none whose run ended
/// on the model's own failure.
///
/// A model failure (catastrophic, timed out, harness error, limit exceeded, hung) is
/// evidence: it uses one of the rung's runs and brings the rung closer to a verdict, so
/// it breaks the streak rather than extending it. A job the backend failed because it
/// restarted is not counted at all (see [`crate::db::Db::recent_terminal_jobs`]).
async fn cell_is_failing(state: &AppState, cell: &CellKey) -> Result<bool, ApiError> {
    let jobs = state
        .db
        .recent_terminal_jobs(cell, u64::from(FAILING_STREAK))
        .await
        .map_err(ApiError::from)?;
    Ok(jobs.len() == FAILING_STREAK as usize
        && jobs
            .iter()
            .all(|job| job.state == "failed" && !job.model_outcome))
}

/// One climber's walk, kept by index into the resolved members until the whole board
/// has been walked.
struct Standing {
    index: usize,
    status: ClimberStatus,
    blocked: Option<ClimberBlock>,
    failing: bool,
    current: Option<usize>,
    reached: Vec<usize>,
}

/// One climber's resolved standing, as the pure cell-set builder needs it: where it
/// stands and everywhere it has been, both as positions in the ladder's rungs.
struct ClimberStanding<'a> {
    /// The resolved climber.
    member: &'a PlanMember,
    /// Where it stands, after any manual hold.
    status: ClimberStatus,
    /// Why it is blocked, when its walk left it blocked (kept under a hold).
    blocked: Option<&'a ClimberBlock>,
    /// Whether the cell of the rung it stands on keeps failing ([`FAILING_STREAK`]),
    /// whether or not anything of it is still in flight.
    failing: bool,
    /// The rung it stands on, or `None` once every rung is cleared.
    current: Option<usize>,
    /// Every rung it has reached, in climb order: the ones it advanced past, and the
    /// one it stands on.
    reached: &'a [usize],
}

/// Whether a top-up may feed a climber in this standing.
///
/// A climbing climber, of course. A blocked one only when the block is one a top-up can
/// act on: a failing rung (a requested top-up relaunches it), or an unlaunchable member
/// (whose demand is zeroed, but whose cell a top-up still reports, so the reason
/// reaches whoever pressed the button). Never a rung that cannot be climbed or one
/// whose runs have all completed.
fn feeds(standing: &ClimberStanding<'_>) -> bool {
    match standing.status {
        ClimberStatus::Climbing => true,
        ClimberStatus::Blocked => matches!(
            standing.blocked,
            Some(ClimberBlock::Failing { .. } | ClimberBlock::Unlaunchable { .. })
        ),
        _ => false,
    }
}

/// Split the climbers' standings into the two cell sets a ladder read produces: the
/// cells a top-up may **feed**, and the cells the runs-in-flight cap and the review
/// queue are measured over.
///
/// The two are deliberately different sets. Feeding is the ladder's economy — only a
/// climber still working a rung is worth spending on, and only on the rung it is
/// working. The second set is every rung a climber has reached: a rung early stop
/// decided may still have a run executing, which the in-flight cap must still count,
/// and a decided rung's completed runs are still worth an aesthetic label.
///
/// Both sets come out in the ladder's emission order and deduplicated by cell, so a
/// ladder that pins one case on two rungs counts and offers its runs once.
fn cell_sets(
    ladder: &StoredLadder,
    axis: LadderAxis,
    standings: &[ClimberStanding<'_>],
) -> (Vec<RungCell>, Vec<RungCell>) {
    // Collected as `(rung position, cell)` so the rung-major axis can be produced by a
    // stable sort on the position alone.
    let mut active: Vec<(usize, RungCell)> = Vec::new();
    let mut reviewable: Vec<(usize, RungCell)> = Vec::new();
    for standing in standings {
        // Only a climber that is actually working a rung contributes a cell to feed. A
        // held, walled, or topped-out climber is not fed, which is the whole economy of
        // a ladder: budget goes where a model is still getting somewhere.
        if feeds(standing)
            && let Some(position) = standing.current
            && let Some(rung) = ladder.rungs.get(position)
        {
            let mut cell = rung_cell(ladder, rung, standing.member);
            cell.failing = standing.failing;
            active.push((position, cell));
        }
        // Everywhere it has been, whatever stopped it. A held climber's runs still run
        // to completion — a hold stops new spending, not what is already in flight.
        for &position in standing.reached {
            if let Some(rung) = ladder.rungs.get(position) {
                reviewable.push((position, rung_cell(ladder, rung, standing.member)));
            }
        }
    }
    (order_cells(active, axis), order_cells(reviewable, axis))
}

/// Put one set of cells into the ladder's emission order and drop repeats.
fn order_cells(mut cells: Vec<(usize, RungCell)>, axis: LadderAxis) -> Vec<RungCell> {
    if axis == LadderAxis::Rung {
        // Bring the whole board up a rung before anyone moves on. A stable sort keeps
        // the steering order within each rung, so priority still decides who goes first
        // among the climbers standing on the same step.
        cells.sort_by_key(|(position, _)| *position);
    }
    // Two rungs may pin the same case, and their runs are one cell however many rungs
    // point at it: counting it twice would inflate the buffer, and offering it twice
    // would ask the reviewer to judge the same run under two headings.
    let mut seen = HashSet::new();
    cells
        .into_iter()
        .map(|(_, cell)| cell)
        .filter(|cell| seen.insert(repeat_key(cell)))
        .collect()
}

/// What makes one cell a repeat of another, for [`order_cells`].
///
/// A cell's runs are counted by its [`cell_key`], which is the identity two rungs pinning
/// one case share. A member that could not be resolved has no launch identity at all, so
/// every unresolvable member of a case carries the same cell key while having no runs for
/// that key to protect. Such a member is kept apart by its own climber key, so a rung
/// carrying two broken configurations is reported as the two climbers it is stuck on
/// rather than as one.
fn repeat_key(cell: &RungCell) -> (CellKey, String) {
    let climber = match &cell.member.unlaunchable {
        Some(_) => climber_key(&cell.member.combo),
        None => String::new(),
    };
    (cell_key(&cell.case, &cell.member), climber)
}

/// The key a climber's steering and its verdicts are stored against.
///
/// Always taken from the member as it would be **stored**, never from the shape a request
/// happened to arrive in. A read hands a client back a gg climber with its configuration's
/// name and its root model filled in ([`ReviewPlanCombo::for_storage`] describes the pair),
/// and echoing that straight back into `POST /ladders/{id}/climbers` or `.../outcomes` has to
/// address the very climber it was read from — otherwise steering a climber the board just
/// showed you would silently mint a second one nothing on the ladder refers to.
///
/// The one function every ladder key goes through, so the board's key, the steering row's,
/// and the verdict's cannot drift apart.
fn climber_key(combo: &ReviewPlanCombo) -> String {
    combination_key(&combo.for_storage())
}

/// One climber's row on the board: its combination, the reviewer's steering, and where the
/// walk left it.
///
/// The row carries the member's [`unlaunchable`](PlanMember::unlaunchable) reason from the
/// same resolution a plan's cells carry it from, so a climber a top-up can never feed says
/// so wherever it is shown.
fn climber_row(
    key: String,
    member: &PlanMember,
    steer: Option<&StoredLadderClimber>,
    status: ClimberStatus,
    blocked: Option<ClimberBlock>,
    current_rung: Option<LadderCell>,
    outcomes: Vec<LadderRungOutcome>,
) -> LadderClimber {
    let combo = &member.combo;
    LadderClimber {
        key,
        harness: combo.harness,
        model: combo.model.clone(),
        provider: combo.provider.clone(),
        gg_config_id: combo.gg_config_id.clone(),
        gg_config_name: combo.gg_config_name.clone(),
        gg_slot_models: combo.gg_slot_models.clone(),
        priority: steer.map(|s| s.priority).unwrap_or(0),
        focused: steer.map(|s| s.focused).unwrap_or(false),
        held: steer.map(|s| s.held).unwrap_or(false),
        unlaunchable: member.unlaunchable.clone(),
        status,
        blocked,
        current_rung,
        outcomes,
    }
}

/// One rung, resolved into the cell its runs are counted, launched, and queued under.
fn rung_cell(ladder: &StoredLadder, rung: &StoredLadderRung, member: &PlanMember) -> RungCell {
    RungCell {
        rung_id: rung.id.clone(),
        case: rung_case(rung),
        member: member.clone(),
        target: rung.runs_override.unwrap_or(ladder.runs_per_cell),
        failing: false,
    }
}

/// The order the ladder feeds its climbers: the reviewer's steering first (higher
/// priority, then focused), with resolved declaration order as the stable tiebreak.
///
/// Returned as indices into `combos` so the caller keeps the resolved list as the single
/// source of truth for what the ladder's members are. A combination with no steering row
/// sorts as priority `0`, unfocused — which is how a model added to a standing ladder
/// takes its place at the back without anyone writing a row for it.
fn climb_order(
    combos: &[PlanMember],
    steering: &HashMap<String, StoredLadderClimber>,
) -> Vec<usize> {
    let mut order: Vec<usize> = (0..combos.len()).collect();
    order.sort_by_key(|&index| {
        let steer = steering.get(&climber_key(&combos[index].combo));
        (
            std::cmp::Reverse(steer.map(|s| s.priority).unwrap_or(0)),
            std::cmp::Reverse(steer.map(|s| s.focused).unwrap_or(false)),
            index,
        )
    });
    order
}

/// Where a climber stands on a rung the gate has not decided, and why.
///
/// `in_flight` is how many of the cell's jobs are still coming, and `failing` whether
/// its most recent terminal jobs all failed. The order of the checks is the order of
/// the fixes: a rung whose runs have all completed is waiting on nothing the ladder can
/// launch, so it is blocked as unrated; otherwise the ladder can feed it — unless its
/// climber cannot be launched or its runs keep failing, and nothing of it is still in
/// flight to change that.
fn undecided_standing(
    tally: &GateTally,
    member: &PlanMember,
    in_flight: u32,
    failing: bool,
) -> (ClimberStatus, Option<ClimberBlock>) {
    if tally.pending == 0 {
        return (
            ClimberStatus::Blocked,
            Some(ClimberBlock::Unrated {
                runs: tally.unrated,
            }),
        );
    }
    if in_flight == 0 {
        if let Some(reason) = &member.unlaunchable {
            return (
                ClimberStatus::Blocked,
                Some(ClimberBlock::Unlaunchable {
                    reason: reason.clone(),
                }),
            );
        }
        if failing {
            return (
                ClimberStatus::Blocked,
                Some(ClimberBlock::Failing {
                    attempts: FAILING_STREAK,
                }),
            );
        }
    }
    (ClimberStatus::Climbing, None)
}

/// Where one climber stands, and how it got there.
struct Climb {
    /// The status the gates imply, before any manual hold is applied.
    status: ClimberStatus,
    /// Why the climber is blocked, when it is.
    blocked: Option<ClimberBlock>,
    /// Whether the cell of the rung it stands on keeps failing.
    failing: bool,
    /// The rung it stands on, or `None` once every rung is cleared.
    current: Option<CurrentRung>,
    /// Every rung it reached, by position, in climb order: the ones it advanced past
    /// and the one it stopped on.
    reached: Vec<usize>,
    /// Its verdicts, in climb order, with superseded-version ones flagged and trailing.
    outcomes: Vec<LadderRungOutcome>,
    /// How many waiting jobs an early-stopping gate cancelled on the way up.
    canceled: u32,
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
///
/// A recorded verdict governs even on a rung that has since become
/// [unsupported](rung_supported), so a climber that advanced past it stays past it. A
/// rung without one that is unsupported stops the walk as `blocked`, decides nothing,
/// and is never launched.
async fn walk_climb(
    walk: &WalkCtx<'_>,
    ladder_id: &str,
    member: &PlanMember,
) -> Result<Climb, ApiError> {
    let ladder = walk.ladder;
    let key = climber_key(&member.combo);
    let mine: Vec<&StoredLadderOutcome> = walk
        .recorded
        .iter()
        .filter(|outcome| outcome.combination_key == key)
        .collect();

    let mut outcomes: Vec<LadderRungOutcome> = Vec::new();
    let mut current: Option<CurrentRung> = None;
    let mut reached: Vec<usize> = Vec::new();
    let mut status = ClimberStatus::ToppedOut;
    let mut blocked: Option<ClimberBlock> = None;
    let mut failing = false;
    // The cases of every rung the walk found decided, whose waiting jobs an early stop
    // cancels once the walk knows where the climber stands.
    let mut decided: Vec<ReviewPlanCase> = Vec::new();

    for (position, rung) in ladder.rungs.iter().enumerate() {
        // Reaching a rung is what the loop iterating over it means, whether the climber
        // goes on to clear it, wall on it, or still be working on it.
        reached.push(position);
        let case = rung_case(rung);
        // A verdict recorded against the version the rung pins *now* governs the climb;
        // one recorded against a version it used to pin is history, appended below.
        let at_pin = mine
            .iter()
            .find(|outcome| outcome.rung_id == rung.id && outcome.decided_version == rung.version);
        if let Some(stored) = at_pin.copied() {
            decided.push(case);
            outcomes.push(outcome_to_wire(stored, false, true));
            if stored.effective() == LadderOutcomeKind::Advanced {
                continue;
            }
            status = ClimberStatus::Walled;
            current = Some(rung_state(walk, position, rung, member, GateOutcome::Wall).await?);
            break;
        }

        if !walk.supported.get(position).copied().unwrap_or(true) {
            status = ClimberStatus::Blocked;
            blocked = Some(ClimberBlock::UnsupportedRung {
                rung_id: rung.id.clone(),
            });
            current = Some(rung_state(walk, position, rung, member, GateOutcome::Undecided).await?);
            break;
        }

        let runs = rung_runs(walk.state, &case, member).await?;
        let target = rung.runs_override.unwrap_or(ladder.runs_per_cell);
        let tally = gate::tally(&runs, target, &ladder.gate);
        let outcome = gate::evaluate(&runs, target, &ladder.gate);
        if walk.record
            && let Some(kind) = LadderOutcomeKind::from_gate(outcome)
        {
            walk.state
                .db
                .record_ladder_outcome(ladder_id, &rung.id, &key, &rung.version, kind, &now()?)
                .await
                .map_err(ApiError::from)?;
        }
        match outcome {
            GateOutcome::Advance => {
                decided.push(case);
                outcomes.push(live_outcome(rung, LadderOutcome::Advanced, &now()?));
                continue;
            }
            GateOutcome::Wall => {
                decided.push(case.clone());
                outcomes.push(live_outcome(rung, LadderOutcome::Walled, &now()?));
                status = ClimberStatus::Walled;
            }
            GateOutcome::Undecided => {
                let in_flight = walk.ctx.demand(target, &case, member).in_flight;
                // Read only where it can matter: a rung with runs still to complete, for
                // a climber that can be launched at all.
                failing = tally.pending > 0
                    && member.unlaunchable.is_none()
                    && cell_is_failing(walk.state, &cell_key(&case, member)).await?;
                (status, blocked) = undecided_standing(&tally, member, in_flight, failing);
            }
        }
        current = Some(CurrentRung {
            position,
            cell: LadderCell {
                rung_id: rung.id.clone(),
                position: position as u32,
                cell: walk.ctx.cell(target, &case, member),
                tally: RungTally::from_gate(tally),
                outcome,
            },
        });
        break;
    }

    // A ladder may pin one case on two rungs, and the two then share a cell. A decided
    // rung's waiting jobs are only spare when that cell is not also the undecided rung
    // the climber now stands on: those jobs are that rung's runs, and cancelling them
    // would starve it on every pass.
    let standing_on = match (&current, status) {
        (Some(on), ClimberStatus::Climbing | ClimberStatus::Blocked) => ladder
            .rungs
            .get(on.position)
            .map(|rung| cell_key(&rung_case(rung), member)),
        _ => None,
    };
    let mut canceled = 0u32;
    let mut swept: Vec<CellKey> = Vec::new();
    for case in &decided {
        let key = cell_key(case, member);
        if standing_on.as_ref() == Some(&key) || swept.contains(&key) {
            continue;
        }
        canceled += cancel_decided_waiting(walk, ladder_id, case, member).await?;
        swept.push(key);
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
        blocked,
        failing,
        current,
        reached,
        outcomes,
        canceled,
    })
}

/// Cancel this ladder's jobs of one decided cell that have not started yet, when the
/// gate stops early and the walk records. Returns how many were cancelled.
///
/// Reaches only `queued` and `pending` jobs whose origin is this ladder, in this one
/// cell: a job already dispatched or running finishes and its run is kept, and a
/// hand-launched job or another plan's job of the same cell is never touched. A cell
/// with nothing waiting costs nothing, since the walk was handed the waiting cells up
/// front. A cancelled job feeds no ladder, so this cannot loop.
async fn cancel_decided_waiting(
    walk: &WalkCtx<'_>,
    ladder_id: &str,
    case: &ReviewPlanCase,
    member: &PlanMember,
) -> Result<u32, ApiError> {
    let Some(waiting) = walk.waiting else {
        return Ok(0);
    };
    let key = cell_key(case, member);
    if waiting.get(&key).copied().unwrap_or(0) == 0 {
        return Ok(0);
    }
    let origin = JobOrigin::Ladder(ladder_id.to_string());
    crate::api::jobs::sweep_cancel(
        walk.state,
        &JobCancelFilter {
            states: &CANCELABLE_WAITING_STATES,
            origin: Some(&origin),
            user_id: None,
            cell: Some(&key),
            ids: None,
        },
        "canceled: the ladder's gate decided this rung early",
    )
    .await
}

/// The cell for a rung the walk stopped on without evaluating it live — a recorded
/// wall, or a rung that cannot be climbed — so the dashboard still shows its evidence.
async fn rung_state(
    walk: &WalkCtx<'_>,
    position: usize,
    rung: &StoredLadderRung,
    member: &PlanMember,
    outcome: GateOutcome,
) -> Result<CurrentRung, ApiError> {
    let case = rung_case(rung);
    let runs = rung_runs(walk.state, &case, member).await?;
    let target = rung.runs_override.unwrap_or(walk.ladder.runs_per_cell);
    Ok(CurrentRung {
        position,
        cell: LadderCell {
            rung_id: rung.id.clone(),
            position: position as u32,
            cell: walk.ctx.cell(target, &case, member),
            tally: RungTally::from_gate(gate::tally(&runs, target, &walk.ladder.gate)),
            outcome,
        },
    })
}

/// The gate's evidence for one `rung × combination` cell: the validators' own rating of
/// every completed run of it, and every run of it that ended on the model's own failure
/// (as a broken run), oldest first.
///
/// Never `run.rating`, which folds in every reviewer's checklist overrides, and never a
/// review: a ladder's climb is decided by its validators, whoever looks at its runs.
///
/// A validator-rated run that carries no rating yet — stored before the column existed,
/// on a deployment whose definition store was still empty when the startup backfill
/// ran — is rated here from its record and the store's manifest, and the evidence read
/// again, so such a run never stays unrated for longer than the store lacks its version.
async fn rung_runs(
    state: &AppState,
    case: &ReviewPlanCase,
    member: &PlanMember,
) -> Result<Vec<RungRun>, ApiError> {
    let key = cell_key(case, member);
    let mut runs = state
        .db
        .cell_run_ratings(&key)
        .await
        .map_err(ApiError::from)?;
    let unrated: Vec<String> = runs
        .iter()
        .filter(|run| !run.model_failure && run.validator_rated && run.rating.is_none())
        .map(|run| run.run_id.clone())
        .collect();
    if !unrated.is_empty()
        && state
            .db
            .backfill_validator_rating(&state.store, Some(&unrated))
            .await
            .map_err(ApiError::from)?
            > 0
    {
        runs = state
            .db
            .cell_run_ratings(&key)
            .await
            .map_err(ApiError::from)?;
    }
    Ok(runs.iter().map(|run| run.as_rung_run()).collect())
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
        engine: rung.engine.clone(),
    }
}

/// A stored rung on the wire.
fn rung_to_wire(rung: &StoredLadderRung) -> LadderRung {
    LadderRung {
        id: rung.id.clone(),
        slug: rung.slug.clone(),
        version: rung.version.clone(),
        variant: rung.variant.clone(),
        engine: rung.engine.clone(),
        runs: rung.runs_override,
    }
}

/// A stored ladder on the wire, its one-off climbers filled in from `configs`.
///
/// What is stored is a pointer — a configuration id and its slot bindings — so every read
/// resolves it, which is what lets a client that has never fetched `/gg/configs` render a
/// climber and what makes a renamed configuration rename it everywhere at once.
fn ladder_to_wire(stored: StoredLadder, library: &GgLibrary) -> Ladder {
    Ladder {
        id: stored.id,
        name: stored.name,
        runs_per_cell: stored.runs_per_cell,
        gate: stored.gate,
        combo_group_ids: stored.combo_group_ids,
        combos: for_read(&stored.combos, library),
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
/// check — a rung whose case version no gate can ever resolve — needs the definition
/// store and lives in [`reject_ineligible_rungs`], so this stays pure.
fn ladder_from_input(
    id: String,
    input: LadderInput,
    updated_at: &str,
) -> Result<StoredLadder, ApiError> {
    if input.rungs.is_empty() {
        return Err(ApiError::bad_request("a ladder needs at least one rung"));
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
                "rung id `{rung_id}` is listed twice"
            )));
        }
        seen_ids.push(rung_id.clone());
        rungs.push(StoredLadderRung {
            id: rung_id,
            slug: rung.slug,
            version: rung.version,
            variant: rung.variant,
            engine: rung.engine,
            runs_override: rung.runs.map(clamp_runs_per_cell),
        });
    }

    Ok(StoredLadder {
        id,
        name: input.name,
        runs_per_cell: clamp_runs_per_cell(input.runs_per_cell),
        gate: sanitize_gate(input.gate.unwrap_or_default()),
        combo_group_ids: input.combo_group_ids,
        // Normalized on the way in, exactly as a group's and a plan's members are: a gg
        // climber is the configuration it names and the models it binds, and a console that
        // saved back what it had just read would otherwise store the name and the root model
        // as they stood at that moment and go on reporting them forever.
        combos: for_storage(input.combos),
        rungs,
        updated_at: updated_at.to_string(),
    })
}

/// Why a rung's case version can never be climbed, or `None` when it can (or when the
/// store does not hold the version, which is allowed — see [`reject_ineligible_rungs`]).
///
/// The test-type checks come first, so a game jam (which is never validator-rated
/// either) is named for the more specific cause.
fn rung_ineligibility(state: &AppState, rung: &StoredLadderRung) -> Option<String> {
    let manifest = state.store.read_manifest(&rung.slug, &rung.version).ok()?;
    if RUNG_INELIGIBLE_TEST_TYPES.contains(&manifest.test_type) {
        let reason = match manifest.test_type {
            TestType::Performance => {
                "it is graded on its own scale and records no functional rating"
            }
            _ => "it is reviewed on a graded category scale and records no domain rating",
        };
        return Some(format!(
            "`{}` is a {} case and cannot be a ladder rung: {reason}. Use a coverage plan \
             for it instead.",
            rung.slug,
            manifest.test_type.as_str()
        ));
    }
    if !manifest.validator_rated() {
        return Some(format!(
            "`{}` {} is a legacy case version and cannot be a ladder rung: its runs are \
             rated only by a reviewer, and a ladder's gate reads validator ratings. Pick a \
             validator-rated version, or use a coverage plan.",
            rung.slug, rung.version
        ));
    }
    None
}

/// Whether a ladder can climb a stored rung: false when the store holds its case version
/// and that version is a legacy, performance, or game-jam one. Saving a ladder refuses
/// such a rung, but one stored before the check existed (or before its version was
/// re-ingested as something else) stays readable: it is reported unsupported, never
/// launched, and blocks a climber that reaches it without a recorded verdict.
fn rung_supported(state: &AppState, rung: &StoredLadderRung) -> bool {
    rung_ineligibility(state, rung).is_none()
}

/// Refuse any rung whose case version can never be climbed, naming the cause: a
/// performance or game-jam case, or a legacy version whose runs only a reviewer rates.
///
/// A case version that is not ingested is **allowed**: whether it resolves at all is the
/// driver's call at run time, and it reports that far better than an author-time guess
/// would. The check is a guard against a silent stall, not a second catalog. It runs on
/// every save, so an existing ladder that still holds such a rung is refused until the
/// edit replaces it.
fn reject_ineligible_rungs(state: &AppState, rungs: &[StoredLadderRung]) -> Result<(), ApiError> {
    match rungs
        .iter()
        .find_map(|rung| rung_ineligibility(state, rung))
    {
        Some(reason) => Err(ApiError::bad_request(reason)),
        None => Ok(()),
    }
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

#[cfg(test)]
#[path = "ladders.flow.test.rs"]
mod flow_tests;
