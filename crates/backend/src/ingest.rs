//! Ingest: scanning the configured checkout and copying definitions into the
//! store (§0/§1.1 of `design/v0.2.0-contracts.md`).
//!
//! On `POST /ingest` the backend reads `test-cases/` from the checkout it is
//! pointed at and **copies** each version into the immutable definition store,
//! served verbatim afterward (publishing caches, it does not transform). It also
//! renders the reference mockups to screenshots at this point, so every runner
//! shares the same baseline.
//!
//! A version's baseline validation media is not in its folder: it lives in the
//! checkout's cold-storage submodule (see [`ColdStorage`]). Ingest copies it into the
//! stored version under `validation-baseline/`, so the store serves and snapshots it
//! as part of the version. A checkout without the submodule ingests every version
//! with no baseline media.
//!
//! Container images are **not** ingested from the checkout: they are distributed
//! via a registry and pulled by digest by each runner from its own
//! configuration. The backend is out of the container path entirely.
//!
//! It also reads `test-suites/`, the [test
//! suite](https://docs.testcabinet.ai/test-suites/overview/) checkout beside it:
//! every definition a suite version offers is lowered onto a `TestCaseVersion` and
//! written into the same keyed tree an authored version is, and the suite's own
//! entities are written into the sibling [suite key space](crate::suite_store).
//! The suite half lives in `ingest.suites.rs`.
//!
//! Ingest is idempotent: an already-present, unchanged `(slug, version)` is a
//! no-op. `force` re-ingests and re-renders even when unchanged.
//!
//! A backend configured to ingest previews also reads the suites checkout's
//! `.previews/` folder, where The Spec Cabinet writes a draft's preview as a suite
//! version at the prerelease `v0.0.0-preview.<draft>`. A preview is enumerated,
//! targeted, digested and pruned exactly as an exported version is; a backend not
//! configured for them never reads the folder.
//!
//! Every record ingest writes carries an [`IngestStamp`] naming the content digest
//! it was built from (see [`test_cabinet_core::content_digest`]), so a
//! [`IngestMode::Changed`] scan rewrites exactly the versions whose checkout content
//! differs from the store.

use std::path::{Path, PathBuf};

use test_cabinet_core::test_case::{TestCaseCatalog, TestCaseVersion, is_seeded_dotfile};
use test_cabinet_core::test_case_group::TestCaseGroupCatalog;
use test_cabinet_core::test_suite::{PREVIEWS_DIR, TEST_SUITES_DIR, TestSuiteCatalog};
use test_cabinet_core::{ColdStorage, IngestMode};

use crate::error::{BackendError, Result};
use crate::render;
use crate::store::{
    DefinitionStore, IngestStamp, STORE_FORMAT, StoredAsset, StoredBuild, StoredCanvas, StoredCase,
    StoredCheck, StoredContract, StoredDomain, StoredErratum, StoredInstrumentation,
    StoredManifest, StoredMatch, StoredOutput, StoredProof, StoredReference, StoredReplay,
    StoredReviewItem, StoredReviewOutput, StoredReviewValidation, StoredSandbox, StoredShowcase,
    StoredShowcaseMedia, StoredSimulation, StoredSpec, StoredSubReviewItem, StoredSuiteCoordinate,
    StoredTool, StoredVariant, StoredWorkspace, StoredWorkspaceFile, reference_in,
    write_ingest_stamp_in, write_manifest_in,
};

/// The content digests a stored version records, shared with every client that
/// compares a checkout against the store.
use test_cabinet_core::content_digest as digest;
#[path = "ingest.suites.rs"]
mod suites;

pub use suites::IngestedSuite;

/// Optional restrictions on an ingest scan (the `POST /ingest` request body).
#[derive(Debug, Clone, Default)]
pub struct IngestRequest {
    /// Restrict to these entries (a full scan when `None`). Each entry is either a
    /// bare case `id` — its slug or folder name, expanding to every version the case
    /// declares — or a version-qualified `id@version`, targeting exactly that one
    /// version so a single edited version can be re-ingested without re-rendering the
    /// case's other versions. An entry the authored catalog does not know is offered
    /// to the suites tree in the same two spellings: a suite slug expands to every
    /// definition of every version it declares, and `<suite>@<version>` to every
    /// definition of that one version.
    pub test_cases: Option<Vec<String>>,
    /// Re-ingest and re-render even when unchanged.
    pub force: bool,
    /// Which already-stored targets a scan without `force` rewrites: none
    /// ([`IngestMode::Absent`]), or those whose checkout content differs from the
    /// store ([`IngestMode::Changed`]).
    pub mode: IngestMode,
    /// An opaque version token identifying the catalog content of a whole-catalog
    /// ingest (the client's build commit). When supplied and unchanged from the
    /// store's recorded marker, the scan reuses the already-ingested versions
    /// instead of re-rendering them; when changed (or first-seen) it forces a full
    /// re-ingest and records the new token. Ignored for a partial (`test_cases`)
    /// scan, which neither consults nor moves the whole-catalog marker.
    pub catalog_version: Option<String>,
}

/// What one scan touches, resolved out of the checkout's two trees.
///
/// The suite records are kept apart from the versions because they are keyed apart:
/// a suite version's own entities live in the [suite key space](crate::suite_store)
/// while the definitions it offers become ordinary test-case versions.
#[derive(Debug, Clone, Default, PartialEq)]
struct Targets {
    /// The suite versions whose own record the scan (re)writes, as
    /// `(suite slug, version folder)`.
    suites: Vec<(String, String)>,
    /// The test-case versions the scan (re)writes, authored and suite-defined
    /// alike.
    versions: Vec<Target>,
}

/// One test-case version a scan touches.
#[derive(Debug, Clone, PartialEq)]
enum Target {
    /// An authored case version, by the id the entry named (a slug or a folder
    /// name) and the version string.
    Case {
        /// The slug or folder name the entry named.
        id: String,
        /// The version folder name.
        version: String,
    },
    /// One definition of one suite version, lowered onto a test-case version.
    Definition {
        /// The suite's slug.
        suite: String,
        /// The suite version folder name.
        version: String,
        /// The definition's file stem under `test-cases/`.
        definition: String,
    },
}

/// The outcome of ingesting one test-case version.
#[derive(Debug, Clone, PartialEq)]
pub struct IngestedVersion {
    /// Case slug.
    pub slug: String,
    /// Version string.
    pub version: String,
    /// Whether this call ingested (copied/rendered) it, vs. skipped as unchanged.
    pub ingested: bool,
    /// How many reference screenshots were rendered (0 when skipped).
    pub rendered_references: usize,
    /// Why a skipped version was skipped, when the scan names a reason. `None` for
    /// an ingested version, and for one a scan in [`IngestMode::Absent`] skipped
    /// because the store already held it.
    pub reason: Option<SkipReason>,
    /// Why the version could not be ingested, naming the file and the failure. Set
    /// only on a version reported with `ingested: false` because it failed to
    /// resolve, which a whole-catalog scan prunes like a version the checkout no
    /// longer declares.
    pub problem: Option<String>,
}

