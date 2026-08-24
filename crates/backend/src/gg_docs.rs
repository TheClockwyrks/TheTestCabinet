//! The in-memory **gg document index**: one [`GgRunDoc`] per stored gg run, kept
//! fresh by a per-id reconcile, and the corpus every [TCQ](test_cabinet_core::gg_query)
//! query on this backend runs over. The same parse pass extracts a compact
//! [`GgRunFacts`] per run for the [`/stats` folds](crate::stats), so the two
//! consumers share one ledger, one freshness rule, and one deserialization of
//! each record.
//!
//! The endpoint this replaced answered each aggregate query by loading *every* gg
//! run, deserializing every `record_json`, resolving every case manifest, and folding
//! the lot — per request. That is the work this module does too; it just does it
//! **once** and then only for the runs that changed. At a corpus of tens of thousands
//! of runs at roughly two kilobytes per document the index is a few tens of
//! megabytes, and a dashboard of eight panels costs one index read instead of eight
//! full scans.
//!
//! ## Why the freshness rule is per id
//!
//! The obvious scheme — a high-water mark on the record's own `finished_at` — is
//! unsound here, and quietly so. Adding a review, publishing, and re-pushing a run
//! all change what the run's document must contain, and **none of them move that
//! timestamp**; a run pushed out of order lands below the mark and is never indexed
//! at all; and a deleted run has no timestamp to notice. So the `run` row carries its
//! own [mutation timestamp](crate::db::GgRunVersion) that every mutator stamps, and
//! reconciliation compares the whole `(id, updated_at)` projection against what the
//! index holds: reload the ids whose stamp moved, evict the ids that are gone, leave
//! everything else alone. No monotonicity is assumed and deletion falls out for free.
//!
//! ## The one thing that rule cannot see
//!
//! It is sound for everything that lives on the `run` row, and **one document field does
//! not**: `score` is a fraction of the *case manifest's* checklist weights. An ingest that
//! changes those weights — or an erratum that marks a checklist item excluded from scoring
//! — changes what every affected document must contain while stamping no run at all. Every
//! entry stays fresh, `pending` comes back empty, and the index serves the pre-change score
//! for the life of the process.
//!
//! There is no timestamp to compare against for that, because the manifests are files in a
//! definition store rather than rows. So the definition side pushes instead of the index
//! polling: [`GgDocIndex::invalidate_all`] drops the whole ledger, and the ingest endpoint —
//! the only writer of manifests and errata in this process — calls it whenever a scan
//! actually re-ingested a version. Coarse on purpose: a re-ingest is rare, human-triggered
//! and already the most expensive thing the backend does, so paying one full rebuild for it
//! is cheaper in every sense than carrying a per-manifest generation counter.
//!
//! ## Why the reviewer score is injected
//!
//! A document's `score` field is a fraction of the case's **checklist weights**,
//! which live in the definition store's manifest rather than on the run or its
//! reviews. Rather than reach into the store from here, the reconcile takes a
//! resolver: production passes [`CatalogScores`] (which caches a manifest per
//! `(slug, version)`, so a case is read once per reconcile rather than once per run),
//! and a test passes a closure. That is the same seam the endpoint this replaced
//! used, kept for the same reason.

#[cfg(test)]
#[path = "gg_docs.test.rs"]
mod tests;

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::Arc;
use std::time::{Duration, Instant};

use test_cabinet_core::gg_query::{GgDocLifecycle, GgRunDoc, build_run_doc, redacted_for_public};

use crate::db::{Db, StoredRun};
use crate::error::Result;
use crate::snapshot::run_summary_score;
use crate::stats::GgRunFacts;
use crate::store::{DefinitionStore, StoredManifest};

/// How long a reconcile's result is trusted before the next read re-checks the
/// store.
///
/// The tradeoff is entirely about *lag*, not correctness: a review added through the
/// console is visible in a query within this window. Thirty seconds keeps the steady
/// state to two cheap column reads a minute against a corpus nothing is writing to,
/// while being short enough that an operator who reviews a run and switches to
/// Discover does not notice the delay.
pub const GG_DOC_INDEX_TTL: Duration = Duration::from_secs(30);

/// What one [reconcile](GgDocIndex::reconcile) did — the shape that makes "per id,
/// not a full rebuild" an assertable property rather than a claim.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct GgIndexDelta {
    /// How many runs were loaded and rebuilt: the ones the index had never seen plus
    /// the ones whose mutation timestamp moved. **Zero on a reconcile of an unchanged
    /// corpus**, which is the steady state.
    pub reloaded: usize,
    /// How many entries were dropped because their row is no longer in the store.
    pub evicted: usize,
    /// How many documents the index holds afterwards.
    pub documents: usize,
}

