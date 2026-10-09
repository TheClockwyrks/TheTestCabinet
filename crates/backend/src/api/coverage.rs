//! The coverage endpoints: reusable groups, multiple declarative plans, the coverage
//! matrix computed from a plan, and the controls that **fill** a plan — its
//! runs-in-flight limit, its launch passes, its review queue, and its halts.
//!
//! An owner builds **groups** — named, reusable sets of harness+model **combinations**
//! (`kind = "combo"`) or version-pinned test **cases** (`kind = "case"`) — and **plans**
//! that reference those groups as pointers, so editing a group reshapes every plan that
//! references it. A plan is **hybrid**: it references groups *and* may pin individual
//! one-off combinations/cases; the backend resolves the referenced groups, unions them
//! with the one-offs, and de-dupes before crossing cases × combinations into cells. Each
//! plan carries its own target runs-per-cell.
//!
//! ## Counting
//!
//! Counts are **global**: a cell's counted runs and in-flight jobs count every run of
//! that cell whoever launched it, so a run that already exists is never re-requested. A
//! counted run is the model's own result — completed, catastrophic, timed out, limit
//! exceeded or hung — and an automatically retried attempt counts once, with its retry.
//! [`CoverageCell::unreviewed`] is the one per-account number, and it is informational:
//! reviews never launch, gate or hold back anything.
//!
//! ## Filling
//!
//! `POST /coverage-plans/{id}/fill` starts filling a plan and runs a launch pass: the
//! shared scheduler ([`crate::coverage::schedule`]) launches whole missing cells, in the
//! plan's order, while the plan's own jobs in flight stay under its runs-in-flight limit.
//! Every finished run of a filling plan's cell runs another pass, and filling ends when
//! every launchable cell is filled, or the plan is halted. Every run a pass launches gets
//! the plan's retry limit, and a cell whose launch used it up without a counted run is
//! blocked until its owner retries it.
//!
//! This is console-only tooling: the public static site never reaches it (it carries no
//! bearer token and never mounts this transport).

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
use crate::coverage::schedule::{CellDemand, HarnessCapacity, InFlightLimit, launch_pass};
use crate::db::{
    CANCELABLE_ACTIVE_STATES, CANCELABLE_WAITING_STATES, CellKey, CellRun, JobCancelFilter,
    JobOrigin, OriginScope, TerminalJob, combination_key,
};
use crate::error::ApiError;

use super::AppState;
use super::GgConfig;
use super::launch::LaunchTarget;

/// The largest target a plan may set for its runs-per-cell count. A guard against
/// a fat-fingered value fanning out into thousands of queued runs; well above any
/// real review target.
const MAX_RUNS_PER_CELL: u32 = 100;

/// The smallest target a plan may set. Not zero: a cell nobody wants any runs of is
/// a cell that should not be in the plan (or a rung that should not be on the
/// ladder), so an emptied field is a plan to fix rather than a target to store.
const MIN_RUNS_PER_CELL: u32 = 1;

/// The runs-in-flight limit applied to an account that has never chosen one: small
/// enough that one plan or ladder does not take over the queue, and large enough to keep
/// a couple of cells' runs going at a typical five runs per cell.
const DEFAULT_IN_FLIGHT_LIMIT: InFlightLimit = InFlightLimit::Bounded { runs: 10 };

/// The largest *bounded* runs-in-flight limit an account, plan or ladder may set. The
/// same class of guard as [`MAX_RUNS_PER_CELL`]: a mistyped value here is a mistyped
/// value in units of queued runs. An owner who wants everything queued at once says so
/// with [`InFlightLimit::Unbounded`].
const MAX_IN_FLIGHT_LIMIT: u32 = 500;

/// The most runs one scoped review queue returns. The queue exists to be walked in
/// order, not paged through, so it is capped rather than paginated, and reports
/// `truncated` when it has more behind it.
pub(super) const MAX_QUEUE_RUNS: usize = 600;

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
/// runs execute in, since a launch pass emits cells in this order, `job.queue_seq` is
/// monotonic, and the dispatcher claims in ascending order.
///
/// The console labels these "One case at a time" and "One model at a time".
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

/// An owner's saved, reusable group of combinations or cases. Referenced by plans
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

/// An owner's named coverage plan: the groups it references, any one-off members, the
/// target runs-per-cell, the order it launches in, and its runs-in-flight limit
/// override. Persisted whole; one account may hold many.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CoveragePlan {
    /// The plan's opaque id (minted on create).
    pub id: String,
    /// The owner-chosen display name.
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
    /// Which axis the cell loop nests on, and therefore the order runs launch in.
    #[serde(default)]
    pub outer_axis: CoverageAxis,
    /// This plan's override of the account's runs-in-flight limit, or null to inherit
    /// it. Null, a bound of `0`, and `unbounded` are three different instructions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub in_flight_limit: Option<InFlightLimit>,
    /// How many automatic retries each run the plan launches gets, `0..=10`. A launch
    /// that uses them up without a counted run blocks its cell.
    #[serde(default = "default_retry_count")]
    pub retry_count: u32,
    /// RFC 3339 of when the plan was last saved.
    pub updated_at: String,
}

/// The retry limit a plan or ladder saved without one launches with: the count a launch
/// request that names none gets.
pub(crate) fn default_retry_count() -> u32 {
    super::jobs::DEFAULT_RETRY_COUNT
}

/// Clamp a submitted retry limit to the most retries the backend honours for any launch.
pub(super) fn clamp_retry_count(retries: u32) -> u32 {
    retries.min(super::jobs::MAX_RETRY_COUNT)
}

/// One plan as a reader sees it: its configuration, and whether it is filling — which
/// only the fill and halt endpoints change.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CoveragePlanOut {
    /// The plan's configuration.
    #[serde(flatten)]
    pub plan: CoveragePlan,
    /// Whether the plan is filling: launching its missing runs under its limit until
    /// every launchable cell is filled.
    pub filling: bool,
}

/// The create/update body for a coverage plan (the server assigns `id` and
/// `updatedAt`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CoveragePlanInput {
    /// The owner-chosen display name.
    pub name: String,
    /// The target number of runs desired for each `case × combination` cell.
    /// Rejected outside `MIN_RUNS_PER_CELL..=MAX_RUNS_PER_CELL` rather than corrected
    /// into range.
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
    /// Which axis the cell loop nests on. Defaults to `case`.
    #[serde(default)]
    pub outer_axis: CoverageAxis,
    /// The plan's runs-in-flight limit override, or null to inherit the account's. A
    /// bound is clamped to `MAX_IN_FLIGHT_LIMIT`.
    #[serde(default)]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub in_flight_limit: Option<InFlightLimit>,
    /// How many automatic retries each run the plan launches gets, or null for the
    /// default of one. Clamped to `MAX_RETRY_COUNT`.
    #[serde(default)]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub retry_count: Option<u32>,
}

/// One cell of the coverage matrix: a plan case (at its pinned version) crossed
/// with a resolved combination, with the run/job counts that say how close it is to
/// the target.
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
    /// Why a launch pass cannot launch this cell, or null when it can.
    ///
    /// A cell whose member cannot be resolved is still counted and still reported — it keeps
    /// its place in the matrix carrying the reason — because a plan that silently got
    /// smaller is a plan whose missing runs nobody can explain.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub unlaunchable: Option<String>,
    /// The target run count (the plan's `runs_per_cell`).
    pub desired: u32,
    /// The [cell's runs](https://docs.testcabinet.ai/components/backend/coverage/#a-cells-runs):
    /// the first `desired` counted runs of the cell to land, whoever launched them, in the
    /// order they landed. Every other figure on the cell is computed over these.
    pub run_ids: Vec<String>,
    /// How many runs the cell holds — the length of [`Self::run_ids`], so never more than
    /// `desired`. A counted run is the model's own result, a retried attempt once.
    pub counted: u32,
    /// Whether the cell is filled: `counted >= desired`. Runs in flight do not fill it.
    pub filled: bool,
    /// Whether the cell is [blocked](https://docs.testcabinet.ai/components/backend/coverage/#a-blocked-cell):
    /// it is missing a run and one of its jobs used up its automatic retries without a
    /// counted run with no later launch in its place, so a launch pass skips it until its
    /// owner retries it. A blocked cell can still have jobs in flight.
    pub blocked: bool,
    /// In-flight jobs (queued / pending / dispatched / starting / running) for this
    /// cell, counted globally and read only up to what the cell still needs
    /// (`desired - counted`), so a filled cell has none.
    pub in_flight: u32,
    /// How many of [`Self::in_flight`] are `pending` — deliberately held back rather
    /// than merely waiting to be claimed, because their harness is at its parallelism
    /// cap or (for a game jam) another run of the same jam is already going on that
    /// model. A **subset** of `inFlight`, not an addition to it.
    pub pending: u32,
    /// How many of the cell's runs are completed and not reviewed by the **requesting
    /// account**. Informational: it changes nothing about what the cell needs.
    pub unreviewed: u32,
    /// How many more runs to launch: `max(0, desired - (counted + in_flight))`.
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
    /// axis is outer is the plan's [`CoveragePlan::outer_axis`], echoed below so
    /// a reader knows what the order means without fetching the plan again.
    pub cells: Vec<CoverageCell>,
    /// The axis the cells above are ordered on.
    pub outer_axis: CoverageAxis,
    /// How many cells are filled (`counted >= desired`; runs in flight do not count).
    pub cells_filled: u32,
    /// The total number of cells.
    pub cells_total: u32,
    /// How many cells are blocked on infrastructure failures.
    pub cells_blocked: u32,
    /// The plan's progress in runs: the sum of every cell's `counted`.
    pub runs_done: u32,
    /// The runs the plan asks for: the sum of every cell's `desired`.
    pub runs_total: u32,
    /// The plan's own jobs in flight — every job whose origin names the plan — which is
    /// what its limit counts.
    pub runs_in_flight: u32,
    /// The sum of every cell's `remaining` — the total runs still to launch.
    pub runs_missing: u32,
    /// The sum of every cell's `pending` — runs deliberately held back by the queue.
    pub runs_pending: u32,
    /// The sum of every cell's `unreviewed` — completed runs the requester has not
    /// reviewed. Informational.
    pub runs_unreviewed: u32,
    /// The runs-in-flight limit in force for this plan (its own override, else the
    /// account's setting, else the backend default).
    pub in_flight_limit: InFlightLimit,
    /// Whether the plan is filling.
    pub filling: bool,
    /// Whether the filling plan is waiting on its owner: none of its own jobs is in
    /// flight, nothing a launch pass could launch is left, and a cell is blocked.
    pub needs_attention: bool,
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
    /// How many cells are filled.
    pub cells_filled: u32,
    /// The total number of cells.
    pub cells_total: u32,
    /// How many cells are blocked on infrastructure failures.
    pub cells_blocked: u32,
    /// The plan's progress in runs: the sum of every cell's `counted`.
    pub runs_done: u32,
    /// The runs the plan asks for.
    pub runs_total: u32,
    /// The plan's own jobs in flight.
    pub runs_in_flight: u32,
    /// The total runs still to launch across the plan.
    pub runs_missing: u32,
    /// The completed runs across the plan the requester has not reviewed.
    pub runs_unreviewed: u32,
    /// Whether the plan is filling.
    pub filling: bool,
    /// Whether the filling plan is waiting on its owner: none of its own jobs is in
    /// flight, nothing a launch pass could launch is left, and a cell is blocked.
    pub needs_attention: bool,
}

