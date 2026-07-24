//! The gg **result-aggregation** query contract: a Kibana-style structured query
//! over many persisted gg runs, sliced by the [capability set](GgCapabilitySet)
//! recorded on each run.
//!
//! gg's experiments are only analyzable *in aggregate* over fields we durably
//! record — the [capability set](GgCapabilitySet) that configured a run (the
//! independent variable, the dimension every query slices by) and the
//! [session summary](GgSessionSummary) that captured its outcome (the dependent
//! variables). This module is the query language over that pair: a
//! [`GgAggregateQuery`] filters gg runs, groups them by one or more
//! [facets](GgFacet) derived from the capability set (or the summary), and
//! aggregates [metrics](GgMetric) per bucket; a [`GgAggregateResponse`] carries the
//! resulting buckets.
//!
//! The actual run-loading lives in the backend (which reads the persisted runs and
//! resolves each run's reviewer [score](GgMetric::Score) from the case catalog); the
//! aggregation itself is [`aggregate`], a pure fold over lightweight
//! [rows](GgAggregateRow) so it is testable without a database. Because the whole
//! query and response are part of the published contract (they derive `ts_rs::TS` +
//! `schemars::JsonSchema` behind the `contract` feature), the console builds its
//! aggregation surface against the very same shapes. See the design doc under `gg/`.
//!
//! Regenerate the TypeScript/JSON-Schema bindings with `npm run gen:contract` after
//! any change here. JSON is camelCase.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::gg::{GgCapabilitySet, GgSessionSummary};
use crate::run_record::RunState;

/// A numeric field of a run's [`GgSessionSummary`] — the outcome variables an
/// aggregate query can group runs by (bucketing on the exact value) or aggregate
/// (avg/min/max/sum) across a bucket.
///
/// Every variant reduces to a single `f64` for a run (see
/// [`GgSummaryField::value`]); the boolean [`RanOutOfContext`](Self::RanOutOfContext)
/// projects to `1.0`/`0.0` so its **average across a bucket is a rate** — exactly
/// the "with compaction off, how often did the model run out of context?" query.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgSummaryField {
    /// [`agents_spawned`](GgSessionSummary::agents_spawned).
    AgentsSpawned,
    /// [`subagent_count`](GgSessionSummary::subagent_count).
    SubagentCount,
    /// [`max_subagent_depth`](GgSessionSummary::max_subagent_depth).
    MaxSubagentDepth,
    /// [`compactions`](GgSessionSummary::compactions).
    Compactions,
    /// [`context_overflow_count`](GgSessionSummary::context_overflow_count).
    ContextOverflowCount,
    /// [`ran_out_of_context`](GgSessionSummary::ran_out_of_context) projected to
    /// `1.0`/`0.0`, so averaging a bucket yields the context-overflow **rate**.
    RanOutOfContext,
    /// [`final_fullness`](GgSessionSummary::final_fullness) — the only field that can
    /// be genuinely absent (context visibility off), yielding `None`.
    FinalFullness,
    /// [`code_reviews`](GgSessionSummary::code_reviews).
    CodeReviews,
    /// [`review_cycles`](GgSessionSummary::review_cycles).
    ReviewCycles,
    /// [`issues_reopened`](GgSessionSummary::issues_reopened).
    IssuesReopened,
    /// [`speculations`](GgSessionSummary::speculations).
    Speculations,
    /// [`issues_created`](GgSessionSummary::issues_created).
    IssuesCreated,
    /// [`issues_completed`](GgSessionSummary::issues_completed).
    IssuesCompleted,
}