/// Why a scan skipped a target it was asked about.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkipReason {
    /// A [`IngestMode::Changed`] scan found the stored record's digest, record
    /// format and catalog version all matching the checkout.
    Unchanged,
}

impl SkipReason {
    /// The wire spelling of the reason.
    pub fn as_str(self) -> &'static str {
        match self {
            SkipReason::Unchanged => "unchanged",
        }
    }
}

/// Whether one target is rewritten, decided the same way for every kind of record
/// a scan writes.
#[derive(Debug, Clone)]
struct Decider {
    /// Rewrite every target.
    force: bool,
    /// Which stored targets a scan without `force` rewrites.
    mode: IngestMode,
    /// The catalog version the store is at once this scan completes: the scan's own
    /// token, or the store's recorded marker when the scan carries none.
    catalog_version: Option<String>,
}

/// The outcome of [`Decider::decide`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Decision {
    /// Build the target and write its record.
    Ingest,
    /// Leave the stored record in place, for the reason given.
    Skip(Option<SkipReason>),
}

impl Decider {
    /// Whether a target is skipped before its digest is worth computing: a scan in
    /// [`IngestMode::Absent`] skips whatever the store already holds.
    fn skips_as_stored(&self, has_record: bool) -> bool {
        !self.force && self.mode == IngestMode::Absent && has_record
    }

    /// Decide one target from whether the store holds its record, the stamp that
    /// record carries (read only when the mode needs it), and the checkout's
    /// current digest.
    fn decide(
        &self,
        has_record: bool,
        stored: impl FnOnce() -> Option<IngestStamp>,
        digest: &str,
    ) -> Decision {
        if self.force || !has_record {
            return Decision::Ingest;
        }
        match self.mode {
            IngestMode::Absent => Decision::Skip(None),
            IngestMode::Changed => match stored() {
                Some(stamp)
                    if stamp.digest == digest
                        && stamp.format == STORE_FORMAT
                        && stamp.catalog_version == self.catalog_version =>
                {
                    Decision::Skip(Some(SkipReason::Unchanged))
                }
                _ => Decision::Ingest,
            },
        }
    }

    /// The stamp a record built from `digest` is written with.
    fn stamp(&self, digest: String) -> IngestStamp {
        IngestStamp {
            digest,
            format: STORE_FORMAT,
            catalog_version: self.catalog_version.clone(),
        }
    }
}

/// The suite version digests one scan has computed, shared by a suite's own record
/// and every definition lowered from it, since all of them are built from the same
/// files. A digest is computed on first use, so a scan that skips everything a suite
/// version produced as already stored never reads that version's files.
#[derive(Debug, Default)]
struct SuiteDigests(std::cell::RefCell<std::collections::HashMap<(String, String), String>>);

impl SuiteDigests {
    /// The digest of `slug@version`, computed through `ingestor` the first time it
    /// is asked for.
    fn get(&self, ingestor: &Ingestor<'_>, slug: &str, version: &str) -> Result<String> {
        let key = (slug.to_string(), version.to_string());
        if let Some(digest) = self.0.borrow().get(&key) {
            return Ok(digest.clone());
        }
        let digest = ingestor.suite_digest(slug, version)?;
        self.0.borrow_mut().insert(key, digest.clone());
        Ok(digest)
    }
}

/// The full result of an ingest scan.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct IngestReport {
    /// One entry per scanned test-case version, a suite-defined one included: a
    /// definition is lowered into exactly the record an authored case produces, so
    /// it is reported here under the catalog identity it was ingested as.
    pub test_case_versions: Vec<IngestedVersion>,
    /// One entry per scanned suite version — the suite's *own* record, which is
    /// keyed beside the definitions it offers rather than among them.
    pub suite_versions: Vec<IngestedSuite>,
    /// Whether the scan changed the store's [test-case
    /// group](test_cabinet_core::TestCaseGroup) set. Only a whole-catalog scan
    /// reconciles the set (a partial scan leaves it untouched and reports
    /// `false`), and the flag is what lets a group-only edit trigger the public
    /// snapshot refresh even though no version was re-ingested.
    pub test_case_groups_changed: bool,
}

/// A progress event emitted as a [`Ingestor::scan_with_progress`] scan advances, so
/// a caller can stream per-version progress rather than wait for the whole report.
/// Events are advisory; the returned [`IngestReport`] is the authoritative outcome.
#[derive(Debug, Clone, PartialEq)]
pub enum IngestEvent<'a> {
    /// Emitted once before the first version, carrying the count to be scanned.
    Start {
        /// Total test-case versions this scan will touch.
        total: usize,
    },
    /// Emitted after each version is ingested (or skipped as unchanged).
    Version {
        /// 1-based position of this version within the scan.
        index: usize,
        /// Total versions in the scan (the same value as [`IngestEvent::Start`]).
        total: usize,
        /// The just-finished version's outcome.
        version: &'a IngestedVersion,
    },
}

/// Ingests definitions from a checkout into a definition store.
pub struct Ingestor<'a> {
    checkout: &'a Path,
    store: &'a DefinitionStore,
    /// Where each version's baseline validation media is read from.
    cold: ColdStorage,
    /// `(slug, version)` pairs a whole-catalog scan must never prune even when the
    /// checkout no longer declares them — the definitions still-referencing runs
    /// depend on. Empty by default (prune everything absent); set via
    /// [`with_protected_cases`](Self::with_protected_cases).
    protected: std::collections::HashSet<(String, String)>,
    /// Whether the suites checkout's `.previews/` folder is read
    /// (`TCAB_BACKEND_INGEST_PREVIEWS`). Off by default, and then no path into the
    /// folder is ever composed.
    previews: bool,
}

impl<'a> Ingestor<'a> {
    /// Create an ingestor over a checkout path and a target store. Baseline media is
    /// read from the checkout's cold storage ([`ColdStorage::for_checkout`]).
    pub fn new(checkout: &'a Path, store: &'a DefinitionStore) -> Self {
        Self {
            checkout,
            store,
            cold: ColdStorage::for_checkout(checkout),
            protected: std::collections::HashSet::new(),
            previews: false,
        }
    }

    /// Read baseline media from `cold` instead of the checkout's own cold storage.
    pub fn with_cold_storage(mut self, cold: ColdStorage) -> Self {
        self.cold = cold;
        self
    }

    /// Also ingest the previews The Spec Cabinet writes to the suites checkout's
    /// `.previews/` folder, when `previews` is set — the backend's
    /// [`ingest_previews`](crate::config::Config::ingest_previews). A whole-catalog
    /// scan then enumerates them beside the exported versions, so it also prunes a
    /// preview the folder no longer holds.
    pub fn with_previews(mut self, previews: bool) -> Self {
        self.previews = previews;
        self
    }

