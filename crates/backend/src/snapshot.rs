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

use serde::Serialize;
use sha2::{Digest, Sha256};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use time::macros::format_description;

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
}

impl SnapshotBuilder {
    /// Start a builder over the full published run set (newest-first), the
    /// ingested case manifests used to denormalize case names and emit case
    /// metadata files, and the definition store the rendered reference baselines
    /// are read from (so they can be exported alongside the case metadata).
    pub fn new(runs: Vec<StoredRun>, cases: Vec<StoredManifest>, store: DefinitionStore) -> Self {
        Self { runs, cases, store }
    }

    /// Generate the snapshot. The id is `<rfc3339-compact>-<short-hash>`, where
    /// the hash is over the run ids so a re-run with the same data is stable
    /// enough to debug while never clobbering a prior prefix.
    pub fn build(&self, generated_at: OffsetDateTime) -> Result<Snapshot> {
        let snapshot_id = self.snapshot_id(generated_at)?;
        let prefix = format!("snapshots/{snapshot_id}");

        let mut objects = Vec::new();

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
        // Events tab. Raw harness output is never published.
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
            objects.push(json_object(
                format!("{prefix}/runs/{}.json", run.record.id),
                &PerRun {
                    schema_version: SCHEMA_VERSION,
                    record: &run.record,
                    review: ReviewOut {
                        rating: run.review.rating.as_str(),
                        writeup: &run.review.writeup,
                        checklist: &run.review.checklist,
                    },
                    links: LinksOut {
                        source_repo: run.links.source_repo.as_deref(),
                        playable_build: run.links.playable_build.as_deref(),
                    },
                    events,
                },
            )?);
        }

        // cases/<slug>/<version>.json — case metadata, plus the version's rendered
        // reference baselines (PNGs) exported under the case prefix and named by
        // snapshot-relative key in the metadata, so the site can show baselines.
        // Every ingested version is emitted (simpler than tracking which have
        // runs, and valid per §3).
        for manifest in &self.cases {
            let (references, reference_objects) = self.case_references(manifest, &prefix);
            objects.push(json_object(
                format!("{prefix}/cases/{}/{}.json", manifest.slug, manifest.version),
                &case_metadata(manifest, references)?,
            )?);
            objects.extend(reference_objects);
        }