/// The account-wide coverage settings `GET`/`PUT /coverage-settings` read and write: the
/// account's default runs-in-flight limit, which a plan or ladder may override.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CoverageSettings {
    /// How many of one plan's or one ladder dispatch's jobs may be in flight at once, or
    /// `unbounded`.
    pub in_flight_limit: InFlightLimit,
    /// Whether [`Self::in_flight_limit`] is the account's own choice or the backend's
    /// compiled-in default because they have never chosen one. A `PUT` always makes it
    /// a choice.
    pub is_default: bool,
}

/// The `PUT /coverage-settings` body.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CoverageSettingsInput {
    /// The limit to store. A bound is clamped to `MAX_IN_FLIGHT_LIMIT`; a bound of `0` is
    /// a legitimate value — "launch nothing" — and `unbounded` is stored as itself.
    pub in_flight_limit: InFlightLimit,
}

/// Why a launch pass did no work. "busy" is a moment that will pass; the others are
/// states the owner changes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum LaunchSkipped {
    /// The plan is not filling.
    NotFilling,
    /// The ladder has no running dispatch.
    NotRunning,
    /// Another launch pass of the same plan or ladder holds the claim; the holder runs
    /// one more pass for this request before it lets go.
    Busy,
}

/// One cell a launch pass launched, and the jobs it enqueued for it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LaunchedCell {
    /// The ladder rung this cell belongs to, or null for a coverage plan (which has
    /// no rungs). Shared shape, because plans and ladders launch through the same code
    /// path.
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
    /// a name — two configurations, or two arms of one, read identically without it.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub gg_slot_models: BTreeMap<String, String>,
    /// How many runs were enqueued for this cell — always the cell's whole shortfall,
    /// never a partial cell.
    pub runs: u32,
    /// The enqueued jobs' ids, in queue order, so a console can follow them straight
    /// into its in-progress list.
    pub job_ids: Vec<String>,
}

/// One cell a launch pass **could not** launch, and why: a member that cannot be
/// resolved, or a cell blocked on infrastructure failures.
///
/// Reported per cell, beside the launches rather than instead of them: a pass that
/// enqueued four cells and skipped two broken ones is working, and the owner needs to see
/// both numbers to know that.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct BlockedCell {
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
    /// Why the cell could not be launched, in the words the owner has to act on.
    pub reason: String,
}

/// What a launch pass did, reported in enough detail that an idle plan or ladder is
/// never a mystery: whether it ran at all, what the limit allowed, and exactly what it
/// enqueued.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LaunchPassResult {
    /// Why nothing was attempted, or null when the scheduler ran. A pass that ran and
    /// enqueued nothing (a full limit, or nothing missing) reports null here with
    /// `enqueued` zero.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub skipped: Option<LaunchSkipped>,
    /// The runs-in-flight limit in force.
    pub in_flight_limit: InFlightLimit,
    /// The plan's or dispatch's own jobs in flight as the scheduler saw them, or null
    /// when it never ran.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub in_flight: Option<u32>,
    /// How many runs were enqueued in total.
    pub enqueued: u32,
    /// The cells that were launched, in the order they were emitted — which is the
    /// order they will execute in.
    pub cells: Vec<LaunchedCell>,
    /// The cells the pass wanted to launch and could not, each with its reason. One
    /// broken member never stops the rest being launched, so this list and
    /// [`Self::cells`] are routinely both non-empty.
    pub unlaunchable: Vec<BlockedCell>,
    /// How many not-yet-started jobs (`queued` or `pending`) a ladder whose gate stops
    /// early cancelled because the rung they belonged to was decided. Always `0` on a
    /// coverage plan, and on a ladder with `earlyStop` off.
    pub early_stop_canceled: u32,
}

/// One run in a scoped review queue: a completed run of this plan (or ladder dispatch)
/// the requesting account has not reviewed.
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
    /// The runs to review, in the plan's or ladder's own order — **not** newest-first
    /// like the global Unreviewed page — so a case's repeats sit together.
    pub runs: Vec<CoverageQueueEntry>,
    /// Whether the listing was cut short at the cap. A queue is walked from the
    /// front, not paged, so this is a "there is more behind this" flag rather than a
    /// cursor.
    pub truncated: bool,
}

/// The runs a plan's cells hold, as `GET /coverage-plans/{id}/runs` returns them.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CoveragePlanRuns {
    /// The summary card of every run the plan's cells hold — each cell's
    /// [`CoverageCell::run_ids`] — in the matrix's cell order, and in the order the runs
    /// landed within a cell. A run beyond a cell's target is not here.
    pub runs: Vec<crate::snapshot::RunSummary>,
}

/// The `POST /coverage-plans/{id}/cells/retry` body: the blocked cell to retry.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PlanCellRetryInput {
    /// The cell's case, at its pinned version and engine.
    pub case: ReviewPlanCase,
    /// The cell's combination, as the plan holds it.
    pub combination: ReviewPlanCombo,
}

/// What a plan's halt or a ladder's stop did.
///
/// The **count is the point**, not a nicety: a halt that reports only success cannot
/// be told apart from a halt whose scope was wrong. The plan always stops filling (and
/// the dispatch always ends), which is why that is stated here in prose rather than
/// reported as a field that could only ever say `true`.
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

/// `GET /coverage-plans` — every plan the token account owns, each with whether it is
/// filling.
pub async fn list_plans(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<Vec<CoveragePlanOut>>, ApiError> {
    let mut plans = state
        .db
        .list_coverage_plans(&user.0.id)
        .await
        .map_err(ApiError::from)?;
    let library = read_gg_library(
        &state,
        &user.0.id,
        plans.iter().flat_map(|out| out.plan.combos.iter()),
    )
    .await?;
    for out in &mut plans {
        out.plan.combos = for_read(&out.plan.combos, &library);
    }
    Ok(Json(plans))
}

/// `POST /coverage-plans` — create a plan. A new plan is not filling.
///
/// `400` for a runs-per-cell target outside the range the backend will honour (see
/// [`validated_runs_per_cell`]), and for a one-off gg member the account cannot launch
/// (see [`create_group`]).
pub async fn create_plan(
    State(state): State<AppState>,
    user: AuthUser,
    Json(input): Json<CoveragePlanInput>,
) -> Result<Json<CoveragePlanOut>, ApiError> {
    let library = reject_unstorable_members(&state, &user.0.id, &input.combos, &[]).await?;
    let mut plan = plan_from_input(new_id(), input, &now()?)?;
    state
        .db
        .insert_coverage_plan(&user.0.id, &plan)
        .await
        .map_err(ApiError::from)?;
    plan.combos = for_read(&plan.combos, &library);
    Ok(Json(CoveragePlanOut {
        plan,
        filling: false,
    }))
}

/// `PUT /coverage-plans/{id}` — update a plan in place. 404 when the id is not the
/// caller's, 400 for a runs-per-cell target outside the range the backend will honour
/// (see [`validated_runs_per_cell`]).
///
/// Saving never starts or ends filling. An edit of a filling plan applies at once — a
/// plan is a standing declaration — so it runs a launch pass, which launches whatever the
/// edit added.
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
        .map(|out| out.plan.combos)
        .unwrap_or_default();
    let library = reject_unstorable_members(&state, &user.0.id, &input.combos, &stored).await?;
    let mut plan = plan_from_input(id, input, &now()?)?;
    let updated = state
        .db
        .update_coverage_plan(&user.0.id, &plan)
        .await
        .map_err(ApiError::from)?;
    if !updated {
        return Err(ApiError::not_found("coverage plan not found"));
    }
    let filling = state
        .db
        .coverage_plan_fill(&plan.id)
        .await
        .map_err(ApiError::from)?
        .is_some();
    if filling {
        super::launch::spawn_launch(&state, LaunchTarget::Plan, &user.0.id, &plan.id);
    }
    plan.combos = for_read(&plan.combos, &library);
    Ok(Json(CoveragePlanOut { plan, filling }))
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
/// so the grouped count queries run once for the whole account, then tallies each plan
/// against those counts.
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

    let resolved: Vec<(&CoveragePlanOut, Vec<PlanMember>, Vec<ReviewPlanCase>)> = plans
        .iter()
        .map(|out| {
            let (combos, cases) = resolve_members(&out.plan, &groups, &library);
            (out, combos, cases)
        })
        .collect();

    let all_slugs: Vec<String> = resolved
        .iter()
        .flat_map(|(_, _, cases)| cases.iter().map(|c| c.slug.clone()))
        .collect();
    let ctx = MatrixCtx::load(&state, all_slugs, &user.0.id).await?;
    let in_flight = state
        .db
        .count_in_flight_jobs_by_plan(&user.0.id)
        .await
        .map_err(ApiError::from)?;

    let mut summaries = Vec::with_capacity(resolved.len());
    for (out, combos, cases) in &resolved {
        let plan = &out.plan;
        let retries = state
            .db
            .coverage_plan_cell_retries(&plan.id)
            .await
            .map_err(ApiError::from)?;
        let blocked = ctx
            .blocked_cells(&state, plan.runs_per_cell, combos, cases, &retries)
            .await?;
        let roll = ctx.tally(plan.runs_per_cell, combos, cases, &blocked);
        let runs_in_flight = in_flight.get(&plan.id).copied().unwrap_or(0);
        summaries.push(CoveragePlanSummary {
            id: plan.id.clone(),
            name: plan.name.clone(),
            runs_per_cell: plan.runs_per_cell,
            cells_filled: roll.cells_filled,
            cells_total: roll.cells_total,
            cells_blocked: roll.cells_blocked,
            runs_done: roll.runs_done,
            runs_total: roll.runs_total,
            runs_in_flight,
            runs_missing: roll.runs_missing,
            runs_unreviewed: roll.runs_unreviewed,
            filling: out.filling,
            needs_attention: roll.needs_attention(out.filling, runs_in_flight),
        });
    }
    Ok(Json(summaries))
}

