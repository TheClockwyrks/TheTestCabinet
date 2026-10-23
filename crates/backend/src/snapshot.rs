//! Public snapshot generation and its write through the artifacts service (the
//! backend's [Public Snapshot] page).
//!
//! The snapshot is the public dataset the gallery and its Workers **read at
//! runtime**. It is regenerated from the full published set on each (coalesced)
//! publish, its index objects written under a new `snapshots/<snapshot-id>/`
//! generation prefix, and cut over atomically by writing the small top-level
//! `index.json` pointer last. Regenerating the whole set (not deltas) keeps the
//! operation idempotent.
//!
//! Regenerating is not the same as re-*uploading*, though, and the difference is
//! what keeps a refresh from costing one write per published run forever.
//! Everything whose content did not change is **content-addressed under a
//! snapshot-independent prefix** and referenced by the key it already occupies: a
//! case version's media (`CASE_MEDIA_PREFIX`) and files (`CASE_FILES_PREFIX`), a
//! run's code-analysis document, and — the bulk of the set — each published run's
//! own JSON document ([`RUN_DOCUMENT_PREFIX`]). A refresh therefore rebuilds every
//! document in memory (cheap) but writes only the ones the bucket does not already
//! hold, so the steady-state cost of a publish tracks the runs that *changed*
//! rather than the runs that exist.
//!
//! This module is split in two: [`SnapshotBuilder`] turns the published runs +
//! case metadata into the set of `(key, bytes, content_type)` objects, and
//! [`write_snapshot`] writes them through the artifacts service's
//! `PUT /public/{key}` in dependency order. The split lets the generation be
//! unit-tested without a bucket.
//!
//! A run's proof, validation, asset and showcase media are not composed here: the
//! artifacts service copies them from the run's stored tree into the bucket
//! (`POST /runs/{id}/publish-media`) and answers with the keys, which the caller
//! hands the builder ([`SnapshotBuilder::with_published_media`]) to name in each
//! run's document.
//!
//! [Public Snapshot]: https://docs.testcabinet.ai/components/backend/snapshot/

use serde::Serialize;
use sha2::{Digest, Sha256};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use time::macros::format_description;

use test_cabinet_contracts::run_record::RunRecord;
use test_cabinet_contracts::test_case::version_key;
use test_cabinet_redact::SecretScrubber;
use test_cabinet_suites::content_labels::{self, ContentLabels};

use crate::api::ModelOut;
use crate::artifacts::PublishedMedia;
use crate::db::StoredRun;
use crate::error::{BackendError, Result};
use crate::store::{DefinitionStore, StoredManifest};

pub use test_cabinet_contracts::backend_api::snapshot::{
    CaseCheckOut, CaseDomainOut, CaseErratumOut, CaseMetadata, CasePackageOut, CaseReferenceOut,
    CaseReferenceSheetOut, CaseReviewItemOut, CaseReviewValidationOut, CaseSeededInputOut,
    CaseShowcaseMediaOut, CaseShowcaseOut, CaseShowcasesFile, CaseSubReviewItemOut,
    CaseValidationBaselineOut, CaseVariantOut, CaseVariantRenderingOut, CaseVariantShowcase,
    CaseVersionShowcases, CaseWorkspaceFileOut, CodeSummaryOut, ComparisonFile, ComparisonsIndex,
    GgRunsFile, LinksOut, ModelCatalogFile, PerRun, PerformanceSummaryOut, Review, RunAssetOut,
    RunProofOut, RunScoreOut, RunShowcaseOut, RunSummary, RunValidationMediaOut, RunsIndex,
    SnapshotIndex, SubjectOut, TestCaseGroupsFile,
};

/// The schema version stamped into every snapshot document.
///
/// `2` moved the per-run documents out of the per-snapshot prefix and onto the
/// content-addressed [`RUN_DOCUMENT_PREFIX`], which is why `index.json` no longer
/// carries a `runsPrefix` and each run summary now names its own `documentKey`.
const SCHEMA_VERSION: u32 = 2;

/// How many objects of one write phase are written through the artifacts service
/// at once.
///
/// The writes within a phase are independent — the only ordering the snapshot
/// requires is between phases, the content-addressed objects before the generation
/// that names them and every object before the `index.json` cut-over — so
/// serializing them just paid one round trip per object, and the refresh's wall
/// clock grew with the corpus. Bounded rather than unbounded so a large first-time
/// refresh cannot open a connection per object against the service.
pub const UPLOAD_CONCURRENCY: usize = 16;

/// The bucket prefix a run's media is stored under, **outside** any single
/// snapshot's `snapshots/<id>/` prefix. A published run's media is immutable, so it
/// is keyed by the run id (not the snapshot id) and written **once**.
///
/// The artifacts service writes a run's proof, validation, asset and showcase media
/// here itself, copying it from the run's stored tree. The one object the backend
/// writes under it is the run's code-analysis document,
/// `media/runs/<id>/code-analysis/v<generation>.json` (`SnapshotBuilder::run_code_analysis`), which a refresh that finds it already in the bucket references
/// without re-reading or re-uploading.
pub const MEDIA_PREFIX: &str = "media/runs";

/// The bucket prefix a **case version's** media — its rendered reference baselines
/// and its committed validation baselines — is stored under, likewise **outside**
/// any single snapshot's prefix.
///
/// These were originally written under `snapshots/<id>/cases/…`, which meant every
/// refresh re-uploaded (and re-transcoded) the whole corpus even though nothing
/// about it had changed. They are the case-scoped counterpart of [`MEDIA_PREFIX`]:
/// a version that has a published run is [frozen], so its media is effectively
/// immutable and belongs in the shared, snapshot-independent space.
///
/// Unlike run media, though, a reference PNG is *rendered* from a committed mockup
/// at ingest rather than committed as bytes, so a re-ingest on a different browser
/// build can legitimately produce different bytes for the same view. Keying purely
/// by `(slug, version, view)` would therefore pin the gallery to whichever render
/// landed first. Each object is instead **content-addressed** — the key carries a
/// short digest of the source bytes (`content_digest`) — so identical bytes reuse
/// the identical key (the dedup that makes a refresh cheap) while genuinely changed
/// bytes mint a new key and get uploaded. Hashing needs only a local store read; it
/// is the upload, and for a video the ffmpeg transcode, that the skip avoids.
///
/// [frozen]: https://docs.testcabinet.ai/development/frozen-versions/
pub const CASE_MEDIA_PREFIX: &str = "media/cases";

/// The bucket prefix a **case version's** starter-workspace file bytes are
/// published under — likewise **outside** any single snapshot's prefix, and
/// content-addressed exactly as [`CASE_MEDIA_PREFIX`] objects are (the key
/// carries a `content_digest` of the bytes plus the file's base name), so an
/// unchanged file keeps its key across refreshes and a changed one mints a new
/// key. Its own prefix rather than `media/cases` because these are not media:
/// they are the text files a run is seeded with, published so the static
/// gallery's Inputs tab can fetch a starter file lazily the way the live console
/// fetches it over the artifact route.
pub const CASE_FILES_PREFIX: &str = "files/cases";

/// A version's exported starter-workspace sets, keyed by variant slug and then by
/// [engine](test_cabinet_suites::engine) slug — what
/// [`SnapshotBuilder::case_workspace_files`] collects and [`case_metadata`] folds
/// onto each variant.
type VariantWorkspaceFiles = std::collections::HashMap<
    String,
    std::collections::BTreeMap<String, Vec<CaseWorkspaceFileOut>>,
>;

/// The bucket prefix a published run's **JSON document** is stored under — likewise
/// **outside** any single snapshot's prefix, and the reason a refresh's upload cost
/// tracks changed runs rather than all of them.
///
/// These documents used to live at `snapshots/<id>/runs/<run-id>.json`, so every
/// refresh rewrote and re-PUT one object per published run no matter how little had
/// changed: publishing a single new run re-uploaded the entire corpus, and the cost
/// of a publish grew without bound as runs accumulated. That is the same waste
/// `MEDIA_PREFIX` and `CASE_MEDIA_PREFIX` already fixed for bytes, applied to the
/// documents.
///
/// Unlike a run's media a document is *not* immutable — a new review, a newly
/// uploaded proof, an edited record all legitimately change it — so it cannot simply
/// be keyed by run id and written once. It is instead **content-addressed** exactly
/// as case media is: the key carries a short digest of the document's own bytes
/// (`content_digest`), so an unchanged run reuses the key it already occupies and
/// is skipped, while any change at all mints a new key and uploads. The decision
/// needs no bucket read beyond the one prefix listing, and it is self-correcting:
/// there is no separate "has this run changed?" signal that can go stale, because the
/// bytes *are* the signal.
///
/// A run's document key is not derivable from its id, so each run summary in
/// `runs.json` names its own (`RunSummary::document_key`) and the site follows that
/// rather than composing a path.
///
/// **Superseded revisions are deliberately not pruned.** A revision is orphaned the
/// moment a run's content changes, but the grace period it needs runs from
/// *supersession*, and the only clock a bucket listing offers is the object's
/// creation time — which for a document written months ago says nothing about when it
/// fell out of use. Pruning on that clock would delete a just-orphaned document
/// immediately and 404 any site build still fetching the previous generation, so
/// [`stale_generation_keys`]' rule cannot be reused here. The leak this leaves is a
/// different order from the one that prune exists for: it accrues per *content
/// change* (a new review, a proof arriving) rather than per refresh, so it is a small
/// multiple of the live set rather than a fresh full copy every publish. Reclaiming
/// it needs a supersession timestamp the snapshot does not currently record — the
/// same future cleanup orphaned run media is already waiting on.
pub const RUN_DOCUMENT_PREFIX: &str = "documents/runs";

/// One object to upload: its bucket key, bytes, and the labels it is served under.
#[derive(Debug, Clone, PartialEq)]
pub struct SnapshotObject {
    /// The bucket key (e.g. `snapshots/<id>/runs.json`).
    pub key: String,
    /// The object's bytes.
    pub bytes: Vec<u8>,
    /// The media type of the resource the object holds.
    pub content_type: String,
    /// The codec the stored bytes are framed in, `None` when they are already the
    /// resource. A `.json.gz` recording is published as JSON framed in gzip, so the
    /// gallery's player is handed inflated JSON (see
    /// [`test_cabinet_suites::content_labels`]).
    pub content_encoding: Option<String>,
}

/// A fully generated snapshot: the versioned objects, the top-level `index.json`
/// (uploaded last for the atomic cut-over), and the run count.
#[derive(Debug, Clone)]
pub struct Snapshot {
    /// The snapshot id (timestamp + short hash).
    pub snapshot_id: String,
    /// Every object to write but the pointer: the content-addressed objects the
    /// bucket does not hold yet ([`Snapshot::content_objects`]) and this
    /// generation's index objects ([`Snapshot::generation_objects`]).
    pub objects: Vec<SnapshotObject>,
    /// The top-level `index.json` pointer, written after `objects`.
    pub index: SnapshotObject,
    /// Number of published runs in this snapshot.
    pub run_count: usize,
    /// Every [`RUN_DOCUMENT_PREFIX`] key this snapshot references — the ones it just
    /// uploaded *and* the ones it reused untouched. Together with `objects` this says
    /// which run documents the refresh actually paid for, and it is the live set any
    /// future reclamation of superseded revisions has to measure against.
    pub run_document_keys: std::collections::HashSet<String>,
}

