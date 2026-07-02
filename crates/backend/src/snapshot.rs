//! Public snapshot generation and atomic upload (§3 of
//! `design/v0.2.0-contracts.md`).
//!
//! The snapshot is what the **site fetches at build time**. It is regenerated
//! from the full published set on each (coalesced) publish, written under a
//! content-addressed `snapshots/<snapshot-id>/` prefix, and cut over atomically
//! by writing the small top-level `index.json` pointer last. Regenerating the
//! whole set (not deltas) keeps the operation idempotent.
//!
//! This module is split in two: [`SnapshotBuilder`] turns the published runs +
//! case metadata into the set of `(key, bytes, content_type)` objects, and
//! [`upload_snapshot`] PUTs them to R2 in dependency order and fires the deploy
//! hook. The split lets the generation be unit-tested without R2.
//!
//! A run's proof/asset media is read from the local store (where the driver mirrors
//! it at run time), falling back to the artifact service for anything missing — the
//! store is an ephemeral volume in production, so this fallback lets a refresh
//! re-export media to durable R2 even after a restart wiped it (see
//! [`SnapshotBuilder::with_artifacts`]).

use serde::Serialize;
use sha2::{Digest, Sha256};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use time::macros::format_description;

use test_cabinet_core::redact::SecretScrubber;
use test_cabinet_core::run_record::RunRecord;

use crate::db::StoredRun;
use crate::error::{BackendError, Result};
use crate::r2::R2Client;
use crate::store::{DefinitionStore, StoredManifest};

/// The schema version stamped into every snapshot document.
const SCHEMA_VERSION: u32 = 1;

/// One object to upload: its R2 key, bytes, and content type.
#[derive(Debug, Clone, PartialEq)]
pub struct SnapshotObject {
    /// The R2 key (e.g. `snapshots/<id>/runs.json`).
    pub key: String,
    /// The object's bytes.
    pub bytes: Vec<u8>,
    /// The object's content type.
    pub content_type: String,
}

/// A fully generated snapshot: the versioned objects, the top-level `index.json`
/// (uploaded last for the atomic cut-over), and the run count.
#[derive(Debug, Clone)]
pub struct Snapshot {
    /// The snapshot id (timestamp + short hash).
    pub snapshot_id: String,
    /// Objects under the versioned prefix (runs index, per-run, per-case).
    pub objects: Vec<SnapshotObject>,
    /// The top-level `index.json` pointer, uploaded after `objects`.
    pub index: SnapshotObject,
    /// Number of published runs in this snapshot.
    pub run_count: usize,
}

/// Builds a [`Snapshot`] from the published set and the case metadata.
pub struct SnapshotBuilder {
    runs: Vec<StoredRun>,
    cases: Vec<StoredManifest>,
    store: DefinitionStore,
    /// The artifact service's base URL, used to fall back for a run's proof/asset
    /// media when it is absent from the local store. `None` disables the fallback
    /// (store-only) — the dev/single-box default, and what the unit tests use.
    artifacts_url: Option<String>,
    /// The HTTP client for that fallback. Unused when `artifacts_url` is `None`.
    http: reqwest::Client,
}

impl SnapshotBuilder {
    /// Start a builder over the full published run set (newest-first), the
    /// ingested case manifests used to denormalize case names and emit case
    /// metadata files, and the definition store the rendered reference baselines
    /// are read from (so they can be exported alongside the case metadata).
    ///
    /// The artifact-service fallback is off by default; call [`Self::with_artifacts`]
    /// to enable it for a real deployment.
    pub fn new(runs: Vec<StoredRun>, cases: Vec<StoredManifest>, store: DefinitionStore) -> Self {
        Self {
            runs,
            cases,
            store,
            artifacts_url: None,
            http: reqwest::Client::new(),
        }
    }

    /// Enable the artifact-service fallback: when a run's proof/asset media is not in
    /// the local store, the builder fetches it from `artifacts_url` (the artifact
    /// service's public read endpoint) using `http`.
    ///
    /// The backend store that media is normally mirrored into is an ephemeral
    /// emptyDir in production, so it can be wiped between a run finishing and a later
    /// snapshot refresh. The artifact service holds the run tree durably, so this
    /// fallback lets a refresh re-export the media (to durable R2) even after the
    /// store loses it — without it a backend restart would silently drop media from
    /// the published site. A `None` URL leaves behavior store-only.
    pub fn with_artifacts(mut self, artifacts_url: Option<String>, http: reqwest::Client) -> Self {
        self.artifacts_url = artifacts_url;
        self.http = http;
        self
    }

