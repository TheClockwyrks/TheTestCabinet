//! The pure folds behind the `/stats` endpoints: per-provider health and
//! per-model accuracy, aggregated across every stored gg run — plus the probe
//! store's per-provider evidence, folded from a column projection — and the
//! cabinet's whole-of-corpus headline figures (`/stats/cabinet`), folded from a
//! five-column projection over every stored run.
//!
//! The division of labour follows the coverage surface: the handlers in
//! [`crate::api`] own the HTTP surface and resolve the corpus, and everything
//! here is a pure function over [`GgRunFacts`] — the compact per-run extract
//! the [gg document index](crate::gg_docs::GgDocIndex) builds beside each
//! document — so the folds are unit-testable without a store.
//!
//! Two rules govern the folds, and both are about honesty over older records:
//!
//! * **A figure an older record omitted is never defaulted.** Provider slices
//!   and the tool-call dispatch total only exist on runs recorded since the
//!   summary carried them; a run without them is counted as scanned, reported
//!   under the explicit `approximate`/`without-totals`/`unattributable`
//!   tallies where it can still contribute, and otherwise left out.
//! * **Run evidence and probe evidence never mix.** A probe item is a single
//!   replayed completion, not a run; the response carries the two side by
//!   side, each labelled, and sums neither into the other.

#[cfg(test)]
#[path = "stats.test.rs"]
mod tests;

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use serde::Serialize;

use test_cabinet_core::gg::{GgProviderStat, GgTurnErrorKind, GgTurnErrorType};
use test_cabinet_core::run_record::RunRecord;

/// The compact, aggregatable extract of one stored gg run — everything the
/// `/stats` folds read, and nothing else, so the index can hold one of these
/// per run at a fraction of the record's size.
///
/// Built by the [gg document index](crate::gg_docs::GgDocIndex) in the same
/// parse pass as the run's query document, under the same per-id freshness
/// rule.
#[derive(Debug, Clone, PartialEq)]
pub struct GgRunFacts {
    /// The run id, for distinct-run tallies.
    pub id: String,
    /// The run's primary-slot model id (`subject.modelId`).
    pub model_id: String,
    /// The summary's execution mode: `"responses_as_code"` or `"tool_calling"`.
    pub execution_mode: String,
    /// The summary's error rollup, kept whole: the run-level fallback for a
    /// record that predates per-provider slices.
    pub errors: test_cabinet_core::gg::GgErrorSummary,
    /// The summary's dispatched-tool-call total, or `0` for a record that
    /// predates it — which the accuracy fold treats as *unrecorded*, never as
    /// "no calls".
    pub tool_calls: u64,
    /// The per-`(provider, model)` slices, empty for a record that predates
    /// them.
    pub provider_stats: Vec<GgProviderStat>,
    /// Every model id the run's slot costs named, plus the primary-slot model
    /// — the set a run must resolve to exactly one of to be attributable
    /// without per-model slices.
    pub models: BTreeSet<String>,
}

impl GgRunFacts {
    /// The extract, or `None` for a run whose record carries no gg summary —
    /// a launch that failed before a single turn has no outcome to aggregate.
    pub fn from_record(record: &RunRecord) -> Option<Self> {
        let summary = record.subject.gg_summary.as_ref()?;
        let mut models: BTreeSet<String> = summary
            .slot_costs
            .iter()
            .map(|slot| slot.model_id.clone())
            .collect();
        models.insert(record.subject.model_id.clone());
        Some(Self {
            id: record.id.clone(),
            model_id: record.subject.model_id.clone(),
            execution_mode: summary.execution_mode.clone(),
            errors: summary.errors.clone(),
            tool_calls: summary.tool_calls,
            provider_stats: summary.provider_stats.clone(),
            models,
        })
    }