/// Builds a [`Snapshot`] from the published set and the case metadata.
pub struct SnapshotBuilder {
    runs: Vec<StoredRun>,
    cases: Vec<StoredManifest>,
    store: DefinitionStore,
    /// The public keys of each run's media, keyed by run id, as the artifacts
    /// service's `POST /runs/{id}/publish-media` answered them (see
    /// [`Self::with_published_media`]). A run absent from the map names no media.
    published_media: std::collections::HashMap<String, PublishedMedia>,
    /// The composed model catalog exported alongside the runs, so the public site
    /// renders the Models section from the snapshot. Empty by default.
    models: Vec<ModelOut>,
    /// The reference-implementation URLs to fold onto each case's variants, keyed by
    /// `(slug, version)` → (variant slug → engine slug → served URL). Written
    /// out-of-band into the `case_reference_build` table (via
    /// `tcab publish-reference`) and read from the database, not the store — so they
    /// are supplied here rather than derived from a manifest. Empty by default (a
    /// `(slug, version)` absent from the map, or a variant absent from its inner map,
    /// simply exports an empty `referenceBuilds`).
    reference_builds: std::collections::HashMap<
        (String, String),
        std::collections::HashMap<String, std::collections::BTreeMap<String, String>>,
    >,
    /// The published asset-reference frame sets to fold onto each case's variants,
    /// keyed by `(slug, version)` → (variant slug → frame indices). The
    /// asset-generation counterpart of [`Self::reference_builds`], read from the
    /// `case_reference_sheet` table (which ingest reconciles against the bucket), not
    /// from a manifest. Empty by default (a `(slug, version)` absent from the map, or
    /// a variant absent from its inner map, simply exports `referenceSheet: null`).
    reference_sheets:
        std::collections::HashMap<(String, String), std::collections::HashMap<String, Vec<u32>>>,
    /// The set of content-addressed media and file keys — a case version's media
    /// under [`CASE_MEDIA_PREFIX`], a run's code-analysis document under
    /// [`MEDIA_PREFIX`], and the case-workspace files under [`CASE_FILES_PREFIX`] —
    /// already present in the bucket, so the builder references an existing object
    /// rather than re-reading and re-uploading its bytes. Populated from the bucket
    /// before a real refresh (see [`Self::with_existing_media`]); empty by default,
    /// which writes every such object — correct for the dev/single-box path and
    /// the unit tests.
    existing_media: std::collections::HashSet<String>,
    /// The set of run-document keys (`documents/runs/<id>/<digest>.json`) already
    /// present in the bucket, so a run whose document is byte-identical to the one
    /// already uploaded is referenced rather than re-uploaded. Populated from the
    /// bucket before a real refresh (see [`Self::with_existing_documents`]); empty by
    /// default, which uploads every run's document — correct for the dev/single-box
    /// path and the unit tests, and the one-time cost of a first refresh.
    existing_documents: std::collections::HashSet<String>,
    /// The published harness comparisons to fold into the snapshot, each already
    /// computed to its full read model (arms + distributions + diagnostics) by the
    /// caller — which has the whole-experiment run set — so the builder only
    /// serializes them. Empty by default (the dev/single-box path and the unit
    /// tests), which emits an empty comparisons index.
    comparisons: Vec<crate::comparison::Comparison>,
    /// The gg [documents](crate::gg_query::GgRunDoc) to export, already
    /// filtered and redacted by the caller (see
    /// [`crate::gg_docs::public_documents`]). Empty by default, which emits an empty
    /// corpus file — the dev/single-box path and the unit tests.
    gg_documents: Vec<crate::gg_query::GgRunDoc>,
    /// The ingested test-case groups to export as this snapshot's
    /// `test-case-groups.json`, already in display order and already mapped to the
    /// wire shape `GET /test-case-groups` serves (the publisher reads the set from
    /// the definition store). Empty by default, which emits an empty set — the
    /// dev/single-box path and the unit tests.
    test_case_groups: Vec<crate::api::TestCaseGroupOut>,
}

impl SnapshotBuilder {
    /// Start a builder over the full published run set (newest-first), the
    /// ingested case manifests used to denormalize case names and emit case
    /// metadata files, and the definition store the rendered reference baselines
    /// are read from (so they can be exported alongside the case metadata).
    ///
    /// No run names any media until [`Self::with_published_media`] supplies the
    /// keys the artifacts service published them under.
    pub fn new(runs: Vec<StoredRun>, cases: Vec<StoredManifest>, store: DefinitionStore) -> Self {
        Self {
            runs,
            cases,
            store,
            published_media: std::collections::HashMap::new(),
            models: Vec::new(),
            reference_builds: std::collections::HashMap::new(),
            reference_sheets: std::collections::HashMap::new(),
            existing_media: std::collections::HashSet::new(),
            existing_documents: std::collections::HashSet::new(),
            comparisons: Vec::new(),
            gg_documents: Vec::new(),
            test_case_groups: Vec::new(),
        }
    }

    /// Supply the gg documents to export as this snapshot's `gg-runs.json`.
    ///
    /// **Redaction is applied here**, on the way in, rather than trusted to the caller.
    /// This is the object boundary — the last point at which a document is still a value
    /// in this process and not bytes on their way to a public bucket — so it is where the
    /// invariant belongs. `redacted_for_public` is idempotent (a second pass over an
    /// already-redacted document drops nothing), which is what lets the composer keep
    /// applying it too: [`crate::gg_docs::public_documents`] redacts because the console's
    /// index and the export share a builder and the two must not, and this redacts because
    /// a *future* second exporter has no reason to know that.
    ///
    /// Which runs are exported is still the caller's decision, and deliberately not
    /// re-checked here: "is this case experimental" is a fact about the definition store,
    /// which the builder has no handle on.
    ///
    /// The builder additionally runs the [secret scrubber](SecretScrubber) over the
    /// serialized file, as it does over every other public object. The two are not
    /// substitutes — redaction drops long free text whatever it is called, scrubbing
    /// catches short, deliberately-shaped credentials — and neither subsumes the other.
    ///
    /// Empty (the default) emits an empty corpus, which the site renders as a Discover
    /// surface with nothing in it rather than as an error.
    pub fn with_gg_documents(mut self, gg_documents: Vec<crate::gg_query::GgRunDoc>) -> Self {
        self.gg_documents = gg_documents
            .iter()
            .map(crate::gg_query::redacted_for_public)
            .collect();
        self
    }

    /// Supply the published comparisons to fold into this snapshot, each already
    /// assembled to its full read model. Empty (the default) emits an empty
    /// comparisons index.
    pub fn with_comparisons(mut self, comparisons: Vec<crate::comparison::Comparison>) -> Self {
        self.comparisons = comparisons;
        self
    }

    /// Supply the ingested test-case groups to export as this snapshot's
    /// `test-case-groups.json`, in the display order the store serves them. Empty
    /// (the default) emits an empty set, which the site renders as a home page
    /// with no group leaderboards.
    pub fn with_test_case_groups(
        mut self,
        test_case_groups: Vec<crate::api::TestCaseGroupOut>,
    ) -> Self {
        self.test_case_groups = test_case_groups;
        self
    }

    /// Supply the set of media and file keys already present in the bucket (from
    /// [`list_public`](crate::artifacts::list_public) over the `media/` and
    /// `files/` prefixes). For any case-media, code-analysis or case-file object
    /// whose key is in this set, the builder emits the metadata pointing at it but
    /// does **not** re-upload it (nor, for a video baseline, re-transcode it) — so
    /// unchanged media is exported exactly once across all snapshots.
    pub fn with_existing_media(
        mut self,
        existing_media: std::collections::HashSet<String>,
    ) -> Self {
        self.existing_media = existing_media;
        self
    }

    /// Supply the set of run-document keys already present in the bucket (from
    /// [`list_public`](crate::artifacts::list_public) over
    /// [`RUN_DOCUMENT_PREFIX`]). A run whose freshly built document hashes to a key in
    /// this set is referenced from `runs.json` without being uploaded again, which is
    /// what makes the steady-state cost of a refresh proportional to the runs that
    /// changed rather than to every run ever published.
    ///
    /// Leaving it empty is always *correct*, only slower: every document is uploaded,
    /// landing on exactly the keys the next refresh will then skip.
    pub fn with_existing_documents(
        mut self,
        existing_documents: std::collections::HashSet<String>,
    ) -> Self {
        self.existing_documents = existing_documents;
        self
    }

    /// Set the composed model catalog to export in this snapshot's `models.json`.
    pub fn with_models(mut self, models: Vec<ModelOut>) -> Self {
        self.models = models;
        self
    }

    /// Supply the reference-implementation URLs to fold onto each case's variants,
    /// keyed by `(slug, version)` → (variant slug → engine slug → served URL). These
    /// come from the `case_reference_build` table (read by the caller from the
    /// database), not from any manifest — the URL of a variant's authored, deployed
    /// correct build is recorded out-of-band by `tcab publish-reference`. A
    /// `(slug, version)` or variant absent from the map exports an empty
    /// `referenceBuilds`.
    pub fn with_reference_builds(
        mut self,
        reference_builds: std::collections::HashMap<
            (String, String),
            std::collections::HashMap<String, std::collections::BTreeMap<String, String>>,
        >,
    ) -> Self {
        self.reference_builds = reference_builds;
        self
    }

    /// Supply the published asset-reference frame sets to fold onto each case's
    /// variants, keyed by `(slug, version)` → (variant slug → frame indices). The
    /// asset-generation counterpart of [`Self::with_reference_builds`]: an asset
    /// case's reference is a set of published frames rather than a deployed site, and
    /// each frame's object key is derivable from the triple plus its index (see
    /// `test_cabinet_contracts::asset_reference`), so only the indices are exported and the
    /// site builds the URLs by joining them onto its snapshot base. These come from the
    /// `case_reference_sheet` table (read by the caller from the database), which ingest
    /// reconciles against the bucket. A `(slug, version)` or variant absent from the map
    /// exports `referenceSheet: null`.
    pub fn with_reference_sheets(
        mut self,
        reference_sheets: std::collections::HashMap<
            (String, String),
            std::collections::HashMap<String, Vec<u32>>,
        >,
    ) -> Self {
        self.reference_sheets = reference_sheets;
        self
    }