    /// Generate the snapshot. The id is `<rfc3339-compact>-<short-hash>`, where
    /// the hash is over the run ids so a re-run with the same data is stable
    /// enough to debug while never clobbering a prior prefix.
    pub async fn build(&self, generated_at: OffsetDateTime) -> Result<Snapshot> {
        let snapshot_id = self.snapshot_id(generated_at)?;
        let prefix = format!("snapshots/{snapshot_id}");

        let mut objects = Vec::new();

        // The backend's stored runs keep full fidelity for the private console,
        // but this snapshot is published to R2 and served on the open internet.
        // A model that dumped its environment can have printed the run's provider
        // API key into the recorded events or a failure detail, so every per-run
        // document is scrubbed before it is uploaded. The backend never holds a
        // key value, so this redacts by `sk-…` shape (see [`SecretScrubber`]).
        let scrubber = SecretScrubber::new();

        // runs.json — the flat index of summaries (newest first).
        let summaries: Vec<RunSummary> = self.runs.iter().map(|run| self.summary(run)).collect();
        objects.push(json_object(
            format!("{prefix}/runs.json"),
            &RunsIndex {
                schema_version: SCHEMA_VERSION,
                runs: summaries,
            },
        )?);

        // runs/<id>.json — per-run record + review + links, plus the recorded
        // normalized event stream (when captured) so the site can serve the run's
        // Events tab. Raw harness output is never published. The run's uploaded
        // proof media is exported alongside under `runs/<id>/proof/` and named by
        // snapshot-relative key in `proofMedia`; an asset-generation run's media
        // (regenerated/preview image + action log) is exported under
        // `runs/<id>/asset/` and named by snapshot-relative key in `assetMedia`.
        for run in &self.runs {
            let events = run
                .events_json
                .as_deref()
                .map(serde_json::from_str::<serde_json::Value>)
                .transpose()
                .map_err(|e| {
                    BackendError::Snapshot(format!(
                        "parsing stored events for run {}: {e}",
                        run.record.id
                    ))
                })?;
            let (proof_media, proof_objects) = self.run_proofs(&run.record, &prefix).await;
            let (asset_media, asset_objects) = self.run_assets(run, &prefix).await;
            // Serialize the public document, then redact any leaked secret from
            // it (across the record, its events, and any other captured text)
            // before it becomes a snapshot object bound for R2.
            let mut document = serde_json::to_value(PerRun {
                schema_version: SCHEMA_VERSION,
                record: run.record.clone(),
                reviews: run.reviews.iter().map(review_out).collect(),
                links: links_out(&run.links),
                events,
                proof_media,
                asset_media,
            })
            .map_err(|e| {
                BackendError::Snapshot(format!(
                    "serializing published document for run {}: {e}",
                    run.record.id
                ))
            })?;
            if scrubber.scrub_json(&mut document) {
                tracing::warn!(
                    run = %run.record.id,
                    "redacted leaked API key(s) from a published run document"
                );
            }
            objects.push(json_object(
                format!("{prefix}/runs/{}.json", run.record.id),
                &document,
            )?);
            objects.extend(proof_objects);
            objects.extend(asset_objects);
        }

        // cases/<slug>/<version>.json — case metadata, plus the version's rendered
        // reference baselines (PNGs) exported under the case prefix and named by
        // snapshot-relative key in the metadata, so the site can show baselines.
        //
        // Only a version that at least one published run built is emitted. The
        // gallery is a gallery of published runs, so a case with no published run
        // has nothing to show, and the site only ever fetches the case files its
        // runs reference. Emitting exactly those makes the "only cases with a
        // published run appear" behavior explicit at the source — rather than
        // shipping every ingested version and relying on the site to ignore the
        // unreferenced ones — and keeps the snapshot small.
        let versions_with_runs: std::collections::HashSet<(&str, &str)> = self
            .runs
            .iter()
            .map(|run| {
                (
                    run.record.subject.test_case_slug.as_str(),
                    run.record.subject.test_case_version.as_str(),
                )
            })
            .collect();
        for manifest in &self.cases {
            if !versions_with_runs.contains(&(manifest.slug.as_str(), manifest.version.as_str())) {
                continue;
            }
            let (references, reference_objects) = self.case_references(manifest, &prefix);
            objects.push(json_object(
                format!("{prefix}/cases/{}/{}.json", manifest.slug, manifest.version),
                &case_metadata(&self.store, manifest, references)?,
            )?);
            objects.extend(reference_objects);
        }

        let index = json_object(
            "index.json".to_string(),
            &SnapshotIndex {
                schema_version: SCHEMA_VERSION,
                snapshot_id: snapshot_id.clone(),
                generated_at: generated_at
                    .format(&Rfc3339)
                    .map_err(|e| BackendError::Snapshot(format!("formatting generatedAt: {e}")))?,
                run_count: self.runs.len(),
                runs_key: format!("{prefix}/runs.json"),
                runs_prefix: format!("{prefix}/runs/"),
                cases_prefix: format!("{prefix}/cases/"),
            },
        )?;

        Ok(Snapshot {
            snapshot_id,
            objects,
            index,
            run_count: self.runs.len(),
        })
    }