    /// Protect these `(slug, version)` pairs from the whole-catalog prune — the set a
    /// run references (see [`crate::db::Db::referenced_cases`]), so a stale definition
    /// a published or pending run still needs is kept rather than dropped.
    pub fn with_protected_cases(
        mut self,
        protected: std::collections::HashSet<(String, String)>,
    ) -> Self {
        self.protected = protected;
        self
    }

    /// Run a scan, honoring the request's restrictions and `force` flag.
    pub fn scan(&self, request: &IngestRequest) -> Result<IngestReport> {
        self.scan_with_progress(request, |_| {})
    }

    /// Like [`scan`](Self::scan), but invoke `on_event` as each version completes so
    /// the caller can stream progress. A whole-catalog scan renders every case's
    /// references and otherwise answers only once the last one is done; emitting a
    /// [`IngestEvent`] per version lets the trigger report progress instead of
    /// stalling silently for the minute-plus a full re-render takes.
    pub fn scan_with_progress(
        &self,
        request: &IngestRequest,
        mut on_event: impl FnMut(IngestEvent),
    ) -> Result<IngestReport> {
        // A store holding versions written in another record format holds nothing
        // this build can read, so a partial scan cannot leave it coherent and there
        // is nothing in it worth skipping: whatever was asked for is promoted to a
        // forced whole-catalog scan, which rewrites every version in the format this
        // build reads. This is the repair after a backend upgrade that changed the
        // stored shapes, reached from any ingest rather than only an explicitly
        // forced one.
        let stale = self.store.needs_reingest();
        let mut effective = request.clone();
        if stale {
            tracing::warn!(
                "definition store was written in another record format; re-ingesting \
                 the whole catalog"
            );
            effective.test_cases = None;
            effective.force = true;
        }
        let request = &effective;

        // A whole-catalog ingest can carry a version token (the client's build
        // commit). When it matches what the store last ingested, the catalog is
        // unchanged and the per-version skip path (below) does the cheap thing; when
        // it differs or is first-seen, the content may have changed under unchanged
        // version strings, so the whole catalog is force re-ingested. A partial scan
        // (`test_cases` set) never participates — its marker would falsely claim the
        // whole catalog.
        let whole_catalog = request.test_cases.is_none();
        let tagged = whole_catalog
            .then_some(request.catalog_version.as_deref())
            .flatten();
        let unchanged = tagged.is_some() && self.store.catalog_version().as_deref() == tagged;
        let force = request.force || (tagged.is_some() && !unchanged);
        let decider = Decider {
            force,
            mode: request.mode,
            catalog_version: tagged
                .map(str::to_string)
                .or_else(|| self.store.catalog_version()),
        };

        let mut targets = self.version_targets(request)?;

        let mut report = IngestReport::default();
        // The suite records first: a definition's stored version names the suite it
        // came from, so the suite it names is in the store by the time any client
        // can follow the coordinate. A suite version that cannot be ingested offers
        // no cases either — a case whose suite is unservable is a case nothing can
        // present — so its definitions are dropped from the scan with it, which
        // leaves the prune to clear whatever they had left in the store.
        let mut refused: Vec<IngestedVersion> = Vec::new();
        // Each suite version's digest is computed at most once, and only when some
        // record built from it is decided on content or written.
        let suite_digests = SuiteDigests::default();
        for (slug, version) in &targets.suites {
            let ingested = self.ingest_suite(slug, version, &decider, &suite_digests)?;
            if let Some(problem) = &ingested.problem {
                refused.push(IngestedVersion {
                    slug: slug.clone(),
                    version: version.clone(),
                    ingested: false,
                    rendered_references: 0,
                    reason: None,
                    problem: Some(problem.clone()),
                });
            }
            report.suite_versions.push(ingested);
        }
        targets.versions.retain(|target| match target {
            Target::Case { .. } => true,
            Target::Definition { suite, version, .. } => !refused
                .iter()
                .any(|failed| failed.slug == *suite && failed.version == *version),
        });

        // A refused suite version is reported in the feed as the one version it is,
        // ahead of the definitions that did get scanned, so a client sees why every
        // case it offers is absent.
        let total = refused.len() + targets.versions.len();
        on_event(IngestEvent::Start { total });
        for (index, failed) in refused.iter().enumerate() {
            on_event(IngestEvent::Version {
                index: index + 1,
                total,
                version: failed,
            });
        }
        for (index, target) in targets.versions.into_iter().enumerate() {
            let ingested = self.ingest_target(&target, &decider, &suite_digests)?;
            on_event(IngestEvent::Version {
                index: refused.len() + index + 1,
                total,
                version: &ingested,
            });
            report.test_case_versions.push(ingested);
        }

        // A whole-catalog scan has enumerated every case the checkout declares, so it
        // can also drop definitions the checkout no longer has — the prune that keeps
        // a folder rename (or a deleted version) from leaving the old slug served
        // alongside the new one. A partial (`test_cases`) scan cannot: it has not seen
        // the whole catalog, so it must not conclude anything is absent. Run-
        // referenced definitions are spared regardless (see `prune_absent`).
        if whole_catalog {
            self.prune_absent(&report)?;
            self.prune_absent_suites(&report)?;
            // A whole-catalog scan also owns the global test-case-group set: it has
            // the complete catalog in view, so it can both cross-validate every
            // member slug and reconcile the stored set to exactly what the checkout
            // declares (a deleted group folder prunes the group). A partial scan
            // must not touch the set for the same reason it must not prune.
            report.test_case_groups_changed = self.ingest_test_case_groups()?;
        }

        // Stamp the marker only after a clean full scan, so a fresh store (no marker)
        // and a changed catalog both end at the token they were just ingested to.
        if let Some(version) = tagged {
            self.store.set_catalog_version(version)?;
        }

        // Every version the store now holds was written by this build: it was either
        // already in this build's record format, empty before the scan, or just
        // rewritten whole by the promotion above. Stamp the format so a later build
        // that reads the store differently knows to rebuild it.
        self.store.set_store_format()?;

        Ok(report)
    }

    /// Drop every stored `(slug, version)` the just-completed whole-catalog scan did
    /// not touch — i.e. the checkout no longer declares — except any pair a run still
    /// references (the `protected` set), which is kept so the run stays resolvable and
    /// keeps its case metadata. `report` lists exactly the versions present in the
    /// checkout (each keyed by its resolved slug), so anything in the store outside
    /// that set and outside `protected` is stale and removed.
    fn prune_absent(&self, report: &IngestReport) -> Result<()> {
        // A version that failed to resolve is reported but not present: whatever the
        // store holds for it is no longer something the checkout can reproduce.
        let present: std::collections::HashSet<(&str, &str)> = report
            .test_case_versions
            .iter()
            .filter(|v| v.problem.is_none())
            .map(|v| (v.slug.as_str(), v.version.as_str()))
            .collect();
        for (slug, versions) in self.store.list_cases()? {
            for version in versions {
                if present.contains(&(slug.as_str(), version.as_str())) {
                    continue;
                }
                if self.protected.contains(&(slug.clone(), version.clone())) {
                    continue;
                }
                self.store.remove_version(&slug, &version)?;
            }
        }
        Ok(())
    }

