//! Ladders: an **ordered, gated** climb through a series of test cases, and the
//! combinations that climb it.
//!
//! A [coverage plan](super::coverage) asks "run every one of these cases on every one
//! of these models until each cell has N runs". A ladder asks a different question:
//! *how far up does this model get?* Its cases are an ordered series of **rungs**, its
//! combinations are **climbers**, and a climber only reaches the next rung by clearing
//! the current one. A climber is either shape a
//! [combination](super::coverage::ReviewPlanCombo) takes, so a saved gg configuration
//! climbs beside a third-party harness and is measured against the same gate.
//!
//! ## A configuration and its dispatch
//!
//! A ladder is a **configuration** and does nothing by itself. `POST /ladders/{id}/run`
//! starts a **dispatch** of it: a snapshot of the rungs (with their resolved targets),
//! the gate, the climb order and the runs-in-flight limit in force, plus the climbers
//! resolved at that moment. Editing the configuration never touches a running dispatch.
//! A ladder keeps only its latest dispatch; a Run after it ended replaces it.
//!
//! A dispatch **counts runs as a plan does**: a rung and a climber form one coverage cell,
//! and the slot's runs are the first `target` counted runs of that cell to land, whoever
//! launched them ([`crate::db::Db::counted_runs_by_cell`]). Its gate, its progress and its
//! queue read those, so a pass launches only what a rung is missing, a rung the existing
//! runs already fill is decided with nothing launched, and two rungs pinning one case read
//! the same runs. Every job a dispatch launches carries the origin
//! `ladder:<ladder>/<dispatch>/<rung>`, which is what its limit, its Stop and its failing
//! block act on ([`crate::db::Db::dispatch_evidence`]) and no part of what counts.
//!
//! ## The gate
//!
//! There is exactly **one** rule, parameterised — never a set of modes. It lives in
//! [`crate::coverage::gate`], which owns the arithmetic, the unloaded-build shortcut, the
//! runs still in flight, and the "not decided yet" answer. This module gathers the
//! evidence for it and records what it decided: a recorded verdict stands for the rest
//! of the dispatch.
//!
//! ## Launch passes
//!
//! The backend climbs a running dispatch by itself, in **launch passes** run through the
//! shared [`super::launch`] loop: on Run, on a climber's Retry, whenever a job of one of
//! its slots' cells finishes ([`dispatches_fed_by`]), and once at startup. A pass records
//! every verdict the gate can now decide and launches each climber's current rung, up to
//! the dispatch's limit. Only a climber's **current** rung is ever launched — that is
//! what makes a ladder a ladder rather than a plan. Reviews are labels added after the
//! fact and never gate or move a climb.
//!
//! Console-only reviewer tooling, like the rest of the coverage surface.

use std::collections::{BTreeMap, HashMap};

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};

use test_cabinet_core::run_record::HarnessSlug;
use test_cabinet_core::test_case::TestType;

use crate::auth::AuthUser;
use crate::coverage::gate::{self, Gate, GateTally, GateThreshold, RungRun};
use crate::coverage::schedule::{CellDemand, InFlightLimit, launch_pass};
use crate::db::{
    CANCELABLE_ACTIVE_STATES, CANCELABLE_WAITING_STATES, CellCounts, CellKey, CellRun, CellRuns,
    DispatchEvidence, JobCancelFilter, JobOrigin, LadderOutcomeKind, OriginScope, SlotKey,
    StoredDispatch, StoredDispatchClimber, StoredLadder, StoredLadderRung, TerminalJob,
    combination_key,
};
use crate::error::ApiError;

use super::AppState;
use super::coverage::{
    BlockedCell, CoverageQueue, CoverageQueueEntry, GgLibrary, HaltResult, LaunchCell,
    LaunchPassResult, LaunchSkipped, MAX_QUEUE_RUNS, MemberCellIdentity, PlanMember,
    ReviewPlanCase, ReviewPlanCombo, blocked_cell, blocked_reason, blocking_job,
    cancel_just_enqueued, cell_in_flight, cell_key_of, cell_runs, clamp_in_flight_limit,
    clamp_retry_count, clamp_runs_per_cell, default_retry_count, enqueue_launches, for_read,
    for_storage, gg_library, group_index, halt_jobs, harness_lane, job_cell, launchable_demand,
    new_id, now, read_gg_library, reject_unstorable_members, resolve_combos,
    resolve_in_flight_limit, resolve_launch_facts, resolve_member,
};
use super::launch::{LaunchTarget, run_launch_passes, spawn_launch};

/// The most rungs one ladder may hold. A ladder is a curated progression a reviewer
/// reads top to bottom, not a sweep — past a few dozen steps it is a coverage plan
/// wearing a costume, and every climber's walk grows with it.
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
/// Both are rejected when a ladder is saved and again when it is run, with an explicit
/// message rather than a silent stall later. A **legacy** case version is refused on the
/// same grounds by [`rung_ineligibility`]: only a reviewer rates its runs, and a
/// ladder's gate reads validator ratings.
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

/// A ladder's **configuration**: the climb, the climbers, the rule every rung is judged
/// by, and how a dispatch of it is fed. What a dispatch did is [`LadderProgress`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct Ladder {
    /// The ladder's opaque id (minted on create).
    pub id: String,
    /// The reviewer-chosen display name.
    pub name: String,
    /// The default target number of runs for each rung slot; a rung may raise it for
    /// itself via [`LadderRung::runs`].
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
    /// Which axis a dispatch's launch order nests on.
    pub outer_axis: LadderAxis,
    /// This ladder's override of the account's runs-in-flight limit, or null to inherit
    /// it. A dispatch resolves it when it starts and keeps it.
    #[serde(default)]
    pub in_flight_limit: Option<InFlightLimit>,
    /// How many automatic retries each run a dispatch launches gets, `0..=10`. A launch
    /// that uses them up without a counted run blocks its climber. A dispatch takes it
    /// when it starts and keeps it.
    #[serde(default = "default_retry_count")]
    pub retry_count: u32,
    /// RFC 3339 of when the ladder was last saved.
    pub updated_at: String,
}

/// The create/update body for a ladder (the server assigns `id` and `updatedAt`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LadderInput {
    /// The reviewer-chosen display name.
    pub name: String,
    /// The default target number of runs for each rung slot.
    pub runs_per_cell: u32,
    /// The rule every rung is decided by, or null for [`Gate::default`] — the gentlest
    /// gate that still stops a hopeless climb (pass as long as one run was playable at
    /// all).
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
    /// Which axis a dispatch's launch order nests on.
    #[serde(default)]
    pub outer_axis: LadderAxis,
    /// This ladder's override of the account's runs-in-flight limit, or null to inherit.
    #[serde(default)]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub in_flight_limit: Option<InFlightLimit>,
    /// How many automatic retries each run a dispatch launches gets, or null for the
    /// default of one. Clamped to the most the backend honours for any launch.
    #[serde(default)]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub retry_count: Option<u32>,
}

/// Where a ladder's latest dispatch stands. A ladder never run has no dispatch, which
/// the console reads as "Not run yet".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum DispatchStatus {
    /// Launch passes are still climbing it.
    Running,
    /// It is running and waiting on its owner: none of its jobs is in flight, every
    /// climber is completed, failed or blocked, and at least one is blocked. A reading of
    /// a running dispatch, derived whenever its status is reported and never stored: a
    /// climber's Retry or a run arriving for one of its slots makes it `running` again.
    NeedsAttention,
    /// Every climber completed or failed and none of its runs is in flight.
    Finished,
    /// Its owner stopped it. It launches nothing more.
    Stopped,
}

impl DispatchStatus {
    /// The stored token. A dispatch that needs attention is stored as the running
    /// dispatch it is.
    fn as_str(self) -> &'static str {
        match self {
            DispatchStatus::Running | DispatchStatus::NeedsAttention => "running",
            DispatchStatus::Finished => "finished",
            DispatchStatus::Stopped => "stopped",
        }
    }

    /// Parse a stored token, which is never [`NeedsAttention`](Self::NeedsAttention).
    /// Anything unknown reads as ended: a dispatch nobody can recognise as running must
    /// not keep launching.
    fn parse(token: &str) -> Self {
        match token {
            "running" => DispatchStatus::Running,
            "finished" => DispatchStatus::Finished,
            _ => DispatchStatus::Stopped,
        }
    }
}

/// Where one **rung slot** — one climber on one rung of a dispatch — stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum SlotStatus {
    /// The climber's current rung, undecided, with runs launched or waiting for room.
    Running,
    /// The climber's current rung, undecided and blocked.
    Blocked,
    /// The gate passed it.
    Passed,
    /// The gate failed it.
    Failed,
    /// Not reached yet, while the dispatch is running.
    Pending,
    /// Never to run: the climber failed an earlier rung, or the dispatch was stopped.
    Skipped,
}

/// Where one climber of a dispatch stands.
///
/// There is no "waiting on a review" state: the validators rate every completed run, so
/// a rung the dispatch can still feed is `running`, and one nothing it does can move is
/// `blocked`, with the reason in [`LadderClimber::blocked`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum ClimberStatus {
    /// The current rung is undecided and its runs can still launch.
    Running,
    /// The current rung is undecided and nothing the dispatch does will move it. Why,
    /// and what fixes it, is [`LadderClimber::blocked`].
    Blocked,
    /// The current rung was failed. The validators are assumed correct, so this is the
    /// climber's result.
    Failed,
    /// Every rung passed. There is nothing left to climb.
    Completed,
}

/// Why a climber is [`blocked`](ClimberStatus::Blocked), each reason naming its fix.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum ClimberBlock {
    /// The combination cannot be launched at all, and nothing of its rung is in flight.
    /// Fix: fix the cause, then retry the climber, which resolves it again.
    Unlaunchable {
        /// Why, in the words the launch pass reports it with.
        reason: String,
    },
    /// A job the dispatch launched for the rung slot used up its automatic retries
    /// without a counted run, no later launch of the dispatch took its place, and
    /// nothing of the slot is in flight. Fix: fix the
    /// cause, then retry the climber (`POST /ladders/{id}/climbers/retry`), which
    /// relaunches it.
    Failing {
        /// How many attempts that launch made: the first, and each automatic retry.
        attempts: u32,
    },
    /// Every run the rung will get has completed and the rung is still undecided,
    /// because `runs` of them carry no validator rating (pushed while the backend did
    /// not hold the case version). Fix: re-push the runs, or stop the dispatch.
    Unrated {
        /// How many of the rung's counted runs carry no validator rating.
        runs: u32,
    },
}

/// How many of a dispatch's rung slots are in each [`SlotStatus`].
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct SlotCounts {
    /// Every rung slot: climbers × rungs.
    pub total: u32,
    /// Slots `running`.
    pub running: u32,
    /// Slots `blocked`.
    pub blocked: u32,
    /// Slots `passed`.
    pub passed: u32,
    /// Slots `failed`.
    pub failed: u32,
    /// Slots `pending`.
    pub pending: u32,
    /// Slots `skipped`.
    pub skipped: u32,
}

