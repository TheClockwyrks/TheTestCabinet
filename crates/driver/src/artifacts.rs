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

    // The controller wasm first. It is the artifact the arena gates a run's
    // pushed-controller listing on (`has_run_controller`), so it must land even if a
    // later — and much larger — replay upload fails; uploading it ahead of the
    // replays keeps a completed run visible in Quick Match / tournaments regardless.
    // A forfeit-before-load run records an empty module path and has nothing to
    // upload.
    if !adversarial.controller_module.is_empty()
        && let Ok(bytes) = std::fs::read(impl_dir.join(&adversarial.controller_module))
    {
        client.publish_run_controller(&record.id, bytes).await?;
    }

    // Then each opponent's replay, stored under its own run-root-relative filename
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
    Ok(())
}

/// Mirror a run's proof-of-implementation media into the **backend store**, keyed by
/// run id — the backend-driven counterpart to the artifact-service tarball upload.
///
/// The backend store is a different place from the artifact service. The artifact
/// service serves a run's proof to the *open* console session it was produced in;
/// but the public static site (and any other host) reads proof from the snapshot
/// the backend exports out of **its own store** (`snapshot::run_proofs` →
/// `store::list_run_proofs`). Nothing else writes that store's `runs/{id}/proof/`
/// dir, so without this a backend-driven run's proof never reaches the snapshot and
/// the published site renders "Proof media is not available here." for every
/// declared proof.
///
/// Each present proof is read from the produced tree at
/// `{out_dir}/{id}/implementation/<dest>` and uploaded under the served file name
/// `<proof-id>.<ext>` — the same `<proof-id>.<ext>` spelling `playable::serve_proof_file`
/// serves and the gallery's `proofMediaUrl` requests, so the snapshot key matches the
/// UI lookup. The extension is derived from the proof's `dest` exactly as the UI's
/// `extensionFor` does (defaulting to `png`); it is cosmetic, since the backend
/// resolves the file by its proof-id stem.
///
/// Best-effort and driven purely off the produced record: a no-op for a run that
/// declares no proofs, and skips any proof the agent did not produce or whose file is
/// unreadable. The backend upload route is ungated on the private network, so the
/// client carries no token. A rejected upload is surfaced so the caller can log it.
pub async fn upload_proofs_to_backend(
    backend_url: &str,
    record: &RunRecord,
    out_dir: &Path,
) -> test_cabinet_core::Result<()> {
    let impl_dir = out_dir.join(&record.id).join("implementation");
    let client = HttpBackendClient::new(backend_url);

    for proof in &record.validation.proofs {
        if !proof.present {
            continue;
        }
        let Ok(bytes) = std::fs::read(impl_dir.join(&proof.dest)) else {
            continue;
        };
        let file = format!(
            "{}.{}",
            proof.id,
            test_cabinet_core::proof_served_extension(&proof.dest),
        );
        client.publish_run_proof(&record.id, &file, bytes).await?;
    }
    Ok(())
}

