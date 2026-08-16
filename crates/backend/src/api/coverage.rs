//! The reviewer coverage endpoints: reusable groups, multiple declarative plans,
//! the coverage matrix computed from a plan, and the controls that **feed** a plan
//! — its review buffer, its top-up, its review queue, and its halts.
//!
//! A reviewer builds **groups** — named, reusable sets of harness+model
//! **combinations** (`kind = "combo"`) or version-pinned test **cases**
//! (`kind = "case"`) — and **plans** that reference those groups as pointers, so
//! editing a group reshapes every plan that references it. A plan is **hybrid**: it
//! references groups *and* may pin individual one-off combinations/cases; the
//! backend resolves the referenced groups, unions them with the one-offs, and
//! de-dupes before crossing cases × combinations into cells. Each plan carries its
//! own target runs-per-cell, so the model space can be split into smaller,
//! separately triggerable plans.
//!
//! ## Declaration versus schedule
//!
//! A plan is two things, deliberately kept apart everywhere (here, and in the store
//! — see [`crate::db::CoveragePlanSchedule`]): its **declaration** (the members and
//! the runs-per-cell target, [`CoveragePlan`]) and its **schedule** (the order it
//! emits cells in, whether it is paused, whether a submitted review tops it up, and
//! its buffer-target override, [`CoverageSchedule`]). They are edited by different
//! gestures at different moments, so saving an edit to a plan's model list can never
//! silently un-pause it. The two are flattened back together on the wire as
//! [`CoveragePlanOut`], because a reviewer reading a plan wants one object.
//!
//! ## The scope seam
//!
//! Everything is per-account (attributed to the token's account via [`AuthUser`])
//! and private to the reviewer, but "per-account" means two different things and the
//! difference is load-bearing:
//!
//! - **Counts are global.** A cell's completed runs and in-flight jobs count every
//!   run of that cell whoever launched it, so a run someone else already produced is
//!   never re-requested.
//! - **Judgement is per-account.** [`CoverageCell::unreviewed`] is the runs *you*
//!   have not looked at, and it is what bounds the review buffer — which is what
//!   stops a plan racing ahead of the person reviewing it.
//!
//! `GET /coverage-plans/{id}/coverage` expands one plan into its cells and
//! `GET /coverage-plans/summary` returns the per-plan roll-ups the account's Coverage
//! tab and the Home widget show. `POST /coverage-plans/{id}/topup` runs the shared
//! scheduler ([`crate::coverage::schedule`]) and enqueues what it decides;
//! `GET /coverage-plans/{id}/queue` returns the plan's unreviewed-by-you runs *in the
//! plan's own order*, so reviewing walks the buffer in the order it was deliberately
//! filled rather than newest-first.
//!
//! This is console-only reviewer tooling: the public static site never reaches it
//! (it carries no bearer token and never mounts this transport).

use std::collections::{HashMap, HashSet};

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use test_cabinet_core::run_record::HarnessSlug;

use crate::auth::AuthUser;
use crate::coverage::schedule::{CellDemand, outstanding_across, top_up};
use crate::db::{
    CANCELABLE_ACTIVE_STATES, CANCELABLE_WAITING_STATES, CellKey, JobCancelFilter, JobOrigin,
    SortDir, SummaryFilter, SummarySort, SummaryState,
};
use crate::error::ApiError;

use super::AppState;

/// The largest target a plan may set for its runs-per-cell count. A guard against
/// a fat-fingered value fanning out into thousands of queued runs; well above any
/// real review target.
const MAX_RUNS_PER_CELL: u32 = 100;

/// The review-buffer size applied to an account that has never chosen one.
///
/// The buffer bounds how much work a top-up leaves waiting on the reviewer, so the
/// default has to be small enough that the first few reviews still steer the plan
/// (which is the entire point of buffering rather than firing the whole matrix) and
/// large enough that the queue never runs dry between review sessions. Ten runs is
/// roughly two cells at a typical five-runs-per-cell target.
const DEFAULT_BUFFER_TARGET: u32 = 10;

/// The largest review buffer an account or plan may set. The same class of guard as
/// [`MAX_RUNS_PER_CELL`]: the buffer is the only thing bounding a top-up's fan-out,
/// so a mistyped value here is a mistyped value in units of queued runs.
const MAX_BUFFER_TARGET: u32 = 500;

/// The most runs one scoped review queue returns. The queue exists to be walked in
/// order, not paged through — a reviewer works from the front of it — so it is
/// capped rather than paginated, comfortably above [`MAX_BUFFER_TARGET`] so a full
/// buffer is always visible whole.
const MAX_QUEUE_RUNS: usize = 600;

/// How many of a cell's completed runs the queue inspects when picking out the
/// unreviewed ones, newest first.
///
/// A cell's *target* is capped at [`MAX_RUNS_PER_CELL`], so a cell holding more
/// completed runs than this has accumulated them across many plans and hand-launches
/// over a long period; its unreviewed ones are the recent ones. Bounding the read
/// keeps a queue over a wide plan from assembling every run the cabinet ever ran.
const QUEUE_CELL_SCAN: usize = 100;

/// One test case in a plan or a case group, pinned to an exact version (and
/// variant). Coverage is counted against exactly this version; the matrix flags it
/// when a newer version has since been ingested.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ReviewPlanCase {
    /// The test-case slug (e.g. `caldera`).
    pub slug: String,
    /// The pinned, exact version (e.g. `v1.2.0`).
    pub version: String,
    /// The variant to cover (e.g. `base`).
    pub variant: String,
}

/// One harness+model combination in a plan or a combo group. The optional provider
/// mirrors the new-run form's per-combination provider for provider-routed
/// harnesses.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ReviewPlanCombo {
    /// The agent harness to drive.
    pub harness: HarnessSlug,
    /// The opaque model id passed to the harness.
    pub model: String,
    /// The provider for a provider-routed harness, or null.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub provider: Option<String>,
}

/// Which kind of members a coverage group holds: harness+model combinations or
/// version-pinned cases. A group holds one kind; a plan references groups of both.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum CoverageGroupKind {
    /// A group of harness+model combinations.
    Combo,
    /// A group of version-pinned test cases.
    Case,
}

impl CoverageGroupKind {
    /// The stored/wire token for the kind.
    pub fn as_str(self) -> &'static str {
        match self {
            CoverageGroupKind::Combo => "combo",
            CoverageGroupKind::Case => "case",
        }
    }

    /// Parse a stored kind token, erroring on an unknown value (a corrupt row).
    pub fn parse(s: &str) -> Result<Self, ApiError> {
        match s {
            "combo" => Ok(CoverageGroupKind::Combo),
            "case" => Ok(CoverageGroupKind::Case),
            other => Err(ApiError::internal(format!(
                "unknown coverage group kind: {other}"
            ))),
        }
    }
}

/// Which axis a coverage plan's cell loop nests on — and therefore the order its
/// runs execute in, since a top-up emits cells in this order, `job.queue_seq` is
/// monotonic, and the dispatcher claims in ascending order.
///
/// The console labels these "One case at a time" and "One model at a time". They are
/// deliberately *not* described to reviewers as depth- or breadth-first: the choice
/// is about what you want to be able to review together, not about tree traversal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum CoverageAxis {
    /// Finish one case across every combination before starting the next case. The
    /// default, and what every plan did before the axis was selectable.
    #[default]
    Case,
    /// Finish one combination across every case before starting the next
    /// combination — "take this model all the way through the plan".
    Combination,
}

impl CoverageAxis {
    /// The stored/wire token for the axis.
    pub fn as_str(self) -> &'static str {
        match self {
            CoverageAxis::Case => "case",
            CoverageAxis::Combination => "combination",
        }
    }

    /// Parse a stored axis token. An unrecognized value falls back to the default
    /// rather than erroring: the axis only decides emission *order*, so a row written
    /// by a newer build degrades to today's ordering instead of making the plan
    /// unreadable.
    pub fn parse(token: &str) -> Self {
        match token {
            "combination" => CoverageAxis::Combination,
            _ => CoverageAxis::Case,
        }
    }
}

/// How a plan is **fed**, as opposed to what it declares.
///
/// Split from [`CoveragePlan`] because the two are edited by different gestures —
/// the members and the target are the plan's definition, these are the controls a
/// reviewer reaches for while it is running — so writing one can never clobber the
/// other. Flattened into [`CoveragePlanOut`] on the way out, so a reader still sees
/// one object.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CoverageSchedule {
    /// Which axis the cell loop nests on, and therefore the order runs execute in.
    #[serde(default)]
    pub outer_axis: CoverageAxis,
    /// Whether topping up is suspended. The mildest halting control: no new runs are
    /// emitted and everything already queued is left alone.
    #[serde(default)]
    pub paused: bool,
    /// Whether submitting a review re-runs this plan's top-up automatically. Off by
    /// default, so an existing plan never silently starts enqueueing.
    #[serde(default)]
    pub auto_top_up: bool,
    /// This plan's override of the account's review-buffer target, or null to inherit
    /// it. Null and `0` are different instructions — "no opinion" versus "never top
    /// up" — which is why this is nullable rather than defaulted to zero.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub buffer_target: Option<u32>,
}