/// One indexed run: its mutation timestamp, and the document built at that stamp.
#[derive(Debug, Clone)]
struct GgIndexEntry {
    /// The `run.updated_at` this entry was built from. The reconcile reloads the run
    /// when the store reports a different one.
    updated_at: String,
    /// The built document, or `None` for a run whose stored record no longer
    /// deserializes against the current `RunRecord` schema.
    ///
    /// Held as a **tombstone** rather than simply skipped: a skipped id would be
    /// absent from the index, look new on the very next reconcile, and be reloaded
    /// (and fail to parse) forever. Remembering the stamp it failed at means the
    /// next attempt happens when — and only when — the row is written again.
    ///
    /// Behind an [`Arc`] so the corpus rebuild below is a refcount bump per document
    /// rather than a deep copy of every string in it. One review on one run rebuilds
    /// the shared vector, and at the tens-of-thousands-of-runs scale this module sizes
    /// itself for, cloning the documents to propagate one changed entry would be a
    /// hundred-megabyte memcpy every time a reviewer pressed save.
    doc: Option<Arc<GgRunDoc>>,
    /// The compact `/stats` extract built from the same parse, on the same
    /// tombstone terms as [`doc`](Self::doc) — plus one more absence: a record
    /// that parses but carries no gg summary has no outcome to aggregate.
    facts: Option<Arc<GgRunFacts>>,
}

/// The index's contents, behind the lock.
#[derive(Debug, Default)]
struct GgIndexState {
    /// The reconciliation ledger, by run id.
    entries: BTreeMap<String, GgIndexEntry>,
    /// The immutable corpus handed to every query between reconciles. Rebuilt only
    /// when the ledger changes, and shared by [`Arc`] so a query neither clones the
    /// corpus nor holds the lock while it evaluates. The rebuild itself clones only
    /// the per-document handles, never the documents.
    corpus: Arc<Vec<Arc<GgRunDoc>>>,
    /// The facts corpus beside it, rebuilt on exactly the same terms and handed
    /// to the `/stats` folds the way [`corpus`](Self::corpus) is handed to a
    /// query.
    facts: Arc<Vec<Arc<GgRunFacts>>>,
    /// When the last reconcile finished, or `None` before the first one.
    reconciled_at: Option<Instant>,
    /// What the last reconcile did — surfaced for tests and diagnostics.
    last_delta: GgIndexDelta,
}

/// The gg document index. Cheap to clone (it is a handle to shared state), so it
/// lives on the API's shared state like any other.
#[derive(Debug, Clone)]
pub struct GgDocIndex {
    /// The shared contents.
    ///
    /// A single async mutex rather than a read/write pair, deliberately. A query's
    /// time under the lock is one [`Arc`] clone; the only long hold is a reconcile,
    /// and serializing *those* is the point — two requests arriving together against
    /// a cold index must not both load the whole corpus.
    state: Arc<tokio::sync::Mutex<GgIndexState>>,
    /// How long a reconcile's result is trusted. [`GG_DOC_INDEX_TTL`] in production;
    /// a test sets it to zero to reconcile on every read.
    ttl: Duration,
}

impl Default for GgDocIndex {
    fn default() -> Self {
        Self::new()
    }
}

impl GgDocIndex {
    /// An empty index with the production [refresh interval](GG_DOC_INDEX_TTL). The
    /// corpus is loaded lazily on the first query, so constructing one costs nothing
    /// and a backend that is never asked a gg query never pays for the index at all.
    pub fn new() -> Self {
        Self::with_ttl(GG_DOC_INDEX_TTL)
    }

    /// An empty index that trusts a reconcile for `ttl`. [`Duration::ZERO`] makes
    /// every read reconcile, which is what a test asserting the reconcile's own
    /// behaviour wants.
    pub fn with_ttl(ttl: Duration) -> Self {
        Self {
            state: Arc::new(tokio::sync::Mutex::new(GgIndexState::default())),
            ttl,
        }
    }

    /// The corpus, reconciling first if the last one is older than the
    /// [TTL](Self::with_ttl).
    ///
    /// Returns a shared snapshot: the caller evaluates against it after the lock is
    /// released, so a long query never blocks a concurrent one and never sees the
    /// corpus change underneath it mid-evaluation.
    pub async fn documents(
        &self,
        db: &Db,
        score_of: &mut (dyn FnMut(&StoredRun) -> Option<f64> + Send),
    ) -> Result<Arc<Vec<Arc<GgRunDoc>>>> {
        let mut state = self.state.lock().await;
        if self.is_stale(&state) {
            reconcile_into(&mut state, db, score_of).await?;
        }
        Ok(Arc::clone(&state.corpus))
    }