    /// Supply the public keys of each run's media, keyed by run id, as the
    /// artifacts service answered the run's `POST /runs/{id}/publish-media`: the
    /// service copies a run's proof, validation, asset and showcase media from its
    /// stored tree into the bucket, so the builder only names the keys in the run's
    /// document. A run absent from the map names empty media lists, which is what
    /// the document carries until the copy succeeds.
    pub fn with_published_media(
        mut self,
        published_media: std::collections::HashMap<String, PublishedMedia>,
    ) -> Self {
        self.published_media = published_media;
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
        // but this snapshot is published to the public bucket and served on the open
        // internet.
        // A model that dumped its environment can have printed the run's provider
        // API key into the recorded events or a failure detail, so every per-run
        // document is scrubbed before it is uploaded. The backend never holds a
        // key value, so this redacts by `sk-…` shape (see [`SecretScrubber`]).
        let scrubber = SecretScrubber::new();

        // `documents/runs/<id>/<digest>.json` — per-run record + reviews + links, plus
        // the recorded normalized event stream (when captured) so the site can serve
        // the run's Events tab. Raw harness output is never published. The run's
        // media is named by bucket-relative key in `proofMedia`, `validationMedia`,
        // `assetMedia` and `showcaseMedia`, the keys the artifacts service published
        // it under (see [`SnapshotBuilder::with_published_media`]), all under the
        // content-stable `media/runs/<id>/…` prefix (NOT this snapshot's prefix).
        //
        // The document itself is likewise content-addressed outside this snapshot's
        // prefix ([`RUN_DOCUMENT_PREFIX`]), so a run whose public content has not moved
        // since the last refresh contributes its existing key and **no upload**. Built
        // before `runs.json` because each summary carries its run's document key.
        let mut document_keys: Vec<String> = Vec::with_capacity(self.runs.len());
        let mut reused_documents = 0usize;
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
            // The run's media was copied into the bucket by the artifacts service,
            // which answered with the keys; the document only names them.
            let PublishedMedia {
                proof_media,
                validation_media,
                asset_media,
                showcase_media,
            } = self
                .published_media
                .get(&run.record.id)
                .cloned()
                .unwrap_or_default();
            // The unbounded code-analysis document is the one per-run object whose
            // bytes are not media: it is published beside the run rather than inside
            // it, so it is scrubbed *here*, on its own, before it becomes an object
            // (see [`Self::run_code_analysis`]).
            let (code_analysis_key, code_analysis_object) =
                self.run_code_analysis(&run.record, &scrubber);
            // Serialize the public document, then redact any leaked secret from
            // it (across the record, its events, and any other captured text)
            // before it becomes a snapshot object bound for the public bucket.
            let mut document = serde_json::to_value(PerRun {
                schema_version: SCHEMA_VERSION,
                record: run.record.clone(),
                reviews: run.reviews.iter().map(review_out).collect(),
                links: links_out(&run.links),
                events,
                proof_media,
                validation_media,
                asset_media,
                showcase_media,
                code_analysis_key,
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
            // The document's own bytes are its address. Anything that changes what the
            // public site would show for this run — a new review, a proof that has now
            // uploaded, an edited record, a re-scrub — moves the digest and so mints a
            // key that is necessarily absent from the bucket; anything that does not,
            // lands on the key already there and costs nothing.
            let bytes = serde_json::to_vec_pretty(&document)?;
            let key = format!(
                "{RUN_DOCUMENT_PREFIX}/{}/{}.json",
                run.record.id,
                content_digest(&bytes)
            );
            if self.existing_documents.contains(&key) {
                reused_documents += 1;
            } else {
                objects.push(SnapshotObject {
                    key: key.clone(),
                    bytes,
                    content_type: "application/json".to_string(),
                    content_encoding: None,
                });
            }
            document_keys.push(key);
            objects.extend(code_analysis_object);
        }
        tracing::debug!(
            runs = self.runs.len(),
            reused = reused_documents,
            uploaded = self.runs.len() - reused_documents,
            "built the snapshot's per-run documents"
        );

        // runs.json — the flat index of summaries (newest first), each naming the
        // document key resolved above. This file *is* rewritten every refresh: it
        // summarizes every published run by contract, so there is no smaller thing to
        // write. It is one object, and small.
        // Index the catalog by `(slug, version)` once. Scanning `self.cases` per run
        // instead made the summary pass runs × cases, which is quadratic in exactly the
        // two dimensions that grow.
        let case_index: std::collections::HashMap<(&str, &str), &StoredManifest> = self
            .cases
            .iter()
            .map(|case| ((case.slug.as_str(), case.version.as_str()), case))
            .collect();
        let summaries: Vec<RunSummary> = self
            .runs
            .iter()
            .zip(&document_keys)
            .map(|(run, document_key)| self.summary(run, document_key, &case_index))
            .collect();
        objects.push(json_object(
            format!("{prefix}/runs.json"),
            &RunsIndex {
                schema_version: SCHEMA_VERSION,
                runs: summaries,
            },
        )?);

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
        //
        // A version's showcases follow a looser rule (see [`CaseShowcasesFile`]): every
        // non-experimental version of a case with a published run of *any* version
        // publishes them, so the gallery can preview a listed case with its newest
        // showcase. A version that has a case document names the same showcase
        // objects on it.
        let cases_with_runs: std::collections::HashSet<&str> =
            versions_with_runs.iter().map(|(slug, _)| *slug).collect();
        let mut case_showcases: Vec<CaseVersionShowcases> = Vec::new();
        for manifest in &self.cases {
            let has_runs =
                versions_with_runs.contains(&(manifest.slug.as_str(), manifest.version.as_str()));
            let showcased =
                !manifest.experimental && cases_with_runs.contains(manifest.slug.as_str());
            if !has_runs && !showcased {
                continue;
            }
            let (showcases, showcase_objects) = self.case_showcases(manifest).await;
            objects.extend(showcase_objects);
            if showcased {
                let variants: Vec<CaseVariantShowcase> = manifest
                    .variants
                    .iter()
                    .filter_map(|variant| {
                        showcases
                            .get(&variant.slug)
                            .map(|showcase| CaseVariantShowcase {
                                variant: variant.slug.clone(),
                                showcase: showcase.clone(),
                            })
                    })
                    .collect();
                if !variants.is_empty() {
                    case_showcases.push(CaseVersionShowcases {
                        slug: manifest.slug.clone(),
                        version: manifest.version.clone(),
                        variants,
                    });
                }
            }
            if !has_runs {
                continue;
            }
            let (references, reference_objects) = self.case_references(manifest);
            let (validation_baselines, baseline_objects) =
                self.case_validation_baselines(manifest).await;
            let (workspace_files, workspace_objects) = self.case_workspace_files(manifest);
            let variant_reference_builds = self
                .reference_builds
                .get(&(manifest.slug.clone(), manifest.version.clone()));
            let variant_reference_sheets = self
                .reference_sheets
                .get(&(manifest.slug.clone(), manifest.version.clone()));
            objects.push(json_object(
                format!("{prefix}/cases/{}/{}.json", manifest.slug, manifest.version),
                &case_metadata(
                    &self.store,
                    manifest,
                    references,
                    validation_baselines,
                    variant_reference_builds,
                    variant_reference_sheets,
                    &showcases,
                    &workspace_files,
                )?,
            )?);
            objects.extend(reference_objects);
            objects.extend(baseline_objects);
            objects.extend(workspace_objects);
        }

        // case-showcases.json — the showcases of every non-experimental version of
        // each case with a published run, in slug then version order so the document
        // is stable across refreshes.
        case_showcases.sort_by(|a, b| {
            a.slug
                .cmp(&b.slug)
                .then_with(|| version_key(&a.version).cmp(&version_key(&b.version)))
                .then_with(|| a.version.cmp(&b.version))
        });
        objects.push(json_object(
            format!("{prefix}/case-showcases.json"),
            &CaseShowcasesFile {
                schema_version: SCHEMA_VERSION,
                showcases: case_showcases,
            },
        )?);

        // models.json — the composed model catalog (curated ⋃ derived-from-runs,
        // with each model's list price), so the public site renders the Models section from
        // the snapshot rather than a bundled dataset.
        objects.push(json_object(
            format!("{prefix}/models.json"),
            &ModelCatalogFile {
                schema_version: SCHEMA_VERSION,
                models: self.models.clone(),
            },
        )?);

        // test-case-groups.json — the ingested test-case-group set, in the order
        // `GET /test-case-groups` serves it, so the static gallery's home page
        // renders the same leaderboards the consoles do. Every sibling object must
        // decide about the secret scrub (see the gg-runs note below): this one
        // deliberately does not opt in — the set is repo-authored catalog data
        // (committed slugs and display names), never model-written content.
        objects.push(json_object(
            format!("{prefix}/test-case-groups.json"),
            &TestCaseGroupsFile {
                schema_version: SCHEMA_VERSION,
                groups: self.test_case_groups.clone(),
            },
        )?);

        // comparisons.json — the published harness comparisons, each a full read
        // model (arms + distributions + diagnostics), plus a per-comparison file for
        // a direct fetch. Like the game-jam aggregate (and unlike the live-only
        // tournament), a comparison IS folded into the public snapshot. Each is
        // scrubbed like every other public document. An empty list emits an empty
        // index, which the site renders as "no comparisons yet".
        for comparison in &self.comparisons {
            let mut document = serde_json::to_value(ComparisonFile {
                schema_version: SCHEMA_VERSION,
                comparison: comparison.clone(),
            })
            .map_err(|e| {
                BackendError::Snapshot(format!(
                    "serializing published comparison {}: {e}",
                    comparison.id
                ))
            })?;
            if scrubber.scrub_json(&mut document) {
                tracing::warn!(
                    comparison = %comparison.id,
                    "redacted leaked API key(s) from a published comparison document"
                );
            }
            objects.push(json_object(
                format!("{prefix}/comparisons/{}.json", comparison.id),
                &document,
            )?);
        }
        objects.push(json_object(
            format!("{prefix}/comparisons.json"),
            &ComparisonsIndex {
                schema_version: SCHEMA_VERSION,
                comparisons: self.comparisons.clone(),
            },
        )?);

        // gg-runs.json — the gg **document** corpus, which the public site's Discover
        // surface evaluates in the browser with the mirrored evaluator. No backend, no
        // query endpoint, no round trip.
        //
        // Two boundaries meet here and both are load-bearing.
        //
        // **A session record is never exported.** A document carries configuration ids
        // and outcome numbers; a session record carries the complete model conversation
        // verbatim, which is why the corpus is publishable at all and the record is not.
        // The distinction is enforced upstream (nothing assembles a record into a
        // snapshot object) and asserted in this module's tests, because it is exactly
        // the kind of rule that erodes when someone reaches for "the run's other gg
        // artifact".
        //
        // **The scrubber runs here too.** `build` scrubs the per-run document by walking
        // it individually, so every *sibling* object it pushes has to opt in — a new
        // object added beside them bypasses redaction by default. This one opts in.
        let mut gg_runs = serde_json::to_value(GgRunsFile {
            schema_version: SCHEMA_VERSION,
            generated_at: generated_at
                .format(&Rfc3339)
                .map_err(|e| BackendError::Snapshot(format!("formatting generatedAt: {e}")))?,
            documents: self.gg_documents.clone(),
        })
        .map_err(|e| BackendError::Snapshot(format!("serializing the gg documents: {e}")))?;
        if scrubber.scrub_json(&mut gg_runs) {
            tracing::warn!("redacted leaked API key(s) from the published gg document corpus");
        }
        objects.push(json_object(format!("{prefix}/gg-runs.json"), &gg_runs)?);

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
                run_documents_prefix: format!("{RUN_DOCUMENT_PREFIX}/"),
                cases_prefix: format!("{prefix}/cases/"),
                models_key: format!("{prefix}/models.json"),
                comparisons_key: format!("{prefix}/comparisons.json"),
                comparisons_prefix: format!("{prefix}/comparisons/"),
                gg_runs_key: format!("{prefix}/gg-runs.json"),
                test_case_groups_key: Some(format!("{prefix}/test-case-groups.json")),
                case_showcases_key: Some(format!("{prefix}/case-showcases.json")),
            },
        )?;

