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
//! A run's proof/asset media lives under the content-stable [`MEDIA_PREFIX`]
//! (`media/runs/<id>/…`), outside any single snapshot's prefix, and is written once:
//! a refresh that finds an object already there references it without touching the
//! source bytes (see [`SnapshotBuilder::with_existing_media`]). Only media not yet in
//! the bucket is read from the local store (where the driver mirrors it at run time),
//! falling back to the artifact service for anything missing — the store is an
//! ephemeral volume in production, so this fallback lets a refresh export new media to
//! durable R2 even after a restart wiped it (see [`SnapshotBuilder::with_artifacts`]).

use serde::Serialize;
use sha2::{Digest, Sha256};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use time::macros::format_description;

use test_cabinet_core::redact::SecretScrubber;
use test_cabinet_core::run_record::RunRecord;

use crate::api::ModelOut;
use crate::db::StoredRun;
use crate::error::{BackendError, Result};
use crate::r2::R2Client;
use crate::store::{DefinitionStore, StoredManifest};

/// The schema version stamped into every snapshot document.
const SCHEMA_VERSION: u32 = 1;

/// The bucket prefix a run's proof/asset media is stored under, **outside** any
/// single snapshot's `snapshots/<id>/` prefix. A published run's media is immutable,
/// so it is keyed by the run id (not the snapshot id) and written **once**: every
/// subsequent snapshot references the same `media/runs/<id>/<kind>/<file>` object
/// rather than re-reading and re-uploading it. This is what stops each refresh from
/// re-exporting (and, for a video, re-transcoding) every run's media — the growing
/// cost as asset-generation runs accumulate — and lets a refresh keep a run's media
/// even when the ephemeral store and the artifact service have both lost the bytes
/// (as after a cluster recreate): if the object already exists here, the builder
/// references it without needing the source bytes at all.
const MEDIA_PREFIX: &str = "media/runs";

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
    /// The composed model catalog exported alongside the runs, so the public site
    /// renders the Models section from the snapshot. Empty by default.
    models: Vec<ModelOut>,
    /// The reference-implementation URLs to fold onto each case's variants, keyed by
    /// `(slug, version)` → (variant slug → served URL). Written out-of-band into the
    /// `case_reference_build` table (via `tcab publish-reference`) and read from the
    /// database, not the store — so they are supplied here rather than derived from a
    /// manifest. Empty by default (a `(slug, version)` absent from the map, or a
    /// variant absent from its inner map, simply exports `referenceBuild: null`).
    reference_builds:
        std::collections::HashMap<(String, String), std::collections::HashMap<String, String>>,
    /// The set of media object keys (`media/runs/<id>/<kind>/<file>`) already present
    /// in the bucket, so the builder references an existing media object rather than
    /// re-reading and re-uploading its bytes. Populated from the bucket before a real
    /// refresh (see [`Self::with_existing_media`]); empty by default, which makes the
    /// builder upload every run's media as it did before this optimization — the
    /// correct behavior for the dev/single-box path (no R2) and the unit tests.
    existing_media: std::collections::HashSet<String>,
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
            models: Vec::new(),
            reference_builds: std::collections::HashMap::new(),
            existing_media: std::collections::HashSet::new(),
        }
    }

    /// Supply the set of media object keys already present in the bucket (from
    /// [`R2Client::list_keys`](crate::r2::R2Client::list_keys) over [`MEDIA_PREFIX`]).
    /// For any run-media object whose stable key is in this set, the builder emits the
    /// snapshot metadata pointing at it but does **not** read the source bytes or
    /// re-upload it — so unchanged media is exported exactly once across all snapshots,
    /// and a run keeps its media even when the source bytes are no longer available.
    pub fn with_existing_media(
        mut self,
        existing_media: std::collections::HashSet<String>,
    ) -> Self {
        self.existing_media = existing_media;
        self
    }

    /// Set the composed model catalog to export in this snapshot's `models.json`.
    pub fn with_models(mut self, models: Vec<ModelOut>) -> Self {
        self.models = models;
        self
    }

    /// Supply the reference-implementation URLs to fold onto each case's variants,
    /// keyed by `(slug, version)` → (variant slug → served URL). These come from the
    /// `case_reference_build` table (read by the caller from the database), not from
    /// any manifest — the URL of a variant's authored, deployed correct build is
    /// recorded out-of-band by `tcab publish-reference`. A `(slug, version)` or
    /// variant absent from the map exports `referenceBuild: null`.
    pub fn with_reference_builds(
        mut self,
        reference_builds: std::collections::HashMap<
            (String, String),
            std::collections::HashMap<String, String>,
        >,
    ) -> Self {
        self.reference_builds = reference_builds;
        self
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
        // Events tab. Raw harness output is never published. The run's uploaded proof
        // media is named by snapshot-relative key in `proofMedia`, and an
        // asset-generation run's media (regenerated/preview image + action log) in
        // `assetMedia`. That media lives under the content-stable `media/runs/<id>/…`
        // prefix (NOT this snapshot's prefix), uploaded once and shared across
        // snapshots — see [`MEDIA_PREFIX`] and [`SnapshotBuilder::with_existing_media`].
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
            let (proof_media, proof_objects) = self.run_proofs(&run.record).await;
            let (asset_media, asset_objects) = self.run_assets(run).await;
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
            let variant_reference_builds = self
                .reference_builds
                .get(&(manifest.slug.clone(), manifest.version.clone()));
            objects.push(json_object(
                format!("{prefix}/cases/{}/{}.json", manifest.slug, manifest.version),
                &case_metadata(&self.store, manifest, references, variant_reference_builds)?,
            )?);
            objects.extend(reference_objects);
        }

        // models.json — the composed model catalog (curated ⋃ derived-from-runs,
        // with price history), so the public site renders the Models section from
        // the snapshot rather than a bundled dataset.
        objects.push(json_object(
            format!("{prefix}/models.json"),
            &ModelCatalogFile {
                schema_version: SCHEMA_VERSION,
                models: self.models.clone(),
            },
        )?);

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
                models_key: format!("{prefix}/models.json"),
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
    ///
    /// This wraps [`RunSummary::from_stored`] and overrides only the fields the
    /// snapshot resolves differently from the bare stored run: `case_name` comes
    /// from the ingested case catalog (falling back to the slug), `score` is the
    /// aggregate reviewer score computed against that catalog entry's checklist
    /// weights, and the snapshot only ever holds reviewed runs so `rating` is
    /// always `Some`.
    fn summary(&self, run: &StoredRun) -> RunSummary {
        let record = &run.record;
        let manifest = self.cases.iter().find(|c| {
            c.slug == record.subject.test_case_slug && c.version == record.subject.test_case_version
        });
        let case_name = manifest
            .map(|c| c.name.clone())
            .unwrap_or_else(|| record.subject.test_case_slug.clone());
        // Score from the same catalog entry that names the case; both are absent
        // for a run whose case isn't in the ingested set.
        let score =
            manifest.and_then(|m| run_summary_score(m, &record.subject.variant, &run.reviews));

        RunSummary {
            case_name,
            // The per-domain rating, or `None` for a game jam (it carries no
            // domains — its badge is `score.overallGrade` instead). A domain-scored
            // published run always has one.
            rating: aggregate_rating_inner(&run.reviews),
            score,
            ..RunSummary::from_stored(run)
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
    /// store-then-artifact-service fallback ([`Self::read_media`]). A proof the
    /// agent did not produce, or whose bytes are in neither place, contributes
    /// nothing.
    ///
    /// A **video** proof is published as `<proof-id>.mp4`, transcoded here from the
    /// `.webm` a run captures natively (see [`transcode_webm_to_mp4`]) so the public
    /// gallery plays on every browser — webm/VP8 does not on iOS/Safari. An **image**
    /// proof is published under its recorded extension unchanged. Either way the
    /// published name matches [`proof_published_extension`], which the gallery keys
    /// its snapshot lookup off. If the clip is already `.mp4` in the store (a legacy
    /// capture, or a re-run snapshot) it is used as-is; only a raw `.webm` is
    /// transcoded, and a transcode that fails falls back to serving the webm so the
    /// proof still appears rather than vanishing.
    async fn run_proofs(&self, record: &RunRecord) -> (Vec<RunProofOut>, Vec<SnapshotObject>) {
        let mut metas = Vec::new();
        let mut objects = Vec::new();
        let run_id = &record.id;
        for proof in &record.validation.proofs {
            if !proof.present {
                continue;
            }
            let published_ext =
                test_cabinet_core::proof_published_extension(proof.kind, &proof.dest);
            let published_file = format!("{}.{}", proof.id, published_ext);
            // The stable, snapshot-independent key this proof is published under. When
            // it is already in the bucket, reference it without touching the source
            // bytes — no store/artifact read, and (for a video) no re-transcode.
            let published_key = format!("{MEDIA_PREFIX}/{run_id}/proof/{published_file}");
            if self.existing_media.contains(&published_key) {
                metas.push(RunProofOut {
                    id: proof.id.clone(),
                    kind: proof.kind,
                    key: published_key,
                });
                continue;
            }

            // Prefer a copy already at the published extension (an image, or a clip
            // that is already mp4); otherwise pull the raw webm and transcode it.
            let (file, extension, bytes) = if let Some(bytes) =
                self.read_media(run_id, "proof", &published_file).await
            {
                (published_file, published_ext, bytes)
            } else if proof.kind == test_cabinet_core::MediaKind::Video {
                let served_ext = test_cabinet_core::proof_served_extension(&proof.dest);
                let served_file = format!("{}.{}", proof.id, served_ext);
                let Some(raw) = self.read_media(run_id, "proof", &served_file).await else {
                    continue;
                };
                match transcode_webm_to_mp4(&raw).await {
                    Some(mp4) => (published_file, published_ext, mp4),
                    None => {
                        tracing::warn!(
                            run_id = %run_id,
                            proof = %proof.id,
                            "webm→mp4 transcode unavailable; publishing raw webm (not iOS-playable)"
                        );
                        (served_file, served_ext, raw)
                    }
                }
            } else {
                continue;
            };

            // Key by the produced file name (the transcode-fallback path can publish
            // the raw webm under its served name rather than the mp4 published name).
            let key = format!("{MEDIA_PREFIX}/{run_id}/proof/{file}");
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
    async fn run_assets(&self, run: &StoredRun) -> (Vec<RunAssetOut>, Vec<SnapshotObject>) {
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
            // A voxel run publishes each part's per-part `.glb` (what the 3D viewer
            // renders), the model's own isometric preview PNG, and the op log — a
            // static model under bare names, an animated model suffixing each part
            // with `-<index>`, matching `playable::serve_asset_file` and the driver
            // mirror. Cheat detection is retired for voxel, so there is no regenerated
            // PNG. The rig itself travels inline in the run record.
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
                        format!("preview{suffix}.png"),
                        format!("actions{suffix}.json"),
                        format!("mesh{suffix}.glb"),
                    ]
                })
                .collect()
        } else if let Some(ui) = run.record.validation.ui.as_ref() {
            // A UI run publishes its flattened per-element PNG(s) — a single-image
            // case under the bare `element.png`, a kit suffixing each element with
            // `-<index>` — plus the `ui.json` manifest. Matches
            // `playable::serve_asset_file` and the driver mirror.
            let is_kit = ui.elements.len() > 1;
            std::iter::once("ui.json".to_string())
                .chain(ui.elements.iter().enumerate().map(|(index, _)| {
                    let suffix = if is_kit {
                        format!("-{index}")
                    } else {
                        String::new()
                    };
                    format!("element{suffix}.png")
                }))
                .collect()
        } else if let Some(material) = run.record.validation.material.as_ref() {
            // Each map by its declared index (always suffixed) plus `material.json`.
            std::iter::once("material.json".to_string())
                .chain(
                    material
                        .maps
                        .iter()
                        .enumerate()
                        .map(|(index, _)| format!("map-{index}.png")),
                )
                .collect()
        } else if let Some(particle) = run.record.validation.particle.as_ref() {
            // The authored `system.json` plus, when rendered, the preview GIF.
            let mut files = vec!["system.json".to_string()];
            if particle.preview.is_some() {
                files.push("preview.gif".to_string());
            }
            files
        } else if let Some(audio) = run.record.validation.audio.as_ref() {
            // The rendered `clip.wav`, the portable `score.mid` (music), and the
            // waveform/spectrogram preview PNG.
            let mut files = vec!["clip.wav".to_string()];
            if audio.midi.is_some() {
                files.push("score.mid".to_string());
            }
            if audio.preview.is_some() {
                files.push("preview.png".to_string());
            }
            files
        } else if run.record.validation.adversarial.is_some() {
            vec!["replay.json".to_string()]
        } else {
            return (metas, objects);
        };
        let run_id = &run.record.id;
        for file in &files {
            let file = file.as_str();
            let key = format!("{MEDIA_PREFIX}/{run_id}/asset/{file}");
            // Already uploaded (immutable per run): reference it without reading the
            // source bytes or re-uploading.
            if self.existing_media.contains(&key) {
                metas.push(RunAssetOut {
                    file: file.to_string(),
                    key,
                });
                continue;
            }
            let Some(bytes) = self.read_media(run_id, "asset", file).await else {
                continue;
            };
            let extension = std::path::Path::new(file)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("");
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

/// Transcode a Playwright-recorded `.webm` proof clip to an H.264/AAC `.mp4` for
/// the public snapshot, so the gallery plays on every browser (webm/VP8 does not
/// on iOS/Safari). Shells out to `ffmpeg` (carried in the backend image); returns
/// `None` on any failure — a missing binary, an unreadable clip, a non-zero exit
/// — so the caller can fall back to serving the original webm rather than dropping
/// the proof from the snapshot entirely.
async fn transcode_webm_to_mp4(webm: &[u8]) -> Option<Vec<u8>> {
    // ffmpeg rewrites the mp4 moov atom to the front for progressive playback
    // (`-movflags +faststart`), which needs a seekable output, so stage the clip
    // through a unique temp dir rather than stdin/stdout pipes.
    let dir = std::env::temp_dir().join(format!("tcab-proof-{}", uuid::Uuid::new_v4()));
    tokio::fs::create_dir_all(&dir).await.ok()?;
    let input = dir.join("in.webm");
    let output = dir.join("out.mp4");
    let result = async {
        tokio::fs::write(&input, webm).await.ok()?;
        let status = tokio::process::Command::new("ffmpeg")
            .args(["-nostdin", "-loglevel", "error", "-y", "-i"])
            .arg(&input)
            .args([
                "-c:v",
                "libx264",
                // 4:2:0 chroma is what QuickTime/iOS can decode; libx264 would
                // otherwise keep webm's 4:4:4/4:2:2 and Safari would refuse it.
                "-pix_fmt",
                "yuv420p",
                "-preset",
                "veryfast",
                // Re-encode any audio to AAC; a no-op for Playwright clips, which
                // carry no audio track.
                "-c:a",
                "aac",
                "-movflags",
                "+faststart",
            ])
            .arg(&output)
            .stdin(std::process::Stdio::null())
            .status()
            .await
            .ok()?;
        status.success().then_some(())?;
        tokio::fs::read(&output).await.ok()
    }
    .await;
    // Best-effort cleanup regardless of outcome.
    let _ = tokio::fs::remove_dir_all(&dir).await;
    result
}

/// A best-effort content type for reference/proof/asset media from its extension.
fn media_content_type(extension: &str) -> &'static str {
    match extension.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "webm" => "video/webm",
        "mp4" => "video/mp4",
        "json" => "application/json",
        "glb" => "model/gltf-binary",
        "wav" => "audio/wav",
        "mid" | "midi" => "audio/midi",
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
    /// Where this snapshot's model catalog lives (`<prefix>/models.json`).
    pub models_key: String,
}

/// The model catalog file (`models.json`): the composed catalog the public site
/// renders the Models section from.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ModelCatalogFile {
    pub schema_version: u32,
    pub models: Vec<ModelOut>,
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
    /// `None` when the run carries no reviews yet (an unrated console run); the
    /// snapshot only contains reviewed runs, so it is always `Some` there.
    pub rating: Option<test_cabinet_core::review::Rating>,
    /// How many reviews the run carries. The site averages their scores; the
    /// aggregate sits between the harshest and most generous review.
    pub review_count: usize,
    /// The run's aggregate reviewer score: the mean earned checklist weight across
    /// its reviews. `None` when the run has no reviews (or its case's checklist
    /// weights can't be resolved). Like `case_name`, this is enriched by the
    /// callers that hold the case catalog (the console listing and the snapshot
    /// builder); [`RunSummary::from_stored`] leaves it `None` as it is
    /// catalog-free.
    pub score: Option<RunScoreOut>,
    pub links: LinksOut,
}

