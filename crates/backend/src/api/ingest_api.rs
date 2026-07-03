//! The ingest trigger handler (§1.1's `POST /ingest`).

use std::convert::Infallible;
use std::path::PathBuf;

use axum::Json;
use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderMap, header};
use axum::response::{IntoResponse, Response};
use bytes::Bytes;
use futures_util::stream;
use serde::{Deserialize, Serialize};

use crate::error::ApiError;
use crate::ingest::{IngestEvent, IngestReport, IngestRequest, Ingestor};
use crate::store::DefinitionStore;

use super::AppState;

/// `POST /ingest` — scan the configured checkout, copying any new/changed
/// test-case versions into the store and rendering reference screenshots.
/// Container images are distributed via a registry and pulled by runners by digest
/// from their own configuration; the backend is out of the container path and
/// ingest does not touch them.
///
/// The scan touches the filesystem and renders references (CPU/process-bound), so
/// it runs on a blocking thread to keep the async runtime responsive.
///
/// A whole-catalog scan can take a minute-plus, so the response shape is content
/// negotiated: a client that sends `Accept: application/x-ndjson` gets a streamed
/// progress feed (one NDJSON line per version as it completes, then a `done` line),
/// while the default answers once with the full JSON report. The streaming and
/// default paths run the identical scan; only the framing differs.
#[tracing::instrument(name = "ingest", skip(state, headers, body), err(Debug))]
pub async fn ingest(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Option<Json<IngestBody>>,
) -> Result<Response, ApiError> {
    let body = body.map(|Json(b)| b).unwrap_or_default();
    let request = IngestRequest {
        test_cases: body.test_cases,
        force: body.force,
        catalog_version: body.catalog_version,
    };

    let checkout = state.config.checkout.clone();
    let store = state.store.clone();

    // The whole-catalog prune must never drop a definition a run still references, so
    // fetch that protected set here (async, before the blocking scan) and hand it to
    // the ingestor. Cheap and harmless on a partial scan, which does not prune.
    let protected = state.db.referenced_cases().await.map_err(ApiError::from)?;

    if wants_ndjson(&headers) {
        return Ok(ingest_streaming(checkout, store, request, protected));
    }

    // Default: run the scan to completion and answer with the full report.
    let report = tokio::task::spawn_blocking(move || {
        Ingestor::new(&checkout, &store)
            .with_protected_cases(protected)
            .scan(&request)
    })
    .await
    .map_err(|e| ApiError::internal(format!("ingest task panicked: {e}")))?
    .map_err(ApiError::from)?;

    Ok(Json(IngestResponse::from(report)).into_response())
}

/// True when the request asks for the streamed NDJSON progress feed.
fn wants_ndjson(headers: &HeaderMap) -> bool {
    headers
        .get(header::ACCEPT)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|accept| accept.contains("application/x-ndjson"))
}

/// Run the scan on a blocking thread, streaming an NDJSON progress line per version
/// as it completes (plus a closing `done`, or an `error` line if the scan aborts).
/// The scan outpaces no realistic consumer here, so an unbounded channel buffers the
/// handful of small lines without backpressure; the response ends when the blocking
/// task drops its sender.
fn ingest_streaming(
    checkout: PathBuf,
    store: DefinitionStore,
    request: IngestRequest,
    protected: std::collections::HashSet<(String, String)>,
) -> Response {
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<Bytes>();

    tokio::task::spawn_blocking(move || {
        let ingestor = Ingestor::new(&checkout, &store).with_protected_cases(protected);
        let result = ingestor.scan_with_progress(&request, |event| {
            let _ = tx.send(encode_event(&StreamEvent::from(event)));
        });
        // A single closing line conveys the outcome in-band: the stream has already
        // sent a 200, so a late failure cannot become an HTTP error code.
        let closing = match result {
            Ok(report) => StreamEvent::done(&report),
            Err(err) => StreamEvent::Error {
                message: err.to_string(),
            },
        };
        let _ = tx.send(encode_event(&closing));
    });

    let stream = stream::unfold(rx, |mut rx| async move {
        rx.recv()
            .await
            .map(|line| (Ok::<Bytes, Infallible>(line), rx))
    });

    (
        [
            (header::CONTENT_TYPE, "application/x-ndjson"),
            (header::CACHE_CONTROL, "no-cache"),
        ],
        Body::from_stream(stream),
    )
        .into_response()
}

/// Encode one progress event as a `\n`-terminated NDJSON line. The fields are
/// JSON-safe scalars, so a defensive empty line stands in for the impossible
/// serialization error rather than aborting the stream.
fn encode_event(event: &StreamEvent) -> Bytes {
    match serde_json::to_string(event) {
        Ok(mut line) => {
            line.push('\n');
            Bytes::from(line)
        }
        Err(_) => Bytes::from_static(b"\n"),
    }
}

// --- Wire shapes (§1.1) -----------------------------------------------------

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IngestBody {
    #[serde(default)]
    test_cases: Option<Vec<String>>,
    #[serde(default)]
    force: bool,
    /// A version token (the client's build commit) tagging a whole-catalog ingest,
    /// letting the backend skip the re-render when the catalog is unchanged. See
    /// [`IngestRequest::catalog_version`].
    #[serde(default)]
    catalog_version: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestResponse {
    test_case_versions: Vec<VersionOut>,
}

impl From<IngestReport> for IngestResponse {
    fn from(report: IngestReport) -> Self {
        IngestResponse {
            test_case_versions: report
                .test_case_versions
                .into_iter()
                .map(|v| VersionOut {
                    slug: v.slug,
                    version: v.version,
                    ingested: v.ingested,
                    rendered_references: v.rendered_references,
                })
                .collect(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VersionOut {
    slug: String,
    version: String,
    ingested: bool,
    rendered_references: usize,
}

/// One line of the streamed (`Accept: application/x-ndjson`) progress feed,
/// discriminated by an `event` tag: `start` once up front, a `version` per
/// completed version, then a single closing `done` (or `error`).
#[derive(Serialize)]
#[serde(tag = "event", rename_all = "camelCase")]
enum StreamEvent {
    Start {
        total: usize,
    },
    Version {
        index: usize,
        total: usize,
        slug: String,
        version: String,
        ingested: bool,
        #[serde(rename = "renderedReferences")]
        rendered_references: usize,
    },
    Done {
        total: usize,
        ingested: usize,
        skipped: usize,
    },
    Error {
        message: String,
    },
}

impl StreamEvent {
    /// The closing summary for a successful scan: how many versions were (re)ingested
    /// vs. skipped as unchanged.
    fn done(report: &IngestReport) -> Self {
        let total = report.test_case_versions.len();
        let ingested = report
            .test_case_versions
            .iter()
            .filter(|v| v.ingested)
            .count();
        StreamEvent::Done {
            total,
            ingested,
            skipped: total - ingested,
        }
    }
}

impl From<IngestEvent<'_>> for StreamEvent {
    fn from(event: IngestEvent<'_>) -> Self {
        match event {
            IngestEvent::Start { total } => StreamEvent::Start { total },
            IngestEvent::Version {
                index,
                total,
                version,
            } => StreamEvent::Version {
                index,
                total,
                slug: version.slug.clone(),
                version: version.version.clone(),
                ingested: version.ingested,
                rendered_references: version.rendered_references,
            },
        }
    }
}