    /// Reconcile the store's global [test-case group](test_cabinet_core::TestCaseGroup)
    /// set to the checkout's `test-case-groups/` catalogue, returning whether the
    /// stored set changed. Called only by a whole-catalog scan (see
    /// [`scan_with_progress`](Self::scan_with_progress)).
    ///
    /// Membership is cross-validated here, where the checkout's whole
    /// [`TestCaseCatalog`] is in hand: a group naming a member the catalog cannot
    /// resolve (cases and jams alike, by manifest-declared identity) is rejected
    /// with a logged error while the valid groups still ingest — the repo's
    /// `manifests_are_valid` test catches the mistake pre-commit, so meeting one
    /// here means this backend's checkout is simply behind or ahead of the case it
    /// names, which must not blank the rest of the home page. A checkout without
    /// the folder declares no groups (the folder postdates most checkouts), which
    /// reconciles the stored set to empty like any other deletion.
    fn ingest_test_case_groups(&self) -> Result<bool> {
        let root = self.checkout.join("test-case-groups");
        let declared = if root.is_dir() {
            TestCaseGroupCatalog::new(&root)
                .list()
                .map_err(BackendError::Core)?
        } else {
            Vec::new()
        };
        let known: std::collections::HashSet<String> =
            TestCaseCatalog::new(self.checkout.join("test-cases"))
                .list()
                .map_err(BackendError::Core)?
                .into_iter()
                .map(|case| case.slug)
                .collect();
        let groups: Vec<_> = declared
            .into_iter()
            .filter(|group| {
                let unresolved: Vec<&str> = group
                    .cases
                    .iter()
                    .filter(|member| !known.contains(member.as_str()))
                    .map(String::as_str)
                    .collect();
                if unresolved.is_empty() {
                    return true;
                }
                tracing::error!(
                    group = %group.slug,
                    members = %unresolved.join(", "),
                    "rejecting a test-case group: member slug(s) do not resolve in the \
                     checkout's test-case catalog"
                );
                false
            })
            .collect();
        // The stored set is read only to decide whether the snapshot needs
        // refreshing. A slot that is present but unparseable (written by a build
        // with a different `TestCaseGroup` shape, or truncated mid-write) must
        // count as "changed" rather than abort the scan: re-ingest is the slot's
        // documented repair (see `DefinitionStore::read_test_case_groups`), so the
        // write below has to run precisely when the read cannot. I/O errors still
        // propagate — the rewrite would hit them too.
        let stored = match self.store.read_test_case_groups() {
            Ok(stored) => Some(stored),
            Err(BackendError::Internal(error)) => {
                tracing::warn!(
                    %error,
                    "rewriting the stored test-case-group set: the slot does not parse"
                );
                None
            }
            Err(err) => return Err(err),
        };
        if stored.as_deref() == Some(groups.as_slice()) {
            return Ok(false);
        }
        self.store.write_test_case_groups(&groups)?;
        Ok(true)
    }

    /// Resolve what a scan touches, from the checkout's two trees.
    ///
    /// A whole-catalog scan (no restriction) enumerates every declared case and
    /// every suite version; a partial scan takes the request's entries verbatim.
    /// Each entry is then resolved to targets: a bare `id` (slug or folder name)
    /// expands to every version the case declares, while a version-qualified
    /// `id@version` targets exactly that one version — so an edit to a single
    /// version re-renders only it, not every version of the case. `@` cannot occur
    /// in a slug/folder name or a version string, so it is an unambiguous
    /// separator.
    ///
    /// An entry the authored catalog does not know is offered to the suites tree in
    /// the same two spellings: a bare suite slug expands to every definition of
    /// every version it declares, and `<suite>@<version>` to every definition of
    /// that one version. An entry neither tree knows stays an authored target, so it
    /// resolves to the error it resolves to today.
    fn version_targets(&self, request: &IngestRequest) -> Result<Targets> {
        let catalog = self.case_catalog();
        let suites = self.suite_catalog();
        let mut targets = Targets::default();
        let Some(entries) = &request.test_cases else {
            // A whole-catalog scan enumerates both trees, so its prune sees every
            // declared version of either kind.
            for case in catalog.list().map_err(BackendError::Core)? {
                for version in catalog.versions(&case.slug).map_err(BackendError::Core)? {
                    targets.versions.push(Target::Case {
                        id: case.slug.clone(),
                        version,
                    });
                }
            }
            for suite in suites.list().map_err(BackendError::Core)? {
                for version in suite.versions {
                    self.expand_suite_version(&suites, &suite.slug, &version, &mut targets)?;
                }
            }
            return Ok(targets);
        };
        for entry in entries {
            match entry.split_once('@') {
                Some((id, version)) => {
                    // Offered to the suites tree on presence alone, so a version whose
                    // manifests do not resolve is reported with its problem rather than
                    // as an unknown case.
                    if catalog.versions(id).is_err() && suites.has_version(id, version) {
                        self.expand_suite_version(&suites, id, version, &mut targets)?;
                        continue;
                    }
                    targets.versions.push(Target::Case {
                        id: id.to_string(),
                        version: version.to_string(),
                    });
                }
                None => {
                    let known = catalog.versions(entry);
                    if known.is_err()
                        && let Ok(versions) = suites.versions(entry)
                        && !versions.is_empty()
                    {
                        for version in versions {
                            self.expand_suite_version(&suites, entry, &version, &mut targets)?;
                        }
                        continue;
                    }
                    for version in known.map_err(BackendError::Core)? {
                        targets.versions.push(Target::Case {
                            id: entry.clone(),
                            version,
                        });
                    }
                }
            }
        }
        Ok(targets)
    }

    /// Add one suite version — the suite record itself, and one target per
    /// definition it offers — to the scan.
    fn expand_suite_version(
        &self,
        suites: &TestSuiteCatalog,
        slug: &str,
        version: &str,
        targets: &mut Targets,
    ) -> Result<()> {
        targets.suites.push((slug.to_string(), version.to_string()));
        // A version whose definitions cannot be listed is a version whose manifest
        // does not read back; the suite ingest reports that against the suite rather
        // than aborting the scan, so nothing is expanded here.
        let Ok(definitions) = suites.definitions(slug, version) else {
            return Ok(());
        };
        for definition in definitions {
            targets.versions.push(Target::Definition {
                suite: slug.to_string(),
                version: version.to_string(),
                definition,
            });
        }
        Ok(())
    }