/// A run's aggregate reviewer score: mean earned checklist weight across its
/// reviews, over the shared total available. `None` when the run has no reviews
/// (or its case's checklist weights can't be resolved). The item weights live
/// only in the case catalog, so this is computed by callers that hold both the
/// reviews and the catalog (see [`run_summary_score`]).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct RunScoreOut {
    /// The mean weight earned across the run's reviews.
    pub earned: f64,
    /// The total weight available — identical across the run's reviews.
    pub total: u32,
    /// How many reviews the average is taken over.
    pub reviews: u32,
    /// A [game jam](test_cabinet_core::test_case::TestType::GameJam) run's overall
    /// game grade — the worst overall grade any reviewer gave (see
    /// [`test_cabinet_core::review::aggregate_overall_grade`]). This is the jam's
    /// rating badge, standing in for the per-domain `rating` a jam does not carry.
    /// `None` for every non-jam run.
    #[cfg_attr(feature = "contract", ts(optional = nullable))]
    pub overall_grade: Option<test_cabinet_core::review::VerdictStatus>,
}

impl RunSummary {
    /// Build a bounded summary card from a stored run, WITHOUT needing the case
    /// catalog. This is the single source of truth for the card fields shared by
    /// the public snapshot ([`SnapshotBuilder::summary`]) and the console's
    /// `GET /runs?fields=summary` listing.
    ///
    /// `rating` is the aggregate across the run's reviews, or `None` when the run
    /// carries no reviews yet (an unrated console run). `case_name` falls back to
    /// the test-case slug — a backend-connected console resolves display names
    /// itself; only the static snapshot substitutes the real catalog name (see
    /// [`SnapshotBuilder::summary`]).
    pub fn from_stored(run: &StoredRun) -> Self {
        let record = &run.record;
        Self {
            id: record.id.clone(),
            // The snapshot only ever contains published runs, so `published_at`
            // is always set there; default defensively rather than panic. A
            // console (unpublished) run may legitimately carry none.
            published_at: run.published_at.clone().unwrap_or_default(),
            started_at: record.started_at.clone(),
            finished_at: record.finished_at.clone(),
            subject: SubjectOut::from(record),
            case_name: record.subject.test_case_slug.clone(),
            metrics: record.metrics,
            validation_loaded: record.validation.loaded,
            state: record.status.state,
            rating: aggregate_rating_inner(&run.reviews),
            review_count: run.reviews.len(),
            // Catalog-free: the checklist weights live only in the case catalog,
            // so a caller that holds it enriches this (see [`run_summary_score`]).
            score: None,
            links: links_out(&run.links),
        }
    }
}

