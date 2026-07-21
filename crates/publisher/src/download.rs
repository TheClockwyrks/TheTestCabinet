//! Downloading a run's source tree from the artifact service.
//!
//! A publisher pod has no local checkout: the run it releases was produced by a
//! driver pod long gone, its tree uploaded to the artifact service. So the publisher
//! downloads it back — `GET {artifacts_url}/runs/{run_id}/tree.tar`, the
//! `application/x-tar` archive the driver uploaded (rooted at the run directory's
//! contents: `run-record.json`, the collected `implementation/` tree, and the
//! `events.jsonl`/`raw.jsonl` logs) — and untars it into a scratch directory the
//! release then reads.
//!
//! The download is the one *gated* artifact-service read: it is a server-to-server
//! pull authed by the **per-publish-job token**, which the service forwards to the
//! backend's `POST /publish-jobs/{id}/verify-token`. Because that token was minted
//! for the **publish-job id** (a different UUID from the run/record id in the
//! download path, which is the store key), the publisher sends its publish-job id in
//! the `x-tcab-publish-job-id` header so the service verifies against the right
//! publish job — the publish-path mirror of the driver's `x-tcab-job-id` upload
//! header.

use std::path::{Path, PathBuf};

/// The header the publisher sets to its **publish-job id** on the `tree.tar`
/// download, so the artifact service verifies the per-publish-job token against the
/// right publish job (the path id is the run/record store key, a different UUID).
/// Mirrors the constant the artifact service reads it under.
const PUBLISH_JOB_ID_HEADER: &str = "x-tcab-publish-job-id";

/// A failure downloading or unpacking the run's source tree.
#[derive(Debug, thiserror::Error)]
pub enum DownloadError {
    /// The download request could not be sent (a transport/connection error).
    #[error("downloading the run source tree from the artifact service: {0}")]
    Transport(#[source] reqwest::Error),
    /// The artifact service rejected the download with a non-success status.
    #[error("the artifact service rejected the download: HTTP {status}{}", body_suffix(.body))]
    Status {
        /// The HTTP status the service returned.
        status: reqwest::StatusCode,
        /// The response body, for diagnostics.
        body: String,
    },
    /// The response body could not be read off the wire.
    #[error("reading the downloaded source tree: {0}")]
    Body(#[source] reqwest::Error),
    /// The downloaded archive could not be unpacked into the scratch directory.
    #[error("unpacking the run source tree into `{path}`: {source}")]
    Unpack {
        /// The directory the archive was being unpacked into.
        path: String,
        /// The underlying I/O error.
        #[source]
        source: std::io::Error,
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

/// Download run `run_id`'s source tree from the artifact service at `artifacts_url`
/// and untar it under `{dest}/{run_id}/`, returning that run directory.
///
/// Presents `job_token` (the per-publish-job token) as a bearer credential and
/// sends `publish_job_id` in `PUBLISH_JOB_ID_HEADER` so the service can verify the
/// token against the publish job it was minted for. `run_id` is the **store key**
/// the download URL carries; `publish_job_id` is the **publish-job id** the token
/// authenticates as — a different UUID.
///
/// The archive's entries are relative to the run directory (the layout the driver
/// uploaded and the core resolvers read), so they unpack under the returned
/// `{dest}/{run_id}/` as `run-record.json` + `implementation/` + the logs.
pub async fn download_run_tree(
    artifacts_url: &str,
    run_id: &str,
    publish_job_id: &str,
    job_token: &str,
    dest: &Path,
) -> Result<PathBuf, DownloadError> {
    let url = format!("{}/runs/{}/tree.tar", artifacts_url, run_id);
    let response = reqwest::Client::new()
        .get(&url)
        .bearer_auth(job_token)
        .header(PUBLISH_JOB_ID_HEADER, publish_job_id)
        .send()
        .await
        .map_err(DownloadError::Transport)?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(DownloadError::Status { status, body });
    }
    let bytes = response.bytes().await.map_err(DownloadError::Body)?;

    // The archive root *is* the run directory's contents, so unpack it under a
    // per-run subdirectory to recover `{dest}/{run_id}/run-record.json`,
    // `implementation/`, etc. — the same layout the core resolvers expect.
    let run_dir = dest.join(run_id);
    unpack_tar(&bytes, &run_dir).map_err(|source| DownloadError::Unpack {
        path: run_dir.display().to_string(),
        source,
    })?;
    Ok(run_dir)
}

/// Untar an in-memory `application/x-tar` archive into `dest`, creating it first.
///
/// The archive is uncompressed (the artifact service serves `application/x-tar`, not
/// gzip), so no decompression layer is needed. Entries are unpacked verbatim under
/// `dest`; `tar`'s unpacking already rejects entries that would escape the
/// destination (absolute paths / `..` traversal), so a malformed archive cannot
/// write outside the scratch directory.
fn unpack_tar(bytes: &[u8], dest: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dest)?;
    let mut archive = tar::Archive::new(bytes);
    archive.unpack(dest)
}

#[cfg(test)]
#[path = "download.test.rs"]
mod tests;