/// `GET /coverage-plans/{id}/coverage` — the coverage matrix for one plan, in the
/// plan's own launch order. 404 when the id is not the caller's.
pub async fn plan_coverage(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<CoverageMatrix>, ApiError> {
    let out = load_plan(&state, &user.0.id, &id).await?;
    let plan = &out.plan;
    let groups = group_index(&state, &user.0.id).await?;
    let library = gg_library(&state, &user.0.id).await?;
    let (combos, cases) = resolve_members(plan, &groups, &library);

    let slugs: Vec<String> = cases.iter().map(|c| c.slug.clone()).collect();
    let ctx = MatrixCtx::load(&state, slugs, &user.0.id).await?;
    let retries = state
        .db
        .coverage_plan_cell_retries(&plan.id)
        .await
        .map_err(ApiError::from)?;
    let blocked = ctx
        .blocked_cells(&state, plan.runs_per_cell, &combos, &cases, &retries)
        .await?;
    let in_flight_limit = resolve_in_flight_limit(&state, &user.0.id, plan.in_flight_limit).await?;
    let runs_in_flight = state
        .db
        .count_in_flight_jobs_by_origin_prefix(&JobOrigin::plan(&plan.id).owner_prefix())
        .await
        .map_err(ApiError::from)?;
    Ok(Json(ctx.matrix(MatrixInput {
        runs_per_cell: plan.runs_per_cell,
        axis: plan.outer_axis,
        in_flight_limit,
        runs_in_flight,
        filling: out.filling,
        combos: &combos,
        cases: &cases,
        blocked: &blocked,
    })))
}

// ---- Account settings ------------------------------------------------------

/// `GET /coverage-settings` — the account's coverage settings, falling back to the
/// backend's compiled-in default when the account has never chosen one (no row is
/// materialized on read).
pub async fn settings(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<CoverageSettings>, ApiError> {
    let stored = state
        .db
        .coverage_in_flight_limit(&user.0.id)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(CoverageSettings {
        in_flight_limit: stored
            .map(clamp_in_flight_limit)
            .unwrap_or(DEFAULT_IN_FLIGHT_LIMIT),
        is_default: stored.is_none(),
    }))
}

/// `PUT /coverage-settings` — set the account's default runs-in-flight limit, creating
/// its settings row on first use.
pub async fn set_settings(
    State(state): State<AppState>,
    user: AuthUser,
    Json(input): Json<CoverageSettingsInput>,
) -> Result<Json<CoverageSettings>, ApiError> {
    let in_flight_limit = clamp_in_flight_limit(input.in_flight_limit);
    state
        .db
        .set_coverage_in_flight_limit(&user.0.id, in_flight_limit, &now()?)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(CoverageSettings {
        in_flight_limit,
        is_default: false,
    }))
}

// ---- Filling ---------------------------------------------------------------

/// `POST /coverage-plans/{id}/fill` — start filling the plan, then run a launch pass and
/// answer its report. A plan already filling keeps its fill and runs a pass.
///
/// A filling plan launches whole missing cells, in its own order, while its own jobs in
/// flight stay under its runs-in-flight limit; every finished run of one of its cells
/// runs another pass; and filling ends when every launchable cell is filled, or the plan
/// is halted. 404 when the id is not the caller's.
pub async fn fill_plan(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<LaunchPassResult>, ApiError> {
    load_plan(&state, &user.0.id, &id).await?;
    state
        .db
        .start_coverage_plan_fill(&user.0.id, &id, &new_id())
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found("coverage plan not found"))?;
    Ok(Json(launch_plan(&state, &user.0.id, &id).await?))
}

/// Run launch passes of one plan as `user_id`, its owner: `skipped: notFilling` when it
/// is not filling, else [`run_launch_passes`](super::launch::run_launch_passes).
pub(super) async fn launch_plan(
    state: &AppState,
    user_id: &str,
    id: &str,
) -> Result<LaunchPassResult, ApiError> {
    let out = load_plan(state, user_id, id).await?;
    let limit = resolve_in_flight_limit(state, user_id, out.plan.in_flight_limit).await?;
    if !out.filling {
        return Ok(LaunchPassResult::skipped_by(
            LaunchSkipped::NotFilling,
            limit,
        ));
    }
    super::launch::run_launch_passes(state, LaunchTarget::Plan, user_id, id, limit).await
}

/// One launch pass of a filling plan, run while this caller holds the plan's claim.
///
/// Counts are global, so a cell is launched only for what nothing — this plan, another,
/// or a hand launch — has already produced or is producing. Unlaunchable and blocked
/// cells are skipped and reported. The plan's own jobs in flight (every job whose origin
/// names it) are what its limit caps. When every launchable cell is filled, filling ends.
///
/// The limit is resolved here, from the plan and the account as they stand now, never
/// carried in from whoever took the claim: a holder serving a request that arrived
/// after the owner changed the limit must launch under the new one.
pub(super) async fn plan_pass_locked(
    state: &AppState,
    user_id: &str,
    id: &str,
) -> Result<LaunchPassResult, ApiError> {
    let out = load_plan(state, user_id, id).await?;
    let plan = &out.plan;
    let limit = resolve_in_flight_limit(state, user_id, plan.in_flight_limit).await?;
    let Some(fill_id) = state
        .db
        .coverage_plan_fill(id)
        .await
        .map_err(ApiError::from)?
    else {
        return Ok(LaunchPassResult::skipped_by(
            LaunchSkipped::NotFilling,
            limit,
        ));
    };
    let groups = group_index(state, user_id).await?;
    let library = gg_library(state, user_id).await?;
    let (mut combos, cases) = resolve_members(plan, &groups, &library);
    // Before the scheduler decides anything: a gg member whose models the catalog cannot
    // answer for has to be unlaunchable *now*, or it spends the limit and capacity on runs
    // that are never enqueued and starves the members that could have used them.
    resolve_launch_facts(state, &mut combos).await;
    let slugs: Vec<String> = cases.iter().map(|c| c.slug.clone()).collect();
    let ctx = MatrixCtx::load(state, slugs, user_id).await?;
    let retries = state
        .db
        .coverage_plan_cell_retries(id)
        .await
        .map_err(ApiError::from)?;
    let blocked = ctx
        .blocked_cells(state, plan.runs_per_cell, &combos, &cases, &retries)
        .await?;

    let ordered = cells_in_order(plan.outer_axis, &combos, &cases);
    let mut demands: Vec<CellDemand> = Vec::with_capacity(ordered.len());
    let mut unlaunchable: Vec<BlockedCell> = Vec::new();
    // Whether any cell the pass can still launch is short of its target. Filling ends when
    // none is: an unlaunchable cell cannot be filled by waiting, and a blocked one waits on
    // its owner's retry, which a filling plan stays filling for.
    let mut fillable_unfilled = false;
    for (case, member) in &ordered {
        let demand = ctx.demand(plan.runs_per_cell, case, member);
        let key = cell_key(case, member);
        if let Some(reason) = &member.unlaunchable {
            // Reported only when the cell actually wanted runs.
            if demand.missing() > 0 {
                unlaunchable.push(blocked_cell(None, case, member, reason.clone()));
            }
            demands.push(CellDemand {
                target: 0,
                ..demand
            });
            continue;
        }
        if demand.counted < demand.target {
            fillable_unfilled = true;
        }
        if blocked.contains(&key) {
            unlaunchable.push(blocked_cell(None, case, member, blocked_reason()));
            demands.push(CellDemand {
                target: 0,
                ..demand
            });
            continue;
        }
        demands.push(demand);
    }
    let in_flight = state
        .db
        .count_in_flight_jobs_by_origin_prefix(&JobOrigin::plan(id).owner_prefix())
        .await
        .map_err(ApiError::from)?;
    let launches = launch_pass(&demands, ctx.harness_capacity(), limit, in_flight);

    let origin = JobOrigin::fill(id, fill_id.clone());
    let cells: Vec<LaunchCell<'_>> = launches
        .iter()
        .map(|launch| {
            let (case, member) = ordered[launch.cell];
            LaunchCell {
                rung_id: None,
                origin: origin.clone(),
                case,
                member,
                runs: launch.runs,
                retry_count: plan.retry_count,
            }
        })
        .collect();

    // A halt does not take the claim: it ends the fill and then cancels the plan's waiting
    // jobs. A pass that began before the halt may reach this point after it, and must not
    // refill the queue the halt just emptied. Checked before the enqueue, and again after
    // it, because the halt can land in between: either the halt's cancel comes after these
    // jobs exist and reaches them, or the check below sees the fill ended and cancels them.
    let still_filling = |fill: Option<String>| fill.as_deref() == Some(fill_id.as_str());
    if !still_filling(
        state
            .db
            .coverage_plan_fill(id)
            .await
            .map_err(ApiError::from)?,
    ) {
        return Ok(LaunchPassResult::skipped_by(
            LaunchSkipped::NotFilling,
            limit,
        ));
    }
    let enqueued = enqueue_launches(state, user_id, &cells).await?;
    if !enqueued.launched.is_empty()
        && !still_filling(
            state
                .db
                .coverage_plan_fill(id)
                .await
                .map_err(ApiError::from)?,
        )
    {
        cancel_just_enqueued(
            state,
            &enqueued.launched,
            "canceled: the plan stopped filling while this run was being enqueued",
        )
        .await?;
        return Ok(LaunchPassResult::skipped_by(
            LaunchSkipped::NotFilling,
            limit,
        ));
    }
    unlaunchable.extend(enqueued.blocked);

    if !fillable_unfilled {
        state
            .db
            .end_coverage_plan_fill(id, &fill_id)
            .await
            .map_err(ApiError::from)?;
    }

    Ok(LaunchPassResult {
        skipped: None,
        in_flight_limit: limit,
        in_flight: Some(in_flight),
        enqueued: enqueued.launched.iter().map(|cell| cell.runs).sum(),
        cells: enqueued.launched,
        unlaunchable,
        early_stop_canceled: 0,
    })
}

