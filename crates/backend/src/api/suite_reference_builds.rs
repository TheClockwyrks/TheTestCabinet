//! The uploaded [reference builds](https://docs.testcabinet.ai/test-suites/reference-implementations/)
//! of an ingested suite version: the upload, the route each build is played at, and
//! the engine-to-URL map the suite and version detail reads carry.
//!
//! The Spec Cabinet builds and verifies a reference implementation on the
//! development machine and uploads the static build here, so ingest stays a copy.
//! The builds are stored beside the suite record (see
//! [`crate::suite_store::reference_builds`]) and served with the content types and
//! index fallback the artifact service uses for a run's `build/`.

#[cfg(test)]
#[path = "suite_reference_builds.test.rs"]
mod tests;

use std::collections::{BTreeMap, BTreeSet};

use axum::Json;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;

use crate::error::ApiError;
use crate::store::DefinitionStore;
use crate::suite_store::StoredSuite;
use crate::suite_store::reference_builds::require_segment;

use super::AppState;

/// The most bytes an uploaded (compressed) build archive may carry.
pub const MAX_REFERENCE_BUILD_UPLOAD_BYTES: usize = 512 * 1024 * 1024;

/// The URL the uploaded build for `engine` of a suite version is played at,
/// relative to the backend. It ends in `/` because it doubles as the build's
/// `<base href>`.
pub fn reference_build_url(slug: &str, version: &str, engine: &str) -> String {
    format!("/suites/{slug}/versions/{version}/reference-builds/{engine}/")
}

/// The engines a suite version's definitions declare, which are the engines a
/// build may be uploaded for.
pub fn declared_engines(record: &StoredSuite) -> BTreeSet<String> {
    record
        .test_cases
        .iter()
        .flat_map(|case| case.definition.engines.iter().cloned())
        .collect()
}

/// The uploaded builds of a suite version among `engines`, keyed by engine, each
/// with the URL it is played at. A build stored for an engine the version no longer
/// declares is left out.
pub fn reference_builds_among<'a>(
    store: &DefinitionStore,
    slug: &str,
    version: &str,
    engines: impl IntoIterator<Item = &'a str>,
) -> Result<BTreeMap<String, String>, ApiError> {
    let wanted: BTreeSet<&str> = engines.into_iter().collect();
    Ok(store
        .list_suite_reference_builds(slug, version)
        .map_err(ApiError::from)?
        .into_iter()
        .filter(|engine| wanted.contains(engine.as_str()))
        .map(|engine| {
            let url = reference_build_url(slug, version, &engine);
            (engine, url)
        })
        .collect())
}

/// `PUT /suites/{slug}/versions/{version}/reference-builds/{engine}` — store a
/// gzipped tar of a static build as the reference build for one engine of an
/// ingested suite version, replacing any previous upload for that engine
/// atomically.
///
/// Refused with `404` for a version the backend has not ingested and `422` for an
/// engine none of the version's definitions declare, each naming the reason. The
/// experimental gate the suite reads apply is not applied here, so a build can be
/// uploaded to a preview. The route carries the authorization `POST /ingest` does.
/// `201` when the engine had no build, `200` when one was replaced.
#[tracing::instrument(name = "suite_reference_build.upload", skip(state, body), err(Debug))]
pub async fn upload(
    State(state): State<AppState>,
    Path((slug, version, engine)): Path<(String, String, String)>,
    body: Body,
) -> Result<Response, ApiError> {
    for segment in [&slug, &version, &engine] {
        require_segment(segment).map_err(ApiError::from)?;
    }
    let record = state
        .store
        .read_suite(&slug, &version)
        .map_err(ApiError::from)?;
    let declared = declared_engines(&record);
    if !declared.contains(&engine) {
        let offered = if declared.is_empty() {
            "it declares no engine".to_string()
        } else {
            let names: Vec<String> = declared.iter().map(|e| format!("`{e}`")).collect();
            format!("it declares {}", names.join(", "))
        };
        return Err(ApiError::unprocessable(format!(
            "engine `{engine}` is not declared by any test case definition of test suite \
             `{slug}@{version}`; {offered}"
        )));
    }

    let spool = state.store.staging_root().join(format!(
        "reference-build-upload-{}.tar.gz",
        cuid2::create_id()
    ));
    let spooled = spool_body(body, &spool).await;
    let stored = match spooled {
        Ok(()) => {
            let store = state.store.clone();
            let (slug, version, engine) = (slug.clone(), version.clone(), engine.clone());
            let path = spool.clone();
            tokio::task::spawn_blocking(move || {
                let replaced = store
                    .suite_reference_build_dir(&slug, &version, &engine)
                    .is_dir();
                let file = std::fs::File::open(&path)?;
                store
                    .store_suite_reference_build(
                        &slug,
                        &version,
                        &engine,
                        std::io::BufReader::new(file),
                    )
                    .map(|()| replaced)
            })
            .await
            .map_err(|err| ApiError::internal(format!("the unpack task failed: {err}")))
            .and_then(|result| result.map_err(ApiError::from))
        }
        Err(err) => Err(err),
    };
    let _ = tokio::fs::remove_file(&spool).await;
    let replaced = stored?;

    tracing::info!(%slug, %version, %engine, replaced, "stored a suite reference build");
    let status = if replaced {
        StatusCode::OK
    } else {
        StatusCode::CREATED
    };
    let out = ReferenceBuildOut {
        url: reference_build_url(&slug, &version, &engine),
        engine,
    };
    Ok((status, Json(out)).into_response())
}