impl Default for CoverageSchedule {
    /// The behaviour a plan had before it could be scheduled at all: cases outer, not
    /// paused, never topping itself up, no opinion on the buffer target.
    fn default() -> Self {
        Self {
            outer_axis: CoverageAxis::Case,
            paused: false,
            auto_top_up: false,
            buffer_target: None,
        }
    }
}

impl CoverageSchedule {
    /// Lift a stored schedule onto the wire, resolving its free-text axis token.
    fn from_db(stored: crate::db::CoveragePlanSchedule) -> Self {
        Self {
            outer_axis: CoverageAxis::parse(&stored.outer_axis),
            paused: stored.paused,
            auto_top_up: stored.auto_top_up,
            buffer_target: stored.buffer_target.map(clamp_buffer_target),
        }
    }

    /// Lower this schedule to the store's shape, clamping the buffer override for the
    /// same reason [`plan_from_input`] clamps the runs-per-cell target: the buffer is
    /// what bounds a top-up's fan-out.
    fn to_db(&self) -> crate::db::CoveragePlanSchedule {
        crate::db::CoveragePlanSchedule {
            outer_axis: self.outer_axis.as_str().to_string(),
            paused: self.paused,
            auto_top_up: self.auto_top_up,
            buffer_target: self.buffer_target.map(clamp_buffer_target),
        }
    }
}

/// A reviewer's saved, reusable group of combinations or cases. Referenced by plans
/// as a pointer; editing the group reshapes every plan that references it. Exactly
/// one of `combos`/`cases` is populated, per `kind`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CoverageGroup {
    /// The group's opaque id (minted on create).
    pub id: String,
    /// The reviewer-chosen display name.
    pub name: String,
    /// The member kind.
    pub kind: CoverageGroupKind,
    /// The harness+model combinations, when `kind` is `combo` (else empty).
    pub combos: Vec<ReviewPlanCombo>,
    /// The version-pinned cases, when `kind` is `case` (else empty).
    pub cases: Vec<ReviewPlanCase>,
    /// RFC 3339 of when the group was last saved.
    pub updated_at: String,
}

/// The create/update body for a coverage group (the server assigns `id` and
/// `updatedAt`). Only the members matching `kind` are kept.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CoverageGroupInput {
    /// The reviewer-chosen display name.
    pub name: String,
    /// The member kind.
    pub kind: CoverageGroupKind,
    /// The harness+model combinations (kept only when `kind` is `combo`).
    #[serde(default)]
    pub combos: Vec<ReviewPlanCombo>,
    /// The version-pinned cases (kept only when `kind` is `case`).
    #[serde(default)]
    pub cases: Vec<ReviewPlanCase>,
}

/// A reviewer's named coverage plan **as declared**: the groups it references, any
/// one-off members, and the target runs-per-cell. Persisted whole; one account may
/// hold many.
///
/// How the plan is *fed* is [`CoverageSchedule`], stored beside this and never
/// written by a declaration save. Handlers return the two flattened together as
/// [`CoveragePlanOut`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CoveragePlan {
    /// The plan's opaque id (minted on create).
    pub id: String,
    /// The reviewer-chosen display name.
    pub name: String,
    /// The target number of runs desired for each `case × combination` cell.
    pub runs_per_cell: u32,
    /// The referenced combination groups' ids.
    pub combo_group_ids: Vec<String>,
    /// The referenced case groups' ids.
    pub case_group_ids: Vec<String>,
    /// One-off combinations pinned directly on the plan (unioned with the groups).
    pub combos: Vec<ReviewPlanCombo>,
    /// One-off cases pinned directly on the plan (unioned with the groups).
    pub cases: Vec<ReviewPlanCase>,
    /// RFC 3339 of when the plan was last saved.
    pub updated_at: String,
}

/// One plan as a reader sees it: its declaration and its schedule, flattened into a
/// single object so `outerAxis`, `paused`, `autoTopUp`, and `bufferTarget` sit
/// alongside the plan's own fields. The split exists in the code and the store, not
/// in the reviewer's mental model.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CoveragePlanOut {
    /// The plan's declaration.
    #[serde(flatten)]
    pub plan: CoveragePlan,
    /// How the plan is being fed.
    #[serde(flatten)]
    pub schedule: CoverageSchedule,
}

/// The create/update body for a coverage plan (the server assigns `id` and
/// `updatedAt`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CoveragePlanInput {
    /// The reviewer-chosen display name.
    pub name: String,
    /// The target number of runs desired for each `case × combination` cell.
    pub runs_per_cell: u32,
    /// The referenced combination groups' ids.
    #[serde(default)]
    pub combo_group_ids: Vec<String>,
    /// The referenced case groups' ids.
    #[serde(default)]
    pub case_group_ids: Vec<String>,
    /// One-off combinations pinned directly on the plan.
    #[serde(default)]
    pub combos: Vec<ReviewPlanCombo>,
    /// One-off cases pinned directly on the plan.
    #[serde(default)]
    pub cases: Vec<ReviewPlanCase>,
    /// The schedule to apply along with this save, or null to leave it alone.
    ///
    /// Nested and optional rather than flattened into the body, and that is the whole
    /// point: a console that saves an edited member list without sending a schedule
    /// cannot un-pause the plan or reset its buffer target as a side effect. On
    /// **create** an absent schedule means [`CoverageSchedule::default`] — today's
    /// behaviour exactly.
    #[serde(default)]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub schedule: Option<CoverageSchedule>,
}

/// One cell of the coverage matrix: a plan case (at its pinned version) crossed
/// with a resolved combination, with the run/job counts that say how close it is to
/// the target and how much of it is waiting on the requester.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CoverageCell {
    /// The test-case slug.
    pub slug: String,
    /// The pinned version this cell counts against.
    pub version: String,
    /// The variant.
    pub variant: String,
    /// The harness.
    pub harness: HarnessSlug,
    /// The model id.
    pub model: String,
    /// The provider for a provider-routed harness, or null.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub provider: Option<String>,
    /// The target run count (the plan's `runs_per_cell`).
    pub desired: u32,
    /// Completed runs for this cell, counted globally.
    pub completed: u32,
    /// In-flight jobs (queued / pending / dispatched / starting / running) for this
    /// cell, counted globally.
    pub in_flight: u32,
    /// How many of [`Self::in_flight`] are `pending` — deliberately held back rather
    /// than merely waiting to be claimed, because their harness is at its parallelism
    /// cap or (for a game jam) another run of the same jam is already going on that
    /// model.
    ///
    /// Surfaced separately because it is the answer to "why is my buffer full but
    /// nothing running?", which is otherwise indistinguishable from a stuck queue. It
    /// is a **subset** of `inFlight`, not an addition to it.
    pub pending: u32,
    /// How many of [`Self::completed`] the **requesting account** has not reviewed.
    /// The only per-account number on the cell: it changes nothing about what the
    /// cell needs, but it occupies the review buffer, which is what makes an
    /// otherwise mysteriously idle plan explicable.
    pub unreviewed: u32,
    /// How many more runs to trigger: `max(0, desired - (completed + in_flight))`.
    pub remaining: u32,
    /// The newest ingested version of this case (may differ from `version` when
    /// the pin is stale). Empty when the case is not ingested.
    pub latest_version: String,
    /// Whether the pinned `version` is not the newest ingested one — a hint to the
    /// reviewer that they may want to bump the pin.
    pub stale: bool,
}

/// The coverage matrix `GET /coverage-plans/{id}/coverage` returns: every cell plus
/// the rollups the plan dashboard header shows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CoverageMatrix {
    /// Every `case × combination` cell, in the plan's own emission order — which
    /// axis is outer is the plan's [`CoverageSchedule::outer_axis`], echoed below so
    /// a reader knows what the order means without fetching the plan again.
    pub cells: Vec<CoverageCell>,
    /// The axis the cells above are ordered on.
    pub outer_axis: CoverageAxis,
    /// How many cells have met their target (`remaining == 0`).
    pub cells_satisfied: u32,
    /// The total number of cells.
    pub cells_total: u32,
    /// The sum of every cell's `remaining` — the total runs still to trigger.
    pub runs_missing: u32,
    /// The sum of every cell's `pending` — runs deliberately held back by the queue.
    pub runs_pending: u32,
    /// The sum of every cell's `unreviewed` — completed runs waiting on *you*.
    pub runs_unreviewed: u32,
    /// The plan's review-buffer occupancy: in-flight jobs plus unreviewed runs. When
    /// this has reached `bufferTarget`, a top-up will deliberately enqueue nothing,
    /// which is the difference between a finished plan and a full one.
    pub runs_outstanding: u32,
    /// The buffer target in force for this plan (its own override, else the
    /// account's setting, else the backend default).
    pub buffer_target: u32,
}