    /// The run's sole model id, when every slot resolved to one — the
    /// condition under which run-level figures are attributable to a model at
    /// all.
    fn sole_model(&self) -> Option<&str> {
        match self.models.len() {
            1 => self.models.iter().next().map(String::as_str),
            _ => None,
        }
    }
}

/// The `GET /stats/providers` response.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ProviderStatsResponse {
    /// Every stored gg run with a recorded session summary, whether or not it
    /// recorded providers. A launch that died before a single turn records no
    /// summary and is not scanned.
    pub runs_scanned: u64,
    /// The runs among them whose summary carries provider slices — the
    /// denominator that makes sparse provider coverage read as sparse rather
    /// than as zero.
    pub runs_with_provider_data: u64,
    /// Run evidence: one entry per observed provider, providerless last.
    pub providers: Vec<ProviderStatsOut>,
    /// Probe evidence, strictly separate from the run evidence: one entry per
    /// provider observed on model-probe items.
    pub probes: Vec<ProbeProviderStatsOut>,
}

/// One provider's run evidence: its per-model rows and their total.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ProviderStatsOut {
    /// The provider's OpenRouter name, or null for the slice of calls that
    /// named none — a gateway that stamps no provider, or a turn whose call
    /// produced no reply to name one.
    pub provider: Option<String>,
    /// The per-model rows, largest first by calls, a modelless row last.
    pub models: Vec<ProviderModelStatsOut>,
    /// The rows summed (`runs` counts distinct runs, not a sum of rows).
    pub totals: ProviderCallStatsOut,
}

/// One provider's evidence for one model.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ProviderModelStatsOut {
    /// The model id, or null for a slice recorded before the agent's first
    /// usage delta named one, on a run more than one model served.
    pub model_id: Option<String>,
    /// The row's figures.
    pub stats: ProviderCallStatsOut,
}

/// The call/turn figures one provider row carries.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ProviderCallStatsOut {
    /// Distinct runs contributing to this row.
    pub runs: u64,
    /// Model calls that reported usage.
    pub calls: u64,
    /// Every token class those calls reported, summed.
    pub total_tokens: u64,
    /// Their comparable USD cost, summed — null only when no contributing
    /// slice reported one, so unreported stays unreported.
    pub cost: Option<f64>,
    /// Length-capped replies the provider served.
    pub rejected: u64,
    /// Turns attributed to the provider.
    pub turns: u64,
    /// The turns among them that worked (progressed or finished).
    pub working: u64,
    /// The errored turns, keyed by turn error type wire id.
    pub errors: BTreeMap<String, u64>,
    /// Streams that stalled on this provider.
    pub stalls: u64,
    /// Unexpected cache misses this provider's replies produced.
    pub cache_misses: u64,
}

/// One provider's probe evidence.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ProbeProviderStatsOut {
    /// The provider OpenRouter reported serving the items, or null for calls
    /// that errored before any provider served them.
    pub provider: Option<String>,
    /// The per-model rows, largest first by items.
    pub models: Vec<ProbeProviderModelOut>,
}

/// One provider's probe evidence for one probed model.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ProbeProviderModelOut {
    /// The catalog slug the probe was triggered from.
    pub model_slug: String,
    /// Completion calls on this (provider, model).
    pub items: u64,
    /// The calls whose submitted program passed its case's check.
    pub passes: u64,
    /// The calls that errored before classification.
    pub errored: u64,
}

/// The `GET /stats/model-accuracy` response.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ModelAccuracyResponse {
    /// One entry per model with any evidence, largest evidence first.
    pub models: Vec<ModelAccuracyOut>,
    /// Runs that could not be attributed to any single model: an older
    /// multi-model run with no per-model slices, in either execution mode.
    pub unattributable_runs: u64,
}

/// One model's accuracy figures, split by execution mode. Either half is null
/// when no run of that mode contributed.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ModelAccuracyOut {
    /// The model id, as the runs recorded it.
    pub model_id: String,
    /// The responses-as-code figures.
    pub rac: Option<RacAccuracyOut>,
    /// The tool-calling figures.
    pub tool_calling: Option<ToolCallingAccuracyOut>,
}