        Ok(Snapshot {
            snapshot_id,
            objects,
            index,
            run_count: self.runs.len(),
            run_document_keys: document_keys.into_iter().collect(),
        })
    }

    /// The denormalized summary card for one run.
    ///
    /// This wraps [`RunSummary::from_stored`] and overrides only the fields the
    /// snapshot resolves differently from the bare stored run: `case_name` comes
    /// from the ingested case catalog (falling back to the slug), `score` is the
    /// aggregate reviewer score computed against that catalog entry's checklist
    /// weights, `document_key` points at the run's content-addressed document (the
    /// site follows it from here, since it is not derivable from the run id), and the
    /// snapshot only ever holds reviewed runs so `rating` is always `Some`.
    ///
    /// `case_index` is the catalog keyed by `(slug, version)`, built once per build so
    /// resolving a run's case is a lookup rather than a scan.
    fn summary(
        &self,
        run: &StoredRun,
        document_key: &str,
        case_index: &std::collections::HashMap<(&str, &str), &StoredManifest>,
    ) -> RunSummary {
        let record = &run.record;
        let manifest = case_index
            .get(&(
                record.subject.test_case_slug.as_str(),
                record.subject.test_case_version.as_str(),
            ))
            .copied();
        // A run of a case renamed on disk since (`pong` → Carom) has no entry in
        // the ingested set under its recorded slug; it still shows its current name.
        let case_name = manifest.map(|c| c.name.clone()).unwrap_or_else(|| {
            let slug = record.subject.test_case_slug.as_str();
            crate::store::RENAMED_SLUG_NAMES
                .iter()
                .find(|(old, _)| *old == slug)
                .map_or_else(|| slug.to_string(), |(_, name)| name.to_string())
        });
        // Score from the same catalog entry that names the case; both are absent
        // for a run whose case isn't in the ingested set.
        let score = manifest.and_then(|m| run_summary_score(m, record, &run.reviews));

        RunSummary {
            case_name,
            // The functional rating: the per-domain review aggregate on a legacy
            // run, or `None` for a game jam (it carries no domains — its badge is
            // `score.overallGrade` instead); the validator-decided rating on a
            // validator-rated run. A domain-scored published run always has one.
            rating: crate::db::functional_rating(manifest, record, &run.reviews),
            validator_rated: manifest.is_some_and(StoredManifest::validator_rated),
            score,
            document_key: Some(document_key.to_string()),
            ..RunSummary::from_stored(run)
        }
    }

    /// Collect a version's reference baselines: the `references[]` metadata
    /// entries (snapshot-relative keys) and the PNG objects to upload. Common
    /// references render under the `_common` scope and apply to every variant
    /// (`variant: null`); a variant's own references render under its slug scope.
    /// A declared baseline whose PNG is missing from the store is skipped rather
    /// than failing the whole snapshot.
    ///
    /// Each object is published under the content-stable, content-addressed
    /// [`CASE_MEDIA_PREFIX`] rather than this snapshot's prefix, so a baseline whose
    /// bytes have not changed is referenced by the key it already occupies instead
    /// of being re-uploaded on every refresh.
    fn case_references(
        &self,
        manifest: &StoredManifest,
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
            let key = format!(
                "{CASE_MEDIA_PREFIX}/{slug}/{version}/references/{scope}/{}-{file}",
                content_digest(&bytes)
            );
            // Already in the bucket under this exact content key: reference it and
            // skip the upload. The digest is over these same bytes, so a hit means
            // the object there is byte-identical to what we would have written.
            if !self.existing_media.contains(&key) {
                objects.push(SnapshotObject::media(key.clone(), bytes, &file));
            }
            metas.push(CaseReferenceOut {
                variant: variant.map(str::to_string),
                view: view.to_string(),
                kind: reference.kind,
                key,
            });
        }
        (metas, objects)
    }

    /// Collect a version's committed **baseline** validation media: the
    /// `validationBaselines[]` metadata entries (requested file name + snapshot-relative
    /// key) and the media objects to upload.
    ///
    /// The baseline is a fixed property of the case *version* — synthesized once at
    /// `tcab capture-baselines` time from the reference implementation and committed
    /// to the cold-storage submodule, then copied verbatim into the stored version's
    /// `validation-baseline/<engine>/<variant>/` at ingest — so it is published case-scoped, the invariant counterpart to the
    /// run-scoped *actual* media. Every committed file is enumerated per engine and
    /// variant ([`crate::store::DefinitionStore::list_validation_baseline`]), the
    /// same pairing the reference implementations themselves come in; a **video**
    /// baseline (`.webm`) is transcoded to `.mp4` for the public gallery, with `file`
    /// kept as the requested `.webm` so the gallery's flat lookup resolves, as the
    /// artifacts service publishes a run's own validation media. A transcode
    /// failure publishes the raw webm.
    ///
    /// The enumeration is deliberately of the *whole* committed directory rather than
    /// of the outputs some record declares, and that is what carries the recordings'
    /// **shared image store** (`img.<id>.png`/`img.<id>.bin`, see
    /// [`VALIDATION_IMAGE_PREFIX`](test_cabinet_contracts::layout::VALIDATION_IMAGE_PREFIX)) along
    /// with the baselines that name it: a store file backs no verdict and is on no
    /// declaration, so a record-driven loop would leave the published baseline replays
    /// resolving nothing. Do not "tidy" this into one.
    ///
    /// Published under the content-stable [`CASE_MEDIA_PREFIX`], keyed by a digest of
    /// the **source** bytes. Because the key is decided before the transcode, a
    /// baseline already in the bucket costs neither an upload nor an ffmpeg run — the
    /// dominant cost of a refresh over a corpus of video baselines. A **store** file
    /// is the one exception and is published under its bare name: it is a hash of its
    /// own bytes already, and a name a consumer can compose is what lets the gallery
    /// carry one URL prefix per subject instead of one entry per image.
    async fn case_validation_baselines(
        &self,
        manifest: &StoredManifest,
    ) -> (Vec<CaseValidationBaselineOut>, Vec<SnapshotObject>) {
        let (slug, version) = (&manifest.slug, &manifest.version);
        let mut metas = Vec::new();
        let mut objects = Vec::new();
        for engine in &manifest.engines {
            for variant in &manifest.variants {
                let Ok(files) =
                    self.store
                        .list_validation_baseline(slug, version, &engine.slug, &variant.slug)
                else {
                    continue;
                };
                for requested_file in files {
                    let Ok(raw) = self.store.read_validation_baseline(
                        slug,
                        version,
                        &engine.slug,
                        &variant.slug,
                        &requested_file,
                    ) else {
                        continue;
                    };
                    let prefix = format!(
                        "{CASE_MEDIA_PREFIX}/{slug}/{version}/validation-baseline/{}/{}",
                        engine.slug, variant.slug
                    );
                    // The published name is decided from the requested one, so the
                    // whole key — digest included — is known before any transcoding
                    // happens.
                    let is_video = requested_file.to_ascii_lowercase().ends_with(".webm");
                    let digest = content_digest(&raw);
                    let published_name = if is_video {
                        format!(
                            "{}.mp4",
                            &requested_file[..requested_file.len() - ".webm".len()]
                        )
                    } else {
                        requested_file.clone()
                    };
                    // A store file is EXEMPT from the digest, and must be: it is
                    // named by a hash of its own bytes already, so the digest would
                    // add nothing a re-publish could change, and the gallery resolves
                    // one by appending the name a recording carries to a prefix
                    // rather than by looking it up. Listing every store file
                    // individually is what that prefix exists to avoid — a busy
                    // reference's store runs to a file per unique image, and the
                    // static site inlines its lookup tables into the chunk every
                    // visitor downloads.
                    let stored_image =
                        test_cabinet_contracts::layout::is_validation_image_name(&requested_file);
                    let keyed = |name: &str| {
                        if stored_image {
                            format!("{prefix}/{name}")
                        } else {
                            format!("{prefix}/{digest}-{name}")
                        }
                    };
                    let key = keyed(&published_name);
                    // Already published from byte-identical source: reference it
                    // without re-uploading, and — the expensive half — without
                    // re-transcoding.
                    if self.existing_media.contains(&key) {
                        metas.push(CaseValidationBaselineOut {
                            engine: engine.slug.clone(),
                            variant: variant.slug.clone(),
                            file: requested_file,
                            key,
                        });
                        continue;
                    }

                    let (published_file, bytes) = if is_video {
                        match transcode_webm_to_mp4(&raw).await {
                            Some(mp4) => (published_name, mp4),
                            None => {
                                tracing::warn!(
                                    slug = %slug,
                                    version = %version,
                                    engine = %engine.slug,
                                    variant = %variant.slug,
                                    file = %requested_file,
                                    "webm→mp4 transcode unavailable; publishing raw baseline webm (not iOS-playable)"
                                );
                                (requested_file.clone(), raw)
                            }
                        }
                    } else {
                        (requested_file.clone(), raw)
                    };
                    // Re-derive the key from what was actually produced. It matches
                    // the probe key above on the happy path; on the transcode-failure
                    // path it deliberately differs, so the raw webm never occupies the
                    // `.mp4` key and a later refresh that *can* transcode still
                    // publishes the mp4 instead of skipping over a webm sitting under
                    // an mp4 name.
                    let key = keyed(&published_file);
                    objects.push(SnapshotObject::media(key.clone(), bytes, &published_file));
                    metas.push(CaseValidationBaselineOut {
                        engine: engine.slug.clone(),
                        variant: variant.slug.clone(),
                        file: requested_file,
                        key,
                    });
                }
            }
        }
        (metas, objects)
    }

    /// Collect a version's authored variant **showcases**: one exported
    /// [`CaseShowcaseOut`] per variant that declares one (keyed by variant slug),
    /// plus the media objects to upload.
    ///
    /// Media is published under the content-stable [`CASE_MEDIA_PREFIX`], keyed by
    /// a digest of the **source** bytes — exactly as a validation baseline is — so
    /// an unchanged file is referenced without an upload, and, for a video, without
    /// the ffmpeg run. A `.webm` clip is transcoded to `.mp4` for the public
    /// gallery with the metadata's `file` kept as authored (mirroring
    /// [`Self::case_validation_baselines`]); a transcode failure publishes the raw
    /// webm under its own name so the key never lies about its bytes. An entry
    /// whose bytes are missing from the store is skipped with a warning rather than
    /// failing the whole snapshot, like a missing reference baseline.
    async fn case_showcases(
        &self,
        manifest: &StoredManifest,
    ) -> (
        std::collections::HashMap<String, CaseShowcaseOut>,
        Vec<SnapshotObject>,
    ) {
        let (slug, version) = (&manifest.slug, &manifest.version);
        let mut showcases = std::collections::HashMap::new();
        let mut objects = Vec::new();
        for variant in &manifest.variants {
            let Some(showcase) = variant.showcase.as_ref() else {
                continue;
            };
            let mut metas = Vec::new();
            for media in &showcase.media {
                let Ok(raw) = self.store.read_artifact(slug, version, &media.key) else {
                    tracing::warn!(
                        slug = %slug,
                        version = %version,
                        variant = %variant.slug,
                        file = %media.file,
                        "showcase media missing from the store; omitting from case metadata"
                    );
                    continue;
                };
                let prefix = format!(
                    "{CASE_MEDIA_PREFIX}/{slug}/{version}/showcase/{}",
                    variant.slug
                );
                // The published name is decided from the authored one, so the whole
                // key — digest included — is known before any transcoding happens. A
                // video, by the entry's `MediaKind`, publishes as `.mp4`, while an
                // authored `.mp4` already carries that name and needs no transcode.
                let digest = content_digest(&raw);
                let published_name =
                    if media.kind == test_cabinet_suites::test_case::MediaKind::Video {
                        let stem = media
                            .file
                            .rsplit_once('.')
                            .map_or(media.file.as_str(), |(stem, _)| stem);
                        format!("{stem}.mp4")
                    } else {
                        media.file.clone()
                    };
                let key = format!("{prefix}/{digest}-{published_name}");
                // Already published from byte-identical source: reference it without
                // re-uploading, and — the expensive half — without re-transcoding.
                if self.existing_media.contains(&key) {
                    metas.push(CaseShowcaseMediaOut {
                        file: media.file.clone(),
                        name: media.name.clone(),
                        kind: media.kind,
                        key,
                    });
                    continue;
                }

                let (published_file, bytes) = if published_name != media.file {
                    match transcode_webm_to_mp4(&raw).await {
                        Some(mp4) => (published_name, mp4),
                        None => {
                            tracing::warn!(
                                slug = %slug,
                                version = %version,
                                variant = %variant.slug,
                                file = %media.file,
                                "webm→mp4 transcode unavailable; publishing raw showcase webm (not iOS-playable)"
                            );
                            (media.file.clone(), raw)
                        }
                    }
                } else {
                    (media.file.clone(), raw)
                };
                // Re-derive the key from what was actually produced, exactly as a
                // baseline does: on the transcode-failure path the raw webm never
                // occupies the `.mp4` key, so a later refresh that *can* transcode
                // still publishes the mp4.
                let key = format!("{prefix}/{digest}-{published_file}");
                objects.push(SnapshotObject::media(key.clone(), bytes, &published_file));
                metas.push(CaseShowcaseMediaOut {
                    file: media.file.clone(),
                    name: media.name.clone(),
                    kind: media.kind,
                    key,
                });
            }
            // Zero surviving media means the showcase is unreachable on the live
            // plane (resolution requires at least one entry, and every entry here
            // was missing from the store); keep it unreachable in the snapshot
            // rather than exporting an empty carousel.
            if metas.is_empty() {
                continue;
            }
            showcases.insert(
                variant.slug.clone(),
                CaseShowcaseOut {
                    description: showcase.description.clone(),
                    media: metas,
                },
            );
        }
        (showcases, objects)
    }

    /// Collect a version's starter-workspace files: the exported
    /// [`CaseWorkspaceFileOut`] sets keyed by variant slug and then by
    /// [engine](test_cabinet_suites::engine) slug, plus the file objects to upload.
    ///
    /// Each variant's effective workspace is its own override when it declares one,
    /// else the case's common workspace — the same fallback a run's seed applies.
    /// The bytes are published under the content-addressed [`CASE_FILES_PREFIX`]
    /// with text content labels ([`workspace_file_labels`]); because variants
    /// typically share the common workspace, identical bytes collapse onto one
    /// key, and the object is emitted once. A file whose bytes are missing from
    /// the store is skipped with a warning rather than failing the snapshot.
    fn case_workspace_files(
        &self,
        manifest: &StoredManifest,
    ) -> (VariantWorkspaceFiles, Vec<SnapshotObject>) {
        let (slug, version) = (&manifest.slug, &manifest.version);
        let mut by_variant = std::collections::HashMap::new();
        let mut objects = Vec::new();
        let mut emitted = std::collections::HashSet::new();
        // One read+digest per distinct source: variants routinely share the common
        // workspace (and engines share files), so without this the same bytes would
        // be re-read and re-hashed once per variant×engine combination. A missing
        // file memoizes as `None` so it is not re-probed either.
        let mut sources: std::collections::HashMap<&str, Option<(String, Vec<u8>)>> =
            std::collections::HashMap::new();
        for variant in &manifest.variants {
            let workspace = variant.workspace.as_ref().unwrap_or(&manifest.workspace);
            let mut by_engine = std::collections::BTreeMap::new();
            for (engine, files) in &workspace.0 {
                let mut metas = Vec::new();
                for file in files {
                    let source = sources.entry(file.source.as_str()).or_insert_with(|| {
                        self.store
                            .read_artifact(slug, version, &file.source)
                            .ok()
                            .map(|bytes| (content_digest(&bytes), bytes))
                    });
                    let Some((digest, bytes)) = source else {
                        tracing::warn!(
                            slug = %slug,
                            version = %version,
                            variant = %variant.slug,
                            file = %file.source,
                            "workspace file missing from the store; omitting from case metadata"
                        );
                        continue;
                    };
                    // Keyed by digest plus base name: the digest is what addresses
                    // the bytes (two `index.ts` under different directories do not
                    // collide), the base name is what keeps the bucket listable by
                    // a person.
                    let base_name = file.dest.rsplit('/').next().unwrap_or(&file.dest);
                    let key = format!(
                        "{CASE_FILES_PREFIX}/{slug}/{version}/workspace/{digest}-{base_name}"
                    );
                    // Variants sharing the common workspace (and engines sharing a
                    // file) collapse onto the same key; emit the object once — and
                    // not at all when a prior refresh already uploaded it (the
                    // existing-keys listing covers [`CASE_FILES_PREFIX`] too).
                    if emitted.insert(key.clone()) && !self.existing_media.contains(&key) {
                        let labels = workspace_file_labels(base_name);
                        objects.push(SnapshotObject {
                            key: key.clone(),
                            bytes: bytes.clone(),
                            content_type: labels.content_type.to_string(),
                            content_encoding: labels.content_encoding.map(str::to_string),
                        });
                    }
                    metas.push(CaseWorkspaceFileOut {
                        dest: file.dest.clone(),
                        key,
                    });
                }
                by_engine.insert(engine.clone(), metas);
            }
            by_variant.insert(variant.slug.clone(), by_engine);
        }
        (by_variant, objects)
    }

    /// Publish a run's **unbounded** code-analysis document as its own object, and
    /// return the key the per-run document points at it by.
    ///
    /// Three properties are load-bearing, and each is asserted by a test.
    ///
    /// **The record decides, not the store.** The bounded summary on the record is the
    /// authoritative statement that this run was analysed — the same posture proofs take
    /// — so a document left in the store by a run whose record carries none is not
    /// published. Absent an analysis there is nothing to publish and nothing to link.
    ///
    /// **The generation is in the key.** `media/runs/<id>/code-analysis/v<gen>.json`,
    /// keyed by the generation *the document was computed under* (off the record, not
    /// off [`CODE_ANALYZER_VERSION`](test_cabinet_contracts::code_analysis::CODE_ANALYZER_VERSION)
    /// — a later binary must not relabel an older result). That is what makes the object
    /// content-stable: [`with_existing_media`](Self::with_existing_media) skips it on
    /// every refresh after the first, so two refreshes upload it **once**, while a genuine
    /// re-analysis under a newer generation mints a new key instead of overwriting figures
    /// a published snapshot still points at.
    ///
    /// **It is scrubbed on its own.** [`build`](Self::build) walks and redacts the
    /// `PerRun` document and only that document, so a sibling object bypasses redaction
    /// entirely (R7). This one is a static read of model-written source — file paths and
    /// symbol names are text like any other, and model-written source contains hard-coded
    /// credentials often enough that the scrubber exists at all — so it goes through
    /// [`SecretScrubber::scrub_json`] here, as a parsed document rather than as opaque
    /// bytes.
    ///
    /// The stored bytes are gzip (what the driver mirrors from the run tree) or plain
    /// JSON (what a hand-written fixture or an older mirror holds); both are accepted, by
    /// the gzip magic, exactly as the serving route does. Anything unreadable or
    /// unparseable yields `None` and a warning rather than failing the refresh: the
    /// bounded summary still reaches the card and the record, so the surface degrades to
    /// the figures instead of offering a link that 404s. There is no artifact-service
    /// fallback for this document (the service exposes no route for a tree-root file), so
    /// a run whose ephemeral store copy is lost before its first publish keeps its summary
    /// and loses its explorer.
    fn run_code_analysis(
        &self,
        record: &RunRecord,
        scrubber: &SecretScrubber,
    ) -> (Option<String>, Option<SnapshotObject>) {
        let Some(summary) = record.code_analysis.as_ref() else {
            return (None, None);
        };
        let run_id = &record.id;
        let key = format!(
            "{MEDIA_PREFIX}/{run_id}/code-analysis/v{}.json",
            summary.analyzer_version
        );
        // Already in the bucket under this exact generation: reference it without
        // reading the source bytes, re-scrubbing or re-uploading. This is the whole
        // point of putting the generation in the key.
        if self.existing_media.contains(&key) {
            return (Some(key), None);
        }

        let Ok(stored) = self.store.read_run_code_analysis(run_id) else {
            tracing::warn!(
                run.id = %run_id,
                "run record carries a code analysis but its document is not stored; \
                 publishing the summary without the explorer"
            );
            return (None, None);
        };
        let plain = match decode_maybe_gzip(&stored) {
            Some(plain) => plain,
            None => {
                tracing::warn!(
                    run.id = %run_id,
                    "decoding the stored code-analysis document failed; publishing the \
                     summary without the explorer"
                );
                return (None, None);
            }
        };
        let mut document: serde_json::Value = match serde_json::from_slice(&plain) {
            Ok(document) => document,
            Err(err) => {
                tracing::warn!(
                    run.id = %run_id,
                    error = %err,
                    "the stored code-analysis document is not JSON; publishing the \
                     summary without the explorer"
                );
                return (None, None);
            }
        };
        if scrubber.scrub_json(&mut document) {
            tracing::warn!(
                run.id = %run_id,
                "redacted leaked API key(s) from a published code-analysis document"
            );
        }
        let Ok(bytes) = serde_json::to_vec(&document) else {
            return (None, None);
        };
        (
            Some(key.clone()),
            Some(SnapshotObject {
                key,
                bytes,
                content_type: "application/json".to_string(),
                content_encoding: None,
            }),
        )
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
    let dir = std::env::temp_dir().join(format!("tcab-proof-{}", cuid2::create_id()));
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

/// The top-level prefix every snapshot generation is written under.
pub const SNAPSHOT_PREFIX: &str = "snapshots/";

/// Select the bucket keys belonging to snapshot generations that are safe to prune.
///
/// Every refresh writes a whole new `snapshots/<id>/` generation and cuts over by
/// overwriting `index.json`. Nothing ever reaches an earlier generation again, so
/// without this the bucket grows by a full generation per publish forever.
///
/// A generation is pruned only when **both** hold:
///
/// 1. It is not the one `index.json` currently points at. That generation is the
///    live public dataset and is never touched, however old it is — a bucket whose
///    live snapshot predates the retention window (nothing published in a while) must
///    not have the site deleted out from under it.
/// 2. It is older than `retention`. A site build that already read `index.json` is
///    still fetching that generation's files, so a just-superseded generation has to
///    outlive the build it is serving. The window is the grace period.
///
/// A generation id that does not parse as a timestamp is **kept**: an id shape this
/// does not recognize is not something to delete on a guess.
///
/// The returned keys are exactly the input keys that belong to a pruned generation,
/// so a caller can hand each straight to
/// [`PublicDataset::delete`](crate::artifacts::PublicDataset::delete).
/// Keys outside [`SNAPSHOT_PREFIX`] are ignored entirely — run media, case media and
/// `index.json` are never candidates.
pub fn stale_generation_keys(
    keys: &[String],
    live_snapshot_id: &str,
    now: OffsetDateTime,
    retention: std::time::Duration,
) -> Vec<String> {
    let cutoff = now - time::Duration::seconds(retention.as_secs() as i64);
    keys.iter()
        .filter(|key| {
            let Some(id) = generation_id(key) else {
                return false;
            };
            if id == live_snapshot_id {
                return false;
            }
            generation_timestamp(id).is_some_and(|stamp| stamp < cutoff)
        })
        .cloned()
        .collect()
}

/// The `<id>` of `snapshots/<id>/…`, or `None` for a key outside that prefix (or a
/// bare `snapshots/<id>` with no trailing path, which no generation ever writes).
fn generation_id(key: &str) -> Option<&str> {
    let rest = key.strip_prefix(SNAPSHOT_PREFIX)?;
    let (id, _) = rest.split_once('/')?;
    (!id.is_empty()).then_some(id)
}

/// Recover the generation time from a snapshot id (`<compact-rfc3339>-<short-hash>`,
/// e.g. `2026-07-27T0437Z-6898b393`), the inverse of
/// [`SnapshotBuilder::snapshot_id`]. `None` when the id is not in that shape.
///
/// Reading the time out of the id rather than from each object's `LastModified`
/// keeps the decision to a single parse per generation and, more importantly, dates
/// a generation by when it was *built* rather than when its last object happened to
/// finish uploading.
fn generation_timestamp(id: &str) -> Option<OffsetDateTime> {
    // Split at the last `-`: the timestamp itself contains `-` separators.
    let (stamp, hash) = id.rsplit_once('-')?;
    if hash.is_empty() || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let format = format_description!("[year]-[month]-[day]T[hour][minute]Z");
    time::PrimitiveDateTime::parse(stamp, &format)
        .ok()
        .map(|dt| dt.assume_utc())
}

/// The short content digest a [`CASE_MEDIA_PREFIX`] or [`RUN_DOCUMENT_PREFIX`] key
/// carries: the first 16 hex characters (64 bits) of the SHA-256 of the object's
/// bytes.
///
/// Long enough that a collision across a corpus of a few thousand baselines and
/// documents is not a practical concern, short enough to keep keys readable.
/// Identical bytes always produce the identical key, which is what lets a refresh
/// skip re-uploading them.
fn content_digest(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))[..16].to_string()
}