/// Cancel exactly the jobs a launch pass just enqueued, for a pass that found its plan
/// or dispatch ended while it enqueued. Only those: the runs queued before are the halt's
/// or the stop's to cancel.
pub(super) async fn cancel_just_enqueued(
    state: &AppState,
    launched: &[LaunchedCell],
    detail: &str,
) -> Result<u32, ApiError> {
    let ids: Vec<String> = launched
        .iter()
        .flat_map(|cell| cell.job_ids.iter().cloned())
        .collect();
    super::jobs::sweep_cancel(
        state,
        &JobCancelFilter {
            states: &CANCELABLE_WAITING_STATES,
            origin: None,
            user_id: None,
            cell: None,
            ids: Some(&ids),
        },
        detail,
        super::jobs::CancelFeed::Feed,
    )
    .await
}

/// The reason a blocked cell or climber is reported with.
pub(super) fn blocked_reason() -> String {
    "a launch used up its automatic retries without a run that counts; retry it \
     once the cause is fixed"
        .to_string()
}

/// The job that blocks a cell or slot, given its terminal jobs newest first and when its
/// newest launch was created: the most recently ended one that
/// [ended its launch with nothing to count](TerminalJob::exhausted_without_a_result) and
/// that no launch created after it ended has replaced.
///
/// A launch created at the instant the job ended does not replace it, which also keeps a
/// job from replacing itself. A job whose run counts, that was canceled, or that the
/// backend retried blocks nothing.
pub(super) fn blocking_job(
    jobs: &[TerminalJob],
    latest_launch: Option<OffsetDateTime>,
) -> Option<&TerminalJob> {
    jobs.iter().find(|job| {
        job.exhausted_without_a_result()
            && latest_launch.is_none_or(|launched| {
                OffsetDateTime::parse(&job.ended_at, &Rfc3339).is_ok_and(|ended| ended >= launched)
            })
    })
}

/// The filling plans a job that just finished feeds, as `(plan id, owner)`: every filling
/// plan one of whose cells the job's cell is — whoever launched the job, since a plan
/// counts every run of its cells. Never fails; a plan that cannot be resolved is logged
/// and skipped.
pub(super) async fn plans_fed_by(
    state: &AppState,
    job: &test_cabinet_entities::job::Model,
) -> Vec<(String, String)> {
    let plans = match state.db.filling_coverage_plans().await {
        Ok(plans) => plans,
        Err(err) => {
            tracing::warn!(job = %job.id, error = %err, "could not list the filling plans a finished run may feed");
            return Vec::new();
        }
    };
    let job_cell = job_cell(job);
    let mut fed = Vec::new();
    for (plan_id, owner) in plans {
        match plan_has_cell(state, &owner, &plan_id, &job_cell).await {
            Ok(true) => fed.push((plan_id, owner)),
            Ok(false) => {}
            Err(err) => tracing::warn!(
                job = %job.id,
                plan = %plan_id,
                error = %err.message,
                "could not resolve a filling plan's cells"
            ),
        }
    }
    fed
}

/// Whether `cell` is one of a plan's cells. Short-circuits on the case pin before
/// resolving any member.
async fn plan_has_cell(
    state: &AppState,
    user_id: &str,
    plan_id: &str,
    cell: &CellKey,
) -> Result<bool, ApiError> {
    let out = load_plan(state, user_id, plan_id).await?;
    let groups = group_index(state, user_id).await?;
    let cases = resolve_cases(&out.plan.case_group_ids, &out.plan.cases, &groups);
    let pinned = cases.iter().any(|case| {
        case.slug == cell.0
            && case.version == cell.1
            && case.variant == cell.2
            && case.engine_slug() == cell.3
    });
    if !pinned {
        return Ok(false);
    }
    let library = gg_library(state, user_id).await?;
    let (combos, cases) = resolve_members(&out.plan, &groups, &library);
    Ok(cases
        .iter()
        .any(|case| combos.iter().any(|member| cell_key(case, member) == *cell)))
}

/// `POST /coverage-plans/{id}/cells/retry` — retry one blocked cell.
///
/// The retry is recorded, so only jobs that ended after it are read for the cell's
/// block, and the cell is launched again: by a launch pass while the plan is filling,
/// and otherwise as a launch by hand of the cell's shortfall (origin `plan:<id>`). `204`;
/// `404` when the cell is not one of the plan's (or the plan is not the caller's), `409`
/// when it is not blocked.
pub async fn retry_plan_cell(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(input): Json<PlanCellRetryInput>,
) -> Result<StatusCode, ApiError> {
    let out = load_plan(&state, &user.0.id, &id).await?;
    let plan = &out.plan;
    let groups = group_index(&state, &user.0.id).await?;
    let library = gg_library(&state, &user.0.id).await?;
    let (mut combos, cases) = resolve_members(plan, &groups, &library);
    let wanted_member = resolve_member(&input.combination.for_storage(), &library);
    let wanted_key = combination_key(&wanted_member.combo.for_storage());
    let Some(case) = cases.iter().find(|case| {
        case.slug == input.case.slug
            && case.version == input.case.version
            && case.variant == input.case.variant
            && case.engine_slug() == input.case.engine_slug()
    }) else {
        return Err(ApiError::not_found("that cell is not one of this plan's"));
    };
    let Some(index) = combos
        .iter()
        .position(|member| combination_key(&member.combo.for_storage()) == wanted_key)
    else {
        return Err(ApiError::not_found("that cell is not one of this plan's"));
    };
    resolve_launch_facts(&state, std::slice::from_mut(&mut combos[index])).await;
    let member = &combos[index];
    let key = cell_key(case, member);

    let slugs = vec![case.slug.clone()];
    let ctx = MatrixCtx::load(&state, slugs, &user.0.id).await?;
    let retries = state
        .db
        .coverage_plan_cell_retries(&id)
        .await
        .map_err(ApiError::from)?;
    let blocked = ctx
        .blocked_cells(
            &state,
            plan.runs_per_cell,
            std::slice::from_ref(member),
            std::slice::from_ref(case),
            &retries,
        )
        .await?;
    if !blocked.contains(&key) {
        return Err(ApiError::conflict("that cell is not blocked"));
    }
    state
        .db
        .record_coverage_plan_cell_retry(&id, &key, &now()?)
        .await
        .map_err(ApiError::from)?;

    if out.filling {
        super::launch::spawn_launch(&state, LaunchTarget::Plan, &user.0.id, &id);
        return Ok(StatusCode::NO_CONTENT);
    }
    let demand = ctx.demand(plan.runs_per_cell, case, member);
    let runs = launchable_demand(demand, member).missing();
    if runs > 0 {
        let cells = [LaunchCell {
            rung_id: None,
            origin: JobOrigin::plan(&id),
            case,
            member,
            runs,
            retry_count: plan.retry_count,
        }];
        let enqueued = enqueue_launches(&state, &user.0.id, &cells).await?;
        if let Some(blocked) = enqueued.blocked.first() {
            return Err(ApiError::bad_request(format!(
                "the cell cannot be launched: {}",
                blocked.reason
            )));
        }
    }
    Ok(StatusCode::NO_CONTENT)
}

// ---- Scoped review queue ---------------------------------------------------