    /// The facts corpus, reconciling first on exactly the terms
    /// [`documents`](Self::documents) does — one snapshot, read after the lock
    /// is released.
    ///
    /// Takes the same score resolver because the reconcile is shared: the one
    /// parse pass builds the document (which needs a score) and the facts
    /// (which do not).
    pub async fn facts(
        &self,
        db: &Db,
        score_of: &mut (dyn FnMut(&StoredRun) -> Option<f64> + Send),
    ) -> Result<Arc<Vec<Arc<GgRunFacts>>>> {
        let mut state = self.state.lock().await;
        if self.is_stale(&state) {
            reconcile_into(&mut state, db, score_of).await?;
        }
        Ok(Arc::clone(&state.facts))
    }

    /// Reconcile unconditionally, ignoring the TTL, and report what changed.
    ///
    /// Separate from [`documents`](Self::documents) so a caller that has just written
    /// a run — or a test — can force the refresh, and so the delta is observable
    /// without threading it through every query response.
    pub async fn reconcile(
        &self,
        db: &Db,
        score_of: &mut (dyn FnMut(&StoredRun) -> Option<f64> + Send),
    ) -> Result<GgIndexDelta> {
        let mut state = self.state.lock().await;
        reconcile_into(&mut state, db, score_of).await
    }

    /// Drop the whole ledger, so the next read rebuilds every document from scratch.
    ///
    /// The escape hatch for the one input the per-id freshness rule cannot observe: a
    /// document's `score` is derived from its case manifest's checklist weights, which live
    /// in the definition store and change without any `run` row being written. See the
    /// module documentation — this is called from the ingest path, not on a timer.
    ///
    /// Clears the tombstones along with everything else. A record that failed to
    /// deserialize will be attempted once more and re-tombstoned at the same stamp, which
    /// is the right trade for a call site this rare.
    pub async fn invalidate_all(&self) {
        let mut state = self.state.lock().await;
        state.entries.clear();
        state.corpus = Arc::new(Vec::new());
        state.facts = Arc::new(Vec::new());
        state.reconciled_at = None;
    }

    /// What the most recent reconcile did, or the zero delta before the first one.
    pub async fn last_delta(&self) -> GgIndexDelta {
        self.state.lock().await.last_delta
    }

    /// Whether the index is due a refresh. A never-reconciled index always is, so the
    /// first query loads the corpus.
    fn is_stale(&self, state: &GgIndexState) -> bool {
        match state.reconciled_at {
            Some(at) => at.elapsed() >= self.ttl,
            None => true,
        }
    }
}

/// The reconcile itself, factored out of the two entry points so both hold the lock
/// across exactly the same work.
async fn reconcile_into(
    state: &mut GgIndexState,
    db: &Db,
    score_of: &mut (dyn FnMut(&StoredRun) -> Option<f64> + Send),
) -> Result<GgIndexDelta> {
    let versions = db.gg_run_versions().await?;

    // Split the projection into the ids that need reloading (with the stamp to record
    // them under) and the full set of ids that still exist.
    let mut pending: BTreeMap<String, String> = BTreeMap::new();
    let mut live: BTreeSet<String> = BTreeSet::new();
    for version in versions {
        let fresh = state
            .entries
            .get(&version.id)
            .is_some_and(|entry| entry.updated_at == version.updated_at);
        if !fresh {
            pending.insert(version.id.clone(), version.updated_at);
        }
        live.insert(version.id);
    }

    // Evict first, so a corpus that only shrank does no loading at all.
    let before = state.entries.len();
    state.entries.retain(|id, _| live.contains(id));
    let evicted = before - state.entries.len();

    let reloaded = pending.len();
    if !pending.is_empty() {
        let ids: Vec<String> = pending.keys().cloned().collect();
        let runs = db.gg_runs_by_id(&ids).await?;
        // Seed an entry at the new stamp for **every** id asked for, then fill in the
        // documents that built. An id whose record no longer deserializes keeps its
        // seeded entry and so stays tombstoned rather than looking new next cycle.
        for (id, updated_at) in pending {
            state.entries.insert(
                id,
                GgIndexEntry {
                    updated_at,
                    doc: None,
                    facts: None,
                },
            );
        }
        for run in &runs {
            let doc = build_run_doc(&run.record, &lifecycle_of(run, score_of(run)));
            if let Some(entry) = state.entries.get_mut(&run.record.id) {
                entry.doc = Some(Arc::new(doc));
                entry.facts = GgRunFacts::from_record(&run.record).map(Arc::new);
            }
        }
    }

    // Rebuild the shared corpus only when the ledger actually moved; an unchanged
    // reconcile leaves every reader's `Arc` pointing at the same allocation.
    if reloaded > 0 || evicted > 0 {
        state.corpus = Arc::new(
            state
                .entries
                .values()
                .filter_map(|entry| entry.doc.clone())
                .collect(),
        );
        state.facts = Arc::new(
            state
                .entries
                .values()
                .filter_map(|entry| entry.facts.clone())
                .collect(),
        );
    }

    let delta = GgIndexDelta {
        reloaded,
        evicted,
        documents: state.corpus.len(),
    };
    state.reconciled_at = Some(Instant::now());
    state.last_delta = delta;
    if reloaded > 0 || evicted > 0 {
        tracing::debug!(
            reloaded = delta.reloaded,
            evicted = delta.evicted,
            documents = delta.documents,
            "reconciled the gg document index",
        );
    }
    Ok(delta)
}