    /// The denormalized summary card for one run.
    fn summary(&self, run: &StoredRun) -> RunSummary {
        let record = &run.record;
        let case_name = self
            .cases
            .iter()
            .find(|c| {
                c.slug == record.subject.test_case_slug
                    && c.version == record.subject.test_case_version
            })
            .map(|c| c.name.clone())
            .unwrap_or_else(|| record.subject.test_case_slug.clone());

        RunSummary {
            id: record.id.clone(),
            // The snapshot only ever contains published runs, so `published_at`
            // is always set; default defensively rather than panic.
            published_at: run.published_at.clone().unwrap_or_default(),
            started_at: record.started_at.clone(),
            finished_at: record.finished_at.clone(),
            subject: SubjectOut::from(record),
            case_name,
            metrics: record.metrics,
            validation_loaded: record.validation.loaded,
            state: record.status.state,
            rating: aggregate_rating(&run.reviews),
            review_count: run.reviews.len(),
            links: links_out(&run.links),
        }
    }

    /// Collect a version's reference baselines: the `references[]` metadata
    /// entries (snapshot-relative keys) and the PNG objects to upload. Common
    /// references render under the `_common` scope and apply to every variant
    /// (`variant: null`); a variant's own references render under its slug scope.
    /// A declared baseline whose PNG is missing from the store is skipped rather
    /// than failing the whole snapshot.
    fn case_references(
        &self,
        manifest: &StoredManifest,
        prefix: &str,
    ) -> (Vec<CaseReferenceOut>, Vec<SnapshotObject>) {
        let (slug, version) = (&manifest.slug, &manifest.version);

        // (store scope, metadata `variant`, the stored reference). Common
        // references carry a null variant; variant-scoped ones carry the variant
        // slug. The stored reference carries its kind and the extension its media
        // is stored under (a rendered mockup is a `.png`; a static reference keeps
        // its own extension).
        let mut declared: Vec<(&str, Option<&str>, &crate::store::StoredReference)> = Vec::new();
        for reference in &manifest.common_references {
            declared.push(("_common", None, reference));
        }
        for variant in &manifest.variants {
            for reference in &variant.references {
                declared.push((&variant.slug, Some(variant.slug.as_str()), reference));
            }
        }

        let mut metas = Vec::new();
        let mut objects = Vec::new();
        for (scope, variant, reference) in declared {
            let view = &reference.view;
            let file = format!("{view}.{}", reference.extension);
            let Ok(bytes) = self.store.read_reference(slug, version, scope, &file) else {
                continue;
            };
            let key = format!("{prefix}/cases/{slug}/{version}/references/{scope}/{file}");
            objects.push(SnapshotObject {
                key: key.clone(),
                bytes,
                content_type: media_content_type(&reference.extension).to_string(),
            });
            metas.push(CaseReferenceOut {
                variant: variant.map(str::to_string),
                view: view.to_string(),
                kind: reference.kind,
                key,
            });
        }
        (metas, objects)
    }

    /// Collect a run's proof media: the `proofMedia[]` metadata entries
    /// (snapshot-relative keys + kind) and the media objects to upload.
    ///
    /// The set of proofs is taken from the run record's `validation.proofs` (the
    /// authoritative declaration), not from whatever happens to be in the store — so
    /// a wiped store still produces the full list, each resolved through the
    /// store-then-artifact-service fallback ([`Self::read_media`]). Each present
    /// proof is served as `<proof-id>.<ext>` (the `<ext>` from its recorded `dest`),
    /// the same name the driver mirror writes and the gallery requests. A proof the
    /// agent did not produce, or whose bytes are in neither place, contributes
    /// nothing.
    async fn run_proofs(
        &self,
        record: &RunRecord,
        prefix: &str,
    ) -> (Vec<RunProofOut>, Vec<SnapshotObject>) {
        let mut metas = Vec::new();
        let mut objects = Vec::new();
        let run_id = &record.id;
        for proof in &record.validation.proofs {
            if !proof.present {
                continue;
            }
            let extension = test_cabinet_core::proof_served_extension(&proof.dest);
            let file = format!("{}.{}", proof.id, extension);
            let Some(bytes) = self.read_media(run_id, "proof", &file).await else {
                continue;
            };
            let key = format!("{prefix}/runs/{run_id}/proof/{file}");
            objects.push(SnapshotObject {
                key: key.clone(),
                bytes,
                content_type: media_content_type(&extension).to_string(),
            });
            metas.push(RunProofOut {
                id: proof.id.clone(),
                kind: proof.kind,
                key,
            });
        }
        (metas, objects)
    }