/// `GET /coverage-plans/{id}/queue` — the plan's completed runs the requesting account
/// has not reviewed, **in the plan's own cell order**, so a case's repeats sit together.
/// 404 when the id is not the caller's.
pub async fn plan_queue(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<CoverageQueue>, ApiError> {
    let out = load_plan(&state, &user.0.id, &id).await?;
    let plan = &out.plan;
    let groups = group_index(&state, &user.0.id).await?;
    let library = gg_library(&state, &user.0.id).await?;
    let (combos, cases) = resolve_members(plan, &groups, &library);
    let slugs: Vec<String> = cases.iter().map(|c| c.slug.clone()).collect();
    let ctx = MatrixCtx::load(&state, slugs, &user.0.id).await?;
    Ok(Json(plan_queue_of(
        &ctx,
        plan.runs_per_cell,
        &cells_in_order(plan.outer_axis, &combos, &cases),
    )))
}

/// Assemble a plan's review queue: walk `cells` in the plan's order and list each cell's
/// unreviewed runs in the order they landed, up to [`MAX_QUEUE_RUNS`].
///
/// Only the [cell's runs](MatrixCtx::plan_runs) are offered, so a run beyond a cell's
/// target never reaches the queue, and the queue holds exactly the runs the matrix's
/// `unreviewed` counts are made of. Each entry is labelled off the cell rather than off
/// the run: the cell's runs are its key's runs by construction, so the run's harness,
/// launched model, and engine are the cell's, and the member carries the gg identity a
/// reviewer tells the arms of one configuration apart by.
fn plan_queue_of(
    ctx: &MatrixCtx,
    runs_per_cell: u32,
    cells: &[(&ReviewPlanCase, &PlanMember)],
) -> CoverageQueue {
    let mut runs: Vec<CoverageQueueEntry> = Vec::new();
    for (case, member) in cells {
        for run in ctx.plan_runs(runs_per_cell, case, member) {
            if !run.unreviewed {
                continue;
            }
            if runs.len() >= MAX_QUEUE_RUNS {
                return CoverageQueue {
                    runs,
                    truncated: true,
                };
            }
            runs.push(CoverageQueueEntry {
                run_id: run.id.clone(),
                rung_id: None,
                slug: case.slug.clone(),
                version: case.version.clone(),
                variant: case.variant.clone(),
                engine: case.engine_slug(),
                harness: member.combo.harness,
                model: member.launch_model.clone(),
                gg_config_id: member.combo.gg_config_id.clone(),
                gg_config_name: member.combo.gg_config_name.clone(),
                gg_slot_models: member.combo.gg_slot_models.clone(),
                finished_at: run.finished_at.clone(),
            });
        }
    }
    CoverageQueue {
        runs,
        truncated: false,
    }
}

// ---- The plan's runs ------------------------------------------------------

/// `GET /coverage-plans/{id}/runs` — the summary card of every run the plan's cells hold,
/// in the plan's own cell order. What the console's run breakdowns are computed from, so
/// they describe exactly the runs the matrix counts. 404 when the id is not the caller's.
pub async fn plan_runs(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<CoveragePlanRuns>, ApiError> {
    let out = load_plan(&state, &user.0.id, &id).await?;
    let plan = &out.plan;
    let groups = group_index(&state, &user.0.id).await?;
    let library = gg_library(&state, &user.0.id).await?;
    let (combos, cases) = resolve_members(plan, &groups, &library);
    let slugs: Vec<String> = cases.iter().map(|c| c.slug.clone()).collect();
    let ctx = MatrixCtx::load(&state, slugs, &user.0.id).await?;
    // Two members resolving to one cell hold the same runs, which are listed once.
    let mut seen = HashSet::new();
    let ids: Vec<String> = cells_in_order(plan.outer_axis, &combos, &cases)
        .into_iter()
        .flat_map(|(case, member)| ctx.plan_runs(plan.runs_per_cell, case, member))
        .filter(|run| seen.insert(run.id.clone()))
        .map(|run| run.id.clone())
        .collect();
    let runs = state.db.get_runs(&ids).await.map_err(ApiError::from)?;
    let case_names = state.store.case_names().map_err(ApiError::from)?;
    Ok(Json(CoveragePlanRuns {
        runs: super::runs::summary_cards(&state.store, &case_names, &runs),
    }))
}

// ---- Halting ---------------------------------------------------------------

/// `POST /coverage-plans/{id}/halt` — end filling **and** cancel the jobs the plan
/// launched that have cost nothing yet (`queued` and `pending`).
///
/// It needs no confirmation precisely because it throws nothing away: those jobs have no
/// driver and have spent no tokens. It reaches only jobs whose `origin` names this plan
/// (its hand launches and every fill's), so a run launched from the run form is never
/// swept up. 404 when the id is not the caller's.
pub async fn halt_plan(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<HaltResult>, ApiError> {
    halt_plan_inner(state, user, id, false).await
}

/// `POST /coverage-plans/{id}/halt-all` — end filling and cancel **every** job the plan
/// launched, including the ones already dispatched, starting, or running.
///
/// The rare control: those jobs are partly or wholly paid for, so the console must
/// confirm before calling this and must never make it the default action. 404 when the
/// id is not the caller's.
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
    // End filling first. A halt that cancelled the queue and left the plan filling would
    // refill exactly what it just emptied.
    let found = state
        .db
        .halt_coverage_plan_fill(&user.0.id, &id)
        .await
        .map_err(ApiError::from)?;
    if !found {
        return Err(ApiError::not_found("coverage plan not found"));
    }
    let canceled = halt_jobs(
        &state,
        &OriginScope::Prefix(JobOrigin::plan(&id).owner_prefix()),
        include_active,
        "canceled by a coverage plan halt",
    )
    .await?;
    Ok(Json(HaltResult {
        canceled,
        included_active: include_active,
    }))
}

/// Cancel the waiting (and optionally the already-executing) jobs one plan or one ladder
/// dispatch launched, returning how many moved. Shared by a plan's halt and a ladder's
/// stop.
///
/// This is the Runs page's global sweep narrowed to one origin scope — the *same* body,
/// so a scoped halt and a global stop can never differ in what they do to a run. The
/// sweep also closes the live stream of every run that actually left the queue.
pub(super) async fn halt_jobs(
    state: &AppState,
    origin: &OriginScope,
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
            cell: None,
            ids: None,
        },
        detail,
        crate::api::jobs::CancelFeed::Feed,
    )
    .await
}

// ---- Resolution + matrix helpers ------------------------------------------

/// Load one plan, scoped to the requesting account, 404-ing when the id is unknown or
/// owned by someone else. Both are the same answer on purpose: a plan the caller does
/// not own must not be distinguishable from one that does not exist.
async fn load_plan(state: &AppState, user_id: &str, id: &str) -> Result<CoveragePlanOut, ApiError> {
    state
        .db
        .get_coverage_plan(user_id, id)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found("coverage plan not found"))
}