/// Write a request body to `path` as it arrives, refusing it past
/// [`MAX_REFERENCE_BUILD_UPLOAD_BYTES`].
async fn spool_body(body: Body, path: &std::path::Path) -> Result<(), ApiError> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|err| ApiError::internal(format!("creating the upload spool: {err}")))?;
    }
    let mut file = tokio::fs::File::create(path)
        .await
        .map_err(|err| ApiError::internal(format!("creating the upload spool: {err}")))?;
    let mut stream = body.into_data_stream();
    let mut written: usize = 0;
    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.map_err(|err| ApiError::bad_request(format!("reading the upload: {err}")))?;
        written = written.saturating_add(chunk.len());
        if written > MAX_REFERENCE_BUILD_UPLOAD_BYTES {
            return Err(ApiError::new(
                StatusCode::PAYLOAD_TOO_LARGE,
                "payload_too_large",
                format!("the upload exceeds the {MAX_REFERENCE_BUILD_UPLOAD_BYTES} byte limit"),
            ));
        }
        file.write_all(&chunk)
            .await
            .map_err(|err| ApiError::internal(format!("spooling the upload: {err}")))?;
    }
    file.flush()
        .await
        .map_err(|err| ApiError::internal(format!("flushing the upload spool: {err}")))
}

/// `GET /suites/{slug}/versions/{version}/reference-builds/{engine}` (and with a
/// trailing slash) — the build's `index.html`.
pub async fn build_root(
    State(state): State<AppState>,
    Path((slug, version, engine)): Path<(String, String, String)>,
) -> Result<Response, ApiError> {
    serve(&state.store, &slug, &version, &engine, "")
}

/// `GET /suites/{slug}/versions/{version}/reference-builds/{engine}/{*path}` — one
/// file of the build, with a directory resolving to its `index.html`.
pub async fn build_path(
    State(state): State<AppState>,
    Path((slug, version, engine, path)): Path<(String, String, String, String)>,
) -> Result<Response, ApiError> {
    serve(&state.store, &slug, &version, &engine, &path)
}

/// Serve one file of an uploaded build, relocating HTML under the build's URL
/// exactly as the artifact service does for a run's `build/`.
fn serve(
    store: &DefinitionStore,
    slug: &str,
    version: &str,
    engine: &str,
    path: &str,
) -> Result<Response, ApiError> {
    for segment in [slug, version, engine] {
        require_segment(segment).map_err(ApiError::from)?;
    }
    if !store.has_suite_version(slug, version) {
        return Err(ApiError::not_found(format!(
            "test suite `{slug}@{version}` is not ingested"
        )));
    }
    let dir = store.suite_reference_build_dir(slug, version, engine);
    if !dir.is_dir() {
        return Err(ApiError::not_found(format!(
            "no reference build is uploaded for engine `{engine}` of test suite \
             `{slug}@{version}`"
        )));
    }
    let base_href = reference_build_url(slug, version, engine);
    let file =
        test_cabinet_core::playable::serve_build_file(&dir, path, &base_href).ok_or_else(|| {
            ApiError::not_found(format!(
                "no file `{path}` in the `{engine}` reference build of test suite \
                 `{slug}@{version}`"
            ))
        })?;
    Ok(([(header::CONTENT_TYPE, file.content_type)], file.body).into_response())
}

// --- Wire shapes ------------------------------------------------------------

/// `PUT /suites/{slug}/versions/{version}/reference-builds/{engine}` — the stored
/// build.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ReferenceBuildOut {
    /// The engine the build was uploaded for.
    pub engine: String,
    /// The URL the build is played at, relative to the backend.
    pub url: String,
}
