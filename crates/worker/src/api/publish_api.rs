//! The run-lifecycle endpoints: push, review, and publish a finished run on the
//! same terms a local `tcab push`/`review`/`publish` does.
//!
//! The run lifecycle is split (see `core/results.md`):
//! - **push** releases the run's source to its own public GitHub repository,
//!   deploys the playable build to Cloudflare Pages, and stores the record on the
//!   backend — without a review.
//! - **review** submits a review for an already-pushed run.
//! - **publish** flips a reviewed run public (refused with no reviews).
//!
//! The worker re-implements none of this — it assembles the core
//! [`BackendPublisher`](test_cabinet_core::BackendPublisher)/[`HttpBackendClient`]
//! exactly as the CLI does and drives it, **forwarding the caller's bearer token**
//! (the console's logged-in account) to the backend, which attributes the review.

use std::path::Path;

use axum::Json;
use axum::extract::State;
use axum::http::HeaderMap;
use serde::{Deserialize, Serialize};
use test_cabinet_core::{
    ArtifactCollection, BackendClient, BackendPublisher, DomainRating, HttpBackendClient,
    PublishConfig, Publisher, PushRequest, RunRecord, SystemCommandRunner, Writeup,
    find_build_output, read_event_log,
};

use crate::api::AppState;
use crate::error::ApiError;

/// The body of `POST /push`: which finished run to push.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PushBody {
    /// The id of a run this worker previously produced.
    pub run_id: String,
}

/// The body of `POST /review`: a review for an already-pushed run.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ReviewBody {
    /// The run to review.
    pub run_id: String,
    /// The reviewer's quality rating for each scoring domain.
    pub ratings: Vec<DomainRating>,
    /// The writeup prose (markdown body).
    pub writeup: String,
    /// The reviewer's verdicts on the case's declared checklist items.
    #[serde(default)]
    pub checklist: Vec<test_cabinet_core::ReviewVerdict>,
}

/// The body of `POST /publish`: which reviewed run to publish.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PublishBody {
    /// The run to publish.
    pub run_id: String,
}

/// The response to a successful push: the resolved links and idempotency flag.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PushAck {
    pub run_id: String,
    /// The released source repo URL; absent for an asset-generation run, which
    /// releases no code.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub source_repo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub playable_build: Option<String>,
    pub newly_pushed: bool,
}

/// The response to a successful review submission.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ReviewAck {
    pub run_id: String,
}

/// The response to a successful publish.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PublishAck {
    pub run_id: String,
    pub newly_published: bool,
}

/// `POST /push` — release the run's source + build and store the record (no
/// review). Requires the caller's bearer token, forwarded to the backend.
pub async fn push(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PushBody>,
) -> Result<Json<PushAck>, ApiError> {
    let publisher = publisher(&state, &headers)?;

    let run_dir = state.config.out_dir.join(&body.run_id);
    let record = load_run_record(&run_dir, &body.run_id)?;
    let impl_dir = run_dir.join("implementation");
    if !impl_dir.is_dir() {
        return Err(ApiError::not_found(format!(
            "no collected implementation for `{}` at {}",
            body.run_id,
            impl_dir.display()
        )));
    }
    let build_dir = find_build_output(&impl_dir);
    let artifacts = ArtifactCollection {
        repo_path: impl_dir,
    };
    let events = read_event_log(&run_dir);

    let request = PushRequest {
        record: &record,
        artifacts: &artifacts,
        build_dir: build_dir.as_deref(),
        events: &events,
    };
    let outcome = publisher
        .push(&request)
        .await
        .map_err(|err| ApiError::internal(format!("pushing run `{}`: {err}", body.run_id)))?;

    Ok(Json(PushAck {
        run_id: record.id,
        source_repo: outcome.source_repo,
        playable_build: outcome.playable_build,
        newly_pushed: outcome.newly_pushed,
    }))
}

/// `POST /review` — submit a review for an already-pushed run, attributed to the
/// caller's account (the forwarded bearer token).
pub async fn review(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ReviewBody>,
) -> Result<Json<ReviewAck>, ApiError> {
    if body.ratings.is_empty() {
        return Err(ApiError::unprocessable(
            "`ratings` must rate at least one domain",
        ));
    }
    if body.writeup.trim().is_empty() {
        return Err(ApiError::unprocessable("`writeup` must not be empty"));
    }
    let writeup = Writeup {
        ratings: body.ratings,
        body: body.writeup.trim().to_string(),
        checklist: body.checklist,
    };
    let client = backend_client(&state, &headers)?;
    client
        .submit_review(&body.run_id, &writeup)
        .await
        .map_err(|err| ApiError::internal(format!("reviewing run `{}`: {err}", body.run_id)))?;
    Ok(Json(ReviewAck {
        run_id: body.run_id,
    }))
}

/// `POST /publish` — publish a reviewed run (flip it public). Forwards the
/// caller's token; the backend refuses a run with no reviews.
pub async fn publish(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PublishBody>,
) -> Result<Json<PublishAck>, ApiError> {
    let client = backend_client(&state, &headers)?;
    let ack = client
        .publish_run(&body.run_id)
        .await
        .map_err(|err| ApiError::internal(format!("publishing run `{}`: {err}", body.run_id)))?;
    Ok(Json(PublishAck {
        run_id: ack.id,
        newly_published: ack.newly_published,
    }))
}

/// Build a [`BackendPublisher`] whose backend client carries the caller's bearer
/// token (forwarded from the incoming request).
fn publisher(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<BackendPublisher<SystemCommandRunner, HttpBackendClient>, ApiError> {
    Ok(BackendPublisher::new(
        PublishConfig::from_env(),
        SystemCommandRunner,
        backend_client(state, headers)?,
    ))
}

/// Build an [`HttpBackendClient`] carrying the caller's bearer token. The token
/// is required: a mutating call without an authenticated account is a `401`.
fn backend_client(state: &AppState, headers: &HeaderMap) -> Result<HttpBackendClient, ApiError> {
    let token = bearer(headers)
        .ok_or_else(|| ApiError::unauthorized("missing bearer token — log in first"))?;
    Ok(HttpBackendClient::new(state.config.backend_url.clone()).with_token(Some(token)))
}

/// Load a run record from `<run_dir>/run-record.json`, mapping a missing one to a
/// `404`.
fn load_run_record(run_dir: &Path, run_id: &str) -> Result<RunRecord, ApiError> {
    let record_path = run_dir.join("run-record.json");
    let text = std::fs::read_to_string(&record_path).map_err(|err| {
        ApiError::not_found(format!(
            "no run record for `{run_id}` at {}: {err}",
            record_path.display()
        ))
    })?;
    serde_json::from_str(&text)
        .map_err(|err| ApiError::internal(format!("parsing run record for `{run_id}`: {err}")))
}

/// Extract the bearer token from an `Authorization: Bearer <token>` header.
fn bearer(headers: &HeaderMap) -> Option<String> {
    let value = headers
        .get(axum::http::header::AUTHORIZATION)?
        .to_str()
        .ok()?;
    let token = value
        .strip_prefix("Bearer ")
        .or_else(|| value.strip_prefix("bearer "))?
        .trim();
    (!token.is_empty()).then(|| token.to_string())
}