/// The run subject as a summary card carries it (the slug enum, not a string).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct SubjectOut {
    pub test_case_slug: String,
    pub test_case_version: String,
    /// The test type this run's case belongs to. The UI run-log branches on this
    /// to render the category column.
    pub test_type: test_cabinet_core::test_case::TestType,
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
            test_type: record.subject.test_type,
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
    /// The case's test type, so the static gallery can scope its catalog tabs to
    /// a single type (E2E / asset-generation / Adversarial / Performance) exactly
    /// as the backend-connected consoles do. Without it the site cannot tell a
    /// case's type and treats every case as end-to-end.
    pub test_type: test_cabinet_core::TestType,
    /// The asset shape an asset-generation case produces, so the gallery can
    /// partition asset cases across its 2D (sprite/paint), 3D (voxel/mesh/skinned),
    /// Particle, and Audio tabs. Defaults to `sprite` for every non-asset case
    /// (harmless — the split is only consulted for asset cases).
    pub asset_kind: test_cabinet_core::AssetKind,
    pub difficulty: String,
    pub tags: Vec<String>,
    pub summary: Option<String>,
    pub description: Option<String>,
    /// This version's own changelog entry (its `changelog.md` body), inlined.
    /// Always present — a changelog is required on every version. The site collects
    /// every published version's entry into one newest-first changelog on the
    /// case's detail page.
    pub changelog: String,
    pub variants: Vec<CaseVariantOut>,
    /// The seeded spec files shared by every variant, with their bodies inlined so
    /// the static gallery's Inputs tab can show them without a live backend. A
    /// variant's own additive specs ride on [`CaseVariantOut::seeded_inputs`]; the
    /// site concatenates the two (common first) exactly as a run is seeded.
    pub common_seeded_inputs: Vec<CaseSeededInputOut>,
    /// The Test Cabinet runtime packages this case ships into every run, each with
    /// its UI-only description, so the static gallery's Inputs tab can show them.
    /// Empty for a case that declares none.
    pub packages: Vec<CasePackageOut>,
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
    /// The absolute URL of this variant's authored **reference implementation** — the
    /// correct, deployed static build (the case-variant analogue of a run's
    /// `playableBuild`), shown on the static gallery's "Reference" tab. `null` when
    /// the variant declares no `reference_implementation`, or has one that has not
    /// been deployed yet. Written out-of-band by `tcab publish-reference` into the
    /// `case_reference_build` table and folded in here at export — never resolved
    /// from the manifest and never seeded into a run.
    pub reference_build: Option<String>,
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
    /// The seeded file's role (`spec`/`script`), so the static gallery's Inputs
    /// tab can tag it. Presentation only.
    pub kind: test_cabinet_core::SpecKind,
}