/// A model's responses-as-code turn accounting.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct RacAccuracyOut {
    /// Distinct contributing runs.
    pub runs: u64,
    /// Turns attributed to the model, whatever their outcome.
    pub turns: u64,
    /// The turns that worked. Exact where per-model slices exist; on an older
    /// record it is turns minus errors, which counts a fatal turn as valid —
    /// an overcount of at most one turn per agent, tallied under
    /// [`approximate_runs`](Self::approximate_runs).
    pub valid: u64,
    /// Turns the compiler rejected (the transpile kind).
    pub compile: u64,
    /// Turns the program failed at runtime (program faults plus sandbox
    /// limits).
    pub runtime: u64,
    /// Turns lost to the model API (the model-api kind).
    pub model_errors: u64,
    /// Turns that produced no completion at all.
    pub missing: u64,
    /// The same errors keyed by turn error type wire id — the open breakdown
    /// the named groups above are derived from.
    pub by_type: BTreeMap<String, u64>,
    /// The contributing runs whose figures came from the run-level rollup
    /// rather than per-model slices.
    pub approximate_runs: u64,
}

/// A model's tool-calling dispatch accounting.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ToolCallingAccuracyOut {
    /// Distinct runs contributing dispatch totals.
    pub runs: u64,
    /// Dispatched tool calls across them.
    pub calls: u64,
    /// The dispatches that succeeded (calls minus the failures below).
    pub ok: u64,
    /// The failed dispatches, keyed by call failure class wire id.
    pub failures: BTreeMap<String, u64>,
    /// Tool-calling runs with failure evidence but no recorded dispatch total
    /// — records that predate the total, whose rate cannot be stated.
    pub runs_without_call_totals: u64,
}

/// One probe item's projection: the provider that served it, the probed
/// model's catalog slug, whether the submitted program passed its case's
/// check, and whether the call errored before classification.
pub type ProbeItemRow = (Option<String>, String, bool, bool);