impl GgSummaryField {
    /// Project this field of `summary` to an `f64`, or `None` when the field is
    /// genuinely absent (only [`FinalFullness`](Self::FinalFullness) ever is).
    pub fn value(self, summary: &GgSessionSummary) -> Option<f64> {
        match self {
            GgSummaryField::AgentsSpawned => Some(summary.agents_spawned as f64),
            GgSummaryField::SubagentCount => Some(summary.subagent_count as f64),
            GgSummaryField::MaxSubagentDepth => Some(summary.max_subagent_depth as f64),
            GgSummaryField::Compactions => Some(summary.compactions as f64),
            GgSummaryField::ContextOverflowCount => Some(summary.context_overflow_count as f64),
            GgSummaryField::RanOutOfContext => {
                Some(if summary.ran_out_of_context { 1.0 } else { 0.0 })
            }
            GgSummaryField::FinalFullness => summary.final_fullness,
            GgSummaryField::CodeReviews => Some(summary.code_reviews as f64),
            GgSummaryField::ReviewCycles => Some(summary.review_cycles as f64),
            GgSummaryField::IssuesReopened => Some(summary.issues_reopened as f64),
            GgSummaryField::Speculations => Some(summary.speculations as f64),
            GgSummaryField::IssuesCreated => Some(summary.issues_created as f64),
            GgSummaryField::IssuesCompleted => Some(summary.issues_completed as f64),
        }
    }
}

/// A **sliceable facet** of a gg run — a single dimension a query filters or groups
/// by. Most facets are derived from the [capability set](GgCapabilitySet) (the
/// independent variable): whether a capability is on, which implementation it uses,
/// a capability parameter, a slot's bound model, or the preset the set was assembled
/// from. The rest are coarse run properties (its test case, its terminal status).
///
/// A facet resolves to a **canonical string value** for a run (see
/// [`GgFacet::resolve`]), or `None` when the facet does not apply — so
/// [`SlotModel`](Self::SlotModel) on a slot the run never bound, or
/// [`CapabilityImplementation`](Self::CapabilityImplementation) of a capability the
/// run does not carry, buckets under the "absent" key rather than a value. The one
/// exception is [`CapabilityEnabled`](Self::CapabilityEnabled): a capability that is
/// absent from the set is off, so it resolves to `"false"` (never `None`), which is
/// what makes "compaction off" catch both the disabled and the never-configured
/// arms.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgFacet {
    /// The run's test-case slug (always present).
    TestCase {},
    /// The [preset](GgCapabilitySet::preset) the capability set was assembled from,
    /// or absent for a hand-assembled set.
    Preset {},
    /// Whether the named capability is [enabled](GgCapabilitySet::is_enabled).
    /// Resolves to `"true"`/`"false"` — never absent — so a run that never configured
    /// the capability reads as `"false"`.
    CapabilityEnabled {
        /// The capability's stable id (for example `"compaction"`).
        capability: String,
    },
    /// The selected [implementation](crate::gg::GgCapabilityConfig::implementation) of
    /// the named capability (`"default"` when the capability is present with no
    /// implementation selected), or absent when the run does not carry the capability.
    CapabilityImplementation {
        /// The capability's stable id (for example `"planning"`).
        capability: String,
    },
    /// A [parameter](crate::gg::GgCapabilityConfig::params) of the named capability,
    /// addressed by a dotted path into its params object (for example
    /// `"triggerFullness"` or `"scheduler.maxDepth"`). Resolves to the scalar rendered
    /// as a string, or absent when the capability, the param, or a scalar value is
    /// missing.
    CapabilityParam {
        /// The capability's stable id.
        capability: String,
        /// A dotted path into the capability's params object.
        param: String,
    },
    /// The model id bound to the named [slot](crate::gg::GgSlotBinding), or absent when
    /// the run bound no such slot.
    SlotModel {
        /// The slot name (for example `"primary"` or `"reviewer"`).
        slot: String,
    },
    /// The run's [terminal status](GgSessionSummary::terminal_status), or absent for a
    /// run that recorded no session summary (a launch that never ran).
    TerminalStatus {},
}

