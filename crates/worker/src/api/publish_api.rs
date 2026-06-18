//! The publish endpoint: release a finished run on the same terms a local
//! `tcab publish` does.
//!
//! Publishing is a distinct, explicit operation from running (see
//! `core/results.md`): it releases the run's generated source to its own public
//! GitHub repository, deploys the playable build to Cloudflare Pages, and submits
//! the record + review + resolved links to the backend (the system of record).
//! The worker re-implements none of this — it assembles the core
//! [`BackendPublisher`](test_cabinet_core::BackendPublisher) exactly as the CLI
//! does and drives it.
//!
//! A run cannot be published without a review (a hand-written rating + writeup),
//! so the request carries one; a missing or invalid rating is a `422`.

use std::path::Path;

use axum::Json;
use axum::extract::State;
use serde::{Deserialize, Serialize};
use test_cabinet_core::{
    ArtifactCollection, BackendPublisher, HttpBackendClient, PublishConfig, PublishRequest,
    Publisher, Rating, RunRecord, SystemCommandRunner, Writeup, find_build_output,
};

use crate::api::AppState;
use crate::error::ApiError;

/// The body of `POST /publish`: which finished run to publish, and its review.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishBody {
    /// The id of a run this worker previously produced. Its record and collected
    /// implementation are loaded from the worker's output directory.
    pub run_id: String,
    /// The reviewer's quality rating (`flawless` | `great` | `scuffed` | `broken`).
    pub rating: String,
    /// The writeup prose shown before the playable build (markdown body).
    pub writeup: String,
    /// The reviewer's verdicts on the case's declared checklist items.
    #[serde(default)]
    pub checklist: Vec<test_cabinet_core::ReviewVerdict>,
}

/// The response to a successful publish: the resolved links and whether anything
/// changed (publishing is idempotent).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishAck {
    /// The published run's id.
    pub run_id: String,
    /// The public source repository URL.
    pub source_repo: String,
    /// The playable-build URL, when a static build was deployed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub playable_build: Option<String>,
    /// Whether this publish newly recorded the run, or was an idempotent re-publish.
    pub newly_published: bool,
}

/// `POST /publish` — publish a finished run.
///
/// Loads the run's record and implementation from this worker's output
/// directory, validates the review, and runs the full publish (release code,
/// deploy build, submit to the backend). Idempotent on the run id.
pub async fn publish(
    State(state): State<AppState>,
    Json(body): Json<PublishBody>,
) -> Result<Json<PublishAck>, ApiError> {
    // Validate the review up front: publishing refuses a run without one.
    let rating = Rating::parse(&body.rating).ok_or_else(|| {
        ApiError::unprocessable(format!(
            "`rating` must be one of flawless|great|scuffed|broken, got `{}`",
            body.rating
        ))
    })?;
    if body.writeup.trim().is_empty() {
        return Err(ApiError::unprocessable(
            "`writeup` must not be empty (a run cannot be published without a review)",
        ));
    }
    let writeup = Writeup {
        rating,
        body: body.writeup.trim().to_string(),
        checklist: body.checklist,
    };

    // Locate the record and its sibling implementation that a prior run wrote.
    let run_dir = state.config.out_dir.join(&body.run_id);
    let record_path = run_dir.join("run-record.json");
    let record = load_record(&record_path).map_err(|err| {
        ApiError::not_found(format!(
            "no run record for `{}` at {}: {err}",
            body.run_id,
            record_path.display()
        ))
    })?;
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

    let publisher = BackendPublisher::new(
        PublishConfig::from_env(),
        SystemCommandRunner,
        HttpBackendClient::new(state.config.backend_url.clone()),
    );
    let request = PublishRequest {
        record: &record,
        artifacts: &artifacts,
        build_dir: build_dir.as_deref(),
        writeup: &writeup,
    };
    let outcome = publisher
        .publish(&request)
        .await
        .map_err(|err| ApiError::internal(format!("publishing run `{}`: {err}", body.run_id)))?;

    Ok(Json(PublishAck {
        run_id: record.id,
        source_repo: outcome.source_repo,
        playable_build: outcome.playable_build,
        newly_published: outcome.newly_published,
    }))
}

/// Load a run record from its `run-record.json`.
fn load_record(path: &Path) -> Result<RunRecord, String> {
    let text = std::fs::read_to_string(path).map_err(|err| err.to_string())?;
    serde_json::from_str(&text).map_err(|err| err.to_string())
}
