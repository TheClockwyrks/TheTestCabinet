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

use std::collections::{BTreeMap, HashMap, HashSet};

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use test_cabinet_core::gg::GgCapabilitySet;
use test_cabinet_core::run_record::HarnessSlug;

use crate::auth::AuthUser;
use crate::coverage::schedule::{CellDemand, HarnessCapacity, outstanding_across, top_up};
use crate::db::{
    CANCELABLE_ACTIVE_STATES, CANCELABLE_WAITING_STATES, CellKey, JobCancelFilter, JobOrigin,
    SortDir, SummaryFilter, SummarySort, SummaryState, combination_key,
};
use crate::error::ApiError;
use crate::store::CaseNames;

use super::AppState;
use super::GgConfig;

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

/// One **pinned case** in a plan or a case group: a slug, an exact version, a variant,
/// and the [engine](test_cabinet_core::engine) its runs are built on. Coverage is counted
/// against exactly this pin; the matrix flags it when a newer version has since been
/// ingested.
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
    /// The engine to cover (e.g. `simple-2d`), or null for the `none` engine — the
    /// engineless run every case supports, and exactly what a plan scheduled before the
    /// pin carried an engine asked for.
    ///
    /// The engine is in the pin because a result is only comparable with another result
    /// on the same engine: a model handed a runtime and a documented API is doing
    /// different work from the same model starting from nothing, so one case at one
    /// version and variant on two engines is two pinned cases and two sets of cells.
    ///
    /// A pin naming an engine the version does not declare support for is accepted here
    /// and reported by the run, exactly as an uningested version is. The catalogue moves
    /// under a standing plan, so the check belongs where a run executes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub engine: Option<String>,
}

impl ReviewPlanCase {
    /// The pin's engine as the [cell key](crate::db::CellKey) segments it: the slug it
    /// names, or `none` when it names nothing. Absent and `none` are the same pin, so
    /// they must never be two cells.
    pub(super) fn engine_slug(&self) -> String {
        self.launch_engine()
            .unwrap_or_else(|| test_cabinet_core::engine::NONE_SLUG.to_string())
    }

    /// The pin's engine as a launch request carries it: the slug it names, or `None`
    /// where it names nothing, which is the key a launch omits to ask for the engineless
    /// run. A pin holding only whitespace is a pin holding nothing.
    pub(super) fn launch_engine(&self) -> Option<String> {
        self.engine
            .as_deref()
            .map(str::trim)
            .filter(|slug| !slug.is_empty())
            .map(str::to_string)
    }
}

/// One **combination** in a plan, a ladder, or a combo group: what a cell's runs are
/// executed by.
///
/// One type carrying two shapes, exactly as
/// [`ComparisonArm`](test_cabinet_core::comparison::ComparisonArm) already does. A
/// member naming a [`gg_config_id`](Self::gg_config_id) is a **gg combination** — a
/// saved [gg configuration](https://docs.testcabinet.ai/gg/configurations/) plus a model
/// for each launch slot it declares — and one without it is a **harness combination**:
/// a harness, the model it runs, and a provider for a provider-routed harness. They are
/// unioned into one list rather than split across two, so a plan crossing both against
/// its cases needs no second axis.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ReviewPlanCombo {
    /// The agent harness to drive — `gg` on a gg member.
    pub harness: HarnessSlug,
    /// The opaque model id passed to the harness. Empty in storage on a gg member,
    /// which binds a model per agent instead; a read fills it with the model the bound
    /// set's root agent runs on, so a client with no configuration in hand still has
    /// something to show.
    #[serde(default)]
    pub model: String,
    /// The provider for a provider-routed harness, or null.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub provider: Option<String>,
    /// The launcher's key for the gg configuration this member runs (`saved:<id>`), or
    /// null on a harness member. This is what makes a member a gg member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub gg_config_id: Option<String>,
    /// A model per [launch slot](https://docs.testcabinet.ai/gg/configurations/) the
    /// configuration declares, keyed by slot name. Empty on a harness member.
    ///
    /// Ordered (a `BTreeMap`) because it is compared and keyed, not merely read: two
    /// members binding the same slots must produce the same
    /// [`combination_key`] whatever order they arrived in.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub gg_slot_models: BTreeMap<String, String>,
    /// The configuration's current display name, filled on read and **never stored**.
    ///
    /// A configuration is renamed in one place, and a member that had stored the name it
    /// bore at the time would go on showing the old one forever.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub gg_config_name: Option<String>,
}

impl ReviewPlanCombo {
    /// The bare id of the gg configuration this member names, or `None` on a harness
    /// member.
    ///
    /// The stored value is whatever arrived, so the normalization happens here, on every
    /// read, rather than being written into the row — and it is
    /// the same rule (`api::gg::saved_config_id`) a launch's `presetId` goes through, so a
    /// member and the run it schedules name one configuration by one string.
    pub fn gg_config_ref(&self) -> Option<&str> {
        super::gg::saved_config_id(self.gg_config_id.as_deref()?)
    }

    /// This member's slot bindings in **canonical** form: every slot name and every model id
    /// trimmed.
    ///
    /// The bindings are not merely read, they are compared: two members are the same member
    /// when they bind the same models, and this is the one form that comparison is made in —
    /// by the de-dupe [key](combination_key), by the launch that binds them, and by the check
    /// that every declared slot is filled. Surrounding space in a pasted model id would
    /// otherwise make one written-down decision look like two: two members, two cells' worth
    /// of runs enqueued, and one cell to count them in.
    pub fn gg_bindings(&self) -> BTreeMap<String, String> {
        self.gg_slot_models
            .iter()
            .map(|(slot, model)| (slot.trim().to_string(), model.trim().to_string()))
            .collect()
    }

    /// This member as it is **stored**: unchanged for a harness member, and for a gg member
    /// stripped of every value a read derives — its `model`, its `provider`, and the
    /// configuration name — with its harness forced to [`Gg`](HarnessSlug::Gg).
    ///
    /// What a gg member *is* is the configuration it names and the models it binds to that
    /// configuration's launch slots; everything else about it is re-derived from the
    /// configuration on every read. Without this normalization a console that reads a plan
    /// and saves it back would store the name and the root model as they stood at that
    /// moment, and the member would go on reporting them after the configuration had been
    /// renamed or re-bound — a stale value nothing would ever correct, because nothing else
    /// writes those fields.
    pub fn for_storage(&self) -> ReviewPlanCombo {
        if self.gg_config_ref().is_none() {
            return self.clone();
        }
        ReviewPlanCombo {
            harness: HarnessSlug::Gg,
            model: String::new(),
            provider: None,
            gg_config_id: self.gg_config_id.clone(),
            gg_slot_models: self.gg_bindings(),
            gg_config_name: None,
        }
    }
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
    /// The engine this cell counts against, resolved: `none` where the pin names none.
    /// Always concrete, because a run recorded with no engine is a `none` run and the
    /// two must land in one cell.
    pub engine: String,
    /// The harness — `gg` on a gg cell.
    pub harness: HarnessSlug,
    /// The model id: the one a harness cell's runs are launched with, and on a gg cell the
    /// one its bound set's root agent runs.
    pub model: String,
    /// The provider for a provider-routed harness, or null.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub provider: Option<String>,
    /// The gg configuration this cell's runs are launched from, as the member names it, or
    /// null on a harness cell.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub gg_config_id: Option<String>,
    /// That configuration's current display name — what the cell is labelled by, and the
    /// first gg segment of its [identity](crate::db::CellKey). Null on a harness cell, and
    /// on a gg cell whose configuration no longer exists.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub gg_config_name: Option<String>,
    /// The model bound to each of the configuration's launch slots. Empty on a harness cell.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub gg_slot_models: BTreeMap<String, String>,
    /// Why a top-up cannot launch this cell, or null when it can.
    ///
    /// A cell whose member cannot be resolved is still counted and still reported — it keeps
    /// its place in the matrix carrying the reason — because a plan that silently got
    /// smaller is a plan whose missing runs nobody can explain.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub unlaunchable: Option<String>,
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
    /// The engine the enqueued runs are built on, resolved: `none` where the cell's pin
    /// names none.
    pub engine: String,
    /// The harness.
    pub harness: HarnessSlug,
    /// The combination's canonical model id (not the launched one — see
    /// [`test_cabinet_core::model_id::launch_model_id`]).
    pub model: String,
    /// The provider for a provider-routed harness, or null.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub provider: Option<String>,
    /// The gg configuration the launched member names, or null on a harness member.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub gg_config_id: Option<String>,
    /// That configuration's current display name, when it still exists.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub gg_config_name: Option<String>,
    /// The model bound to each of the configuration's launch slots. Empty on a harness member.
    ///
    /// Reported for the same reason the blocked list reports it: `gg` and a root model are not
    /// a name — two configurations, or two arms of one, read identically without it, and a
    /// report of what a top-up just launched that cannot tell them apart is not a report.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub gg_slot_models: BTreeMap<String, String>,
    /// How many runs were enqueued for this cell — always the cell's whole shortfall,
    /// never a partial cell.
    pub runs: u32,
    /// The enqueued jobs' ids, in queue order, so a console can follow them straight
    /// into its in-progress list.
    pub job_ids: Vec<String>,
}