        let index = json_object(
            "index.json".to_string(),
            &SnapshotIndex {
                schema_version: SCHEMA_VERSION,
                snapshot_id: &snapshot_id,
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
    fn summary<'a>(&self, run: &'a StoredRun) -> RunSummary<'a> {
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
            published_at: run.published_at.clone(),
            started_at: record.started_at.clone(),
            finished_at: record.finished_at.clone(),
            subject: SubjectOut::from(record),
            case_name,
            metrics: &record.metrics,
            validation_loaded: record.validation.loaded,
            state: state_str(record.status.state),
            rating: run.review.rating.as_str(),
            links: LinksOut {
                source_repo: run.links.source_repo.as_deref(),
                playable_build: run.links.playable_build.as_deref(),
            },
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

        // (store scope, metadata `variant`, view). Common references carry a null
        // variant; variant-scoped ones carry the variant slug.
        let mut declared: Vec<(&str, Option<&str>, &str)> = Vec::new();
        for reference in &manifest.common_references {
            declared.push(("_common", None, &reference.view));
        }
        for variant in &manifest.variants {
            for reference in &variant.references {
                declared.push((&variant.slug, Some(variant.slug.as_str()), &reference.view));
            }
        }

        let mut metas = Vec::new();
        let mut objects = Vec::new();
        for (scope, variant, view) in declared {
            let Ok(bytes) = self.store.read_reference(slug, version, scope, view) else {
                continue;
            };
            let key = format!("{prefix}/cases/{slug}/{version}/references/{scope}/{view}.png");
            objects.push(SnapshotObject {
                key: key.clone(),
                bytes,
                content_type: "image/png".to_string(),
            });
            metas.push(CaseReferenceOut {
                variant: variant.map(str::to_string),
                view: view.to_string(),
                key,
            });
        }
        (metas, objects)
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotIndex<'a> {
    schema_version: u32,
    snapshot_id: &'a str,
    generated_at: String,
    run_count: usize,
    runs_key: String,
    runs_prefix: String,
    cases_prefix: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RunsIndex<'a> {
    schema_version: u32,
    runs: Vec<RunSummary<'a>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RunSummary<'a> {
    id: String,
    published_at: String,
    started_at: String,
    finished_at: String,
    subject: SubjectOut,
    case_name: String,
    metrics: &'a test_cabinet_core::metrics::RunMetrics,
    validation_loaded: bool,
    state: &'static str,
    rating: &'static str,
    links: LinksOut<'a>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SubjectOut {
    test_case_slug: String,
    test_case_version: String,
    variant: String,
    harness_slug: String,
    harness_version: Option<String>,
    model_id: String,
}

impl SubjectOut {
    fn from(record: &RunRecord) -> Self {
        Self {
            test_case_slug: record.subject.test_case_slug.clone(),
            test_case_version: record.subject.test_case_version.clone(),
            variant: record.subject.variant.clone(),
            harness_slug: record.subject.harness_slug.as_str().to_string(),
            harness_version: record.subject.harness_version.clone(),
            model_id: record.subject.model_id.clone(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PerRun<'a> {
    schema_version: u32,
    record: &'a RunRecord,
    review: ReviewOut<'a>,
    links: LinksOut<'a>,
    /// The run's recorded normalized event stream (a JSON array), omitted when the
    /// run captured none. The site emits this as a per-run static asset its Events
    /// tab fetches; raw harness output is never included.
    #[serde(skip_serializing_if = "Option::is_none")]
    events: Option<serde_json::Value>,
}

#[derive(Serialize)]
struct ReviewOut<'a> {
    rating: &'static str,
    writeup: &'a str,
    checklist: &'a [test_cabinet_core::review::ReviewVerdict],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LinksOut<'a> {
    source_repo: Option<&'a str>,
    playable_build: Option<&'a str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CaseMetadata<'a> {
    schema_version: u32,
    slug: &'a str,
    version: &'a str,
    name: &'a str,
    difficulty: &'a str,
    tags: &'a [String],
    summary: Option<&'a str>,
    description: Option<&'a str>,
    variants: Vec<CaseVariantOut<'a>>,
    checks: Vec<CaseCheckOut<'a>>,
    /// Rendered reference baselines, named by snapshot-relative key. The site
    /// resolves these to absolute URLs to show baselines on the References tab.
    references: Vec<CaseReferenceOut>,
}

/// A reference baseline exposed in case metadata. `variant` is `null` for a
/// common reference (shown on every variant) or the variant slug for one scoped
/// to a single variant; `key` is the snapshot-relative object key of the PNG.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CaseReferenceOut {
    variant: Option<String>,
    view: String,
    key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CaseVariantOut<'a> {
    slug: &'a str,
    name: &'a str,
    description: Option<&'a str>,
    /// The variant's prompt, rendered as a real run receives it, so the public
    /// gallery's Specifications tab shows the instruction the model was handed.
    prompt: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CaseCheckOut<'a> {
    view: &'a str,
    name: &'a str,
    reference_view: &'a str,
}

/// Build the case-metadata document for one ingested version (no spec bodies, no
/// mockup HTML, no host paths — only the site-facing slice). Each variant's
/// prompt is rendered exactly as a run receives it, so the public gallery shows
/// the same instruction the consoles do; the spec bodies and seeded inputs it
/// references are still resolved from the backend, not inlined here.
fn case_metadata<'a>(
    manifest: &'a StoredManifest,
    references: Vec<CaseReferenceOut>,
) -> Result<CaseMetadata<'a>, BackendError> {
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
            )
            .map_err(|e| {
                BackendError::Snapshot(format!(
                    "rendering prompt for `{}@{}` variant `{}`: {e}",
                    manifest.slug, manifest.version, v.slug
                ))
            })?;
            Ok(CaseVariantOut {
                slug: &v.slug,
                name: &v.name,
                description: v.description.as_deref(),
                prompt,
            })
        })
        .collect::<Result<Vec<_>, BackendError>>()?;

    Ok(CaseMetadata {
        schema_version: SCHEMA_VERSION,
        slug: &manifest.slug,
        version: &manifest.version,
        name: &manifest.name,
        difficulty: &manifest.difficulty,
        tags: &manifest.tags,
        summary: manifest.summary.as_deref(),
        description: manifest.description.as_deref(),
        variants,
        checks: manifest
            .checks
            .iter()
            .map(|c| CaseCheckOut {
                view: &c.view,
                name: &c.name,
                reference_view: &c.reference_view,
            })
            .collect(),
        references,
    })
}

/// The wire string for a run state.
fn state_str(state: test_cabinet_core::run_record::RunState) -> &'static str {
    use test_cabinet_core::run_record::RunState;
    match state {
        RunState::Completed => "completed",
        RunState::Failed => "failed",
        RunState::Unevaluable => "unevaluable",
    }
}

#[cfg(test)]
#[path = "snapshot.test.rs"]
mod tests;