impl GgFacet {
    /// Resolve this facet's canonical string value for a run, given the run's test
    /// case, its [capability set](GgCapabilitySet) (absent for a non-gg run — though
    /// only gg runs are ever aggregated), and its [summary](GgSessionSummary) (absent
    /// for a gg run that never ran a session). `None` means the facet does not apply
    /// to this run and the run buckets under the "absent" key.
    pub fn resolve(
        &self,
        test_case: &str,
        capability_set: Option<&GgCapabilitySet>,
        summary: Option<&GgSessionSummary>,
    ) -> Option<String> {
        match self {
            GgFacet::TestCase {} => Some(test_case.to_string()),
            GgFacet::Preset {} => capability_set.and_then(|set| set.preset.clone()),
            GgFacet::CapabilityEnabled { capability } => {
                // A capability absent from the set is off, so this never resolves to
                // absent — "compaction off" must catch the never-configured arm too.
                let on = capability_set.is_some_and(|set| set.is_enabled(capability));
                Some(bool_str(on).to_string())
            }
            GgFacet::CapabilityImplementation { capability } => capability_set
                .and_then(|set| set.capability(capability))
                .map(|cfg| cfg.implementation.clone().unwrap_or_else(default_impl)),
            GgFacet::CapabilityParam { capability, param } => capability_set
                .and_then(|set| set.capability(capability))
                .and_then(|cfg| param_scalar(&cfg.params, param)),
            GgFacet::SlotModel { slot } => capability_set
                .and_then(|set| set.model_for_slot(slot))
                .map(str::to_string),
            GgFacet::TerminalStatus {} => summary.map(|s| s.terminal_status.clone()),
        }
    }
}

/// The name a capability with no selected implementation buckets under.
fn default_impl() -> String {
    "default".to_string()
}

/// Render a boolean facet value.
fn bool_str(b: bool) -> &'static str {
    if b { "true" } else { "false" }
}

/// One extracted facet of a [`GgCapabilitySet`]: the [facet selector](GgFacet) and
/// the value it resolved to. This is what [`GgCapabilitySet::facets`] enumerates so a
/// console can discover which facets a set exposes (each capability's enabled flag,
/// implementation, and params; each slot's model; the preset) and offer them as
/// slice-by dimensions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgFacetBinding {
    /// The facet this binding is for.
    pub facet: GgFacet,
    /// The value the facet resolved to on the capability set, or `None` when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub value: Option<String>,
}

impl GgCapabilitySet {
    /// Enumerate the sliceable [facets](GgFacet) this capability set exposes, paired
    /// with the value each resolves to — the discoverable slice-by dimensions of a
    /// configuration: the [preset](Self::preset); for every configured capability its
    /// [enabled](Self::is_enabled) flag, its
    /// [implementation](crate::gg::GgCapabilityConfig::implementation), and each of its
    /// top-level [params](crate::gg::GgCapabilityConfig::params); and for every
    /// [slot](Self::slots) its bound model.
    ///
    /// This is the extraction the aggregation's group-by facets draw from: switching a
    /// capability on/off is offering/withholding its tools, so a capability's facets
    /// *are* the toolset dimensions a study varies. A console reads this off a run's
    /// recorded set to populate its facet picker.
    pub fn facets(&self) -> Vec<GgFacetBinding> {
        let mut out = Vec::new();
        let binding = |facet: GgFacet, value: Option<String>| GgFacetBinding { facet, value };

        out.push(binding(
            GgFacet::Preset {},
            GgFacet::Preset {}.resolve("", Some(self), None),
        ));
        for cfg in &self.capabilities {
            out.push(binding(
                GgFacet::CapabilityEnabled {
                    capability: cfg.id.clone(),
                },
                Some(bool_str(cfg.enabled).to_string()),
            ));
            out.push(binding(
                GgFacet::CapabilityImplementation {
                    capability: cfg.id.clone(),
                },
                Some(cfg.implementation.clone().unwrap_or_else(default_impl)),
            ));
            if let Value::Object(params) = &cfg.params {
                for key in params.keys() {
                    out.push(binding(
                        GgFacet::CapabilityParam {
                            capability: cfg.id.clone(),
                            param: key.clone(),
                        },
                        param_scalar(&cfg.params, key),
                    ));
                }
            }
        }
        for slot in &self.slots {
            out.push(binding(
                GgFacet::SlotModel {
                    slot: slot.slot.clone(),
                },
                Some(slot.model_id.clone()),
            ));
        }
        out
    }
}