/// A runtime package a case ships into its runs, exposed in case metadata for the
/// static gallery's Inputs tab: its npm name and the UI-only description of what it
/// provides. The description is never seeded into a run — it exists only to
/// explain, on the site, what a declared package is for.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CasePackageOut {
    /// The npm package name the case declares in `packages`.
    pub name: String,
    /// The UI-only description of what the package provides.
    pub description: String,
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
    /// Whether the item is graded on the five-level scale (a game-jam category)
    /// rather than pass/fail. The reviewer and verdict UIs render the graded
    /// control and score `weight × 10` points for it when true.
    pub graded: bool,
    pub domain: Option<String>,
    /// Name-only sub-items this item is graded by, each an independently scored
    /// pass/fail point. Empty for an item graded as a whole.
    pub sub_items: Vec<CaseSubReviewItemOut>,
}

/// A name-only sub-item of a [`CaseReviewItemOut`] exposed in case metadata: one
/// independently graded point within the item, carrying only its id and title.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CaseSubReviewItemOut {
    pub id: String,
    pub title: String,
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
                kind: spec.kind,
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
    reference_builds: Option<&std::collections::HashMap<String, String>>,
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
                manifest.max_runtime_seconds,
                // The variant's own volume overrides the case's for its prompt.
                v.voxel.as_ref().or(manifest.voxel.as_ref()),
                // The gallery snapshot shows the standing prompt only — no prior
                // game-jam entries, so no distinctness section.
                0,
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
                reference_build: reference_builds
                    .and_then(|builds| builds.get(&v.slug))
                    .cloned(),
            })
        })
        .collect::<Result<Vec<_>, BackendError>>()?;

    Ok(CaseMetadata {
        schema_version: SCHEMA_VERSION,
        slug: manifest.slug.clone(),
        version: manifest.version.clone(),
        name: manifest.name.clone(),
        test_type: manifest.test_type,
        asset_kind: manifest.asset_kind,
        difficulty: manifest.difficulty.clone(),
        tags: manifest.tags.clone(),
        summary: manifest.summary.clone(),
        description: manifest.description.clone(),
        changelog: manifest.changelog.clone(),
        variants,
        common_seeded_inputs,
        packages: manifest
            .packages
            .iter()
            .map(|name| CasePackageOut {
                name: name.clone(),
                description: test_cabinet_core::shippable_package_description(name)
                    .unwrap_or_default()
                    .to_string(),
            })
            .collect(),
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
        graded: item.graded,
        domain: item.domain.clone(),
        sub_items: item
            .sub_items
            .iter()
            .map(|sub| CaseSubReviewItemOut {
                id: sub.id.clone(),
                title: sub.title.clone(),
            })
            .collect(),
    }
}