/// The runs-in-flight limit in force: the plan's or ladder's own override, else the
/// account's setting, else the backend's compiled-in default.
///
/// An account with no stored setting has expressed no opinion, which is deliberately
/// not the same as an explicit bound of `0` ("launch nothing") or an explicit
/// `unbounded` ("launch everything") — hence the two `Option` layers rather than a
/// single defaulted value.
pub(super) async fn resolve_in_flight_limit(
    state: &AppState,
    user_id: &str,
    override_limit: Option<InFlightLimit>,
) -> Result<InFlightLimit, ApiError> {
    if let Some(limit) = override_limit {
        return Ok(clamp_in_flight_limit(limit));
    }
    Ok(state
        .db
        .coverage_in_flight_limit(user_id)
        .await
        .map_err(ApiError::from)?
        .map(clamp_in_flight_limit)
        .unwrap_or(DEFAULT_IN_FLIGHT_LIMIT))
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
/// sees it, plus everything resolving it produced that the matrix, the launch pass, and the
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
    /// Why a launch pass cannot launch this member, or `None` when it can.
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
pub(super) type MemberCellIdentity = (String, String, String, String);

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
    /// be unlaunchable only at enqueue has by then already spent the runs-in-flight limit and
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
    /// touched since — a plan's launch pass and a launch by hand produce the same run. Once they
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
/// therefore reported on the member — on its cells, and by a launch pass that skips it — and never
/// refused at the moment the member is saved.
fn gg_member_drift(config: &GgConfig, library: &GgLibrary) -> Option<String> {
    let saved = library.stale_import(config)?;
    Some(format!(
        "the `{}` gg configuration imports the saved agent `{}`, which has been edited since \
         the configuration was last saved",
        config.name, saved.name
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
        return Some(format!("no gg configuration `{id}` on this account"));
    };
    let slot = unbound_launch_slot(&config.capability_set, &combo.gg_bindings())?;
    Some(format!(
        "the `{slot}` launch slot of the `{}` gg configuration has no model bound",
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
                "another member of this plan already asks for exactly these runs (same case, \
                 same launch model, and for a gg member the same configuration and agents)"
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
/// This ordering is the entire mechanism behind the outer-axis setting: a launch pass
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

/// Resolve every launchable member's launch facts, marking a member the catalog cannot
/// answer for as unlaunchable: a gg member's [per-model catalog facts](super::jobs::GgModelFacts),
/// and a harness member's model's list price.
///
/// Run by the two paths that are about to **launch** — a plan's launch pass and a ladder's — and
/// before either asks the scheduler what to emit. That ordering is the point. The scheduler
/// spends a fixed runs-in-flight limit and a fixed per-harness capacity, and it spends both at the
/// moment it emits a cell; a cell that then turns out to be unlaunchable at enqueue has
/// consumed a share of each and enqueued nothing, so every pass leaves the plan short by that
/// member's whole target — forever, and silently. Resolving first turns that into what the
/// design says it is: a member whose demand is zero, skipped and reported, with the rest of the
/// plan fed as normal.
///
/// The facts are kept on the member so the enqueue does not resolve them again per cell: one
/// member launched across eight cases is one resolution, not eight.
pub(super) async fn resolve_launch_facts(state: &AppState, members: &mut [PlanMember]) {
    // The stored gg runs every member's candidate lists are ordered by, loaded once per plan and
    // only when a member launches gg.
    let record = if members
        .iter()
        .any(|member| member.unlaunchable.is_none() && member.gg.is_some())
    {
        super::stats::recorded_run_facts(state).await
    } else {
        std::sync::Arc::new(Vec::new())
    };
    // A list price filled for any member changes the catalog the public snapshot shows.
    let on_fill = || {
        state.publisher.queue_refresh();
    };
    for member in members {
        if member.unlaunchable.is_some() {
            continue;
        }
        let launch_model = member.launch_model.clone();
        let Some(gg) = member.gg.as_mut() else {
            // A harness member is refused at enqueue when its model cannot be priced, so it
            // is refused here first, before the scheduler spends the limit on it. A missing
            // list price is filled from OpenRouter here, once for the member; the price
            // itself is stamped per cell at enqueue, where the filled entry answers.
            match crate::bootstrap::list_price_for_launch(
                &state.db,
                &state.prices,
                &launch_model,
                member.combo.harness,
                &on_fill,
            )
            .await
            {
                Ok(Ok(_)) => {}
                Ok(Err(reason)) => member.unlaunchable = Some(reason),
                Err(err) => {
                    member.unlaunchable = Some(format!(
                        "could not resolve the model catalog's list price for `{launch_model}`: {err}"
                    ));
                }
            }
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
            &record,
            &gg.capability_set,
            &launch_model,
            HarnessSlug::Gg,
            &on_fill,
        )
        .await
        {
            Ok(facts) => gg.model_facts = Some(facts),
            Err(reason) => member.unlaunchable = Some(reason),
        }
    }
}

/// One cell's demand as the launch walk must see it: its own, unless nothing can launch
/// its member — in which case it wants nothing.
///
/// The cell is not dropped and its in-flight count is not zeroed. A member that broke
/// after its runs were launched has not un-launched them; what changes is only that the
/// walk stops trying to add to them.
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
    cells_filled: u32,
    cells_total: u32,
    cells_blocked: u32,
    runs_done: u32,
    runs_total: u32,
    runs_missing: u32,
    runs_unreviewed: u32,
    /// Runs a launch pass could still launch: the missing runs of the cells that are
    /// neither blocked nor unlaunchable.
    runs_launchable: u32,
    /// Cells blocked by a launch that used up its retries, leaving the unlaunchable ones
    /// out.
    cells_failing: u32,
}

impl MatrixRollup {
    /// Whether a plan with this roll-up
    /// [needs attention](https://docs.testcabinet.ai/components/backend/coverage/#needs-attention):
    /// it is filling, none of its own jobs is in flight, no launch pass could launch
    /// anything, and a cell is blocked.
    fn needs_attention(&self, filling: bool, runs_in_flight: u32) -> bool {
        filling && runs_in_flight == 0 && self.runs_launchable == 0 && self.cells_failing > 0
    }
}

/// What [`MatrixCtx::matrix`] builds one plan's matrix from.
struct MatrixInput<'a> {
    runs_per_cell: u32,
    axis: CoverageAxis,
    in_flight_limit: InFlightLimit,
    runs_in_flight: u32,
    filling: bool,
    combos: &'a [PlanMember],
    cases: &'a [ReviewPlanCase],
    blocked: &'a HashSet<CellKey>,
}

/// The run/job counts and latest-version resolution a coverage computation needs,
/// loaded once so a plan (or every plan, for the summary) can be tallied without further
/// DB round-trips. A ladder loads only the queue-wide parts ([`Self::load_for_ladder`]):
/// its board reads the same global counts by each climber's pinned cells, through
/// [`cell_runs`] and [`cell_in_flight`].
pub(super) struct MatrixCtx {
    /// Every counted run per cell, globally, in the order the runs landed. A plan's
    /// [cell's runs](https://docs.testcabinet.ai/components/backend/coverage/#a-cells-runs)
    /// are the first `runsPerCell` of each list ([`Self::plan_runs`]); each says whether
    /// the requesting account has reviewed it.
    runs: crate::db::CellRuns,
    /// In-flight jobs per cell, counted globally.
    in_flight: crate::db::CellCounts,
    /// The `pending` subset of [`Self::in_flight`], per cell.
    pending: crate::db::CellCounts,
    /// How much room each harness has to start another run, indexed by
    /// [`harness_lane`]; see [`crate::coverage::schedule`].
    harness_capacity: Vec<HarnessCapacity>,
    /// The newest ingested version per case slug.
    latest_by_slug: HashMap<String, String>,
}

impl MatrixCtx {
    /// Load the counts and latest-version map for a set of case slugs (deduped
    /// internally), from the point of view of `reviewer_user_id`.
    ///
    /// The latest version per slug honors the deployment's experimental visibility so
    /// "latest" matches what the catalog offers.
    pub(super) async fn load(
        state: &AppState,
        slugs: Vec<String>,
        reviewer_user_id: &str,
    ) -> Result<Self, ApiError> {
        let mut ctx = Self::load_for_ladder(state, slugs.clone()).await?;
        let mut slugs = slugs;
        slugs.sort();
        slugs.dedup();
        ctx.runs = state
            .db
            .counted_runs_by_cell(&slugs, Some(reviewer_user_id))
            .await
            .map_err(ApiError::from)?;
        ctx.in_flight = state
            .db
            .count_in_flight_jobs_by_cell(&slugs)
            .await
            .map_err(ApiError::from)?;
        Ok(ctx)
    }

    /// Load only the queue-wide parts: the harnesses' capacity, the queue's `pending`
    /// jobs, and the latest version per slug. What a ladder's launch pass reads beside
    /// the counts its board loads by each climber's pinned cells.
    pub(super) async fn load_for_ladder(
        state: &AppState,
        mut slugs: Vec<String>,
    ) -> Result<Self, ApiError> {
        slugs.sort();
        slugs.dedup();
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
            runs: crate::db::CellRuns::new(),
            in_flight: crate::db::CellCounts::new(),
            pending: queue.pending,
            harness_capacity,
            latest_by_slug,
        })
    }

    /// The cells of a plan that are [blocked](https://docs.testcabinet.ai/components/backend/coverage/#a-blocked-cell):
    /// missing a run, and holding a job — among every job of the cell, matching the global
    /// counts, that ended since the cell's last retry — that used up its automatic
    /// retries without a counted run and that no later launch replaced
    /// ([`blocking_job`]). Only a cell missing a run can be blocked, which keeps the reads
    /// to the cells that need one.
    async fn blocked_cells(
        &self,
        state: &AppState,
        runs_per_cell: u32,
        combos: &[PlanMember],
        cases: &[ReviewPlanCase],
        retries: &HashMap<String, String>,
    ) -> Result<HashSet<CellKey>, ApiError> {
        let mut blocked = HashSet::new();
        for (case, member) in cells_in_order(CoverageAxis::Case, combos, cases) {
            if member.unlaunchable.is_some() {
                continue;
            }
            if self.demand(runs_per_cell, case, member).missing() == 0 {
                continue;
            }
            let key = cell_key(case, member);
            let since = retries.get(&crate::db::cell_key_text(&key));
            let jobs = state
                .db
                .recent_terminal_jobs(&key, since.map(String::as_str))
                .await
                .map_err(ApiError::from)?;
            if !jobs.iter().any(TerminalJob::exhausted_without_a_result) {
                continue;
            }
            let latest_launch = state
                .db
                .latest_cell_launch(&key)
                .await
                .map_err(ApiError::from)?;
            if blocking_job(&jobs, latest_launch).is_some() {
                blocked.insert(key);
            }
        }
        Ok(blocked)
    }

    /// The full coverage matrix for one plan's resolved members, in `axis` order.
    fn matrix(&self, input: MatrixInput<'_>) -> CoverageMatrix {
        let ordered = cells_in_order(input.axis, input.combos, input.cases);
        let mut cells = Vec::with_capacity(ordered.len());
        let mut runs_pending = 0u32;
        for (case, member) in ordered {
            let blocked = input.blocked.contains(&cell_key(case, member));
            let cell = self.cell(input.runs_per_cell, case, member, blocked);
            runs_pending += cell.pending;
            cells.push(cell);
        }
        let roll = self.tally(
            input.runs_per_cell,
            input.combos,
            input.cases,
            input.blocked,
        );
        CoverageMatrix {
            cells,
            outer_axis: input.axis,
            cells_filled: roll.cells_filled,
            cells_total: roll.cells_total,
            cells_blocked: roll.cells_blocked,
            runs_done: roll.runs_done,
            runs_total: roll.runs_total,
            runs_in_flight: input.runs_in_flight,
            runs_missing: roll.runs_missing,
            runs_pending,
            runs_unreviewed: roll.runs_unreviewed,
            in_flight_limit: input.in_flight_limit,
            filling: input.filling,
            needs_attention: roll.needs_attention(input.filling, input.runs_in_flight),
        }
    }

    /// The roll-up for one plan's resolved members, without materializing the per-cell
    /// detail. Walks the same [`cells_in_order`] the matrix does, so the two can never
    /// disagree about the cell set.
    fn tally(
        &self,
        runs_per_cell: u32,
        combos: &[PlanMember],
        cases: &[ReviewPlanCase],
        blocked: &HashSet<CellKey>,
    ) -> MatrixRollup {
        let ordered = cells_in_order(CoverageAxis::Case, combos, cases);
        let mut roll = MatrixRollup {
            cells_filled: 0,
            cells_total: ordered.len() as u32,
            cells_blocked: 0,
            runs_done: 0,
            runs_total: 0,
            runs_missing: 0,
            runs_unreviewed: 0,
            runs_launchable: 0,
            cells_failing: 0,
        };
        for (case, member) in &ordered {
            let demand = self.demand(runs_per_cell, case, member);
            if demand.counted >= demand.target {
                roll.cells_filled += 1;
            }
            let failing = blocked.contains(&cell_key(case, member));
            if member.unlaunchable.is_some() || failing {
                roll.cells_blocked += 1;
            } else {
                roll.runs_launchable += demand.missing();
            }
            if failing {
                roll.cells_failing += 1;
            }
            roll.runs_done += demand.counted;
            roll.runs_total += demand.target;
            roll.runs_missing += demand.missing();
            roll.runs_unreviewed += self.unreviewed_for(runs_per_cell, case, member);
        }
        roll
    }

    /// One cell, fully described.
    fn cell(
        &self,
        desired: u32,
        case: &ReviewPlanCase,
        member: &PlanMember,
        blocked: bool,
    ) -> CoverageCell {
        let key = cell_key(case, member);
        let demand = self.demand(desired, case, member);
        let latest_version = self.latest_version(&case.slug);
        let run_ids = self
            .plan_runs(desired, case, member)
            .iter()
            .map(|run| run.id.clone())
            .collect();
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
            run_ids,
            counted: demand.counted,
            filled: demand.counted >= desired,
            blocked,
            in_flight: demand.in_flight,
            // A subset of the cell's in-flight jobs, so it shares their cap: the queue may
            // be holding back a job the cell no longer needs.
            pending: self
                .pending
                .get(&key)
                .copied()
                .unwrap_or(0)
                .min(demand.in_flight),
            unreviewed: self.unreviewed_for(desired, case, member),
            remaining: demand.missing(),
            stale: !latest_version.is_empty() && latest_version != case.version,
            latest_version,
        }
    }

    /// One cell as the shared launch scheduler sees it: what it wants, the runs it holds,
    /// and what is coming.
    ///
    /// The runs are the [cell's runs](Self::plan_runs), so `counted` never exceeds the
    /// target. The jobs in flight are counted globally and read only up to what the cell
    /// still needs, so a filled cell has none: a run that would land beyond the target is
    /// not the plan's, and showing it in flight would have the cell read more than its
    /// target. The launch arithmetic is unchanged by the cap, since a cell's shortfall is
    /// `target - counted - in_flight` either way.
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
        let counted = self.plan_runs(target, case, member).len() as u32;
        CellDemand {
            target,
            counted,
            in_flight: cell_in_flight(&self.in_flight, &key, target, counted),
            harness: harness_lane(member.combo.harness),
        }
    }

    /// The runs a plan with a target of `target` holds for one cell: the first `target`
    /// counted runs of the cell to land. A run beyond them is not the plan's, and every
    /// figure the plan reports is computed over these alone.
    pub(super) fn plan_runs(
        &self,
        target: u32,
        case: &ReviewPlanCase,
        member: &PlanMember,
    ) -> &[CellRun] {
        cell_runs(&self.runs, &cell_key(case, member), target)
    }

    /// How much room each harness has to start another run, in the lane order
    /// [`CellDemand::harness`] indexes. Handed straight to the launch scheduler.
    pub(super) fn harness_capacity(&self) -> &[HarnessCapacity] {
        &self.harness_capacity
    }

    /// The newest ingested version of one case slug, or the empty string when the case
    /// is not ingested at all.
    pub(super) fn latest_version(&self, slug: &str) -> String {
        self.latest_by_slug.get(slug).cloned().unwrap_or_default()
    }

    /// How many of the [cell's runs](Self::plan_runs) under `target` the requesting account
    /// has not reviewed.
    pub(super) fn unreviewed_for(
        &self,
        target: u32,
        case: &ReviewPlanCase,
        member: &PlanMember,
    ) -> u32 {
        self.plan_runs(target, case, member)
            .iter()
            .filter(|run| run.unreviewed)
            .count() as u32
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
    cell_key_of(case, member.cell_identity())
}