/// Fold the run corpus into the providers response's run-evidence half, with
/// its two honesty counters.
///
/// A slice with no model of its own is attributed to the run's sole model when
/// the run has one; on a multi-model run it stays modelless rather than being
/// guessed.
pub fn fold_provider_stats(facts: &[Arc<GgRunFacts>]) -> (u64, u64, Vec<ProviderStatsOut>) {
    /// One (provider, model) accumulator plus the distinct runs behind it.
    #[derive(Default)]
    struct Acc {
        stats: ProviderCallStatsOut,
        runs: BTreeSet<String>,
    }

    let mut cells: BTreeMap<(Option<String>, Option<String>), Acc> = BTreeMap::new();
    let mut runs_with = 0u64;
    for run in facts {
        if run.provider_stats.is_empty() {
            continue;
        }
        runs_with += 1;
        for slice in &run.provider_stats {
            let model = slice
                .model_id
                .clone()
                .or_else(|| run.sole_model().map(str::to_string));
            let acc = cells.entry((slice.provider.clone(), model)).or_default();
            acc.runs.insert(run.id.clone());
            let stats = &mut acc.stats;
            stats.calls += slice.calls;
            stats.total_tokens += slice.tokens.uncached_input.unwrap_or(0)
                + slice.tokens.cached_input.unwrap_or(0)
                + slice.tokens.output.unwrap_or(0)
                + slice.tokens.reasoning.unwrap_or(0);
            if let Some(comparable) = slice.cost.as_ref().and_then(|cost| cost.comparable) {
                stats.cost = Some(stats.cost.unwrap_or(0.0) + comparable);
            }
            stats.rejected += slice.rejected;
            stats.turns += slice.turns;
            stats.working += slice.working;
            for (kind, count) in &slice.errors {
                *stats.errors.entry(kind.clone()).or_default() += count;
            }
            stats.stalls += slice.stalls;
            stats.cache_misses += slice.cache_misses;
        }
    }

    // Regroup the cells per provider, summing each provider's rows into its
    // totals — except `runs`, which is a distinct count rather than a sum.
    let mut providers: BTreeMap<Option<String>, (Vec<ProviderModelStatsOut>, Acc)> =
        BTreeMap::new();
    for ((provider, model), acc) in cells {
        let (rows, totals) = providers.entry(provider).or_default();
        totals.runs.extend(acc.runs.iter().cloned());
        let t = &mut totals.stats;
        t.calls += acc.stats.calls;
        t.total_tokens += acc.stats.total_tokens;
        if let Some(cost) = acc.stats.cost {
            t.cost = Some(t.cost.unwrap_or(0.0) + cost);
        }
        t.rejected += acc.stats.rejected;
        t.turns += acc.stats.turns;
        t.working += acc.stats.working;
        for (kind, count) in &acc.stats.errors {
            *t.errors.entry(kind.clone()).or_default() += count;
        }
        t.stalls += acc.stats.stalls;
        t.cache_misses += acc.stats.cache_misses;
        rows.push(ProviderModelStatsOut {
            model_id: model,
            stats: ProviderCallStatsOut {
                runs: acc.runs.len() as u64,
                ..acc.stats
            },
        });
    }

    let mut out: Vec<ProviderStatsOut> = providers
        .into_iter()
        .map(|(provider, (mut models, totals))| {
            models.sort_by_key(model_row_order);
            ProviderStatsOut {
                provider,
                models,
                totals: ProviderCallStatsOut {
                    runs: totals.runs.len() as u64,
                    ..totals.stats
                },
            }
        })
        .collect();
    out.sort_by_key(provider_order);
    (facts.len() as u64, runs_with, out)
}

/// The turn errors that count as a provider's fault: the turns that ended on its failed model
/// calls. A spent retry schedule, a call that timed out and a reply that did not parse are the
/// provider's; an auth failure, a rejection, a loop or a length cap are not.
const PROVIDER_FAULT_ERRORS: [GgTurnErrorType; 3] = [
    GgTurnErrorType::ModelRetryExhausted,
    GgTurnErrorType::ModelTimeout,
    GgTurnErrorType::ModelParse,
];

/// Each provider's recorded fault rate for one model, across every recorded gg run of it, keyed by
/// the [provider key](test_cabinet_core::pricing::provider_key) the candidate order reads.
///
/// `model_ids` is every id the model is recorded under (its OpenRouter id and, for a curated
/// model, its aliases). A slice counts toward the model when its own model id is one of them, or
/// when it names no model and the run's sole model is one of them — the attribution
/// [`fold_provider_stats`] makes.
///
/// A fault is a stall, an unexpected cache miss, or a turn that ended on a
/// [provider fault error](PROVIDER_FAULT_ERRORS); the rate is the faults over the calls. A
/// provider no counted slice gave a call is absent, which the candidate order reads as zero.
pub fn provider_fault_rates(
    facts: &[Arc<GgRunFacts>],
    model_ids: &[&str],
) -> BTreeMap<String, f64> {
    let mut cells: BTreeMap<String, (u64, u64)> = BTreeMap::new();
    for run in facts {
        for slice in &run.provider_stats {
            let Some(provider) = slice.provider.as_deref() else {
                continue;
            };
            let model = slice.model_id.as_deref().or_else(|| run.sole_model());
            if !model.is_some_and(|model| model_ids.contains(&model)) {
                continue;
            }
            let (faults, calls) = cells
                .entry(test_cabinet_core::pricing::provider_key(provider))
                .or_default();
            let errors: u64 = PROVIDER_FAULT_ERRORS
                .iter()
                .filter_map(|kind| slice.errors.get(kind.wire_id()))
                .sum();
            *faults += errors + slice.stalls + slice.cache_misses;
            *calls += slice.calls;
        }
    }
    cells
        .into_iter()
        .filter(|(_, (_, calls))| *calls > 0)
        .map(|(provider, (faults, calls))| (provider, faults as f64 / calls as f64))
        .collect()
}