/// A run's outbound links in the snapshot wire shape (owned).
fn links_out(links: &test_cabinet_core::RunLinks) -> LinksOut {
    LinksOut {
        source_repo: links.source_repo.clone(),
        playable_build: links.playable_build.clone(),
    }
}

/// The aggregate rating, or `None` when the run carries no reviews. Delegates to
/// [`crate::db::aggregate_review_rating`] — the single source of truth shared with
/// the lifted `run.rating` column.
fn aggregate_rating_inner(
    reviews: &[crate::db::StoredReview],
) -> Option<test_cabinet_core::review::Rating> {
    crate::db::aggregate_review_rating(reviews)
}

/// The aggregate reviewer score for a run of `manifest`'s `variant`: the case's
/// declared checklist weights scored against each of the run's `reviews`, then
/// averaged (see [`test_cabinet_core::review::aggregate_score`]). `None` when the
/// run carries no reviews.
///
/// The checklist weights live only in the case catalog (the manifest), never on a
/// run or review, so this is the single source of truth shared by the two callers
/// that hold both a run's reviews and its case: the console `GET /runs?fields=summary`
/// listing (which reads the manifest from the store) and the public snapshot
/// builder (which holds it in memory). It is the backend analogue of
/// [`RunSummary::from_stored`] enriching `case_name`.
pub(crate) fn run_summary_score(
    manifest: &StoredManifest,
    variant: &str,
    reviews: &[crate::db::StoredReview],
) -> Option<RunScoreOut> {
    let items = review_items_for(manifest, variant);
    let scores: Vec<_> = reviews
        .iter()
        .map(|review| test_cabinet_core::review::score_checklist(&items, &review.checklist))
        .collect();
    let overall_grade = test_cabinet_core::review::aggregate_overall_grade(
        reviews.iter().map(|review| review.checklist.as_slice()),
    );
    test_cabinet_core::review::aggregate_score(&scores).map(|score| RunScoreOut {
        earned: score.earned,
        total: score.total,
        reviews: score.reviews,
        overall_grade,
    })
}