/// The [`CellKey`] a member's `identity` forms with `case` — [`cell_key`] for an identity
/// held apart from a resolved member, as a ladder dispatch pins each climber's.
pub(super) fn cell_key_of(case: &ReviewPlanCase, identity: MemberCellIdentity) -> CellKey {
    let (harness, model, config_id, models) = identity;
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

/// The runs a target of `target` holds for one cell: the first `target` counted runs of
/// the cell to land, out of the global lists [`crate::db::Db::counted_runs_by_cell`]
/// reads. The one rule a plan's cell and a ladder's rung slot both take their runs by.
pub(super) fn cell_runs<'a>(
    runs: &'a crate::db::CellRuns,
    cell: &CellKey,
    target: u32,
) -> &'a [CellRun] {
    let runs = runs.get(cell).map(Vec::as_slice).unwrap_or_default();
    &runs[..runs.len().min(target as usize)]
}

/// The jobs in flight a cell holding `counted` of its `target` runs reads: every job of
/// the cell in flight, whoever launched it, up to what the cell still needs. A run that
/// would land beyond the target is not the cell's, so a filled cell reads none.
pub(super) fn cell_in_flight(
    in_flight: &crate::db::CellCounts,
    cell: &CellKey,
    target: u32,
    counted: u32,
) -> u32 {
    in_flight
        .get(cell)
        .copied()
        .unwrap_or(0)
        .min(target.saturating_sub(counted))
}

/// The cell a job belongs to, read off its lifted columns through the same collapses the
/// grouped counts use.
pub(super) fn job_cell(job: &test_cabinet_entities::job::Model) -> CellKey {
    (
        job.test_case_slug.clone(),
        job.test_case_version.clone(),
        job.variant.clone(),
        job.engine_slug
            .clone()
            .unwrap_or_else(|| test_cabinet_core::engine::NONE_SLUG.to_string()),
        job.harness_slug.clone(),
        job.model_id.clone(),
        job.gg_config_id.clone().unwrap_or_default(),
        job.gg_models.clone().unwrap_or_default(),
    )
}

/// What one read of the live queue tells a coverage computation.
struct QueueSnapshot {
    /// The `pending` subset of the in-flight jobs, per coverage cell.
    pending: crate::db::CellCounts,
    /// In-flight jobs per harness slug — every state, across every plan, ladder, and
    /// hand-launched run, not only the cells being tallied. A harness's parallelism
    /// cap is global, so anything already queued for it consumes the cap ahead of
    /// whatever a launch pass adds.
    in_flight_by_harness: HashMap<String, u32>,
}

/// Read the live queue once, for both the per-cell `pending` counts and the
/// per-harness in-flight totals.
///
/// Derived from the same active-job read `GET /jobs/active` serves rather than from
/// grouped queries, because `pending` is a *display* distinction: the authority for
/// what counts toward a cell's target is [`crate::db::Db::count_in_flight_jobs_by_cell`],
/// which includes pending jobs and must keep doing so. Surfacing the subset separately
/// is what makes "the limit is full but nothing is running" explicable instead of
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
/// producing the capacity lane the launch-pass scheduler reads for every harness.
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

/// The lane a harness occupies in the capacity slice the launch-pass scheduler walks.
///
/// [`HarnessSlug::RUNNABLE`] rather than the CLI catalog, because what a lane bounds is how
/// many runs of a harness the queue will start at once and gg's runs occupy the queue like
/// any other — today they are most of it. It is exhaustive, so the position always resolves;
/// the fallback only keeps the lookup total, and lands past the end of the slice — which the
/// scheduler reads as an uncapped harness rather than as some other harness's lane.
pub(super) fn harness_lane(harness: HarnessSlug) -> usize {
    HarnessSlug::RUNNABLE
        .iter()
        .position(|slug| *slug == harness)
        .unwrap_or(HarnessSlug::RUNNABLE.len())
}

// ---- Shared launch enqueue + queue assembly --------------------------------

/// One cell a launch pass decided to launch, ready to be turned into jobs. Borrowed
/// rather than owned so the caller keeps its resolved members as the source of truth.
pub(super) struct LaunchCell<'a> {
    /// The ladder rung this cell belongs to, or `None` for a coverage plan.
    pub rung_id: Option<String>,
    /// The origin every job of the cell carries: the fill, the dispatch's rung, or a
    /// plan's hand launch.
    pub origin: JobOrigin,
    /// The case, at its pinned version.
    pub case: &'a ReviewPlanCase,
    /// The resolved member to run it on.
    pub member: &'a PlanMember,
    /// How many runs to enqueue — the cell's whole shortfall.
    pub runs: u32,
    /// How many automatic retries each of those runs gets: the plan's or the dispatch's
    /// retry limit.
    pub retry_count: u32,
}