/// Render the scalar at a dotted `path` into a params object as a string, or `None`
/// when the path is missing or does not address a scalar (an object/array/null is not
/// a sliceable facet value).
fn param_scalar(params: &Value, path: &str) -> Option<String> {
    let pointer = format!("/{}", path.replace('.', "/"));
    match params.pointer(&pointer)? {
        Value::String(s) => Some(s.clone()),
        Value::Bool(b) => Some(bool_str(*b).to_string()),
        Value::Number(n) => Some(n.to_string()),
        Value::Null | Value::Array(_) | Value::Object(_) => None,
    }
}

/// A numeric **metric** an aggregate query aggregates per bucket — a run's resource
/// figures, its reviewer score, or any [summary field](GgSummaryField). Each resolves
/// to a single `f64` per run (or `None` when unavailable) via [`GgAggregateRow`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgMetric {
    /// The run's wall-clock runtime in seconds (`metrics.runTimeSeconds`).
    RunTimeSeconds {},
    /// The run's total tokens across every class (`metrics.tokens` summed), or absent
    /// when no token usage was recorded.
    TotalTokens {},
    /// The run's comparable cost in USD (`metrics.cost.comparable`), or absent when the
    /// cost is unknown.
    Cost {},
    /// The run's aggregate reviewer score as a `0.0..=1.0` fraction (mean earned
    /// checklist weight over the total available), or absent when the run has no
    /// reviews or its case's checklist weights could not be resolved. Resolved by the
    /// caller (the backend) from the case catalog, not from the run alone.
    Score {},
    /// A [summary field](GgSummaryField).
    Summary {
        /// Which summary field to aggregate.
        field: GgSummaryField,
    },
}

/// How to aggregate a [metric](GgMetric) across the runs in a bucket.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgAggregation {
    /// The arithmetic mean of the contributing runs' values.
    Avg,
    /// The smallest contributing value.
    Min,
    /// The largest contributing value.
    Max,
    /// The sum of the contributing values.
    Sum,
}

impl GgAggregation {
    /// Fold the contributing values (already filtered to the runs that had one) into
    /// the aggregate, or `None` when no run in the bucket contributed a value.
    fn fold(self, values: &[f64]) -> Option<f64> {
        if values.is_empty() {
            return None;
        }
        Some(match self {
            GgAggregation::Avg => values.iter().sum::<f64>() / values.len() as f64,
            GgAggregation::Min => values.iter().copied().fold(f64::INFINITY, f64::min),
            GgAggregation::Max => values.iter().copied().fold(f64::NEG_INFINITY, f64::max),
            GgAggregation::Sum => values.iter().sum(),
        })
    }
}

/// One requested `(metric, aggregation)` pair — for example "average subagent depth"
/// or "sum of reopened issues".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgMetricSpec {
    /// The metric to aggregate.
    pub metric: GgMetric,
    /// How to aggregate it across each bucket.
    pub agg: GgAggregation,
}

/// A comparison operator for a [facet filter](GgFacetFilter).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgFacetOp {
    /// The facet resolves to exactly [`value`](GgFacetFilter::value).
    Eq,
    /// The facet resolves to something other than [`value`](GgFacetFilter::value) (an
    /// absent facet is *not* equal, so it passes `Ne`).
    Ne,
    /// The facet resolves to any value (is present).
    Exists,
    /// The facet does not resolve (is absent).
    Absent,
}

/// A filter over a [facet](GgFacet) — the capability-set (and coarse run) predicates a
/// query narrows to before grouping. "compaction off" is
/// `CapabilityEnabled{compaction} Eq "false"`; "ran out of context" is best expressed
/// as a [metric filter](GgMetricFilter) on the summary field, but a terminal-status
/// slice is a facet filter here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgFacetFilter {
    /// The facet to test.
    pub facet: GgFacet,
    /// The comparison to apply.
    pub op: GgFacetOp,
    /// The value to compare against, for [`Eq`](GgFacetOp::Eq)/[`Ne`](GgFacetOp::Ne).
    /// Ignored (and may be omitted) for [`Exists`](GgFacetOp::Exists)/[`Absent`](GgFacetOp::Absent).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub value: Option<String>,
}