/// The gg corpus as the **public static site** may carry it: every stored gg run's
/// document, minus the experimental cases, each one
/// [redacted](redacted_for_public).
///
/// Built straight from the store rather than from the [index](GgDocIndex), deliberately.
/// The index is a console-request cache with a TTL and a lazy first load; the snapshot
/// refresh is a periodic batch job that already reads the whole published set, the whole
/// model catalog and the whole media listing. Reading the corpus once more there is a
/// fraction of what that job costs, and it keeps the export's contents a pure function
/// of the database at the instant the snapshot was cut instead of a function of whatever
/// a console request happened to have warmed.
///
/// Three rules govern what comes out, and only the middle one is a judgement call:
///
/// 1. **Publication is not the gate.** A gg document holds configuration ids and outcome
///    numbers — no source, no prompts, no model output — and almost no gg run is ever
///    published, so gating on publication would export an empty corpus and defeat the
///    feature. [Redaction](redacted_for_public) is the control instead.
/// 2. **The case has to be one this process can see is releasable.** The backend
///    deliberately hides experimental case versions from the UI; exporting their documents
///    would publish an unreleased case's slug, its existence, its run count and its scores.
///    Asked through [`CatalogScores::is_publishable`], which is the catalog's experimental
///    predicate **plus** the one place the two must differ: a manifest this process cannot
///    read is *not* publishable, where the catalog treats it as visible. The catalog is
///    answering "what should the console list", and failing open there shows a case; an
///    export is answering "what leaves the building", and failing open there is a
///    disclosure. The asymmetry is not theoretical — in production the definition store is
///    an `emptyDir` that is empty after every restart while the snapshot's dirty flag is
///    durable in Postgres, so a refresh can and does run against a store that knows about
///    no cases at all. Under this rule that window exports nothing instead of exporting
///    every experimental case in the corpus.
/// 3. **A session record is never involved.** Nothing here touches one. The corpus is
///    documents; the record — the complete model conversation — is console-only, and
///    this function is the only door the public site's gg data comes through.
///
/// Ordered by run id, the order [`Db::gg_run_versions`] returns, so two refreshes of an
/// unchanged corpus produce byte-identical output and R2 stores one object rather than
/// two.
pub async fn public_documents(db: &Db, store: &DefinitionStore) -> Result<Vec<GgRunDoc>> {
    let ids: Vec<String> = db
        .gg_run_versions()
        .await?
        .into_iter()
        .map(|version| version.id)
        .collect();
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let runs = db.gg_runs_by_id(&ids).await?;
    let mut scores = CatalogScores::new(store);
    // One manifest read per `(slug, version)` for the whole export, not one per run:
    // the score resolver already caches manifests, and the publishable predicate is
    // asked against the same cache rather than re-reading the store per run.
    let mut documents = Vec::with_capacity(runs.len());
    for run in &runs {
        if !scores.is_publishable(run) {
            continue;
        }
        let doc = build_run_doc(&run.record, &lifecycle_of(run, scores.score(run)));
        documents.push(redacted_for_public(&doc));
    }
    Ok(documents)
}

/// The store-side lifecycle facts a document carries, which the record itself does
/// not: whether the run is published, what its reviewers concluded, and how many of
/// them there were.
fn lifecycle_of(run: &StoredRun, score: Option<f64>) -> GgDocLifecycle {
    GgDocLifecycle {
        published: run.published,
        rating: crate::db::aggregate_review_rating(&run.record, &run.reviews),
        score,
        review_count: run.reviews.len() as u64,
    }
}