/// What one call to [`enqueue_launches`] did: the cells it turned into jobs, and the cells
/// it could not.
///
/// The two come back together because a launch pass routinely does both, and a caller
/// assembling its report needs them in the same emission order it handed the cells over in.
pub(super) struct Enqueued {
    /// The cells that became jobs, in emission order.
    pub launched: Vec<LaunchedCell>,
    /// The cells that could not, each with its reason.
    pub blocked: Vec<BlockedCell>,
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
) -> BlockedCell {
    BlockedCell {
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

/// The launch request one launch cell's runs are enqueued with: the cell's whole case pin
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
/// The retry count is the plan's or the dispatch's
/// [retry limit](https://docs.testcabinet.ai/components/backend/coverage/#the-retry-limit).
/// A plan pins no orchestrator, runtime ceiling, or auth mode, so everything else is the
/// default a hand-launched run takes.
fn launch_body(cell: &LaunchCell<'_>) -> test_cabinet_core::LaunchBody {
    match &cell.member.gg {
        Some(gg) => super::gg::gg_launch_body(
            super::gg::GgLaunchSubject {
                test_case: cell.case.slug.clone(),
                version: cell.case.version.clone(),
                variant: cell.case.variant.clone(),
                engine: cell.case.launch_engine(),
                max_runtime_seconds: None,
                retry_count: Some(cell.retry_count),
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
            retry_count: Some(cell.retry_count),
            // A harness member configures no capability set, and none of the per-model
            // catalog facts a set's bindings would need resolving.
            gg_capability_set: None,
            gg_model_windows: Default::default(),
            gg_model_providers: Default::default(),
            gg_model_modalities: Default::default(),
            gg_model_prices: Default::default(),
            // Stamped by `enqueue_launches` once the body's model price resolves.
            model_prices: None,
        },
    }
}

/// Enqueue a launch pass's decided cells, attributing every job to the launching account
/// and to the cell's origin, and report what was enqueued.
///
/// The runs are emitted **in cell order, repeats adjacent**, and enqueued as one batch:
/// the batch takes a contiguous block of `queue_seq` positions in exactly this order and
/// the dispatcher claims in ascending order, so a cell's repeats start — and therefore
/// finish — together.
///
/// A **gg** cell is lowered through the very code `POST /gg/runs` lowers a launch form's
/// submission with ([`super::gg::gg_launch_body`]) and priced and resolved the same way, so
/// a run a plan schedules from a configuration and a run an operator launches from the same
/// configuration and the same models are the same run. A model whose context window the
/// catalog cannot resolve makes that one cell unlaunchable and is reported: gg assumes no
/// default window, and refusing the whole pass would let one bad binding stop a plan being
/// filled.
///
/// The origin is what a later scoped halt or stop cancels by, what a limit counts, and
/// what a dispatch counts its evidence by.
pub(super) async fn enqueue_launches(
    state: &AppState,
    user_id: &str,
    cells: &[LaunchCell<'_>],
) -> Result<Enqueued, ApiError> {
    let now = now()?;
    let mut jobs: Vec<crate::db::NewJob> = Vec::new();
    let mut launched: Vec<LaunchedCell> = Vec::with_capacity(cells.len());
    let mut blocked: Vec<BlockedCell> = Vec::new();
    // A list price filled for any cell changes the catalog the public snapshot shows.
    let on_fill = || {
        state.publisher.queue_refresh();
    };
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
        let attribution = super::jobs::JobAttribution::scheduled(user_id, &cell.origin);
        let mut body = launch_body(cell);
        match cell.member.gg.as_ref().map(|gg| gg.model_facts.clone()) {
            // The facts a caller about to launch resolved for this member up front (see
            // [`resolve_launch_facts`]) — the same figures a second resolution would
            // produce, minus a round-trip per cell.
            Some(Some(facts)) => facts.apply(&mut body),
            // A gg cell whose member was never put through that pass: resolve here rather
            // than enqueue a run with no windows on it, which gg would have no way to
            // measure. It blocks its own cell and never the whole pass.
            Some(None) => {
                crate::bootstrap::seed_launch_prices(
                    &state.db,
                    &state.prices,
                    &super::jobs::launch_models(&body),
                )
                .await;
                let record = super::jobs::candidate_record(state, [&body]).await;
                if let Err(reason) = super::jobs::resolve_gg_model_facts(
                    &state.db,
                    &state.prices,
                    &record,
                    &mut body,
                    &on_fill,
                )
                .await
                {
                    blocked.push(cell.blocked(reason));
                    continue;
                }
            }
            None => {
                // A non-gg cell: stamp the model's curated list price onto the
                // launch, blocking the cell when the model cannot be priced (a gg
                // cell's per-bound-model prices ride in the facts above).
                match super::jobs::resolve_model_price(&state.db, &state.prices, &body, &on_fill)
                    .await
                {
                    Ok(Some(prices)) => body.model_prices = Some(prices),
                    Ok(None) => {}
                    Err(reason) => {
                        blocked.push(cell.blocked(reason));
                        continue;
                    }
                }
            }
        }
        // The case's type is lifted onto the job so the queue can serialize the run
        // types that must not overlap (a game jam per model). A version that is not
        // ingested falls back to the default type rather than failing the pass:
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
        // blocks its own cell rather than the whole pass.
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
        launched.push(LaunchedCell {
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
        return Ok(Enqueued { launched, blocked });
    }
    // Price the harness cells' models before the runs exist. Missing-only and best-effort:
    // a model already on record costs nothing, and an unpriced model costs a cost
    // split, never the pass.
    crate::bootstrap::seed_launch_prices(&state.db, &state.prices, &models).await;
    state.db.enqueue_jobs(jobs).await.map_err(ApiError::from)?;
    Ok(Enqueued { launched, blocked })
}

impl LaunchCell<'_> {
    /// This cell, reported as one the pass could not launch.
    fn blocked(&self, reason: String) -> BlockedCell {
        blocked_cell(self.rung_id.clone(), self.case, self.member, reason)
    }
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
/// [one](MIN_RUNS_PER_CELL), not zero: a cell nobody wants any runs of is a cell that
/// should not be in the plan (or a rung that should not be on the ladder). Shared with
/// the ladder transport, whose rungs set the same kind of target.
///
/// This is for a target the backend itself is normalizing — one already stored, or one
/// it derived. A target an operator **submitted** goes through
/// [`validated_runs_per_cell`] instead: storing a number other than the one that was
/// sent, and answering `200` as though it had been stored, tells the operator nothing
/// and leaves the plan running a target they never chose.
pub(super) fn clamp_runs_per_cell(target: u32) -> u32 {
    target.clamp(MIN_RUNS_PER_CELL, MAX_RUNS_PER_CELL)
}

/// A submitted runs-per-cell target, or a bad request naming the bound it broke and
/// the value that broke it. `what` names the object the target belongs to, so the
/// message reads on whichever surface sent it.
pub(super) fn validated_runs_per_cell(target: u32, what: &str) -> Result<u32, ApiError> {
    if target < MIN_RUNS_PER_CELL {
        return Err(ApiError::bad_request(format!(
            "{what} runs at least {MIN_RUNS_PER_CELL} run per cell (got {target})"
        )));
    }
    if target > MAX_RUNS_PER_CELL {
        return Err(ApiError::bad_request(format!(
            "{what} runs at most {MAX_RUNS_PER_CELL} runs per cell (got {target})"
        )));
    }
    Ok(target)
}

/// Clamp a runs-in-flight limit to the range the backend will honour. A bound of `0`
/// survives — "launch nothing" is a real instruction, unlike a runs-per-cell target of
/// zero — and so does `unbounded`, which has no number to clamp: the ceiling guards
/// against a fat-fingered bound, not against an owner who chose to have none.
pub(super) fn clamp_in_flight_limit(limit: InFlightLimit) -> InFlightLimit {
    match limit {
        InFlightLimit::Bounded { runs } => InFlightLimit::Bounded {
            runs: runs.min(MAX_IN_FLIGHT_LIMIT),
        },
        InFlightLimit::Unbounded => InFlightLimit::Unbounded,
    }
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

/// Build a stored plan from a create/update body, validating the runs-per-cell target
/// and clamping the limit override.
fn plan_from_input(
    id: String,
    input: CoveragePlanInput,
    updated_at: &str,
) -> Result<CoveragePlan, ApiError> {
    let runs_per_cell = validated_runs_per_cell(input.runs_per_cell, "a plan")?;
    Ok(CoveragePlan {
        id,
        name: input.name,
        runs_per_cell,
        combo_group_ids: input.combo_group_ids,
        case_group_ids: input.case_group_ids,
        combos: for_storage(input.combos),
        cases: input.cases,
        outer_axis: input.outer_axis,
        in_flight_limit: input.in_flight_limit.map(clamp_in_flight_limit),
        retry_count: clamp_retry_count(input.retry_count.unwrap_or_else(default_retry_count)),
        updated_at: updated_at.to_string(),
    })
}

impl LaunchPassResult {
    /// A launch pass that never ran, and why. The limit is still reported: the owner's
    /// next question after "it did nothing" is "what was it aiming for?".
    pub(super) fn skipped_by(reason: LaunchSkipped, in_flight_limit: InFlightLimit) -> Self {
        Self {
            skipped: Some(reason),
            in_flight_limit,
            in_flight: None,
            enqueued: 0,
            cells: Vec::new(),
            unlaunchable: Vec::new(),
            early_stop_canceled: 0,
        }
    }

    /// Two passes' results as one: what both enqueued and could not launch, the later
    /// pass's view of the limit, and every early-stop cancel.
    pub(super) fn merged_with(self, later: LaunchPassResult) -> LaunchPassResult {
        let mut cells = self.cells;
        cells.extend(later.cells);
        let mut unlaunchable = self.unlaunchable;
        unlaunchable.extend(later.unlaunchable);
        LaunchPassResult {
            skipped: later.skipped,
            in_flight_limit: later.in_flight_limit,
            in_flight: later.in_flight.or(self.in_flight),
            enqueued: self.enqueued + later.enqueued,
            cells,
            unlaunchable,
            early_stop_canceled: self.early_stop_canceled + later.early_stop_canceled,
        }
    }
}

#[cfg(test)]
#[path = "coverage.test.rs"]
mod tests;

#[cfg(test)]
#[path = "coverage.gg.test.rs"]
mod gg_tests;

#[cfg(test)]
#[path = "coverage.flow.test.rs"]
mod flow_tests;