/// A provider entry's sort key: named providers by calls (largest first) then
/// name, the providerless entry last.
fn provider_order(entry: &ProviderStatsOut) -> (bool, std::cmp::Reverse<u64>, String) {
    (
        entry.provider.is_none(),
        std::cmp::Reverse(entry.totals.calls),
        entry.provider.clone().unwrap_or_default(),
    )
}

/// A model row's sort key: named models by calls (largest first) then id, the
/// modelless row last.
fn model_row_order(row: &ProviderModelStatsOut) -> (bool, std::cmp::Reverse<u64>, String) {
    (
        row.model_id.is_none(),
        std::cmp::Reverse(row.stats.calls),
        row.model_id.clone().unwrap_or_default(),
    )
}

/// Fold the probe-item projection into the providers response's probe half.
pub fn fold_probe_providers(rows: &[ProbeItemRow]) -> Vec<ProbeProviderStatsOut> {
    let mut cells: BTreeMap<(Option<String>, String), (u64, u64, u64)> = BTreeMap::new();
    for (provider, model_slug, pass, errored) in rows {
        let (items, passes, errs) = cells
            .entry((provider.clone(), model_slug.clone()))
            .or_default();
        *items += 1;
        if *pass {
            *passes += 1;
        }
        if *errored {
            *errs += 1;
        }
    }
    let mut providers: BTreeMap<Option<String>, Vec<ProbeProviderModelOut>> = BTreeMap::new();
    for ((provider, model_slug), (items, passes, errored)) in cells {
        providers
            .entry(provider)
            .or_default()
            .push(ProbeProviderModelOut {
                model_slug,
                items,
                passes,
                errored,
            });
    }
    let mut out: Vec<ProbeProviderStatsOut> = providers
        .into_iter()
        .map(|(provider, mut models)| {
            models.sort_by(|a, b| {
                (std::cmp::Reverse(a.items), &a.model_slug)
                    .cmp(&(std::cmp::Reverse(b.items), &b.model_slug))
            });
            ProbeProviderStatsOut { provider, models }
        })
        .collect();
    out.sort_by(|a, b| {
        let items =
            |entry: &ProbeProviderStatsOut| -> u64 { entry.models.iter().map(|m| m.items).sum() };
        (
            a.provider.is_none(),
            std::cmp::Reverse(items(a)),
            a.provider.clone().unwrap_or_default(),
        )
            .cmp(&(
                b.provider.is_none(),
                std::cmp::Reverse(items(b)),
                b.provider.clone().unwrap_or_default(),
            ))
    });
    out
}