impl GgFacetFilter {
    /// Whether a run whose facet resolved to `resolved` passes this filter.
    fn passes(&self, resolved: Option<&str>) -> bool {
        match self.op {
            GgFacetOp::Eq => resolved == self.value.as_deref(),
            GgFacetOp::Ne => resolved != self.value.as_deref(),
            GgFacetOp::Exists => resolved.is_some(),
            GgFacetOp::Absent => resolved.is_none(),
        }
    }
}

/// A numeric comparison operator for a [metric filter](GgMetricFilter).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgCompareOp {
    /// Strictly less than [`value`](GgMetricFilter::value).
    Lt,
    /// Less than or equal to [`value`](GgMetricFilter::value).
    Lte,
    /// Strictly greater than [`value`](GgMetricFilter::value).
    Gt,
    /// Greater than or equal to [`value`](GgMetricFilter::value).
    Gte,
    /// Equal to [`value`](GgMetricFilter::value).
    Eq,
}

/// A numeric filter over a [metric](GgMetric) — the summary-stat and resource
/// predicates a query narrows by. "ran out of context = true" is
/// `Summary(RanOutOfContext) Gte 1.0`; "at a fixed budget" is `Cost Lte <budget>`;
/// "subagent depth ≥ 2" is `Summary(MaxSubagentDepth) Gte 2.0`. A run whose metric is
/// unavailable (absent) fails every metric filter.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgMetricFilter {
    /// The metric to test.
    pub metric: GgMetric,
    /// The comparison to apply.
    pub op: GgCompareOp,
    /// The threshold to compare the run's metric value against.
    pub value: f64,
}

impl GgMetricFilter {
    /// Whether a run whose metric resolved to `resolved` passes this filter. An absent
    /// metric fails (there is nothing to compare).
    fn passes(&self, resolved: Option<f64>) -> bool {
        let Some(v) = resolved else {
            return false;
        };
        match self.op {
            GgCompareOp::Lt => v < self.value,
            GgCompareOp::Lte => v <= self.value,
            GgCompareOp::Gt => v > self.value,
            GgCompareOp::Gte => v >= self.value,
            GgCompareOp::Eq => v == self.value,
        }
    }
}

/// A **capability-set-sliced aggregate query** over gg runs — the Kibana-style
/// request: narrow the gg runs by [facet](GgFacetFilter) and
/// [metric](GgMetricFilter) predicates, group them by one or more
/// [facets](GgFacet), and aggregate a set of [metrics](GgMetricSpec) per bucket.
///
/// The four canonical study questions are all expressible: "runs with compaction off,
/// context-overflow rate" (`facet_filters: CapabilityEnabled{compaction}=false`,
/// `metrics: avg Summary(RanOutOfContext)`); "group by planning implementation,
/// reopened-issue count" (`group_by: CapabilityImplementation{planning}`, `metrics:
/// sum Summary(IssuesReopened)`); "subagent depth vs score" (`group_by:
/// Summary?` — bucket via a metric filter sweep, or `metrics: avg Score` grouped by a
/// depth facet); "speculative on vs off, score at a fixed budget" (`group_by:
/// CapabilityEnabled{speculative-execution}`, `metric_filters: Cost<=budget`,
/// `metrics: avg Score`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgAggregateQuery {
    /// Restrict to a single test-case slug before anything else — the common "hold the
    /// case fixed, vary the configuration" framing. `None` aggregates across every
    /// case. (Equivalent to a [`TestCase`](GgFacet::TestCase) facet filter, surfaced as
    /// a first-class field because it is the most common narrowing.)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub test_case: Option<String>,
    /// Facet predicates every returned run must satisfy (ANDed together).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub facet_filters: Vec<GgFacetFilter>,
    /// Numeric metric predicates every returned run must satisfy (ANDed together).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub metric_filters: Vec<GgMetricFilter>,
    /// The facets to group by, in order — one key component per facet. Empty groups
    /// every matching run into a single bucket (the grand total).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub group_by: Vec<GgFacet>,
    /// The metrics to aggregate per bucket. Every bucket also carries its run count and
    /// terminal-state distribution regardless of this list.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub metrics: Vec<GgMetricSpec>,
}