/// The labels reference/proof/asset media is published under, from its file name.
///
/// The whole name is needed, not just the extension: a validator's draw-command
/// recording is published gzipped as it is stored, and only the compound `.json.gz`
/// suffix says the gzip is framing over a JSON document rather than the resource
/// itself.
fn media_labels(file: &str) -> ContentLabels {
    let extension = std::path::Path::new(file)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    match extension.to_ascii_lowercase().as_str() {
        "png" => ContentLabels::plain("image/png"),
        "jpg" | "jpeg" => ContentLabels::plain("image/jpeg"),
        "webp" => ContentLabels::plain("image/webp"),
        "gif" => ContentLabels::plain("image/gif"),
        "webm" => ContentLabels::plain("video/webm"),
        "mp4" => ContentLabels::plain("video/mp4"),
        "json" => ContentLabels::plain("application/json"),
        "gz" => content_labels::for_gz(file),
        // A showcase's description file — markdown a page renders, never raw bytes.
        "md" => ContentLabels::plain("text/markdown; charset=utf-8"),
        "glb" => ContentLabels::plain("model/gltf-binary"),
        "wav" => ContentLabels::plain("audio/wav"),
        "mid" | "midi" => ContentLabels::plain("audio/midi"),
        _ => ContentLabels::plain("application/octet-stream"),
    }
}