/// One cell a top-up **could not** launch, and why.
///
/// Reported per cell rather than per member, and beside the launches rather than instead of
/// them, because the two answer different halves of "why is this plan idle": a top-up that
/// enqueued four cells and skipped two broken ones is working, and a reviewer needs to see
/// both numbers to know that.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct TopUpBlocked {
    /// The ladder rung this cell belongs to, or null for a coverage plan.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub rung_id: Option<String>,
    /// The test-case slug.
    pub slug: String,
    /// The pinned version.
    pub version: String,
    /// The variant.
    pub variant: String,
    /// The engine the cell would have launched on, resolved: `none` where the pin names
    /// none.
    pub engine: String,
    /// The harness — `gg` on a gg member.
    pub harness: HarnessSlug,
    /// The combination's model id, empty when the member could not be resolved far enough
    /// to have one.
    pub model: String,
    /// The provider for a provider-routed harness, or null.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub provider: Option<String>,
    /// The gg configuration the member names, or null on a harness member.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub gg_config_id: Option<String>,
    /// That configuration's current display name, when it still exists.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub gg_config_name: Option<String>,
    /// The model bound to each of the configuration's launch slots. Empty on a harness member.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub gg_slot_models: BTreeMap<String, String>,
    /// Why the cell could not be launched, in the words a reviewer has to act on.
    pub reason: String,
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
    /// The cells the top-up wanted to launch and could not, each with its reason — a
    /// configuration that has been deleted, a launch slot nothing is bound to, or a model
    /// the catalog can resolve no context window for.
    ///
    /// One broken member never stops the rest of the plan being fed, so this list and
    /// [`Self::cells`] are routinely both non-empty.
    pub unlaunchable: Vec<TopUpBlocked>,
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
    /// The engine the run was built on, resolved: `none` where the cell's pin names none.
    pub engine: String,
    /// The harness.
    pub harness: HarnessSlug,
    /// The model id the run was launched with.
    pub model: String,
    /// The gg configuration the run's cell names, or null on a harness cell.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub gg_config_id: Option<String>,
    /// That configuration's current display name.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub gg_config_name: Option<String>,
    /// The model bound to each of the configuration's launch slots. Empty on a harness cell.
    ///
    /// The queue carries the member's whole identity rather than the run's harness and model,
    /// because on a gg cell those two are `gg` and a root model — the same two values for every
    /// configuration the plan crosses and for every arm of each. A worklist whose rows cannot
    /// be told apart is a worklist a reviewer cannot open in an informed order, and telling
    /// exactly those arms apart is what the plan was built for.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub gg_slot_models: BTreeMap<String, String>,
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
    let mut groups = state
        .db
        .list_coverage_groups(&user.0.id)
        .await
        .map_err(ApiError::from)?;
    let library = read_gg_library(
        &state,
        &user.0.id,
        groups.iter().flat_map(|group| group.combos.iter()),
    )
    .await?;
    for group in &mut groups {
        group.combos = for_read(&group.combos, &library);
    }
    Ok(Json(groups))
}

/// `POST /coverage-groups` — create a group. Only the members matching `kind` are
/// kept, so a `combo` group never carries stray cases and vice versa.
///
/// `400` for a gg member naming a configuration the account does not own or leaving one of
/// its launch slots unbound — a member that could never produce a run, refused where the
/// reviewer wrote it.
pub async fn create_group(
    State(state): State<AppState>,
    user: AuthUser,
    Json(input): Json<CoverageGroupInput>,
) -> Result<Json<CoverageGroup>, ApiError> {
    let library = reject_unstorable_members(&state, &user.0.id, &input.combos, &[]).await?;
    let mut group = group_from_input(new_id(), input, &now()?);
    state
        .db
        .insert_coverage_group(&user.0.id, &group)
        .await
        .map_err(ApiError::from)?;
    // Stored as the pointer, answered as the read shape — the same thing a later `GET`
    // returns, so a console that keeps the response never holds a different object.
    group.combos = for_read(&group.combos, &library);
    Ok(Json(group))
}

/// `PUT /coverage-groups/{id}` — update a group in place. 404 when the id is not the
/// caller's, and `400` for an unstorable gg member (see [`create_group`]).
pub async fn update_group(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(input): Json<CoverageGroupInput>,
) -> Result<Json<CoverageGroup>, ApiError> {
    // What the group already holds, so a member that was valid when it was written is not
    // re-judged now that the configuration under it has moved on.
    let stored = state
        .db
        .get_coverage_group(&user.0.id, &id)
        .await
        .map_err(ApiError::from)?
        .map(|group| group.combos)
        .unwrap_or_default();
    let library = reject_unstorable_members(&state, &user.0.id, &input.combos, &stored).await?;
    let mut group = group_from_input(id, input, &now()?);
    let updated = state
        .db
        .update_coverage_group(&user.0.id, &group)
        .await
        .map_err(ApiError::from)?;
    if !updated {
        return Err(ApiError::not_found("coverage group not found"));
    }
    group.combos = for_read(&group.combos, &library);
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
    let library = read_gg_library(
        &state,
        &user.0.id,
        plans.iter().flat_map(|plan| plan.combos.iter()),
    )
    .await?;
    let mut out = Vec::with_capacity(plans.len());
    for mut plan in plans {
        let schedule = plan_schedule_of(&state, &user.0.id, &plan.id).await?;
        plan.combos = for_read(&plan.combos, &library);
        out.push(CoveragePlanOut { plan, schedule });
    }
    Ok(Json(out))
}