/// Fold the run corpus into the model-accuracy response.
pub fn fold_model_accuracy(facts: &[Arc<GgRunFacts>]) -> ModelAccuracyResponse {
    /// The per-model accumulators, with distinct-run sets beside the counters.
    #[derive(Default)]
    struct Acc {
        rac: RacAccuracyOut,
        rac_runs: BTreeSet<String>,
        tool: ToolCallingAccuracyOut,
        tool_runs: BTreeSet<String>,
    }

    let mut models: BTreeMap<String, Acc> = BTreeMap::new();
    let mut unattributable = 0u64;
    for run in facts {
        match run.execution_mode.as_str() {
            "responses_as_code" => {
                if run.provider_stats.is_empty() {
                    // A record predating per-model slices: attributable only
                    // when one model served the whole run. `valid` is turns
                    // minus errors, which counts a fatal turn as valid — see
                    // [`RacAccuracyOut::valid`].
                    let Some(model) = run.sole_model() else {
                        unattributable += 1;
                        continue;
                    };
                    let acc = models.entry(model.to_string()).or_default();
                    acc.rac_runs.insert(run.id.clone());
                    acc.rac.approximate_runs += 1;
                    acc.rac.turns += run.errors.turns;
                    acc.rac.valid += run.errors.turns.saturating_sub(run.errors.errors);
                    // The named kind counters are the run-level grouping; the
                    // open breakdown rides beside them, as it does on the
                    // record itself.
                    acc.rac.compile += run.errors.transpile;
                    acc.rac.runtime += run.errors.program_fault + run.errors.sandbox_limit;
                    acc.rac.model_errors += run.errors.model_api;
                    acc.rac.missing += run.errors.missing_completion;
                    for (wire_id, count) in &run.errors.by_type {
                        *acc.rac.by_type.entry(wire_id.clone()).or_default() += count;
                    }
                    continue;
                }
                // Slices carry exact per-model turn accounting. A modelless
                // slice resolves to the run's sole model when it has one;
                // a run none of whose slices resolve contributes nothing and
                // is counted unattributable once.
                let mut contributed = false;
                for slice in &run.provider_stats {
                    let model = slice.model_id.as_deref().or_else(|| run.sole_model());
                    let Some(model) = model else {
                        continue;
                    };
                    contributed = true;
                    let acc = models.entry(model.to_string()).or_default();
                    acc.rac_runs.insert(run.id.clone());
                    acc.rac.turns += slice.turns;
                    acc.rac.valid += slice.working;
                    fold_error_groups(&mut acc.rac, &slice.errors);
                }
                if !contributed {
                    unattributable += 1;
                }
            }
            _ => {
                // Tool calling. Dispatch totals are run-level, so a run needs
                // a sole model to be attributable at all.
                let Some(model) = run.sole_model() else {
                    if run.tool_calls > 0 || !run.errors.tool_failures.is_empty() {
                        unattributable += 1;
                    }
                    continue;
                };
                if run.tool_calls == 0 {
                    // No total recorded. Failure evidence without a
                    // denominator cannot state a rate — tally it, never
                    // default it.
                    if !run.errors.tool_failures.is_empty() {
                        models
                            .entry(model.to_string())
                            .or_default()
                            .tool
                            .runs_without_call_totals += 1;
                    }
                    continue;
                }
                let acc = models.entry(model.to_string()).or_default();
                acc.tool_runs.insert(run.id.clone());
                acc.tool.calls += run.tool_calls;
                let mut failed = 0u64;
                for (class, count) in &run.errors.tool_failures {
                    *acc.tool.failures.entry(class.clone()).or_default() += count;
                    failed += count;
                }
                acc.tool.ok += run.tool_calls.saturating_sub(failed);
            }
        }
    }

    let mut out: Vec<ModelAccuracyOut> = models
        .into_iter()
        .map(|(model_id, mut acc)| {
            acc.rac.runs = acc.rac_runs.len() as u64;
            acc.tool.runs = acc.tool_runs.len() as u64;
            let has_rac = acc.rac.turns > 0 || acc.rac.runs > 0;
            let has_tool = acc.tool.calls > 0 || acc.tool.runs_without_call_totals > 0;
            ModelAccuracyOut {
                model_id,
                rac: has_rac.then_some(acc.rac),
                tool_calling: has_tool.then_some(acc.tool),
            }
        })
        .collect();
    out.sort_by(|a, b| {
        let volume = |entry: &ModelAccuracyOut| -> u64 {
            entry.rac.as_ref().map_or(0, |rac| rac.turns)
                + entry.tool_calling.as_ref().map_or(0, |tool| tool.calls)
        };
        (std::cmp::Reverse(volume(a)), &a.model_id)
            .cmp(&(std::cmp::Reverse(volume(b)), &b.model_id))
    });
    ModelAccuracyResponse {
        models: out,
        unattributable_runs: unattributable,
    }
}