    /// The authored test-case catalog over this checkout.
    fn case_catalog(&self) -> TestCaseCatalog {
        TestCaseCatalog::new(self.checkout.join("test-cases"))
    }

    /// The suite catalog over this checkout. Its rendered specifications are
    /// written per definition into the staging tree that definition is built in
    /// (see `ingest.suites.rs`), so the catalog itself is handed a placeholder
    /// materials directory it never writes to.
    fn suite_catalog(&self) -> TestSuiteCatalog {
        self.reading_previews(TestSuiteCatalog::new(self.checkout.join(TEST_SUITES_DIR)))
    }

    /// `catalog`, reading the checkout's `.previews/` folder when this ingestor is
    /// configured to.
    fn reading_previews(&self, catalog: TestSuiteCatalog) -> TestSuiteCatalog {
        match self.previews {
            true => {
                let previews = catalog.root().join(PREVIEWS_DIR);
                catalog.with_previews(previews)
            }
            false => catalog,
        }
    }

    /// Ingest one resolved target.
    fn ingest_target(
        &self,
        target: &Target,
        decider: &Decider,
        suite_digests: &SuiteDigests,
    ) -> Result<IngestedVersion> {
        match target {
            Target::Case { id, version } => self.ingest_version(id, version, decider),
            Target::Definition {
                suite,
                version,
                definition,
            } => self.ingest_definition(suite, version, definition, decider, suite_digests),
        }
    }

    // --- Test-case versions -------------------------------------------------

    /// Ingest one test-case version: resolve it (which validates structure), copy
    /// the version folder verbatim, render its references, and write the resolved
    /// store-relative manifest, stamped with the digest it was built from. Whether
    /// an already-stored version is rewritten is the `decider`'s call.
    ///
    /// The build happens in a staging directory that is then swapped into place
    /// atomically (see [`DefinitionStore::publish_staged_version`]). A re-ingest
    /// therefore never leaves the served version half-built or manifest-less, even
    /// for the seconds-to-minutes its references take to render — the window a prior
    /// destructive in-place rebuild opened, which a run resolving its version during
    /// a force re-ingest saw as a spurious 404 "is not ingested". Building fresh also
    /// guarantees a file removed in the checkout does not linger in the store.
    fn ingest_version(
        &self,
        id: &str,
        version: &str,
        decider: &Decider,
    ) -> Result<IngestedVersion> {
        let catalog = self.case_catalog();

        // The store is keyed by the case's resolved slug (its manifest identity),
        // which can differ from `id` — the folder name a targeted scan named, or the
        // slug a whole-catalog scan enumerated. Resolve it cheaply up front so the
        // unchanged-skip check and every store key below use the true identity rather
        // than the lookup key, keeping the store directory and the manifest it holds
        // in agreement.
        let slug = catalog.slug_of(id, version).map_err(BackendError::Core)?;

        let has_record = self.store.has_version(&slug, version);
        let skipped = |slug: String, reason| IngestedVersion {
            slug,
            version: version.to_string(),
            ingested: false,
            rendered_references: 0,
            reason,
            problem: None,
        };
        if decider.skips_as_stored(has_record) {
            return Ok(skipped(slug, None));
        }
        let root = catalog
            .version_root(id, version)
            .map_err(BackendError::Core)?;
        let digest = digest::authored_version_digest(&root, self.checkout)?;
        let decision = decider.decide(
            has_record,
            || self.store.version_stamp(&slug, version),
            &digest,
        );
        if let Decision::Skip(reason) = decision {
            return Ok(skipped(slug, reason));
        }

        let resolved = catalog.resolve(id, version).map_err(BackendError::Core)?;

        let staged = self.store.new_staging_dir(&slug, version)?;
        let built = self
            .build_version(&staged, &resolved, None)
            .and_then(|rendered| {
                write_ingest_stamp_in(&staged, &decider.stamp(digest))?;
                Ok(rendered)
            });
        let rendered = match built {
            Ok(rendered) => rendered,
            Err(err) => {
                // Discard the partial build so a failed ingest leaves no debris and
                // never publishes an incomplete version.
                let _ = std::fs::remove_dir_all(&staged);
                return Err(err);
            }
        };
        self.store.publish_staged_version(&slug, version, &staged)?;

        Ok(IngestedVersion {
            slug,
            version: version.to_string(),
            ingested: true,
            rendered_references: rendered,
            reason: None,
            problem: None,
        })
    }

    /// Build a resolved version's full tree — sources, rendered references, and the
    /// resolved manifest — into `dest`, returning the number of references stored.
    /// `dest` is a staging directory the caller swaps into place; on any error the
    /// caller discards it, so a partial build is never served.
    /// A suite-defined version is built through this same path: `suite` carries
    /// the coordinate it was lowered from, and its files reach `dest` through
    /// [`copy_suite_version`](suites::copy_suite_version) rather than a verbatim
    /// folder copy, because a suite version folder holds the whole suite rather
    /// than one case. An authored version also gets its baseline validation media
    /// from cold storage, which holds none for a suite version.
    fn build_version(
        &self,
        dest: &Path,
        resolved: &TestCaseVersion,
        suite: Option<&StoredSuiteCoordinate>,
    ) -> Result<usize> {
        let keys = match suite {
            None => {
                copy_tree(&resolved.root, dest)?;
                self.copy_baselines(dest, resolved)?;
                Keys::rooted(&resolved.root)
            }
            Some(_) => suites::copy_suite_version(dest, resolved)?,
        };
        let rendered = self.render_references(dest, resolved)?;
        let manifest = build_stored_manifest(resolved, &keys, suite.cloned())?;
        write_manifest_in(dest, &manifest)?;
        Ok(rendered)
    }

    /// Copy a version's baseline validation media from cold storage into `dest`'s
    /// `validation-baseline/`, where the store serves it from. A version with no
    /// counterpart in cold storage, including every version of a checkout without
    /// the submodule, copies nothing.
    fn copy_baselines(&self, dest: &Path, resolved: &TestCaseVersion) -> Result<()> {
        let Some(src) = self.cold.validation_baseline_dir(&resolved.root) else {
            return Ok(());
        };
        if src.is_dir() {
            copy_tree(&src, &dest.join(test_cabinet_core::VALIDATION_BASELINE_DIR))?;
        }
        Ok(())
    }