/// One run reduced to just what [`aggregate`] needs — the aggregation's input row.
///
/// The backend builds one of these per persisted gg run (lifting the capability set,
/// summary, resource metrics, and terminal state off the record, and resolving the
/// reviewer [`score`](Self::score) from the case catalog). Keeping the fold's input a
/// lightweight owned struct — rather than the backend's stored-run type — is what lets
/// the aggregation be unit-tested here without a database.
#[derive(Debug, Clone)]
pub struct GgAggregateRow {
    /// The run's test-case slug.
    pub test_case: String,
    /// The run's recorded capability set, absent only for a malformed/non-gg row.
    pub capability_set: Option<GgCapabilitySet>,
    /// The run's session summary, absent for a gg run that never ran a session.
    pub summary: Option<GgSessionSummary>,
    /// The run's wall-clock runtime in seconds.
    pub run_time_seconds: f64,
    /// The run's total tokens across every class, absent when none were recorded.
    pub total_tokens: Option<u64>,
    /// The run's comparable cost in USD, absent when unknown.
    pub cost_comparable: Option<f64>,
    /// The run's terminal state.
    pub run_state: RunState,
    /// The run's aggregate reviewer score as a `0.0..=1.0` fraction, absent when it has
    /// no reviews or its case's checklist weights could not be resolved. Resolved by
    /// the backend from the case catalog.
    pub score: Option<f64>,
}

impl GgAggregateRow {
    /// Resolve a facet's canonical value for this row.
    fn facet_value(&self, facet: &GgFacet) -> Option<String> {
        facet.resolve(
            &self.test_case,
            self.capability_set.as_ref(),
            self.summary.as_ref(),
        )
    }

    /// Resolve a metric's numeric value for this row, or `None` when unavailable.
    fn metric_value(&self, metric: &GgMetric) -> Option<f64> {
        match metric {
            GgMetric::RunTimeSeconds {} => Some(self.run_time_seconds),
            GgMetric::TotalTokens {} => self.total_tokens.map(|t| t as f64),
            GgMetric::Cost {} => self.cost_comparable,
            GgMetric::Score {} => self.score,
            GgMetric::Summary { field } => self.summary.as_ref().and_then(|s| field.value(s)),
        }
    }

    /// Whether this row passes every filter in `query`.
    fn passes(&self, query: &GgAggregateQuery) -> bool {
        if let Some(case) = &query.test_case
            && &self.test_case != case
        {
            return false;
        }
        query
            .facet_filters
            .iter()
            .all(|f| f.passes(self.facet_value(&f.facet).as_deref()))
            && query
                .metric_filters
                .iter()
                .all(|f| f.passes(self.metric_value(&f.metric)))
    }
}

/// One component of a bucket's composite key: the [facet](GgFacet) it groups on and
/// the value the bucket's runs share (`None` = the runs share the *absence* of the
/// facet).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgBucketKeyPart {
    /// The facet this key component groups on.
    pub facet: GgFacet,
    /// The shared value, or `None` when the bucket's runs all lack the facet.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub value: Option<String>,
}

/// The aggregated value of one [requested metric](GgMetricSpec) in one bucket.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgMetricValue {
    /// The metric this value is for.
    pub metric: GgMetric,
    /// The aggregation applied.
    pub agg: GgAggregation,
    /// The aggregated figure, or `None` when no run in the bucket carried the metric
    /// (so a whole column can be absent even though the bucket has runs).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub value: Option<f64>,
    /// How many of the bucket's runs contributed a value to this figure (`<= n`).
    pub contributing: u64,
}

/// One `(state, count)` entry of a bucket's terminal-state distribution.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgStateCount {
    /// The terminal state.
    pub state: RunState,
    /// How many of the bucket's runs ended in it.
    pub count: u64,
}