    /// Collect a run's published media: the `assetMedia[]` metadata entries
    /// (served file name + snapshot-relative key) and the media objects to upload.
    ///
    /// The asset-media plumbing is test-type-agnostic — an `assetMedia[]` entry is
    /// just a `{ file, key }` pair the result view fetches over `/asset/{file}` —
    /// so this branches on the run's type to pick the served names:
    ///
    /// - An **asset-generation** run exports the result view's images and log. A
    ///   single sprite serves under bare names (`regenerated.png`, `preview.png`,
    ///   `actions.json`); a sprite sheet suffixes each frame with `-<index>`
    ///   (`regenerated-<index>.png`, etc.).
    /// - An **adversarial** run exports its browser-playable `replay.json`, which
    ///   the replay player loads through the foray-core wasm renderer (the renderer
    ///   itself ships with the UI/site bundle, not per run, so nothing else is
    ///   exported here).
    ///
    /// Each named file is resolved through the store-then-artifact-service fallback
    /// ([`Self::read_media`]) and skipped if it is in neither. A run that is neither
    /// type contributes nothing.
    async fn run_assets(
        &self,
        run: &StoredRun,
        prefix: &str,
    ) -> (Vec<RunAssetOut>, Vec<SnapshotObject>) {
        let mut metas = Vec::new();
        let mut objects = Vec::new();
        let files: Vec<String> = if let Some(asset) = run.record.validation.asset.as_ref() {
            // A single sprite serves under bare names; a sheet suffixes each frame
            // with `-<index>`, matching `playable::serve_asset_file` and the publisher.
            let is_sheet = asset.sheet.is_some();
            asset
                .frames
                .iter()
                .flat_map(|frame| {
                    let suffix = if is_sheet {
                        format!("-{}", frame.index)
                    } else {
                        String::new()
                    };
                    [
                        format!("regenerated{suffix}.png"),
                        format!("preview{suffix}.png"),
                        format!("actions{suffix}.json"),
                    ]
                })
                .collect()
        } else if let Some(voxel) = run.record.validation.voxel.as_ref() {
            // A voxel run publishes each part's regenerated `voxels.json` (what the
            // 3D viewer renders), the isometric regenerated/preview PNGs, and the
            // op log — a static model under bare names, an animated model suffixing
            // each part with `-<index>`, matching `playable::serve_asset_file` and
            // the driver mirror. The rig itself travels inline in the run record.
            let animated = voxel.model.is_some() || voxel.rig.is_some();
            voxel
                .parts
                .iter()
                .enumerate()
                .flat_map(|(index, _)| {
                    let suffix = if animated {
                        format!("-{index}")
                    } else {
                        String::new()
                    };
                    [
                        format!("regenerated{suffix}.png"),
                        format!("preview{suffix}.png"),
                        format!("actions{suffix}.json"),
                        format!("voxels{suffix}.json"),
                    ]
                })
                .collect()
        } else if run.record.validation.adversarial.is_some() {
            vec!["replay.json".to_string()]
        } else {
            return (metas, objects);
        };
        let run_id = &run.record.id;
        for file in &files {
            let file = file.as_str();
            let Some(bytes) = self.read_media(run_id, "asset", file).await else {
                continue;
            };
            let extension = std::path::Path::new(file)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("");
            let key = format!("{prefix}/runs/{run_id}/asset/{file}");
            objects.push(SnapshotObject {
                key: key.clone(),
                bytes,
                content_type: media_content_type(extension).to_string(),
            });
            metas.push(RunAssetOut {
                file: file.to_string(),
                key,
            });
        }
        (metas, objects)
    }

    /// Resolve one run media file (`kind` is `proof` or `asset`) to its bytes,
    /// preferring the local store and falling back to the artifact service.
    ///
    /// The store is the fast path — the driver mirrors a run's media there at run
    /// time — but it is an ephemeral emptyDir in production, so it may be empty for a
    /// run published before a backend restart. The artifact service holds the run
    /// tree durably and serves it under the same `<kind>/<file>` names, so it backs
    /// the miss. `None` only when the file is in neither place (or the fallback is
    /// disabled) — the caller then omits that media from the snapshot.
    async fn read_media(&self, run_id: &str, kind: &str, file: &str) -> Option<Vec<u8>> {
        let from_store = match kind {
            "proof" => self.store.read_run_proof(run_id, file),
            _ => self.store.read_run_asset(run_id, file),
        };
        if let Ok(bytes) = from_store {
            return Some(bytes);
        }
        self.fetch_artifact(run_id, kind, file).await
    }