/// The production reviewer-score resolver: the run's aggregate score as a `0.0..=1.0`
/// fraction of its case's declared checklist weight, read from the definition store.
///
/// **This is the input the index's per-id freshness rule cannot see.** Nothing here is
/// keyed to a `run` row, so a re-ingest that changes a checklist weight, or an erratum
/// that excludes an item from scoring, moves every affected run's score without moving any
/// run's `updated_at`. [`GgDocIndex::invalidate_all`] is the remedy, and the ingest path is
/// where it is called from.
///
/// Caches the manifest per `(slug, version)` — including the *absence* of one, so an
/// un-ingested case is not re-read per run — because a reconcile of a whole corpus
/// otherwise reads the same few manifests thousands of times. The cache is per
/// resolver, so it never outlives one reconcile and cannot serve a stale manifest
/// after a re-ingest. The [public export](public_documents) borrows the same cache for
/// its [publishable](Self::is_publishable) filter, which is the other question a
/// case's manifest answers.
pub struct CatalogScores<'a> {
    /// The definition store the checklist weights are read from.
    store: &'a DefinitionStore,
    /// `(slug, version)` → the manifest, or `None` when the case is not ingested.
    manifests: HashMap<(String, String), Option<StoredManifest>>,
}

impl<'a> CatalogScores<'a> {
    /// A resolver reading from `store`, with an empty cache.
    pub fn new(store: &'a DefinitionStore) -> Self {
        Self {
            store,
            manifests: HashMap::new(),
        }
    }

    /// The run's score fraction, or `None` when it has no reviews, its case is not
    /// ingested, or that case declares no weighted checklist at all (a zero
    /// denominator is an absent score, never a zero one — see
    /// [rule 1](test_cabinet_core::gg_query#the-seven-semantic-rules), which a
    /// stored `0` would violate by dragging every average down).
    pub fn score(&mut self, run: &StoredRun) -> Option<f64> {
        let manifest = self.manifest(run)?;
        run_summary_score(manifest, &run.record, &run.reviews)
            .filter(|score| score.total > 0)
            .map(|score| score.earned / score.total as f64)
    }

    /// Whether the run's case version may leave the building — the gate the
    /// [public export](public_documents) uses, answered off the same cached manifest the
    /// score is read from (so exporting a corpus reads a case's manifest once rather than
    /// twice per run).
    ///
    /// This is the catalog's
    /// [experimental](crate::store::DefinitionStore::is_experimental) filter inverted,
    /// **plus the unresolvable manifest** — and that difference is the whole reason it is a
    /// predicate of its own rather than a `!is_experimental(..)` call. The two are asked of
    /// the same fact and fail in opposite directions on purpose: the catalog asks *"should
    /// the console list this"* and shows a case it cannot classify, while an export asks
    /// *"may this be published"* and must withhold one it cannot classify. A gate whose
    /// safe default is "allow" is not a gate.
    ///
    /// The failure it forecloses is a live one rather than a hypothetical. In production
    /// the definition store is an `emptyDir` — empty after every restart, refilled by a
    /// re-ingest — while the snapshot's dirty flag is durable in Postgres, so a refresh
    /// pending at the last restart runs immediately on the next start, against a store that
    /// can answer for no case at all. Every experimental version's slug, existence, run
    /// count and reviewer scores would go to public R2 in that window. Under this predicate
    /// the same window exports nothing, which the next refresh corrects the moment the
    /// store is back.
    pub fn is_publishable(&mut self, run: &StoredRun) -> bool {
        self.manifest(run)
            .is_some_and(|manifest| !manifest.experimental)
    }

    /// The run's case manifest, read once per `(slug, version)` and cached — including
    /// the **absence** of one, so an un-ingested case is not re-read per run. The cache
    /// is per resolver, so it never outlives one reconcile (or one export) and cannot
    /// serve a stale manifest after a re-ingest.
    fn manifest(&mut self, run: &StoredRun) -> Option<&StoredManifest> {
        let subject = &run.record.subject;
        let key = (
            subject.test_case_slug.clone(),
            subject.test_case_version.clone(),
        );
        let store = self.store;
        self.manifests
            .entry(key)
            .or_insert_with(|| {
                store
                    .read_manifest(&subject.test_case_slug, &subject.test_case_version)
                    .ok()
            })
            .as_ref()
    }
}