impl SlotCounts {
    /// Count one slot.
    fn add(&mut self, status: SlotStatus) {
        self.total += 1;
        match status {
            SlotStatus::Running => self.running += 1,
            SlotStatus::Blocked => self.blocked += 1,
            SlotStatus::Passed => self.passed += 1,
            SlotStatus::Failed => self.failed += 1,
            SlotStatus::Pending => self.pending += 1,
            SlotStatus::Skipped => self.skipped += 1,
        }
    }
}

/// How much of a dispatch's execution is behind it: the figures its progress bar is
/// drawn from.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct DispatchRuns {
    /// The sum over rung slots of the rung's target runs.
    pub total: u32,
    /// The runs that need no more executing, summed per slot: a passed, failed or
    /// skipped slot's whole target less the runs the dispatch still has in flight for
    /// it, a running or blocked slot's runs, and nothing of a pending one. A run that
    /// existed before the dispatch started is done from its first pass. Equal to
    /// `total` once nothing is left to execute.
    pub done: u32,
    /// The jobs the dispatch launched that are still in flight (`queued` through
    /// `running`).
    pub in_flight: u32,
}

/// A ladder's latest dispatch, as its board reports it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LadderDispatch {
    /// The dispatch's id: the second segment of its jobs' origins.
    pub id: String,
    /// Where it stands.
    pub status: DispatchStatus,
    /// RFC 3339 of the Run that started it.
    pub started_at: String,
    /// RFC 3339 of when it finished or was stopped, absent while running.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub ended_at: Option<String>,
    /// The gate, as it stood at Run.
    pub gate: Gate,
    /// The climb order, as it stood at Run.
    pub outer_axis: LadderAxis,
    /// The runs-in-flight limit resolved at Run.
    pub in_flight_limit: InFlightLimit,
    /// The retry limit, as it stood at Run: how many automatic retries each run the
    /// dispatch launches gets.
    pub retry_count: u32,
    /// The rung-slot counts.
    pub slots: SlotCounts,
    /// The runs: total, done, in flight.
    pub runs: DispatchRuns,
    /// How many climbers are running.
    pub climbers_running: u32,
    /// How many climbers are blocked.
    pub climbers_blocked: u32,
    /// How many climbers failed a rung.
    pub climbers_failed: u32,
    /// How many climbers passed every rung.
    pub climbers_completed: u32,
}

/// The counts one gate answer was made from, so a dashboard can say *why* a slot passed,
/// failed, or is still running without re-deriving the floor and unloaded-run rules.
///
/// The wire mirror of [`GateTally`], which is an internal type of the pure core.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct RungTally {
    /// The slot's counted runs: finished runs that are the model's result.
    pub counted: u32,
    /// Counted runs the gate has a rating for — carrying a validator rating, or
    /// decided as broken because the build never loaded or the model failed.
    pub rated: u32,
    /// Counted runs with no validator rating.
    pub unrated: u32,
    /// Rated runs rated at or above the gate's floor.
    pub passing: u32,
    /// Runs the slot will still finish with: `max(target, counted + inFlight) − counted`.
    pub pending: u32,
    /// The slot's jobs still in flight.
    pub in_flight: u32,
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
            counted: tally.counted,
            rated: tally.rated,
            unrated: tally.unrated,
            passing: tally.passing,
            pending: tally.pending,
            in_flight: tally.in_flight,
            required: tally.required_runs(),
        }
    }
}

/// One rung slot of one climber.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LadderSlot {
    /// Which rung, by its stable id.
    pub rung_id: String,
    /// The rung's position in the climb, from zero.
    pub position: u32,
    /// Where the slot stands.
    pub status: SlotStatus,
    /// The gate evidence behind the slot's answer: present on a slot that has been
    /// reached or has runs.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub tally: Option<RungTally>,
    /// RFC 3339 of when the gate decided the slot, on a passed or failed slot. A verdict
    /// a read computed live, which the next launch pass records, carries the read's time.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub decided_at: Option<String>,
    /// The slot's runs, oldest first: the first runs of its cell to finish, up to the
    /// rung's target, whoever launched them. Empty on a slot the climber has not
    /// reached.
    pub run_ids: Vec<String>,
    /// The jobs the dispatch launched for this slot that are still in flight, in queue
    /// order. The tally's `inFlight` also counts a job of the cell someone else
    /// launched, so it can exceed these.
    pub job_ids: Vec<String>,
}

/// One climber of a dispatch and its whole standing.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LadderClimber {
    /// The combination's canonical key — the text the dispatch records this climber's
    /// state against.
    ///
    /// Its shape follows the shape of the combination: a harness climber's key is its
    /// `harness|model|provider` triple, and a gg climber's names the configuration and the
    /// models it binds, because two climbers running one configuration on different models
    /// are exactly the two arms a ladder exists to separate. It is written and compared,
    /// never parsed.
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
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub gg_config_id: Option<String>,
    /// That configuration's current display name, or null on a harness climber.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub gg_config_name: Option<String>,
    /// The model bound to each of the configuration's launch slots, keyed by slot name.
    /// Empty on a harness climber.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub gg_slot_models: BTreeMap<String, String>,
    /// Why this climber cannot be launched at all, or null when it can.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub unlaunchable: Option<String>,
    /// Where the climber stands.
    pub status: ClimberStatus,
    /// Why the climber is blocked, naming the fix, or null when it is not.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub blocked: Option<ClimberBlock>,
    /// The position of the rung it stands on (or failed), absent once it completed.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub current_rung: Option<u32>,
    /// One slot per rung of the dispatch, in rung order.
    pub slots: Vec<LadderSlot>,
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
    /// Whether the pinned version is not the newest ingested one.
    pub stale: bool,
}

/// The ladder's board: the rungs, its latest dispatch, and every climber of it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LadderProgress {
    /// The ladder's id.
    pub ladder_id: String,
    /// The latest dispatch, or null for a ladder never run.
    pub dispatch: Option<LadderDispatch>,
    /// The rungs, low to high: the dispatch's when there is one, else the
    /// configuration's.
    pub rungs: Vec<LadderProgressRung>,
    /// Every climber of the dispatch, in its resolved order. Empty without one.
    pub climbers: Vec<LadderClimber>,
    /// The completed runs among the dispatch's slots' runs that the requester has not
    /// reviewed — exactly what `GET /ladders/{id}/queue` offers. Information only.
    pub runs_unreviewed: u32,
}

/// One ladder on the ladders list: its configuration's headline and its latest
/// dispatch's totals.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LadderSummary {
    /// The ladder's id.
    pub id: String,
    /// Its display name.
    pub name: String,
    /// How many rungs the configuration holds.
    pub rungs: u32,
    /// The configuration's runs per rung slot.
    pub runs_per_cell: u32,
    /// How many climbers the configuration resolves to now.
    pub climbers: u32,
    /// The latest dispatch, or null for a ladder never run.
    pub dispatch: Option<LadderDispatchSummary>,
}

/// A dispatch's totals, for the ladders list.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LadderDispatchSummary {
    /// The dispatch's id.
    pub id: String,
    /// Where it stands.
    pub status: DispatchStatus,
    /// RFC 3339 of the Run.
    pub started_at: String,
    /// RFC 3339 of when it ended, absent while running.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub ended_at: Option<String>,
    /// The rung-slot counts, for the whole ladder.
    pub slots: SlotCounts,
    /// The runs: total, done, in flight.
    pub runs: DispatchRuns,
}

/// The `POST /ladders/{id}/stop` body.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LadderStopInput {
    /// Whether to cancel the dispatch's `dispatched`, `starting` and `running` jobs as
    /// well as its waiting ones. Those are partly or wholly paid for, so a client
    /// confirms first.
    #[serde(default)]
    pub cancel_running: bool,
}

/// The `POST /ladders/{id}/climbers/retry` body: the climber to retry.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LadderRetryInput {
    /// Which climber, in either shape and either — stored or read — form: the key is
    /// taken from the member as it would be stored, so a climber read off the board can
    /// be handed straight back.
    pub combination: ReviewPlanCombo,
}

/// The `POST /ladders/{id}/rungs/order` body: the rungs' stable ids in their new
/// climb order.
///
/// Ids rather than a list of rungs, because a reorder must not be able to edit a rung
/// in passing.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LadderRungOrderInput {
    /// Every one of the ladder's rung ids, in the new order. Must be a permutation of
    /// what the ladder currently holds: a reorder that adds or drops a rung is an edit,
    /// and edits go through `PUT /ladders/{id}` where the consequences are visible.
    pub rung_ids: Vec<String>,
}

/// The configuration a dispatch runs, as it stood at Run. Stored as JSON on the
/// dispatch row; never on the wire as such.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DispatchSnapshot {
    /// The rungs, low to high, each with its resolved target.
    rungs: Vec<SnapshotRung>,
    /// The gate.
    gate: Gate,
    /// The climb order.
    outer_axis: LadderAxis,
    /// The runs-in-flight limit in force at Run.
    in_flight_limit: InFlightLimit,
    /// How many automatic retries each run the dispatch launches gets. A snapshot taken
    /// before the configuration held one reads the default.
    #[serde(default = "default_retry_count")]
    retry_count: u32,
    /// The configuration's runs per rung slot (informational: targets are resolved).
    runs_per_cell: u32,
}

/// One rung of a [`DispatchSnapshot`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotRung {
    /// The rung's stable id.
    id: String,
    /// The test-case slug.
    slug: String,
    /// The pinned, exact version.
    version: String,
    /// The variant.
    variant: String,
    /// The engine, or `None` for `none`.
    #[serde(default)]
    engine: Option<String>,
    /// The rung's own runs override, as configured.
    #[serde(default)]
    runs: Option<u32>,
    /// The runs the rung's slots target: its override, else the ladder's.
    target: u32,
}

impl SnapshotRung {
    /// The rung as a pinned case.
    fn case(&self) -> ReviewPlanCase {
        ReviewPlanCase {
            slug: self.slug.clone(),
            version: self.version.clone(),
            variant: self.variant.clone(),
            engine: self.engine.clone(),
        }
    }

    /// The rung on the wire.
    fn to_wire(&self) -> LadderRung {
        LadderRung {
            id: self.id.clone(),
            slug: self.slug.clone(),
            version: self.version.clone(),
            variant: self.variant.clone(),
            engine: self.engine.clone(),
            runs: self.runs,
        }
    }
}

// ---- Configuration ---------------------------------------------------------

