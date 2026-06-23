//! Uploading the produced run tree to the artifact service.
//!
//! A driver pod is ephemeral: the run tree it writes to its scratch `out_dir`
//! (`run-record.json`, the collected `implementation/` with the playable build and
//! proof/asset media, and the `events.jsonl`/`raw.jsonl` logs) is lost when the pod
//! exits. So when an artifact service is configured (`TCAB_ARTIFACTS_URL`), the
//! driver tars `{out_dir}/{id}/` and uploads it to
//! `POST {artifacts_url}/runs/{id}/artifacts`, authed by the **same per-job token**
//! it streams status to the backend with — the artifact service forwards that token
//! to the backend to verify. The upload happens *before* the terminal status is
//! posted, so by the time the console sees the run finish its artifacts are already
//! servable.
//!
//! When `TCAB_ARTIFACTS_URL` is unset (the local CLI/desktop path), nothing here
//! runs and behavior is unchanged — there is no separate artifact service in that
//! topology.

use std::path::Path;

use test_cabinet_core::find_build_output;

/// A failure tarring or uploading the produced run tree.
#[derive(Debug, thiserror::Error)]
pub enum UploadError {
    /// The run directory could not be read or tarred.
    #[error("tarring the run tree at `{path}`: {source}")]
    Tar {
        /// The run directory that could not be archived.
        path: String,
        /// The underlying I/O error.
        #[source]
        source: std::io::Error,
    },
    /// The upload request could not be sent (a transport/connection error).
    #[error("uploading artifacts to the artifact service: {0}")]
    Transport(#[source] reqwest::Error),
    /// The artifact service rejected the upload with a non-success status.
    #[error("the artifact service rejected the upload: HTTP {status}{}", body_suffix(.body))]
    Status {
        /// The HTTP status the service returned.
        status: reqwest::StatusCode,
        /// The response body, for diagnostics.
        body: String,
    },
}

/// Append the body to a status error when there is one to show.
fn body_suffix(body: &str) -> String {
    if body.trim().is_empty() {
        String::new()
    } else {
        format!(": {}", body.trim())
    }
}

/// Tar the run tree at `{out_dir}/{run_id}/` and upload it to the artifact service
/// at `artifacts_url`, presenting `job_token`. The tarball's entries are relative
/// to the run directory (so the service unpacks them under its own
/// `<store-root>/{run_id}/`), matching the layout the core resolvers read.
///
/// Returns once the service has acknowledged the upload (`2xx`). Any failure is
/// surfaced to the caller, which logs it but does not abort the run — the record
/// the run produced is still reported to the backend either way; only its servable
/// artifacts are missing.
pub async fn upload_run_tree(
    artifacts_url: &str,
    run_id: &str,
    out_dir: &Path,
    job_token: &str,
) -> Result<(), UploadError> {
    let run_dir = out_dir.join(run_id);
    // Tar synchronously into memory: a run tree is bounded (source + a static build
    // + a few media clips), so buffering it is fine and keeps the upload a single
    // request the artifact service can verify-then-unpack.
    let tarball = tar_run_dir(&run_dir).map_err(|source| UploadError::Tar {
        path: run_dir.display().to_string(),
        source,
    })?;

    let url = format!("{}/runs/{}/artifacts", artifacts_url, run_id);
    let response = reqwest::Client::new()
        .post(&url)
        .bearer_auth(job_token)
        .header(reqwest::header::CONTENT_TYPE, "application/x-tar")
        .body(tarball)
        .send()
        .await
        .map_err(UploadError::Transport)?;
    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    let body = response.text().await.unwrap_or_default();
    Err(UploadError::Status { status, body })
}

/// Tar `run_dir` into an in-memory archive, with every entry path relative to
/// `run_dir` itself (so the archive root *is* the run directory's contents). The
/// whole tree is walked: `run-record.json`, the `implementation/` build/media, and
/// the `events.jsonl`/`raw.jsonl` logs when present.
fn tar_run_dir(run_dir: &Path) -> Result<Vec<u8>, std::io::Error> {
    let mut builder = tar::Builder::new(Vec::new());
    // `append_dir_all("", run_dir)` archives the directory's *contents* at the
    // archive root (an empty prefix), which is exactly the relative layout the
    // service untars under `<store-root>/{id}/`.
    builder.append_dir_all("", run_dir)?;
    builder.into_inner()
}

/// The root-relative playable-build link for a produced run, when its collected
/// implementation contains a static build. Mirrors what the worker set at list
/// time (`/runs/{id}/build/`): root-relative, so the console prefixes the artifact
/// service base URL it learned from the backend's `/config`. `None` when the run
/// produced no static build (it has nothing to play).
pub fn playable_build_link(out_dir: &Path, run_id: &str) -> Option<String> {
    let impl_dir = out_dir.join(run_id).join("implementation");
    find_build_output(&impl_dir)
        .is_some()
        .then(|| format!("/runs/{run_id}/build/"))
}