    /// Fetch one run media file from the artifact service's public read endpoint
    /// (`GET {artifacts_url}/runs/{run_id}/{kind}/{file}`), or `None` when the
    /// fallback is disabled (`artifacts_url` unset), the file is absent (404), or the
    /// request fails. A non-404 failure is logged — it means the durable copy could
    /// not be read, so the media will be missing from the snapshot until the next
    /// refresh.
    async fn fetch_artifact(&self, run_id: &str, kind: &str, file: &str) -> Option<Vec<u8>> {
        let base = self.artifacts_url.as_deref()?;
        let url = format!("{base}/runs/{run_id}/{kind}/{file}");
        match self.http.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => match resp.bytes().await {
                Ok(bytes) => Some(bytes.to_vec()),
                Err(err) => {
                    tracing::warn!(run.id = run_id, %url, error = %err, "reading artifact media body failed");
                    None
                }
            },
            Ok(resp) if resp.status() == reqwest::StatusCode::NOT_FOUND => None,
            Ok(resp) => {
                tracing::warn!(run.id = run_id, %url, status = %resp.status(), "artifact media fetch failed");
                None
            }
            Err(err) => {
                tracing::warn!(run.id = run_id, %url, error = %err, "artifact media request failed");
                None
            }
        }
    }

    /// Compute the snapshot id: a compact RFC-3339 timestamp plus a short hash of
    /// the run ids, so a new snapshot never collides with a prior prefix.
    fn snapshot_id(&self, generated_at: OffsetDateTime) -> Result<String> {
        let compact = format_description!("[year]-[month]-[day]T[hour][minute]Z");
        let stamp = generated_at
            .format(&compact)
            .map_err(|e| BackendError::Snapshot(format!("formatting snapshot id: {e}")))?;
        let mut hasher = Sha256::new();
        for run in &self.runs {
            hasher.update(run.record.id.as_bytes());
            hasher.update(b"\n");
        }
        let short = hex::encode(hasher.finalize());
        Ok(format!("{stamp}-{}", &short[..8]))
    }
}

/// A best-effort content type for reference/proof/asset media from its extension.
fn media_content_type(extension: &str) -> &'static str {
    match extension.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "mp4" => "video/mp4",
        "json" => "application/json",
        _ => "application/octet-stream",
    }
}

/// Serialize a value to a pretty JSON [`SnapshotObject`].
fn json_object<T: Serialize>(key: String, value: &T) -> Result<SnapshotObject> {
    Ok(SnapshotObject {
        key,
        bytes: serde_json::to_vec_pretty(value)?,
        content_type: "application/json".to_string(),
    })
}

/// Upload a generated snapshot to R2 and fire the site deploy hook.
///
/// Objects are uploaded under the versioned prefix first; the top-level
/// `index.json` pointer is written **last** so the cut-over is atomic — a site
/// build reading `index.json` always follows it to a complete prefix. The deploy
/// hook fires only after a successful upload. Returns whether the hook fired.
pub async fn upload_snapshot(
    snapshot: &Snapshot,
    r2: &R2Client,
    deploy_hook_url: Option<&str>,
    http: &reqwest::Client,
) -> Result<bool> {
    for object in &snapshot.objects {
        r2.put_object(&object.key, object.bytes.clone(), &object.content_type)
            .await?;
    }
    // index.json last: this single small overwrite is the atomic cut-over.
    r2.put_object(
        &snapshot.index.key,
        snapshot.index.bytes.clone(),
        &snapshot.index.content_type,
    )
    .await?;

    let mut fired = false;
    if let Some(url) = deploy_hook_url {
        let response = http
            .post(url)
            .send()
            .await
            .map_err(|e| BackendError::Snapshot(format!("firing deploy hook: {e}")))?;
        if !response.status().is_success() {
            let status = response.status();
            return Err(BackendError::Snapshot(format!(
                "deploy hook returned {status}"
            )));
        }
        fired = true;
    }
    Ok(fired)
}

// --- Wire shapes (§3) -------------------------------------------------------

/// The top-level snapshot pointer (`index.json`): where the runs index, per-run
/// documents, and case documents live under this snapshot's prefix.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct SnapshotIndex {
    pub schema_version: u32,
    pub snapshot_id: String,
    pub generated_at: String,
    pub run_count: usize,
    pub runs_key: String,
    pub runs_prefix: String,
    pub cases_prefix: String,
}

/// The flat index of run summary cards (`runs.json`), newest first.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct RunsIndex {
    pub schema_version: u32,
    pub runs: Vec<RunSummary>,
}