/// `GET /ladders` — every ladder configuration the token account owns.
pub async fn list(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<Vec<Ladder>>, ApiError> {
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
    Ok(Json(
        stored
            .into_iter()
            .map(|ladder| ladder_to_wire(ladder, &library))
            .collect(),
    ))
}

/// `GET /ladders/{id}` — one ladder's configuration. 404 when the id is not the
/// caller's.
pub async fn get(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<Ladder>, ApiError> {
    let stored = load_ladder(&state, &user.0.id, &id).await?;
    let library = read_gg_library(&state, &user.0.id, stored.combos.iter()).await?;
    Ok(Json(ladder_to_wire(stored, &library)))
}

/// `POST /ladders` — create a ladder configuration. Targets are clamped, the gate is
/// sanitized, and every rung's case type is checked so a rung that could never resolve
/// is refused up front.
///
/// A climber is refused on the same terms a plan's member is (`400`, naming the
/// configuration and the slot). Saving launches nothing: a ladder runs only when its
/// owner presses Run.
pub async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Json(input): Json<LadderInput>,
) -> Result<Json<Ladder>, ApiError> {
    let library = reject_unstorable_members(&state, &user.0.id, &input.combos, &[]).await?;
    let stored = ladder_from_input(new_id(), input, &now()?)?;
    reject_ineligible_rungs(&state, &stored.rungs)?;
    state
        .db
        .insert_ladder(&user.0.id, &stored)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(ladder_to_wire(stored, &library)))
}

/// `PUT /ladders/{id}` — update a ladder's configuration in place, reconciling its
/// rungs. 404 when the id is not the caller's.
///
/// Saving never touches a running dispatch: it runs its snapshot, and the edit applies
/// to the next Run. `400` for a climber the account cannot launch, exactly as [`create`]
/// refuses one.
pub async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(input): Json<LadderInput>,
) -> Result<Json<Ladder>, ApiError> {
    // The climbers already on the ladder, exempt from re-judgement — see
    // [`reject_unstorable_members`]: a configuration gaining a launch slot must not make
    // the whole ladder unsavable.
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
    Ok(Json(ladder_to_wire(stored, &library)))
}

/// `DELETE /ladders/{id}` — delete a ladder, its rungs, and its dispatch. 404 when the
/// id is not the caller's.
///
/// The dispatch's jobs are deliberately left alone: they record the ladder only as their
/// origin, and deleting a ladder is not a reason to throw away runs that already cost
/// money. Stop first if that is what you meant. Their automatic retries are withheld and
/// their finishes feed nothing, since their dispatch is gone.
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

/// `POST /ladders/{id}/rungs/order` — reorder the configuration without editing it. 404
/// when the id is not the caller's; 400 when the body is not a permutation of the
/// ladder's current rungs. A running dispatch keeps its own order.
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

// ---- Dispatches ------------------------------------------------------------