/// The labels a published starter-workspace file is served under, from its name.
///
/// A starter project is text by nature — sources, configs, docs — so the
/// fallback is `text/plain` rather than the octet-stream a media file would
/// default to: the gallery's Inputs viewer fetches these to *display* them, and
/// a browser handed octet-stream downloads instead. Extensions with a truer text
/// type get it; TypeScript deliberately maps to `text/plain` (its registered
/// type is a legacy video format, and no browser executes a fetched starter
/// file anyway).
fn workspace_file_labels(file: &str) -> ContentLabels {
    let extension = std::path::Path::new(file)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    match extension.to_ascii_lowercase().as_str() {
        "js" | "mjs" | "cjs" | "jsx" => ContentLabels::plain("text/javascript; charset=utf-8"),
        "json" => ContentLabels::plain("application/json"),
        "html" => ContentLabels::plain("text/html; charset=utf-8"),
        "css" => ContentLabels::plain("text/css; charset=utf-8"),
        "md" => ContentLabels::plain("text/markdown; charset=utf-8"),
        "svg" => ContentLabels::plain("image/svg+xml"),
        _ => ContentLabels::plain("text/plain; charset=utf-8"),
    }
}

impl SnapshotObject {
    /// A media object published under the labels its file name implies.
    fn media(key: String, bytes: Vec<u8>, file: &str) -> Self {
        let labels = media_labels(file);
        Self {
            key,
            bytes,
            content_type: labels.content_type.to_string(),
            content_encoding: labels.content_encoding.map(str::to_string),
        }
    }
}

/// Decode stored run-tree artifact bytes that may or may not be gzip, by the gzip
/// magic (RFC 1952 §2.3.1). `None` only when the bytes *claim* to be gzip and the
/// inflate fails.
///
/// The store holds these opaquely: the driver mirrors the run tree's `.json.gz`
/// verbatim, while a hand-written fixture (and an older mirror) holds plain JSON. The
/// serving route sniffs the same two bytes for the same reason — a JSON document never
/// begins `0x1f 0x8b`, so this cannot be ambiguous.
fn decode_maybe_gzip(stored: &[u8]) -> Option<Vec<u8>> {
    if !stored.starts_with(&[0x1f, 0x8b]) {
        return Some(stored.to_vec());
    }
    let mut plain = Vec::new();
    std::io::Read::read_to_end(
        &mut flate2::read::GzDecoder::new(std::io::Cursor::new(stored)),
        &mut plain,
    )
    .ok()?;
    Some(plain)
}

/// Serialize a value to a pretty JSON [`SnapshotObject`].
fn json_object<T: Serialize>(key: String, value: &T) -> Result<SnapshotObject> {
    Ok(SnapshotObject {
        key,
        bytes: serde_json::to_vec_pretty(value)?,
        content_type: "application/json".to_string(),
        content_encoding: None,
    })
}

impl Snapshot {
    /// The objects shared across generations: every run document, a case version's
    /// media and files, and a run's code-analysis document. Each is content-addressed
    /// (or keyed by an immutable run), so every one of them is written before the
    /// generation that names it.
    pub fn content_objects(&self) -> impl Iterator<Item = &SnapshotObject> {
        self.objects
            .iter()
            .filter(|object| !object.key.starts_with(SNAPSHOT_PREFIX))
    }

    /// The index objects of this generation, under `snapshots/<snapshot-id>/`.
    pub fn generation_objects(&self) -> impl Iterator<Item = &SnapshotObject> {
        self.objects
            .iter()
            .filter(|object| object.key.starts_with(SNAPSHOT_PREFIX))
    }
}

/// Write `objects` through the artifacts service, [`UPLOAD_CONCURRENCY`] at a time,
/// failing on the first write that does not land.
pub async fn write_objects<'a>(
    public: &crate::artifacts::PublicDataset,
    objects: impl Iterator<Item = &'a SnapshotObject>,
) -> Result<()> {
    use futures_util::TryStreamExt;

    futures_util::stream::iter(objects.map(Ok::<_, BackendError>))
        .try_for_each_concurrent(UPLOAD_CONCURRENCY, |object| async move {
            public
                .put(
                    &object.key,
                    object.bytes.clone(),
                    &object.content_type,
                    object.content_encoding.as_deref(),
                )
                .await
                .map_err(BackendError::from)
        })
        .await
}

/// Write a generated snapshot through the artifacts service's `PUT /public/{key}`,
/// in the order the [Atomic swap] section states.
///
/// The content-addressed objects go first (each run document, case media and file,
/// and code-analysis document the bucket does not already hold), then the index
/// objects of the new generation under `snapshots/<snapshot-id>/`, then the
/// top-level `index.json` pointer **last**, so the cut-over is atomic: a reader of
/// `index.json` always follows it to a complete generation whose documents and
/// media are already in place. Each phase is written concurrently. As soon as any
/// write fails the error propagates and `index.json` is never written, leaving the
/// previous generation live. Nothing is rebuilt or deployed after it.
///
/// [Atomic swap]: https://docs.testcabinet.ai/components/backend/snapshot/#atomic-swap
pub async fn write_snapshot(
    snapshot: &Snapshot,
    public: &crate::artifacts::PublicDataset,
) -> Result<()> {
    write_objects(public, snapshot.content_objects()).await?;
    write_objects(public, snapshot.generation_objects()).await?;
    // index.json last: this single small overwrite is the atomic cut-over.
    write_objects(public, std::iter::once(&snapshot.index)).await
}

/// The summary card of a stored run, built by the backend.
pub trait RunSummaryExt {
    /// Build a bounded summary card from a stored run; see the implementation.
    fn from_stored(run: &StoredRun) -> Self;
}

impl RunSummaryExt for RunSummary {
    /// Build a bounded summary card from a stored run, WITHOUT needing the case
    /// catalog. This is the single source of truth for the card fields shared by
    /// the public snapshot (`SnapshotBuilder::summary`) and the console's
    /// `GET /runs?fields=summary` listing.
    ///
    /// `rating` is the aggregate across the run's reviews, or `None` when the run
    /// carries no reviews yet (an unrated console run) — except on a
    /// validator-rated run, where it is the lifted functional rating the store
    /// maintains at push and on review-add (deriving it needs the case's
    /// checklist, which only the catalog holds, so the row carries the result).
    /// `case_name`
    /// falls back to the test-case slug; both callers substitute the real catalog
    /// name (the listing via `case_display_name`, the snapshot in
    /// `SnapshotBuilder::summary`).
    fn from_stored(run: &StoredRun) -> Self {
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
            rating: if run.validator_rated {
                run.rating
            } else {
                aggregate_rating_inner(record, &run.reviews)
            },
            aesthetic: aggregate_aesthetic_inner(&run.reviews),
            validator_rated: run.validator_rated,
            review_count: run.reviews.len(),
            // Catalog-free: the checklist weights live only in the case catalog,
            // so a caller that holds it enriches this (see [`run_summary_score`]).
            score: None,
            // Catalog-free: the fuel/correctness are already on the record, so the
            // card carries them directly (a performance run only).
            performance: record
                .validation
                .performance
                .as_ref()
                .map(|p| PerformanceSummaryOut {
                    correct: p.correct,
                    total_fuel: p.total_fuel,
                }),
            // Catalog-free for the same reason: the figures are already on the
            // record. `None` here is "never analysed", never "wrote no code".
            code: record
                .code_analysis
                .as_ref()
                .map(CodeSummaryOut::from_summary),
            // Only a published run has a document in the bucket, and only the snapshot
            // builder knows its digest; a console card carries none.
            document_key: None,
            links: links_out(&run.links),
        }
    }
}