/// The denormalized summary card for one published run.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct RunSummary {
    pub id: String,
    pub published_at: String,
    pub started_at: String,
    pub finished_at: String,
    pub subject: SubjectOut,
    pub case_name: String,
    pub metrics: test_cabinet_core::metrics::RunMetrics,
    pub validation_loaded: bool,
    pub state: test_cabinet_core::run_record::RunState,
    /// The run's overall rating: the worst rating any reviewer gave any domain.
    pub rating: test_cabinet_core::review::Rating,
    /// How many reviews the run carries. The site averages their scores; the
    /// aggregate sits between the harshest and most generous review.
    pub review_count: usize,
    pub links: LinksOut,
}

/// The run subject as a summary card carries it (the slug enum, not a string).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct SubjectOut {
    pub test_case_slug: String,
    pub test_case_version: String,
    pub variant: String,
    pub harness_slug: test_cabinet_core::run_record::HarnessSlug,
    pub harness_version: Option<String>,
    pub model_id: String,
}

impl SubjectOut {
    fn from(record: &RunRecord) -> Self {
        Self {
            test_case_slug: record.subject.test_case_slug.clone(),
            test_case_version: record.subject.test_case_version.clone(),
            variant: record.subject.variant.clone(),
            harness_slug: record.subject.harness_slug,
            harness_version: record.subject.harness_version.clone(),
            model_id: record.subject.model_id.clone(),
        }
    }
}

/// A per-run document (`runs/<id>.json`): the run record, its reviews and links,
/// the recorded event stream, and the snapshot-relative keys of its media.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PerRun {
    pub schema_version: u32,
    pub record: RunRecord,
    /// The run's reviews, oldest first. The site averages their scores and takes
    /// the worst rating across them; each entry names its reviewer.
    pub reviews: Vec<Review>,
    pub links: LinksOut,
    /// The run's recorded normalized event stream (a JSON array), omitted when the
    /// run captured none. The site emits this as a per-run static asset its Events
    /// tab fetches; raw harness output is never included.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional, type = "unknown"))]
    pub events: Option<serde_json::Value>,
    /// The run's uploaded proof-of-implementation media, named by snapshot-relative
    /// key. Empty when the run produced none.
    pub proof_media: Vec<RunProofOut>,
    /// An asset-generation run's media (regenerated/preview image + action log),
    /// named by snapshot-relative key. Empty for a non-asset-generation run.
    pub asset_media: Vec<RunAssetOut>,
}

/// A proof media file exposed in a per-run document. `id` matches the proof's
/// declared id (and its `validation.proofs[].id`); `kind` is image or video;
/// `key` is the snapshot-relative object key of the media.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct RunProofOut {
    pub id: String,
    pub kind: test_cabinet_core::MediaKind,
    pub key: String,
}

/// An asset-generation media file exposed in a per-run document. `file` is the
/// stable served name the result view requests — a single sprite's
/// `regenerated.png`/`preview.png`/`actions.json` or a sprite sheet's per-frame
/// `regenerated-<index>.png` (etc.); `key` is its snapshot-relative object key.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct RunAssetOut {
    pub file: String,
    pub key: String,
}

/// One published review on a run: the reviewer's public identity, their per-domain
/// ratings, the writeup, and their checklist verdicts. This is the canonical
/// review wire shape (`backend-api/review.schema.json`), referenced by the per-run
/// snapshot document.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "contract",
    derive(ts_rs::TS, schemars::JsonSchema),
    ts(rename = "Review"),
    schemars(rename = "Review")
)]
pub struct Review {
    /// The reviewing account's id (stable across their reviews).
    pub reviewer_id: String,
    /// The reviewer's display name, shown beside their review.
    pub reviewer: String,
    /// The reviewer's rating for each scoring domain. This review's overall
    /// rating is the worst across them.
    pub ratings: Vec<test_cabinet_core::review::DomainRating>,
    pub writeup: String,
    pub checklist: Vec<test_cabinet_core::review::ReviewVerdict>,
    /// RFC 3339 of when the review was submitted.
    pub reviewed_at: String,
}

/// Map a stored review to its snapshot wire shape, exposing the reviewer's
/// public identity (id + display name) but never any account internals.
fn review_out(review: &crate::db::StoredReview) -> Review {
    Review {
        reviewer_id: review.reviewer.user_id.clone(),
        reviewer: review.reviewer.display_name.clone(),
        ratings: review.ratings.clone(),
        writeup: review.writeup.clone(),
        checklist: review.checklist.clone(),
        reviewed_at: review.reviewed_at.clone(),
    }
}

/// A run's outbound links as the snapshot carries them.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LinksOut {
    pub source_repo: Option<String>,
    pub playable_build: Option<String>,
}