/// `POST /ladders/{id}/run` — start a dispatch of the configuration as it stands, and
/// run its first launch pass. Answers with the board.
///
/// `400` naming the cause when the configuration has no rungs, holds a rung that is not
/// validator-rated, or resolves no climbers; `409` while a dispatch is running. A Run
/// after a dispatch ended replaces it, its verdicts and climbers with it.
pub async fn run(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<LadderProgress>, ApiError> {
    let user_id = &user.0.id;
    let ladder = load_ladder(&state, user_id, &id).await?;
    if ladder.rungs.is_empty() {
        return Err(ApiError::bad_request("this ladder has no rungs"));
    }
    reject_ineligible_rungs(&state, &ladder.rungs)?;
    let groups = group_index(&state, user_id).await?;
    let library = gg_library(&state, user_id).await?;
    let members = resolve_combos(&ladder.combo_group_ids, &ladder.combos, &groups, &library);
    let climbers = dispatch_climbers_of(&members)?;
    if climbers.is_empty() {
        return Err(ApiError::bad_request("this ladder resolves no climbers"));
    }
    let limit = resolve_in_flight_limit(&state, user_id, ladder.in_flight_limit).await?;
    let snapshot = snapshot_of(&ladder, limit);
    let dispatch = StoredDispatch {
        ladder_id: id.clone(),
        id: new_id(),
        status: DispatchStatus::Running.as_str().to_string(),
        started_at: now()?,
        ended_at: None,
        snapshot_json: serde_json::to_string(&snapshot)
            .map_err(|e| ApiError::internal(format!("encoding a dispatch snapshot: {e}")))?,
    };
    let started = state
        .db
        .start_ladder_dispatch(&dispatch, &climbers)
        .await
        .map_err(ApiError::from)?;
    if !started {
        return Err(ApiError::conflict(
            "a dispatch of this ladder is already running",
        ));
    }
    // The dispatch has started whatever its first pass does: a pass that fails leaves it
    // running, and the next prompt (a finished run, a retry, a restart) passes again.
    if let Err(err) = launch_ladder(&state, user_id, &id).await {
        tracing::warn!(
            ladder = %id,
            error = %err.message,
            "could not run a new dispatch's first launch pass"
        );
    }
    Ok(Json(progress_of(&state, user_id, &id).await?))
}

/// `POST /ladders/{id}/stop` — end the running dispatch and cancel its `queued` and
/// `pending` jobs, and with `cancelRunning` its `dispatched`, `starting` and `running`
/// ones too. `409` when no dispatch is running.
///
/// The end is a conditional update. The cancel reaches the jobs whose origin names this
/// dispatch, and the jobs an earlier dispatch of this ladder left in flight, which this
/// dispatch was waiting on as its slots' own ([`cancel_earlier_dispatches`]). A launch
/// pass that was enqueuing meanwhile checks the dispatch after it enqueues and cancels
/// what it just enqueued.
pub async fn stop(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    input: Option<Json<LadderStopInput>>,
) -> Result<Json<HaltResult>, ApiError> {
    let input = input.map(|Json(input)| input).unwrap_or_default();
    load_ladder(&state, &user.0.id, &id).await?;
    let stopped_at = now()?;
    let Some(dispatch_id) = state
        .db
        .end_ladder_dispatch(&id, None, DispatchStatus::Stopped.as_str(), &stopped_at)
        .await
        .map_err(ApiError::from)?
    else {
        return Err(ApiError::conflict("no dispatch of this ladder is running"));
    };
    let detail = "canceled by stopping the ladder";
    let canceled = halt_jobs(
        &state,
        &OriginScope::Prefix(dispatch_prefix(&id, &dispatch_id)),
        input.cancel_running,
        detail,
    )
    .await?
        + cancel_earlier_dispatches(
            &state,
            &id,
            &dispatch_id,
            &stopped_at,
            input.cancel_running,
            detail,
        )
        .await?;
    Ok(Json(HaltResult {
        canceled,
        included_active: input.cancel_running,
    }))
}

/// Cancel the jobs earlier dispatches of a ladder left in flight, for the Stop of the
/// dispatch `stopped` that ended at `stopped_at`, returning how many moved.
///
/// A plain Stop leaves a dispatch's started jobs running, and the next Run counts them
/// as its slots' jobs in flight without owning them, so the Stop of that dispatch has to
/// reach them or it cancels nothing the ladder is seen to be running. Only this ladder's
/// jobs are reached, by their origin: a job a plan, another ladder or a hand launch
/// enqueued for the same cell is left alone.
///
/// The jobs are named one by one, those created no later than `stopped_at`, and not
/// swept by the ladder's prefix: a Run is allowed again the moment the dispatch has
/// ended, and its dispatch's jobs must not be cancelled by the Stop before it.
async fn cancel_earlier_dispatches(
    state: &AppState,
    ladder_id: &str,
    stopped: &str,
    stopped_at: &str,
    cancel_running: bool,
    detail: &str,
) -> Result<u32, ApiError> {
    use time::format_description::well_known::Rfc3339;
    let Ok(stopped_at) = time::OffsetDateTime::parse(stopped_at, &Rfc3339) else {
        return Ok(0);
    };
    let ladder = format!("ladder:{ladder_id}/");
    let own = format!("{}/", dispatch_prefix(ladder_id, stopped));
    let mut states: Vec<&str> = CANCELABLE_WAITING_STATES.to_vec();
    if cancel_running {
        states.extend_from_slice(&CANCELABLE_ACTIVE_STATES);
    }
    let earlier: Vec<String> = state
        .db
        .active_jobs()
        .await
        .map_err(ApiError::from)?
        .into_iter()
        .filter(|job| {
            job.origin
                .as_deref()
                .is_some_and(|origin| origin.starts_with(&ladder) && !origin.starts_with(&own))
                && time::OffsetDateTime::parse(&job.created_at, &Rfc3339)
                    .is_ok_and(|created| created <= stopped_at)
        })
        .map(|job| job.id)
        .collect();
    if earlier.is_empty() {
        return Ok(0);
    }
    super::jobs::sweep_cancel(
        state,
        &JobCancelFilter {
            states: &states,
            origin: None,
            user_id: None,
            cell: None,
            ids: Some(&earlier),
        },
        detail,
        super::jobs::CancelFeed::Feed,
    )
    .await
}

/// `GET /ladders/summary` — one entry per ladder for the ladders list: the
/// configuration's headline and its latest dispatch's slot counts and runs. One request
/// for the whole list.
pub async fn summary(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<Vec<LadderSummary>>, ApiError> {
    let user_id = &user.0.id;
    let ladders = state
        .db
        .list_ladders(user_id)
        .await
        .map_err(ApiError::from)?;
    let groups = group_index(&state, user_id).await?;
    let library = gg_library(&state, user_id).await?;
    let mut out = Vec::with_capacity(ladders.len());
    for ladder in ladders {
        let climbers =
            resolve_combos(&ladder.combo_group_ids, &ladder.combos, &groups, &library).len();
        let dispatch = match state
            .db
            .ladder_dispatch(&ladder.id)
            .await
            .map_err(ApiError::from)?
        {
            Some(dispatch) => {
                let board = read_dispatch(&state, &ladder.id, dispatch, &library, false).await?;
                let (slots, runs) = board.totals();
                Some(LadderDispatchSummary {
                    id: board.dispatch.id.clone(),
                    status: board.status(),
                    started_at: board.dispatch.started_at.clone(),
                    ended_at: board.dispatch.ended_at.clone(),
                    slots,
                    runs,
                })
            }
            None => None,
        };
        out.push(LadderSummary {
            id: ladder.id,
            name: ladder.name,
            rungs: ladder.rungs.len() as u32,
            runs_per_cell: ladder.runs_per_cell,
            climbers: climbers as u32,
            dispatch,
        });
    }
    Ok(Json(out))
}

/// `GET /ladders/{id}/progress` — the board: the rungs, the latest dispatch, and every
/// climber of it with each rung slot. 404 when the id is not the caller's.
///
/// A **read**: verdicts the gate has resolved but nobody has recorded are computed live,
/// and persisted by the next launch pass — a `GET` that mutated the board would make a
/// dashboard refresh part of the climb.
pub async fn progress(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<LadderProgress>, ApiError> {
    Ok(Json(progress_of(&state, &user.0.id, &id).await?))
}

/// `GET /ladders/{id}/queue` — the completed runs the latest dispatch counts that the
/// requesting account has not reviewed, in the ladder's own order. Empty without a
/// dispatch.
///
/// The queue follows the board: it offers a run the dispatch read exactly as it offers
/// one the dispatch launched. It is there for labelling after the fact and neither blocks
/// nor feeds the climb. A slot's runs sit together, oldest first, and a run two rungs
/// share is listed once, under the lower rung. 404 when the id is not the caller's.
pub async fn queue(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<CoverageQueue>, ApiError> {
    let user_id = &user.0.id;
    load_ladder(&state, user_id, &id).await?;
    let Some(dispatch) = state
        .db
        .ladder_dispatch(&id)
        .await
        .map_err(ApiError::from)?
    else {
        return Ok(Json(CoverageQueue {
            runs: Vec::new(),
            truncated: false,
        }));
    };
    let library = gg_library(&state, user_id).await?;
    let board = read_dispatch(&state, &id, dispatch, &library, false).await?;
    let unreviewed = state
        .db
        .unreviewed_among(&board.run_ids(), user_id)
        .await
        .map_err(ApiError::from)?;
    let mut runs: Vec<CoverageQueueEntry> = Vec::new();
    let mut listed: std::collections::HashSet<&str> = std::collections::HashSet::new();
    let mut truncated = false;
    'slots: for (climber, position) in board.slot_order() {
        let rung = &board.snapshot.rungs[position];
        let member = &climber.member;
        for run in &climber.slots[position].runs {
            if !unreviewed.contains(&run.id) || listed.contains(run.id.as_str()) {
                continue;
            }
            if runs.len() >= MAX_QUEUE_RUNS {
                truncated = true;
                break 'slots;
            }
            listed.insert(&run.id);
            runs.push(CoverageQueueEntry {
                run_id: run.id.clone(),
                rung_id: Some(rung.id.clone()),
                slug: rung.slug.clone(),
                version: rung.version.clone(),
                variant: rung.variant.clone(),
                engine: rung.case().engine_slug(),
                harness: member.combo.harness,
                model: member.launch_model.clone(),
                gg_config_id: member.combo.gg_config_id.clone(),
                gg_config_name: member.combo.gg_config_name.clone(),
                gg_slot_models: member.combo.gg_slot_models.clone(),
                finished_at: run.finished_at.clone(),
            });
        }
    }
    Ok(Json(CoverageQueue { runs, truncated }))
}

/// `POST /ladders/{id}/climbers/retry` — retry a climber of the running dispatch that
/// is blocked as `failing` or `unlaunchable`, once its owner has fixed the cause.
///
/// The retry is recorded on the dispatch's climber, and only jobs that ended after it
/// are read for its failing block, so the launch pass that follows relaunches its rung
/// under the dispatch's limit; a pass also resolves the combination again, which is what
/// clears an `unlaunchable` one that has been fixed. Recording it rather than launching
/// once is what keeps a retry from being lost to a busy claim or a full limit.
///
/// `204`; `404` when the combination is not a climber of the dispatch; `409` when no
/// dispatch is running or the climber is not blocked for one of those two reasons.
pub async fn retry_climber(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(input): Json<LadderRetryInput>,
) -> Result<StatusCode, ApiError> {
    let user_id = &user.0.id;
    load_ladder(&state, user_id, &id).await?;
    let dispatch = state
        .db
        .ladder_dispatch(&id)
        .await
        .map_err(ApiError::from)?
        .filter(|dispatch| DispatchStatus::parse(&dispatch.status) == DispatchStatus::Running)
        .ok_or_else(|| ApiError::conflict("no dispatch of this ladder is running"))?;
    let key = climber_key(&input.combination);
    let library = gg_library(&state, user_id).await?;
    let board = read_dispatch(&state, &id, dispatch, &library, false).await?;
    let climber = board
        .climbers
        .iter()
        .find(|climber| climber.stored.climber_key == key)
        .ok_or_else(|| ApiError::not_found("not a climber of this ladder's dispatch"))?;
    match &climber.walk.blocked {
        Some(ClimberBlock::Failing { .. } | ClimberBlock::Unlaunchable { .. }) => {}
        Some(ClimberBlock::Unrated { .. }) => {
            return Err(ApiError::conflict(
                "this climber is blocked by unrated runs, which a retry cannot help",
            ));
        }
        None => {
            return Err(ApiError::conflict(format!(
                "this climber is {}, not blocked",
                climber_status_word(climber.walk.status)
            )));
        }
    }
    let recorded = state
        .db
        .record_dispatch_climber_retry(&board.dispatch.id, &key, &now()?)
        .await
        .map_err(ApiError::from)?;
    if !recorded {
        return Err(ApiError::not_found(
            "not a climber of this ladder's dispatch",
        ));
    }
    spawn_launch(&state, LaunchTarget::Ladder, user_id, &id);
    Ok(StatusCode::NO_CONTENT)
}

/// A climber's status as its wire token, for a message that names it.
fn climber_status_word(status: ClimberStatus) -> &'static str {
    match status {
        ClimberStatus::Running => "running",
        ClimberStatus::Blocked => "blocked",
        ClimberStatus::Failed => "failed",
        ClimberStatus::Completed => "completed",
    }
}

// ---- Launch passes ---------------------------------------------------------

/// Run launch passes of a ladder's running dispatch as `user_id`, its owner: `skipped:
/// notRunning` when it has none, else
/// [`run_launch_passes`] under the ladder's claim.
pub(super) async fn launch_ladder(
    state: &AppState,
    user_id: &str,
    id: &str,
) -> Result<LaunchPassResult, ApiError> {
    let ladder = load_ladder(state, user_id, id).await?;
    let dispatch = state.db.ladder_dispatch(id).await.map_err(ApiError::from)?;
    let running = dispatch
        .as_ref()
        .filter(|dispatch| DispatchStatus::parse(&dispatch.status) == DispatchStatus::Running);
    let Some(dispatch) = running else {
        let limit = resolve_in_flight_limit(state, user_id, ladder.in_flight_limit).await?;
        return Ok(LaunchPassResult::skipped_by(
            LaunchSkipped::NotRunning,
            limit,
        ));
    };
    let limit = parse_snapshot(dispatch)?.in_flight_limit;
    run_launch_passes(state, LaunchTarget::Ladder, user_id, id, limit).await
}

/// One launch pass of a ladder's running dispatch, run while this caller holds the
/// ladder's claim: record every verdict the gate can now decide (cancelling a decided
/// slot's waiting jobs under `earlyStop`), launch each climber's current rung up to the
/// dispatch's limit, and mark the dispatch finished once every climber completed or
/// failed and nothing of it is in flight.
///
/// The limit is the one in the snapshot of the dispatch this pass reads, never one carried
/// in from whoever took the claim: a holder serving a request that arrived after a new Run
/// must launch that dispatch under its own limit.
pub(super) async fn ladder_pass_locked(
    state: &AppState,
    user_id: &str,
    id: &str,
) -> Result<LaunchPassResult, ApiError> {
    let Some(dispatch) = running_dispatch(state, id).await? else {
        let ladder = load_ladder(state, user_id, id).await?;
        let limit = resolve_in_flight_limit(state, user_id, ladder.in_flight_limit).await?;
        return Ok(LaunchPassResult::skipped_by(
            LaunchSkipped::NotRunning,
            limit,
        ));
    };
    let limit = parse_snapshot(&dispatch)?.in_flight_limit;
    let dispatch_id = dispatch.id.clone();
    let library = gg_library(state, user_id).await?;
    let board = read_dispatch(state, id, dispatch, &library, true).await?;

    // Publish what the board counts. A run this dispatch launched published itself
    // when its driver reported it; a run the dispatch inherited toward a rung is
    // picked up here. The board names only a reached slot's first `target` runs,
    // so a run beyond the target, or on a rung no climber reached, is left alone.
    // A run that has ever had a publish job is passed over, so the passes that
    // follow enqueue nothing more for it.
    super::auto_publish::auto_publish_runs(
        state,
        &board.run_ids(),
        super::auto_publish::AutoPublishCause::LadderPass,
    )
    .await;

    let in_flight = board.in_flight_total();
    if board.finished() && in_flight == 0 {
        state
            .db
            .end_ladder_dispatch(
                id,
                Some(&dispatch_id),
                DispatchStatus::Finished.as_str(),
                &now()?,
            )
            .await
            .map_err(ApiError::from)?;
        return Ok(LaunchPassResult {
            skipped: None,
            in_flight_limit: limit,
            in_flight: Some(0),
            enqueued: 0,
            cells: Vec::new(),
            unlaunchable: Vec::new(),
            early_stop_canceled: board.early_stop_canceled,
        });
    }

    let active = board.active_slots();
    let mut demands: Vec<CellDemand> = Vec::with_capacity(active.len());
    let mut unlaunchable: Vec<BlockedCell> = Vec::new();
    for slot in &active {
        let demand = CellDemand {
            target: slot.target,
            counted: slot.counted,
            in_flight: slot.in_flight,
            harness: harness_lane(slot.member.combo.harness),
        };
        // Only worth reporting on a slot that actually wanted runs.
        if let Some(reason) = &slot.member.unlaunchable
            && demand.missing() > 0
        {
            unlaunchable.push(blocked_cell(
                Some(slot.rung_id.clone()),
                &slot.case,
                slot.member,
                reason.clone(),
            ));
        }
        let demand = launchable_demand(demand, slot.member);
        // A pass does not relaunch a slot whose launch used up its retries without a
        // counted run: the retry limit is the slot's whole allowance. Retrying the climber
        // is what launches it again.
        if slot.failing && slot.member.unlaunchable.is_none() {
            if demand.missing() > 0 {
                unlaunchable.push(blocked_cell(
                    Some(slot.rung_id.clone()),
                    &slot.case,
                    slot.member,
                    blocked_reason(),
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
    let launches = launch_pass(&demands, &board.harness_capacity, limit, in_flight);
    let cells: Vec<LaunchCell<'_>> = launches
        .iter()
        .map(|launch| {
            let slot = &active[launch.cell];
            LaunchCell {
                rung_id: Some(slot.rung_id.clone()),
                origin: JobOrigin::dispatch(id, dispatch_id.clone(), slot.rung_id.clone()),
                case: &slot.case,
                member: slot.member,
                runs: launch.runs,
                retry_count: board.snapshot.retry_count,
            }
        })
        .collect();

    // A stop does not take the claim: it ends the dispatch and then cancels its jobs. A
    // pass that began before the stop may reach this point after it, and must not refill
    // the queue the stop just emptied. Checked before the enqueue, and again after it,
    // because the stop can land in between: either the stop's cancel comes after these
    // jobs exist and reaches them, or the check below sees the dispatch ended and cancels
    // them itself. A new Run in between is the same: its dispatch is not this one.
    let still_running =
        |current: Option<StoredDispatch>| current.is_some_and(|d| d.id == dispatch_id);
    if !still_running(running_dispatch(state, id).await?) {
        return Ok(LaunchPassResult {
            early_stop_canceled: board.early_stop_canceled,
            ..LaunchPassResult::skipped_by(LaunchSkipped::NotRunning, limit)
        });
    }
    let enqueued = enqueue_launches(state, user_id, &cells).await?;
    if !enqueued.launched.is_empty() && !still_running(running_dispatch(state, id).await?) {
        cancel_just_enqueued(
            state,
            &enqueued.launched,
            "canceled: the ladder dispatch ended while this run was being enqueued",
        )
        .await?;
        return Ok(LaunchPassResult {
            early_stop_canceled: board.early_stop_canceled,
            ..LaunchPassResult::skipped_by(LaunchSkipped::NotRunning, limit)
        });
    }
    unlaunchable.extend(enqueued.blocked);

    Ok(LaunchPassResult {
        skipped: None,
        in_flight_limit: limit,
        in_flight: Some(in_flight),
        enqueued: enqueued.launched.iter().map(|cell| cell.runs).sum(),
        cells: enqueued.launched,
        unlaunchable,
        early_stop_canceled: board.early_stop_canceled,
    })
}

/// The ladders a job that just reached a terminal state feeds, as `(ladder id, owner)`:
/// every ladder whose running dispatch holds the job's cell as one of its rung slots —
/// whoever launched the job, since a dispatch counts every run of its slots' cells, as
/// [`super::coverage::plans_fed_by`] feeds a plan. That covers the dispatch's own jobs,
/// whose cells are its slots'. Never fails; a dispatch that cannot be read is logged and
/// skipped.
pub(super) async fn dispatches_fed_by(
    state: &AppState,
    job: &test_cabinet_entities::job::Model,
) -> Vec<(String, String)> {
    let dispatches = match state.db.running_dispatches().await {
        Ok(dispatches) => dispatches,
        Err(err) => {
            tracing::warn!(job = %job.id, error = %err, "could not list the running ladder dispatches a finished run may feed");
            return Vec::new();
        }
    };
    let job_cell = job_cell(job);
    let mut fed = Vec::new();
    for (ladder_id, owner) in dispatches {
        match dispatch_has_cell(state, &ladder_id, &job_cell).await {
            Ok(true) => fed.push((ladder_id, owner)),
            Ok(false) => {}
            Err(err) => tracing::warn!(
                job = %job.id,
                ladder = %ladder_id,
                error = %err.message,
                "could not read a running ladder dispatch's rung slots"
            ),
        }
    }
    fed
}

/// Whether `cell` is a rung slot of a ladder's running dispatch: one of its rungs' pins
/// with one of its climbers' pinned cell shares. Short-circuits on the case pin before
/// reading any climber. A climber that never resolved has no cells, so it holds none.
async fn dispatch_has_cell(
    state: &AppState,
    ladder_id: &str,
    cell: &CellKey,
) -> Result<bool, ApiError> {
    let Some(dispatch) = running_dispatch(state, ladder_id).await? else {
        return Ok(false);
    };
    let (slug, version, variant, engine, harness, model, config_id, models) = cell;
    let pinned = parse_snapshot(&dispatch)?.rungs.iter().any(|rung| {
        let case = rung.case();
        case.slug == *slug
            && case.version == *version
            && case.variant == *variant
            && case.engine_slug() == *engine
    });
    if !pinned {
        return Ok(false);
    }
    let identity: MemberCellIdentity = (
        harness.clone(),
        model.clone(),
        config_id.clone(),
        models.clone(),
    );
    for climber in state
        .db
        .dispatch_climbers(&dispatch.id)
        .await
        .map_err(ApiError::from)?
    {
        if let Some(json) = climber.cell_json.as_deref()
            && decode_identity(json)? == identity
        {
            return Ok(true);
        }
    }
    Ok(false)
}

/// A ladder's dispatch, when it is running.
async fn running_dispatch(state: &AppState, id: &str) -> Result<Option<StoredDispatch>, ApiError> {
    Ok(state
        .db
        .ladder_dispatch(id)
        .await
        .map_err(ApiError::from)?
        .filter(|dispatch| DispatchStatus::parse(&dispatch.status) == DispatchStatus::Running))
}

// ---- The board -------------------------------------------------------------

/// One rung slot's evidence, as the pure walk reads it.
#[derive(Debug, Clone, Default)]
struct SlotEvidence {
    /// The slot's runs, oldest first, as the gate reads them.
    runs: Vec<RungRun>,
    /// The slot's jobs in flight: its cell's, whoever launched them, up to what it still
    /// needs.
    in_flight: u32,
    /// How many attempts the launch that blocks the slot made, when a job the dispatch
    /// launched for it used up its retries without a counted run since the climber's
    /// last retry, with no later launch in its place.
    failing: Option<u32>,
    /// The verdict recorded on the slot, if any. It stands for the rest of the dispatch.
    recorded: Option<LadderOutcomeKind>,
}

/// One slot after the walk.
#[derive(Debug, Clone, PartialEq)]
struct WalkedSlot {
    /// Where it stands.
    status: SlotStatus,
    /// The gate's tally over its evidence.
    tally: GateTally,
    /// A verdict the gate reached on this walk that is not recorded yet.
    newly: Option<LadderOutcomeKind>,
}

/// One climber after the walk.
#[derive(Debug, Clone, PartialEq)]
struct Walk {
    /// Each rung's slot, in rung order.
    slots: Vec<WalkedSlot>,
    /// Where the climber stands.
    status: ClimberStatus,
    /// Why it is blocked, when it is.
    blocked: Option<ClimberBlock>,
    /// The rung it stands on or failed, `None` once completed.
    current: Option<usize>,
}

/// Walk one climber up a dispatch's rungs: a recorded verdict governs its slot, and the
/// gate decides an unrecorded one. The first rung not passed is where the climber stands;
/// the slots above it are `pending`, or `skipped` after a failure. A stopped dispatch
/// skips every slot still `running`, `blocked` or `pending`, and leaves the climber's own
/// status as walked.
///
/// Pure: the caller records the new verdicts and cancels what early stop decided.
fn walk_climber(
    targets: &[u32],
    evidence: &[SlotEvidence],
    gate: &Gate,
    unlaunchable: Option<&str>,
    stopped: bool,
) -> Walk {
    let mut slots: Vec<WalkedSlot> = Vec::with_capacity(targets.len());
    let mut status = ClimberStatus::Completed;
    let mut blocked = None;
    let mut current = None;
    for (position, (&target, ev)) in targets.iter().zip(evidence).enumerate() {
        let tally = gate::tally(&ev.runs, target, ev.in_flight, gate);
        if current.is_some() {
            let status = if status == ClimberStatus::Failed {
                SlotStatus::Skipped
            } else {
                SlotStatus::Pending
            };
            slots.push(WalkedSlot {
                status,
                tally,
                newly: None,
            });
            continue;
        }
        let (verdict, newly) = match ev.recorded {
            Some(kind) => (Some(kind), None),
            None => {
                let decided = LadderOutcomeKind::from_gate(gate::evaluate(
                    &ev.runs,
                    target,
                    ev.in_flight,
                    gate,
                ));
                (decided, decided)
            }
        };
        let slot_status = match verdict {
            Some(LadderOutcomeKind::Passed) => SlotStatus::Passed,
            Some(LadderOutcomeKind::Failed) => {
                status = ClimberStatus::Failed;
                current = Some(position);
                SlotStatus::Failed
            }
            None => {
                let (standing, block) =
                    undecided_standing(&tally, unlaunchable, ev.in_flight, ev.failing);
                status = standing;
                blocked = block;
                current = Some(position);
                match standing {
                    ClimberStatus::Blocked => SlotStatus::Blocked,
                    _ => SlotStatus::Running,
                }
            }
        };
        slots.push(WalkedSlot {
            status: slot_status,
            tally,
            newly,
        });
    }
    if stopped {
        for slot in &mut slots {
            if matches!(
                slot.status,
                SlotStatus::Running | SlotStatus::Blocked | SlotStatus::Pending
            ) {
                slot.status = SlotStatus::Skipped;
            }
        }
    }
    Walk {
        slots,
        status,
        blocked,
        current,
    }
}

/// Where a climber stands on a rung the gate has not decided, and why.
///
/// The order of the checks is the order of the fixes: a rung with nothing pending is
/// waiting on nothing the dispatch can launch, so it is blocked as unrated; otherwise the
/// dispatch can feed it — unless its climber cannot be launched or its launch used up its
/// retries, and nothing of it is still in flight to change that.
fn undecided_standing(
    tally: &GateTally,
    unlaunchable: Option<&str>,
    in_flight: u32,
    failing: Option<u32>,
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
        if let Some(reason) = unlaunchable {
            return (
                ClimberStatus::Blocked,
                Some(ClimberBlock::Unlaunchable {
                    reason: reason.to_string(),
                }),
            );
        }
        if let Some(attempts) = failing {
            return (
                ClimberStatus::Blocked,
                Some(ClimberBlock::Failing { attempts }),
            );
        }
    }
    (ClimberStatus::Running, None)
}

/// The runs of one rung slot that need no more executing, for the dispatch's progress
/// bar. A decided or skipped slot needs no more runs, so its whole target is done once
/// the runs the dispatch has in flight for it finish; a current one has done the runs it
/// counted, whoever launched them, up to its target; a pending one has done nothing.
fn slot_runs_done(status: SlotStatus, target: u32, counted: u32, in_flight: u32) -> u32 {
    match status {
        SlotStatus::Running | SlotStatus::Blocked => counted.min(target),
        SlotStatus::Passed | SlotStatus::Failed | SlotStatus::Skipped => {
            target - in_flight.min(target)
        }
        SlotStatus::Pending => 0,
    }
}

/// One rung slot's raw evidence, kept beside the walk for the wire and the queue.
struct SlotFacts {
    /// The slot's runs, oldest first: the first `target` counted runs of its cell to
    /// land, whoever launched them. Empty on a slot its climber has not reached.
    runs: Vec<CellRun>,
    /// Its jobs in flight as its gate reads them: its cell's, whoever launched them, up
    /// to what it still needs.
    in_flight: u32,
    /// The ids of the jobs in flight the dispatch launched for it.
    job_ids: Vec<String>,
    /// How many of those are waiting.
    waiting: u32,
    /// Its cell, for a cancel narrowed to it.
    cell: CellKey,
}

/// One climber of a dispatch, resolved and walked.
struct BoardClimber {
    /// The stored climber.
    stored: StoredDispatchClimber,
    /// The resolved member.
    member: PlanMember,
    /// Each rung's slot evidence, in rung order.
    slots: Vec<SlotFacts>,
    /// The walk.
    walk: Walk,
}

/// A dispatch, read and walked: everything its board, its summary, its queue, and its
/// launch pass are built from.
struct DispatchBoard {
    /// The dispatch row.
    dispatch: StoredDispatch,
    /// Its snapshot.
    snapshot: DispatchSnapshot,
    /// Its climbers, in resolved order.
    climbers: Vec<BoardClimber>,
    /// What the jobs it launched say: its limit and its failing blocks read these.
    evidence: DispatchEvidence,
    /// The recorded verdicts and when each was recorded, by `(rung id, climber key)`.
    decided: HashMap<(String, String), (LadderOutcomeKind, String)>,
    /// How much room each harness has to start another run. Read only by a pass.
    harness_capacity: Vec<crate::coverage::schedule::HarnessCapacity>,
    /// How many waiting jobs this read cancelled because an early-stopping gate decided
    /// their slot. Always `0` on a read that does not record.
    early_stop_canceled: u32,
}

/// One slot a launch pass may feed.
struct ActiveSlot<'a> {
    rung_id: String,
    position: usize,
    case: ReviewPlanCase,
    member: &'a PlanMember,
    target: u32,
    counted: u32,
    in_flight: u32,
    failing: bool,
}

impl DispatchBoard {
    /// The rung-slot counts and the runs, over every slot of the dispatch.
    fn totals(&self) -> (SlotCounts, DispatchRuns) {
        let mut slots = SlotCounts::default();
        let mut runs = DispatchRuns::default();
        for climber in &self.climbers {
            for (position, slot) in climber.walk.slots.iter().enumerate() {
                let target = self.snapshot.rungs[position].target;
                let facts = &climber.slots[position];
                let counted = facts.runs.len() as u32;
                // The dispatch's own jobs: a decided or skipped slot waits on nothing
                // anyone else has in flight.
                let in_flight = facts.job_ids.len() as u32;
                slots.add(slot.status);
                runs.total += target;
                runs.done += slot_runs_done(slot.status, target, counted, in_flight);
                runs.in_flight += in_flight;
            }
        }
        (slots, runs)
    }

    /// Every job the dispatch launched that is in flight, whatever slot it belongs to —
    /// what its limit caps and what keeps it from finishing.
    fn in_flight_total(&self) -> u32 {
        self.evidence
            .in_flight
            .values()
            .map(|ids| ids.len() as u32)
            .sum()
    }

    /// Where the dispatch stands, as every read reports it: its stored status, with a
    /// running dispatch that waits on its owner read as
    /// [needing attention](https://docs.testcabinet.ai/components/backend/ladders/#needs-attention).
    fn status(&self) -> DispatchStatus {
        let stored = DispatchStatus::parse(&self.dispatch.status);
        let waiting = stored == DispatchStatus::Running
            && self.in_flight_total() == 0
            && self
                .climbers
                .iter()
                .all(|climber| climber.walk.status != ClimberStatus::Running)
            && self
                .climbers
                .iter()
                .any(|climber| climber.walk.status == ClimberStatus::Blocked);
        if waiting {
            DispatchStatus::NeedsAttention
        } else {
            stored
        }
    }

    /// Whether every climber completed or failed.
    fn finished(&self) -> bool {
        self.climbers.iter().all(|climber| {
            matches!(
                climber.walk.status,
                ClimberStatus::Completed | ClimberStatus::Failed
            )
        })
    }

    /// The runs of every slot, in no particular order. A run two rungs share is named
    /// by both.
    fn run_ids(&self) -> Vec<String> {
        self.climbers
            .iter()
            .flat_map(|climber| climber.slots.iter())
            .flat_map(|slot| slot.runs.iter().map(|run| run.id.clone()))
            .collect()
    }

    /// Every slot as `(climber, rung position)`, in the dispatch's own order: rung-major
    /// for the `rung` axis, climber-major for `combination`.
    fn slot_order(&self) -> Vec<(&BoardClimber, usize)> {
        let rungs = self.snapshot.rungs.len();
        let mut order = Vec::with_capacity(rungs * self.climbers.len());
        match self.snapshot.outer_axis {
            LadderAxis::Rung => {
                for position in 0..rungs {
                    for climber in &self.climbers {
                        order.push((climber, position));
                    }
                }
            }
            LadderAxis::Combination => {
                for climber in &self.climbers {
                    for position in 0..rungs {
                        order.push((climber, position));
                    }
                }
            }
        }
        order
    }

    /// The slots a launch pass may feed, in the dispatch's emission order: every running
    /// climber's current slot, and a blocked one's when the block is one a pass reports (a
    /// failing slot or an unlaunchable climber, whose demand is zeroed). Never a slot
    /// whose runs have all completed.
    fn active_slots(&self) -> Vec<ActiveSlot<'_>> {
        let mut active: Vec<ActiveSlot<'_>> = Vec::new();
        for climber in &self.climbers {
            let feeds = match climber.walk.status {
                ClimberStatus::Running => true,
                ClimberStatus::Blocked => matches!(
                    climber.walk.blocked,
                    Some(ClimberBlock::Failing { .. } | ClimberBlock::Unlaunchable { .. })
                ),
                _ => false,
            };
            let Some(position) = climber.walk.current.filter(|_| feeds) else {
                continue;
            };
            let rung = &self.snapshot.rungs[position];
            let facts = &climber.slots[position];
            active.push(ActiveSlot {
                rung_id: rung.id.clone(),
                position,
                case: rung.case(),
                member: &climber.member,
                target: rung.target,
                counted: facts.runs.len() as u32,
                in_flight: facts.in_flight,
                failing: self.slot_failing(climber, position),
            });
        }
        if self.snapshot.outer_axis == LadderAxis::Rung {
            // Bring every climber up a rung before anyone moves on. A stable sort keeps
            // the climbers' resolved order within each rung.
            active.sort_by_key(|slot| slot.position);
        }
        active
    }

    /// Whether a job the dispatch launched for a slot used up its retries without a
    /// counted run since the climber's retry, with no later launch in its place.
    fn slot_failing(&self, climber: &BoardClimber, position: usize) -> bool {
        let rung = &self.snapshot.rungs[position];
        let key: SlotKey = (rung.id.clone(), climber.slots[position].cell.clone());
        slot_failing(
            self.evidence
                .terminal
                .get(&key)
                .map(Vec::as_slice)
                .unwrap_or(&[]),
            climber.stored.retried_at.as_deref(),
            self.evidence.launched.get(&key).copied(),
        )
        .is_some()
    }
}

/// How many attempts the launch that blocks a slot made, given the slot's terminal jobs
/// (newest first) and when its newest launch was created: `Some` when a job that ended
/// after `since` blocks the slot ([`blocking_job`]), counted off the most recently ended
/// such job.
fn slot_failing(
    terminal: &[TerminalJob],
    since: Option<&str>,
    latest_launch: Option<time::OffsetDateTime>,
) -> Option<u32> {
    let since = since.and_then(|since| {
        time::OffsetDateTime::parse(since, &time::format_description::well_known::Rfc3339).ok()
    });
    let after: Vec<TerminalJob> = terminal
        .iter()
        .filter(|job| {
            since.is_none_or(|since| {
                time::OffsetDateTime::parse(
                    &job.ended_at,
                    &time::format_description::well_known::Rfc3339,
                )
                .is_ok_and(|ended| ended > since)
            })
        })
        .cloned()
        .collect();
    blocking_job(&after, latest_launch).map(|job| job.attempt + 1)
}

/// Read and walk one dispatch. `record` says whether verdicts that have become decidable
/// are written down (and, under `earlyStop`, a decided slot's waiting jobs cancelled) —
/// true for a launch pass of a running dispatch, false for every read.
///
/// The climbers' combinations are resolved against the live gg library, as a launch
/// resolves them; a pass also resolves their launch facts, which can reach the model
/// catalog, so a read never does.
async fn read_dispatch(
    state: &AppState,
    ladder_id: &str,
    dispatch: StoredDispatch,
    library: &GgLibrary,
    record: bool,
) -> Result<DispatchBoard, ApiError> {
    let snapshot = parse_snapshot(&dispatch)?;
    let record = record && DispatchStatus::parse(&dispatch.status) == DispatchStatus::Running;
    let stored = state
        .db
        .dispatch_climbers(&dispatch.id)
        .await
        .map_err(ApiError::from)?;
    let mut stored = stored;
    let (mut members, identities) =
        pin_climbers(state, &dispatch.id, &mut stored, library, record).await?;
    let harness_capacity = if record {
        resolve_launch_facts(state, &mut members).await;
        super::coverage::MatrixCtx::load_for_ladder(state, Vec::new())
            .await?
            .harness_capacity()
            .to_vec()
    } else {
        Vec::new()
    };

    let mut evidence =
        read_evidence(state, ladder_id, &dispatch.id, &snapshot, &identities).await?;
    let mut board = DispatchBoard {
        dispatch,
        snapshot,
        climbers: Vec::new(),
        evidence: DispatchEvidence::default(),
        decided: HashMap::new(),
        harness_capacity,
        early_stop_canceled: 0,
    };
    board.decided = read_decided(state, &board.dispatch.id).await?;
    board.climbers = walk_board(
        &board,
        stored.clone(),
        members.clone(),
        &identities,
        &evidence,
    );
    if !record {
        board.evidence = evidence.jobs;
        return Ok(board);
    }

    let now = now()?;
    let mut recorded_any = false;
    for climber in &board.climbers {
        for (position, slot) in climber.walk.slots.iter().enumerate() {
            if let Some(kind) = slot.newly {
                state
                    .db
                    .record_dispatch_outcome(
                        &board.dispatch.id,
                        &board.snapshot.rungs[position].id,
                        &climber.stored.climber_key,
                        kind,
                        &now,
                    )
                    .await
                    .map_err(ApiError::from)?;
                recorded_any = true;
            }
        }
    }
    let mut canceled = 0u32;
    if board.snapshot.gate.early_stop {
        for climber in &board.climbers {
            for (position, slot) in climber.walk.slots.iter().enumerate() {
                let facts = &climber.slots[position];
                if !matches!(slot.status, SlotStatus::Passed | SlotStatus::Failed)
                    || facts.waiting == 0
                {
                    continue;
                }
                let origin = OriginScope::Exact(
                    JobOrigin::dispatch(
                        ladder_id,
                        board.dispatch.id.clone(),
                        board.snapshot.rungs[position].id.clone(),
                    )
                    .as_token(),
                );
                canceled += super::jobs::sweep_cancel(
                    state,
                    &JobCancelFilter {
                        states: &CANCELABLE_WAITING_STATES,
                        origin: Some(&origin),
                        user_id: None,
                        cell: Some(&facts.cell),
                        ids: None,
                    },
                    "canceled: the ladder's gate decided this rung early",
                    super::jobs::CancelFeed::Feed,
                )
                .await?;
            }
        }
    }
    if recorded_any || canceled > 0 {
        // Cancelled jobs are no longer in flight, and counting them anyway would hold the
        // dispatch back; recorded verdicts carry their time. Both are read again.
        if canceled > 0 {
            evidence = read_evidence(
                state,
                ladder_id,
                &board.dispatch.id,
                &board.snapshot,
                &identities,
            )
            .await?;
        }
        board.decided = read_decided(state, &board.dispatch.id).await?;
        board.climbers = walk_board(&board, stored, members, &identities, &evidence);
    }
    board.evidence = evidence.jobs;
    board.early_stop_canceled = canceled;
    Ok(board)
}

/// Resolve a dispatch's climbers for this read, and the cell share each one's runs are
/// found by.
///
/// The share is the one pinned on the climber, never the live resolution: a gg
/// configuration edited or deleted mid-dispatch must not hide the runs the dispatch already
/// made. Live resolution only decides whether the climber can launch more. A climber whose
/// live resolution names other cells than its pinned ones is held `unlaunchable`, since
/// its new runs would land where the dispatch never looks. A climber that never resolved
/// is pinned by the first launch pass (`record`) that resolves it, unless an earlier
/// climber already holds those cells.
async fn pin_climbers(
    state: &AppState,
    dispatch_id: &str,
    stored: &mut [StoredDispatchClimber],
    library: &GgLibrary,
    record: bool,
) -> Result<(Vec<PlanMember>, Vec<Option<MemberCellIdentity>>), ApiError> {
    let mut pinned: Vec<Option<MemberCellIdentity>> = Vec::with_capacity(stored.len());
    for climber in stored.iter() {
        pinned.push(
            climber
                .cell_json
                .as_deref()
                .map(decode_identity)
                .transpose()?,
        );
    }
    let mut members: Vec<PlanMember> = Vec::with_capacity(stored.len());
    for (index, climber) in stored.iter_mut().enumerate() {
        let combo: ReviewPlanCombo = serde_json::from_str(&climber.combo_json)
            .map_err(|e| ApiError::internal(format!("reading a dispatch climber: {e}")))?;
        let mut member = resolve_member(&combo, library);
        let live = resolved_identity(&member);
        match (&pinned[index], live) {
            (Some(pin), Some(live)) if *pin != live && member.unlaunchable.is_none() => {
                member.unlaunchable = Some(MOVED_CELLS.to_string());
            }
            (None, Some(live)) if member.unlaunchable.is_none() => {
                if pinned.iter().flatten().any(|other| *other == live) {
                    member.unlaunchable = Some(SHARED_CELLS.to_string());
                } else if record {
                    let json = encode_identity(&live)?;
                    if state
                        .db
                        .pin_dispatch_climber_cell(dispatch_id, &climber.climber_key, &json)
                        .await
                        .map_err(ApiError::from)?
                    {
                        climber.cell_json = Some(json);
                        pinned[index] = Some(live);
                    } else {
                        // Pinned meanwhile: this pass launches nothing for it, and the
                        // next one reads the pin.
                        member.unlaunchable = Some(PINNING.to_string());
                    }
                } else {
                    // A read: what a launch would pin.
                    pinned[index] = Some(live);
                }
            }
            _ => {}
        }
        members.push(member);
    }
    Ok((members, pinned))
}

/// Everything a dispatch's board is walked over.
struct BoardEvidence {
    /// What the jobs the dispatch launched say about its slots.
    jobs: DispatchEvidence,
    /// Every counted run of every cell of the dispatch's rungs' cases, globally, in the
    /// order the runs landed. A slot's runs are the first `target` of its cell's list
    /// ([`cell_runs`]).
    runs: CellRuns,
    /// The jobs in flight of the same cells, counted globally.
    in_flight: CellCounts,
}

/// A dispatch's evidence: its own jobs, and the global counted runs and jobs in flight of
/// its rungs' cases, which a plan reads the same way. Any validator-rated run a slot
/// holds that carries no rating yet is rated from its record and the store's manifest
/// first — whoever launched it — so such a run never stays unrated for longer than the
/// store lacks its version.
async fn read_evidence(
    state: &AppState,
    ladder_id: &str,
    dispatch_id: &str,
    snapshot: &DispatchSnapshot,
    identities: &[Option<MemberCellIdentity>],
) -> Result<BoardEvidence, ApiError> {
    let mut slugs: Vec<String> = snapshot
        .rungs
        .iter()
        .map(|rung| rung.slug.clone())
        .collect();
    slugs.sort();
    slugs.dedup();
    // The three reads are not one transaction, so their order is what keeps a job that
    // ends between them from vanishing. A job only ever moves from in flight to terminal
    // and its run is stored before it does, so reading the jobs in flight first, then the
    // dispatch's terminal jobs, then the runs can count such a job twice but never not at
    // all. Counted twice, the slot waits for the next pass. Counted nowhere, a run that
    // had used up its retries would read as never launched and be launched again.
    let in_flight = state
        .db
        .count_in_flight_jobs_by_cell(&slugs)
        .await
        .map_err(ApiError::from)?;
    let jobs = state
        .db
        .dispatch_evidence(ladder_id, dispatch_id)
        .await
        .map_err(ApiError::from)?;
    let mut runs = state
        .db
        .counted_runs_by_cell(&slugs, None)
        .await
        .map_err(ApiError::from)?;
    let mut unrated: Vec<String> = Vec::new();
    for rung in &snapshot.rungs {
        for identity in identities.iter().flatten() {
            let cell = cell_key_of(&rung.case(), identity.clone());
            unrated.extend(
                cell_runs(&runs, &cell, rung.target)
                    .iter()
                    .filter(|run| !run.model_failure && run.validator_rated && run.rating.is_none())
                    .map(|run| run.id.clone()),
            );
        }
    }
    unrated.sort();
    unrated.dedup();
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
            .counted_runs_by_cell(&slugs, None)
            .await
            .map_err(ApiError::from)?;
    }
    Ok(BoardEvidence {
        jobs,
        runs,
        in_flight,
    })
}

/// A dispatch's recorded verdicts and their times, by `(rung id, climber key)`.
async fn read_decided(
    state: &AppState,
    dispatch_id: &str,
) -> Result<HashMap<(String, String), (LadderOutcomeKind, String)>, ApiError> {
    Ok(state
        .db
        .dispatch_outcomes(dispatch_id)
        .await
        .map_err(ApiError::from)?
        .into_iter()
        .map(|outcome| {
            (
                (outcome.rung_id, outcome.climber_key),
                (outcome.outcome, outcome.decided_at),
            )
        })
        .collect())
}

/// Walk every climber of a board over `evidence`, finding each climber's runs by its
/// pinned cell share in `identities` (`None`: it never resolved, and has no runs).
///
/// A slot takes its runs and its jobs in flight as a plan's cell does: the first `target`
/// counted runs of its cell, and the cell's jobs in flight up to what it still needs,
/// whoever launched either. A slot the climber has not reached reads nothing, so the
/// board never shows evidence for a rung nobody was judged on.
fn walk_board(
    board: &DispatchBoard,
    stored: Vec<StoredDispatchClimber>,
    members: Vec<PlanMember>,
    identities: &[Option<MemberCellIdentity>],
    evidence: &BoardEvidence,
) -> Vec<BoardClimber> {
    let targets: Vec<u32> = board
        .snapshot
        .rungs
        .iter()
        .map(|rung| rung.target)
        .collect();
    let stopped = DispatchStatus::parse(&board.dispatch.status) == DispatchStatus::Stopped;
    stored
        .into_iter()
        .zip(members)
        .zip(identities)
        .map(|((stored, member), identity)| {
            let mut facts: Vec<SlotFacts> = Vec::with_capacity(targets.len());
            let mut slot_evidence: Vec<SlotEvidence> = Vec::with_capacity(targets.len());
            // A climber that never resolved forms the empty identity, which no job carries.
            let identity = identity.clone().unwrap_or_else(|| {
                (
                    member.combo.harness.as_str().to_string(),
                    String::new(),
                    String::new(),
                    String::new(),
                )
            });
            for rung in &board.snapshot.rungs {
                let cell = cell_key_of(&rung.case(), identity.clone());
                let key: SlotKey = (rung.id.clone(), cell.clone());
                let runs = cell_runs(&evidence.runs, &cell, rung.target).to_vec();
                let in_flight =
                    cell_in_flight(&evidence.in_flight, &cell, rung.target, runs.len() as u32);
                let jobs = &evidence.jobs;
                let job_ids = jobs.in_flight.get(&key).cloned().unwrap_or_default();
                let recorded = board
                    .decided
                    .get(&(rung.id.clone(), stored.climber_key.clone()))
                    .map(|(kind, _)| *kind);
                slot_evidence.push(SlotEvidence {
                    runs: runs.iter().map(CellRun::as_rung_run).collect(),
                    in_flight,
                    failing: slot_failing(
                        jobs.terminal.get(&key).map(Vec::as_slice).unwrap_or(&[]),
                        stored.retried_at.as_deref(),
                        jobs.launched.get(&key).copied(),
                    ),
                    recorded,
                });
                facts.push(SlotFacts {
                    runs,
                    in_flight,
                    job_ids,
                    waiting: jobs.waiting.get(&key).copied().unwrap_or(0),
                    cell,
                });
            }
            let mut walk = walk_climber(
                &targets,
                &slot_evidence,
                &board.snapshot.gate,
                member.unlaunchable.as_deref(),
                stopped,
            );
            // The rungs above the one the climber stands on or failed are not reached.
            let reached = walk.current.map_or(targets.len(), |current| current + 1);
            for position in reached..targets.len() {
                facts[position].runs.clear();
                facts[position].in_flight = 0;
                walk.slots[position].tally =
                    gate::tally(&[], targets[position], 0, &board.snapshot.gate);
            }
            BoardClimber {
                stored,
                member,
                slots: facts,
                walk,
            }
        })
        .collect()
}

/// The board for `GET /ladders/{id}/progress` and `POST /ladders/{id}/run`.
async fn progress_of(
    state: &AppState,
    user_id: &str,
    id: &str,
) -> Result<LadderProgress, ApiError> {
    let ladder = load_ladder(state, user_id, id).await?;
    let Some(dispatch) = state.db.ladder_dispatch(id).await.map_err(ApiError::from)? else {
        let rungs = ladder.rungs.iter().map(rung_to_wire).collect();
        return Ok(LadderProgress {
            ladder_id: ladder.id,
            dispatch: None,
            rungs: progress_rungs(state, rungs)?,
            climbers: Vec::new(),
            runs_unreviewed: 0,
        });
    };
    let library = gg_library(state, user_id).await?;
    let board = read_dispatch(state, id, dispatch, &library, false).await?;
    let runs_unreviewed = state
        .db
        .unreviewed_among(&board.run_ids(), user_id)
        .await
        .map_err(ApiError::from)?
        .len() as u32;
    let rungs = board
        .snapshot
        .rungs
        .iter()
        .map(SnapshotRung::to_wire)
        .collect();
    Ok(LadderProgress {
        ladder_id: ladder.id,
        dispatch: Some(dispatch_to_wire(&board)),
        rungs: progress_rungs(state, rungs)?,
        climbers: climbers_to_wire(&board, &now()?),
        runs_unreviewed,
    })
}

/// Rungs with their newest ingested versions, as the board shows them.
fn progress_rungs(
    state: &AppState,
    rungs: Vec<LadderRung>,
) -> Result<Vec<LadderProgressRung>, ApiError> {
    let mut latest: HashMap<String, String> = HashMap::new();
    let mut out = Vec::with_capacity(rungs.len());
    for (position, rung) in rungs.into_iter().enumerate() {
        let latest_version = match latest.get(&rung.slug) {
            Some(version) => version.clone(),
            None => {
                let version = state
                    .store
                    .list_visible_versions(&rung.slug, state.config.allow_experimental)
                    .map_err(ApiError::from)?
                    .pop()
                    .unwrap_or_default();
                latest.insert(rung.slug.clone(), version.clone());
                version
            }
        };
        out.push(LadderProgressRung {
            // A case that is not ingested has no newer version to point at, so it is not
            // flagged: there is nothing for the owner to bump to.
            stale: !latest_version.is_empty() && latest_version != rung.version,
            rung,
            position: position as u32,
            latest_version,
        });
    }
    Ok(out)
}

/// A dispatch on the wire.
fn dispatch_to_wire(board: &DispatchBoard) -> LadderDispatch {
    let (slots, runs) = board.totals();
    let count = |status: ClimberStatus| {
        board
            .climbers
            .iter()
            .filter(|climber| climber.walk.status == status)
            .count() as u32
    };
    LadderDispatch {
        id: board.dispatch.id.clone(),
        status: board.status(),
        started_at: board.dispatch.started_at.clone(),
        ended_at: board.dispatch.ended_at.clone(),
        gate: board.snapshot.gate,
        outer_axis: board.snapshot.outer_axis,
        in_flight_limit: board.snapshot.in_flight_limit,
        retry_count: board.snapshot.retry_count,
        slots,
        runs,
        climbers_running: count(ClimberStatus::Running),
        climbers_blocked: count(ClimberStatus::Blocked),
        climbers_failed: count(ClimberStatus::Failed),
        climbers_completed: count(ClimberStatus::Completed),
    }
}

/// A dispatch's climbers on the wire. `now` stamps a verdict a read computed live.
fn climbers_to_wire(board: &DispatchBoard, now: &str) -> Vec<LadderClimber> {
    board
        .climbers
        .iter()
        .map(|climber| {
            let combo = &climber.member.combo;
            let slots = climber
                .walk
                .slots
                .iter()
                .enumerate()
                .map(|(position, slot)| {
                    let rung = &board.snapshot.rungs[position];
                    let facts = &climber.slots[position];
                    let reached = !matches!(slot.status, SlotStatus::Pending | SlotStatus::Skipped);
                    let has_evidence = !facts.runs.is_empty() || !facts.job_ids.is_empty();
                    let decided_at = match slot.status {
                        SlotStatus::Passed | SlotStatus::Failed => Some(
                            board
                                .decided
                                .get(&(rung.id.clone(), climber.stored.climber_key.clone()))
                                .map(|(_, at)| at.clone())
                                .unwrap_or_else(|| now.to_string()),
                        ),
                        _ => None,
                    };
                    LadderSlot {
                        rung_id: rung.id.clone(),
                        position: position as u32,
                        status: slot.status,
                        tally: (reached || has_evidence).then(|| RungTally::from_gate(slot.tally)),
                        decided_at,
                        run_ids: facts.runs.iter().map(|run| run.id.clone()).collect(),
                        job_ids: facts.job_ids.clone(),
                    }
                })
                .collect();
            LadderClimber {
                key: climber.stored.climber_key.clone(),
                harness: combo.harness,
                model: combo.model.clone(),
                provider: combo.provider.clone(),
                gg_config_id: combo.gg_config_id.clone(),
                gg_config_name: combo.gg_config_name.clone(),
                gg_slot_models: combo.gg_slot_models.clone(),
                unlaunchable: climber.member.unlaunchable.clone(),
                status: climber.walk.status,
                blocked: climber.walk.blocked.clone(),
                current_rung: climber.walk.current.map(|position| position as u32),
                slots,
            }
        })
        .collect()
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

/// The origin prefix every job of one dispatch carries: `ladder:<ladder>/<dispatch>`.
fn dispatch_prefix(ladder_id: &str, dispatch_id: &str) -> String {
    format!("ladder:{ladder_id}/{dispatch_id}")
}

/// A dispatch's snapshot.
fn parse_snapshot(dispatch: &StoredDispatch) -> Result<DispatchSnapshot, ApiError> {
    serde_json::from_str(&dispatch.snapshot_json)
        .map_err(|e| ApiError::internal(format!("reading a dispatch snapshot: {e}")))
}

/// The snapshot a Run takes of a configuration, with every rung's target resolved, the
/// limit in force and the retry limit.
fn snapshot_of(ladder: &StoredLadder, in_flight_limit: InFlightLimit) -> DispatchSnapshot {
    DispatchSnapshot {
        rungs: ladder
            .rungs
            .iter()
            .map(|rung| SnapshotRung {
                id: rung.id.clone(),
                slug: rung.slug.clone(),
                version: rung.version.clone(),
                variant: rung.variant.clone(),
                engine: rung.engine.clone(),
                runs: rung.runs_override,
                target: rung.runs_override.unwrap_or(ladder.runs_per_cell),
            })
            .collect(),
        gate: ladder.gate,
        outer_axis: LadderAxis::parse(&ladder.outer_axis),
        in_flight_limit,
        retry_count: ladder.retry_count,
        runs_per_cell: ladder.runs_per_cell,
    }
}

/// The climbers a Run stores: every resolved member once, by its key, in resolved
/// order, with its combination in the stored form and its cell share pinned when it
/// resolved.
///
/// A member that resolves to the very cells of an earlier one is not stored: it asks for
/// exactly that climber's runs, and two climbers sharing one set of runs would launch
/// them twice and judge them twice.
fn dispatch_climbers_of(members: &[PlanMember]) -> Result<Vec<StoredDispatchClimber>, ApiError> {
    let mut seen = std::collections::HashSet::new();
    let mut cells: std::collections::HashSet<MemberCellIdentity> = std::collections::HashSet::new();
    let mut climbers = Vec::with_capacity(members.len());
    for member in members {
        let key = climber_key(&member.combo);
        if !seen.insert(key.clone()) {
            continue;
        }
        let identity = resolved_identity(member);
        if let Some(identity) = &identity
            && !cells.insert(identity.clone())
        {
            continue;
        }
        climbers.push(StoredDispatchClimber {
            climber_key: key,
            position: climbers.len() as u32,
            combo_json: serde_json::to_string(&member.combo.for_storage())
                .map_err(|e| ApiError::internal(format!("encoding a climber: {e}")))?,
            cell_json: identity.as_ref().map(encode_identity).transpose()?,
            retried_at: None,
        });
    }
    Ok(climbers)
}

/// A resolved member's cell share, or `None` when it could not be resolved (its launch
/// model is empty — the identity no run carries).
fn resolved_identity(member: &PlanMember) -> Option<MemberCellIdentity> {
    (!member.launch_model.is_empty()).then(|| member.cell_identity())
}

/// A cell share as `ladder_dispatch_climber.cell_json` stores it.
fn encode_identity(identity: &MemberCellIdentity) -> Result<String, ApiError> {
    let (harness, model, config_id, models) = identity;
    serde_json::to_string(&[harness, model, config_id, models])
        .map_err(|e| ApiError::internal(format!("encoding a climber's cells: {e}")))
}

/// A stored cell share.
fn decode_identity(json: &str) -> Result<MemberCellIdentity, ApiError> {
    let [harness, model, config_id, models]: [String; 4] = serde_json::from_str(json)
        .map_err(|e| ApiError::internal(format!("reading a climber's cells: {e}")))?;
    Ok((harness, model, config_id, models))
}

/// Why a climber whose configuration now resolves to other cells than the ones its
/// dispatch pinned is not launched: its new runs would land where this dispatch never
/// looks.
const MOVED_CELLS: &str = "its gg configuration now launches different runs from the ones \
                           this dispatch started with; restore it, or Stop and Run again";

/// Why a climber is not launched by a pass that found it pinned by another pass meanwhile.
const PINNING: &str = "this climber was resolved by another launch pass just now; the next \
                       pass launches it";

/// Why a climber that resolved for the first time mid-dispatch is not launched: an
/// earlier climber of the dispatch already asks for exactly these runs.
const SHARED_CELLS: &str = "another climber of this dispatch already asks for exactly \
                            these runs";

/// The key a climber's state is stored against.
///
/// Always taken from the member as it would be **stored**, never from the shape a request
/// happened to arrive in: a read hands a client back a gg climber with its
/// configuration's name and its root model filled in, and echoing that straight back
/// into `.../climbers/retry` has to address the very climber it was read from.
fn climber_key(combo: &ReviewPlanCombo) -> String {
    combination_key(&combo.for_storage())
}

/// A rung as the coverage machinery names a case.
#[cfg(test)]
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

/// A stored ladder on the wire, its one-off climbers filled in from `library`.
///
/// What is stored is a pointer — a configuration id and its slot bindings — so every read
/// resolves it, which is what makes a renamed configuration rename it everywhere at once.
fn ladder_to_wire(stored: StoredLadder, library: &GgLibrary) -> Ladder {
    Ladder {
        id: stored.id,
        name: stored.name,
        runs_per_cell: stored.runs_per_cell,
        gate: stored.gate,
        combo_group_ids: stored.combo_group_ids,
        combos: for_read(&stored.combos, library),
        rungs: stored.rungs.iter().map(rung_to_wire).collect(),
        outer_axis: LadderAxis::parse(&stored.outer_axis),
        in_flight_limit: stored.in_flight_limit.map(clamp_in_flight_limit),
        retry_count: clamp_retry_count(stored.retry_count),
        updated_at: stored.updated_at,
    }
}

/// Build a stored ladder from a create/update body: clamp the targets, the limit and the
/// retry limit, sanitize the gate, and mint ids for new rungs.
///
/// Three things are rejected rather than accepted-and-broken, because every one of them
/// fails *silently* later: an empty climb, a climb longer than the cap, and a duplicated
/// rung id. The fourth check — a rung whose case version no gate can ever resolve —
/// needs the definition store and lives in [`reject_ineligible_rungs`], so this stays
/// pure.
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
        // climber is the configuration it names and the models it binds.
        combos: for_storage(input.combos),
        rungs,
        outer_axis: input.outer_axis.as_str().to_string(),
        in_flight_limit: input.in_flight_limit.map(clamp_in_flight_limit),
        retry_count: clamp_retry_count(input.retry_count.unwrap_or_else(default_retry_count)),
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
/// to run that many times — it would fail every climber forever, which is a silent
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
