//! Uploading the produced run tree to the artifact service.
//!
//! A driver pod is ephemeral: the run tree it writes to its scratch `out_dir`
//! (`run-record.json`, the collected `implementation/` with the playable build and
//! proof/asset media, and the `events.jsonl`/`raw.jsonl` logs) is lost when the pod
//! exits. So when an artifact service is configured (`TCAB_ARTIFACTS_URL`), the
//! driver tars `{out_dir}/{id}/` and uploads it to
//! `POST {artifacts_url}/runs/{id}/artifacts`, authed by the **same per-job token**
//! it streams status to the backend with — the artifact service forwards that token
//! to the backend to verify. Because that token was minted for the **job id** (a
//! different UUID from the run/record id in the upload path, which is the store
//! key), the driver sends its job id in the `x-tcab-job-id` header so the service
//! verifies against the right job. The upload happens *before* the terminal status
//! is posted, so by the time the console sees the run finish its artifacts are
//! already servable.
//!
//! When `TCAB_ARTIFACTS_URL` is unset (the local CLI/desktop path), nothing here
//! runs and behavior is unchanged — there is no separate artifact service in that
//! topology.

use std::path::Path;

use test_cabinet_core::{BackendClient, HttpBackendClient, RunRecord, find_build_output};

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
/// `run_id` is the **run/record id** — the store key the upload URL carries and the
/// console later addresses media by. `job_id` is the **job id** the per-job token
/// was minted for; the service verifies the token against it (a different UUID from
/// the run id), so it is sent in the `x-tcab-job-id` header rather than the path.
///
/// Returns once the service has acknowledged the upload (`2xx`). Any failure is
/// surfaced to the caller, which logs it but does not abort the run — the record
/// the run produced is still reported to the backend either way; only its servable
/// artifacts are missing.
pub async fn upload_run_tree(
    artifacts_url: &str,
    run_id: &str,
    job_id: &str,
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
        .header("x-tcab-job-id", job_id)
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

/// Upload an adversarial run's controller wasm and proof replays to the **backend
/// store**, keyed by run id — the backend-driven mirror of the CLI/desktop push
/// (`BackendPublisher::upload_adversarial`).
///
/// The backend store is a different place from the artifact service. The arena
/// lists a run's controller as pittable only when the backend holds its
/// `runs/{id}/controller.wasm` (`GET /adversarial/controllers`), and the console
/// fetches a run's proof replays from the backend's `/runs/{id}/asset/{file}`
/// whenever that run was not produced in the *open* console session (the artifact
/// service only serves session-local runs). The CLI uploads both at push from its
/// local `repo_path`; a backend-driven run has no console-side repo to push from, so
/// without this its controller never appears in the arena (Quick Match /
/// tournaments) and its replays 404 on playback (surfacing as "foray-core rejected
/// the replay" once the 404 body is parsed). The files are read from the produced
/// tree the driver still holds at `{out_dir}/{id}/implementation/`.
///
/// Best-effort and driven purely off the produced record: a no-op for a
/// non-adversarial run, and for a forfeit-before-load that emitted no controller and
/// no replays. The backend upload routes are ungated on the private network, so the
/// client carries no token. An individual missing file is skipped (the run is still
/// inspectable); a rejected upload is surfaced so the caller can log it.
pub async fn upload_adversarial_to_backend(
    backend_url: &str,
    record: &RunRecord,
    out_dir: &Path,
) -> test_cabinet_core::Result<()> {
    let Some(adversarial) = record.validation.adversarial.as_ref() else {
        return Ok(());
    };
    let impl_dir = out_dir.join(&record.id).join("implementation");
    let client = HttpBackendClient::new(backend_url);

    // Each opponent's replay is stored under its own run-root-relative filename
    // (`replay.json`, `replay-1.json`, …), matching the CLI push and the
    // `playable::serve_asset_file` the backend serves them back through.
    for replay in &adversarial.replays {
        let Ok(bytes) = std::fs::read(impl_dir.join(&replay.replay_json)) else {
            continue;
        };
        client
            .publish_run_asset(&record.id, &replay.replay_json, bytes)
            .await?;
    }

    // The controller wasm, when the build produced one (a forfeit-before-load run
    // records an empty module path and has nothing to upload).
    if !adversarial.controller_module.is_empty()
        && let Ok(bytes) = std::fs::read(impl_dir.join(&adversarial.controller_module))
    {
        client.publish_run_controller(&record.id, bytes).await?;
    }
    Ok(())
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

#[cfg(test)]
#[path = "artifacts.test.rs"]
mod tests;