/// Map a stored review to its snapshot wire shape: the reviewer recorded with it
/// and what they wrote.
fn review_out(review: &crate::db::StoredReview) -> Review {
    Review {
        reviewer: review.reviewer.clone(),
        ratings: review.ratings.clone(),
        // Legacy shape, never emitted: a stored legacy row's per-domain tiers are
        // already collapsed into the run-wide `aesthetic` at decode.
        aesthetics: Vec::new(),
        aesthetic: review.aesthetic,
        writeup: review.writeup.clone(),
        checklist: review.checklist.clone(),
        reviewed_at: review.reviewed_at.clone(),
        edited_at: review.edited_at.clone(),
        revisions: review.revisions.clone(),
    }
}

/// Read a set of seeded specs' inlined bodies from the store, in order. Each spec's
/// `source` (a store-relative artifact key) is read and decoded as UTF-8 text; a
/// spec whose bytes are missing (e.g. an ephemeral store not yet re-ingested) or
/// not valid UTF-8 is skipped rather than failing the whole snapshot, mirroring how
/// a missing reference baseline is skipped.
fn seeded_inputs(
    store: &DefinitionStore,
    manifest: &StoredManifest,
    variant: &crate::store::StoredVariant,
    engine: Option<&test_cabinet_suites::engine::ResolvedEngine>,
) -> Vec<CaseSeededInputOut> {
    // The variant's own volume overrides the case's, so a template spec renders at
    // this variant's actual dimensions — matching how the prompt and a run's seed
    // resolve `{{voxel}}`.
    let voxel = variant.voxel.as_ref().or(manifest.voxel.as_ref());
    // The full seeded set for this variant, in seed order: the common specs first,
    // then the variant's own. Each body is rendered for this variant, so a template
    // spec (`.hbs`) has its `{{#if (eq variant.slug …)}}` branches resolved and the
    // static gallery shows handlebars-free text — the spec analogue of how each
    // variant already carries its own rendered prompt. A spec whose bytes are
    // missing/not UTF-8, or whose template fails to render (exceptional — the same
    // template renders at seed time), is warned and skipped rather than failing the
    // whole snapshot, mirroring how a missing reference baseline is skipped.
    manifest
        .common_specs
        .iter()
        .chain(variant.specs.iter())
        .filter_map(|spec| {
            let text = store
                .read_rendered_spec(
                    &manifest.slug,
                    &manifest.version,
                    spec,
                    &variant.slug,
                    &variant.name,
                    variant.description.as_deref(),
                    voxel,
                    engine,
                )
                .inspect_err(|err| {
                    tracing::warn!(
                        slug = %manifest.slug,
                        version = %manifest.version,
                        variant = %variant.slug,
                        spec = %spec.source,
                        %err,
                        "rendering seeded spec for snapshot failed; omitting from case metadata"
                    );
                })
                .ok()?;
            Some(CaseSeededInputOut {
                path: spec.dest.clone(),
                text,
                kind: spec.kind,
            })
        })
        .collect()
}

/// Render one variant's prompt for `engine` off the stored manifest, exactly as a
/// run on that engine receives it (see [`crate::prompt::render_stored_prompt`]).
/// `None` renders the engineless form, and `suite` is the record of the suite
/// version a suite-defined manifest was lowered from.
fn render_case_prompt(
    manifest: &StoredManifest,
    variant: &crate::store::StoredVariant,
    suite: Option<&crate::suite_store::StoredSuite>,
    engine: Option<&test_cabinet_suites::engine::ResolvedEngine>,
) -> Result<String, BackendError> {
    crate::prompt::render_stored_prompt(manifest, variant, suite, engine).map_err(|e| {
        BackendError::Snapshot(format!(
            "rendering prompt for `{}@{}` variant `{}`: {e}",
            manifest.slug, manifest.version, variant.slug
        ))
    })
}

/// Build the case-metadata document for one ingested version (no mockup HTML, no
/// host paths — only the site-facing slice). Each variant's prompt is rendered
/// exactly as a run receives it, so the public gallery shows the same instruction
/// the consoles do, and the seeded spec files it references are inlined (bodies
/// read from `store`) so the fully static site can show them without a backend.
///
/// Both are rendered once engineless and once per declared engine that vendors a
/// runtime, because the templates branch on the selected engine (see
/// [`CaseVariantOut::engine_renderings`]).
#[allow(clippy::too_many_arguments)]
fn case_metadata(
    store: &DefinitionStore,
    manifest: &StoredManifest,
    references: Vec<CaseReferenceOut>,
    validation_baselines: Vec<CaseValidationBaselineOut>,
    reference_builds: Option<
        &std::collections::HashMap<String, std::collections::BTreeMap<String, String>>,
    >,
    reference_sheets: Option<&std::collections::HashMap<String, Vec<u32>>>,
    showcases: &std::collections::HashMap<String, CaseShowcaseOut>,
    workspace_files: &VariantWorkspaceFiles,
) -> Result<CaseMetadata, BackendError> {
    // A suite-defined version's prompt renders against the specifications its suite
    // version declares, so its record is read once for every rendering below.
    let suite = store.read_suite_of(manifest)?;
    let variants = manifest
        .variants
        .iter()
        .map(|v| {
            // The engineless rendering: what a reader browsing the case sees, and
            // exactly what a run on the `none` engine was handed.
            let prompt = render_case_prompt(manifest, v, suite.as_ref(), None)?;
            // Every engine this version declares that vendors a runtime, rendered
            // under its own branch of the templates so a run's Inputs surface can
            // show the text that run actually received. An engine slug this build
            // does not carry is skipped with a warning rather than failing the
            // snapshot, mirroring how a missing reference baseline is skipped.
            let mut engine_renderings = std::collections::BTreeMap::new();
            for support in &manifest.engines {
                if support.slug == test_cabinet_suites::engine::NONE_SLUG {
                    continue;
                }
                let resolved = match test_cabinet_engines::built_in_catalog().resolve(
                    &test_cabinet_suites::engine::EngineSelection::new(support.slug.clone()),
                ) {
                    Ok(resolved) => resolved,
                    Err(err) => {
                        tracing::warn!(
                            slug = %manifest.slug,
                            version = %manifest.version,
                            engine = %support.slug,
                            %err,
                            "resolving declared engine for snapshot failed; omitting its rendering"
                        );
                        continue;
                    }
                };
                engine_renderings.insert(
                    support.slug.clone(),
                    CaseVariantRenderingOut {
                        prompt: render_case_prompt(manifest, v, suite.as_ref(), Some(&resolved))?,
                        seeded_inputs: seeded_inputs(store, manifest, v, Some(&resolved)),
                        workspace_files: workspace_files
                            .get(&v.slug)
                            .and_then(|by_engine| by_engine.get(&support.slug))
                            .cloned()
                            .unwrap_or_default(),
                    },
                );
            }
            Ok(CaseVariantOut {
                slug: v.slug.clone(),
                name: v.name.clone(),
                description: v.description.clone(),
                prompt,
                seeded_inputs: seeded_inputs(store, manifest, v, None),
                engine_renderings,
                review_items: v.review_items.iter().map(case_review_item_out).collect(),
                domains: v.domains.iter().map(case_domain_out).collect(),
                reference_builds: reference_builds
                    .and_then(|builds| builds.get(&v.slug))
                    .cloned()
                    .unwrap_or_default(),
                reference_sheet: reference_sheets.and_then(|sheets| sheets.get(&v.slug)).map(
                    |frames| CaseReferenceSheetOut {
                        frames: frames.clone(),
                    },
                ),
                showcase: showcases.get(&v.slug).cloned(),
                // The engineless workspace — what a run on the `none` engine is
                // seeded with, matching the engineless prompt/spec rendering above.
                workspace_files: workspace_files
                    .get(&v.slug)
                    .and_then(|by_engine| by_engine.get(test_cabinet_suites::engine::NONE_SLUG))
                    .cloned()
                    .unwrap_or_default(),
            })
        })
        .collect::<Result<Vec<_>, BackendError>>()?;

    Ok(CaseMetadata {
        schema_version: SCHEMA_VERSION,
        slug: manifest.slug.clone(),
        version: manifest.version.clone(),
        name: manifest.name.clone(),
        test_type: manifest.test_type,
        engine_format: manifest.engine_format,
        asset_kind: manifest.asset_kind,
        sheet: manifest.sheet.clone(),
        difficulty: manifest.difficulty.clone(),
        tags: manifest.tags.clone(),
        summary: manifest.summary.clone(),
        description: manifest.description.clone(),
        changelog: manifest.changelog.clone(),
        variants,
        packages: manifest
            .packages
            .iter()
            .map(|name| CasePackageOut {
                name: name.clone(),
                description: test_cabinet_suites::test_case::shippable_package_description(name)
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
        validation_baselines,
        common_review_items: manifest
            .common_review_items
            .iter()
            .map(case_review_item_out)
            .collect(),
        domains: manifest.domains.iter().map(case_domain_out).collect(),
        errata: manifest.errata.iter().map(case_erratum_out).collect(),
    })
}

/// Map a stored known-issue erratum to its case-metadata wire shape.
fn case_erratum_out(erratum: &crate::store::StoredErratum) -> CaseErratumOut {
    CaseErratumOut {
        id: erratum.id.clone(),
        title: erratum.title.clone(),
        date: erratum.date.clone(),
        severity: erratum.severity,
        affects_scoring: erratum.affects_scoring,
        exclude_from_score: erratum.exclude_from_score,
        body: erratum.body.clone(),
        resolved_in: erratum.resolved_in.clone(),
        variant: erratum.variant.clone(),
        review: erratum.review.clone(),
    }
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
                description: sub.description.clone(),
                weight: sub.weight,
                reference: sub.reference.clone(),
                proof: sub.proof.clone(),
                failure_cap: sub.failure_cap,
                domains: sub.domains.clone(),
                validation: sub.validation.as_ref().map(case_review_validation_out),
            })
            .collect(),
        failure_cap: item.failure_cap,
        domains: item.domains.clone(),
        validation: item.validation.as_ref().map(case_review_validation_out),
    }
}

/// Map a stored point's validator to the case-metadata wire shape: its engine
/// scoping alone, which is what a client needs to tell whether a run built on a
/// given engine carries the point.
fn case_review_validation_out(
    validation: &crate::store::StoredReviewValidation,
) -> CaseReviewValidationOut {
    CaseReviewValidationOut {
        engines: validation.engines.clone(),
    }
}