/// A case-metadata document (`cases/<slug>/<version>.json`): the site-facing slice
/// of one ingested version — its identity, variants (with rendered prompts),
/// checks, reference baselines, reviewer checklist, and scoring domains.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CaseMetadata {
    pub schema_version: u32,
    pub slug: String,
    pub version: String,
    pub name: String,
    pub difficulty: String,
    pub tags: Vec<String>,
    pub summary: Option<String>,
    pub description: Option<String>,
    pub variants: Vec<CaseVariantOut>,
    /// The seeded spec files shared by every variant, with their bodies inlined so
    /// the static gallery's Inputs tab can show them without a live backend. A
    /// variant's own additive specs ride on [`CaseVariantOut::seeded_inputs`]; the
    /// site concatenates the two (common first) exactly as a run is seeded.
    pub common_seeded_inputs: Vec<CaseSeededInputOut>,
    pub checks: Vec<CaseCheckOut>,
    /// Rendered reference baselines, named by snapshot-relative key. The site
    /// resolves these to absolute URLs to show baselines on the References tab.
    pub references: Vec<CaseReferenceOut>,
    /// Reviewer checklist items shared by every variant, carrying their point
    /// weights so the site can compute run scores. A variant's own items ride on
    /// [`CaseVariantOut::review_items`].
    pub common_review_items: Vec<CaseReviewItemOut>,
    /// The case's scoring domains, rated independently; the overall rating is the
    /// worst across them.
    pub domains: Vec<CaseDomainOut>,
}

/// A reference baseline exposed in case metadata. `variant` is `null` for a
/// common reference (shown on every variant) or the variant slug for one scoped
/// to a single variant; `kind` is how it is produced (rendered/image/video); `key`
/// is the snapshot-relative object key of the media.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CaseReferenceOut {
    pub variant: Option<String>,
    pub view: String,
    pub kind: test_cabinet_core::ReferenceKind,
    pub key: String,
}

/// One variant of a case as the gallery shows it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CaseVariantOut {
    pub slug: String,
    pub name: String,
    pub description: Option<String>,
    /// The variant's prompt, rendered as a real run receives it, so the public
    /// gallery's Specifications tab shows the instruction the model was handed.
    pub prompt: String,
    /// The variant's own seeded spec files (additive to the common ones), with
    /// their bodies inlined so the static gallery shows the exact specs a run of
    /// this variant is seeded with.
    pub seeded_inputs: Vec<CaseSeededInputOut>,
    /// Reviewer checklist items additive to the common ones, with their point
    /// weights, surfaced only when this variant is selected.
    pub review_items: Vec<CaseReviewItemOut>,
    /// Scoring domains additive to the case's common ones, rated only when this
    /// variant is selected. The site rates and scores a run against the common
    /// domains plus its variant's own.
    pub domains: Vec<CaseDomainOut>,
}

/// A seeded spec file exposed in case metadata: the run-workspace path it lands at
/// and its inlined text body. This is the same set the console's Specifications tab
/// fetches per file — the common specs then the variant's own, in seed order — but
/// inlined here so the fully static site needs no backend to show them. Only text
/// specs are carried; a spec whose bytes are missing or not valid UTF-8 is omitted.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CaseSeededInputOut {
    /// The run-workspace-relative path the spec is seeded to (its `dest`).
    pub path: String,
    /// The spec's inlined text body.
    pub text: String,
}

/// A reviewer checklist item exposed in case metadata, carrying its point weight
/// and optional scoring domain so the site can compute and break down run scores.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CaseReviewItemOut {
    pub id: String,
    pub title: String,
    pub text: String,
    pub reference: Option<String>,
    pub proof: Option<String>,
    pub sequences: Vec<String>,
    pub frames: Vec<u32>,
    pub weight: u32,
    pub domain: Option<String>,
}

/// A scoring domain exposed in case metadata.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CaseDomainOut {
    pub id: String,
    pub name: String,
    pub description: String,
}

/// A declared validation check exposed in case metadata.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CaseCheckOut {
    pub view: String,
    pub name: String,
    pub reference_view: String,
}

/// Read a set of seeded specs' inlined bodies from the store, in order. Each spec's
/// `source` (a store-relative artifact key) is read and decoded as UTF-8 text; a
/// spec whose bytes are missing (e.g. an ephemeral store not yet re-ingested) or
/// not valid UTF-8 is skipped rather than failing the whole snapshot, mirroring how
/// a missing reference baseline is skipped.
fn seeded_inputs(
    store: &DefinitionStore,
    slug: &str,
    version: &str,
    specs: &[crate::store::StoredSpec],
) -> Vec<CaseSeededInputOut> {
    specs
        .iter()
        .filter_map(|spec| {
            let bytes = store.read_artifact(slug, version, &spec.source).ok()?;
            let text = String::from_utf8(bytes).ok()?;
            Some(CaseSeededInputOut {
                path: spec.dest.clone(),
                text,
            })
        })
        .collect()
}