/// Mirror an asset-generation run's media into the **backend store**, keyed by run
/// id — the asset-gen counterpart to [`upload_proofs_to_backend`], for the same
/// reason: the public snapshot reads a run's asset media from the backend store
/// (`snapshot::run_assets` → `store::read_run_asset`), and nothing else writes that
/// store's `runs/{id}/asset/` dir for an asset-generation run. Without this mirror a
/// backend-driven sprite/sheet run's regenerated image, preview, and action log
/// never reach the snapshot and the published site's asset result view has no media
/// to show.
///
/// Each artifact is read from the produced tree at
/// `{out_dir}/{id}/implementation/<recorded path>` and uploaded under the served
/// names the result view requests — a single sprite's bare
/// `regenerated.png`/`preview.png`/`actions.json` (its one frame), or a sprite
/// sheet's per-frame `regenerated-<index>.png`/`preview-<index>.png`/`actions-<index>.json`
/// — matching `playable::serve_asset_file` and the snapshot exactly so the keys line
/// up with the UI lookup. A voxel run mirrors the same way but carries no
/// regenerated PNG (cheat detection is retired for voxel): each part uploads its
/// `preview.png`/`actions.json` and the per-part `.glb` the 3D client renders (bare
/// for a static model, `mesh-<index>.glb` per part for an animated one).
///
/// A no-op for any non-asset-generation run (an adversarial run's replays are
/// mirrored by [`upload_adversarial_to_backend`] instead). Best-effort: an
/// artifact missing from disk is skipped (the run is still inspectable); a rejected
/// upload is surfaced so the caller can log it. The backend upload route is ungated
/// on the private network, so the client carries no token.
pub async fn upload_assets_to_backend(
    backend_url: &str,
    record: &RunRecord,
    out_dir: &Path,
) -> test_cabinet_core::Result<()> {
    let impl_dir = out_dir.join(&record.id).join("implementation");
    let client = HttpBackendClient::new(backend_url);

    if let Some(asset) = record.validation.asset.as_ref() {
        // A single sprite serves under bare names; a sheet suffixes each frame with
        // `-<index>`, matching `playable::serve_asset_file` and the snapshot.
        let is_sheet = asset.sheet.is_some();
        for frame in &asset.frames {
            let suffix = if is_sheet {
                format!("-{}", frame.index)
            } else {
                String::new()
            };
            let artifacts = [
                (format!("regenerated{suffix}.png"), &frame.regenerated_image),
                (format!("preview{suffix}.png"), &frame.preview_image),
                (format!("actions{suffix}.json"), &frame.actions_log),
            ];
            for (served, rel) in artifacts {
                let Ok(bytes) = std::fs::read(impl_dir.join(rel)) else {
                    continue;
                };
                client.publish_run_asset(&record.id, &served, bytes).await?;
            }
        }
    } else if let Some(voxel) = record.validation.voxel.as_ref() {
        // A voxel run mirrors its parts the same flat way: a static model under
        // bare names (its one part), an animated model suffixing each part with its
        // `-<index>` in declared order — matching `playable::serve_asset_file` and
        // the snapshot. The per-part `.glb` is the geometry the 3D client renders.
        let animated = voxel.model.is_some() || voxel.rig.is_some();
        for (index, part) in voxel.parts.iter().enumerate() {
            let suffix = if animated {
                format!("-{index}")
            } else {
                String::new()
            };
            let artifacts = [
                (format!("preview{suffix}.png"), &part.preview_image),
                (format!("actions{suffix}.json"), &part.ops_log),
                (format!("mesh{suffix}.glb"), &part.mesh),
            ];
            for (served, rel) in artifacts {
                let Ok(bytes) = std::fs::read(impl_dir.join(rel)) else {
                    continue;
                };
                client.publish_run_asset(&record.id, &served, bytes).await?;
            }
        }
    } else if let Some(ui) = record.validation.ui.as_ref() {
        // A UI run mirrors its flattened per-element PNG(s) — single-image under the
        // bare `element.png`, a kit suffixing each element with `-<index>` — plus the
        // `ui.json` manifest (served name == on-disk name). Matches
        // `playable::serve_asset_file` and the snapshot.
        let is_kit = ui.elements.len() > 1;
        let mut artifacts: Vec<(String, String)> =
            vec![("ui.json".to_string(), "ui.json".to_string())];
        for (index, element) in ui.elements.iter().enumerate() {
            let suffix = if is_kit {
                format!("-{index}")
            } else {
                String::new()
            };
            artifacts.push((format!("element{suffix}.png"), element.image.clone()));
        }
        publish_artifacts(&client, &record.id, &impl_dir, artifacts).await?;
    } else if let Some(material) = record.validation.material.as_ref() {
        let mut artifacts: Vec<(String, String)> =
            vec![("material.json".to_string(), "material.json".to_string())];
        for (index, map) in material.maps.iter().enumerate() {
            artifacts.push((format!("map-{index}.png"), map.image.clone()));
        }
        publish_artifacts(&client, &record.id, &impl_dir, artifacts).await?;
    } else if let Some(particle) = record.validation.particle.as_ref() {
        let mut artifacts: Vec<(String, String)> =
            vec![("system.json".to_string(), particle.system.clone())];
        if let Some(preview) = &particle.preview {
            artifacts.push(("preview.gif".to_string(), preview.clone()));
        }
        publish_artifacts(&client, &record.id, &impl_dir, artifacts).await?;
    } else if let Some(audio) = record.validation.audio.as_ref() {
        let mut artifacts: Vec<(String, String)> =
            vec![("clip.wav".to_string(), audio.clip.clone())];
        if let Some(midi) = &audio.midi {
            artifacts.push(("score.mid".to_string(), midi.clone()));
        }
        if let Some(preview) = &audio.preview {
            artifacts.push(("preview.png".to_string(), preview.clone()));
        }
        publish_artifacts(&client, &record.id, &impl_dir, artifacts).await?;
    }
    Ok(())
}

/// Publish a list of `(served-name, run-root-relative on-disk path)` artifacts,
/// skipping any that are missing on disk. Shared by the UI/material/particle/audio
/// mirror branches, whose served name and on-disk `rel` differ.
async fn publish_artifacts(
    client: &HttpBackendClient,
    run_id: &str,
    impl_dir: &Path,
    artifacts: Vec<(String, String)>,
) -> test_cabinet_core::Result<()> {
    for (served, rel) in artifacts {
        let Ok(bytes) = std::fs::read(impl_dir.join(&rel)) else {
            continue;
        };
        client.publish_run_asset(run_id, &served, bytes).await?;
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
