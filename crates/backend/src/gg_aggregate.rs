//! The backend side of gg [result aggregation]: turn the persisted gg runs into the
//! lightweight [rows](GgAggregateRow) the core aggregation folds over, then run the
//! query.
//!
//! Core owns the query language and the fold ([`test_cabinet_core::gg_aggregate`]);
//! the backend owns the two things core cannot: reading the runs out of the store and
//! resolving each run's reviewer **score** from the case catalog (the checklist
//! weights live only there). [`aggregate_stored_gg_runs`] is that glue — pure over
//! its inputs (the loaded runs and a score resolver), so it is testable without the
//! HTTP layer or the definition store.
//!
//! [result aggregation]: https://docs.testcabinet.ai/gg/result-aggregation/

#[cfg(test)]
#[path = "gg_aggregate.test.rs"]
mod tests;

use test_cabinet_core::gg_aggregate::{
    GgAggregateQuery, GgAggregateResponse, GgAggregateRow, aggregate,
};

use crate::db::StoredRun;

/// Reduce a stored gg run to the aggregation's [row](GgAggregateRow): lift the
/// capability set, session summary, resource metrics, and terminal state off the
/// record, and attach the reviewer `score` the caller resolved for it.
///
/// `score` is the run's aggregate reviewer score as a `0.0..=1.0` fraction (mean
/// earned checklist weight over the total available), or `None` when the run has no
/// reviews or its case's checklist weights could not be resolved — computed by the
/// caller because the weights live in the case catalog, not on the run.
pub fn row_from_stored(run: &StoredRun, score: Option<f64>) -> GgAggregateRow {
    let record = &run.record;
    GgAggregateRow {
        test_case: record.subject.test_case_slug.clone(),
        capability_set: record.subject.gg_capability_set.clone(),
        summary: record.subject.gg_summary.clone(),
        run_time_seconds: record.metrics.run_time_seconds,
        total_tokens: record.metrics.tokens.total(),
        cost_comparable: record.metrics.cost.comparable,
        run_state: record.status.state,
        score,
    }
}

/// Run a [`GgAggregateQuery`] over a set of stored gg runs, resolving each run's
/// reviewer score with `score_of`. The handler supplies a resolver backed by the case
/// catalog; a test can pass one that returns a fixed (or absent) score.
pub fn aggregate_stored_gg_runs(
    runs: &[StoredRun],
    query: &GgAggregateQuery,
    score_of: impl Fn(&StoredRun) -> Option<f64>,
) -> GgAggregateResponse {
    let rows: Vec<GgAggregateRow> = runs
        .iter()
        .map(|run| row_from_stored(run, score_of(run)))
        .collect();
    aggregate(&rows, query)
}