/// Fold one open error breakdown into a model's named groups and its own
/// passthrough map.
///
/// The grouping is derived from [`GgTurnErrorType`] itself — every wire id is
/// mapped through the enum's own [`kind`](GgTurnErrorType::kind) — so a type
/// added to the contract regroups here without a hand-kept list. A wire id the
/// enum does not know (a record written by a newer gg) reaches only the
/// passthrough map, exactly as [`GgErrorSummary`](test_cabinet_core::gg::GgErrorSummary)'s `by_type` treats it.
fn fold_error_groups(acc: &mut RacAccuracyOut, by_type: &BTreeMap<String, u64>) {
    for (wire_id, count) in by_type {
        *acc.by_type.entry(wire_id.clone()).or_default() += count;
        let Some(kind) = GgTurnErrorType::ALL
            .iter()
            .find(|error_type| error_type.wire_id() == wire_id)
            .map(|error_type| error_type.kind())
        else {
            continue;
        };
        let group = match kind {
            GgTurnErrorKind::Transpile => &mut acc.compile,
            GgTurnErrorKind::ProgramFault | GgTurnErrorKind::SandboxLimit => &mut acc.runtime,
            GgTurnErrorKind::ModelApi => &mut acc.model_errors,
            GgTurnErrorKind::MissingCompletion => &mut acc.missing,
        };
        *group += count;
    }
}

// --- Cabinet statistics (`GET /stats/cabinet`) -------------------------------

/// One run's `/stats/cabinet` projection: its RFC 3339 start time, lifted token
/// total, comparable cost, test-case slug, and model id — the five lifted `run`
/// columns [`fold_cabinet_stats`] reads, projected across the **whole** corpus
/// (every state, published or not) by [`crate::db::Db::cabinet_stat_rows`].
pub type CabinetRunRow = (String, i64, Option<f64>, String, String);

/// The `GET /stats/cabinet` response: the cabinet's headline totals plus the
/// weekly activity series the home page charts.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CabinetStatsResponse {
    /// Every recorded run, whatever its state or publication.
    pub runs: u64,
    /// The summed token totals, with the honesty counter beside the sum.
    pub tokens: CabinetTokensOut,
    /// The summed comparable USD cost, with the honesty counter beside the sum.
    pub cost: CabinetCostOut,
    /// Distinct test-case slugs across the corpus.
    pub test_cases: u64,
    /// Distinct model ids across the corpus.
    pub models: u64,
    /// Runs per ISO week (UTC Mondays), the last 52 weeks up to
    /// now inclusive, ascending, with explicit zero entries for empty weeks so a
    /// consumer charts the series without filling gaps.
    pub weekly: Vec<CabinetWeekOut>,
}

/// The cabinet's token total and its unreported-run counter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CabinetTokensOut {
    /// Total tokens across the runs that reported any.
    pub total: u64,
    /// Runs whose metrics reported no tokens; they contribute nothing to the
    /// total.
    pub unreported_runs: u64,
}

/// The cabinet's comparable-cost total and its unreported-run counter.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CabinetCostOut {
    /// Summed comparable cost (USD) across the runs whose cost is known.
    pub total: f64,
    /// Runs whose comparable cost is unknown (a `NULL` lifted column); they
    /// contribute nothing to the total.
    pub unreported_runs: u64,
}

/// One week of the cabinet's activity series.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CabinetWeekOut {
    /// The week's UTC Monday, as `YYYY-MM-DD`.
    pub week_start: String,
    /// Runs whose `started_at` falls in that ISO week.
    pub runs: u64,
}

/// How many weeks the cabinet's activity series covers — a year, the newest
/// being the current (partial) week.
const CABINET_WEEKS: i64 = 52;