/// One plan's coverage roll-up for the plans list and the Home widget: the cell
/// counts without the per-cell detail the dashboard fetches on open.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CoveragePlanSummary {
    /// The plan's id.
    pub id: String,
    /// The plan's display name.
    pub name: String,
    /// The plan's target runs-per-cell.
    pub runs_per_cell: u32,
    /// How many cells have met their target.
    pub cells_satisfied: u32,
    /// The total number of cells.
    pub cells_total: u32,
    /// The total runs still to trigger across the plan.
    pub runs_missing: u32,
    /// The completed runs across the plan the requester has not reviewed.
    pub runs_unreviewed: u32,
    /// Whether the plan is paused. Carried on the summary so the list can say why a
    /// plan with missing runs is not filling itself.
    pub paused: bool,
    /// Whether a submitted review tops this plan up.
    pub auto_top_up: bool,
}

/// The account-wide coverage settings `GET`/`PUT /coverage-settings` read and write.
/// One setting today; the resource exists because the review buffer is a property of
/// the *reviewer* (how much work they want waiting on them) rather than of any one
/// plan, with a per-plan override for the exceptions.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CoverageSettings {
    /// The account's default review-buffer target: how many runs a top-up may leave
    /// outstanding (in flight, or finished and unreviewed) before it stops.
    pub buffer_target: u32,
    /// Whether [`Self::buffer_target`] is the account's own choice or the backend's
    /// compiled-in default because they have never chosen one. A `PUT` always makes
    /// it a choice.
    pub is_default: bool,
}

/// The `PUT /coverage-settings` body.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CoverageSettingsInput {
    /// The review-buffer target to store, clamped to `MAX_BUFFER_TARGET`. `0` is a
    /// legitimate value — "never top me up automatically" — and is stored as such.
    pub buffer_target: u32,
}

/// Why a top-up did no work. Distinguishing these matters: "paused" is a decision
/// the reviewer made and can undo, "busy" is a moment that will pass, and neither is
/// the same as a top-up that ran and found nothing to launch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum TopUpSkipped {
    /// The plan or ladder is paused.
    Paused,
    /// Another top-up of the same plan or ladder holds the claim. Top-up is
    /// serialized per plan so two console tabs (or a fast double review submit)
    /// cannot both observe the same shortfall and both enqueue for it.
    Busy,
}

/// One cell a top-up launched, and the jobs it enqueued for it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct TopUpLaunch {
    /// The ladder rung this cell belongs to, or null for a coverage plan (which has
    /// no rungs). Shared shape, because plans and ladders top up through the same
    /// code path and a console showing "what did that button just do" wants one
    /// answer format.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub rung_id: Option<String>,
    /// The test-case slug.
    pub slug: String,
    /// The pinned version.
    pub version: String,
    /// The variant.
    pub variant: String,
    /// The harness.
    pub harness: HarnessSlug,
    /// The combination's canonical model id (not the launched one — see
    /// [`test_cabinet_core::model_id::launch_model_id`]).
    pub model: String,
    /// The provider for a provider-routed harness, or null.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub provider: Option<String>,
    /// How many runs were enqueued for this cell — always the cell's whole shortfall,
    /// never a partial cell.
    pub runs: u32,
    /// The enqueued jobs' ids, in queue order, so a console can follow them straight
    /// into its in-progress list.
    pub job_ids: Vec<String>,
}

/// What a top-up did, reported in enough detail that an idle plan is never a
/// mystery: whether it ran at all, what the buffer allowed, and exactly what it
/// enqueued.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct TopUpResult {
    /// Why nothing was attempted, or null when the scheduler ran. A top-up that ran
    /// and enqueued nothing (a full buffer, or a satisfied plan) reports null here
    /// with `enqueued` zero — deliberately distinct from having been skipped.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub skipped: Option<TopUpSkipped>,
    /// The buffer target in force (the plan's override, else the account's setting,
    /// else the backend default).
    pub buffer_target: u32,
    /// The requester's buffer occupancy as the scheduler saw it, or null when it
    /// never ran.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub outstanding: Option<u32>,
    /// How many runs were enqueued in total.
    pub enqueued: u32,
    /// The cells that were launched, in the order they were emitted — which is the
    /// order they will execute and therefore be reviewed in.
    pub cells: Vec<TopUpLaunch>,
}

/// One run in a scoped review queue: a completed run of this plan (or ladder) the
/// requesting account has not reviewed.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CoverageQueueEntry {
    /// The run's id — what the console opens to review it.
    pub run_id: String,
    /// The ladder rung this run belongs to, or null for a coverage plan.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub rung_id: Option<String>,
    /// The test-case slug.
    pub slug: String,
    /// The test-case version.
    pub version: String,
    /// The variant.
    pub variant: String,
    /// The harness.
    pub harness: HarnessSlug,
    /// The model id the run was launched with.
    pub model: String,
    /// RFC 3339 of when the run finished.
    pub finished_at: String,
}

/// The plan's (or ladder's) unreviewed-by-me runs, in its own order.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CoverageQueue {
    /// The runs to review, in the order the plan or ladder emitted their cells —
    /// **not** newest-first like the global Unreviewed page. Reviewing walks the
    /// buffer in the order it was deliberately filled, which is what makes a case's
    /// repeats comparable against each other.
    pub runs: Vec<CoverageQueueEntry>,
    /// Whether the listing was cut short at the cap. A queue is walked from the
    /// front, not paged, so this is a "there is more behind this" flag rather than a
    /// cursor.
    pub truncated: bool,
}

/// The `POST …/pause` body: the pause state to set. A body rather than two verbs so
/// the control is idempotent and a console can drive a toggle without tracking which
/// direction it is going.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PauseInput {
    /// Whether topping up should be suspended.
    pub paused: bool,
}

/// What a halt did — a plan's or a ladder's, which differ only in what they sweep.
///
/// The **count is the point**, not a nicety: a halt that reports only success cannot
/// be told apart from a halt whose scope was wrong, and the reviewer's next move
/// differs completely between "the queue was already empty" and "nothing I launched
/// was found". The plan or ladder is always left paused, which is why that is stated
/// here in prose rather than reported as a field that could only ever say `true`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct HaltResult {
    /// How many jobs were moved to `canceled`.
    pub canceled: u32,
    /// Whether the halt also reached jobs that were already executing (`halt all`)
    /// rather than only the ones that had cost nothing yet.
    pub included_active: bool,
}

// ---- Groups ---------------------------------------------------------------

/// `GET /coverage-groups` — every group the token account owns, both kinds.
pub async fn list_groups(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<Vec<CoverageGroup>>, ApiError> {
    let groups = state
        .db
        .list_coverage_groups(&user.0.id)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(groups))
}

/// `POST /coverage-groups` — create a group. Only the members matching `kind` are
/// kept, so a `combo` group never carries stray cases and vice versa.
pub async fn create_group(
    State(state): State<AppState>,
    user: AuthUser,
    Json(input): Json<CoverageGroupInput>,
) -> Result<Json<CoverageGroup>, ApiError> {
    let group = group_from_input(new_id(), input, &now()?);
    state
        .db
        .insert_coverage_group(&user.0.id, &group)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(group))
}

/// `PUT /coverage-groups/{id}` — update a group in place. 404 when the id is not the
/// caller's.
pub async fn update_group(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(input): Json<CoverageGroupInput>,
) -> Result<Json<CoverageGroup>, ApiError> {
    let group = group_from_input(id, input, &now()?);
    let updated = state
        .db
        .update_coverage_group(&user.0.id, &group)
        .await
        .map_err(ApiError::from)?;
    if !updated {
        return Err(ApiError::not_found("coverage group not found"));
    }
    Ok(Json(group))
}