    /// Store every reference view (common + per-variant) of a resolved version into
    /// `dest`'s reference sidecar (a staging directory; see [`build_version`](Self::build_version)). An
    /// HTML mockup is rendered to a screenshot; a static image/video is copied as-is.
    /// A failure aborts the version's ingest, since serving a version with a missing
    /// baseline would let a runner validate against a hole. Returns the number of
    /// references stored.
    fn render_references(&self, dest: &Path, resolved: &TestCaseVersion) -> Result<usize> {
        let mut count = 0;

        // Common references store once under the `_common` scope.
        for reference in &resolved.common_references {
            self.store_one_reference(dest, "_common", reference)?;
            count += 1;
        }
        // Variant-specific references store under each variant's slug scope, so a
        // view shared across variants (e.g. a per-variant `title`) does not clobber.
        for variant in &resolved.variants {
            for reference in &variant.references {
                self.store_one_reference(dest, &variant.slug, reference)?;
                count += 1;
            }
        }
        Ok(count)
    }

    /// Store one reference into `dest` under `scope`: render an HTML mockup to a
    /// `.png`, or copy a static image/video as-is to `<view>.<ext>`.
    fn store_one_reference(
        &self,
        dest: &Path,
        scope: &str,
        reference: &test_cabinet_core::ReferenceView,
    ) -> Result<()> {
        let file = format!("{}.{}", reference.view, reference.extension());
        let out = reference_in(dest, scope, &file);
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent)?;
        }
        if reference.kind.is_rendered() {
            render::render_reference(&reference.source_path, &out).map_err(|detail| {
                BackendError::Snapshot(format!(
                    "could not render reference `{}`: {detail}",
                    reference.view
                ))
            })
        } else {
            std::fs::copy(&reference.source_path, &out).map_err(|err| {
                BackendError::Snapshot(format!(
                    "could not store reference media `{}`: {err}",
                    reference.view
                ))
            })?;
            Ok(())
        }
    }
}

/// Build the store-relative resolved manifest from a resolved version. Paths are
/// rewritten from host-absolute to store keys (see [`Keys`]), the prompt and
/// description are inlined, and `.hbs` specs are flagged as templates.
///
/// `suite` is the coordinate a suite-defined version was lowered from, and `None`
/// for an authored case — the one field of the stored record that tells the two
/// apart.
fn build_stored_manifest(
    resolved: &TestCaseVersion,
    keys: &Keys<'_>,
    suite: Option<StoredSuiteCoordinate>,
) -> Result<StoredManifest> {
    let prompt_template = std::fs::read_to_string(&resolved.prompt_path)?;
    let description = match &resolved.description_path {
        Some(path) => Some(std::fs::read_to_string(path)?),
        None => None,
    };
    // The changelog is required, so it is always present to read.
    let changelog = std::fs::read_to_string(&resolved.changelog_path)?;

    let common_specs = resolved
        .common_specs
        .iter()
        .map(|spec| stored_spec(keys, spec))
        .collect::<Result<Vec<_>>>()?;

    // The starter workspace files (common + each variant's override) are keyed by
    // their store-relative source path; the runner fetches each like an asset and
    // seeds it at the file's run-relative `dest`.
    let workspace = stored_workspaces(keys, &resolved.common_workspace)?;

    // Asset *paths* in a resolved version may be files or directories; the
    // contract expands directories to individual files. Each becomes an artifact
    // keyed by its store-relative path, with `dest` mirroring the source layout.
    let mut assets = Vec::new();
    for asset_path in &resolved.asset_paths {
        expand_asset(keys, asset_path, &mut assets)?;
    }

    let variants = resolved
        .variants
        .iter()
        .map(|variant| -> Result<StoredVariant> {
            let specs = variant
                .specs
                .iter()
                .map(|spec| stored_spec(keys, spec))
                .collect::<Result<Vec<_>>>()?;
            let workspace = variant
                .workspace
                .as_ref()
                .map(|workspaces| stored_workspaces(keys, workspaces))
                .transpose()?;
            Ok(StoredVariant {
                slug: variant.slug.clone(),
                name: variant.name.clone(),
                description: variant.description.clone(),
                specs,
                workspace,
                references: variant.references.iter().map(stored_reference).collect(),
                proofs: variant.proofs.iter().map(stored_proof).collect(),
                review_items: variant
                    .review_items
                    .iter()
                    .map(stored_review_item)
                    .collect(),
                domains: variant.domains.iter().map(stored_domain).collect(),
                voxel: variant.voxel.clone(),
                showcase: variant
                    .showcase
                    .as_ref()
                    .map(|showcase| stored_showcase(keys, showcase))
                    .transpose()?,
            })
        })
        .collect::<Result<Vec<_>>>()?;

    Ok(StoredManifest {
        slug: resolved.slug.clone(),
        version: resolved.version.clone(),
        name: resolved.name.clone(),
        difficulty: resolved.difficulty.clone(),
        tags: resolved.tags.clone(),
        summary: resolved.summary.clone(),
        description,
        changelog,
        max_runtime_seconds: resolved.max_runtime_seconds,
        test_type: resolved.test_type,
        experimental: resolved.experimental,
        engine_format: resolved.engine_format,
        engines: resolved.engines.clone(),
        build: resolved.build.as_ref().map(|build| StoredBuild {
            install: build.install.clone(),
            build: build.build.clone(),
            module: build
                .module
                .as_ref()
                .map(|module| module.to_string_lossy().replace('\\', "/")),
        }),
        toolchain: resolved
            .toolchain
            .as_ref()
            .map(|toolchain| crate::store::StoredToolchain {
                typecheck: toolchain.typecheck.clone(),
                lint: toolchain.lint.clone(),
                format: toolchain.format.clone(),
                test: toolchain.test.clone(),
            }),
        canvas: resolved.canvas.as_ref().map(|canvas| StoredCanvas {
            width: canvas.width,
            height: canvas.height,
            background: canvas.background.clone(),
        }),
        tool: resolved.tool.as_ref().map(|tool| StoredTool {
            binary: tool.binary.clone(),
            preview: tool.preview.to_string_lossy().replace('\\', "/"),
        }),
        output: resolved.output.as_ref().map(|output| StoredOutput {
            actions: output.actions.to_string_lossy().replace('\\', "/"),
        }),
        contract: resolved.contract.as_ref().map(|contract| {
            let forward = |path: &std::path::Path| path.to_string_lossy().replace('\\', "/");
            StoredContract {
                entry: contract.entry.clone(),
                world: contract.world.as_deref().map(forward),
                action: contract.action.as_deref().map(forward),
                input: contract.input.as_deref().map(forward),
                output: contract.output.as_deref().map(forward),
            }
        }),
        sandbox: resolved.sandbox.as_ref().map(|sandbox| StoredSandbox {
            fuel_per_tick: sandbox.fuel_per_tick,
            fuel_limit: sandbox.fuel_limit,
            max_memory_bytes: sandbox.max_memory_bytes,
        }),
        cases: resolved
            .cases
            .iter()
            .map(|case| stored_case(keys, case))
            .collect::<Result<Vec<_>>>()?,
        simulation: resolved
            .simulation
            .as_ref()
            .map(|simulation| StoredSimulation {
                timestep_ms: simulation.timestep_ms,
                max_ticks: simulation.max_ticks,
            }),
        r#match: resolved.r#match.as_ref().map(|m| StoredMatch {
            participants: m.participants,
            structure: m.structure.clone(),
            rounds: m.rounds,
        }),
        replay: resolved.replay.as_ref().map(|replay| StoredReplay {
            renderer: replay.renderer.to_string_lossy().replace('\\', "/"),
        }),
        asset_kind: resolved.asset_kind,
        asset_dimension: resolved.asset_dimension,
        sheet: resolved.sheet.clone(),
        voxel: resolved.voxel.clone(),
        model: resolved.model.clone(),
        ui: resolved.ui.clone(),
        material: resolved.material.clone(),
        particle: resolved.particle.clone(),
        audio: resolved.audio.clone(),
        audio_packs: resolved.audio_packs.clone(),
        prompt_template,
        common_specs,
        workspace,
        init: resolved.init.clone(),
        assets,
        packages: resolved.packages.clone(),
        variants,
        common_references: resolved
            .common_references
            .iter()
            .map(stored_reference)
            .collect(),
        common_proofs: resolved.common_proofs.iter().map(stored_proof).collect(),
        checks: resolved
            .checks
            .iter()
            .map(|c| StoredCheck {
                view: c.view.clone(),
                name: c.name.clone(),
                reference_view: c.reference_view.clone(),
                actions: c.actions.clone(),
            })
            .collect(),
        common_review_items: resolved
            .common_review_items
            .iter()
            .map(stored_review_item)
            .collect(),
        domains: resolved.domains.iter().map(stored_domain).collect(),
        // The debug-API handle for auto-validation, reporter-side and never seeded;
        // the resolved script files are copied into the store verbatim by `copy_tree`
        // (like a reference mockup) and served by the artifact endpoint.
        instrumentation: resolved.instrumentation.as_ref().map(|instrumentation| {
            StoredInstrumentation {
                handle: instrumentation.handle.clone(),
                tick_hz: instrumentation.tick_hz,
            }
        }),
        // Post-hoc known-issue errata (the version's `errata.toml`), site-facing and
        // never seeded. Carried through so the API and snapshot can surface them.
        errata: resolved.errata.iter().map(stored_erratum).collect(),
        suite,
    })
}