/// The effective weighted checklist items for a run of `variant`: the case's
/// common items followed by the selected variant's own (mirrors
/// [`test_cabinet_core::test_case::TestCaseVersion::review_items_for`], resolving
/// from the stored manifest). An unrecognized variant contributes only the common
/// items.
fn review_items_for(
    manifest: &StoredManifest,
    variant: &str,
) -> Vec<test_cabinet_core::ReviewItem> {
    manifest
        .common_review_items
        .iter()
        .chain(
            manifest
                .variants
                .iter()
                .find(|candidate| candidate.slug == variant)
                .into_iter()
                .flat_map(|candidate| candidate.review_items.iter()),
        )
        .map(core_review_item)
        .collect()
}

/// Reconstruct the core [`test_cabinet_core::ReviewItem`] a stored item was
/// ingested from — the inverse of `ingest::stored_review_item`. Scoring reads
/// `id`, `weight`, and `sub_items` (a sub-itemed item is scored per sub-item), and
/// the round trip keeps the rest of the item whole so it stays honest.
fn core_review_item(item: &crate::store::StoredReviewItem) -> test_cabinet_core::ReviewItem {
    test_cabinet_core::ReviewItem {
        id: item.id.clone(),
        title: item.title.clone(),
        text: item.text.clone(),
        reference: item.reference.clone(),
        proof: item.proof.clone(),
        sequences: item.sequences.clone(),
        frames: item.frames.clone(),
        weight: item.weight,
        graded: item.graded,
        domain: item.domain.clone(),
        sub_items: item
            .sub_items
            .iter()
            .map(|sub| test_cabinet_core::SubReviewItem {
                id: sub.id.clone(),
                title: sub.title.clone(),
            })
            .collect(),
        // Host-only reporter-side field; a snapshot-sourced item carries none.
        validation: None,
    }
}

#[cfg(test)]
#[path = "snapshot.test.rs"]
mod tests;