/// `DELETE /coverage-groups/{id}` — delete a group. Plans that still reference it
/// simply ignore the dangling id at coverage time, so no cascade is needed. 404
/// when the id is not the caller's.
pub async fn delete_group(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let deleted = state
        .db
        .delete_coverage_group(&user.0.id, &id)
        .await
        .map_err(ApiError::from)?;
    if !deleted {
        return Err(ApiError::not_found("coverage group not found"));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ---- Plans ----------------------------------------------------------------

/// `GET /coverage-plans` — every plan the token account owns, each with its
/// schedule.
pub async fn list_plans(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<Vec<CoveragePlanOut>>, ApiError> {
    let plans = state
        .db
        .list_coverage_plans(&user.0.id)
        .await
        .map_err(ApiError::from)?;
    let mut out = Vec::with_capacity(plans.len());
    for plan in plans {
        let schedule = plan_schedule_of(&state, &user.0.id, &plan.id).await?;
        out.push(CoveragePlanOut { plan, schedule });
    }
    Ok(Json(out))
}

/// `POST /coverage-plans` — create a plan. The runs-per-cell target is clamped to a
/// sane maximum so a mistyped value cannot fan out into thousands of queued runs, and
/// an absent schedule starts the plan on [`CoverageSchedule::default`] — indis-
/// tinguishable from the plans that existed before a plan could be scheduled at all.
pub async fn create_plan(
    State(state): State<AppState>,
    user: AuthUser,
    Json(input): Json<CoveragePlanInput>,
) -> Result<Json<CoveragePlanOut>, ApiError> {
    let (plan, schedule) = plan_from_input(new_id(), input, &now()?);
    let schedule = schedule.unwrap_or_default();
    state
        .db
        .insert_coverage_plan(&user.0.id, &plan, &schedule.to_db())
        .await
        .map_err(ApiError::from)?;
    Ok(Json(CoveragePlanOut { plan, schedule }))
}

/// `PUT /coverage-plans/{id}` — update a plan in place. 404 when the id is not the
/// caller's.
///
/// The declaration is always written; the schedule only when the body carried one, so
/// saving an edited member list cannot un-pause a plan the reviewer paused a moment
/// earlier. The response reports whichever schedule is now in force.
pub async fn update_plan(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(input): Json<CoveragePlanInput>,
) -> Result<Json<CoveragePlanOut>, ApiError> {
    let (plan, schedule) = plan_from_input(id, input, &now()?);
    let updated = state
        .db
        .update_coverage_plan(&user.0.id, &plan)
        .await
        .map_err(ApiError::from)?;
    if !updated {
        return Err(ApiError::not_found("coverage plan not found"));
    }
    let schedule = match schedule {
        Some(schedule) => {
            state
                .db
                .set_coverage_plan_schedule(&user.0.id, &plan.id, &schedule.to_db())
                .await
                .map_err(ApiError::from)?;
            schedule
        }
        None => plan_schedule_of(&state, &user.0.id, &plan.id).await?,
    };
    Ok(Json(CoveragePlanOut { plan, schedule }))
}

/// `DELETE /coverage-plans/{id}` — delete a plan. 404 when the id is not the
/// caller's.
///
/// Jobs the plan launched are deliberately left alone: a job is a run in its own
/// right and records the plan only as its origin, so deleting the plan you launched
/// from is not a reason to throw away runs that already cost money. Halt first if
/// that is what you meant.
pub async fn delete_plan(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let deleted = state
        .db
        .delete_coverage_plan(&user.0.id, &id)
        .await
        .map_err(ApiError::from)?;
    if !deleted {
        return Err(ApiError::not_found("coverage plan not found"));
    }
    Ok(StatusCode::NO_CONTENT)
}

/// `GET /coverage-plans/summary` — the per-plan roll-ups for the plans list and the
/// Home widget. Resolves every plan's members, gathers the union of their case slugs
/// so the grouped count queries run once for the whole account, then tallies
/// each plan against those counts.
pub async fn plans_summary(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<Vec<CoveragePlanSummary>>, ApiError> {
    let plans = state
        .db
        .list_coverage_plans(&user.0.id)
        .await
        .map_err(ApiError::from)?;
    let groups = group_index(&state, &user.0.id).await?;

    let resolved: Vec<(&CoveragePlan, Vec<ReviewPlanCombo>, Vec<ReviewPlanCase>)> = plans
        .iter()
        .map(|plan| {
            let (combos, cases) = resolve_members(plan, &groups);
            (plan, combos, cases)
        })
        .collect();

    let all_slugs: Vec<String> = resolved
        .iter()
        .flat_map(|(_, _, cases)| cases.iter().map(|c| c.slug.clone()))
        .collect();
    let ctx = MatrixCtx::load(&state, all_slugs, &user.0.id, false).await?;

    let mut summaries = Vec::with_capacity(resolved.len());
    for (plan, combos, cases) in &resolved {
        let schedule = plan_schedule_of(&state, &user.0.id, &plan.id).await?;
        let roll = ctx.tally(plan.runs_per_cell, schedule.outer_axis, combos, cases);
        summaries.push(CoveragePlanSummary {
            id: plan.id.clone(),
            name: plan.name.clone(),
            runs_per_cell: plan.runs_per_cell,
            cells_satisfied: roll.cells_satisfied,
            cells_total: roll.cells_total,
            runs_missing: roll.runs_missing,
            runs_unreviewed: roll.runs_unreviewed,
            paused: schedule.paused,
            auto_top_up: schedule.auto_top_up,
        });
    }
    Ok(Json(summaries))
}

/// `GET /coverage-plans/{id}/coverage` — the coverage matrix for one plan, in the
/// plan's own emission order. 404 when the id is not the caller's.
pub async fn plan_coverage(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<CoverageMatrix>, ApiError> {
    let plan = load_plan(&state, &user.0.id, &id).await?;
    let schedule = plan_schedule_of(&state, &user.0.id, &id).await?;
    let groups = group_index(&state, &user.0.id).await?;
    let (combos, cases) = resolve_members(&plan, &groups);

    let slugs: Vec<String> = cases.iter().map(|c| c.slug.clone()).collect();
    let ctx = MatrixCtx::load(&state, slugs, &user.0.id, false).await?;
    let buffer_target = resolve_buffer_target(&state, &user.0.id, schedule.buffer_target).await?;
    Ok(Json(ctx.matrix(
        plan.runs_per_cell,
        schedule.outer_axis,
        buffer_target,
        &combos,
        &cases,
    )))
}

// ---- Plan schedule + account settings --------------------------------------

/// `GET /coverage-plans/{id}/schedule` — how one plan is being fed. 404 when the id
/// is not the caller's.
pub async fn plan_schedule(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<CoverageSchedule>, ApiError> {
    Ok(Json(plan_schedule_of(&state, &user.0.id, &id).await?))
}

/// `PUT /coverage-plans/{id}/schedule` — replace how one plan is being fed, without
/// re-sending (or racing) its member lists. 404 when the id is not the caller's.
pub async fn set_plan_schedule(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(schedule): Json<CoverageSchedule>,
) -> Result<Json<CoverageSchedule>, ApiError> {
    let updated = state
        .db
        .set_coverage_plan_schedule(&user.0.id, &id, &schedule.to_db())
        .await
        .map_err(ApiError::from)?;
    if !updated {
        return Err(ApiError::not_found("coverage plan not found"));
    }
    Ok(Json(schedule))
}

/// `GET /coverage-settings` — the account's coverage settings, falling back to the
/// backend's compiled-in default when the account has never chosen one (no row is
/// materialized on read).
pub async fn settings(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<CoverageSettings>, ApiError> {
    let stored = state
        .db
        .coverage_buffer_target(&user.0.id)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(CoverageSettings {
        buffer_target: stored
            .map(clamp_buffer_target)
            .unwrap_or(DEFAULT_BUFFER_TARGET),
        is_default: stored.is_none(),
    }))
}

/// `PUT /coverage-settings` — set the account's default review-buffer target,
/// creating its settings row on first use.
pub async fn set_settings(
    State(state): State<AppState>,
    user: AuthUser,
    Json(input): Json<CoverageSettingsInput>,
) -> Result<Json<CoverageSettings>, ApiError> {
    let buffer_target = clamp_buffer_target(input.buffer_target);
    state
        .db
        .set_coverage_buffer_target(&user.0.id, buffer_target, &now()?)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(CoverageSettings {
        buffer_target,
        is_default: false,
    }))
}

// ---- Top-up ----------------------------------------------------------------

/// `POST /coverage-plans/{id}/topup` — refill the plan's review buffer: walk its
/// cells in its own order, skip the ones already at target (counted globally), and
/// enqueue whole cells until the requester has `bufferTarget` runs outstanding.
///
/// This is an endpoint the console calls, not a background daemon, so it is
/// **serialized per plan** by a claim on the plan row: two tabs, or one fast double
/// review-submit, would otherwise both observe the same shortfall and both enqueue
/// for it. It is otherwise idempotent — it recomputes the shortfall from the store
/// on every call, and the jobs it just enqueued count as in flight the next time.
///
/// 404 when the id is not the caller's.
pub async fn top_up_plan(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<TopUpResult>, ApiError> {
    let plan = load_plan(&state, &user.0.id, &id).await?;
    let schedule = plan_schedule_of(&state, &user.0.id, &id).await?;
    let buffer_target = resolve_buffer_target(&state, &user.0.id, schedule.buffer_target).await?;
    if schedule.paused {
        return Ok(Json(TopUpResult::skipped_by(
            TopUpSkipped::Paused,
            buffer_target,
        )));
    }

    let claimed = state
        .db
        .claim_coverage_plan_top_up(&user.0.id, &id, &now()?)
        .await
        .map_err(ApiError::from)?;
    if !claimed {
        return Ok(Json(TopUpResult::skipped_by(
            TopUpSkipped::Busy,
            buffer_target,
        )));
    }

    // Everything from here to the release runs under the claim. The release is
    // unconditional — a claim nobody releases only expires after the store's lease,
    // and stalling the plan for that long because a top-up failed would turn one bad
    // request into a wedged plan.
    let worked = plan_top_up_locked(&state, &user, &plan, schedule.outer_axis, buffer_target).await;
    let released = state.db.release_coverage_plan_top_up(&id).await;
    let result = worked?;
    released.map_err(ApiError::from)?;
    Ok(Json(result))
}

/// The body of [`top_up_plan`], run while this caller holds the plan's top-up claim.
/// Split out so the claim is released on every path, including a failure.
async fn plan_top_up_locked(
    state: &AppState,
    user: &AuthUser,
    plan: &CoveragePlan,
    axis: CoverageAxis,
    buffer_target: u32,
) -> Result<TopUpResult, ApiError> {
    let groups = group_index(state, &user.0.id).await?;
    let (combos, cases) = resolve_members(plan, &groups);
    let slugs: Vec<String> = cases.iter().map(|c| c.slug.clone()).collect();
    // A coverage plan has no gate, so a run whose build never loaded still wants a
    // human to look at it and still occupies a buffer slot. Only a ladder, which can
    // decide such a run without a reviewer, excludes them.
    let ctx = MatrixCtx::load(state, slugs, &user.0.id, false).await?;

    let ordered = cells_in_order(axis, &combos, &cases);
    let demands: Vec<CellDemand> = ordered
        .iter()
        .map(|(case, combo)| ctx.demand(plan.runs_per_cell, case, combo))
        .collect();
    let outstanding = outstanding_across(&demands);
    let launches = top_up(&demands, buffer_target, outstanding);

    let cells: Vec<TopUpCell<'_>> = launches
        .iter()
        .map(|launch| {
            let (case, combo) = ordered[launch.cell];
            TopUpCell {
                rung_id: None,
                case,
                combo,
                runs: launch.runs,
            }
        })
        .collect();
    let launched = enqueue_top_up(state, user, &JobOrigin::Plan(plan.id.clone()), &cells).await?;

    Ok(TopUpResult {
        skipped: None,
        buffer_target,
        outstanding: Some(outstanding),
        enqueued: launched.iter().map(|cell| cell.runs).sum(),
        cells: launched,
    })
}

// ---- Scoped review queue ---------------------------------------------------

/// `GET /coverage-plans/{id}/queue` — the plan's completed runs the requesting
/// account has not reviewed, **in the plan's own cell order**.
///
/// The global Unreviewed page is newest-first, which is right for a worklist and
/// wrong for a buffer: a plan fills its buffer in a deliberate order so a case's
/// repeats arrive together and can be judged against each other, and reviewing them
/// out of order throws that away. 404 when the id is not the caller's.
pub async fn plan_queue(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<CoverageQueue>, ApiError> {
    let plan = load_plan(&state, &user.0.id, &id).await?;
    let schedule = plan_schedule_of(&state, &user.0.id, &id).await?;
    let groups = group_index(&state, &user.0.id).await?;
    let (combos, cases) = resolve_members(&plan, &groups);
    let slugs: Vec<String> = cases.iter().map(|c| c.slug.clone()).collect();
    let ctx = MatrixCtx::load(&state, slugs, &user.0.id, false).await?;

    let cells: Vec<QueueCell<'_>> = cells_in_order(schedule.outer_axis, &combos, &cases)
        .into_iter()
        .map(|(case, combo)| QueueCell {
            rung_id: None,
            case,
            combo,
            unreviewed: ctx.unreviewed_for(case, combo),
        })
        .collect();
    Ok(Json(collect_queue(&state, &user.0.id, &cells).await?))
}

// ---- Halting ---------------------------------------------------------------

/// `POST /coverage-plans/{id}/pause` — suspend (or resume) topping this plan up,
/// leaving the queue untouched. The mildest of the three halting controls, and the
/// only one that cancels nothing. 404 when the id is not the caller's.
pub async fn pause_plan(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(input): Json<PauseInput>,
) -> Result<Json<CoverageSchedule>, ApiError> {
    let mut schedule = plan_schedule_of(&state, &user.0.id, &id).await?;
    schedule.paused = input.paused;
    state
        .db
        .set_coverage_plan_schedule(&user.0.id, &id, &schedule.to_db())
        .await
        .map_err(ApiError::from)?;
    Ok(Json(schedule))
}

/// `POST /coverage-plans/{id}/halt` — pause the plan **and** cancel the jobs it
/// launched that have cost nothing yet (`queued` and `pending`).
///
/// This is the common case, and it needs no confirmation precisely because it throws
/// nothing away: those jobs have no driver and have spent no tokens. It reaches only
/// jobs whose `origin` is this plan, so a run launched by hand in another tab is
/// never swept up. 404 when the id is not the caller's.
pub async fn halt_plan(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<HaltResult>, ApiError> {
    halt_plan_inner(state, user, id, false).await
}

/// `POST /coverage-plans/{id}/halt-all` — pause the plan and cancel **every** job it
/// launched, including the ones already dispatched, starting, or running.
///
/// The rare control: those jobs are partly or wholly paid for, so the console must
/// confirm before calling this and must never make it the default action. 404 when
/// the id is not the caller's.
pub async fn halt_all_plan(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<HaltResult>, ApiError> {
    halt_plan_inner(state, user, id, true).await
}

/// The shared body of [`halt_plan`] and [`halt_all_plan`], differing only in how far
/// into the in-flight states the cancel reaches.
async fn halt_plan_inner(
    state: AppState,
    user: AuthUser,
    id: String,
    include_active: bool,
) -> Result<Json<HaltResult>, ApiError> {
    let mut schedule = plan_schedule_of(&state, &user.0.id, &id).await?;
    // Pause first. A halt that cancelled the queue and left the plan topping itself
    // up would refill exactly what it just emptied.
    schedule.paused = true;
    state
        .db
        .set_coverage_plan_schedule(&user.0.id, &id, &schedule.to_db())
        .await
        .map_err(ApiError::from)?;
    let canceled = halt_jobs(
        &state,
        &JobOrigin::Plan(id.clone()),
        include_active,
        "canceled by a coverage plan halt",
    )
    .await?;
    Ok(Json(HaltResult {
        canceled,
        included_active: include_active,
    }))
}

/// Cancel the waiting (and optionally the already-executing) jobs one plan or ladder
/// launched, returning how many moved. Shared by both entities' halt controls.
///
/// This is the Runs page's global sweep narrowed to one origin — the *same* body, so
/// a scoped halt and a global stop can never differ in what they do to a run. That
/// matters for more than the transition: the sweep also closes the live stream of
/// every run that actually left the queue, which a `halt all` needs, since the runs
/// it cancels are executing ones whose monitors somebody is watching.
///
/// The `origin` filter is what keeps a halt to this plan's or ladder's own runs and
/// away from a hand-launched one, which carries no origin at all.
pub(super) async fn halt_jobs(
    state: &AppState,
    origin: &JobOrigin,
    include_active: bool,
    detail: &str,
) -> Result<u32, ApiError> {
    let mut states: Vec<&str> = CANCELABLE_WAITING_STATES.to_vec();
    if include_active {
        states.extend_from_slice(&CANCELABLE_ACTIVE_STATES);
    }
    crate::api::jobs::sweep_cancel(
        state,
        &JobCancelFilter {
            states: &states,
            origin: Some(origin),
            user_id: None,
        },
        detail,
    )
    .await
}

// ---- Resolution + matrix helpers ------------------------------------------

/// Load one plan, scoped to the requesting account, 404-ing when the id is unknown or
/// owned by someone else. Both are the same answer on purpose: a plan the caller does
/// not own must not be distinguishable from one that does not exist.
async fn load_plan(state: &AppState, user_id: &str, id: &str) -> Result<CoveragePlan, ApiError> {
    state
        .db
        .get_coverage_plan(user_id, id)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found("coverage plan not found"))
}

/// One plan's schedule, 404-ing when the id is not the caller's.
async fn plan_schedule_of(
    state: &AppState,
    user_id: &str,
    id: &str,
) -> Result<CoverageSchedule, ApiError> {
    state
        .db
        .coverage_plan_schedule(user_id, id)
        .await
        .map_err(ApiError::from)?
        .map(CoverageSchedule::from_db)
        .ok_or_else(|| ApiError::not_found("coverage plan not found"))
}

/// The review-buffer target in force: the plan's or ladder's own override, else the
/// account's setting, else the backend's compiled-in default.
///
/// An account with no stored setting has expressed no opinion, which is deliberately
/// not the same as an explicit `0` ("never top me up") — hence the two `Option`
/// layers rather than a single defaulted number.
pub(super) async fn resolve_buffer_target(
    state: &AppState,
    user_id: &str,
    override_target: Option<u32>,
) -> Result<u32, ApiError> {
    if let Some(target) = override_target {
        return Ok(clamp_buffer_target(target));
    }
    Ok(state
        .db
        .coverage_buffer_target(user_id)
        .await
        .map_err(ApiError::from)?
        .map(clamp_buffer_target)
        .unwrap_or(DEFAULT_BUFFER_TARGET))
}

/// Build the id → group map the resolver reads, from the account's groups.
pub(super) async fn group_index(
    state: &AppState,
    user_id: &str,
) -> Result<HashMap<String, CoverageGroup>, ApiError> {
    let groups = state
        .db
        .list_coverage_groups(user_id)
        .await
        .map_err(ApiError::from)?;
    Ok(groups.into_iter().map(|g| (g.id.clone(), g)).collect())
}

/// Resolve referenced combination groups and one-off combinations into the de-duped
/// combination list a matrix (or a ladder's climber board) is built from.
///
/// Group members come first, in reference order, then the one-offs; a combination is
/// identified by `(harness, model, provider)`, so the same member declared in two
/// groups — or in a group and as a one-off — appears exactly once. A referenced id
/// that no longer names a group is silently skipped: deleting a group is not an error
/// in the plans that pointed at it.
///
/// Factored out of [`resolve_members`] so a ladder, whose climbers are the same
/// `kind = "combo"` group pointers, resolves them through this and not a copy.
pub(super) fn resolve_combos(
    group_ids: &[String],
    one_offs: &[ReviewPlanCombo],
    groups: &HashMap<String, CoverageGroup>,
) -> Vec<ReviewPlanCombo> {
    let mut combos = Vec::new();
    let mut seen: HashSet<(String, String, String)> = HashSet::new();
    let mut push = |c: &ReviewPlanCombo, combos: &mut Vec<ReviewPlanCombo>| {
        let key = (
            c.harness.as_str().to_string(),
            c.model.clone(),
            c.provider.clone().unwrap_or_default(),
        );
        if seen.insert(key) {
            combos.push(c.clone());
        }
    };
    for id in group_ids {
        if let Some(group) = groups.get(id) {
            for c in &group.combos {
                push(c, &mut combos);
            }
        }
    }
    for c in one_offs {
        push(c, &mut combos);
    }
    combos
}

/// Resolve referenced case groups and one-off cases into the de-duped case list,
/// keyed by `(slug, version, variant)`. The case-side twin of [`resolve_combos`],
/// with the same ordering and dangling-reference rules.
pub(super) fn resolve_cases(
    group_ids: &[String],
    one_offs: &[ReviewPlanCase],
    groups: &HashMap<String, CoverageGroup>,
) -> Vec<ReviewPlanCase> {
    let mut cases = Vec::new();
    let mut seen: HashSet<(String, String, String)> = HashSet::new();
    let mut push = |c: &ReviewPlanCase, cases: &mut Vec<ReviewPlanCase>| {
        let key = (c.slug.clone(), c.version.clone(), c.variant.clone());
        if seen.insert(key) {
            cases.push(c.clone());
        }
    };
    for id in group_ids {
        if let Some(group) = groups.get(id) {
            for c in &group.cases {
                push(c, &mut cases);
            }
        }
    }
    for c in one_offs {
        push(c, &mut cases);
    }
    cases
}

/// Resolve a plan's referenced groups and one-off members into the de-duped
/// combinations and cases the matrix crosses.
fn resolve_members(
    plan: &CoveragePlan,
    groups: &HashMap<String, CoverageGroup>,
) -> (Vec<ReviewPlanCombo>, Vec<ReviewPlanCase>) {
    (
        resolve_combos(&plan.combo_group_ids, &plan.combos, groups),
        resolve_cases(&plan.case_group_ids, &plan.cases, groups),
    )
}

/// Every `case × combination` pair in the order `axis` chooses.
///
/// This ordering is the entire mechanism behind the outer-axis setting: a top-up
/// emits cells in this order, `job.queue_seq` is minted monotonically at enqueue, and
/// the dispatcher claims in ascending order — so emission order *is* execution order
/// and nothing in the dispatcher knows the axis exists. Both the matrix and the
/// roll-up walk through here, so the two can never disagree about which cells exist
/// or what order they are in.
pub(super) fn cells_in_order<'a>(
    axis: CoverageAxis,
    combos: &'a [ReviewPlanCombo],
    cases: &'a [ReviewPlanCase],
) -> Vec<(&'a ReviewPlanCase, &'a ReviewPlanCombo)> {
    let mut cells = Vec::with_capacity(cases.len() * combos.len());
    match axis {
        CoverageAxis::Case => {
            for case in cases {
                for combo in combos {
                    cells.push((case, combo));
                }
            }
        }
        CoverageAxis::Combination => {
            for combo in combos {
                for case in cases {
                    cells.push((case, combo));
                }
            }
        }
    }
    cells
}

/// A roll-up of a plan's cells without the per-cell detail.
struct MatrixRollup {
    cells_satisfied: u32,
    cells_total: u32,
    runs_missing: u32,
    runs_unreviewed: u32,
}

/// The run/job counts and latest-version resolution a coverage computation needs,
/// loaded once so a plan (or every plan, for the summary; or a ladder's whole board)
/// can be tallied without further DB round-trips. The counts and the per-slug latest
/// version are the only reads; the cross-product itself is pure.
pub(super) struct MatrixCtx {
    /// Completed runs per cell, counted globally.
    completed: crate::db::CellCounts,
    /// In-flight jobs per cell, counted globally.
    in_flight: crate::db::CellCounts,
    /// The `pending` subset of [`Self::in_flight`], per cell.
    pending: crate::db::CellCounts,
    /// Completed runs the requesting account has not reviewed, per cell. The only
    /// per-account number here.
    unreviewed: crate::db::CellCounts,
    /// The newest ingested version per case slug.
    latest_by_slug: HashMap<String, String>,
}

impl MatrixCtx {
    /// Load the counts and latest-version map for a set of case slugs (deduped
    /// internally), from the point of view of `reviewer_user_id`.
    ///
    /// `exclude_unloaded` leaves runs whose build never loaded out of the unreviewed
    /// count. A ladder whose gate counts an unloaded build as broken decides those
    /// without a reviewer, so they must not hold a buffer slot; a coverage plan has
    /// no gate and still wants a human to look, so it passes `false`.
    ///
    /// The latest version per slug honors the deployment's experimental visibility so
    /// "latest" matches what the catalog offers.
    pub(super) async fn load(
        state: &AppState,
        mut slugs: Vec<String>,
        reviewer_user_id: &str,
        exclude_unloaded: bool,
    ) -> Result<Self, ApiError> {
        slugs.sort();
        slugs.dedup();
        let completed = state
            .db
            .count_completed_runs_by_cell(&slugs)
            .await
            .map_err(ApiError::from)?;
        let in_flight = state
            .db
            .count_in_flight_jobs_by_cell(&slugs)
            .await
            .map_err(ApiError::from)?;
        let unreviewed = state
            .db
            .count_unreviewed_runs_by_cell(&slugs, reviewer_user_id, exclude_unloaded)
            .await
            .map_err(ApiError::from)?;
        let pending = pending_jobs_by_cell(state).await?;
        let mut latest_by_slug = HashMap::new();
        for slug in slugs {
            let version = state
                .store
                .list_visible_versions(&slug, state.config.allow_experimental)
                .map_err(ApiError::from)?
                .pop()
                .unwrap_or_default();
            latest_by_slug.insert(slug, version);
        }
        Ok(Self {
            completed,
            in_flight,
            pending,
            unreviewed,
            latest_by_slug,
        })
    }

    /// The full coverage matrix for one plan's resolved members, in `axis` order.
    fn matrix(
        &self,
        runs_per_cell: u32,
        axis: CoverageAxis,
        buffer_target: u32,
        combos: &[ReviewPlanCombo],
        cases: &[ReviewPlanCase],
    ) -> CoverageMatrix {
        let ordered = cells_in_order(axis, combos, cases);
        let mut cells = Vec::with_capacity(ordered.len());
        let mut cells_satisfied = 0u32;
        let mut runs_missing = 0u32;
        let mut runs_pending = 0u32;
        let mut runs_unreviewed = 0u32;
        let mut runs_outstanding = 0u32;
        for (case, combo) in ordered {
            let cell = self.cell(runs_per_cell, case, combo);
            if cell.remaining == 0 {
                cells_satisfied += 1;
            }
            runs_missing += cell.remaining;
            runs_pending += cell.pending;
            runs_unreviewed += cell.unreviewed;
            runs_outstanding += cell.in_flight + cell.unreviewed;
            cells.push(cell);
        }
        CoverageMatrix {
            cells_total: cells.len() as u32,
            cells,
            outer_axis: axis,
            cells_satisfied,
            runs_missing,
            runs_pending,
            runs_unreviewed,
            runs_outstanding,
            buffer_target,
        }
    }

    /// The roll-up (satisfied/total/missing/unreviewed) for one plan's resolved
    /// members, without materializing the per-cell detail.
    ///
    /// It walks the same [`cells_in_order`] the matrix does even though a sum does not
    /// care about order, so the two can never disagree about the cell set.
    fn tally(
        &self,
        runs_per_cell: u32,
        axis: CoverageAxis,
        combos: &[ReviewPlanCombo],
        cases: &[ReviewPlanCase],
    ) -> MatrixRollup {
        let ordered = cells_in_order(axis, combos, cases);
        let mut cells_satisfied = 0u32;
        let mut runs_missing = 0u32;
        let mut runs_unreviewed = 0u32;
        for (case, combo) in &ordered {
            let demand = self.demand(runs_per_cell, case, combo);
            let missing = demand.missing();
            if missing == 0 {
                cells_satisfied += 1;
            }
            runs_missing += missing;
            runs_unreviewed += demand.unreviewed;
        }
        MatrixRollup {
            cells_satisfied,
            cells_total: ordered.len() as u32,
            runs_missing,
            runs_unreviewed,
        }
    }

    /// One cell, fully described.
    pub(super) fn cell(
        &self,
        desired: u32,
        case: &ReviewPlanCase,
        combo: &ReviewPlanCombo,
    ) -> CoverageCell {
        let key = cell_key(case, combo);
        let demand = self.demand(desired, case, combo);
        let latest_version = self
            .latest_by_slug
            .get(&case.slug)
            .cloned()
            .unwrap_or_default();
        CoverageCell {
            slug: case.slug.clone(),
            version: case.version.clone(),
            variant: case.variant.clone(),
            harness: combo.harness,
            model: combo.model.clone(),
            provider: combo.provider.clone(),
            desired,
            completed: demand.completed,
            in_flight: demand.in_flight,
            pending: self.pending.get(&key).copied().unwrap_or(0),
            unreviewed: demand.unreviewed,
            remaining: demand.missing(),
            stale: !latest_version.is_empty() && latest_version != case.version,
            latest_version,
        }
    }

    /// One cell as the shared top-up scheduler sees it: what it wants, what exists,
    /// and how much of it occupies the requester's review buffer.
    ///
    /// Runs and jobs store the model id they were *launched* with, which for a
    /// provider-routed harness carries the `openrouter/` prefix the plan's canonical
    /// `combo.model` omits; the key matches that same launched id so provider-routed
    /// cells count their runs instead of always reading zero.
    pub(super) fn demand(
        &self,
        target: u32,
        case: &ReviewPlanCase,
        combo: &ReviewPlanCombo,
    ) -> CellDemand {
        let key = cell_key(case, combo);
        CellDemand {
            target,
            completed: self.completed.get(&key).copied().unwrap_or(0),
            in_flight: self.in_flight.get(&key).copied().unwrap_or(0),
            unreviewed: self.unreviewed.get(&key).copied().unwrap_or(0),
        }
    }

    /// The newest ingested version of one case slug, or the empty string when the case
    /// is not ingested at all. A property of the case alone, so a caller with no
    /// combination in hand (a ladder describing its rungs) can ask for it directly.
    pub(super) fn latest_version(&self, slug: &str) -> String {
        self.latest_by_slug.get(slug).cloned().unwrap_or_default()
    }

    /// How many of one cell's completed runs the requesting account has not reviewed.
    pub(super) fn unreviewed_for(&self, case: &ReviewPlanCase, combo: &ReviewPlanCombo) -> u32 {
        self.unreviewed
            .get(&cell_key(case, combo))
            .copied()
            .unwrap_or(0)
    }
}

/// The `(slug, version, variant, harness, launched model)` identity every grouped
/// coverage count is keyed by, and the identity a gate's evidence query takes.
pub(super) fn cell_key(case: &ReviewPlanCase, combo: &ReviewPlanCombo) -> CellKey {
    (
        case.slug.clone(),
        case.version.clone(),
        case.variant.clone(),
        combo.harness.as_str().to_string(),
        test_cabinet_core::model_id::launch_model_id(
            &combo.model,
            combo.harness,
            combo.provider.as_deref(),
        ),
    )
}

/// Count the jobs sitting in `pending` — held back behind a harness parallelism cap
/// or a same-model game jam — per coverage cell.
///
/// Derived from the same active-job read `GET /jobs/active` serves rather than from a
/// grouped query, because `pending` is a *display* distinction: the authority for
/// what counts toward a cell's target is [`crate::db::Db::count_in_flight_jobs_by_cell`],
/// which includes pending jobs and must keep doing so. Surfacing the subset separately
/// is what makes "the buffer is full but nothing is running" explicable instead of
/// looking like a stuck queue. The read is bounded by the queue's actual depth, which
/// is the same set the console already fetches whole for its in-progress list.
async fn pending_jobs_by_cell(state: &AppState) -> Result<crate::db::CellCounts, ApiError> {
    let mut counts = crate::db::CellCounts::new();
    for job in state.db.active_jobs().await.map_err(ApiError::from)? {
        if job.state != "pending" {
            continue;
        }
        *counts
            .entry((
                job.test_case_slug,
                job.test_case_version,
                job.variant,
                job.harness_slug,
                job.model_id,
            ))
            .or_insert(0) += 1;
    }
    Ok(counts)
}

// ---- Shared top-up enqueue + queue assembly --------------------------------

/// One cell a top-up decided to launch, ready to be turned into jobs. Borrowed
/// rather than owned so the caller keeps its resolved members as the source of truth.
pub(super) struct TopUpCell<'a> {
    /// The ladder rung this cell belongs to, or `None` for a coverage plan.
    pub rung_id: Option<String>,
    /// The case, at its pinned version.
    pub case: &'a ReviewPlanCase,
    /// The combination to run it on.
    pub combo: &'a ReviewPlanCombo,
    /// How many runs to enqueue — the cell's whole shortfall.
    pub runs: u32,
}

/// Enqueue a top-up's decided cells, attributing every job to the launching account
/// and to the plan or ladder that asked for it, and report what was enqueued.
///
/// The runs are emitted **in cell order, repeats adjacent**, and enqueued as one
/// batch: the batch takes a contiguous block of `queue_seq` positions in exactly this
/// order and the dispatcher claims in ascending order, so a cell's repeats start —
/// and therefore finish — together, which is what makes them reviewable against each
/// other.
///
/// `origin` is what a later scoped [`halt_jobs`] cancels by; without it a halt could
/// not tell this plan's queued runs from a run someone kicked off by hand.
pub(super) async fn enqueue_top_up(
    state: &AppState,
    user: &AuthUser,
    origin: &JobOrigin,
    cells: &[TopUpCell<'_>],
) -> Result<Vec<TopUpLaunch>, ApiError> {
    let now = now()?;
    let mut jobs: Vec<crate::db::NewJob> = Vec::new();
    let mut launched: Vec<TopUpLaunch> = Vec::with_capacity(cells.len());
    for cell in cells {
        if cell.runs == 0 {
            continue;
        }
        let launch_model = test_cabinet_core::model_id::launch_model_id(
            &cell.combo.model,
            cell.combo.harness,
            cell.combo.provider.as_deref(),
        );
        // A plan pins no orchestrator, runtime, or auth mode, so the request is the
        // console's default new-run shape: the one-shot orchestrator and the
        // backend's default retry policy.
        let body = test_cabinet_core::LaunchBody {
            test_case: cell.case.slug.clone(),
            version: cell.case.version.clone(),
            variant: cell.case.variant.clone(),
            harness: cell.combo.harness,
            model: launch_model.clone(),
            orchestrator: None,
            max_runtime_seconds: None,
            auth_mode: None,
            retry_count: None,
        };
        let request_json = serde_json::to_string(&body)
            .map_err(|e| ApiError::internal(format!("serializing launch request: {e}")))?;
        // The case's type is lifted onto the job so the queue can serialize the run
        // types that must not overlap (a game jam per model). A version that is not
        // ingested falls back to the default type rather than failing the top-up:
        // whether it resolves at all is the driver's call, and it reports that far
        // better than an enqueue-time guess would.
        let test_type = state
            .store
            .read_manifest(&cell.case.slug, &cell.case.version)
            .map(|manifest| manifest.test_type)
            .unwrap_or_default();

        let mut job_ids = Vec::with_capacity(cell.runs as usize);
        for _ in 0..cell.runs {
            let id = new_id();
            job_ids.push(id.clone());
            jobs.push(crate::db::NewJob {
                id,
                request_json: request_json.clone(),
                test_case_slug: cell.case.slug.clone(),
                test_case_version: cell.case.version.clone(),
                variant: cell.case.variant.clone(),
                test_type: test_type.as_str().to_string(),
                harness_slug: cell.combo.harness.as_str().to_string(),
                model_id: launch_model.clone(),
                job_token: new_id(),
                // A top-up's runs are initial attempts; the backend re-enqueues its
                // own automatic retries with an incremented `attempt`.
                attempt: 0,
                user_id: Some(user.0.id.clone()),
                origin: Some(origin.clone()),
                created_at: now.clone(),
            });
        }
        launched.push(TopUpLaunch {
            rung_id: cell.rung_id.clone(),
            slug: cell.case.slug.clone(),
            version: cell.case.version.clone(),
            variant: cell.case.variant.clone(),
            harness: cell.combo.harness,
            model: cell.combo.model.clone(),
            provider: cell.combo.provider.clone(),
            runs: cell.runs,
            job_ids,
        });
    }
    if jobs.is_empty() {
        return Ok(launched);
    }
    state.db.enqueue_jobs(jobs).await.map_err(ApiError::from)?;
    Ok(launched)
}

/// One cell of a scoped review queue, with the authoritative count of how many of its
/// completed runs the requester has not reviewed.
pub(super) struct QueueCell<'a> {
    /// The ladder rung this cell belongs to, or `None` for a coverage plan.
    pub rung_id: Option<String>,
    /// The case, at its pinned version.
    pub case: &'a ReviewPlanCase,
    /// The combination.
    pub combo: &'a ReviewPlanCombo,
    /// How many of the cell's completed runs the requester has not reviewed.
    pub unreviewed: u32,
}

/// Assemble a scoped review queue: walk `cells` in the caller's order and, for each
/// that has unreviewed runs, list them oldest-first.
///
/// Two properties are worth stating because they are easy to get subtly wrong:
///
/// - The **grouped unreviewed count** decides which cells are visited at all, and it
///   is the per-account, auto-graded-excluding count. That is what keeps a
///   [performance](test_cabinet_core::test_case::TestType::Performance) case — which
///   no reviewer can ever clear — out of a queue it would otherwise sit in forever.
/// - Within a cell the runs are read newest-first and then reversed, so a cell that
///   has accumulated many hundreds of runs over its lifetime still surfaces its
///   recent unreviewed ones, while the queue itself still reads oldest-first.
pub(super) async fn collect_queue(
    state: &AppState,
    user_id: &str,
    cells: &[QueueCell<'_>],
) -> Result<CoverageQueue, ApiError> {
    let mut runs: Vec<CoverageQueueEntry> = Vec::new();
    let mut truncated = false;
    for cell in cells {
        if cell.unreviewed == 0 {
            continue;
        }
        if runs.len() >= MAX_QUEUE_RUNS {
            truncated = true;
            break;
        }
        let launch_model = test_cabinet_core::model_id::launch_model_id(
            &cell.combo.model,
            cell.combo.harness,
            cell.combo.provider.as_deref(),
        );
        let filter = SummaryFilter {
            state: SummaryState::Review,
            test_case: Some(cell.case.slug.clone()),
            model: Some(launch_model),
            harness: Some(cell.combo.harness.as_str().to_string()),
            variant: Some(cell.case.variant.clone()),
            version: Some(cell.case.version.clone()),
            latest_versions: false,
            q: None,
        };
        let (found, _total) = state
            .db
            .list_summaries(
                &filter,
                SummarySort::Date,
                SortDir::Desc,
                QUEUE_CELL_SCAN,
                0,
            )
            .await
            .map_err(ApiError::from)?;
        let mut mine: Vec<CoverageQueueEntry> = found
            .into_iter()
            .filter(|run| {
                !run.reviews
                    .iter()
                    .any(|review| review.reviewer.user_id == user_id)
            })
            .map(|run| CoverageQueueEntry {
                run_id: run.record.id.clone(),
                rung_id: cell.rung_id.clone(),
                slug: run.record.subject.test_case_slug.clone(),
                version: run.record.subject.test_case_version.clone(),
                variant: run.record.subject.variant.clone(),
                harness: run.record.subject.harness_slug,
                model: run.record.subject.model_id.clone(),
                finished_at: run.record.finished_at.clone(),
            })
            .collect();
        mine.reverse();
        for entry in mine {
            if runs.len() >= MAX_QUEUE_RUNS {
                truncated = true;
                break;
            }
            runs.push(entry);
        }
    }
    Ok(CoverageQueue { runs, truncated })
}

// ---- Small constructors ---------------------------------------------------

/// Mint a fresh opaque id for a new group, plan, ladder, rung, or job.
pub(super) fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// The current time as an RFC 3339 `updatedAt` string.
pub(super) fn now() -> Result<String, ApiError> {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|e| ApiError::internal(format!("formatting updatedAt: {e}")))
}

/// Clamp a runs-per-cell target to the range the backend will honour. The floor is
/// one, not zero: a cell nobody wants any runs of is a cell that should not be in the
/// plan (or a rung that should not be on the ladder). Shared with the ladder
/// transport, whose rungs set the same kind of target.
pub(super) fn clamp_runs_per_cell(target: u32) -> u32 {
    target.clamp(1, MAX_RUNS_PER_CELL)
}

/// Clamp a review-buffer target to the range the backend will honour. `0` survives —
/// "never top up automatically" is a real instruction, unlike a runs-per-cell target
/// of zero, which would declare a cell nobody wants.
pub(super) fn clamp_buffer_target(target: u32) -> u32 {
    target.min(MAX_BUFFER_TARGET)
}

/// Build a stored group from a create/update body, keeping only the members that
/// match the declared kind.
fn group_from_input(id: String, input: CoverageGroupInput, updated_at: &str) -> CoverageGroup {
    let (combos, cases) = match input.kind {
        CoverageGroupKind::Combo => (input.combos, Vec::new()),
        CoverageGroupKind::Case => (Vec::new(), input.cases),
    };
    CoverageGroup {
        id,
        name: input.name,
        kind: input.kind,
        combos,
        cases,
        updated_at: updated_at.to_string(),
    }
}

/// Build a stored plan from a create/update body, clamping the runs-per-cell target,
/// and hand back the schedule the body asked for (if any) separately — the split the
/// store keeps.
fn plan_from_input(
    id: String,
    input: CoveragePlanInput,
    updated_at: &str,
) -> (CoveragePlan, Option<CoverageSchedule>) {
    (
        CoveragePlan {
            id,
            name: input.name,
            runs_per_cell: clamp_runs_per_cell(input.runs_per_cell),
            combo_group_ids: input.combo_group_ids,
            case_group_ids: input.case_group_ids,
            combos: input.combos,
            cases: input.cases,
            updated_at: updated_at.to_string(),
        },
        input.schedule,
    )
}

impl TopUpResult {
    /// A top-up that never ran, and why. The buffer target is still reported: the
    /// reviewer's next question after "it did nothing" is "what was it aiming for?".
    pub(super) fn skipped_by(reason: TopUpSkipped, buffer_target: u32) -> Self {
        Self {
            skipped: Some(reason),
            buffer_target,
            outstanding: None,
            enqueued: 0,
            cells: Vec::new(),
        }
    }
}

#[cfg(test)]
#[path = "coverage.test.rs"]
mod tests;