/// Build a [`StoredErratum`] from a resolved known-issue entry (the stored shape
/// matches the core [`test_cabinet_core::test_case::Erratum`] field for field).
fn stored_erratum(erratum: &test_cabinet_core::test_case::Erratum) -> StoredErratum {
    StoredErratum {
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

/// Build a [`StoredDomain`] from a resolved scoring domain (the wire shape matches
/// field for field). Shared by the case's common domains and each variant's own.
fn stored_domain(domain: &test_cabinet_core::Domain) -> StoredDomain {
    StoredDomain {
        id: domain.id.clone(),
        name: domain.name.clone(),
        description: domain.description.clone(),
    }
}

/// Build a [`StoredReviewItem`] from a resolved reviewer checklist item.
fn stored_review_item(item: &test_cabinet_core::ReviewItem) -> StoredReviewItem {
    StoredReviewItem {
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
            .map(|sub| StoredSubReviewItem {
                id: sub.id.clone(),
                title: sub.title.clone(),
                description: sub.description.clone(),
                weight: sub.weight,
                reference: sub.reference.clone(),
                proof: sub.proof.clone(),
                validation: sub.validation.as_ref().map(stored_validation),
                failure_cap: sub.failure_cap,
                domains: sub.domains.clone(),
            })
            .collect(),
        // The item's auto-validation driver (present only for a whole-item validated
        // item; a sub-divided item carries its drivers on the sub-items above).
        validation: item.validation.as_ref().map(stored_validation),
        // The validator-rated scoring declaration (present only on a validator-rated
        // version, and only on a whole-item point; a sub-divided item carries them on
        // the sub-items above).
        failure_cap: item.failure_cap,
        domains: item.domains.clone(),
    }
}

/// Build a [`StoredReviewValidation`] from a resolved driver: the reporter-side debug
/// script (by its version-folder-relative key, forward-slashed) and its declared
/// outputs. The script file itself rides along in the copied version tree; this records
/// only the metadata the served definition needs so the driver can locate and run it.
/// Shared by the item-level and per-sub-item drivers.
fn stored_validation(validation: &test_cabinet_core::ReviewValidation) -> StoredReviewValidation {
    StoredReviewValidation {
        script: validation.script_rel.clone(),
        per_engine: validation.script.is_none(),
        engines: validation.engines.clone(),
        outputs: validation
            .outputs
            .iter()
            .map(|output| StoredReviewOutput {
                id: output.id.clone(),
                name: output.name.clone(),
                kind: output.kind,
            })
            .collect(),
    }
}

/// Build a [`StoredReference`] from a resolved reference view, recording its kind
/// and the extension its media is served under.
fn stored_reference(reference: &test_cabinet_core::ReferenceView) -> StoredReference {
    StoredReference {
        view: reference.view.clone(),
        kind: reference.kind,
        extension: reference.extension(),
    }
}

/// Build a [`StoredProof`] from a resolved proof-of-implementation declaration.
fn stored_proof(proof: &test_cabinet_core::ProofFile) -> StoredProof {
    StoredProof {
        id: proof.id.clone(),
        name: proof.name.clone(),
        kind: proof.kind,
        dest: to_forward_slash(&proof.dest),
    }
}

/// Build a `StoredSpec` from a resolved [`SpecFile`](test_cabinet_core::SpecFile), deriving the store-relative
/// `source` key and the `template` flag (a `.hbs` source) and carrying its `kind`.
fn stored_spec(keys: &Keys<'_>, spec: &test_cabinet_core::SpecFile) -> Result<StoredSpec> {
    let source = keys.of(&spec.source_path)?;
    let template = spec
        .source_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("hbs"))
        .unwrap_or(false);
    Ok(StoredSpec {
        source,
        dest: to_forward_slash(&spec.dest),
        template,
        kind: spec.kind,
    })
}

/// Build a [`StoredWorkspaceFile`] from a resolved workspace file: the
/// store-relative `source` key plus the run-relative `dest` (already computed at
/// resolution as the file's path within the workspace directory).
fn stored_workspace(
    keys: &Keys<'_>,
    file: &test_cabinet_core::WorkspaceFile,
) -> Result<StoredWorkspaceFile> {
    Ok(StoredWorkspaceFile {
        source: keys.of(&file.source_path)?,
        dest: to_forward_slash(&file.dest),
    })
}

/// Build a [`StoredShowcase`] from a variant's resolved
/// [showcase](test_cabinet_core::test_case::CaseShowcase): the description is
/// inlined, and each media entry is keyed by its **store-relative** path exactly
/// as a spec or a workspace file is — the bytes themselves ride the copied
/// version tree (`copy_tree`), so keying is all the upload there is.
fn stored_showcase(
    keys: &Keys<'_>,
    showcase: &test_cabinet_core::test_case::CaseShowcase,
) -> Result<StoredShowcase> {
    let media = showcase
        .media
        .iter()
        .map(|media| -> Result<StoredShowcaseMedia> {
            Ok(StoredShowcaseMedia {
                file: media.file.clone(),
                name: media.name.clone(),
                kind: media.kind,
                key: keys.of(&media.source_path)?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(StoredShowcase {
        description: showcase.description.clone(),
        media,
    })
}

/// Build a [`StoredWorkspace`] from a resolved per-engine starter project: one
/// entry per [engine](test_cabinet_core::engine) the case ships a project for, each
/// keyed by its store-relative source exactly as a spec or an asset is.
fn stored_workspaces(
    keys: &Keys<'_>,
    workspaces: &test_cabinet_core::test_case::EngineWorkspaces,
) -> Result<StoredWorkspace> {
    let mut by_engine = std::collections::BTreeMap::new();
    for engine in workspaces.engines() {
        let files = workspaces
            .get(engine)
            .iter()
            .map(|file| stored_workspace(keys, file))
            .collect::<Result<Vec<_>>>()?;
        by_engine.insert(engine.to_string(), files);
    }
    Ok(StoredWorkspace(by_engine))
}

/// Build a [`StoredCase`] from a resolved performance case: the held-out `input`
/// scenario and `expected` oracle state, each keyed by its **store-relative** path
/// exactly as specs, workspace files, and assets are. The runner fetches both like
/// any other definition file and the [`PerformanceValidator`](test_cabinet_core::PerformanceValidator) scores against them;
/// they are never seeded into a run. Keying them absolutely (as this once did)
/// leaves the driver's [`materialize_version`](test_cabinet_core::backend_client::materialize_version) unable to fetch or locate them, so
/// every backend-driven performance run resolves an empty scored set and aborts.
fn stored_case(
    keys: &Keys<'_>,
    case: &test_cabinet_core::test_case::PerformanceCase,
) -> Result<StoredCase> {
    Ok(StoredCase {
        input: keys.of(&case.input)?,
        expected: keys.of(&case.expected)?,
        fuel_ceiling: case.fuel_ceiling,
        kind: case.kind,
    })
}

/// Expand an asset path (file or directory) into one `StoredAsset` per file. A
/// directory is walked recursively; the `dest` mirrors each file's path relative
/// to the version root, matching how the runner seeds assets.
fn expand_asset(keys: &Keys<'_>, asset_path: &Path, out: &mut Vec<StoredAsset>) -> Result<()> {
    if asset_path.is_dir() {
        for entry in std::fs::read_dir(asset_path)? {
            expand_asset(keys, &entry?.path(), out)?;
        }
    } else {
        let key = keys.of(asset_path)?;
        out.push(StoredAsset {
            dest: key.clone(),
            source: key,
        });
    }
    Ok(())
}

/// How a resolved file's host path becomes the key it is stored and served under.
///
/// A file copied out of the version folder keeps its layout, so its key is its path
/// relative to that folder. A suite's *rendered* specification has no such path —
/// it is written into the resolution's materials directory rather than into the
/// suites checkout, which The Spec Cabinet owns and ingest never writes to — so it
/// is copied into the store under the path it seeds at and recorded here.
pub(crate) struct Keys<'a> {
    /// The version folder the copied tree came from.
    root: &'a Path,
    /// Files resolved outside that folder, by host path, each carrying the store
    /// key it was copied in under.
    relocated: std::collections::BTreeMap<PathBuf, String>,
}

impl<'a> Keys<'a> {
    /// Keys for a version whose every file came out of its own folder.
    fn rooted(root: &'a Path) -> Self {
        Self {
            root,
            relocated: std::collections::BTreeMap::new(),
        }
    }

    /// Keys for a version some of whose files were copied in from elsewhere.
    pub(crate) fn relocated(
        root: &'a Path,
        relocated: std::collections::BTreeMap<PathBuf, String>,
    ) -> Self {
        Self { root, relocated }
    }

    /// The store key of one resolved file.
    pub(crate) fn of(&self, path: &Path) -> Result<String> {
        if let Some(key) = self.relocated.get(path) {
            return Ok(key.clone());
        }
        let rel = path.strip_prefix(self.root).map_err(|_| {
            BackendError::BadRequest(format!(
                "path `{}` is not inside the version folder",
                path.display()
            ))
        })?;
        Ok(to_forward_slash(rel))
    }
}

/// Render a path with forward-slash separators (the store key convention).
pub(crate) fn to_forward_slash(path: &Path) -> String {
    path.components()
        .filter_map(|c| match c {
            std::path::Component::Normal(name) => Some(name.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// Recursively copy a directory tree, skipping hidden entries (so the checkout's
/// dotfiles and the store's own `.tcab` sidecar never enter a copied definition).
///
/// The exceptions are the dotfiles a case legitimately ships (`.gitignore`,
/// `.cargo`): they are preserved so a backend-driven run seeds the same set a
/// local run does. The allowlist is shared with `core`'s `collect_workspace_files`
/// via [`is_seeded_dotfile`], which keeps the two in lockstep.
pub(crate) fn copy_tree(src: &Path, dst: &Path) -> Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str.starts_with('.') && !is_seeded_dotfile(&name_str) {
            continue;
        }
        let from = entry.path();
        let to = dst.join(&name);
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            // `entry.file_type()` (from `read_dir`) never follows the link, so a
            // symlink is handled here before the dir/file split below. Recreate it
            // as a symlink rather than dereferencing it: `std::fs::copy` follows the
            // link and errors on a symlink-to-directory ("the source path is neither
            // a regular file nor a symlink to a regular file") — e.g. a
            // reference-impl's `node_modules/@clockwyrks/voxel-runtime` link.
            copy_symlink(&from, &to)?;
        } else if file_type.is_dir() {
            copy_tree(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

/// Recreate the symlink at `from` at the new location `to`, preserving its target
/// verbatim. The target is kept as-is (typically relative to the link's own
/// directory) so the recreated link resolves the same way the original did. Mirrors
/// `core`'s `copy_symlink`.
fn copy_symlink(from: &Path, to: &Path) -> Result<()> {
    let target = std::fs::read_link(from)?;
    #[cfg(unix)]
    std::os::unix::fs::symlink(&target, to)?;
    #[cfg(windows)]
    if from.is_dir() {
        std::os::windows::fs::symlink_dir(&target, to)?;
    } else {
        std::os::windows::fs::symlink_file(&target, to)?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "ingest.test.rs"]
mod tests;

#[cfg(test)]
#[path = "ingest.changed.test.rs"]
mod changed_tests;

#[cfg(test)]
#[path = "ingest.previews.test.rs"]
mod preview_tests;