/// Fold the whole-corpus projection into the `/stats/cabinet` response. `now`
/// anchors the weekly window's newest bucket and is passed in by the handler so
/// the fold stays a pure function of its inputs.
///
/// Two honesty rules, both about the lifted columns rather than the records:
///
/// * The lifted `total_tokens` column stores `0` for a run whose metrics
///   reported no tokens at all (the record's total is `None` — see
///   [`TokenCounts::total`](test_cabinet_core::metrics::TokenCounts::total)),
///   which the projection cannot tell apart from a genuine zero. A `0` is
///   therefore counted as **unreported** — a run that truly consumed zero
///   tokens reported nothing worth summing, so the approximation costs the
///   total nothing and keeps the counter truthful for the overwhelmingly common
///   case (a harness that reports no usage).
/// * A `NULL` `cost_comparable` is an unknown cost, distinct from a free run's
///   genuine `0.0`: unknowns are excluded from the sum and counted, never
///   defaulted to zero.
///
/// The weekly series buckets each run by the UTC Monday of the ISO week its
/// `started_at` falls in, computed in Rust (no SQL date functions — SQLite and
/// Postgres must fold identically). A run outside the window — older than the
/// oldest bucket, or stamped after `now`'s week by clock skew — still counts in
/// every total but charts nowhere; so does a run whose `started_at` does not
/// parse, since it cannot be placed in any week.
pub fn fold_cabinet_stats(
    rows: &[CabinetRunRow],
    now: time::OffsetDateTime,
) -> CabinetStatsResponse {
    use time::format_description::well_known::Rfc3339;

    let this_week = week_monday(now.to_offset(time::UtcOffset::UTC).date());
    let mut weekly: BTreeMap<time::Date, u64> = (0..CABINET_WEEKS)
        .map(|weeks_back| (this_week - time::Duration::weeks(weeks_back), 0))
        .collect();

    let mut tokens = CabinetTokensOut {
        total: 0,
        unreported_runs: 0,
    };
    let mut cost = CabinetCostOut {
        total: 0.0,
        unreported_runs: 0,
    };
    let mut test_cases: BTreeSet<&str> = BTreeSet::new();
    let mut models: BTreeSet<&str> = BTreeSet::new();
    for (started_at, total_tokens, cost_comparable, test_case_slug, model_id) in rows {
        if *total_tokens > 0 {
            tokens.total += *total_tokens as u64;
        } else {
            tokens.unreported_runs += 1;
        }
        match cost_comparable {
            Some(comparable) => cost.total += comparable,
            None => cost.unreported_runs += 1,
        }
        test_cases.insert(test_case_slug);
        models.insert(model_id);
        if let Ok(started) = time::OffsetDateTime::parse(started_at, &Rfc3339)
            && let Some(count) =
                weekly.get_mut(&week_monday(started.to_offset(time::UtcOffset::UTC).date()))
        {
            *count += 1;
        }
    }

    CabinetStatsResponse {
        runs: rows.len() as u64,
        tokens,
        cost,
        test_cases: test_cases.len() as u64,
        models: models.len() as u64,
        weekly: weekly
            .into_iter()
            .map(|(monday, runs)| CabinetWeekOut {
                week_start: format_week_start(monday),
                runs,
            })
            .collect(),
    }
}

/// The UTC Monday beginning `date`'s ISO week — the cabinet activity series'
/// bucket key. Pure date math, so both database backends bucket identically.
fn week_monday(date: time::Date) -> time::Date {
    date - time::Duration::days(i64::from(date.weekday().number_days_from_monday()))
}

/// A bucket key as the wire's `YYYY-MM-DD`.
fn format_week_start(monday: time::Date) -> String {
    use time::format_description::FormatItem;
    use time::macros::format_description;
    const WEEK_START: &[FormatItem<'_>] = format_description!("[year]-[month]-[day]");
    // The format has no offset/zone items, so formatting a `Date` cannot fail.
    monday.format(WEEK_START).expect("date-only format")
}