/// A run's outbound links in the snapshot wire shape (owned).
fn links_out(links: &test_cabinet_contracts::run_record::RunLinks) -> LinksOut {
    LinksOut {
        source_repo: links.source_repo.clone(),
        playable_build: links.playable_build.clone(),
        code: links.code.clone(),
    }
}

/// The aggregate rating, or `None` when the run carries no reviews. Delegates to
/// [`crate::db::aggregate_review_rating`] — the single source of truth shared with
/// the lifted `run.rating` column.
fn aggregate_rating_inner(
    record: &test_cabinet_contracts::run_record::RunRecord,
    reviews: &[crate::db::StoredReview],
) -> Option<crate::review::Rating> {
    crate::db::aggregate_review_rating(record, reviews)
}

/// The aggregate aesthetic rating, or `None` when no review rated the aesthetic
/// channel. Delegates to [`crate::db::aggregate_review_aesthetic`] — the single
/// source of truth shared with the lifted `run.aesthetic` column.
fn aggregate_aesthetic_inner(
    reviews: &[crate::db::StoredReview],
) -> Option<crate::review::AestheticRating> {
    crate::db::aggregate_review_aesthetic(reviews)
}

/// The score for a run of `manifest`'s `variant`. On a **validator-rated** version
/// the validators' score as overridden by the run's reviews
/// ([`crate::review::validator_aggregate_score`]: each review's
/// checklist overlays the validators' verdicts and the run averages the reviews'
/// effective scores; with zero reviews the validators' own figure stands), always
/// `Some`; an effective checklist that decides no scored point scores zero over the
/// declared weight. Otherwise the aggregate reviewer score: the case's declared checklist
/// weights scored against each of the run's `reviews`, then averaged (see
/// [`crate::review::aggregate_score`]), `None` when the run carries no
/// reviews. Either way `None` for a run whose terminal state is not
/// [scored](test_cabinet_contracts::run_record::RunState::is_scored) — a failure tier
/// has no checklist to score, and a validator-rated one ran no validator to score
/// it with.
///
/// The checklist weights live only in the case catalog (the manifest), never on a
/// run or review, so this is the single source of truth shared by the two callers
/// that hold both a run's reviews and its case: the console `GET /runs?fields=summary`
/// listing (which reads the manifest from the store) and the public snapshot
/// builder (which holds it in memory). It is the backend analogue of
/// [`RunSummary::from_stored`] enriching `case_name`.
pub(crate) fn run_summary_score(
    manifest: &StoredManifest,
    record: &test_cabinet_contracts::run_record::RunRecord,
    reviews: &[crate::db::StoredReview],
) -> Option<RunScoreOut> {
    if !record.status.state.is_scored() {
        return None;
    }
    let items = review_items_for_engine(
        manifest,
        &record.subject.variant,
        &record.subject.engine_slug,
    );
    // A validator-rated run is scored by its validators, as overridden by its
    // reviews: the score is known the moment the run completes (`reviews` is `0`,
    // the validators' own figure), and each review's overrides overlay the
    // validators' verdicts, the run averaging the reviews' effective scores. A jam
    // is never validator-rated, so it has no overall grade here.
    if manifest.validator_rated() {
        let auto = crate::comparison::automated_verdicts(&record.validation.debug_scripts);
        let score = crate::review::validator_aggregate_score(
            record.gated_broken(),
            &items,
            &auto,
            reviews.iter().map(|review| review.checklist.as_slice()),
        );
        return Some(RunScoreOut {
            earned: score.earned,
            total: score.total,
            reviews: score.reviews,
            overall_grade: None,
        });
    }
    let scores: Vec<_> = reviews
        .iter()
        .map(|review| crate::review::score_checklist(&items, &review.checklist))
        .collect();
    // A run disqualified by its case's gating typecheck scores zero and, for a jam,
    // grades `broken` — over the top of whatever its reviewers concluded, and without
    // touching what they wrote. See `crate::review::gated_score`.
    let gated = record.gated_broken();
    let overall_grade = crate::review::gated_overall_grade(
        gated,
        crate::review::aggregate_overall_grade(
            reviews.iter().map(|review| review.checklist.as_slice()),
        ),
    );
    crate::review::gated_score(gated, crate::review::aggregate_score(&scores)).map(|score| {
        RunScoreOut {
            earned: score.earned,
            total: score.total,
            reviews: score.reviews,
            overall_grade,
        }
    })
}

/// The effective weighted checklist items for a run of `variant`: the case's
/// common items merged with the selected variant's own by id (mirrors
/// [`test_cabinet_suites::test_case::TestCaseVersion::review_items_for`], resolving
/// from the stored manifest — a variant that reuses a common category's id folds
/// its items into that category). An unrecognized variant contributes only the
/// common items.
///
/// `pub(crate)` because the comparisons API reuses it to resolve the effective
/// items its automated-only scorer restricts to (see `crate::api::comparisons`).
pub(crate) fn review_items_for(
    manifest: &StoredManifest,
    variant: &str,
) -> Vec<test_cabinet_suites::test_case::ReviewItem> {
    let common: Vec<_> = manifest
        .common_review_items
        .iter()
        .map(core_review_item)
        .collect();
    let own: Vec<_> = manifest
        .variants
        .iter()
        .find(|candidate| candidate.slug == variant)
        .into_iter()
        .flat_map(|candidate| candidate.review_items.iter())
        .map(core_review_item)
        .collect();
    let mut items = test_cabinet_suites::test_case::merge_review_items(&common, &own);
    // Mirror `TestCaseVersion::review_items_for`: drop the version's scoring-excluded
    // points (an erratum with `exclude_from_score`, in scope for this variant) from the
    // score by clearing their `scored` flag. Keeps this backend score in step with the
    // reviewer UI and the core scorer.
    let excluded: std::collections::HashSet<String> = manifest
        .errata
        .iter()
        .filter(|erratum| erratum.exclude_from_score)
        .filter(|erratum| {
            erratum
                .variant
                .as_deref()
                .is_none_or(|scope| scope == variant)
        })
        .filter_map(|erratum| erratum.review.clone())
        .collect();
    test_cabinet_suites::test_case::apply_score_exclusions(&mut items, &excluded);
    items
}

/// The effective weighted checklist items for a run of `variant` built on `engine`:
/// [`review_items_for`] with the points that engine does not carry removed (mirrors
/// [`test_cabinet_suites::test_case::TestCaseVersion::review_items_for_engine`]).
///
/// A validator scoped to a set of engines decides its point only on those, so a run
/// on any other engine does not carry the point at all: no verdict is recorded
/// against it, it is not shown to the reviewer, and it contributes no weight to the
/// run's score. An item that declared sub-items and has none left after the filter
/// goes with them.
///
/// This is the form every **run-scoped** caller wants. [`review_items_for`] stays the
/// right call for a catalog listing or a case page, which describe the case rather
/// than one run of it.
pub(crate) fn review_items_for_engine(
    manifest: &StoredManifest,
    variant: &str,
    engine: &str,
) -> Vec<test_cabinet_suites::test_case::ReviewItem> {
    let mut items = review_items_for(manifest, variant);
    items.retain_mut(|item| {
        if item
            .validation
            .as_ref()
            .is_some_and(|validation| !validation.covers(engine))
        {
            return false;
        }
        let declared_sub_items = !item.sub_items.is_empty();
        item.sub_items.retain(|sub| {
            sub.validation
                .as_ref()
                .is_none_or(|validation| validation.covers(engine))
        });
        !declared_sub_items || !item.sub_items.is_empty()
    });
    items
}

/// The effective scoring domains for a run of `variant`: the case's common domains
/// followed by the selected variant's own (mirrors
/// [`test_cabinet_suites::test_case::TestCaseVersion::domains_for`], resolving from
/// the stored manifest). An unrecognized variant contributes only the common
/// domains. These are the domains a validator-rated run's functional rating is
/// decided per ([`crate::review::validator_domain_ratings`]) and the
/// ones its review must rate on the aesthetic scale.
pub(crate) fn domains_for(
    manifest: &StoredManifest,
    variant: &str,
) -> Vec<test_cabinet_suites::test_case::Domain> {
    manifest
        .domains
        .iter()
        .chain(
            manifest
                .variants
                .iter()
                .find(|candidate| candidate.slug == variant)
                .into_iter()
                .flat_map(|candidate| candidate.domains.iter()),
        )
        .map(|domain| test_cabinet_suites::test_case::Domain {
            id: domain.id.clone(),
            name: domain.name.clone(),
            description: domain.description.clone(),
        })
        .collect()
}

/// Reconstruct the core [`test_cabinet_suites::test_case::ReviewItem`] a stored item was
/// ingested from — the inverse of `ingest::stored_review_item`. Scoring reads
/// `id`, `weight`, and `sub_items` (a sub-itemed item is scored per sub-item), and
/// the round trip keeps the rest of the item whole so it stays honest.
fn core_review_item(
    item: &crate::store::StoredReviewItem,
) -> test_cabinet_suites::test_case::ReviewItem {
    test_cabinet_suites::test_case::ReviewItem {
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
            .map(|sub| test_cabinet_suites::test_case::SubReviewItem {
                id: sub.id.clone(),
                title: sub.title.clone(),
                description: sub.description.clone(),
                weight: sub.weight,
                reference: sub.reference.clone(),
                proof: sub.proof.clone(),
                // Pristine reconstruction: scoring exclusions are re-derived from the
                // manifest's errata by `review_items_for`, never stored on the item.
                scored: true,
                validation: sub.validation.as_ref().map(core_review_validation),
                failure_cap: sub.failure_cap,
                domains: sub.domains.clone(),
            })
            .collect(),
        scored: true,
        failure_cap: item.failure_cap,
        domains: item.domains.clone(),
        // Reporter-side auto-validation driver, reconstructed from the stored item so
        // the round trip stays whole (present on the item when validated as a whole, or
        // on each sub-item above once sub-divided).
        validation: item.validation.as_ref().map(core_review_validation),
    }
}

/// Reconstruct a core [`test_cabinet_suites::test_case::ReviewValidation`] from its stored shape.
/// A snapshot-sourced driver is used only for scoring (which reads `weight`/`sub_items`),
/// never to run the script, so its `script` is the stored version-folder-relative key
/// rather than a host path — it is never materialized or executed on this path. Shared
/// by the item-level and per-sub-item drivers.
fn core_review_validation(
    validation: &crate::store::StoredReviewValidation,
) -> test_cabinet_suites::test_case::ReviewValidation {
    test_cabinet_suites::test_case::ReviewValidation {
        script: (!validation.per_engine).then(|| std::path::PathBuf::from(&validation.script)),
        script_rel: validation.script.clone(),
        engines: validation.engines.clone(),
        outputs: validation
            .outputs
            .iter()
            .map(|output| test_cabinet_suites::test_case::ReviewOutput {
                id: output.id.clone(),
                name: output.name.clone(),
                kind: output.kind,
            })
            .collect(),
    }
}

#[cfg(test)]
#[path = "snapshot.test.rs"]
mod tests;