/// One bucket of an aggregate result — the runs that share a group-by key, with the
/// metrics aggregated over them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgAggregateBucket {
    /// The bucket's composite key — one component per query
    /// [`group_by`](GgAggregateQuery::group_by) facet, in the same order. Empty for the
    /// single grand-total bucket of an ungrouped query.
    #[serde(default)]
    pub key: Vec<GgBucketKeyPart>,
    /// How many runs fell into this bucket.
    pub n: u64,
    /// The aggregated metrics, one per requested [`GgMetricSpec`], in request order.
    #[serde(default)]
    pub metrics: Vec<GgMetricValue>,
    /// The bucket's terminal-state distribution, in [`RunState::ALL`] order, omitting
    /// states with no runs.
    #[serde(default)]
    pub state_distribution: Vec<GgStateCount>,
}

/// The response to a [`GgAggregateQuery`]: the buckets, plus the total runs the
/// filters matched.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgAggregateResponse {
    /// How many gg runs matched the query's filters (the sum of every bucket's `n`).
    pub total_runs: u64,
    /// The buckets, largest first (ties broken by key for determinism).
    #[serde(default)]
    pub buckets: Vec<GgAggregateBucket>,
}

/// Run a [`GgAggregateQuery`] over the given rows: filter, group by the query's
/// facets, and aggregate its metrics per bucket. A pure fold — the caller supplies the
/// rows (loaded from the run store, with score resolved), so this is fully
/// deterministic and testable in isolation.
pub fn aggregate(rows: &[GgAggregateRow], query: &GgAggregateQuery) -> GgAggregateResponse {
    // Group the matching rows by their composite group-by key. A `BTreeMap` keyed on
    // the Vec<Option<String>> keeps grouping deterministic; the final ordering is
    // imposed below.
    let mut groups: BTreeMap<Vec<Option<String>>, Vec<&GgAggregateRow>> = BTreeMap::new();
    let mut total_runs: u64 = 0;
    for row in rows {
        if !row.passes(query) {
            continue;
        }
        total_runs += 1;
        let key: Vec<Option<String>> = query
            .group_by
            .iter()
            .map(|facet| row.facet_value(facet))
            .collect();
        groups.entry(key).or_default().push(row);
    }

    let mut buckets: Vec<GgAggregateBucket> = groups
        .into_iter()
        .map(|(key_values, rows)| build_bucket(query, &key_values, &rows))
        .collect();

    // Largest bucket first; ties broken by the composite key so the ordering is
    // stable across runs and platforms.
    buckets.sort_by(|a, b| b.n.cmp(&a.n).then_with(|| a.key_cmp(b)));

    GgAggregateResponse {
        total_runs,
        buckets,
    }
}

/// Assemble one bucket from its key values and the rows that fell into it.
fn build_bucket(
    query: &GgAggregateQuery,
    key_values: &[Option<String>],
    rows: &[&GgAggregateRow],
) -> GgAggregateBucket {
    let key = query
        .group_by
        .iter()
        .zip(key_values)
        .map(|(facet, value)| GgBucketKeyPart {
            facet: facet.clone(),
            value: value.clone(),
        })
        .collect();

    let metrics = query
        .metrics
        .iter()
        .map(|spec| {
            let values: Vec<f64> = rows
                .iter()
                .filter_map(|row| row.metric_value(&spec.metric))
                .collect();
            GgMetricValue {
                metric: spec.metric,
                agg: spec.agg,
                value: spec.agg.fold(&values),
                contributing: values.len() as u64,
            }
        })
        .collect();

    // Terminal-state distribution in the canonical state order, dropping empties.
    let state_distribution = RunState::ALL
        .into_iter()
        .filter_map(|state| {
            let count = rows.iter().filter(|row| row.run_state == state).count() as u64;
            (count > 0).then_some(GgStateCount { state, count })
        })
        .collect();

    GgAggregateBucket {
        key,
        n: rows.len() as u64,
        metrics,
        state_distribution,
    }
}

impl GgAggregateBucket {
    /// Compare two buckets by their composite key's values, for a stable tiebreak when
    /// their run counts are equal.
    fn key_cmp(&self, other: &GgAggregateBucket) -> std::cmp::Ordering {
        let a = self.key.iter().map(|p| &p.value);
        let b = other.key.iter().map(|p| &p.value);
        a.cmp(b)
    }
}

#[cfg(test)]
#[path = "gg_aggregate.test.rs"]
mod tests;
