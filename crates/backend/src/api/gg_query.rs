//! The **gg analysis query** endpoints (`/gg/query`, `/gg/query/batch`,
//! `/gg/fields`) — the backend half of [TCQ](test_cabinet_core::gg_query).
//!
//! The division of labour is deliberate and total: **core owns the language**
//! (the document model, the evaluator, the field catalog) and this module owns
//! only the corpus. A handler here resolves the
//! [document index](crate::gg_docs::GgDocIndex) to a slice of documents and calls
//! [`evaluate`] or [`field_catalog`] — the same two functions the public static
//! site's browser-side copy calls over documents shipped in a snapshot, with no
//! backend at all. Nothing about *what a query means* is decided here, because
//! anything decided here would be a place the two hosts could disagree.
//!
//! The corpus is **not account-scoped**. A gg run belongs to the deployment, not to
//! whoever launched it, exactly as the run listings and the coverage matrix already
//! treat runs; it is the *saved views* over the corpus that are per-account. The
//! bearer token is therefore a gate on reaching the surface at all, not a filter on
//! what it returns.

#[cfg(test)]
#[path = "gg_query.test.rs"]
mod tests;

use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use serde::{Deserialize, Serialize};

use test_cabinet_core::gg_query::{
    GgFieldCatalog, GgQuery, GgQueryResponse, GgRunDoc, evaluate, field_catalog,
};

use crate::auth::AuthUser;
use crate::error::ApiError;
use crate::gg_docs::CatalogScores;

use super::AppState;

/// The most rows — documents or buckets — a single query may return.
///
/// [`GgQuery::limit`] is optional precisely so a caller can ask for everything, and
/// its documentation makes imposing a ceiling the *server's* job. This is that
/// ceiling. It applies to both result shapes because both can explode: a document
/// query with no filter returns the whole corpus, and a `stats ... by id` produces
/// one bucket per run. Exceeding it is not an error — the response comes back
/// [truncated](GgQueryResponse::truncated), which every view is already obliged to
/// render as "showing the first N".
pub const GG_QUERY_MAX_ROWS: u32 = 1_000;

/// The most queries one [batch](GgQueryBatch) may carry.
///
/// A dashboard is a page of panels, not a program; twelve columns of grid do not
/// hold thirty-two panels. The cap exists so one request cannot turn into an
/// unbounded amount of evaluation, and it is a hard rejection rather than a silent
/// truncation because a dropped panel renders as an empty chart with no explanation.
pub const GG_QUERY_MAX_BATCH: usize = 32;

/// The body of `POST /gg/query/batch`: several queries answered from **one** read of
/// the document index.
///
/// A dashboard's panels almost always share a filter and differ only in their
/// aggregation, so answering them one request at a time re-resolves the same corpus
/// N times and — because the index refreshes on a timer — can even answer two panels
/// of the same board from two different corpora, which reads as a data bug. One
/// batch, one snapshot, one consistent board.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgQueryBatch {
    /// The queries to evaluate, at most [`GG_QUERY_MAX_BATCH`] of them.
    #[serde(default)]
    pub queries: Vec<GgQuery>,
}

/// The response to `POST /gg/query/batch`.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgQueryBatchResponse {
    /// One result per requested query, **in request order** — the only binding
    /// between a panel and its answer, so the list is never filtered or reordered.
    #[serde(default)]
    pub results: Vec<GgQueryResponse>,
}

/// `POST /gg/query` — evaluate one TCQ query over every gg run this deployment
/// holds. Requires a bearer token, the same gate as the other gg endpoints.
///
/// The client parses and compiles the query text; the wire form is the compiled
/// [`GgQuery`], so the server needs neither a parser nor a clock (a relative date
/// like `now-30d` is resolved to absolute milliseconds before it is sent).
#[tracing::instrument(name = "gg.query", skip(state, _user, query), err(Debug))]
pub async fn run_query(
    State(state): State<AppState>,
    _user: AuthUser,
    Json(query): Json<GgQuery>,
) -> Result<Json<GgQueryResponse>, ApiError> {
    let docs = corpus(&state).await?;
    Ok(Json(evaluate(&docs, &capped(query))))
}

/// `POST /gg/query/batch` — evaluate up to [`GG_QUERY_MAX_BATCH`] queries against one
/// index read. Requires a bearer token.
#[tracing::instrument(name = "gg.query.batch", skip(state, _user, body), err(Debug))]
pub async fn run_query_batch(
    State(state): State<AppState>,
    _user: AuthUser,
    Json(body): Json<GgQueryBatch>,
) -> Result<Json<GgQueryBatchResponse>, ApiError> {
    ensure_batch_fits(body.queries.len())?;
    let docs = corpus(&state).await?;
    let results = body
        .queries
        .into_iter()
        .map(|query| evaluate(&docs, &capped(query)))
        .collect();
    Ok(Json(GgQueryBatchResponse { results }))
}

/// `GET /gg/fields` — the field catalog: every dotted field observed across the
/// corpus, with its kind, its document count and its most common values. Requires a
/// bearer token.
///
/// This is what makes the language discoverable, and the document count is the part
/// that matters most: a `tool.*` field is deliberately sparse, and without seeing the
/// count an operator would have to *infer* that from an empty result.
#[tracing::instrument(name = "gg.fields", skip(state, _user), err(Debug))]
pub async fn gg_fields(
    State(state): State<AppState>,
    _user: AuthUser,
) -> Result<Json<GgFieldCatalog>, ApiError> {
    let docs = corpus(&state).await?;
    Ok(Json(field_catalog(&docs)))
}

/// Resolve the document corpus, refreshing the index if its last reconcile has aged
/// out.
async fn corpus(state: &AppState) -> Result<Arc<Vec<GgRunDoc>>, ApiError> {
    let mut scores = CatalogScores::new(&state.store);
    state
        .gg_docs
        .documents(&state.db, &mut |run| scores.score(run))
        .await
        .map_err(ApiError::from)
}

/// Reject a batch that carries more than [`GG_QUERY_MAX_BATCH`] queries, naming both
/// the ceiling and what was sent so the caller can see by how much.
fn ensure_batch_fits(count: usize) -> Result<(), ApiError> {
    if count > GG_QUERY_MAX_BATCH {
        return Err(ApiError::bad_request(format!(
            "a gg query batch carries at most {GG_QUERY_MAX_BATCH} queries; this one carries \
             {count}"
        )));
    }
    Ok(())
}

/// Apply [`GG_QUERY_MAX_ROWS`] to a query's own limit.
///
/// Lowering a caller's explicit limit is safe to do silently because the evaluator
/// reports [`truncated`](GgQueryResponse::truncated) whenever rows were cut, so the
/// clamp is visible in the response rather than only in this source file.
fn capped(mut query: GgQuery) -> GgQuery {
    query.limit = Some(
        query
            .limit
            .unwrap_or(GG_QUERY_MAX_ROWS)
            .min(GG_QUERY_MAX_ROWS),
    );
    query
}