/// Build the case-metadata document for one ingested version (no mockup HTML, no
/// host paths — only the site-facing slice). Each variant's prompt is rendered
/// exactly as a run receives it, so the public gallery shows the same instruction
/// the consoles do, and the seeded spec files it references are inlined (bodies
/// read from `store`) so the fully static site can show them without a backend.
fn case_metadata(
    store: &DefinitionStore,
    manifest: &StoredManifest,
    references: Vec<CaseReferenceOut>,
) -> Result<CaseMetadata, BackendError> {
    let common_seeded_inputs = seeded_inputs(
        store,
        &manifest.slug,
        &manifest.version,
        &manifest.common_specs,
    );
    let variants = manifest
        .variants
        .iter()
        .map(|v| {
            let spec_dests: Vec<String> = manifest
                .common_specs
                .iter()
                .chain(v.specs.iter())
                .map(|spec| spec.dest.clone())
                .collect();
            let prompt = test_cabinet_core::render_prompt_from_template(
                &manifest.slug,
                &manifest.version,
                &manifest.prompt_template,
                &v.slug,
                &v.name,
                v.description.as_deref(),
                &spec_dests,
                manifest.test_type,
            )
            .map_err(|e| {
                BackendError::Snapshot(format!(
                    "rendering prompt for `{}@{}` variant `{}`: {e}",
                    manifest.slug, manifest.version, v.slug
                ))
            })?;
            Ok(CaseVariantOut {
                slug: v.slug.clone(),
                name: v.name.clone(),
                description: v.description.clone(),
                prompt,
                seeded_inputs: seeded_inputs(store, &manifest.slug, &manifest.version, &v.specs),
                review_items: v.review_items.iter().map(case_review_item_out).collect(),
                domains: v.domains.iter().map(case_domain_out).collect(),
            })
        })
        .collect::<Result<Vec<_>, BackendError>>()?;

    Ok(CaseMetadata {
        schema_version: SCHEMA_VERSION,
        slug: manifest.slug.clone(),
        version: manifest.version.clone(),
        name: manifest.name.clone(),
        difficulty: manifest.difficulty.clone(),
        tags: manifest.tags.clone(),
        summary: manifest.summary.clone(),
        description: manifest.description.clone(),
        variants,
        common_seeded_inputs,
        checks: manifest
            .checks
            .iter()
            .map(|c| CaseCheckOut {
                view: c.view.clone(),
                name: c.name.clone(),
                reference_view: c.reference_view.clone(),
            })
            .collect(),
        references,
        common_review_items: manifest
            .common_review_items
            .iter()
            .map(case_review_item_out)
            .collect(),
        domains: manifest.domains.iter().map(case_domain_out).collect(),
    })
}

/// Map a stored scoring domain to its case-metadata wire shape. Shared by the
/// case's common domains and each variant's own.
fn case_domain_out(domain: &crate::store::StoredDomain) -> CaseDomainOut {
    CaseDomainOut {
        id: domain.id.clone(),
        name: domain.name.clone(),
        description: domain.description.clone(),
    }
}

/// Map a stored reviewer checklist item to its case-metadata wire shape, carrying
/// its point weight and optional domain.
fn case_review_item_out(item: &crate::store::StoredReviewItem) -> CaseReviewItemOut {
    CaseReviewItemOut {
        id: item.id.clone(),
        title: item.title.clone(),
        text: item.text.clone(),
        reference: item.reference.clone(),
        proof: item.proof.clone(),
        sequences: item.sequences.clone(),
        frames: item.frames.clone(),
        weight: item.weight,
        domain: item.domain.clone(),
    }
}

/// A run's outbound links in the snapshot wire shape (owned).
fn links_out(links: &test_cabinet_core::RunLinks) -> LinksOut {
    LinksOut {
        source_repo: links.source_repo.clone(),
        playable_build: links.playable_build.clone(),
    }
}

/// The run's overall rating — the worst rating any reviewer gave any domain.
/// Falls back to [`Rating::Broken`] for the (publish-gated, so unreachable) case
/// of no reviews, so the runs index always carries a tier.
fn aggregate_rating(reviews: &[crate::db::StoredReview]) -> test_cabinet_core::review::Rating {
    aggregate_rating_inner(reviews).unwrap_or(test_cabinet_core::review::Rating::Broken)
}

/// The aggregate rating, or `None` when the run carries no reviews.
fn aggregate_rating_inner(
    reviews: &[crate::db::StoredReview],
) -> Option<test_cabinet_core::review::Rating> {
    test_cabinet_core::review::aggregate_rating(
        reviews.iter().map(|review| review.ratings.as_slice()),
    )
}

#[cfg(test)]
#[path = "snapshot.test.rs"]
mod tests;