/// `POST /coverage-plans` — create a plan. The runs-per-cell target is clamped to a
/// sane maximum so a mistyped value cannot fan out into thousands of queued runs, and
/// an absent schedule starts the plan on [`CoverageSchedule::default`] — indis-
/// tinguishable from the plans that existed before a plan could be scheduled at all.
///
/// `400` for a one-off gg member the account cannot launch (see [`create_group`]).
pub async fn create_plan(
    State(state): State<AppState>,
    user: AuthUser,
    Json(input): Json<CoveragePlanInput>,
) -> Result<Json<CoveragePlanOut>, ApiError> {
    let library = reject_unstorable_members(&state, &user.0.id, &input.combos, &[]).await?;
    let (mut plan, schedule) = plan_from_input(new_id(), input, &now()?);
    let schedule = schedule.unwrap_or_default();
    state
        .db
        .insert_coverage_plan(&user.0.id, &plan, &schedule.to_db())
        .await
        .map_err(ApiError::from)?;
    plan.combos = for_read(&plan.combos, &library);
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
    // The members already on the plan, exempt from re-judgement — see
    // [`reject_unstorable_members`].
    let stored = state
        .db
        .get_coverage_plan(&user.0.id, &id)
        .await
        .map_err(ApiError::from)?
        .map(|plan| plan.combos)
        .unwrap_or_default();
    let library = reject_unstorable_members(&state, &user.0.id, &input.combos, &stored).await?;
    let (mut plan, schedule) = plan_from_input(id, input, &now()?);
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
    plan.combos = for_read(&plan.combos, &library);
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
    let library = gg_library(&state, &user.0.id).await?;

    let resolved: Vec<(&CoveragePlan, Vec<PlanMember>, Vec<ReviewPlanCase>)> = plans
        .iter()
        .map(|plan| {
            let (combos, cases) = resolve_members(plan, &groups, &library);
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
    let library = gg_library(&state, &user.0.id).await?;
    let (combos, cases) = resolve_members(&plan, &groups, &library);

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
    let library = gg_library(state, &user.0.id).await?;
    let (mut combos, cases) = resolve_members(plan, &groups, &library);
    // Before the scheduler decides anything: a gg member whose models the catalog cannot
    // answer for has to be unlaunchable *now*, or it spends buffer and capacity on runs that
    // are never enqueued and starves the members that could have used them.
    resolve_gg_launch_facts(state, &mut combos).await;
    let slugs: Vec<String> = cases.iter().map(|c| c.slug.clone()).collect();
    // A coverage plan has no gate, so a run whose build never loaded still wants a
    // human to look at it and still occupies a buffer slot. Only a ladder, which can
    // decide such a run without a reviewer, excludes them.
    let ctx = MatrixCtx::load(state, slugs, &user.0.id, false).await?;

    let ordered = cells_in_order(axis, &combos, &cases);
    let mut demands: Vec<CellDemand> = Vec::with_capacity(ordered.len());
    let mut unlaunchable: Vec<TopUpBlocked> = Vec::new();
    for (case, member) in &ordered {
        let demand = ctx.demand(plan.runs_per_cell, case, member);
        // Reported only when the cell actually wanted runs: a cell already at its target is
        // skipped before the reason it could not be launched ever matters.
        if let Some(reason) = &member.unlaunchable
            && demand.missing() > 0
        {
            unlaunchable.push(blocked_cell(None, case, member, reason.clone()));
        }
        demands.push(launchable_demand(demand, member));
    }
    let outstanding = outstanding_across(&demands);
    let launches = top_up(&demands, ctx.harness_capacity(), buffer_target, outstanding);

    let cells: Vec<TopUpCell<'_>> = launches
        .iter()
        .map(|launch| {
            let (case, member) = ordered[launch.cell];
            TopUpCell {
                rung_id: None,
                case,
                member,
                runs: launch.runs,
            }
        })
        .collect();
    let enqueued = enqueue_top_up(state, user, &JobOrigin::Plan(plan.id.clone()), &cells).await?;
    unlaunchable.extend(enqueued.blocked);

    Ok(TopUpResult {
        skipped: None,
        buffer_target,
        outstanding: Some(outstanding),
        enqueued: enqueued.launched.iter().map(|cell| cell.runs).sum(),
        cells: enqueued.launched,
        unlaunchable,
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
    let library = gg_library(&state, &user.0.id).await?;
    let (combos, cases) = resolve_members(&plan, &groups, &library);
    let slugs: Vec<String> = cases.iter().map(|c| c.slug.clone()).collect();
    let ctx = MatrixCtx::load(&state, slugs, &user.0.id, false).await?;

    let cells: Vec<QueueCell<'_>> = cells_in_order(schedule.outer_axis, &combos, &cases)
        .into_iter()
        .map(|(case, member)| QueueCell {
            rung_id: None,
            case,
            member,
            unreviewed: ctx.unreviewed_for(case, member),
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

/// One **resolved** member of a plan, a group, or a ladder: the combination as a reader
/// sees it, plus everything resolving it produced that the matrix, the top-up, and the
/// queue need.
///
/// A member is resolved once, at the top of a request, and the same resolution is threaded
/// through every cell it takes part in. That is what keeps a gg configuration from being
/// looked up, bound, and validated once per cell — and, more importantly, what makes it
/// impossible for two cells of one member to disagree about which configuration it names or
/// what models it runs.
#[derive(Debug, Clone)]
pub(super) struct PlanMember {
    /// The member as it is **read**: a gg member's `model` and `gg_config_name` filled in
    /// from the configuration it names, so a client holding no configuration still has
    /// something to show. This is never what is stored — see
    /// [`ReviewPlanCombo::for_storage`].
    pub combo: ReviewPlanCombo,
    /// The model id a run of this member is **launched** with, and therefore the model
    /// segment of its [cell key](CellKey): the
    /// [launch model](test_cabinet_core::model_id::launch_model_id) for a harness member,
    /// and the model the bound set's root agent runs for a gg member. Empty when the member
    /// could not be resolved at all, which is the identity no run can ever carry.
    pub launch_model: String,
    /// What resolving a gg member produced — `None` on a harness member, and on a gg member
    /// that could not be resolved.
    pub gg: Option<ResolvedGg>,
    /// Why a top-up cannot launch this member, or `None` when it can.
    ///
    /// A member that cannot be launched is **not dropped**: it keeps its place in the plan's
    /// order, its cells are still counted, and the reason travels with them — because a plan
    /// that silently got smaller is a plan whose missing runs nobody can explain.
    pub unlaunchable: Option<String>,
}

/// The part of a [`CellKey`] a member contributes: its harness, the model its runs are
/// launched with, and its two gg segments — the configuration's id and the models its bound
/// set runs on, both empty on a harness member.
///
/// Named because it is compared on its own as well as crossed with a case: two members with
/// the same identity produce the same cell for *every* case, which is a question about the
/// members alone.
type MemberCellIdentity = (String, String, String, String);

impl PlanMember {
    /// This member's [share](MemberCellIdentity) of the cell key it forms with any case.
    pub(super) fn cell_identity(&self) -> MemberCellIdentity {
        let (config_id, models) = match &self.gg {
            Some(gg) => (gg.config_id.clone(), gg.models.clone()),
            None => (String::new(), String::new()),
        };
        (
            self.combo.harness.as_str().to_string(),
            self.launch_model.clone(),
            config_id,
            models,
        )
    }
}

/// What resolving a **gg** member against the account's saved configurations produced: the
/// two halves of its [cell identity](CellKey) and the capability set a run of it carries.
///
/// The configuration's *name* is deliberately not here. It is display text, it is already on
/// the member a read returns ([`ReviewPlanCombo::gg_config_name`]) and on the set a launch
/// records ([`GgCapabilitySet::preset`]), and holding a third copy beside the identity would
/// invite a cell to be keyed by it again.
#[derive(Debug, Clone)]
pub(super) struct ResolvedGg {
    /// The configuration's id — the first gg segment of the cell key, and what the launched
    /// set records as its [`preset_id`](GgCapabilitySet::preset_id) so the run it produces
    /// lands in this same cell.
    ///
    /// Always the bare id the account's library is keyed by, never the `saved:<id>` spelling
    /// a member may have been written in: the run records this value and the store counts by
    /// it, so the two must be one string.
    pub config_id: String,
    /// The models the bound set runs on, as
    /// [`bound_model_key`](GgCapabilitySet::bound_model_key) writes them — the second gg
    /// segment of the cell key. Asked of the contract rather than assembled here, because
    /// the run lift and the job lift write the same string and a cell only counts while all
    /// three agree to the byte.
    pub models: String,
    /// The set a run of this member is launched with: the configuration's own, with its
    /// launch slots bound to the member's models and its agent keys resolved — the exact
    /// shape `POST /gg/runs` sends downstream.
    pub capability_set: GgCapabilitySet,
    /// The catalog facts every model the set binds is launched with — resolved only on the
    /// paths that are about to **launch** the member, and `None` on a read.
    ///
    /// They are resolved once per member rather than once per cell, and *before* the
    /// scheduler chooses what to emit, because the resolution can fail: a model the catalog
    /// can resolve no context window for cannot be launched at all, and a cell discovered to
    /// be unlaunchable only at enqueue has by then already spent the review-buffer slots and
    /// the harness capacity the scheduler handed it — leaving the plan permanently
    /// under-filled by one broken member. A read does not resolve them because it does not
    /// launch, and the resolution can reach out to OpenRouter for a model the catalog has
    /// never seen.
    pub model_facts: Option<super::jobs::GgModelFacts>,
}

/// The account's gg library, as everything that resolves a member reads it: its saved
/// configurations by id, and the saved agents those configurations import by id.
///
/// The two travel together because a configuration is not fully described by its own row. A
/// configuration that [imports](super::GgAgentSource) a saved agent follows that agent live,
/// and the stored capability set is only the resolution as it stood the last time the
/// configuration was saved — so judging whether a member can be launched at all needs the
/// library beside the configuration. Loaded once per request, whatever the plan's shape.
#[derive(Debug, Default, Clone)]
pub(super) struct GgLibrary {
    /// The account's saved configurations, by [id](GgConfig::id).
    configs: HashMap<String, GgConfig>,
    /// The account's saved agents, by [id](super::GgSavedAgent::id) — the id an
    /// [import](super::GgAgentSource::agent_id) names.
    agents: HashMap<String, super::GgSavedAgent>,
}

impl GgLibrary {
    /// A library over lists already in hand, indexed by the ids everything looks them up by.
    /// The one place either map is built, so a caller cannot key one of them by the wrong id.
    pub(super) fn from_parts(configs: Vec<GgConfig>, agents: Vec<super::GgSavedAgent>) -> Self {
        Self {
            configs: configs.into_iter().map(|c| (c.id.clone(), c)).collect(),
            agents: agents.into_iter().map(|a| (a.id.clone(), a)).collect(),
        }
    }

    /// The configuration `id` names, or `None` when the account no longer owns it.
    pub(super) fn config(&self, id: &str) -> Option<&GgConfig> {
        self.configs.get(id)
    }

    /// The saved agent an import that `config` declares has been edited since `config` was
    /// last saved, or `None` when every import is still the one the stored set holds.
    ///
    /// This is what keeps a **scheduled** gg run honest. An import is a live reference the
    /// console re-resolves on every read, so the set the launch form would send is the saved
    /// agent as it stands now; the set stored on the configuration is the resolution as of its
    /// last save. While the two agree — which is exactly while no imported agent has been
    /// touched since — a plan's top-up and a launch by hand produce the same run. Once they
    /// diverge, the member is reported as unlaunchable rather than quietly launching the older
    /// arm into a cell the console's own launches would miss.
    ///
    /// It compares save times rather than the sets themselves because the merge that resolves
    /// an import lives in the console, not here; a timestamp cannot say *what* changed, but it
    /// can say — without ever answering "unchanged" for a set that did change — that something
    /// did.
    fn stale_import(&self, config: &GgConfig) -> Option<&super::GgSavedAgent> {
        config.agent_sources.iter().find_map(|source| {
            let saved = self.agents.get(&source.agent_id)?;
            (saved.updated_at > config.updated_at).then_some(saved)
        })
    }
}

/// Load the account's [gg library](GgLibrary). The gg-side twin of [`group_index`].
pub(super) async fn gg_library(state: &AppState, user_id: &str) -> Result<GgLibrary, ApiError> {
    let configs = state
        .db
        .list_gg_configs(user_id)
        .await
        .map_err(ApiError::from)?;
    let agents = state
        .db
        .list_gg_agents(user_id)
        .await
        .map_err(ApiError::from)?;
    Ok(GgLibrary::from_parts(configs, agents))
}

/// The first launch slot `set` declares that `models` binds nothing to, or `None` when every
/// one is filled.
///
/// A slot's own default is deliberately not consulted. A member is a written-down decision
/// about which models run, and quietly falling back to whatever default the configuration
/// happened to carry would make a plan's cells change under it the next time the
/// configuration was edited.
fn unbound_launch_slot(set: &GgCapabilitySet, models: &BTreeMap<String, String>) -> Option<String> {
    set.launch_slots().into_iter().find_map(|slot| {
        let bound = models.get(&slot.name).map(|m| m.trim()).unwrap_or_default();
        bound.is_empty().then_some(slot.name)
    })
}

/// The reason a gg member cannot be **launched** even though its configuration is present and
/// every launch slot is bound, or `None`.
///
/// Split from [`gg_member_defect`] because these are not the author's mistakes: a member that
/// was written correctly develops this fault later, when something it points at moves. It is
/// therefore reported on the member — on its cells, and by a top-up that skips it — and never
/// refused at the moment the member is saved.
fn gg_member_drift(config: &GgConfig, library: &GgLibrary) -> Option<String> {
    let saved = library.stale_import(config)?;
    Some(format!(
        "the `{}` gg configuration imports the saved agent `{}`, which has been edited since \
         the configuration was last saved; open `{}` and save it so a scheduled run carries \
         the same agents a launch by hand would",
        config.name, saved.name, config.name
    ))
}

/// The reason a gg member cannot be **stored**, or `None` when it can (a harness member
/// always can).
///
/// Two of the three ways a gg member goes bad are the author's to fix at the moment they
/// write it: a configuration the account does not own, and a launch slot left with no model.
/// Both are refused by the create/update surfaces rather than reported later on a cell,
/// which is why they are named here once and read by both the validation and the resolver —
/// a member a plan accepts and a member the resolver can launch must not be two different
/// sets. Visible to the [ladder transport](super::ladders) for the same reason
/// [`reject_unstorable_members`] is: a climber is a member, and there is one rule for both.
pub(super) fn gg_member_defect(combo: &ReviewPlanCombo, library: &GgLibrary) -> Option<String> {
    let id = combo.gg_config_ref()?;
    let Some(config) = library.config(id) else {
        return Some(format!(
            "no gg configuration `{id}` on this account; a member names a configuration the \
             account owns"
        ));
    };
    let slot = unbound_launch_slot(&config.capability_set, &combo.gg_bindings())?;
    Some(format!(
        "the `{slot}` launch slot of the `{}` gg configuration has no model bound; a member \
         binds a model to every slot its configuration declares",
        config.name
    ))
}

/// Refuse (`400`) a member list carrying a **newly written** gg member that could never be
/// launched, naming the configuration and — for an unbound slot — the slot; hand back the
/// [library](GgLibrary) that was loaded to judge it, which is what the response's read shape is
/// filled from.
///
/// Checked when a group, a plan, or a ladder is **saved** rather than only when it is
/// expanded, because these two faults are typos in what the reviewer just wrote: reporting
/// them on a cell, runs later, is reporting them somewhere the reviewer is no longer
/// looking. The read is skipped entirely for a member list with no gg member in it.
///
/// `stored` is what the object already holds, and a member already in it is **not** re-judged.
/// A member is written once and read for months, and the configuration under it moves in the
/// meantime: gaining a launch slot makes every member that predates the slot unbound. Judging
/// those again on every save would make an unrelated edit — a renamed plan, a bumped
/// runs-per-cell — impossible to save at all, with no way to repair the offending member
/// except to delete it. The read path is built to describe exactly that state (the matrix
/// reports the reason on the cell), so the write path tolerates it.
///
/// Shared with the [ladder transport](super::ladders), whose climbers are the same members
/// under another name: a climber a ladder would accept and a member a plan would accept must
/// not be two different sets.
pub(super) async fn reject_unstorable_members(
    state: &AppState,
    user_id: &str,
    combos: &[ReviewPlanCombo],
    stored: &[ReviewPlanCombo],
) -> Result<GgLibrary, ApiError> {
    let library = read_gg_library(state, user_id, combos).await?;
    match unstorable_member(combos, stored, &library) {
        Some(defect) => Err(ApiError::bad_request(defect)),
        None => Ok(library),
    }
}

/// The reason the first newly-written unstorable member in `combos` cannot be stored, or
/// `None` when every member either can be or was already there. The decision
/// [`reject_unstorable_members`] makes, with the load lifted out of it.
pub(super) fn unstorable_member(
    combos: &[ReviewPlanCombo],
    stored: &[ReviewPlanCombo],
    library: &GgLibrary,
) -> Option<String> {
    let already: HashSet<String> = stored.iter().map(combination_key).collect();
    combos
        .iter()
        .filter(|combo| !already.contains(&combination_key(combo)))
        .find_map(|combo| gg_member_defect(combo, library))
}

/// Resolve one stored member against the account's gg configurations.
///
/// A harness member resolves to itself. A gg member is looked up, its launch slots bound to
/// the models it names, and the result validated exactly as `POST /gg/runs` validates a
/// launch — so a member a plan will launch is a member that endpoint would have accepted.
/// Every way that can fail produces a member carrying its reason rather than no member at
/// all.
pub(super) fn resolve_member(combo: &ReviewPlanCombo, library: &GgLibrary) -> PlanMember {
    let Some(id) = combo.gg_config_ref() else {
        return PlanMember {
            launch_model: test_cabinet_core::model_id::launch_model_id(
                &combo.model,
                combo.harness,
                combo.provider.as_deref(),
            ),
            combo: combo.clone(),
            gg: None,
            unlaunchable: None,
        };
    };
    // Start from the stored shape: whatever a row (or a client echoing a read) says about a
    // gg member's harness, model, and provider, the member runs gg and its model is the one
    // the configuration binds. The read fills those back in below, from the configuration.
    let mut read = combo.for_storage();
    let blocked = |combo: ReviewPlanCombo, reason: String| PlanMember {
        combo,
        launch_model: String::new(),
        gg: None,
        unlaunchable: Some(reason),
    };
    let Some(config) = library.config(id) else {
        return blocked(
            read,
            format!("the gg configuration `{id}` is no longer on this account"),
        );
    };
    read.gg_config_name = Some(config.name.clone());
    if let Some(defect) = gg_member_defect(combo, library) {
        return blocked(read, defect);
    }
    if let Some(drift) = gg_member_drift(config, library) {
        return blocked(read, drift);
    }
    let mut bound = config
        .capability_set
        .bind_launch_slots(&combo.gg_bindings());
    // What a run records about the configuration it came from: the id, which is what its
    // cell is keyed on, and the name as it stands **now** rather than the one the stored set
    // happened to carry, so the run log and a comparison label it the way the matrix does.
    // Writing the id here is what makes a scheduled run and a run launched by hand from the
    // same configuration one cell.
    bound.preset = Some(config.name.clone());
    bound.preset_id = Some(config.id.clone());
    match super::gg::gg_launch_identity(&bound) {
        Ok(identity) => {
            let super::gg::GgLaunchIdentity {
                capability_set,
                model,
            } = identity;
            read.model = model.clone();
            PlanMember {
                launch_model: model,
                gg: Some(ResolvedGg {
                    config_id: config.id.clone(),
                    models: capability_set.bound_model_key(),
                    capability_set,
                    model_facts: None,
                }),
                combo: read,
                unlaunchable: None,
            }
        }
        Err(reason) => blocked(read, reason),
    }
}

/// Resolve referenced combination groups and one-off combinations into the de-duped
/// member list a matrix (or a ladder's climber board) is built from.
///
/// Group members come first, in reference order, then the one-offs; a member is identified
/// by its [`combination_key`], which is `(harness, model, provider)` for a harness member
/// and the configuration plus its slot bindings for a gg one — so the same member declared
/// in two groups, or in a group and as a one-off, appears exactly once, and two gg members
/// of one configuration that bind different models stay two members. A referenced id that no
/// longer names a group is silently skipped: deleting a group is not an error in the plans
/// that pointed at it.
///
/// `library` is the account's [gg library](GgLibrary); a gg member whose configuration is not
/// in it keeps its place carrying the reason.
///
/// **Two members that resolve to one cell are one cell.** The de-dupe key above is what a
/// reviewer *wrote*, and two different declarations can still name the same runs — two
/// bindings of one configuration that differ only where the configuration ignores them, a slot
/// name it does not declare being the plainest case. The later of the pair keeps
/// its place carrying a reason rather than being dropped or launched: launching it would
/// enqueue one cell's runs twice (each member reading the same global counts and each seeing
/// its own target unmet), and dropping it would make a member the reviewer can see in the
/// editor vanish from the matrix with nothing said.
///
/// Factored out of [`resolve_members`] so a ladder, whose climbers are the same
/// `kind = "combo"` group pointers, resolves them through this and not a copy.
pub(super) fn resolve_combos(
    group_ids: &[String],
    one_offs: &[ReviewPlanCombo],
    groups: &HashMap<String, CoverageGroup>,
    library: &GgLibrary,
) -> Vec<PlanMember> {
    let mut combos: Vec<PlanMember> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut cells: HashSet<MemberCellIdentity> = HashSet::new();
    let mut push = |c: &ReviewPlanCombo, combos: &mut Vec<PlanMember>| {
        if !seen.insert(combination_key(c)) {
            return;
        }
        let mut member = resolve_member(c, library);
        if member.unlaunchable.is_none() && !cells.insert(member.cell_identity()) {
            member.unlaunchable = Some(
                "another member of this plan already asks for exactly these runs — same case, \
                 same launch model, and (for a gg member) the same configuration bound to the \
                 same agents"
                    .to_string(),
            );
        }
        combos.push(member);
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
/// keyed by the whole pin — `(slug, version, variant, engine)`. The case-side twin of
/// [`resolve_combos`], with the same ordering and dangling-reference rules.
///
/// The engine is part of the key because it is part of the pin: the same case at the same
/// version and variant on two engines is two pinned cases whose runs are not comparable,
/// and de-duplicating on the first three segments would silently drop one of them. The
/// engine is compared **resolved**, so a pin naming `none` and a pin naming nothing are
/// the one case they describe.
pub(super) fn resolve_cases(
    group_ids: &[String],
    one_offs: &[ReviewPlanCase],
    groups: &HashMap<String, CoverageGroup>,
) -> Vec<ReviewPlanCase> {
    let mut cases = Vec::new();
    let mut seen: HashSet<(String, String, String, String)> = HashSet::new();
    let mut push = |c: &ReviewPlanCase, cases: &mut Vec<ReviewPlanCase>| {
        let key = (
            c.slug.clone(),
            c.version.clone(),
            c.variant.clone(),
            c.engine_slug(),
        );
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
/// members and cases the matrix crosses.
fn resolve_members(
    plan: &CoveragePlan,
    groups: &HashMap<String, CoverageGroup>,
    library: &GgLibrary,
) -> (Vec<PlanMember>, Vec<ReviewPlanCase>) {
    (
        resolve_combos(&plan.combo_group_ids, &plan.combos, groups, library),
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
    combos: &'a [PlanMember],
    cases: &'a [ReviewPlanCase],
) -> Vec<(&'a ReviewPlanCase, &'a PlanMember)> {
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

/// Resolve every launchable gg member's [per-model catalog facts](super::jobs::GgModelFacts),
/// marking a member whose bound models the catalog cannot answer for as unlaunchable.
///
/// Run by the two paths that are about to **launch** — a plan's top-up and a ladder's — and
/// before either asks the scheduler what to emit. That ordering is the point. The scheduler
/// spends a fixed review buffer and a fixed per-harness capacity, and it spends both at the
/// moment it emits a cell; a cell that then turns out to be unlaunchable at enqueue has
/// consumed a share of each and enqueued nothing, so every pass leaves the plan short by that
/// member's whole target — forever, and silently. Resolving first turns that into what the
/// design says it is: a member whose demand is zero, skipped and reported, with the rest of the
/// plan fed as normal.
///
/// The facts are kept on the member so the enqueue does not resolve them again per cell: one
/// member launched across eight cases is one resolution, not eight.
pub(super) async fn resolve_gg_launch_facts(state: &AppState, members: &mut [PlanMember]) {
    for member in members {
        if member.unlaunchable.is_some() {
            continue;
        }
        let launch_model = member.launch_model.clone();
        let Some(gg) = member.gg.as_mut() else {
            continue;
        };
        // Price the models the set binds before resolving their windows, exactly as the gg
        // launch endpoint does and in the same order: the seeding usually puts the window on
        // record, so the resolution below finds it without a second fetch.
        let models: Vec<(String, HarnessSlug)> = gg
            .capability_set
            .bound_model_ids()
            .into_iter()
            .chain(std::iter::once(launch_model.as_str()))
            .filter(|id| !id.trim().is_empty())
            .map(|id| (id.to_string(), HarnessSlug::Gg))
            .collect();
        crate::bootstrap::seed_launch_prices(&state.db, &state.prices, &models).await;
        match super::jobs::gg_model_facts(
            &state.db,
            &state.prices,
            &gg.capability_set,
            &launch_model,
            HarnessSlug::Gg,
        )
        .await
        {
            Ok(facts) => gg.model_facts = Some(facts),
            Err(reason) => member.unlaunchable = Some(reason),
        }
    }
}

/// One cell's demand as the top-up walk must see it: its own, unless nothing can launch its
/// member — in which case it wants nothing.
///
/// The cell is not dropped and its occupancy is not zeroed. A member that broke after its
/// runs were launched has not un-launched them, so those runs still hold the review-buffer
/// slots they always held; what changes is only that the walk stops trying to add to them and
/// spends the rest of the buffer on the members that can still run.
pub(super) fn launchable_demand(demand: CellDemand, member: &PlanMember) -> CellDemand {
    match member.unlaunchable {
        Some(_) => CellDemand {
            target: 0,
            ..demand
        },
        None => demand,
    }
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
    /// How much room each harness has to start another run, indexed by
    /// [`harness_lane`]. Read by the top-up scheduler so the review buffer is spent
    /// on work the queue can actually claim rather than deepening one throttled
    /// harness's backlog; see [`crate::coverage::schedule`].
    harness_capacity: Vec<HarnessCapacity>,
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
        let queue = queue_snapshot(state).await?;
        let harness_capacity = harness_capacity(state, &queue.in_flight_by_harness).await?;
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
            pending: queue.pending,
            unreviewed,
            harness_capacity,
            latest_by_slug,
        })
    }

    /// The full coverage matrix for one plan's resolved members, in `axis` order.
    fn matrix(
        &self,
        runs_per_cell: u32,
        axis: CoverageAxis,
        buffer_target: u32,
        combos: &[PlanMember],
        cases: &[ReviewPlanCase],
    ) -> CoverageMatrix {
        let ordered = cells_in_order(axis, combos, cases);
        let mut cells = Vec::with_capacity(ordered.len());
        let mut cells_satisfied = 0u32;
        let mut runs_missing = 0u32;
        let mut runs_pending = 0u32;
        let mut runs_unreviewed = 0u32;
        let mut runs_outstanding = 0u32;
        for (case, member) in ordered {
            let cell = self.cell(runs_per_cell, case, member);
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
        combos: &[PlanMember],
        cases: &[ReviewPlanCase],
    ) -> MatrixRollup {
        let ordered = cells_in_order(axis, combos, cases);
        let mut cells_satisfied = 0u32;
        let mut runs_missing = 0u32;
        let mut runs_unreviewed = 0u32;
        for (case, member) in &ordered {
            let demand = self.demand(runs_per_cell, case, member);
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
        member: &PlanMember,
    ) -> CoverageCell {
        let key = cell_key(case, member);
        let demand = self.demand(desired, case, member);
        let latest_version = self
            .latest_by_slug
            .get(&case.slug)
            .cloned()
            .unwrap_or_default();
        CoverageCell {
            slug: case.slug.clone(),
            version: case.version.clone(),
            variant: case.variant.clone(),
            engine: case.engine_slug(),
            harness: member.combo.harness,
            model: member.combo.model.clone(),
            provider: member.combo.provider.clone(),
            gg_config_id: member.combo.gg_config_id.clone(),
            gg_config_name: member.combo.gg_config_name.clone(),
            gg_slot_models: member.combo.gg_slot_models.clone(),
            unlaunchable: member.unlaunchable.clone(),
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
        member: &PlanMember,
    ) -> CellDemand {
        let key = cell_key(case, member);
        CellDemand {
            target,
            completed: self.completed.get(&key).copied().unwrap_or(0),
            in_flight: self.in_flight.get(&key).copied().unwrap_or(0),
            unreviewed: self.unreviewed.get(&key).copied().unwrap_or(0),
            harness: harness_lane(member.combo.harness),
        }
    }

    /// How much room each harness has to start another run, in the lane order
    /// [`CellDemand::harness`] indexes. Handed straight to the top-up scheduler.
    pub(super) fn harness_capacity(&self) -> &[HarnessCapacity] {
        &self.harness_capacity
    }

    /// The newest ingested version of one case slug, or the empty string when the case
    /// is not ingested at all. A property of the case alone, so a caller with no
    /// combination in hand (a ladder describing its rungs) can ask for it directly.
    pub(super) fn latest_version(&self, slug: &str) -> String {
        self.latest_by_slug.get(slug).cloned().unwrap_or_default()
    }

    /// How many of one cell's completed runs the requesting account has not reviewed.
    pub(super) fn unreviewed_for(&self, case: &ReviewPlanCase, member: &PlanMember) -> u32 {
        self.unreviewed
            .get(&cell_key(case, member))
            .copied()
            .unwrap_or(0)
    }
}

/// The [`CellKey`] a case and a resolved member cross to: the case pin's four segments,
/// the harness, the model as it is **launched**, and the two gg segments — the
/// configuration's id and the models its bound set runs, both empty on a harness cell.
///
/// The engine segment is the pin's engine **resolved**, so a pin naming nothing keys as
/// `none` — the same segment the grouped counts collapse a run that recorded no engine to.
/// A plan pinning no engine therefore counts exactly the runs it always counted.
///
/// Every other segment comes off the resolved member rather than the stored combination,
/// which is the point of resolving one: a gg member's launch model is the model its bound
/// set's root agent runs, its models segment is what the bound set actually binds, and its
/// configuration segment is the bare id the account's library is keyed by — the row may
/// spell that id as the picker's `saved:<id>`, and a run records only the bare one.
pub(super) fn cell_key(case: &ReviewPlanCase, member: &PlanMember) -> CellKey {
    let (harness, model, config_id, models) = member.cell_identity();
    (
        case.slug.clone(),
        case.version.clone(),
        case.variant.clone(),
        case.engine_slug(),
        harness,
        model,
        config_id,
        models,
    )
}

/// What one read of the live queue tells a coverage computation.
struct QueueSnapshot {
    /// The `pending` subset of the in-flight jobs, per coverage cell.
    pending: crate::db::CellCounts,
    /// In-flight jobs per harness slug — every state, across every plan, ladder, and
    /// hand-launched run, not only the cells being tallied. A harness's parallelism
    /// cap is global, so anything already queued for it consumes the cap ahead of
    /// whatever a top-up adds.
    in_flight_by_harness: HashMap<String, u32>,
}

/// Read the live queue once, for both the per-cell `pending` counts and the
/// per-harness in-flight totals.
///
/// Derived from the same active-job read `GET /jobs/active` serves rather than from
/// grouped queries, because `pending` is a *display* distinction: the authority for
/// what counts toward a cell's target is [`crate::db::Db::count_in_flight_jobs_by_cell`],
/// which includes pending jobs and must keep doing so. Surfacing the subset separately
/// is what makes "the buffer is full but nothing is running" explicable instead of
/// looking like a stuck queue. The read is bounded by the queue's actual depth, which
/// is the same set the console already fetches whole for its in-progress list.
async fn queue_snapshot(state: &AppState) -> Result<QueueSnapshot, ApiError> {
    let mut pending = crate::db::CellCounts::new();
    let mut in_flight_by_harness: HashMap<String, u32> = HashMap::new();
    for job in state.db.active_jobs().await.map_err(ApiError::from)? {
        *in_flight_by_harness
            .entry(job.harness_slug.clone())
            .or_insert(0) += 1;
        if job.state != "pending" {
            continue;
        }
        // The job's own lifted engine and gg columns complete the cell, read exactly as
        // the grouped counts read them: an absent engine is `none`, and an absent gg
        // segment is the empty one a harness cell carries.
        *pending
            .entry((
                job.test_case_slug,
                job.test_case_version,
                job.variant,
                job.engine_slug
                    .unwrap_or_else(|| test_cabinet_core::engine::NONE_SLUG.to_string()),
                job.harness_slug,
                job.model_id,
                job.gg_config_id.unwrap_or_default(),
                job.gg_models.unwrap_or_default(),
            ))
            .or_insert(0) += 1;
    }
    Ok(QueueSnapshot {
        pending,
        in_flight_by_harness,
    })
}

/// Cross the configured per-harness parallelism caps with what is already in flight,
/// producing the capacity lane the top-up scheduler reads for every harness.
///
/// A harness with no `harness_config` row — the default — is unlimited. A stored cap
/// that is not a sane positive count is treated as zero rather than as unlimited: bad
/// data should hold runs back, not quietly lift a throttle an operator asked for.
async fn harness_capacity(
    state: &AppState,
    in_flight: &HashMap<String, u32>,
) -> Result<Vec<HarnessCapacity>, ApiError> {
    let caps: HashMap<String, Option<i32>> = state
        .db
        .list_harness_configs()
        .await
        .map_err(ApiError::from)?
        .into_iter()
        .map(|row| (row.harness_slug, row.max_parallelism))
        .collect();
    Ok(HarnessSlug::RUNNABLE
        .iter()
        .map(|slug| HarnessCapacity {
            in_flight: in_flight.get(slug.as_str()).copied().unwrap_or(0),
            max_parallel: caps
                .get(slug.as_str())
                .copied()
                .flatten()
                .map(|max| u32::try_from(max).unwrap_or(0)),
        })
        .collect())
}

/// The lane a harness occupies in the capacity slice the top-up scheduler walks.
///
/// [`HarnessSlug::RUNNABLE`] rather than the CLI catalog, because what a lane bounds is how
/// many runs of a harness the queue will start at once and gg's runs occupy the queue like
/// any other — today they are most of it. It is exhaustive, so the position always resolves;
/// the fallback only keeps the lookup total, and lands past the end of the slice — which the
/// scheduler reads as an uncapped harness rather than as some other harness's lane.
fn harness_lane(harness: HarnessSlug) -> usize {
    HarnessSlug::RUNNABLE
        .iter()
        .position(|slug| *slug == harness)
        .unwrap_or(HarnessSlug::RUNNABLE.len())
}

// ---- Shared top-up enqueue + queue assembly --------------------------------

/// One cell a top-up decided to launch, ready to be turned into jobs. Borrowed
/// rather than owned so the caller keeps its resolved members as the source of truth.
pub(super) struct TopUpCell<'a> {
    /// The ladder rung this cell belongs to, or `None` for a coverage plan.
    pub rung_id: Option<String>,
    /// The case, at its pinned version.
    pub case: &'a ReviewPlanCase,
    /// The resolved member to run it on.
    pub member: &'a PlanMember,
    /// How many runs to enqueue — the cell's whole shortfall.
    pub runs: u32,
}

/// What one call to [`enqueue_top_up`] did: the cells it turned into jobs, and the cells it
/// could not.
///
/// The two come back together because a top-up routinely does both, and a caller assembling
/// its report needs them in the same emission order it handed the cells over in.
pub(super) struct TopUpEnqueued {
    /// The cells that became jobs, in emission order.
    pub launched: Vec<TopUpLaunch>,
    /// The cells that could not, each with its reason.
    pub blocked: Vec<TopUpBlocked>,
}

/// One cell reported as unlaunchable: the case, the member, and why.
///
/// Shared by the two places a cell is found to be unlaunchable — when its member failed to
/// resolve at all, and when its models could not be resolved at enqueue — so both name the
/// member the same way.
pub(super) fn blocked_cell(
    rung_id: Option<String>,
    case: &ReviewPlanCase,
    member: &PlanMember,
    reason: String,
) -> TopUpBlocked {
    TopUpBlocked {
        rung_id,
        slug: case.slug.clone(),
        version: case.version.clone(),
        variant: case.variant.clone(),
        engine: case.engine_slug(),
        harness: member.combo.harness,
        model: member.combo.model.clone(),
        provider: member.combo.provider.clone(),
        gg_config_id: member.combo.gg_config_id.clone(),
        gg_config_name: member.combo.gg_config_name.clone(),
        gg_slot_models: member.combo.gg_slot_models.clone(),
        reason,
    }
}

/// The launch request one top-up cell's runs are enqueued with: the cell's whole case pin
/// crossed with what its resolved member runs.
///
/// The two shapes live here together rather than inline at the enqueue because they must
/// agree on the pin. A gg cell is lowered through the very builder `POST /gg/runs` lowers a
/// launch form with ([`super::gg::gg_launch_body`]) and a harness cell is the console's
/// default new-run shape, but both carry the same slug, version, variant, and **engine** —
/// a cell whose runs arrived on another engine would satisfy nothing it was counted
/// against, and the two branches drifting apart on that is precisely the defect that would
/// not show up until a plan had bought a second set of runs.
///
/// The engine travels as [`ReviewPlanCase::launch_engine`] gives it, so a pin naming
/// nothing sends no engine key at all — the `none` default, which is the engineless build
/// every plan scheduled before the pin carried an engine got.
///
/// A plan pins no orchestrator, runtime ceiling, auth mode, or retry policy, so everything
/// else is the default a hand-launched run takes.
fn top_up_launch_body(cell: &TopUpCell<'_>) -> test_cabinet_core::LaunchBody {
    match &cell.member.gg {
        Some(gg) => super::gg::gg_launch_body(
            super::gg::GgLaunchSubject {
                test_case: cell.case.slug.clone(),
                version: cell.case.version.clone(),
                variant: cell.case.variant.clone(),
                engine: cell.case.launch_engine(),
                max_runtime_seconds: None,
                retry_count: None,
            },
            super::gg::GgLaunchIdentity {
                capability_set: gg.capability_set.clone(),
                model: cell.member.launch_model.clone(),
            },
        ),
        None => test_cabinet_core::LaunchBody {
            test_case: cell.case.slug.clone(),
            version: cell.case.version.clone(),
            variant: cell.case.variant.clone(),
            harness: cell.member.combo.harness,
            model: cell.member.launch_model.clone(),
            orchestrator: None,
            engine: cell.case.launch_engine(),
            max_runtime_seconds: None,
            auth_mode: None,
            retry_count: None,
            // A harness member configures no capability set, and none of the per-model
            // catalog facts a set's bindings would need resolving.
            gg_capability_set: None,
            gg_model_windows: Default::default(),
            gg_model_modalities: Default::default(),
        },
    }
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
/// A **gg** cell is lowered through the very code `POST /gg/runs` lowers a launch form's
/// submission with ([`super::gg::gg_launch_body`]) and priced and resolved the same way, so
/// a run a plan schedules from a configuration and a run an operator launches from the same
/// configuration and the same models are the same run. A model whose context window the
/// catalog cannot resolve makes that one cell unlaunchable and is reported: gg assumes no
/// default window, and refusing the whole top-up would let one bad binding stop a plan being
/// fed.
///
/// `origin` is what a later scoped [`halt_jobs`] cancels by; without it a halt could
/// not tell this plan's queued runs from a run someone kicked off by hand.
pub(super) async fn enqueue_top_up(
    state: &AppState,
    user: &AuthUser,
    origin: &JobOrigin,
    cells: &[TopUpCell<'_>],
) -> Result<TopUpEnqueued, ApiError> {
    let now = now()?;
    let attribution = super::jobs::JobAttribution::scheduled(&user.0.id, origin);
    let mut jobs: Vec<crate::db::NewJob> = Vec::new();
    let mut launched: Vec<TopUpLaunch> = Vec::with_capacity(cells.len());
    let mut blocked: Vec<TopUpBlocked> = Vec::new();
    // Every model the harness cells bind, so their prices can be seeded at enqueue exactly
    // as `POST /jobs` seeds a by-hand launch's — once for the batch, below. A gg cell's are
    // seeded as it is lowered instead, because its window resolution needs them on record
    // first.
    let mut models: Vec<(String, HarnessSlug)> = Vec::new();
    for cell in cells {
        if cell.runs == 0 {
            continue;
        }
        if let Some(reason) = &cell.member.unlaunchable {
            // The scheduler is handed a demand of zero for a member nothing can launch, so
            // this is only reached by a caller that assembled its cells some other way — and
            // a job enqueued for a member that never resolved is worse than a report of it.
            blocked.push(cell.blocked(reason.clone()));
            continue;
        }
        let mut body = top_up_launch_body(cell);
        match cell.member.gg.as_ref().map(|gg| gg.model_facts.clone()) {
            // The facts a caller about to launch resolved for this member up front (see
            // [`resolve_gg_launch_facts`]) — the same figures a second resolution would
            // produce, minus a round-trip per cell.
            Some(Some(facts)) => facts.apply(&mut body),
            // A gg cell whose member was never put through that pass: resolve here rather
            // than enqueue a run with no windows on it, which gg would have no way to
            // measure. It blocks its own cell and never the whole top-up.
            Some(None) => {
                crate::bootstrap::seed_launch_prices(
                    &state.db,
                    &state.prices,
                    &super::jobs::launch_models(&body),
                )
                .await;
                if let Err(reason) =
                    super::jobs::resolve_gg_model_facts(&state.db, &state.prices, &mut body).await
                {
                    blocked.push(cell.blocked(reason));
                    continue;
                }
            }
            None => {}
        }
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

        // Built through the very same builder `POST /jobs` and `POST /gg/runs` mint their
        // jobs with, so a scheduled run and a hand-launched one are validated identically
        // and lift the same columns — the gg cell identity included. A body it refuses
        // blocks its own cell rather than the whole top-up.
        let mut cell_jobs: Vec<crate::db::NewJob> = Vec::with_capacity(cell.runs as usize);
        let mut defect: Option<String> = None;
        for _ in 0..cell.runs {
            match super::jobs::build_new_job(&body, test_type, &now, &attribution) {
                Ok(job) => cell_jobs.push(job),
                Err(reason) => {
                    defect = Some(reason);
                    break;
                }
            }
        }
        if let Some(reason) = defect {
            blocked.push(cell.blocked(reason));
            continue;
        }
        if cell.member.gg.is_none() {
            for model in super::jobs::launch_models(&body) {
                if !models.contains(&model) {
                    models.push(model);
                }
            }
        }
        let job_ids: Vec<String> = cell_jobs.iter().map(|job| job.id.clone()).collect();
        jobs.extend(cell_jobs);
        launched.push(TopUpLaunch {
            rung_id: cell.rung_id.clone(),
            slug: cell.case.slug.clone(),
            version: cell.case.version.clone(),
            variant: cell.case.variant.clone(),
            engine: cell.case.engine_slug(),
            harness: cell.member.combo.harness,
            model: cell.member.combo.model.clone(),
            provider: cell.member.combo.provider.clone(),
            gg_config_id: cell.member.combo.gg_config_id.clone(),
            gg_config_name: cell.member.combo.gg_config_name.clone(),
            gg_slot_models: cell.member.combo.gg_slot_models.clone(),
            runs: cell.runs,
            job_ids,
        });
    }
    if jobs.is_empty() {
        return Ok(TopUpEnqueued { launched, blocked });
    }
    // Price the harness cells' models before the runs exist. Missing-only and best-effort:
    // a model already on record costs nothing, and an unpriced model costs a cost
    // split, never the top-up.
    crate::bootstrap::seed_launch_prices(&state.db, &state.prices, &models).await;
    state.db.enqueue_jobs(jobs).await.map_err(ApiError::from)?;
    Ok(TopUpEnqueued { launched, blocked })
}

impl TopUpCell<'_> {
    /// This cell, reported as one the top-up could not launch.
    fn blocked(&self, reason: String) -> TopUpBlocked {
        blocked_cell(self.rung_id.clone(), self.case, self.member, reason)
    }
}

/// One cell of a scoped review queue, with the authoritative count of how many of its
/// completed runs the requester has not reviewed.
pub(super) struct QueueCell<'a> {
    /// The ladder rung this cell belongs to, or `None` for a coverage plan.
    pub rung_id: Option<String>,
    /// The case, at its pinned version.
    pub case: &'a ReviewPlanCase,
    /// The resolved member.
    pub member: &'a PlanMember,
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
        let filter = SummaryFilter {
            state: SummaryState::Review,
            test_case: Some(cell.case.slug.clone()),
            model: Some(cell.member.launch_model.clone()),
            harness: Some(cell.member.combo.harness.as_str().to_string()),
            variant: Some(cell.case.variant.clone()),
            version: Some(cell.case.version.clone()),
            // Resolved, so a cell pinned to no engine asks for `none` — the one filter
            // value that also matches the rows whose slug was never lifted, which are
            // engineless runs. Without it a queue would offer another engine's runs for a
            // cell that never counted them.
            engine: Some(cell.case.engine_slug()),
            ..SummaryFilter::default()
        };
        let (found, _total) = state
            .db
            .list_summaries(
                &filter,
                SummarySort::Date,
                SortDir::Desc,
                &CaseNames::new(),
                QUEUE_CELL_SCAN,
                0,
            )
            .await
            .map_err(ApiError::from)?;
        let mut mine: Vec<CoverageQueueEntry> = found
            .into_iter()
            // The listing filters on the columns it has — case, version, variant, harness,
            // and launched model — which for a gg cell is every gg run of that root model,
            // configuration and subagent models included. The remaining two segments of the
            // cell are read off each run's own capability set, so one configuration's runs
            // never appear in another's queue.
            .filter(|run| in_gg_cell(run.record.subject.gg_capability_set.as_ref(), cell.member))
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
                engine: run.record.subject.engine_slug.clone(),
                harness: run.record.subject.harness_slug,
                model: run.record.subject.model_id.clone(),
                // Off the member rather than off the run: the run records the set it ran,
                // which is the same cell by construction (`in_gg_cell` has just proved it),
                // and the member is the thing the rest of the page labels.
                gg_config_id: cell.member.combo.gg_config_id.clone(),
                gg_config_name: cell.member.combo.gg_config_name.clone(),
                gg_slot_models: cell.member.combo.gg_slot_models.clone(),
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

/// Whether one completed run belongs to a member's cell on the two segments a run listing
/// cannot filter on: the gg configuration's id and the models its set bound.
///
/// Read off the capability set the run recorded, and matched against the same two values
/// [`cell_key`] builds its gg segments from, so the queue offers exactly the runs the cell's
/// counts are made of. Those counts group on `run.gg_config_id`, which is
/// [lifted](crate::db) from this very field, so the two agree by construction — a run
/// carrying a column its record does not account for would be counted into a cell whose
/// queue could never offer it, spending a review-buffer slot no reviewer can free.
///
/// Trivially true for a harness member, whose cell those segments are empty for — and true
/// for nothing at all on a member that never resolved, which has no cell for a run to be in.
fn in_gg_cell(set: Option<&GgCapabilitySet>, member: &PlanMember) -> bool {
    let Some(gg) = &member.gg else {
        return member.unlaunchable.is_none();
    };
    let Some(set) = set else {
        return false;
    };
    set.preset_id.as_deref() == Some(gg.config_id.as_str()) && set.bound_model_key() == gg.models
}

// ---- Small constructors ---------------------------------------------------

/// Mint a fresh opaque id for a new group, plan, ladder, rung, or job.
pub(super) fn new_id() -> String {
    cuid2::create_id()
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

/// The members as they are **stored** — every gg member stripped of the values a read
/// derives (see [`ReviewPlanCombo::for_storage`]).
///
/// Applied at each of the three places a member list is persisted, rather than in the store,
/// so that what a handler hands the store is already the row: a normalization the store
/// performed would be one the handler's own response never showed.
pub(super) fn for_storage(combos: Vec<ReviewPlanCombo>) -> Vec<ReviewPlanCombo> {
    combos.iter().map(ReviewPlanCombo::for_storage).collect()
}

/// The members as a **read** returns them: a gg member's `model` and `gg_config_name` filled
/// in from the configuration it names.
///
/// The pointer is what is stored, so every read of a member list resolves it — which is what
/// makes a renamed configuration show its new name everywhere at once, and a client that has
/// never fetched `/gg/configs` still able to render a member.
pub(super) fn for_read(combos: &[ReviewPlanCombo], library: &GgLibrary) -> Vec<ReviewPlanCombo> {
    combos
        .iter()
        .map(|combo| resolve_member(combo, library).combo)
        .collect()
}

/// The [library](GgLibrary) a read needs to fill in [`for_read`], or an empty one when the
/// members hold no gg member at all — the common case, which must not pay for the load.
pub(super) async fn read_gg_library<'a>(
    state: &AppState,
    user_id: &str,
    combos: impl IntoIterator<Item = &'a ReviewPlanCombo>,
) -> Result<GgLibrary, ApiError> {
    if !combos.into_iter().any(|c| c.gg_config_ref().is_some()) {
        return Ok(GgLibrary::default());
    }
    gg_library(state, user_id).await
}

/// Build a stored group from a create/update body, keeping only the members that
/// match the declared kind.
fn group_from_input(id: String, input: CoverageGroupInput, updated_at: &str) -> CoverageGroup {
    let (combos, cases) = match input.kind {
        CoverageGroupKind::Combo => (for_storage(input.combos), Vec::new()),
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
            combos: for_storage(input.combos),
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
            unlaunchable: Vec::new(),
        }
    }
}

#[cfg(test)]
#[path = "coverage.test.rs"]
mod tests;

#[cfg(test)]
#[path = "coverage.gg.test.rs"]
mod gg_tests;
