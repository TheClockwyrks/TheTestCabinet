//! The SeaORM store: the system of record for published runs (§2 of
//! `design/v0.2.0-contracts.md`).
//!
//! Every published run is held as a verbatim `RunRecord` JSON blob (so the
//! snapshot re-emits it without reserialization drift) plus lifted columns for
//! ordering/pagination, with the run's review and links in sibling tables.
//! Definitions/screenshots are **not** here — they live in the on-disk
//! [`crate::store`].
//!
//! Access goes through a [`sea_orm::DatabaseConnection`], so one connection URL
//! selects the backend: a `sqlite://` file for local/dev/tests, a `postgres://`
//! instance for deployments. SeaORM's connection pool serializes SQLite writes
//! (single-writer, WAL); PostgreSQL handles concurrency natively. The schema is
//! owned by [`test_cabinet_migration`] and applied at startup, not here.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use sea_orm::ActiveValue::{NotSet, Set};
use sea_orm::sea_query::{CaseStatement, Expr, Func, IntoCondition, OnConflict, SimpleExpr};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, Condition, ConnectOptions, ConnectionTrait, Database,
    DatabaseBackend, DatabaseConnection, DatabaseTransaction, EntityTrait, IntoActiveModel,
    JoinType, Order, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, RelationTrait, Select,
    TransactionTrait,
};
use serde::{Deserialize, Serialize};
use test_cabinet_core::comparison::ComparisonConfig;
use test_cabinet_core::match_play::TournamentRecord;
use test_cabinet_core::metrics::{Cost, TokenPrices};
use test_cabinet_core::reference_lock::ReferenceBuildEntry;
use test_cabinet_core::review::{
    AestheticRating, DomainAesthetic, DomainRating, Rating, ReviewDiff, ReviewRevision,
    ReviewVerdict,
};
use test_cabinet_core::run_record::{
    HarnessFamily, HarnessSlug, PriorGameJamEntry, RunLinks, RunRecord,
};
use test_cabinet_core::test_case::{TestType, version_key};
use test_cabinet_entities::{
    backfill_state, case_reference_build, case_reference_sheet, comparison, coverage_group,
    coverage_plan, coverage_settings, gg_agent, gg_config, gg_dashboard, gg_saved_query,
    harness_config, job, ladder, ladder_climber, ladder_outcome, ladder_rung, model, model_alias,
    model_price, model_probe, model_probe_item, publish_job, review, review_plan, review_revision,
    run, run_link, snapshot_state, tournament,
};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::coverage::gate::{Gate, GateOutcome, GateThreshold, RungRun};
use crate::coverage::schedule::BufferTarget;
use crate::error::{BackendError, Result};
use crate::store::{CaseNames, StoredManifest};

/// The non-terminal job states — a run the queue still owns, from enqueue through
/// execution. A job in one of these is "in flight": it appears in the active-run
/// list, counts toward coverage, and is cancelable. `queued` and `pending` have no
/// driver yet (the dispatcher will claim a `queued` one; a `pending` one is held
/// back because its harness is at its parallelism cap); `dispatched`, `starting`,
/// and `running` each have a driver Job coming up or executing.
const IN_FLIGHT_STATES: [&str; 5] = ["queued", "pending", "dispatched", "starting", "running"];

/// The column value that stores an [unbounded](BufferTarget::Unbounded) buffer target.
///
/// The three `buffer_target` columns (`coverage_settings`, `coverage_plan`, `ladder`)
/// are integers that only ever held a non-negative run count, and on the two override
/// tables `NULL` already means "inherit". A negative value is the one thing those
/// columns could never legitimately hold, which makes it a lossless place to keep the
/// third instruction without a second column whose combination with the first would
/// need an invariant of its own. Every read and write goes through
/// [`buffer_target_from_column`] and [`buffer_target_to_column`], so nothing else
/// knows the number.
const UNBOUNDED_BUFFER_COLUMN: i32 = -1;

/// Decode a stored `buffer_target` column: negative is the unbounded marker, anything
/// else the bound it counts.
fn buffer_target_from_column(value: i32) -> BufferTarget {
    if value < 0 {
        BufferTarget::Unbounded
    } else {
        BufferTarget::Bounded { runs: value as u32 }
    }
}

/// Encode a buffer target for its column; the inverse of
/// [`buffer_target_from_column`]. A bound wider than the column is saturated rather
/// than wrapped into the marker, so a caller that forgot to clamp cannot accidentally
/// store "no bound".
fn buffer_target_to_column(target: BufferTarget) -> i32 {
    match target {
        BufferTarget::Bounded { runs } => i32::try_from(runs).unwrap_or(i32::MAX),
        BufferTarget::Unbounded => UNBOUNDED_BUFFER_COLUMN,
    }
}

/// The job states that occupy a **parallelism slot** for their harness: a driver
/// Job has been (or is being) created for them. Used to enforce a harness's maximum
/// parallelism — `queued`/`pending` jobs have no driver yet, so they do not count.
const ACTIVE_SLOT_STATES: [&str; 3] = ["dispatched", "starting", "running"];

/// The in-flight job states that have **cost nothing yet**: the job is waiting to be
/// claimed (`queued`) or deliberately held back behind a cap or a same-model game jam
/// (`pending`), and no driver exists for it. Cancelling one throws away nothing.
///
/// This is what the common halting controls sweep — a plan's or ladder's `halt`, and
/// the Runs page's "Clear pending" — which is why they need no confirmation. Together
/// with [`CANCELABLE_ACTIVE_STATES`] this partitions `IN_FLIGHT_STATES`.
pub const CANCELABLE_WAITING_STATES: [&str; 2] = ["queued", "pending"];

/// The in-flight job states that are **already spending**: a driver Job exists and is
/// being created, starting up, or executing, so the tokens for that run are partly or
/// wholly paid for.
///
/// Cancelling these discards work in progress, which is why the controls that reach
/// them — `halt all`, the Runs page's "Kill active" — are the rare ones and confirm
/// first. Same members as `ACTIVE_SLOT_STATES`, different question: that one asks
/// which jobs hold a parallelism slot, this one asks which are expensive to cancel.
pub const CANCELABLE_ACTIVE_STATES: [&str; 3] = ["dispatched", "starting", "running"];

/// How long a top-up claim on a coverage plan or ladder stays valid before another
/// caller may take it over.
///
/// Top-up is an endpoint the console calls, not a background daemon, so the claim
/// marker (`coverage_plan.topping_up_at` / `ladder.topping_up_at`) is released by the
/// very request that took it — and a request that dies in between leaves it set. The
/// lease bounds that: a marker older than this is treated as abandoned, so a crashed
/// top-up costs one stalled interval instead of wedging the plan forever. A top-up is
/// a handful of reads and one batch insert, so a couple of minutes is already orders
/// of magnitude longer than it can legitimately take.
const TOP_UP_LEASE: time::Duration = time::Duration::minutes(2);

/// The job states a backend restart must reap: a driver was executing them (or
/// being created for them) and went down with the backend, so the job can never
/// reach a terminal state on its own. `queued`/`pending` jobs have no driver, so
/// they are left for the dispatcher to drain once it reconnects.
const REAPABLE_STATES: [&str; 3] = ["dispatched", "starting", "running"];

/// The publish-job states that mean a release is already under way for a run: it is
/// waiting to be claimed, or a `tcab-publisher` Job is carrying it out. A run with
/// one of these must not enqueue a second publish — a publish is **not** idempotent
/// on the Cloudflare side (`wrangler pages deploy` mints a brand-new deployment on
/// every invocation), so a duplicate job leaves an orphaned public build behind.
/// The `gh` side hides the problem by reusing an existing repo, which is why the
/// duplication only ever shows up as extra Pages deployments.
const ACTIVE_PUBLISH_STATES: [&str; 2] = ["queued", "dispatched"];

/// How long a `dispatched` publish job may go without an update before it stops
/// blocking a fresh publish.
///
/// Nothing reaps a publish job whose publisher pod died before reporting — the run
/// queue has a startup reconciliation ([`Db::fail_in_flight_jobs`]) but the publish
/// queue has no equivalent, so such a job sits in `dispatched` forever. Without this
/// cutoff the enqueue-time dedup would wedge that run's publishing permanently,
/// which is a worse failure than the duplicate deploy it prevents. A real publish
/// takes minutes, so an hour only ever releases a job whose publisher is genuinely
/// gone.
const PUBLISH_JOB_STALE_AFTER: time::Duration = time::Duration::hours(1);

/// The generation of the run-record contract this build reads.
///
/// The run-side counterpart of [`crate::store::STORE_FORMAT`]. Every `run` row
/// carries the generation its [readability marker](test_cabinet_entities::run::Model::record_readable)
/// was decided under, and a build whose constant differs from a row's stamp
/// re-decides that row once at startup ([`Db::revalidate_run_records`]).
///
/// Bump it in the same change as anything that can stop an existing stored record
/// deserializing: a new required field on `RunRecord` or anything in its tree —
/// the gg capability set a gg run's record embeds included — a removed or retyped
/// variant, a renamed wire key. A change that only adds optional or defaulted
/// fields leaves every stored record readable and needs no bump. The pin in the
/// readability tests holds the whole tree's shape against this constant, so a
/// change anywhere in it forces the decision.
pub const RUN_RECORD_FORMAT: u32 = 2;

/// The `run` query narrowed to the rows this build can read — the single seam
/// every run listing starts from, so a listing's `COUNT(*)` and the page it serves
/// run one predicate and the total equals the number of rows returned.
///
/// A row falls out of this set when its stored record stops deserializing against
/// the current [`RunRecord`]. Such a run is served by
/// [`Db::list_unreadable_runs`], which reports the error its record produces now,
/// and is deleted through [`Db::delete_run`], which reads the row rather than the
/// record.
fn readable_runs() -> Select<run::Entity> {
    run::Entity::find().filter(run::Column::RecordReadable.eq(true))
}

/// One row of [`Db::list_unreadable_runs`]: a stored run this build cannot decode,
/// reduced to the identity its lifted columns already hold plus the error its
/// stored record produces now.
///
/// Carries no `RunRecord`, because there is no readable one — that is the whole
/// reason the row is here. Everything a console needs to recognise the run and
/// decide to delete it comes off the row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnreadableRun {
    /// The run id (`RunRecord.id`).
    pub id: String,
    /// RFC 3339 of when the run started.
    pub started_at: String,
    /// RFC 3339 of when the run finished.
    pub finished_at: String,
    /// The run's test case slug.
    pub test_case_slug: String,
    /// The run's test case version.
    pub test_case_version: String,
    /// The run's variant slug.
    pub variant: String,
    /// The run's engine slug, or `None` for a row whose slug was never lifted.
    pub engine_slug: Option<String>,
    /// The run's harness slug.
    pub harness_slug: String,
    /// The run's model id.
    pub model_id: String,
    /// The gg configuration the run was launched from, for a gg run launched from
    /// a named one.
    pub gg_preset: Option<String>,
    /// The run's test type as its kebab-case wire token.
    pub test_type: String,
    /// The run's terminal state.
    pub run_state: String,
    /// Whether the run is published.
    pub published: bool,
    /// How many reviews the run carries.
    pub review_count: i64,
    /// The error decoding the stored record produces against the current
    /// [`RunRecord`], which is what tells an operator why the run is here.
    pub error: String,
}

/// A stored run: the full record, its reviews, and its links. This is the shape
/// `GET /runs/{id}` and the snapshot's per-run file are built from. A run may be
/// pushed (private, [`published`](Self::published) false) or published; it may
/// carry zero reviews (while pending) or many.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredRun {
    /// The full run record, links populated.
    pub record: RunRecord,
    /// The run's reviews, oldest first. Empty while the run is still pending
    /// review; one per reviewing account once reviewed. On a legacy run the run's
    /// functional rating is the worst across them and its score the average; on a
    /// validator-rated run they supply the run-wide aesthetic tier and may
    /// override validator verdicts (folded into the rating and score).
    pub reviews: Vec<StoredReview>,
    /// The lifted `run.rating` column: the run's **functional** rating. On a
    /// validator-rated run the validators' decision as overridden by its reviews,
    /// written at push time and recomputed on review-add — the only place a
    /// catalog-free reader can get it from, since deciding it needs the case's
    /// checklist; on a legacy run the review aggregate the store maintains on
    /// review-add (`None` while unreviewed).
    #[serde(default)]
    pub rating: Option<Rating>,
    /// The lifted `run.aesthetic` column: the run's aggregate **aesthetic** rating,
    /// maintained on review-add; `None` until a review rates the aesthetic channel.
    #[serde(default)]
    pub aesthetic: Option<AestheticRating>,
    /// The lifted `run.validator_rated` flag: whether the run's case version is
    /// validator-rated, decided at push time from the definition store.
    #[serde(default)]
    pub validator_rated: bool,
    /// The resolved links.
    pub links: RunLinks,
    /// Whether the run is published (and thus eligible for the public snapshot).
    pub published: bool,
    /// RFC 3339 of when this run was first published, or `None` while it is only
    /// pushed. Not part of the run record itself.
    pub published_at: Option<String>,
    /// The run's recorded normalized event stream, stored verbatim as a JSON
    /// array string (the `run.events_json` column). `None` for a run that
    /// recorded none. Re-emitted into the snapshot and served by
    /// `GET /runs/{id}/events`.
    pub events_json: Option<String>,
}

/// One row of [`Db::gg_run_versions`]: a gg run's id paired with its **mutation
/// timestamp**, and nothing else.
///
/// The deliberately tiny shape the [document index](crate::gg_docs::GgDocIndex)
/// reconciles against. Everything the index needs to decide what to do with a run
/// — is it new, did it change, is it gone — is in these two strings, so the common
/// case (nothing changed) costs one narrow scan and no deserialization at all.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GgRunVersion {
    /// The run id (`RunRecord.id`).
    pub id: String,
    /// RFC 3339 of the last write that changed anything observable about the row.
    /// Compared for **inequality only**; see the `run.updated_at` column docs.
    pub updated_at: String,
}

/// A published tournament as stored: the full record plus its first-publish
/// timestamp. This is the shape `GET /tournaments/{id}` is built from.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredTournament {
    /// The full tournament record (standings + per-match summaries).
    pub record: TournamentRecord,
    /// RFC 3339 of when this tournament was first published. Not part of the
    /// record itself.
    pub published_at: String,
}

/// A run's review as stored, attributed to the account that wrote it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredReview {
    /// The account that wrote the review.
    pub reviewer: Reviewer,
    /// The reviewer's per-domain functional ratings. This review's overall rating
    /// is the worst across them; the run's is the worst across all its reviews.
    /// Empty on a review of a validator-rated run, whose functional rating is not
    /// the reviewer's to give.
    pub ratings: Vec<DomainRating>,
    /// **Legacy:** the reviewer's per-domain aesthetic ratings, from when the
    /// channel was rated per scoring domain. Stored as a JSON array in the
    /// `review.aesthetics` column. Empty on a legacy run's review and on every
    /// new write — the channel is now run-wide (see
    /// [`aesthetic`](Self::aesthetic)); kept so old rows keep their tiers.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub aesthetics: Vec<DomainAesthetic>,
    /// The reviewer's **run-wide** aesthetic tier, on a review of a
    /// validator-rated run; `None` on a legacy run's review, which has no
    /// aesthetic channel. Stored in the `review.aesthetic` column; a decoded
    /// pre-migration row carries its legacy per-domain tiers **collapsed to the
    /// worst** here (`row_aesthetic`), so every read sees one run-wide tier.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aesthetic: Option<AestheticRating>,
    /// The markdown writeup body.
    pub writeup: String,
    /// The reviewer's verdicts on the case's declared checklist items. On a
    /// legacy run the full checklist; on a validator-rated run only the
    /// reviewer's **overrides** — the points whose verdict differs from the
    /// validators' (plus any the validators left undecided), overlaid per id when
    /// figures are derived. Stored as a JSON array in the `review.checklist`
    /// column. Empty for a case with no items, or a review with no overrides.
    pub checklist: Vec<ReviewVerdict>,
    /// RFC 3339 of when the review was **first** submitted. A later edit no longer
    /// overwrites this — it stamps [`edited_at`](Self::edited_at) instead.
    pub reviewed_at: String,
    /// RFC 3339 of when the review was last edited, or `None` if it has never been
    /// edited. The newest [`revisions`](Self::revisions) entry carries this timestamp.
    pub edited_at: Option<String>,
    /// The review's edit history, oldest first — one entry per edit, each with the
    /// reviewer's note and the autogenerated diff. Empty for a never-edited review.
    pub revisions: Vec<ReviewRevision>,
}

/// One of an account's recent reviews reduced to just what the account page's
/// Profile-tab breakdown charts aggregate over: the reviewed run's test-case slug
/// and model id, and the reviewer's own per-domain ratings. Returned by
/// [`Db::recent_review_subjects`].
#[derive(Debug, Clone)]
pub struct RecentReviewSubject {
    /// The reviewed run's test-case slug (all variants and versions of a case fold
    /// together under it).
    pub test_case_slug: String,
    /// The reviewed run's raw model id.
    pub model_id: String,
    /// This review's per-domain ratings; empty for a review that rated no domain (a
    /// game jam or a validator-rated run), or one whose stored ratings JSON no
    /// longer parsed.
    pub ratings: Vec<DomainRating>,
    /// This review's run-wide aesthetic tier (a legacy per-domain row collapsed to
    /// its worst tier — `row_aesthetic`); `None` for a legacy run's review, or
    /// one whose stored aesthetics JSON no longer parsed.
    pub aesthetic: Option<AestheticRating>,
}

/// The reviewing account a [`StoredReview`] is attributed to, denormalized from
/// the verified bearer token at submission so the snapshot is self-contained
/// (accounts live in the auth service's separate database).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Reviewer {
    /// The account id (from the auth service).
    pub user_id: String,
    /// The account's login handle.
    pub username: String,
    /// The account's human-facing display name.
    pub display_name: String,
}

/// The outcome of publishing a tournament into the store.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PublishOutcome {
    /// Whether the record was newly inserted (vs. an idempotent re-publish).
    pub newly_published: bool,
}

/// The outcome of pushing a run into the store.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PushOutcome {
    /// Whether the run was newly stored (vs. an idempotent re-push of an
    /// already-stored run).
    pub newly_pushed: bool,
}

/// The outcome of publishing a run (flipping it public).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PublishRunOutcome {
    /// Whether the run went from pending to published (vs. an idempotent
    /// re-publish of an already-published run).
    pub newly_published: bool,
}

/// The snapshot coalescing state persisted so a pending refresh survives a
/// restart (§2's `snapshot_state` table).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SnapshotState {
    /// Whether a publish has landed since the last successful upload.
    pub dirty: bool,
    /// RFC 3339 of the last successful R2 upload, or `None` if never uploaded.
    pub last_uploaded: Option<String>,
    /// Runs in the last uploaded snapshot, or `None` if never uploaded.
    pub last_run_count: Option<i64>,
}

/// The fixed primary key of the single-row `snapshot_state` table.
const SNAPSHOT_STATE_ID: i32 = 1;

/// The `backfill_state` key of [`Db::backfill_gg_config_id`].
const RUN_GG_CONFIG_ID_BACKFILL: &str = "run.gg_config_id";

/// The `backfill_state` key of [`Db::backfill_in_flight_gg_config_ids`].
const JOB_GG_CONFIG_ID_BACKFILL: &str = "job.gg_config_id";

/// The SeaORM-backed store.
pub struct Db {
    handle: ConnHandle,
}

/// How the store reaches its database: a fixed connection (SQLite, or a
/// password-authenticated `postgres://` URL), or a Microsoft Entra
/// managed-identity connection whose token — and therefore whose underlying pool —
/// rotates in the background.
enum ConnHandle {
    /// A connection built once from the URL. Cheap to clone (an `Arc` to the pool).
    Static(DatabaseConnection),
    /// A passwordless Azure AD connection; the current pool is read per query.
    AzureAd(std::sync::Arc<test_cabinet_db_auth::AzureAdDb>),
}

impl Db {
    /// The current SeaORM connection, as a cheap clone. Every query and
    /// transaction goes through this so that, under Azure AD auth, work runs on
    /// the pool built with the freshest token.
    fn conn(&self) -> DatabaseConnection {
        match &self.handle {
            ConnHandle::Static(conn) => conn.clone(),
            ConnHandle::AzureAd(db) => db.connection(),
        }
    }
    /// Connect to the store at `url`, choosing the backend by URL scheme
    /// (`sqlite://…` or `postgres://…`). For a SQLite **file** URL the parent
    /// directory is created first (so a fresh deployment works) and WAL +
    /// foreign-key pragmas are applied; both are no-ops for PostgreSQL. The schema
    /// is applied separately by the migration (see [`crate::build`]).
    pub async fn connect(url: &str) -> Result<Self> {
        if let Some(path) = sqlite_file_path(url)
            && let Some(parent) = path.parent()
            && !parent.as_os_str().is_empty()
        {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Database::connect(ConnectOptions::new(url.to_owned())).await?;
        Self::apply_sqlite_pragmas(&conn).await?;
        Ok(Self {
            handle: ConnHandle::Static(conn),
        })
    }

    /// Connect to a managed-PostgreSQL store using Microsoft Entra managed-identity
    /// (passwordless) authentication. `url` must name the Entra Postgres role as
    /// its username and carry no password; the access token is minted from the
    /// pod's Workload Identity and the connection pool is rebuilt as it rotates.
    /// See [`test_cabinet_db_auth`].
    pub async fn connect_azure_ad(url: &str) -> Result<Self> {
        let db = test_cabinet_db_auth::AzureAdDb::connect(url)
            .await
            .map_err(|err| sea_orm::DbErr::Custom(format!("Azure AD Postgres auth: {err}")))?;
        Ok(Self {
            handle: ConnHandle::AzureAd(std::sync::Arc::new(db)),
        })
    }

    /// Open an in-memory SQLite store with the schema migrated in (used by tests).
    /// The pool is pinned to one connection so the in-memory database — which is
    /// per-connection — persists for the store's lifetime.
    #[cfg(test)]
    pub async fn connect_in_memory() -> Result<Self> {
        use test_cabinet_migration::MigratorTrait;

        let mut opts = ConnectOptions::new("sqlite::memory:".to_owned());
        opts.max_connections(1).min_connections(1);
        let conn = Database::connect(opts).await?;
        Self::apply_sqlite_pragmas(&conn).await?;
        test_cabinet_migration::Migrator::up(&conn, None).await?;
        Ok(Self {
            handle: ConnHandle::Static(conn),
        })
    }

    /// The underlying connection, for the startup migration in [`crate::build`].
    /// Returns a cheap clone of the current pool (owned, so it stays valid across a
    /// background refresh under Azure AD auth).
    pub fn connection(&self) -> DatabaseConnection {
        self.conn()
    }

    /// Apply the SQLite-only pragmas. WAL is required by the Litestream backup
    /// path; foreign keys enforce the review/link cascades. A no-op on PostgreSQL.
    async fn apply_sqlite_pragmas(conn: &DatabaseConnection) -> Result<()> {
        if conn.get_database_backend() == DatabaseBackend::Sqlite {
            conn.execute_unprepared("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
                .await?;
        }
        Ok(())
    }

    /// Push a run: upsert the record (verbatim JSON + lifted columns) and its
    /// links in one transaction, **without** a review. The run starts
    /// unpublished, so it is private (not in the public snapshot) but its build
    /// is available for a reviewer to play. Idempotent on `record.id`: a re-push
    /// updates the record blob, lifted columns, links, and events but **preserves**
    /// the published flag and `published_at`. Marks the snapshot dirty only when
    /// the run is already published (an unpublished run is not in the snapshot, so
    /// re-pushing it changes nothing public).
    ///
    /// `manifest` is the run's case version as the definition store holds it (or
    /// `None` when the store does not have it). It decides whether the run is
    /// **validator-rated**: for such a run the functional `rating` starts as the
    /// validators' decision, derived from the record's `debug_scripts` and written
    /// here, at push time, so it is visible the moment the run completes — and a
    /// review may then move it by overriding verdicts (see [`Self::add_review`]),
    /// so a re-push recomputes it over the run's current reviews rather than
    /// clobbering a reviewed aggregate. A legacy run's `rating` stays
    /// review-maintained exactly as before.
    pub async fn push(
        &self,
        record: &RunRecord,
        links: &RunLinks,
        events_json: Option<&str>,
        manifest: Option<&StoredManifest>,
    ) -> Result<PushOutcome> {
        // The stored record always carries the resolved links, so the snapshot's
        // record blob and its `links` sibling never disagree.
        let mut record = record.clone();
        record.links = links.clone();
        let record_json = serde_json::to_string(&record)?;

        let txn = self.conn().begin().await?;

        let existing = run::Entity::find_by_id(record.id.clone()).one(&txn).await?;
        let newly_pushed = existing.is_none();
        let was_published = existing
            .as_ref()
            .map(|model| model.published)
            .unwrap_or(false);
        let existing_published_at = existing.and_then(|model| model.published_at);

        // The record-derived sort columns (test type, run time, tokens, cost) are
        // refreshed on every (re-)push; the review-derived columns (aesthetic /
        // review_count, and on a legacy run rating) are NOT touched here — they are
        // maintained by `add_review`, and a re-push must preserve an already-reviewed
        // run's aggregate. A brand-new push writes the zero-review defaults (no
        // aesthetic, count 0). On a validator-rated run `rating` is decided by the
        // validators *as overridden by the run's reviews*, so it is written (and
        // re-written) here over whatever reviews the run already carries — none on a
        // first push, which yields the validators' own figure.
        let lifted = lifted_run_metrics(&record);
        let validator_rated = manifest.is_some_and(StoredManifest::validator_rated);
        let rating = if validator_rated {
            let reviews = review::Entity::find()
                .filter(review::Column::RunId.eq(record.id.clone()))
                .all(&txn)
                .await?
                .into_iter()
                .map(stored_review)
                .collect::<Result<Vec<_>>>()?;
            lifted_rating(manifest, &record, &reviews)
        } else {
            None
        };
        let mut refreshed_columns = vec![
            run::Column::StartedAt,
            run::Column::FinishedAt,
            run::Column::TestCaseSlug,
            run::Column::TestCaseVersion,
            run::Column::Variant,
            run::Column::EngineSlug,
            run::Column::HarnessSlug,
            run::Column::HarnessVersion,
            run::Column::ModelId,
            run::Column::GgPreset,
            run::Column::GgConfigId,
            run::Column::GgModels,
            run::Column::TestType,
            run::Column::RunState,
            run::Column::RunTimeSeconds,
            run::Column::TotalTokens,
            run::Column::CostComparable,
            run::Column::CodeAnalyzerVersion,
            run::Column::Loaded,
            run::Column::RecordJson,
            run::Column::EventsJson,
            // The pushed record is one this build just serialized, so it is readable
            // by definition; a re-push of a run previously marked unreadable
            // therefore returns it to the listings.
            run::Column::RecordReadable,
            run::Column::RecordFormat,
        ];
        if validator_rated {
            refreshed_columns.extend([run::Column::Rating, run::Column::ValidatorRated]);
        }

        run::Entity::insert(run::ActiveModel {
            id: Set(record.id.clone()),
            started_at: Set(record.started_at.clone()),
            finished_at: Set(record.finished_at.clone()),
            published_at: Set(existing_published_at),
            test_case_slug: Set(record.subject.test_case_slug.clone()),
            test_case_version: Set(record.subject.test_case_version.clone()),
            variant: Set(record.subject.variant.clone()),
            engine_slug: Set(Some(record.subject.engine_slug.clone())),
            harness_slug: Set(record.subject.harness_slug.as_str().to_string()),
            harness_version: Set(record.subject.harness_version.clone()),
            model_id: Set(record.subject.model_id.clone()),
            gg_preset: Set(lifted.gg_preset),
            gg_config_id: Set(lifted.gg_config_id),
            gg_models: Set(lifted.gg_models),
            test_type: Set(lifted.test_type),
            run_state: Set(run_state_str(record.status.state).to_string()),
            run_time_seconds: Set(lifted.run_time_seconds),
            total_tokens: Set(lifted.total_tokens),
            cost_comparable: Set(lifted.cost_comparable),
            code_analyzer_version: Set(lifted.code_analyzer_version),
            rating: Set(rating),
            aesthetic: Set(None),
            validator_rated: Set(validator_rated),
            review_count: Set(0),
            loaded: Set(record.validation.loaded),
            published: Set(was_published),
            record_json: Set(record_json),
            record_readable: Set(true),
            record_format: Set(RUN_RECORD_FORMAT as i32),
            events_json: Set(events_json.map(|s| s.to_string())),
            // `NotSet` on both paths: the mutation timestamp is stamped by
            // `touch_run` below, inside this same transaction, so that exactly one
            // place in the store decides its value. The insert therefore lands on
            // the column's `''` default for an instant, and the upsert leaves the
            // prior value alone, but neither is ever committed.
            updated_at: NotSet,
        })
        .on_conflict(
            // Re-push updates the record and its lifted record-derived columns but
            // never the publish state (`Published`/`PublishedAt`, changed only by
            // `publish`) nor the review-derived `Aesthetic`/`ReviewCount` (maintained
            // by `add_review`). `Rating` is review-derived on a legacy run (left
            // alone) and record-derived on a validator-rated one (rewritten, with the
            // flag that says so).
            OnConflict::column(run::Column::Id)
                .update_columns(refreshed_columns)
                .to_owned(),
        )
        .exec(&txn)
        .await?;

        run_link::Entity::insert(run_link::ActiveModel {
            run_id: Set(record.id.clone()),
            source_repo: Set(links.source_repo.clone()),
            playable_build: Set(links.playable_build.clone()),
        })
        .on_conflict(
            OnConflict::column(run_link::Column::RunId)
                .update_columns([
                    run_link::Column::SourceRepo,
                    run_link::Column::PlayableBuild,
                ])
                .to_owned(),
        )
        .exec(&txn)
        .await?;

        touch_run(&txn, &record.id).await?;

        // Re-pushing an already-published run changes its public record, so mark
        // the snapshot dirty; pushing a pending run does not (it is not public).
        if was_published {
            set_dirty(&txn).await?;
        }

        txn.commit().await?;
        Ok(PushOutcome { newly_pushed })
    }

    /// Submit a review for a stored run, attributed to `review.reviewer`. An
    /// account reviews a run at most once: re-submitting from the same account
    /// updates that review rather than adding another.
    ///
    /// A re-submission that actually changes the review is an **edit**: it requires
    /// `edit_note` (a non-empty explanation of what changed — otherwise
    /// [`Unprocessable`](crate::error::BackendError::Unprocessable)), preserves the
    /// original `reviewed_at`, stamps `edited_at`, and records the prior→new
    /// [diff](test_cabinet_core::review::diff_reviews) as a `review_revision`. A
    /// re-submission that changes nothing is a no-op (no note needed, no revision). A
    /// first submission needs no note.
    ///
    /// `manifest` is the run's case version as the definition store holds it (or
    /// `None` when the store does not have it). On a **validator-rated** run it is
    /// what lets the lifted `rating` be recomputed here: a review may override
    /// validator verdicts, so the run's functional rating is re-derived from the
    /// full review set through the same seam push uses (`functional_rating` —
    /// worst across the reviews' effective ratings, the validators' own figure
    /// while the run has none). On a legacy run the manifest is not consulted.
    ///
    /// Returns the run's current published state so the caller can decide whether the
    /// public snapshot needs refreshing. Errors with
    /// [`NotFound`](crate::error::BackendError::NotFound) when no run with `run_id` is
    /// stored.
    pub async fn add_review(
        &self,
        run_id: &str,
        review: &StoredReview,
        edit_note: Option<&str>,
        manifest: Option<&StoredManifest>,
    ) -> Result<bool> {
        let ratings_json = serde_json::to_string(&review.ratings)?;
        let aesthetics_json = serde_json::to_string(&review.aesthetics)?;
        let checklist_json = serde_json::to_string(&review.checklist)?;
        let aesthetic_token = review.aesthetic.map(|rating| rating.as_str().to_string());

        let txn = self.conn().begin().await?;

        let run = run::Entity::find_by_id(run_id.to_string())
            .one(&txn)
            .await?
            .ok_or_else(|| {
                crate::error::BackendError::NotFound(format!("run `{run_id}` not found"))
            })?;

        // Reuse the existing review id for this (run, reviewer) pair so a
        // re-submission updates in place; mint a fresh id for a first review. An edit
        // that changed something records a revision and stamps `edited_at` while
        // keeping the first `reviewed_at`; a first submission sets `reviewed_at` and
        // leaves `edited_at` null.
        let existing = review::Entity::find()
            .filter(review::Column::RunId.eq(run_id))
            .filter(review::Column::ReviewerUserId.eq(&review.reviewer.user_id))
            .one(&txn)
            .await?;
        let (id, reviewed_at, edited_at) = match &existing {
            Some(prior) => {
                // Decode the prior row through the same path every read uses, so a
                // pre-migration row's legacy per-domain tiers are already collapsed
                // to the one run-wide tier the diff compares.
                let prior_review = stored_review(prior.clone())?;
                let diff = test_cabinet_core::review::diff_reviews(
                    test_cabinet_core::review::ReviewContent {
                        ratings: &prior_review.ratings,
                        aesthetic: prior_review.aesthetic,
                        writeup: &prior_review.writeup,
                        checklist: &prior_review.checklist,
                    },
                    test_cabinet_core::review::ReviewContent {
                        ratings: &review.ratings,
                        aesthetic: review.aesthetic,
                        writeup: &review.writeup,
                        checklist: &review.checklist,
                    },
                );
                if diff.is_empty() {
                    // Nothing changed: keep the existing timestamps and record no
                    // revision (and require no note for a no-op re-submit).
                    (
                        prior.id.clone(),
                        prior.reviewed_at.clone(),
                        prior.edited_at.clone(),
                    )
                } else {
                    let note = edit_note
                        .map(str::trim)
                        .filter(|note| !note.is_empty())
                        .ok_or_else(|| {
                            crate::error::BackendError::Unprocessable(
                                "editing a review requires a note explaining what changed"
                                    .to_string(),
                            )
                        })?;
                    let edited_at = review.reviewed_at.clone();
                    review_revision::Entity::insert(review_revision::ActiveModel {
                        id: Set(cuid2::create_id()),
                        review_id: Set(prior.id.clone()),
                        edited_at: Set(edited_at.clone()),
                        note: Set(note.to_string()),
                        diff: Set(serde_json::to_string(&diff)?),
                    })
                    .exec(&txn)
                    .await?;
                    (prior.id.clone(), prior.reviewed_at.clone(), Some(edited_at))
                }
            }
            None => (cuid2::create_id(), review.reviewed_at.clone(), None),
        };

        review::Entity::insert(review::ActiveModel {
            id: Set(id),
            run_id: Set(run_id.to_string()),
            reviewer_user_id: Set(review.reviewer.user_id.clone()),
            reviewer_username: Set(review.reviewer.username.clone()),
            reviewer_display_name: Set(review.reviewer.display_name.clone()),
            ratings: Set(ratings_json),
            aesthetics: Set(aesthetics_json),
            aesthetic: Set(aesthetic_token),
            writeup: Set(review.writeup.clone()),
            checklist: Set(checklist_json),
            reviewed_at: Set(reviewed_at),
            edited_at: Set(edited_at),
        })
        .on_conflict(
            OnConflict::column(review::Column::Id)
                // `reviewed_at` is deliberately NOT updated — it stays the first
                // submission time; an edit stamps `edited_at` instead.
                .update_columns([
                    review::Column::ReviewerUsername,
                    review::Column::ReviewerDisplayName,
                    review::Column::Ratings,
                    review::Column::Aesthetics,
                    review::Column::Aesthetic,
                    review::Column::Writeup,
                    review::Column::Checklist,
                    review::Column::EditedAt,
                ])
                .to_owned(),
        )
        .exec(&txn)
        .await?;

        // Recompute the lifted aesthetic / review_count (and, on a legacy run, the
        // rating) from the run's full review set (including the review just written)
        // so the console's sort columns stay in step with the reviews table.
        let reviews = review::Entity::find()
            .filter(review::Column::RunId.eq(run_id))
            .all(&txn)
            .await?
            .into_iter()
            .map(stored_review)
            .collect::<Result<Vec<_>>>()?;
        // On a validator-rated run the functional rating starts as the validators'
        // decision but folds in each review's overrides (worst across the reviews'
        // effective ratings), so a review moves it and it is recomputed here through
        // the same seam push uses — falling back to the column push wrote when the
        // caller has no manifest or the record no longer deserializes (recomputing
        // needs the case's checklist). On a legacy run it is the review aggregate.
        // The gate is a fact about the run record, not about the reviews, so the
        // record is read back here to compose it with the freshly-recomputed
        // aggregate. A record that will not deserialize cannot gate: a storage
        // problem must not silently mark a run broken.
        let rating = if run.validator_rated {
            match serde_json::from_str::<RunRecord>(&run.record_json).ok() {
                Some(record) if manifest.is_some() => lifted_rating(manifest, &record, &reviews),
                _ => run.rating.clone(),
            }
        } else {
            match serde_json::from_str::<RunRecord>(&run.record_json).ok() {
                Some(record) => lifted_rating(None, &record, &reviews),
                None => test_cabinet_core::review::aggregate_rating(
                    reviews.iter().map(|review| review.ratings.as_slice()),
                )
                .map(|rating| rating.as_str().to_string()),
            }
        };
        let aesthetic = lifted_aesthetic(&reviews);
        let review_count = reviews.len() as i64;

        let published = run.published;
        let mut active = run.into_active_model();
        active.rating = Set(rating);
        active.aesthetic = Set(aesthetic);
        active.review_count = Set(review_count);
        active.update(&txn).await?;

        touch_run(&txn, run_id).await?;

        // A new/updated review changes a published run's aggregate rating and
        // score, so refresh the snapshot; a pending run is not public.
        if published {
            set_dirty(&txn).await?;
        }

        txn.commit().await?;
        Ok(published)
    }

    /// Publish a stored run: flip it public. Refused with
    /// [`crate::error::BackendError::Unprocessable`] when the run is an
    /// infrastructure failure (never publishable) or when a *completed* run has no
    /// review yet; the publishable failure tiers (catastrophic,
    /// timed-out) need no review. [`crate::error::BackendError::NotFound`] when no
    /// run with `run_id` is
    /// stored. Idempotent: re-publishing an already-published run preserves its
    /// original `published_at`. Stamps `published_at` on the first publish.
    pub async fn publish(&self, run_id: &str, published_at: &str) -> Result<PublishRunOutcome> {
        let txn = self.conn().begin().await?;

        let run = run::Entity::find_by_id(run_id.to_string())
            .one(&txn)
            .await?
            .ok_or_else(|| {
                crate::error::BackendError::NotFound(format!("run `{run_id}` not found"))
            })?;

        // The gate (infrastructure → refuse; a legacy completed run needs ≥1 review;
        // a validator-rated one and the catastrophic/timed-out tiers are waived) is
        // shared with [`Db::ensure_publishable`], the publish-queue's at-enqueue check.
        gate_publishable(&txn, run_id, &run.run_state, run.validator_rated, false).await?;

        let newly_published = !run.published;
        // Preserve the first publish's timestamp on re-publish.
        let effective_published_at = run
            .published_at
            .clone()
            .unwrap_or_else(|| published_at.to_string());

        let mut active = run.into_active_model();
        active.published = Set(true);
        active.published_at = Set(Some(effective_published_at));
        active.update(&txn).await?;

        touch_run(&txn, run_id).await?;

        set_dirty(&txn).await?;

        txn.commit().await?;
        Ok(PublishRunOutcome { newly_published })
    }

    /// Delete a stored run and its dependent rows (its reviews and links cascade
    /// via their `ON DELETE CASCADE` foreign keys; its run- and publish-queue rows
    /// are deleted explicitly, as they reference the run by a plain column with no
    /// foreign key). [`crate::error::BackendError::NotFound`] when no run with
    /// `run_id` is stored.
    ///
    /// Refused with [`crate::error::BackendError::Unprocessable`] for a published
    /// run this build can read: a public run is in the snapshot and the gallery, so
    /// it can never be deleted out from under them. A published run this build
    /// cannot read is deleted, because it is already absent from both — every
    /// listing the snapshot is baked from serves the readable runs — and this is the
    /// only way to get rid of one short of a re-push.
    ///
    /// Reads the row rather than the record, so it deletes a run whose stored record
    /// no longer deserializes. Every run it deletes is outside the public snapshot,
    /// so no refresh is queued.
    pub async fn delete_run(&self, run_id: &str) -> Result<()> {
        let txn = self.conn().begin().await?;

        let run = run::Entity::find_by_id(run_id.to_string())
            .one(&txn)
            .await?
            .ok_or_else(|| {
                crate::error::BackendError::NotFound(format!("run `{run_id}` not found"))
            })?;

        if run.published && run.record_readable {
            return Err(crate::error::BackendError::Unprocessable(format!(
                "run `{run_id}` is published and cannot be deleted; only an unpublished run can be deleted"
            )));
        }

        // Reviews and the run's links row carry `ON DELETE CASCADE`, so deleting
        // the run removes them too. The run- and publish-queue rows reference the
        // run by a plain column (`job.record_id` / `publish_job.run_id`, no foreign
        // key back to the run), so they would otherwise be orphaned — delete them in
        // the same transaction so a deleted run leaves nothing behind.
        run::Entity::delete_by_id(run_id.to_string())
            .exec(&txn)
            .await?;
        job::Entity::delete_many()
            .filter(job::Column::RecordId.eq(run_id))
            .exec(&txn)
            .await?;
        publish_job::Entity::delete_many()
            .filter(publish_job::Column::RunId.eq(run_id))
            .exec(&txn)
            .await?;

        txn.commit().await?;
        Ok(())
    }

    /// Fetch one stored run by id (published or pending).
    pub async fn get_run(&self, id: &str) -> Result<Option<StoredRun>> {
        let run = run::Entity::find_by_id(id.to_string())
            .one(&self.conn())
            .await?;
        let Some(run) = run else {
            return Ok(None);
        };
        Ok(self.assemble(vec![run]).await?.into_iter().next())
    }

    /// Fetch one run's **row** by id — the lifted columns only, without decoding
    /// its `record_json` blob or joining its reviews and links. For a caller that
    /// needs a run's identity rather than its record (the publish-failure
    /// notification, which describes the run it could not release); use
    /// [`Db::get_run`] when the record itself is wanted.
    pub async fn get_run_row(&self, id: &str) -> Result<Option<run::Model>> {
        Ok(run::Entity::find_by_id(id.to_string())
            .one(&self.conn())
            .await?)
    }

    /// List **published** runs newest-first (by `published_at`), paginated by a
    /// `published_at` cursor. This is the public read side; pending runs never
    /// appear. Returns at most `limit` runs and the next cursor when more remain.
    pub async fn list_published(
        &self,
        limit: usize,
        before: Option<&str>,
    ) -> Result<(Vec<StoredRun>, Option<String>)> {
        let fetch = limit.saturating_add(1);
        let mut query = readable_runs().filter(run::Column::Published.eq(true));
        if let Some(before) = before {
            query = query.filter(run::Column::PublishedAt.lt(before));
        }
        let rows = query
            .order_by_desc(run::Column::PublishedAt)
            .order_by_desc(run::Column::Id)
            .limit(fetch as u64)
            .all(&self.conn())
            .await?;

        let mut runs = self.assemble(rows).await?;
        let next_before = if runs.len() > limit {
            runs.truncate(limit);
            runs.last().and_then(|run| run.published_at.clone())
        } else {
            None
        };
        Ok((runs, next_before))
    }

    /// List **completed** runs (pending and published) newest-first by
    /// `finished_at`, paginated by a `finished_at` cursor. This is the reviewer's
    /// worklist: it includes runs awaiting review, each carrying its current reviews
    /// and its published flag. Only completed runs appear — the failure tiers have
    /// no review checklist to complete (infrastructure failures are never
    /// publishable; catastrophic/timed-out runs publish through
    /// [`list_publishable_failures`](Self::list_publishable_failures)) — so the
    /// queue is not cluttered with runs a reviewer cannot act on.
    pub async fn list_for_review(
        &self,
        limit: usize,
        before: Option<&str>,
    ) -> Result<(Vec<StoredRun>, Option<String>)> {
        self.list_by_states(&["completed"], limit, before).await
    }

    /// List the **publishable failure** runs — catastrophic,
    /// timed-out, and harness-error (pending and published) — newest-first by
    /// `finished_at`, paginated by a `finished_at` cursor. These have no review checklist, so they
    /// are kept out of the reviewer worklist and surfaced in their own "publish
    /// failures" affordance, where each can be published with a single click (a
    /// harness error records only a per-model statistic). Infrastructure failures are
    /// excluded: they are retained for inspection but never publishable.
    pub async fn list_publishable_failures(
        &self,
        limit: usize,
        before: Option<&str>,
    ) -> Result<(Vec<StoredRun>, Option<String>)> {
        self.list_by_states(&publishable_failure_states(), limit, before)
            .await
    }

    /// List every **unpublished** run — pushed but not yet published, *whatever* its
    /// terminal state (completed, the publishable failure tiers, and the
    /// never-publishable infrastructure failures alike) — newest-first by
    /// `finished_at`, paginated by a `finished_at` cursor. This is the console's
    /// "produced" worklist: every run that exists in the store but is not yet public,
    /// so a console lists all of them (for review, for publishing a failure, or just
    /// to inspect an infrastructure failure that appears in no other worklist).
    /// Published runs are excluded — those are the public read side
    /// ([`list_published`](Self::list_published)). Disjoint from `list_published` by
    /// the `published` flag, so a console can merge the two without overlap.
    pub async fn list_unpublished(
        &self,
        limit: usize,
        before: Option<&str>,
    ) -> Result<(Vec<StoredRun>, Option<String>)> {
        let fetch = limit.saturating_add(1);
        let mut query = readable_runs().filter(run::Column::Published.eq(false));
        if let Some(before) = before {
            query = query.filter(run::Column::FinishedAt.lt(before));
        }
        let rows = query
            .order_by_desc(run::Column::FinishedAt)
            .order_by_desc(run::Column::Id)
            .limit(fetch as u64)
            .all(&self.conn())
            .await?;

        let mut runs = self.assemble(rows).await?;
        let next_before = if runs.len() > limit {
            runs.truncate(limit);
            runs.last().map(|run| run.record.finished_at.clone())
        } else {
            None
        };
        Ok((runs, next_before))
    }

    /// List the **unreviewed** runs — completed runs that no account has reviewed
    /// yet (`run_state = completed AND review_count = 0`) — newest-first by
    /// `finished_at`, paginated by a `finished_at` cursor. This is the reviewer's
    /// "nobody has looked at this" worklist, a strict subset of
    /// [`list_for_review`](Self::list_for_review): it drops the completed runs that
    /// already carry at least one review, so a reviewer sees only what still needs
    /// a first pass. The failure tiers are excluded for the same reason they are in
    /// the review worklist — they carry no review checklist. The automatically
    /// graded types (`AUTO_GRADED_TEST_TYPES`) are excluded on the same grounds:
    /// no reviewer can ever clear them from this list.
    pub async fn list_unreviewed(
        &self,
        limit: usize,
        before: Option<&str>,
    ) -> Result<(Vec<StoredRun>, Option<String>)> {
        let fetch = limit.saturating_add(1);
        let mut query = readable_runs()
            .filter(run::Column::RunState.eq("completed"))
            .filter(run::Column::ReviewCount.eq(0))
            .filter(run::Column::TestType.is_not_in(AUTO_GRADED_TEST_TYPES));
        if let Some(before) = before {
            query = query.filter(run::Column::FinishedAt.lt(before));
        }
        let rows = query
            .order_by_desc(run::Column::FinishedAt)
            .order_by_desc(run::Column::Id)
            .limit(fetch as u64)
            .all(&self.conn())
            .await?;

        let mut runs = self.assemble(rows).await?;
        let next_before = if runs.len() > limit {
            runs.truncate(limit);
            runs.last().map(|run| run.record.finished_at.clone())
        } else {
            None
        };
        Ok((runs, next_before))
    }

    /// List summary rows for the console's **numbered** pager: a `limit`-sized
    /// window at `offset`, ordered by the chosen lifted column (with an `id`
    /// tiebreak) under the supplied [`SummaryFilter`], **plus** the total count of
    /// matching rows (ignoring limit/offset) so the console can size the pager.
    ///
    /// This is a distinct path from the `before`-cursor listings (which the public
    /// snapshot drain and the reviewer worklist use) — it is OFFSET/COUNT-based and
    /// carries filter/free-text/sort parameters. The two never share a query. The
    /// backing store is embedded SQLite, so the count is a single `COUNT(*)` over
    /// the same predicate.
    ///
    /// Cost and rating NULLs (unknown cost / an unrated run) always sort **last**,
    /// in either direction: the ordering leads with a null-group key so the
    /// non-null rows precede the null ones regardless of `dir`. Rating is ordered by
    /// its **tier** (`flawless > great > passable > scuffed > broken`), not
    /// lexically — see `rating_rank_expr`.
    ///
    /// Both halves run over the readable-runs seam, so the total equals the number of
    /// rows the page can serve and a pager sized from it offers no empty pages. A run
    /// whose stored record this build cannot read is listed by
    /// [`list_unreadable_runs`](Self::list_unreadable_runs) instead.
    ///
    /// `assemble` preserves the input row order (it maps rows one-for-one), so the
    /// returned page stays in the sorted order.
    ///
    /// `case_names` is consulted only by [`SummarySort::TestCase`], which orders by
    /// the case's display name rather than its slug (see `case_name_expr`); every
    /// other sort may pass an empty map.
    pub async fn list_summaries(
        &self,
        filter: &SummaryFilter,
        sort: SummarySort,
        dir: SortDir,
        case_names: &CaseNames,
        limit: usize,
        offset: usize,
    ) -> Result<(Vec<StoredRun>, usize)> {
        // Resolve the current-version allowlist once (it costs its own query) and
        // hand it to both halves below, so COUNT and page share one predicate.
        let scope = self.resolve_version_scope(filter).await?;
        let scope = scope.as_deref();

        // The same predicate drives both the COUNT and the page; count first (no
        // limit/offset), then order + window the page.
        let total = summary_query(filter, scope).count(&self.conn()).await? as usize;

        let order = match dir {
            SortDir::Asc => Order::Asc,
            SortDir::Desc => Order::Desc,
        };
        let rows = apply_summary_sort(summary_query(filter, scope), sort, order.clone(), case_names)
            // A stable final tiebreak on the primary key so paging is deterministic
            // even when the sort column ties.
            .order_by(run::Column::Id, order)
            .limit(limit as u64)
            .offset(offset as u64)
            .all(&self.conn())
            .await?;

        let runs = self.assemble(rows).await?;
        Ok((runs, total))
    }

    /// The per-case current-version allowlist a filter asks for, or `None` when it
    /// does not (the toggle is off, or an explicit version selection — an exact
    /// [`SummaryFilter::version`] or a [`SummaryFilter::versions`] list — overrides
    /// it; see those fields).
    async fn resolve_version_scope(
        &self,
        filter: &SummaryFilter,
    ) -> Result<Option<Vec<CaseVersions>>> {
        let exact = filter.version.as_deref().is_some_and(|s| !s.is_empty())
            || filter.versions.as_deref().is_some_and(|v| !v.is_empty());
        if !filter.latest_versions || exact {
            return Ok(None);
        }
        Ok(Some(self.current_case_versions(filter.state).await?))
    }

    /// For every test case with a run in the `state` slice, the versions sharing
    /// that case's greatest `major.minor` — the allowlist a
    /// [`SummaryFilter::latest_versions`] listing is narrowed to.
    ///
    /// The current version is read off the **runs**, not the definition store, for
    /// two reasons: a listing can then say "the newest spec anyone has actually run"
    /// rather than emptying itself the moment a new version is authored but not yet
    /// run, and the static gallery — which has no store, only its run index — can
    /// answer the identical question from the same data (see the console UI's
    /// `runSummaryPage`). Both hosts therefore page identically.
    ///
    /// One `SELECT DISTINCT (test_case_slug, test_case_version)` covered by
    /// `idx_run_case`; the result is one row per case/version, not per run.
    pub async fn current_case_versions(&self, state: SummaryState) -> Result<Vec<CaseVersions>> {
        let pairs: Vec<(String, String)> = state_slice(state)
            .select_only()
            .column(run::Column::TestCaseSlug)
            .column(run::Column::TestCaseVersion)
            .distinct()
            .into_tuple()
            .all(&self.conn())
            .await?;
        Ok(current_versions(pairs))
    }

    /// List the runs an account has reviewed, newest-first by *when they reviewed*
    /// (not when the run finished), for the account's own "my reviews" numbered
    /// pager: a `limit`-sized window at `offset`, plus the total count of the
    /// account's reviews so the console can size the pager. Each returned
    /// [`StoredRun`] carries its full review set (the caller picks out this
    /// account's review by id). Ordering is driven by the `review` rows — the run's
    /// own `finished_at` is unrelated to when a given account reviewed it — so this
    /// is a distinct path from the run-centric listings above.
    ///
    /// The total is counted through the same join the page walks, so a review of a
    /// run whose record this build cannot read leaves the total and the page in
    /// agreement.
    pub async fn list_reviews_by_user(
        &self,
        user_id: &str,
        limit: usize,
        offset: usize,
    ) -> Result<(Vec<StoredRun>, usize)> {
        // Both halves join to the run and filter on readability, so the count and the
        // page answer the same question: a review of a run whose record this build
        // cannot read is neither counted nor returned.
        let reviewed = || {
            review::Entity::find()
                .filter(review::Column::ReviewerUserId.eq(user_id))
                .join(JoinType::InnerJoin, review::Relation::Run.def())
                .filter(run::Column::RecordReadable.eq(true))
        };
        let total = reviewed().count(&self.conn()).await? as usize;

        // The account's reviews, newest-first, windowed to this page. Each names its
        // run; the run ids (in this order) drive the returned run order.
        let review_rows: Vec<String> = reviewed()
            .select_only()
            .column(review::Column::RunId)
            .order_by_desc(review::Column::ReviewedAt)
            .order_by_desc(review::Column::Id)
            .limit(limit as u64)
            .offset(offset as u64)
            .into_tuple()
            .all(&self.conn())
            .await?;
        let ordered_run_ids: Vec<String> = review_rows;
        if ordered_run_ids.is_empty() {
            return Ok((Vec::new(), total));
        }

        // Load the runs by id, then restore the review-driven order (a `WHERE id IN`
        // query does not preserve the id list's order). A run id with no matching row
        // (a run deleted after the review, which the FK cascade normally prevents) is
        // simply dropped.
        let mut by_id: std::collections::HashMap<String, run::Model> = readable_runs()
            .filter(run::Column::Id.is_in(ordered_run_ids.clone()))
            .all(&self.conn())
            .await?
            .into_iter()
            .map(|run| (run.id.clone(), run))
            .collect();
        let ordered_rows: Vec<run::Model> = ordered_run_ids
            .into_iter()
            .filter_map(|id| by_id.remove(&id))
            .collect();

        let runs = self.assemble(ordered_rows).await?;
        Ok((runs, total))
    }

    /// The account's most recent `window` reviews, each reduced to just the fields the
    /// account page's Profile-tab breakdown charts aggregate over — the reviewed run's
    /// test-case slug and model id, and the reviewer's own per-domain ratings — newest
    /// first (by when they reviewed), plus the account's all-time review count.
    ///
    /// A single small join drives it (`review` → `run`), and the `window` bounds the
    /// "recently reviewed" scope so the aggregation stays cheap even for a prolific
    /// reviewer. A review whose stored ratings JSON no longer parses contributes an
    /// empty rating set — it still counts toward the case/model tallies — rather than
    /// failing the whole request.
    pub async fn recent_review_subjects(
        &self,
        user_id: &str,
        window: usize,
    ) -> Result<(Vec<RecentReviewSubject>, usize)> {
        let total = review::Entity::find()
            .filter(review::Column::ReviewerUserId.eq(user_id))
            .count(&self.conn())
            .await? as usize;

        // Select only the columns the charts need, joined to the review's run for
        // its subject. Column order here is the tuple order below.
        let rows: Vec<(String, String, String, String, Option<String>)> = review::Entity::find()
            .select_only()
            .column(run::Column::TestCaseSlug)
            .column(run::Column::ModelId)
            .column(review::Column::Ratings)
            .column(review::Column::Aesthetics)
            .column(review::Column::Aesthetic)
            .filter(review::Column::ReviewerUserId.eq(user_id))
            .join(JoinType::InnerJoin, review::Relation::Run.def())
            .order_by_desc(review::Column::ReviewedAt)
            .order_by_desc(review::Column::Id)
            .limit(window as u64)
            .into_tuple()
            .all(&self.conn())
            .await?;

        let subjects = rows
            .into_iter()
            .map(
                |(test_case_slug, model_id, ratings_json, aesthetics_json, aesthetic)| {
                    let legacy: Vec<DomainAesthetic> =
                        serde_json::from_str(&aesthetics_json).unwrap_or_default();
                    RecentReviewSubject {
                        test_case_slug,
                        model_id,
                        ratings: serde_json::from_str(&ratings_json).unwrap_or_default(),
                        aesthetic: row_aesthetic(
                            aesthetic.as_deref().and_then(AestheticRating::parse),
                            &legacy,
                        ),
                    }
                },
            )
            .collect();
        Ok((subjects, total))
    }

    /// Shared worklist query: runs whose `run_state` is one of `states` (pending
    /// and published), newest-first by `finished_at`, paginated by a `finished_at`
    /// cursor.
    async fn list_by_states(
        &self,
        states: &[&str],
        limit: usize,
        before: Option<&str>,
    ) -> Result<(Vec<StoredRun>, Option<String>)> {
        let fetch = limit.saturating_add(1);
        let mut query = readable_runs().filter(run::Column::RunState.is_in(states.iter().copied()));
        if let Some(before) = before {
            query = query.filter(run::Column::FinishedAt.lt(before));
        }
        let rows = query
            .order_by_desc(run::Column::FinishedAt)
            .order_by_desc(run::Column::Id)
            .limit(fetch as u64)
            .all(&self.conn())
            .await?;

        let mut runs = self.assemble(rows).await?;
        let next_before = if runs.len() > limit {
            runs.truncate(limit);
            runs.last().map(|run| run.record.finished_at.clone())
        } else {
            None
        };
        Ok((runs, next_before))
    }

    /// Load every stored run for one test case (pending and published),
    /// newest-first by `finished_at`. Used to enumerate an adversarial case's
    /// pushed controllers for the arena (the caller filters to adversarial runs
    /// that uploaded a controller). Unpaginated: an adversarial case's field is
    /// small.
    pub async fn list_for_case(&self, slug: &str) -> Result<Vec<StoredRun>> {
        let rows = readable_runs()
            .filter(run::Column::TestCaseSlug.eq(slug.to_string()))
            .order_by_desc(run::Column::FinishedAt)
            .order_by_desc(run::Column::Id)
            .all(&self.conn())
            .await?;
        self.assemble(rows).await
    }

    /// The `(id, updated_at)` projection of every stored **gg** run (harness `gg`),
    /// pending and published — the whole cost of a steady-state
    /// [document index](crate::gg_docs::GgDocIndex) reconcile.
    ///
    /// Deliberately selects **two columns and no record blob**. The index this feeds
    /// holds one built document per gg run and refreshes on a timer; if that refresh
    /// re-read `record_json` it would deserialize the entire corpus every cycle,
    /// which is precisely the per-query cost the index exists to stop paying. So the
    /// projection answers only "which runs exist, and which of them changed", and
    /// [`gg_runs_by_id`](Self::gg_runs_by_id) then loads just the changed ones.
    ///
    /// `updated_at` is compared for **inequality**, never ordered — see the column's
    /// own documentation on `run::Model`, whose RFC 3339 rendering drops a zero
    /// fractional part and so does not sort reliably between two stamps less than a
    /// second apart.
    pub async fn gg_run_versions(&self) -> Result<Vec<GgRunVersion>> {
        let rows: Vec<(String, String)> = run::Entity::find()
            .select_only()
            .column(run::Column::Id)
            .column(run::Column::UpdatedAt)
            .filter(run::Column::HarnessSlug.eq(HarnessSlug::Gg.as_str()))
            .order_by_asc(run::Column::Id)
            .into_tuple()
            .all(&self.conn())
            .await?;
        Ok(rows
            .into_iter()
            .map(|(id, updated_at)| GgRunVersion { id, updated_at })
            .collect())
    }

    /// Load the named runs in full (record, reviews, links, publish state). The
    /// result is keyed by [`RunRecord::id`] rather than positional — order is
    /// unspecified beyond being deterministic — because its caller indexes the runs
    /// by id anyway.
    ///
    /// The companion to [`gg_run_versions`](Self::gg_run_versions): the document
    /// index reconciles per id, so this is called with **only the ids whose
    /// `updated_at` moved**, not with the corpus. Ids are looked up in chunks so the
    /// bound parameter count stays well inside every backend's ceiling (SQLite's
    /// 32 766, PostgreSQL's 65 535) no matter how many runs changed in one cycle —
    /// a first, cold reconcile passes every id there is.
    ///
    /// A run whose stored record no longer deserializes is **omitted** rather than
    /// failing the load, exactly as every other listing here treats it; the caller
    /// sees fewer runs than ids and must not mistake that for "not yet loaded".
    pub async fn gg_runs_by_id(&self, ids: &[String]) -> Result<Vec<StoredRun>> {
        /// Ids per lookup round. Comfortably under every backend's bound-parameter
        /// ceiling while keeping a cold reconcile of tens of thousands of runs to a
        /// modest number of round trips.
        const CHUNK: usize = 500;

        let mut out = Vec::with_capacity(ids.len());
        for chunk in ids.chunks(CHUNK) {
            let rows = run::Entity::find()
                .filter(run::Column::Id.is_in(chunk.to_vec()))
                .order_by_asc(run::Column::Id)
                .all(&self.conn())
                .await?;
            out.extend(self.assemble(rows).await?);
        }
        Ok(out)
    }

    /// The gameplay READMEs of earlier game-jam runs of jam `slug` built by
    /// `model_id`, oldest first — the material a repeated jam run is briefed with so
    /// it can build something distinct.
    ///
    /// Matches on `(slug, model, test_type = game-jam)` **across harnesses**: what
    /// repeats a game is the model, not the tool driving it, so an entry the same
    /// model built under another harness is exactly the history a new run must not
    /// retread. It spans **all** prior runs regardless of publish state (a run is
    /// persisted here on completion, before any publish), and returns only those that
    /// actually captured a README. A row whose stored record no longer deserializes is
    /// skipped (as elsewhere) rather than failing the lookup.
    pub async fn game_jam_prior_readmes(
        &self,
        slug: &str,
        model_id: &str,
    ) -> Result<Vec<PriorGameJamEntry>> {
        let rows: Vec<(String, String, String)> = run::Entity::find()
            .select_only()
            .column(run::Column::Id)
            .column(run::Column::FinishedAt)
            .column(run::Column::RecordJson)
            .filter(run::Column::TestCaseSlug.eq(slug.to_string()))
            .filter(run::Column::ModelId.eq(model_id.to_string()))
            .filter(run::Column::TestType.eq(TestType::GameJam.as_str()))
            .order_by_asc(run::Column::FinishedAt)
            .order_by_asc(run::Column::Id)
            .into_tuple()
            .all(&self.conn())
            .await?;

        let mut entries = Vec::new();
        for (id, finished_at, record_json) in rows {
            let record: RunRecord = match serde_json::from_str(&record_json) {
                Ok(record) => record,
                Err(err) => {
                    tracing::warn!(
                        run_id = %id,
                        error = %err,
                        "skipping prior game-jam run whose stored record no longer deserializes",
                    );
                    continue;
                }
            };
            if let Some(readme) = record.game_jam_readme {
                entries.push(PriorGameJamEntry {
                    run_id: id,
                    finished_at,
                    readme,
                });
            }
        }
        Ok(entries)
    }

    /// Load every **published** run, newest-first, for full snapshot
    /// regeneration. Pending (unpublished) runs are excluded — the public
    /// snapshot only ever contains published runs.
    pub async fn all_published(&self) -> Result<Vec<StoredRun>> {
        let rows = readable_runs()
            .filter(run::Column::Published.eq(true))
            .order_by_desc(run::Column::PublishedAt)
            .order_by_desc(run::Column::Id)
            .all(&self.conn())
            .await?;
        self.assemble(rows).await
    }

    /// Every stored run's id, published and pending alike.
    ///
    /// The live set the [artifact reclamation sweep](crate::artifacts) protects a
    /// tree with: a tree whose id is absent from this set is referenced by nothing in
    /// the system of record. Only the id column is selected, so the query stays a
    /// single index-sized read regardless of how much a run row holds.
    pub async fn all_run_ids(&self) -> Result<std::collections::HashSet<String>> {
        let ids: Vec<String> = run::Entity::find()
            .select_only()
            .column(run::Column::Id)
            .into_tuple()
            .all(&self.conn())
            .await?;
        Ok(ids.into_iter().collect())
    }

    /// The distinct `(test_case_slug, test_case_version)` pairs referenced by **any**
    /// stored run — published *and* pending. This is the set a whole-catalog ingest
    /// must never prune from the definition store: a definition a run depends on has
    /// to stay resolvable so the run remains reviewable/playable and keeps its case
    /// metadata in the public snapshot, even after its source folder is renamed or
    /// removed from the checkout. Pending runs are included because a pushed-but-
    /// unpublished run is still reviewable and must resolve its definition.
    pub async fn referenced_cases(&self) -> Result<std::collections::HashSet<(String, String)>> {
        let rows: Vec<(String, String)> = run::Entity::find()
            .select_only()
            .column(run::Column::TestCaseSlug)
            .column(run::Column::TestCaseVersion)
            .distinct()
            .into_tuple()
            .all(&self.conn())
            .await?;
        Ok(rows.into_iter().collect())
    }

    /// The `/stats/cabinet` projection: every stored run's start time, lifted
    /// token total, comparable cost, case slug, and model id — five lifted
    /// columns across the **whole** corpus (every state, published or not),
    /// folded in Rust by [`fold_cabinet_stats`](crate::stats::fold_cabinet_stats).
    /// No SQL aggregation or date function is used, so SQLite and Postgres fold
    /// identically.
    pub async fn cabinet_stat_rows(&self) -> Result<Vec<crate::stats::CabinetRunRow>> {
        Ok(run::Entity::find()
            .select_only()
            .column(run::Column::StartedAt)
            .column(run::Column::TotalTokens)
            .column(run::Column::CostComparable)
            .column(run::Column::TestCaseSlug)
            .column(run::Column::ModelId)
            .into_tuple()
            .all(&self.conn())
            .await?)
    }

    /// The total number of published runs (the count that lands in the snapshot).
    /// Counts the readable rows only, which is exactly what
    /// [`all_published`](Self::all_published) puts in the snapshot.
    pub async fn run_count(&self) -> Result<i64> {
        Ok(readable_runs()
            .filter(run::Column::Published.eq(true))
            .count(&self.conn())
            .await? as i64)
    }

    /// Assemble [`StoredRun`]s from `run` rows: batch-load their links and reviews
    /// and stitch them in. Keeps the per-run review fan-out to two queries total
    /// regardless of page size.
    ///
    /// A row whose stored record no longer deserializes is dropped from the result
    /// and marked unreadable, which is the lazy repair path for a build that changed
    /// the record contract without bumping [`RUN_RECORD_FORMAT`]. Callers select
    /// through [`readable_runs`], so in the steady state nothing is dropped here.
    async fn assemble(&self, runs: Vec<run::Model>) -> Result<Vec<StoredRun>> {
        if runs.is_empty() {
            return Ok(Vec::new());
        }
        let ids: Vec<String> = runs.iter().map(|run| run.id.clone()).collect();

        let mut link_map: std::collections::HashMap<String, run_link::Model> =
            run_link::Entity::find()
                .filter(run_link::Column::RunId.is_in(ids.clone()))
                .all(&self.conn())
                .await?
                .into_iter()
                .map(|link| (link.run_id.clone(), link))
                .collect();

        let mut review_map: std::collections::HashMap<String, Vec<StoredReview>> =
            std::collections::HashMap::new();
        let reviews = review::Entity::find()
            .filter(review::Column::RunId.is_in(ids))
            .order_by_asc(review::Column::ReviewedAt)
            .order_by_asc(review::Column::Id)
            .all(&self.conn())
            .await?;
        // Batch-load the reviews' edit histories (oldest edit first), grouped by
        // review id, so each stored review carries its revisions in one extra query.
        let review_ids: Vec<String> = reviews.iter().map(|review| review.id.clone()).collect();
        let mut revisions_by_review: std::collections::HashMap<String, Vec<ReviewRevision>> =
            std::collections::HashMap::new();
        if !review_ids.is_empty() {
            let rows = review_revision::Entity::find()
                .filter(review_revision::Column::ReviewId.is_in(review_ids))
                .order_by_asc(review_revision::Column::EditedAt)
                .order_by_asc(review_revision::Column::Id)
                .all(&self.conn())
                .await?;
            for row in rows {
                revisions_by_review
                    .entry(row.review_id.clone())
                    .or_default()
                    .push(stored_review_revision(row)?);
            }
        }
        for review in reviews {
            let run_id = review.run_id.clone();
            let revisions = revisions_by_review.remove(&review.id).unwrap_or_default();
            review_map
                .entry(run_id)
                .or_default()
                .push(stored_review_with_revisions(review, revisions)?);
        }

        let mut out = Vec::with_capacity(runs.len());
        let mut unreadable: Vec<String> = Vec::new();
        for run in runs {
            // Tolerate a single record that no longer matches the current
            // `RunRecord` schema: skip it (with a warning) rather than failing the
            // whole page. A stored record can predate a contract change — e.g. an
            // animated-voxel run recorded before F-curve keyframes gained their
            // required `interp` field — and without this guard one such legacy row
            // would 500 an entire worklist, blanking the console. The row is marked
            // unreadable below, which is what keeps it out of the count as well as
            // out of the page and puts it on the unreadable listing.
            let record: RunRecord = match serde_json::from_str(&run.record_json) {
                Ok(record) => record,
                Err(err) => {
                    tracing::warn!(
                        run_id = %run.id,
                        error = %err,
                        "skipping run whose stored record no longer deserializes against the \
                         current RunRecord schema (likely predates a contract change)",
                    );
                    unreadable.push(run.id.clone());
                    continue;
                }
            };
            let link = link_map.remove(&run.id);
            out.push(StoredRun {
                record,
                reviews: review_map.remove(&run.id).unwrap_or_default(),
                rating: run.rating.as_deref().and_then(Rating::parse),
                aesthetic: run.aesthetic.as_deref().and_then(AestheticRating::parse),
                validator_rated: run.validator_rated,
                links: RunLinks {
                    source_repo: link.as_ref().and_then(|l| l.source_repo.clone()),
                    playable_build: link.and_then(|l| l.playable_build.clone()),
                },
                published: run.published,
                published_at: run.published_at,
                events_json: run.events_json,
            });
        }
        if !unreadable.is_empty() {
            self.mark_unreadable(unreadable).await;
        }
        Ok(out)
    }

    /// Mark the named rows unreadable at the current [`RUN_RECORD_FORMAT`].
    ///
    /// Best-effort on a read path: the caller has already produced its answer, so a
    /// failed marker write is logged and swallowed rather than turned into a `500`.
    /// It runs on its own connection, outside any caller transaction, and it does
    /// **not** stamp `updated_at` — see that column's documentation.
    async fn mark_unreadable(&self, ids: Vec<String>) {
        let count = ids.len();
        let update = run::Entity::update_many()
            .col_expr(run::Column::RecordReadable, Expr::value(false))
            .col_expr(
                run::Column::RecordFormat,
                Expr::value(RUN_RECORD_FORMAT as i32),
            )
            .filter(run::Column::Id.is_in(ids))
            .exec(&self.conn())
            .await;
        match update {
            Ok(_) => tracing::info!(count, "marked runs whose stored record no longer reads"),
            Err(err) => tracing::warn!(
                error = %err,
                count,
                "failed to mark runs whose stored record no longer reads",
            ),
        }
    }

    /// Re-decide the readability of every `run` row whose marker was decided under a
    /// record-format generation other than [`RUN_RECORD_FORMAT`], and return how
    /// many rows it re-decided.
    ///
    /// The cost contract: no rows at all in the steady state, because a push stamps
    /// the current generation; one bounded pass over the whole corpus at the boot of
    /// a build that bumped the constant. The pass selects `id` and `record_json`
    /// only, in `id`-ordered batches, so memory stays flat regardless of corpus size.
    ///
    /// An `id` cursor rather than offset paging: a re-decided row leaves the stale
    /// predicate mid-pass, which would shift offset pages.
    pub async fn revalidate_run_records(&self) -> Result<usize> {
        const BATCH: u64 = 256;
        let stamp = RUN_RECORD_FORMAT as i32;
        let mut decided = 0usize;
        let mut cursor: Option<String> = None;
        loop {
            let mut query = run::Entity::find().filter(run::Column::RecordFormat.ne(stamp));
            if let Some(after) = cursor.as_deref() {
                query = query.filter(run::Column::Id.gt(after));
            }
            let rows: Vec<(String, String)> = query
                .select_only()
                .column(run::Column::Id)
                .column(run::Column::RecordJson)
                .order_by_asc(run::Column::Id)
                .limit(BATCH)
                .into_tuple()
                .all(&self.conn())
                .await?;
            let Some((last, _)) = rows.last() else {
                break;
            };
            cursor = Some(last.clone());

            for (id, record_json) in rows {
                let readable = serde_json::from_str::<RunRecord>(&record_json).is_ok();
                run::Entity::update_many()
                    .col_expr(run::Column::RecordReadable, Expr::value(readable))
                    .col_expr(run::Column::RecordFormat, Expr::value(stamp))
                    .filter(run::Column::Id.eq(id))
                    .exec(&self.conn())
                    .await?;
                decided += 1;
            }
        }
        Ok(decided)
    }

    /// One page of the stored runs this build cannot read, newest-first by
    /// `finished_at`, plus the total number of such runs.
    ///
    /// Paged like every other listing, from one predicate shared by the count and
    /// the page, so `total` counts exactly the rows the listing can serve across its
    /// pages and a pager sized from it offers only pages that hold rows.
    ///
    /// Each row carries the identity its lifted columns hold and the error decoding
    /// its record produces now, which is the only way an operator learns why the run
    /// is here. This is what keeps a run that appears in no other listing reachable:
    /// it is read here and deleted through [`delete_run`](Self::delete_run), which
    /// acts on the row rather than the record.
    pub async fn list_unreadable_runs(
        &self,
        limit: usize,
        offset: usize,
    ) -> Result<(Vec<UnreadableRun>, usize)> {
        let unreadable = || run::Entity::find().filter(run::Column::RecordReadable.eq(false));
        let total = unreadable().count(&self.conn()).await? as usize;
        let rows = unreadable()
            .order_by_desc(run::Column::FinishedAt)
            .order_by_desc(run::Column::Id)
            .limit(limit as u64)
            .offset(offset as u64)
            .all(&self.conn())
            .await?;
        let runs = rows
            .into_iter()
            .map(|row| UnreadableRun {
                error: match serde_json::from_str::<RunRecord>(&row.record_json) {
                    // The row is marked unreadable but decodes now, which happens
                    // between a contract change and the sweep that re-decides it.
                    // Say so rather than reporting an error that does not exist.
                    Ok(_) => "the stored record decodes against the current contract; \
                              this row is awaiting revalidation"
                        .to_string(),
                    Err(err) => err.to_string(),
                },
                id: row.id,
                started_at: row.started_at,
                finished_at: row.finished_at,
                test_case_slug: row.test_case_slug,
                test_case_version: row.test_case_version,
                variant: row.variant,
                engine_slug: row.engine_slug,
                harness_slug: row.harness_slug,
                model_id: row.model_id,
                gg_preset: row.gg_preset,
                test_type: row.test_type,
                run_state: row.run_state,
                published: row.published,
                review_count: row.review_count,
            })
            .collect();
        Ok((runs, total))
    }

    /// Publish a tournament: upsert its verbatim `TournamentRecord` JSON plus the
    /// lifted columns. Idempotent on `record.id`: a re-publish updates the record
    /// blob but **keeps** the original `published_at`. Tournaments are live-only
    /// (served straight from SQLite), so this does **not** mark the snapshot dirty.
    pub async fn publish_tournament(
        &self,
        record: &TournamentRecord,
        published_at: &str,
    ) -> Result<PublishOutcome> {
        let record_json = serde_json::to_string(record)?;

        let txn = self.conn().begin().await?;
        let existing_published_at = tournament::Entity::find_by_id(record.id.clone())
            .one(&txn)
            .await?
            .map(|model| model.published_at);
        let newly_published = existing_published_at.is_none();
        let effective_published_at =
            existing_published_at.unwrap_or_else(|| published_at.to_string());

        tournament::Entity::insert(tournament::ActiveModel {
            id: Set(record.id.clone()),
            published_at: Set(effective_published_at),
            created_at: Set(record.created_at.clone()),
            test_case_slug: Set(record.test_case_slug.clone()),
            test_case_version: Set(record.test_case_version.clone()),
            variant: Set(record.variant.clone()),
            participant_count: Set(record.participants.len() as i32),
            record_json: Set(record_json),
        })
        .on_conflict(
            OnConflict::column(tournament::Column::Id)
                .update_columns([
                    tournament::Column::CreatedAt,
                    tournament::Column::TestCaseSlug,
                    tournament::Column::TestCaseVersion,
                    tournament::Column::Variant,
                    tournament::Column::ParticipantCount,
                    tournament::Column::RecordJson,
                ])
                .to_owned(),
        )
        .exec(&txn)
        .await?;

        txn.commit().await?;
        Ok(PublishOutcome { newly_published })
    }

    /// Fetch one stored tournament by id.
    pub async fn get_tournament(&self, id: &str) -> Result<Option<StoredTournament>> {
        tournament::Entity::find_by_id(id.to_string())
            .one(&self.conn())
            .await?
            .map(stored_tournament)
            .transpose()
    }

    /// List stored tournaments newest-first (by `published_at`), paginated by a
    /// `published_at` cursor — the same scheme as [`Db::list_published`].
    pub async fn list_tournaments(
        &self,
        limit: usize,
        before: Option<&str>,
    ) -> Result<(Vec<StoredTournament>, Option<String>)> {
        let fetch = limit.saturating_add(1);
        let mut query = tournament::Entity::find();
        if let Some(before) = before {
            query = query.filter(tournament::Column::PublishedAt.lt(before));
        }
        let rows = query
            .order_by_desc(tournament::Column::PublishedAt)
            .order_by_desc(tournament::Column::Id)
            .limit(fetch as u64)
            .all(&self.conn())
            .await?;

        let mut tournaments = rows
            .into_iter()
            .map(stored_tournament)
            .collect::<Result<Vec<_>>>()?;
        let next_before = if tournaments.len() > limit {
            tournaments.truncate(limit);
            tournaments.last().map(|t| t.published_at.clone())
        } else {
            None
        };
        Ok((tournaments, next_before))
    }

    /// Read the snapshot coalescing state, defaulting to a clean state when the
    /// row has never been written.
    pub async fn snapshot_state(&self) -> Result<SnapshotState> {
        let state = snapshot_state::Entity::find_by_id(SNAPSHOT_STATE_ID)
            .one(&self.conn())
            .await?
            .map(|model| SnapshotState {
                dirty: model.dirty,
                last_uploaded: model.last_uploaded,
                last_run_count: model.last_run_count,
            })
            .unwrap_or(SnapshotState {
                dirty: false,
                last_uploaded: None,
                last_run_count: None,
            });
        Ok(state)
    }

    /// Mark the snapshot dirty (a publish has landed). Coalescing reads this to
    /// decide whether a refresh is needed.
    pub async fn mark_dirty(&self) -> Result<()> {
        set_dirty(&self.conn()).await
    }

    /// Record a successful upload: clear the dirty flag and stamp the upload time
    /// and run count.
    pub async fn mark_uploaded(&self, uploaded_at: &str, run_count: i64) -> Result<()> {
        snapshot_state::Entity::insert(snapshot_state::ActiveModel {
            id: Set(SNAPSHOT_STATE_ID),
            dirty: Set(false),
            last_uploaded: Set(Some(uploaded_at.to_string())),
            last_run_count: Set(Some(run_count)),
        })
        .on_conflict(
            OnConflict::column(snapshot_state::Column::Id)
                .update_columns([
                    snapshot_state::Column::Dirty,
                    snapshot_state::Column::LastUploaded,
                    snapshot_state::Column::LastRunCount,
                ])
                .to_owned(),
        )
        .exec(&self.conn())
        .await?;
        Ok(())
    }
}

/// Set the single-row snapshot state's `dirty` flag, inserting the row on first
/// use. Shared by [`Db::publish`] (within its transaction) and [`Db::mark_dirty`].
async fn set_dirty<C: ConnectionTrait>(conn: &C) -> Result<()> {
    snapshot_state::Entity::insert(snapshot_state::ActiveModel {
        id: Set(SNAPSHOT_STATE_ID),
        dirty: Set(true),
        last_uploaded: NotSet,
        last_run_count: NotSet,
    })
    .on_conflict(
        OnConflict::column(snapshot_state::Column::Id)
            .update_column(snapshot_state::Column::Dirty)
            .to_owned(),
    )
    .exec(conn)
    .await?;
    Ok(())
}

/// Stamp `run.updated_at` for `run_id` with the current time — the row's
/// **mutation timestamp**, and the one signal a cache or index can key on to learn
/// that a stored run now means something different.
///
/// **Every mutator of a `run` row must call this**, and none may write the column
/// any other way. That obligation is enforced by convention alone: the in-memory
/// document index behind the gg query language reconciles per id against a narrow
/// `(id, updated_at)` projection, so a mutation that forgets to stamp does not
/// fail — it silently serves the pre-mutation document forever. Concentrating the
/// write here at least makes the obligation one call, greppable and identical
/// everywhere, rather than a field assignment to be remembered at each new site.
///
/// Deliberately a separate `UPDATE` rather than a field on each mutator's
/// `ActiveModel`: [`Db::push`] writes its row through an upsert whose conflict
/// clause would otherwise have to list the column too (a second, easily forgotten
/// obligation), and an update-many keyed on the id is uniform across the insert and
/// update paths alike. Callers inside a transaction pass the transaction, so the
/// stamp commits or rolls back with the mutation it describes.
async fn touch_run<C: ConnectionTrait>(conn: &C, run_id: &str) -> Result<()> {
    let now = OffsetDateTime::now_utc().format(&Rfc3339)?;
    run::Entity::update_many()
        .col_expr(run::Column::UpdatedAt, Expr::value(now))
        .filter(run::Column::Id.eq(run_id))
        .exec(conn)
        .await?;
    Ok(())
}

/// The publish gate, factored out so both [`Db::publish`] (the legacy/desktop
/// flip) and [`Db::ensure_publishable`] (the publish-queue's at-enqueue check)
/// enforce it identically.
///
/// Publishability is decided by the run's terminal state. Infrastructure failures
/// are the Test Cabinet's fault, not a model result, and canceled runs were stopped
/// by an operator rather than reaching an outcome; neither is ever publishable.
/// Legacy completed runs publish through the review gate (≥1 review). A
/// **validator-rated** completed run needs none: its functional rating and score
/// are decided by its validators and stand on their own, so a blatantly broken
/// build reaches the gallery without costing a reviewer's time (an aesthetic review
/// can still be added later). The publishable failure tiers — catastrophic,
/// timed-out, and harness-error — are real model signal: publishable, but with no
/// review checklist to complete, so the review-count requirement is waived for them
/// (they publish through the separate publish-failures path).
async fn gate_publishable<C: ConnectionTrait>(
    conn: &C,
    run_id: &str,
    run_state: &str,
    validator_rated: bool,
    allow_auto_validated: bool,
) -> Result<()> {
    if never_publishable_states().contains(&run_state) {
        let reason = if run_state == "canceled" {
            "was canceled by an operator"
        } else {
            "is an infrastructure failure"
        };
        return Err(crate::error::BackendError::Unprocessable(format!(
            "run `{run_id}` {reason} and can never be published"
        )));
    }
    let is_publishable_failure = publishable_failure_states().contains(&run_state);
    if !is_publishable_failure && !validator_rated {
        let review_count = review::Entity::find()
            .filter(review::Column::RunId.eq(run_id))
            .count(conn)
            .await?;
        if review_count == 0 {
            // The single sanctioned waiver of the review requirement beyond the
            // catastrophic-failure states: an auto-validated comparison run. A
            // comparison scores each run from its automated validators (no human
            // review), so publishing its runs — which the comparison publish path
            // requests with `allow_auto_validated` — must not require a review that
            // was deliberately never done. Any other publish path keeps the review
            // requirement. A run with no automated verdicts is still refused: there is
            // nothing to stand in for the missing review.
            let waived = allow_auto_validated && run_has_auto_verdicts(conn, run_id).await?;
            if !waived {
                return Err(crate::error::BackendError::Unprocessable(format!(
                    "run `{run_id}` has no reviews — a run needs at least one review before it can be published"
                )));
            }
        }
    }
    Ok(())
}

/// Whether a run carries at least one automated validation verdict — the signal
/// that it was scored by a machine and can stand in for the human review the
/// comparison publish path waives. Reads the run's stored record and looks for any
/// `debug_scripts` verdict; a run whose record is missing or unparseable, or that ran
/// no validators, has none.
async fn run_has_auto_verdicts<C: ConnectionTrait>(conn: &C, run_id: &str) -> Result<bool> {
    let Some(row) = run::Entity::find_by_id(run_id.to_string())
        .one(conn)
        .await?
    else {
        return Ok(false);
    };
    let Ok(record) = serde_json::from_str::<RunRecord>(&row.record_json) else {
        return Ok(false);
    };
    Ok(record
        .validation
        .debug_scripts
        .iter()
        .any(|script| !script.verdicts.is_empty()))
}

/// Whether a publish job has gone quiet long enough to be treated as **abandoned**
/// — its publisher died without ever reporting a terminal result, so it must stop
/// blocking new publishes for its run (see [`PUBLISH_JOB_STALE_AFTER`]).
///
/// Only a `dispatched` job can be abandoned: a `queued` one has no publisher yet and
/// the dispatcher will claim it, however long it has waited. A timestamp that does
/// not parse is treated as *not* abandoned, so a malformed row fails closed —
/// blocking a duplicate publish rather than silently permitting one.
fn is_abandoned_publish_job(job: &publish_job::Model, now: &str) -> bool {
    if job.state != "dispatched" {
        return false;
    }
    use time::format_description::well_known::Rfc3339;
    let (Ok(updated), Ok(now)) = (
        time::OffsetDateTime::parse(&job.updated_at, &Rfc3339),
        time::OffsetDateTime::parse(now, &Rfc3339),
    ) else {
        return false;
    };
    now - updated > PUBLISH_JOB_STALE_AFTER
}

/// Decode a `review` row into the in-memory [`StoredReview`], parsing its
/// JSON-backed ratings/checklist columns.
fn stored_review(model: review::Model) -> Result<StoredReview> {
    stored_review_with_revisions(model, Vec::new())
}

/// Decode a `review` row into a [`StoredReview`], attaching its already-loaded edit
/// [`revisions`](StoredReview::revisions) (oldest first). Read paths that surface a
/// review's history batch-load the `review_revision` rows and pass them here; paths
/// that only need the current review (the rating recompute, the sort-column backfill)
/// use [`stored_review`] and get an empty history.
fn stored_review_with_revisions(
    model: review::Model,
    revisions: Vec<ReviewRevision>,
) -> Result<StoredReview> {
    let ratings: Vec<DomainRating> = serde_json::from_str(&model.ratings)?;
    let aesthetics: Vec<DomainAesthetic> = serde_json::from_str(&model.aesthetics)?;
    let checklist: Vec<ReviewVerdict> = serde_json::from_str(&model.checklist)?;
    let aesthetic = row_aesthetic(
        model.aesthetic.as_deref().and_then(AestheticRating::parse),
        &aesthetics,
    );
    Ok(StoredReview {
        reviewer: Reviewer {
            user_id: model.reviewer_user_id,
            username: model.reviewer_username,
            display_name: model.reviewer_display_name,
        },
        ratings,
        aesthetics,
        aesthetic,
        writeup: model.writeup,
        checklist,
        reviewed_at: model.reviewed_at,
        edited_at: model.edited_at,
        revisions,
    })
}

/// Decode a `review_revision` row into a [`ReviewRevision`] (its stored `diff` JSON
/// parsed back into a [`ReviewDiff`]).
fn stored_review_revision(model: review_revision::Model) -> Result<ReviewRevision> {
    let diff: ReviewDiff = serde_json::from_str(&model.diff)?;
    Ok(ReviewRevision {
        edited_at: model.edited_at,
        note: model.note,
        diff,
    })
}

/// Decode a `tournament` row into the in-memory [`StoredTournament`].
fn stored_tournament(model: tournament::Model) -> Result<StoredTournament> {
    let record: TournamentRecord = serde_json::from_str(&model.record_json)?;
    Ok(StoredTournament {
        record,
        published_at: model.published_at,
    })
}

/// The columns lifted out of a run's `RunRecord` for the console's sort/filter
/// listing, computed once and applied on every insert/upsert of the run row.
struct LiftedRunMetrics {
    /// The kebab-case test-type token (`record.subject.test_type`).
    test_type: String,
    /// The gg configuration name the run was launched from, or `None` for a non-gg
    /// run or a gg run assembled without one (see [`lifted_gg_preset`]).
    gg_preset: Option<String>,
    /// The id of the gg configuration the run was launched from, or `None` for a
    /// non-gg run or a gg run assembled without one (see [`lifted_gg_config_id`]).
    gg_config_id: Option<String>,
    /// The models the run's gg capability set binds, as one comparable string, or
    /// `None` for a non-gg run (see [`lifted_gg_models`]).
    gg_models: Option<String>,
    /// End-to-end wall-clock time in seconds (`record.metrics.run_time_seconds`).
    run_time_seconds: f64,
    /// Total token count across every class — the same sum the UI's `totalTokens`
    /// shows — with an unreported/absent total stored as `0`.
    total_tokens: i64,
    /// Comparable cost (USD), or `None` when the cost is unknown.
    cost_comparable: Option<f64>,
    /// The static code analyzer's generation, from `record.code_analysis`, or `None` for a
    /// run that carries no analysis (see [`lifted_code_analyzer_version`]).
    code_analyzer_version: Option<i32>,
}

/// Lift the record-derived sort columns out of a run's record. Reuses the core
/// [`TokenCounts::total`](test_cabinet_core::metrics::TokenCounts::total) so the
/// lifted `total_tokens` matches the UI's headline figure exactly.
fn lifted_run_metrics(record: &RunRecord) -> LiftedRunMetrics {
    LiftedRunMetrics {
        test_type: record.subject.test_type.as_str().to_string(),
        gg_preset: lifted_gg_preset(record),
        gg_config_id: lifted_gg_config_id(record),
        gg_models: lifted_gg_models(record),
        run_time_seconds: record.metrics.run_time_seconds,
        total_tokens: record.metrics.tokens.total().unwrap_or(0) as i64,
        cost_comparable: record.metrics.cost.comparable,
        code_analyzer_version: lifted_code_analyzer_version(record),
    }
}

/// The lifted `run.code_analyzer_version` column value: which generation of the static
/// analyzer produced the run's code figures, or `None`.
///
/// Read straight off the record rather than from this build's
/// [`CODE_ANALYZER_VERSION`](test_cabinet_core::CODE_ANALYZER_VERSION) constant, and the
/// distinction is the whole point: a backend redeployed with a newer analyzer must not
/// restamp an older run's figures with a generation that did not compute them. The column
/// describes the *stored result*, not the server.
///
/// Single-sided like [`lifted_gg_preset`]: a `NULL` means the run carries no analysis at
/// all, so a consumer may treat absence as "never analysed" without re-deriving anything.
fn lifted_code_analyzer_version(record: &RunRecord) -> Option<i32> {
    record
        .code_analysis
        .as_ref()
        .map(|analysis| analysis.analyzer_version as i32)
}

/// The lifted `run.gg_preset` column value: the name of the gg configuration the
/// run was launched from, or `None`.
///
/// Gated on the **harness**, not on the capability set alone, so the column's
/// contract is single-sided: a non-gg run can never hold a preset, and every
/// consumer may therefore fall back to `model_id` with a bare `COALESCE` instead of
/// re-deriving the harness test. (The console applies the same guard when it
/// resolves the cell — see `useEnrichedRuns` in
/// `packages/ui/src/app/components/runColumns.tsx`.)
fn lifted_gg_preset(record: &RunRecord) -> Option<String> {
    if record.subject.harness_slug != HarnessSlug::Gg {
        return None;
    }
    record
        .subject
        .gg_capability_set
        .as_ref()
        .and_then(|set| set.preset.clone())
}

/// The lifted `run.gg_config_id` column value: the id of the gg configuration the run
/// was launched from, or `None`.
///
/// The first half of a gg run's [cell identity](CellKey) — the id, not the
/// [name](lifted_gg_preset), because a name is rewritten freely and is unique to nothing,
/// while the id a configuration is minted with is the same text tomorrow.
///
/// Gated on the **harness** exactly as [`lifted_gg_preset`] is, so a set that somehow rode
/// in on a third-party-harness record cannot put the run in a cell no gg run can join. A
/// gg run assembled by hand carries no configuration and so no id, which reads as the
/// empty segment — the harness form of the cell key.
fn lifted_gg_config_id(record: &RunRecord) -> Option<String> {
    if record.subject.harness_slug != HarnessSlug::Gg {
        return None;
    }
    record
        .subject
        .gg_capability_set
        .as_ref()
        .and_then(|set| set.preset_id.clone())
}

/// The lifted `run.gg_models` column value: the models the run's capability set binds,
/// sorted, de-duplicated and comma-joined, or `None`.
///
/// The other half of a gg run's [cell identity](CellKey), and gated on the **harness**
/// exactly as [`lifted_gg_config_id`] and [`lifted_gg_preset`] are, so the three are
/// written and absent together and a consumer that has tested one need not re-derive the
/// others. (Absent for one further reason of its own: a hand-assembled set names no
/// configuration, so it has an id and a name of `None` while still binding models.)
///
/// The string is asked of the contract
/// ([`bound_model_key`](test_cabinet_core::gg::GgCapabilitySet::bound_model_key)) rather
/// than assembled here, because the enqueue lift writes the same value onto the job and
/// a cell only counts while a queued run and the run it becomes agree to the byte.
fn lifted_gg_models(record: &RunRecord) -> Option<String> {
    if record.subject.harness_slug != HarnessSlug::Gg {
        return None;
    }
    record
        .subject
        .gg_capability_set
        .as_ref()
        .map(|set| set.bound_model_key())
}

/// A **legacy** run's functional rating: the aggregate review rating — the worst
/// rating any reviewer gave any domain — or `None` when the run carries no reviews.
/// Wraps the core [`aggregate_rating`](test_cabinet_core::review::aggregate_rating);
/// [`functional_rating`] is the seam that picks between this and the
/// validator-decided rating.
///
/// The record is taken as well as the reviews because a run can be rated `broken`
/// *without* any reviewer saying so: a case's gating `typecheck` that ran and failed
/// disqualifies the run (see
/// [`RunRecord::gated_broken`](test_cabinet_core::RunRecord::gated_broken)). The gate
/// is composed over the reviews here, at the single seam that derives a run's one
/// overall rating, rather than written into any reviewer's stored marks.
pub(crate) fn aggregate_review_rating(
    record: &RunRecord,
    reviews: &[StoredReview],
) -> Option<test_cabinet_core::review::Rating> {
    test_cabinet_core::review::gated_rating(
        record.gated_broken(),
        test_cabinet_core::review::aggregate_rating(
            reviews.iter().map(|review| review.ratings.as_slice()),
        ),
    )
}

/// A review row's **run-wide** aesthetic tier: the `aesthetic` column when set,
/// else the worst tier across its `legacy` per-domain `aesthetics` JSON (which
/// equals the old per-domain aggregation, so a pre-migration row displays
/// unchanged), else `None` (a legacy run's review, no aesthetic channel). The
/// single place the legacy shape collapses — every read path goes through it at
/// decode ([`stored_review_with_revisions`], [`Db::recent_review_subjects`]).
pub(crate) fn row_aesthetic(
    aesthetic: Option<AestheticRating>,
    legacy: &[DomainAesthetic],
) -> Option<AestheticRating> {
    aesthetic.or_else(|| AestheticRating::worst(legacy.iter().map(|entry| entry.rating)))
}

/// The run's aggregate **aesthetic** rating — the worst run-wide tier across its
/// reviews — or `None` when no review rated the aesthetic channel (a legacy run,
/// or a validator-rated run nobody has reviewed yet). The single source of truth
/// for the lifted `run.aesthetic` column and the summary cards; wraps the core
/// [`aggregate_aesthetic`](test_cabinet_core::review::aggregate_aesthetic).
/// No gate composes over it: the toolchain gate is a functional verdict.
pub(crate) fn aggregate_review_aesthetic(reviews: &[StoredReview]) -> Option<AestheticRating> {
    test_cabinet_core::review::aggregate_aesthetic(reviews.iter().map(|review| review.aesthetic))
}

/// **The run's functional rating** — the single seam every consumer derives it
/// through: the lifted `run.rating` column (at push and on review-add) and the
/// summary cards (the console listing and the snapshot).
///
/// `manifest` is the run's case version as the store holds it (`None` when the
/// store does not have it). On a [validator-rated](StoredManifest::validator_rated)
/// version the rating is the validators' decision (each failing scored point
/// capping its declared domains at its failure cap) **as overridden by the run's
/// reviews**: each review's checklist overlays the validators' verdicts and the
/// run takes the worst across the reviews' effective ratings
/// ([`validator_aggregate_rating`](test_cabinet_core::review::validator_aggregate_rating));
/// with zero reviews the validators' own figure stands, so it is `Some` from the
/// moment the run completes. Otherwise it is the legacy review aggregate
/// ([`aggregate_review_rating`]), `None` while the run has no reviews. Both are
/// composed with the toolchain gate.
pub(crate) fn functional_rating(
    manifest: Option<&StoredManifest>,
    record: &RunRecord,
    reviews: &[StoredReview],
) -> Option<Rating> {
    match manifest.filter(|manifest| manifest.validator_rated()) {
        Some(manifest) => {
            let variant = record.subject.variant.as_str();
            let items = crate::snapshot::review_items_for_engine(
                manifest,
                variant,
                &record.subject.engine_slug,
            );
            let domains = crate::snapshot::domains_for(manifest, variant);
            let auto =
                test_cabinet_core::comparison::automated_verdicts(&record.validation.debug_scripts);
            test_cabinet_core::review::validator_aggregate_rating(
                record.gated_broken(),
                &domains,
                &items,
                &auto,
                reviews.iter().map(|review| review.checklist.as_slice()),
            )
        }
        None => aggregate_review_rating(record, reviews),
    }
}

/// Reviewer coverage plans and the run/job counts the coverage matrix is built
/// from. A plan is per-account (keyed by the auth-service user id); the counts are
/// **global** — they tally every run/job for a cell regardless of who launched it,
/// so two reviewers dividing the model space never redo each other's runs.
impl Db {
    /// Every coverage group the account owns, both kinds, ordered by display name.
    pub async fn list_coverage_groups(
        &self,
        user_id: &str,
    ) -> Result<Vec<crate::api::CoverageGroup>> {
        coverage_group::Entity::find()
            .filter(coverage_group::Column::UserId.eq(user_id))
            .order_by_asc(coverage_group::Column::Name)
            .all(&self.conn())
            .await?
            .into_iter()
            .map(coverage_group_from_row)
            .collect()
    }

    /// One coverage group by id, scoped to the owning account (`None` when the id is
    /// unknown or owned by someone else).
    pub async fn get_coverage_group(
        &self,
        user_id: &str,
        id: &str,
    ) -> Result<Option<crate::api::CoverageGroup>> {
        let Some(row) = coverage_group::Entity::find_by_id(id.to_string())
            .one(&self.conn())
            .await?
        else {
            return Ok(None);
        };
        if row.user_id != user_id {
            return Ok(None);
        }
        Ok(Some(coverage_group_from_row(row)?))
    }

    /// Insert a new coverage group (id already minted by the handler).
    pub async fn insert_coverage_group(
        &self,
        user_id: &str,
        group: &crate::api::CoverageGroup,
    ) -> Result<()> {
        coverage_group::ActiveModel {
            id: Set(group.id.clone()),
            user_id: Set(user_id.to_string()),
            kind: Set(group.kind.as_str().to_string()),
            name: Set(group.name.clone()),
            members_json: Set(coverage_group_members_json(group)?),
            updated_at: Set(group.updated_at.clone()),
        }
        .insert(&self.conn())
        .await?;
        Ok(())
    }

    /// Update a coverage group in place, scoped to the owning account. Returns
    /// whether a row matched (false → unknown id or not the caller's).
    pub async fn update_coverage_group(
        &self,
        user_id: &str,
        group: &crate::api::CoverageGroup,
    ) -> Result<bool> {
        let res = coverage_group::Entity::update_many()
            .col_expr(
                coverage_group::Column::Kind,
                Expr::value(group.kind.as_str()),
            )
            .col_expr(
                coverage_group::Column::Name,
                Expr::value(group.name.clone()),
            )
            .col_expr(
                coverage_group::Column::MembersJson,
                Expr::value(coverage_group_members_json(group)?),
            )
            .col_expr(
                coverage_group::Column::UpdatedAt,
                Expr::value(group.updated_at.clone()),
            )
            .filter(coverage_group::Column::Id.eq(group.id.clone()))
            .filter(coverage_group::Column::UserId.eq(user_id))
            .exec(&self.conn())
            .await?;
        Ok(res.rows_affected > 0)
    }

    /// Delete a coverage group, scoped to the owning account. Returns whether a row
    /// was removed.
    pub async fn delete_coverage_group(&self, user_id: &str, id: &str) -> Result<bool> {
        let res = coverage_group::Entity::delete_many()
            .filter(coverage_group::Column::Id.eq(id))
            .filter(coverage_group::Column::UserId.eq(user_id))
            .exec(&self.conn())
            .await?;
        Ok(res.rows_affected > 0)
    }

    /// Every coverage plan the account owns, ordered by display name.
    pub async fn list_coverage_plans(
        &self,
        user_id: &str,
    ) -> Result<Vec<crate::api::CoveragePlan>> {
        coverage_plan::Entity::find()
            .filter(coverage_plan::Column::UserId.eq(user_id))
            .order_by_asc(coverage_plan::Column::Name)
            .all(&self.conn())
            .await?
            .into_iter()
            .map(coverage_plan_from_row)
            .collect()
    }

    /// One coverage plan by id, scoped to the owning account.
    pub async fn get_coverage_plan(
        &self,
        user_id: &str,
        id: &str,
    ) -> Result<Option<crate::api::CoveragePlan>> {
        let Some(row) = coverage_plan::Entity::find_by_id(id.to_string())
            .one(&self.conn())
            .await?
        else {
            return Ok(None);
        };
        if row.user_id != user_id {
            return Ok(None);
        }
        Ok(Some(coverage_plan_from_row(row)?))
    }

    /// Insert a new coverage plan (id already minted by the handler) with the
    /// [schedule](CoveragePlanSchedule) it starts under.
    ///
    /// The schedule is a separate argument rather than part of the plan because the
    /// two are edited apart (see [`CoveragePlanSchedule`]) — but a *create* has to
    /// state one, so it is required here. A caller with no opinion passes
    /// [`CoveragePlanSchedule::default`], which reproduces the behaviour plans had
    /// before they could be scheduled at all.
    pub async fn insert_coverage_plan(
        &self,
        user_id: &str,
        plan: &crate::api::CoveragePlan,
        schedule: &CoveragePlanSchedule,
    ) -> Result<()> {
        coverage_plan::ActiveModel {
            id: Set(plan.id.clone()),
            user_id: Set(user_id.to_string()),
            name: Set(plan.name.clone()),
            runs_per_cell: Set(plan.runs_per_cell as i32),
            combo_group_ids_json: Set(serde_json::to_string(&plan.combo_group_ids)?),
            case_group_ids_json: Set(serde_json::to_string(&plan.case_group_ids)?),
            combos_json: Set(serde_json::to_string(&plan.combos)?),
            cases_json: Set(serde_json::to_string(&plan.cases)?),
            outer_axis: Set(schedule.outer_axis.clone()),
            paused: Set(schedule.paused),
            auto_top_up: Set(schedule.auto_top_up),
            buffer_target: Set(schedule.buffer_target.map(buffer_target_to_column)),
            // A fresh plan is nobody's claim: the marker is only ever set by a top-up
            // taking the plan, and cleared when it lets go.
            topping_up_at: Set(None),
            updated_at: Set(plan.updated_at.clone()),
        }
        .insert(&self.conn())
        .await?;
        Ok(())
    }

    /// Update a coverage plan in place, scoped to the owning account. Returns whether
    /// a row matched.
    ///
    /// Writes the plan's **declaration** only — its members and target. The
    /// [schedule](CoveragePlanSchedule) columns are deliberately untouched, so saving
    /// an edit to a plan's model list can never un-pause it or silently reset its
    /// buffer target under a reviewer who paused it thirty seconds earlier; those
    /// travel through [`Self::set_coverage_plan_schedule`].
    pub async fn update_coverage_plan(
        &self,
        user_id: &str,
        plan: &crate::api::CoveragePlan,
    ) -> Result<bool> {
        let res = coverage_plan::Entity::update_many()
            .col_expr(coverage_plan::Column::Name, Expr::value(plan.name.clone()))
            .col_expr(
                coverage_plan::Column::RunsPerCell,
                Expr::value(plan.runs_per_cell as i32),
            )
            .col_expr(
                coverage_plan::Column::ComboGroupIdsJson,
                Expr::value(serde_json::to_string(&plan.combo_group_ids)?),
            )
            .col_expr(
                coverage_plan::Column::CaseGroupIdsJson,
                Expr::value(serde_json::to_string(&plan.case_group_ids)?),
            )
            .col_expr(
                coverage_plan::Column::CombosJson,
                Expr::value(serde_json::to_string(&plan.combos)?),
            )
            .col_expr(
                coverage_plan::Column::CasesJson,
                Expr::value(serde_json::to_string(&plan.cases)?),
            )
            .col_expr(
                coverage_plan::Column::UpdatedAt,
                Expr::value(plan.updated_at.clone()),
            )
            .filter(coverage_plan::Column::Id.eq(plan.id.clone()))
            .filter(coverage_plan::Column::UserId.eq(user_id))
            .exec(&self.conn())
            .await?;
        Ok(res.rows_affected > 0)
    }

    /// Delete a coverage plan, scoped to the owning account. Returns whether a row
    /// was removed.
    pub async fn delete_coverage_plan(&self, user_id: &str, id: &str) -> Result<bool> {
        let res = coverage_plan::Entity::delete_many()
            .filter(coverage_plan::Column::Id.eq(id))
            .filter(coverage_plan::Column::UserId.eq(user_id))
            .exec(&self.conn())
            .await?;
        Ok(res.rows_affected > 0)
    }

    /// Every saved gg configuration the account owns, ordered by display name.
    pub async fn list_gg_configs(&self, user_id: &str) -> Result<Vec<crate::api::GgConfig>> {
        gg_config::Entity::find()
            .filter(gg_config::Column::UserId.eq(user_id))
            .order_by_asc(gg_config::Column::Name)
            .all(&self.conn())
            .await?
            .into_iter()
            .map(gg_config_from_row)
            .collect()
    }

    /// One saved gg configuration by id, scoped to the owning account (`None` when
    /// the id is unknown or belongs to someone else).
    pub async fn get_gg_config(
        &self,
        user_id: &str,
        id: &str,
    ) -> Result<Option<crate::api::GgConfig>> {
        let Some(row) = gg_config::Entity::find_by_id(id.to_string())
            .one(&self.conn())
            .await?
        else {
            return Ok(None);
        };
        if row.user_id != user_id {
            return Ok(None);
        }
        Ok(Some(gg_config_from_row(row)?))
    }

    /// Insert a new gg configuration (id already minted by the handler).
    pub async fn insert_gg_config(
        &self,
        user_id: &str,
        config: &crate::api::GgConfig,
    ) -> Result<()> {
        gg_config::ActiveModel {
            id: Set(config.id.clone()),
            user_id: Set(user_id.to_string()),
            name: Set(config.name.clone()),
            description: Set(config.description.clone()),
            capability_set_json: Set(serde_json::to_string(&config.capability_set)?),
            agent_sources_json: Set(Some(serde_json::to_string(&config.agent_sources)?)),
            updated_at: Set(config.updated_at.clone()),
        }
        .insert(&self.conn())
        .await?;
        Ok(())
    }

    /// Update a gg configuration in place, scoped to the owning account. Returns
    /// whether a row matched.
    pub async fn update_gg_config(
        &self,
        user_id: &str,
        config: &crate::api::GgConfig,
    ) -> Result<bool> {
        let res = gg_config::Entity::update_many()
            .col_expr(gg_config::Column::Name, Expr::value(config.name.clone()))
            .col_expr(
                gg_config::Column::Description,
                Expr::value(config.description.clone()),
            )
            .col_expr(
                gg_config::Column::CapabilitySetJson,
                Expr::value(serde_json::to_string(&config.capability_set)?),
            )
            .col_expr(
                gg_config::Column::AgentSourcesJson,
                Expr::value(serde_json::to_string(&config.agent_sources)?),
            )
            .col_expr(
                gg_config::Column::UpdatedAt,
                Expr::value(config.updated_at.clone()),
            )
            .filter(gg_config::Column::Id.eq(config.id.clone()))
            .filter(gg_config::Column::UserId.eq(user_id))
            .exec(&self.conn())
            .await?;
        Ok(res.rows_affected > 0)
    }

    /// Delete a gg configuration, scoped to the owning account. Returns whether a
    /// row was removed. Runs already launched from it are unaffected — each records
    /// its own capability set.
    pub async fn delete_gg_config(&self, user_id: &str, id: &str) -> Result<bool> {
        let res = gg_config::Entity::delete_many()
            .filter(gg_config::Column::Id.eq(id))
            .filter(gg_config::Column::UserId.eq(user_id))
            .exec(&self.conn())
            .await?;
        Ok(res.rows_affected > 0)
    }

    /// Every saved gg agent the account owns, ordered by name.
    pub async fn list_gg_agents(&self, user_id: &str) -> Result<Vec<crate::api::GgSavedAgent>> {
        gg_agent::Entity::find()
            .filter(gg_agent::Column::UserId.eq(user_id))
            .order_by_asc(gg_agent::Column::Name)
            .all(&self.conn())
            .await?
            .into_iter()
            .map(gg_agent_from_row)
            .collect()
    }

    /// One saved gg agent by id, scoped to the owning account (`None` when the id is
    /// unknown or belongs to someone else).
    pub async fn get_gg_agent(
        &self,
        user_id: &str,
        id: &str,
    ) -> Result<Option<crate::api::GgSavedAgent>> {
        let Some(row) = gg_agent::Entity::find_by_id(id.to_string())
            .one(&self.conn())
            .await?
        else {
            return Ok(None);
        };
        if row.user_id != user_id {
            return Ok(None);
        }
        Ok(Some(gg_agent_from_row(row)?))
    }

    /// Insert a new saved gg agent (id already minted by the handler).
    pub async fn insert_gg_agent(
        &self,
        user_id: &str,
        agent: &crate::api::GgSavedAgent,
    ) -> Result<()> {
        gg_agent::ActiveModel {
            id: Set(agent.id.clone()),
            user_id: Set(user_id.to_string()),
            name: Set(agent.name.clone()),
            description: Set(agent.description.clone()),
            agent_json: Set(serde_json::to_string(&agent.agent)?),
            updated_at: Set(agent.updated_at.clone()),
        }
        .insert(&self.conn())
        .await?;
        Ok(())
    }

    /// Update a saved gg agent in place, scoped to the owning account. Returns whether
    /// a row matched. Every configuration that imported it follows the change, except
    /// in the fields it overrides.
    pub async fn update_gg_agent(
        &self,
        user_id: &str,
        agent: &crate::api::GgSavedAgent,
    ) -> Result<bool> {
        let res = gg_agent::Entity::update_many()
            .col_expr(gg_agent::Column::Name, Expr::value(agent.name.clone()))
            .col_expr(
                gg_agent::Column::Description,
                Expr::value(agent.description.clone()),
            )
            .col_expr(
                gg_agent::Column::AgentJson,
                Expr::value(serde_json::to_string(&agent.agent)?),
            )
            .col_expr(
                gg_agent::Column::UpdatedAt,
                Expr::value(agent.updated_at.clone()),
            )
            .filter(gg_agent::Column::Id.eq(agent.id.clone()))
            .filter(gg_agent::Column::UserId.eq(user_id))
            .exec(&self.conn())
            .await?;
        Ok(res.rows_affected > 0)
    }

    /// Delete a saved gg agent, scoped to the owning account. Returns whether a row was
    /// removed. A configuration that imported it keeps its own resolved copy and stops
    /// following this one.
    pub async fn delete_gg_agent(&self, user_id: &str, id: &str) -> Result<bool> {
        let res = gg_agent::Entity::delete_many()
            .filter(gg_agent::Column::Id.eq(id))
            .filter(gg_agent::Column::UserId.eq(user_id))
            .exec(&self.conn())
            .await?;
        Ok(res.rows_affected > 0)
    }

    /// One plan's [schedule](CoveragePlanSchedule), scoped to the owning account
    /// (`None` when the id is unknown or owned by someone else).
    pub async fn coverage_plan_schedule(
        &self,
        user_id: &str,
        id: &str,
    ) -> Result<Option<CoveragePlanSchedule>> {
        Ok(coverage_plan::Entity::find_by_id(id.to_string())
            .filter(coverage_plan::Column::UserId.eq(user_id))
            .one(&self.conn())
            .await?
            .map(|row| CoveragePlanSchedule {
                outer_axis: row.outer_axis,
                paused: row.paused,
                auto_top_up: row.auto_top_up,
                buffer_target: row.buffer_target.map(buffer_target_from_column),
            }))
    }

    /// Replace a plan's [schedule](CoveragePlanSchedule), scoped to the owning
    /// account. Returns whether a row matched.
    ///
    /// The counterpart to [`Self::update_coverage_plan`]'s declaration-only write: the
    /// pause toggle, the outer-axis picker and the buffer override all land here
    /// without re-sending (or racing) the plan's member lists. `topping_up_at` is not
    /// part of the schedule — it is a claim the store owns, not a setting — so
    /// changing the schedule never disturbs a top-up already in progress.
    pub async fn set_coverage_plan_schedule(
        &self,
        user_id: &str,
        id: &str,
        schedule: &CoveragePlanSchedule,
    ) -> Result<bool> {
        let res = coverage_plan::Entity::update_many()
            .col_expr(
                coverage_plan::Column::OuterAxis,
                Expr::value(schedule.outer_axis.clone()),
            )
            .col_expr(coverage_plan::Column::Paused, Expr::value(schedule.paused))
            .col_expr(
                coverage_plan::Column::AutoTopUp,
                Expr::value(schedule.auto_top_up),
            )
            .col_expr(
                coverage_plan::Column::BufferTarget,
                Expr::value(schedule.buffer_target.map(buffer_target_to_column)),
            )
            .filter(coverage_plan::Column::Id.eq(id))
            .filter(coverage_plan::Column::UserId.eq(user_id))
            .exec(&self.conn())
            .await?;
        Ok(res.rows_affected > 0)
    }

    /// Take the top-up claim on a coverage plan, returning whether this caller got it.
    ///
    /// Top-up is an endpoint the console calls rather than a background daemon, so two
    /// tabs — or one fast double review-submit — otherwise both observe the same
    /// shortfall and both enqueue for it, filling the buffer twice over. A caller must
    /// hold this claim across the whole read-decide-enqueue sequence and
    /// [release](Self::release_coverage_plan_top_up) it afterwards, whatever the
    /// outcome.
    ///
    /// The claim is a compare-and-swap on `topping_up_at`: the update matches only
    /// while the column still holds the value this call read, so a racing caller that
    /// read the same value finds zero rows affected and backs off. PostgreSQL
    /// re-evaluates the predicate after the row lock it blocked on is released, and
    /// SQLite serializes writers outright, so neither backend can let both win.
    ///
    /// A claim older than `TOP_UP_LEASE` is treated as abandoned and taken over —
    /// which is the whole reason the marker is a timestamp rather than a flag. The
    /// staleness comparison is made on **parsed instants**, never on the stored
    /// strings: an RFC 3339 subsecond part is variable-length, so lexicographic order
    /// is not reliably chronological order.
    pub async fn claim_coverage_plan_top_up(
        &self,
        user_id: &str,
        id: &str,
        now: &str,
    ) -> Result<bool> {
        let txn = self.conn().begin().await?;
        let Some(plan) = coverage_plan::Entity::find_by_id(id.to_string())
            .filter(coverage_plan::Column::UserId.eq(user_id))
            .one(&txn)
            .await?
        else {
            txn.commit().await?;
            return Ok(false);
        };
        if !top_up_claim_is_available(plan.topping_up_at.as_deref(), now) {
            txn.commit().await?;
            return Ok(false);
        }
        let mut update = coverage_plan::Entity::update_many()
            .col_expr(coverage_plan::Column::ToppingUpAt, Expr::value(now))
            .filter(coverage_plan::Column::Id.eq(id));
        update = match plan.topping_up_at {
            Some(held) => update.filter(coverage_plan::Column::ToppingUpAt.eq(held)),
            None => update.filter(coverage_plan::Column::ToppingUpAt.is_null()),
        };
        let claimed = update.exec(&txn).await?.rows_affected > 0;
        txn.commit().await?;
        Ok(claimed)
    }

    /// Release the top-up claim on a coverage plan, whether or not this caller took
    /// it. Unconditional by design: the lease already bounds a claim nobody releases,
    /// and a release that could fail would just be another way to wedge the plan.
    pub async fn release_coverage_plan_top_up(&self, id: &str) -> Result<()> {
        coverage_plan::Entity::update_many()
            .col_expr(
                coverage_plan::Column::ToppingUpAt,
                Expr::value(None::<String>),
            )
            .filter(coverage_plan::Column::Id.eq(id))
            .exec(&self.conn())
            .await?;
        Ok(())
    }

    /// An account's chosen default buffer target, or `None` when they have never set
    /// one.
    ///
    /// `None` is deliberately not a bound of `0`: an account with no row has expressed
    /// no opinion, and the caller applies the backend's compiled-in default rather
    /// than the store materializing a row on read. An explicit `0` — "never top me up
    /// automatically" — and an explicit "no bound" are both different, storable
    /// instructions.
    pub async fn coverage_buffer_target(&self, user_id: &str) -> Result<Option<BufferTarget>> {
        Ok(coverage_settings::Entity::find_by_id(user_id.to_string())
            .one(&self.conn())
            .await?
            .map(|row| buffer_target_from_column(row.buffer_target)))
    }

    /// Set an account's default buffer target, creating its settings row on first use.
    pub async fn set_coverage_buffer_target(
        &self,
        user_id: &str,
        buffer_target: BufferTarget,
        now: &str,
    ) -> Result<()> {
        coverage_settings::Entity::insert(coverage_settings::ActiveModel {
            user_id: Set(user_id.to_string()),
            buffer_target: Set(buffer_target_to_column(buffer_target)),
            updated_at: Set(now.to_string()),
        })
        .on_conflict(
            OnConflict::column(coverage_settings::Column::UserId)
                .update_columns([
                    coverage_settings::Column::BufferTarget,
                    coverage_settings::Column::UpdatedAt,
                ])
                .to_owned(),
        )
        .exec(&self.conn())
        .await?;
        Ok(())
    }

    /// Every saved gg query the account owns, ordered by display name.
    ///
    /// The gg *corpus* is deployment-wide; a saved **view** over it is personal, which
    /// is why this — and nothing on the query path — filters by account.
    pub async fn list_gg_saved_queries(
        &self,
        user_id: &str,
    ) -> Result<Vec<crate::api::GgSavedQuery>> {
        Ok(gg_saved_query::Entity::find()
            .filter(gg_saved_query::Column::UserId.eq(user_id))
            .order_by_asc(gg_saved_query::Column::Name)
            .all(&self.conn())
            .await?
            .into_iter()
            .map(gg_saved_query_from_row)
            .collect())
    }

    /// One saved gg query by id, scoped to the owning account (`None` when the id is
    /// unknown or belongs to someone else).
    pub async fn get_gg_saved_query(
        &self,
        user_id: &str,
        id: &str,
    ) -> Result<Option<crate::api::GgSavedQuery>> {
        let Some(row) = gg_saved_query::Entity::find_by_id(id.to_string())
            .one(&self.conn())
            .await?
        else {
            return Ok(None);
        };
        if row.user_id != user_id {
            return Ok(None);
        }
        Ok(Some(gg_saved_query_from_row(row)))
    }

    /// Insert a new saved gg query (id already minted by the handler).
    pub async fn insert_gg_saved_query(
        &self,
        user_id: &str,
        saved: &crate::api::GgSavedQuery,
    ) -> Result<()> {
        gg_saved_query::ActiveModel {
            id: Set(saved.id.clone()),
            user_id: Set(user_id.to_string()),
            name: Set(saved.name.clone()),
            description: Set(saved.description.clone()),
            query_text: Set(saved.query.clone()),
            range_id: Set(saved.range_id.clone()),
            updated_at: Set(saved.updated_at.clone()),
        }
        .insert(&self.conn())
        .await?;
        Ok(())
    }

    /// Update a saved gg query in place, scoped to the owning account. Returns whether
    /// a row matched.
    pub async fn update_gg_saved_query(
        &self,
        user_id: &str,
        saved: &crate::api::GgSavedQuery,
    ) -> Result<bool> {
        let res = gg_saved_query::Entity::update_many()
            .col_expr(
                gg_saved_query::Column::Name,
                Expr::value(saved.name.clone()),
            )
            .col_expr(
                gg_saved_query::Column::Description,
                Expr::value(saved.description.clone()),
            )
            .col_expr(
                gg_saved_query::Column::QueryText,
                Expr::value(saved.query.clone()),
            )
            .col_expr(
                gg_saved_query::Column::RangeId,
                Expr::value(saved.range_id.clone()),
            )
            .col_expr(
                gg_saved_query::Column::UpdatedAt,
                Expr::value(saved.updated_at.clone()),
            )
            .filter(gg_saved_query::Column::Id.eq(saved.id.clone()))
            .filter(gg_saved_query::Column::UserId.eq(user_id))
            .exec(&self.conn())
            .await?;
        Ok(res.rows_affected > 0)
    }

    /// Delete a saved gg query, scoped to the owning account. Returns whether a row
    /// was removed. Dashboards built from it are unaffected — a panel carries its own
    /// copy of the text.
    pub async fn delete_gg_saved_query(&self, user_id: &str, id: &str) -> Result<bool> {
        let res = gg_saved_query::Entity::delete_many()
            .filter(gg_saved_query::Column::Id.eq(id))
            .filter(gg_saved_query::Column::UserId.eq(user_id))
            .exec(&self.conn())
            .await?;
        Ok(res.rows_affected > 0)
    }

    /// Every gg dashboard the account owns, ordered by display name.
    pub async fn list_gg_dashboards(&self, user_id: &str) -> Result<Vec<crate::api::GgDashboard>> {
        gg_dashboard::Entity::find()
            .filter(gg_dashboard::Column::UserId.eq(user_id))
            .order_by_asc(gg_dashboard::Column::Name)
            .all(&self.conn())
            .await?
            .into_iter()
            .map(gg_dashboard_from_row)
            .collect()
    }

    /// One gg dashboard by id, scoped to the owning account (`None` when the id is
    /// unknown or belongs to someone else).
    pub async fn get_gg_dashboard(
        &self,
        user_id: &str,
        id: &str,
    ) -> Result<Option<crate::api::GgDashboard>> {
        let Some(row) = gg_dashboard::Entity::find_by_id(id.to_string())
            .one(&self.conn())
            .await?
        else {
            return Ok(None);
        };
        if row.user_id != user_id {
            return Ok(None);
        }
        Ok(Some(gg_dashboard_from_row(row)?))
    }

    /// Insert a new gg dashboard (id already minted by the handler).
    pub async fn insert_gg_dashboard(
        &self,
        user_id: &str,
        board: &crate::api::GgDashboard,
    ) -> Result<()> {
        gg_dashboard::ActiveModel {
            id: Set(board.id.clone()),
            user_id: Set(user_id.to_string()),
            name: Set(board.name.clone()),
            description: Set(board.description.clone()),
            panels_json: Set(serde_json::to_string(&board.panels)?),
            range_id: Set(board.range_id.clone()),
            updated_at: Set(board.updated_at.clone()),
        }
        .insert(&self.conn())
        .await?;
        Ok(())
    }

    /// Update a gg dashboard in place, scoped to the owning account. Returns whether a
    /// row matched.
    pub async fn update_gg_dashboard(
        &self,
        user_id: &str,
        board: &crate::api::GgDashboard,
    ) -> Result<bool> {
        let res = gg_dashboard::Entity::update_many()
            .col_expr(gg_dashboard::Column::Name, Expr::value(board.name.clone()))
            .col_expr(
                gg_dashboard::Column::Description,
                Expr::value(board.description.clone()),
            )
            .col_expr(
                gg_dashboard::Column::PanelsJson,
                Expr::value(serde_json::to_string(&board.panels)?),
            )
            .col_expr(
                gg_dashboard::Column::RangeId,
                Expr::value(board.range_id.clone()),
            )
            .col_expr(
                gg_dashboard::Column::UpdatedAt,
                Expr::value(board.updated_at.clone()),
            )
            .filter(gg_dashboard::Column::Id.eq(board.id.clone()))
            .filter(gg_dashboard::Column::UserId.eq(user_id))
            .exec(&self.conn())
            .await?;
        Ok(res.rows_affected > 0)
    }

    /// Delete a gg dashboard, scoped to the owning account. Returns whether a row was
    /// removed.
    pub async fn delete_gg_dashboard(&self, user_id: &str, id: &str) -> Result<bool> {
        let res = gg_dashboard::Entity::delete_many()
            .filter(gg_dashboard::Column::Id.eq(id))
            .filter(gg_dashboard::Column::UserId.eq(user_id))
            .exec(&self.conn())
            .await?;
        Ok(res.rows_affected > 0)
    }

    /// Every comparison the account owns, most-recently-updated first.
    pub async fn list_comparisons(&self, user_id: &str) -> Result<Vec<StoredComparison>> {
        comparison::Entity::find()
            .filter(comparison::Column::UserId.eq(user_id))
            .order_by_desc(comparison::Column::UpdatedAt)
            .all(&self.conn())
            .await?
            .into_iter()
            .map(comparison_from_row)
            .collect()
    }

    /// Every **published** comparison across all accounts, newest-published first —
    /// the set the snapshot builder folds into the public site. Ownership is not a
    /// filter here (unlike the per-account list): the public snapshot is global.
    pub async fn all_published_comparisons(&self) -> Result<Vec<StoredComparison>> {
        comparison::Entity::find()
            .filter(comparison::Column::Published.eq(true))
            .order_by_desc(comparison::Column::PublishedAt)
            .all(&self.conn())
            .await?
            .into_iter()
            .map(comparison_from_row)
            .collect()
    }

    /// One comparison by id, scoped to the owning account (`None` when the id is
    /// unknown or belongs to someone else).
    pub async fn get_comparison(
        &self,
        user_id: &str,
        id: &str,
    ) -> Result<Option<StoredComparison>> {
        let Some(row) = comparison::Entity::find_by_id(id.to_string())
            .one(&self.conn())
            .await?
        else {
            return Ok(None);
        };
        if row.user_id != user_id {
            return Ok(None);
        }
        Ok(Some(comparison_from_row(row)?))
    }

    /// Insert a new comparison (id already minted by the handler).
    pub async fn insert_comparison(&self, user_id: &str, stored: &StoredComparison) -> Result<()> {
        comparison::ActiveModel {
            id: Set(stored.id.clone()),
            user_id: Set(user_id.to_string()),
            name: Set(stored.name.clone()),
            description: Set(stored.description.clone()),
            config_json: Set(serde_json::to_string(&stored.config)?),
            published: Set(stored.published),
            published_at: Set(stored.published_at.clone()),
            created_at: Set(stored.created_at.clone()),
            updated_at: Set(stored.updated_at.clone()),
        }
        .insert(&self.conn())
        .await?;
        Ok(())
    }

    /// Update a comparison's name, description, and config in place, scoped to the
    /// owning account. Leaves `created_at` and the published state untouched.
    /// Returns whether a row matched.
    pub async fn update_comparison(
        &self,
        user_id: &str,
        stored: &StoredComparison,
    ) -> Result<bool> {
        let res = comparison::Entity::update_many()
            .col_expr(comparison::Column::Name, Expr::value(stored.name.clone()))
            .col_expr(
                comparison::Column::Description,
                Expr::value(stored.description.clone()),
            )
            .col_expr(
                comparison::Column::ConfigJson,
                Expr::value(serde_json::to_string(&stored.config)?),
            )
            .col_expr(
                comparison::Column::UpdatedAt,
                Expr::value(stored.updated_at.clone()),
            )
            .filter(comparison::Column::Id.eq(stored.id.clone()))
            .filter(comparison::Column::UserId.eq(user_id))
            .exec(&self.conn())
            .await?;
        Ok(res.rows_affected > 0)
    }

    /// Delete a comparison, scoped to the owning account. Returns whether a row was
    /// removed. Runs launched for its arms are unaffected.
    pub async fn delete_comparison(&self, user_id: &str, id: &str) -> Result<bool> {
        let res = comparison::Entity::delete_many()
            .filter(comparison::Column::Id.eq(id))
            .filter(comparison::Column::UserId.eq(user_id))
            .exec(&self.conn())
            .await?;
        Ok(res.rows_affected > 0)
    }

    /// Set a comparison's published flag (and first-publish timestamp), scoped to
    /// the owning account. The single lever for snapshot inclusion (Layer 4).
    /// Returns whether a row matched.
    pub async fn set_comparison_published(
        &self,
        user_id: &str,
        id: &str,
        published: bool,
        published_at: Option<&str>,
    ) -> Result<bool> {
        let res = comparison::Entity::update_many()
            .col_expr(comparison::Column::Published, Expr::value(published))
            .col_expr(
                comparison::Column::PublishedAt,
                Expr::value(published_at.map(str::to_string)),
            )
            .filter(comparison::Column::Id.eq(id))
            .filter(comparison::Column::UserId.eq(user_id))
            .exec(&self.conn())
            .await?;
        Ok(res.rows_affected > 0)
    }

    /// The legacy single-per-account plans that the startup backfill has not yet
    /// copied into `coverage_plan` (`migrated = false`). Each is returned with its
    /// parsed combinations and cases so the backfill can inline them as one-off
    /// members of the migrated plan.
    pub async fn unmigrated_review_plans(&self) -> Result<Vec<LegacyReviewPlan>> {
        review_plan::Entity::find()
            .filter(review_plan::Column::Migrated.eq(false))
            .all(&self.conn())
            .await?
            .into_iter()
            .map(|row| {
                Ok(LegacyReviewPlan {
                    user_id: row.user_id,
                    runs_per_cell: row.runs_per_cell.max(0) as u32,
                    combos: serde_json::from_str(&row.combinations_json)?,
                    cases: serde_json::from_str(&row.cases_json)?,
                })
            })
            .collect()
    }

    /// Mark a legacy plan as migrated so the backfill copies it exactly once.
    pub async fn mark_review_plan_migrated(&self, user_id: &str) -> Result<()> {
        review_plan::Entity::update_many()
            .col_expr(review_plan::Column::Migrated, Expr::value(true))
            .filter(review_plan::Column::UserId.eq(user_id))
            .exec(&self.conn())
            .await?;
        Ok(())
    }

    /// Count the **completed** runs for every coverage cell whose case slug is in
    /// `slugs`, in a single grouped query. The result is keyed by the cell's
    /// [`CellKey`] identity; a cell with no completed runs is simply absent. Only
    /// evaluable `completed` runs count toward a cell's target; the failure tiers do
    /// not.
    ///
    /// This computes the whole coverage matrix's completed counts at once, so the
    /// `coverage` handler does not fan out into a per-cell `COUNT(*)` — two queries
    /// per cell, thousands of serial round-trips for a large plan.
    pub async fn count_completed_runs_by_cell(&self, slugs: &[String]) -> Result<CellCounts> {
        if slugs.is_empty() {
            return Ok(CellCounts::new());
        }
        let rows: Vec<CellCountRow> = run::Entity::find()
            .select_only()
            .column(run::Column::TestCaseSlug)
            .column(run::Column::TestCaseVersion)
            .column(run::Column::Variant)
            .column(run::Column::EngineSlug)
            .column(run::Column::HarnessSlug)
            .column(run::Column::ModelId)
            .column(run::Column::GgConfigId)
            .column(run::Column::GgModels)
            .column_as(run::Column::Id.count(), "cnt")
            .filter(run::Column::RunState.eq("completed"))
            .filter(run::Column::TestCaseSlug.is_in(slugs.iter().map(String::as_str)))
            .group_by(run::Column::TestCaseSlug)
            .group_by(run::Column::TestCaseVersion)
            .group_by(run::Column::Variant)
            .group_by(run::Column::EngineSlug)
            .group_by(run::Column::HarnessSlug)
            .group_by(run::Column::ModelId)
            .group_by(run::Column::GgConfigId)
            .group_by(run::Column::GgModels)
            .into_tuple()
            .all(&self.conn())
            .await?;
        Ok(cell_counts(rows))
    }

    /// Count the **in-flight** jobs — queued, pending, dispatched, starting, or
    /// running — for every coverage cell whose case slug is in `slugs`, in a single
    /// grouped query (the companion to [`Self::count_completed_runs_by_cell`], keyed
    /// the same way). In-flight jobs count toward a cell's target alongside completed
    /// runs, so triggering the missing runs immediately marks the cell satisfied and
    /// the reviewer does not double-trigger while runs are still executing (or
    /// waiting to).
    pub async fn count_in_flight_jobs_by_cell(&self, slugs: &[String]) -> Result<CellCounts> {
        if slugs.is_empty() {
            return Ok(CellCounts::new());
        }
        let rows: Vec<CellCountRow> = job::Entity::find()
            .select_only()
            .column(job::Column::TestCaseSlug)
            .column(job::Column::TestCaseVersion)
            .column(job::Column::Variant)
            .column(job::Column::EngineSlug)
            .column(job::Column::HarnessSlug)
            .column(job::Column::ModelId)
            .column(job::Column::GgConfigId)
            .column(job::Column::GgModels)
            .column_as(job::Column::Id.count(), "cnt")
            .filter(job::Column::State.is_in(IN_FLIGHT_STATES))
            .filter(job::Column::TestCaseSlug.is_in(slugs.iter().map(String::as_str)))
            .group_by(job::Column::TestCaseSlug)
            .group_by(job::Column::TestCaseVersion)
            .group_by(job::Column::Variant)
            .group_by(job::Column::EngineSlug)
            .group_by(job::Column::HarnessSlug)
            .group_by(job::Column::ModelId)
            .group_by(job::Column::GgConfigId)
            .group_by(job::Column::GgModels)
            .into_tuple()
            .all(&self.conn())
            .await?;
        Ok(cell_counts(rows))
    }

    /// Count, per coverage cell, the completed runs **the given account has not
    /// reviewed** — keyed exactly like the other two grouped counts, absent for a cell
    /// with none.
    ///
    /// This is the second half of "outstanding" (the first being the in-flight jobs
    /// [`Self::count_in_flight_jobs_by_cell`] tallies), and the only per-account number
    /// in the coverage picture. Counts stay global — a run someone else produced still
    /// satisfies a cell's target and is never re-requested — but *judgement* does not:
    /// a finished run is only outstanding for the person who has not looked at it,
    /// which is precisely what stops a plan racing ahead of the reviewer feeding it.
    ///
    /// The automatically graded types are excluded on the same grounds
    /// [`Self::list_unreviewed`] excludes them: no reviewer can ever clear them, so
    /// counting them would permanently occupy buffer slots that never free.
    ///
    /// `exclude_unloaded` leaves out runs whose build never loaded. A ladder whose gate
    /// counts an unloaded build as broken decides those without a reviewer, so they
    /// must not hold a slot; a coverage plan has no gate and still wants a human to
    /// look, so it passes `false`.
    pub async fn count_unreviewed_runs_by_cell(
        &self,
        slugs: &[String],
        reviewer_user_id: &str,
        exclude_unloaded: bool,
    ) -> Result<CellCounts> {
        if slugs.is_empty() {
            return Ok(CellCounts::new());
        }
        let mut query = run::Entity::find()
            .select_only()
            .column(run::Column::TestCaseSlug)
            .column(run::Column::TestCaseVersion)
            .column(run::Column::Variant)
            .column(run::Column::EngineSlug)
            .column(run::Column::HarnessSlug)
            .column(run::Column::ModelId)
            .column(run::Column::GgConfigId)
            .column(run::Column::GgModels)
            .column_as(run::Column::Id.count(), "cnt")
            // Left-join *this account's* review and keep the rows that found none.
            // Narrowing on the join rather than in the `WHERE` is what makes it "no
            // review by this reviewer" instead of "no review by anyone": a run another
            // account has reviewed still has no row on this side of the join.
            .join(
                JoinType::LeftJoin,
                run::Relation::Review.def().on_condition({
                    let reviewer = reviewer_user_id.to_string();
                    move |_run, review| {
                        Expr::col((review, review::Column::ReviewerUserId))
                            .eq(reviewer.clone())
                            .into_condition()
                    }
                }),
            )
            .filter(review::Column::Id.is_null())
            .filter(run::Column::RunState.eq("completed"))
            .filter(run::Column::TestType.is_not_in(AUTO_GRADED_TEST_TYPES))
            .filter(run::Column::TestCaseSlug.is_in(slugs.iter().map(String::as_str)));
        if exclude_unloaded {
            query = query.filter(run::Column::Loaded.eq(true));
        }
        let rows: Vec<CellCountRow> = query
            .group_by(run::Column::TestCaseSlug)
            .group_by(run::Column::TestCaseVersion)
            .group_by(run::Column::Variant)
            .group_by(run::Column::EngineSlug)
            .group_by(run::Column::HarnessSlug)
            .group_by(run::Column::ModelId)
            .group_by(run::Column::GgConfigId)
            .group_by(run::Column::GgModels)
            .into_tuple()
            .all(&self.conn())
            .await?;
        Ok(cell_counts(rows))
    }

    /// The requesting account's own verdict on every completed run of one cell, oldest
    /// first — the evidence a ladder's rung gate is evaluated from.
    ///
    /// `cell` is the same [`CellKey`] the grouped counts are keyed by, so a caller
    /// builds it exactly as it builds the key it looks a count up with. The model
    /// segment is the id the run was **launched** with (a provider-routed harness
    /// carries an `openrouter/` prefix the plan's canonical model omits); matching on
    /// anything else silently reads zero. The two gg segments are matched through the
    /// same `COALESCE` the counts collapse with (`cell_gg_segment`), so a harness
    /// cell's empty pair selects exactly the rows that carry no configuration — a gate
    /// therefore reads the evidence of the one configuration its climber names, not of
    /// every gg run of the case. The engine segment is matched through the same
    /// collapse (`cell_engine_segment`), so a `none` cell reads the runs recorded before
    /// the slug was lifted as the engineless runs they are.
    ///
    /// Only `completed` runs are returned. A failed or canceled job is an
    /// infrastructure problem that retries (`job.attempt`) and must never be mistaken
    /// for a wall, so it has no place in a gate's evidence.
    ///
    /// The rating is derived from that one account's review, never from `run.rating` —
    /// see [`CellRunRating::rating`].
    pub async fn cell_run_ratings(
        &self,
        cell: &CellKey,
        reviewer_user_id: &str,
    ) -> Result<Vec<CellRunRating>> {
        let (slug, version, variant, engine, harness, model, gg_config_id, gg_models) = cell;
        let rows: Vec<(String, bool, Option<String>)> = run::Entity::find()
            .select_only()
            .column(run::Column::Id)
            .column(run::Column::Loaded)
            .column(review::Column::Ratings)
            // The same narrowed left join the unreviewed count uses: this account's
            // review if it wrote one, and nothing at all if it did not — never another
            // reviewer's row.
            .join(
                JoinType::LeftJoin,
                run::Relation::Review.def().on_condition({
                    let reviewer = reviewer_user_id.to_string();
                    move |_run, review| {
                        Expr::col((review, review::Column::ReviewerUserId))
                            .eq(reviewer.clone())
                            .into_condition()
                    }
                }),
            )
            .filter(run::Column::RunState.eq("completed"))
            .filter(run::Column::TestCaseSlug.eq(slug))
            .filter(run::Column::TestCaseVersion.eq(version))
            .filter(run::Column::Variant.eq(variant))
            .filter(Expr::expr(cell_engine_segment(run::Column::EngineSlug)).eq(engine.as_str()))
            .filter(run::Column::HarnessSlug.eq(harness))
            .filter(run::Column::ModelId.eq(model))
            .filter(
                Expr::expr(cell_gg_segment(run::Column::GgConfigId)).eq(gg_config_id.as_str()),
            )
            .filter(Expr::expr(cell_gg_segment(run::Column::GgModels)).eq(gg_models.as_str()))
            .order_by_asc(run::Column::FinishedAt)
            .order_by_asc(run::Column::Id)
            .into_tuple()
            .all(&self.conn())
            .await?;

        Ok(rows
            .into_iter()
            .map(|(run_id, loaded, ratings)| {
                // A review whose stored ratings no longer parse, and one that rated no
                // domain at all (a game jam is graded on categories, not domains),
                // both read as "no rating" — which the gate treats as unjudged rather
                // than as a bad result. Guessing either way would decide a climb on
                // something nobody wrote down.
                let ratings: Vec<DomainRating> = ratings
                    .and_then(|json| serde_json::from_str(&json).ok())
                    .unwrap_or_default();
                CellRunRating {
                    run_id,
                    loaded,
                    rating: test_cabinet_core::review::aggregate_rating([ratings.as_slice()]),
                }
            })
            .collect())
    }
}

/// How a coverage plan is **fed**, as opposed to what it declares: the order it emits
/// its cells in, whether it is suspended, whether a submitted review tops it up, and
/// its override of the account's buffer target.
///
/// Held apart from the plan's declaration ([`crate::api::CoveragePlan`]) because the
/// two are edited independently — the members and the runs-per-cell target are the
/// plan's *definition*, while these are the controls a reviewer reaches for while it
/// is running — and so that saving an edit to one can never silently overwrite the
/// other. See [`Db::set_coverage_plan_schedule`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoveragePlanSchedule {
    /// Which axis the cell loop nests on: `"case"` (finish one case across every
    /// combination) or `"combination"` (finish one combination across every case).
    ///
    /// The transport owns this vocabulary and validates it; the store round-trips
    /// whatever it was handed, exactly as it does for a coverage group's `kind`.
    pub outer_axis: String,
    /// Whether topping up is suspended. The mildest halting control: it stops new runs
    /// being emitted and leaves everything already queued alone.
    pub paused: bool,
    /// Whether submitting a review re-runs this plan's top-up automatically.
    pub auto_top_up: bool,
    /// This plan's override of the account's buffer target, or `None` to inherit
    /// [`Db::coverage_buffer_target`]. `None`, a bound of `0`, and
    /// [`BufferTarget::Unbounded`] are three different instructions — "no opinion",
    /// "never top up", and "top up everything".
    pub buffer_target: Option<BufferTarget>,
}

impl Default for CoveragePlanSchedule {
    /// The behaviour a plan had before it could be scheduled at all: cases outer, not
    /// paused, never topping itself up, and no opinion on the buffer target. These
    /// match the columns' database defaults, so a plan created with this schedule and
    /// one created before the columns existed are indistinguishable.
    fn default() -> Self {
        Self {
            outer_axis: "case".to_string(),
            paused: false,
            auto_top_up: false,
            buffer_target: None,
        }
    }
}

/// One completed run of a coverage cell, reduced to what a ladder's rung gate reads.
#[derive(Debug, Clone, PartialEq)]
pub struct CellRunRating {
    /// The run's id, so a ladder dashboard can link to the evidence a verdict was
    /// decided from.
    pub run_id: String,
    /// Whether the produced build loaded (the lifted `run.loaded`). A gate may count a
    /// run that never loaded as broken without waiting for a review — there is nothing
    /// to play, so waiting only stalls the climb.
    pub loaded: bool,
    /// The requesting account's overall rating for the run: the worst domain within
    /// *that one account's* review, or `None` when they have not reviewed it (which is
    /// not the same as a bad rating).
    ///
    /// Emphatically **not** the lifted `run.rating`, which is the worst domain across
    /// every reviewer. Gating on that would let a stranger's harsher review wall
    /// someone else's climb.
    pub rating: Option<Rating>,
}

impl CellRunRating {
    /// This run as [`gate`](crate::coverage::gate) sees it, so the two never drift
    /// apart in how they name the same two facts.
    pub fn as_rung_run(&self) -> RungRun {
        RungRun {
            rating: self.rating,
            loaded: self.loaded,
        }
    }
}

/// Whether a top-up claim marked at `held` may be taken now: it is free (`None`) or
/// its [lease](TOP_UP_LEASE) has expired.
///
/// A marker that cannot be parsed is treated as **expired**. It can only have got
/// there by hand or from a future format, and refusing to take an uninterpretable
/// claim would wedge the plan permanently — the far worse of the two failures, since
/// the only cost of taking it wrongly is one duplicated top-up.
fn top_up_claim_is_available(held: Option<&str>, now: &str) -> bool {
    let Some(held) = held else {
        return true;
    };
    use time::format_description::well_known::Rfc3339;
    let (Ok(held), Ok(now)) = (
        time::OffsetDateTime::parse(held, &Rfc3339),
        time::OffsetDateTime::parse(now, &Rfc3339),
    ) else {
        return true;
    };
    now - held > TOP_UP_LEASE
}

/// A coverage cell's identity:
/// `(slug, version, variant, engine, harness, launch model, gg configuration id, gg models)`
/// — the key every grouped-count query returns its tallies under, and the identity a gate
/// reads its evidence by.
///
/// The first four segments are the **case pin**, engine included, because a result is only
/// comparable with another result on the same engine: one case at one version and variant
/// on two engines is two cells. A run or job that names no engine is a `none` run, so a
/// `NULL` column coalesces to that slug (`cell_engine_segment`) rather than to an empty
/// segment of its own.
///
/// The first six segments identify a **harness** cell, and its last two are empty. A
/// gg run has no such identity to be counted by: it is launched from a saved
/// configuration and binds a model per agent, so every gg run of one plan would
/// otherwise pile into a single `gg/<root model>` cell. The two extra segments are what
/// separate them:
///
/// - the configuration's **id**, because that is what a configuration *is* across time:
///   its name is display text an operator rewrites freely and nothing keeps unique within
///   an account, so a cell keyed on the name would empty itself on a rename — the plan
///   reading 0/N and the next top-up re-buying every run behind it — and would merge two
///   configurations that happen to agree on one. A ladder's climber is keyed on the same
///   id ([`combination_key`]), so a rung's recorded verdicts and the runs counted under
///   them describe one configuration rather than two halves that disagree;
/// - the **models the bound set runs on**, because one configuration can run several.
///   Two members that agree on the root agent's model and differ on a reviewer's are two
///   arms of a study, and a cell reading only the root model would merge them.
///
/// A configuration is account-scoped, which costs the cell nothing: no other account's run
/// could satisfy a cell by being "the same configuration" in the first place, so keying on
/// the id narrows nothing that keying on the name kept. Counts stay
/// [global](https://docs.testcabinet.ai/components/backend/coverage/) in the sense that
/// matters — whoever launched a run of *this* configuration, it counts.
pub type CellKey = (
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
);

/// Per-cell counts from a grouped coverage query, keyed by [`CellKey`].
pub type CellCounts = HashMap<CellKey, u32>;

/// Fold the
/// `(slug, version, variant, engine, harness, model, gg configuration id, gg models, count)`
/// rows a grouped coverage query returns into a [`CellCounts`] map, reading the nullable
/// engine column as `none` and the two nullable gg columns as the empty string a harness
/// cell carries.
///
/// Tallies are **summed** into the entry rather than assigned to it, because neither
/// collapse is injective: SQL groups `NULL` and the concrete value as different rows and
/// both arrive here as the same segment, so a store holding one of each would otherwise
/// report only whichever came last. The count is a SQL `COUNT(*)` so it is
/// non-negative; the clamp is defensive.
fn cell_counts(rows: Vec<CellCountRow>) -> CellCounts {
    let mut counts = CellCounts::new();
    for (slug, version, variant, engine, harness, model, gg_config_id, gg_models, count) in rows {
        *counts
            .entry((
                slug,
                version,
                variant,
                cell_engine(engine),
                harness,
                model,
                gg_config_id.unwrap_or_default(),
                gg_models.unwrap_or_default(),
            ))
            .or_insert(0) += count.max(0) as u32;
    }
    counts
}

/// One row of a grouped coverage count: a [`CellKey`]'s eight segments (the engine one and
/// the two gg ones still nullable, as the columns are) followed by the tally. Named because
/// all three grouped queries select it and the tuple is otherwise spelled out four times.
type CellCountRow = (
    String,
    String,
    String,
    Option<String>,
    String,
    String,
    Option<String>,
    Option<String>,
    i64,
);

/// A nullable engine column as its [`CellKey`] segment: an absent engine is the `none`
/// engine, because a launch that omits the key asks for the engineless run.
fn cell_engine(engine: Option<String>) -> String {
    engine.unwrap_or_else(|| test_cabinet_core::engine::NONE_SLUG.to_string())
}

/// One of the nullable gg identity columns as its [`CellKey`] segment:
/// `COALESCE(col, '')`. Filtering through it makes an equality test on a cell segment
/// agree with the grouped counts, which collapse the same `NULL` to the same empty
/// string — a filter written against the bare column would instead match nothing for
/// every harness cell in the store.
fn cell_gg_segment(column: run::Column) -> SimpleExpr {
    Func::coalesce([column.into_expr().into(), Expr::val("").into()]).into()
}

/// The nullable engine column as its [`CellKey`] segment: `COALESCE(col, 'none')`. The
/// SQL twin of [`cell_engine`], and load-bearing for the same reason
/// [`cell_gg_segment`] is — an equality test written against the bare column would match
/// nothing for every run recorded before the slug was lifted, and those are `none` runs.
fn cell_engine_segment(column: run::Column) -> SimpleExpr {
    Func::coalesce([
        column.into_expr().into(),
        Expr::val(test_cabinet_core::engine::NONE_SLUG).into(),
    ])
    .into()
}

/// A legacy single-per-account coverage plan awaiting backfill into `coverage_plan`
/// (its combinations and cases already parsed), returned by
/// [`Db::unmigrated_review_plans`].
#[derive(Debug, Clone)]
pub struct LegacyReviewPlan {
    /// The owning account's id.
    pub user_id: String,
    /// The legacy plan's runs-per-cell target.
    pub runs_per_cell: u32,
    /// The legacy plan's harness+model combinations.
    pub combos: Vec<crate::api::ReviewPlanCombo>,
    /// The legacy plan's version-pinned cases.
    pub cases: Vec<crate::api::ReviewPlanCase>,
}

/// Convert a stored coverage-group row into its contract shape, decoding the
/// `members_json` into the array its `kind` selects. An unrecognized `kind` (a
/// corrupt row) surfaces as an error rather than being silently dropped.
fn coverage_group_from_row(row: coverage_group::Model) -> Result<crate::api::CoverageGroup> {
    use crate::api::CoverageGroupKind;
    let (kind, combos, cases) = match row.kind.as_str() {
        "combo" => (
            CoverageGroupKind::Combo,
            serde_json::from_str(&row.members_json)?,
            Vec::new(),
        ),
        "case" => (
            CoverageGroupKind::Case,
            Vec::new(),
            serde_json::from_str(&row.members_json)?,
        ),
        other => {
            return Err(BackendError::Internal(format!(
                "unknown coverage group kind: {other}"
            )));
        }
    };
    Ok(crate::api::CoverageGroup {
        id: row.id,
        name: row.name,
        kind,
        combos,
        cases,
        updated_at: row.updated_at,
    })
}

/// Serialize a coverage group's members (the array its `kind` selects) for the
/// `members_json` column.
fn coverage_group_members_json(group: &crate::api::CoverageGroup) -> Result<String> {
    use crate::api::CoverageGroupKind;
    Ok(match group.kind {
        CoverageGroupKind::Combo => serde_json::to_string(&group.combos)?,
        CoverageGroupKind::Case => serde_json::to_string(&group.cases)?,
    })
}

/// Convert a stored coverage-plan row into its contract shape, decoding its JSON
/// group-reference and one-off member arrays.
fn coverage_plan_from_row(row: coverage_plan::Model) -> Result<crate::api::CoveragePlan> {
    Ok(crate::api::CoveragePlan {
        id: row.id,
        name: row.name,
        runs_per_cell: row.runs_per_cell.max(0) as u32,
        combo_group_ids: serde_json::from_str(&row.combo_group_ids_json)?,
        case_group_ids: serde_json::from_str(&row.case_group_ids_json)?,
        combos: serde_json::from_str(&row.combos_json)?,
        cases: serde_json::from_str(&row.cases_json)?,
        updated_at: row.updated_at,
    })
}

/// Rebuild a saved gg configuration from its stored row, parsing the capability
/// set held as JSON text.
fn gg_config_from_row(row: gg_config::Model) -> Result<crate::api::GgConfig> {
    Ok(crate::api::GgConfig {
        id: row.id,
        name: row.name,
        description: row.description,
        capability_set: serde_json::from_str(&row.capability_set_json)?,
        // A configuration whose agents are all declared inline stores no sources at
        // all, which is the same statement as an empty list.
        agent_sources: match &row.agent_sources_json {
            Some(json) => serde_json::from_str(json)?,
            None => Vec::new(),
        },
        updated_at: row.updated_at,
    })
}

/// One saved gg agent as the API carries it. Fallible: the profile column is parsed.
fn gg_agent_from_row(row: gg_agent::Model) -> Result<crate::api::GgSavedAgent> {
    Ok(crate::api::GgSavedAgent {
        id: row.id,
        name: row.name,
        description: row.description,
        agent: serde_json::from_str(&row.agent_json)?,
        updated_at: row.updated_at,
    })
}

/// Rebuild a saved gg query from its stored row. Infallible: every column is a
/// string, and the query is stored as *source text* rather than a compiled tree
/// precisely so nothing on the read path has to parse it.
fn gg_saved_query_from_row(row: gg_saved_query::Model) -> crate::api::GgSavedQuery {
    crate::api::GgSavedQuery {
        id: row.id,
        name: row.name,
        description: row.description,
        query: row.query_text,
        range_id: row.range_id,
        updated_at: row.updated_at,
    }
}

/// Rebuild a gg dashboard from its stored row, parsing the panel list held as JSON
/// text.
fn gg_dashboard_from_row(row: gg_dashboard::Model) -> Result<crate::api::GgDashboard> {
    Ok(crate::api::GgDashboard {
        id: row.id,
        name: row.name,
        description: row.description,
        panels: serde_json::from_str(&row.panels_json)?,
        range_id: row.range_id,
        updated_at: row.updated_at,
    })
}

/// A saved [comparison](test_cabinet_core::comparison) as stored: the row fields
/// with `config_json` parsed back into its [`ComparisonConfig`]. The per-arm
/// statistics are **not** stored — they are computed on read by the comparisons API
/// from the arms' runs — so this is exactly the persisted configuration plus its
/// identity and publish state.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredComparison {
    /// The comparison's opaque id.
    pub id: String,
    /// The owning account's id.
    pub user_id: String,
    /// The operator-chosen display name.
    pub name: String,
    /// A one-line note on what is being compared. Empty when unset.
    pub description: String,
    /// The controls, varied dimension, and arms.
    pub config: ComparisonConfig,
    /// Whether the comparison is published to the public site.
    pub published: bool,
    /// RFC 3339 of when it was first published, or `None` while unpublished.
    pub published_at: Option<String>,
    /// RFC 3339 of when it was created.
    pub created_at: String,
    /// RFC 3339 of when it was last saved.
    pub updated_at: String,
}

fn comparison_from_row(row: comparison::Model) -> Result<StoredComparison> {
    Ok(StoredComparison {
        id: row.id,
        user_id: row.user_id,
        name: row.name,
        description: row.description,
        config: serde_json::from_str(&row.config_json)?,
        published: row.published,
        published_at: row.published_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

// ---- Ladders --------------------------------------------------------------

/// The canonical key a ladder identifies one **climber** by — the text its steering
/// rows and its recorded verdicts are stored against — in one of two forms, one per
/// shape a [combination](crate::api::ReviewPlanCombo) takes.
///
/// A harness climber is `harness|model|provider`, with an empty trailing segment when
/// the harness is not provider-routed. That encodes exactly the
/// `(harness, model, provider)` triple the coverage resolver de-dupes members on, so a
/// key built here and a member resolved there are the same combination by construction.
/// `|` separates because a model id routinely contains `/`
/// (`anthropic/claude-opus-4.8`) and a separator that can appear inside a segment is not
/// a separator.
///
/// A gg climber is `gg:<configuration id>|<slot>=<model>,…`, its bindings in slot order and
/// in their [canonical](crate::api::ReviewPlanCombo::gg_bindings) form, so a pasted model id
/// carrying surrounding space is the same climber as the same id typed by hand.
/// The configuration alone would not do: two climbers running one configuration on
/// different models are the two arms a ladder exists to separate, so the bindings are
/// part of the key. They are keyed **per slot** rather than as a bare model list,
/// because binding the same two models to swapped slots is a different arm again.
///
/// **The two forms cannot collide.** The harness form's first segment is a
/// [`HarnessSlug`], a closed set of lowercase kebab tokens, so no harness climber's key
/// can begin `gg:` — not even one whose harness *is* gg, which keys as `gg||`.
///
/// Nothing parses either form. The key is written, stored, and compared whole, which is
/// what lets it carry a slot map without a grammar to defend.
///
/// The **canonical** model is used in the harness form, not the launched one: this key
/// names a member of the ladder, not a row in the `run` table, and the two differ for
/// provider-routed harnesses (see [`Db::cell_run_ratings`], which does want the launched
/// id).
pub fn combination_key(combo: &crate::api::ReviewPlanCombo) -> String {
    let Some(config) = combo.gg_config_ref() else {
        return format!(
            "{}|{}|{}",
            combo.harness.as_str(),
            combo.model,
            combo.provider.as_deref().unwrap_or_default()
        );
    };
    let bindings = combo
        .gg_bindings()
        .iter()
        .map(|(slot, model)| format!("{slot}={model}"))
        .collect::<Vec<_>>()
        .join(",");
    format!("gg:{config}|{bindings}")
}

/// A reviewer's ladder as stored: an ordered climb through a series of test cases,
/// and the combinations that climb it.
///
/// This is the ladder's **declaration** — what it is, not how it is being fed; the
/// latter is [`LadderSchedule`], exactly as a coverage plan splits into
/// [`crate::api::CoveragePlan`] and [`CoveragePlanSchedule`].
///
/// Progress is deliberately absent. How far a combination has climbed is derived from
/// its [`StoredLadderOutcome`] rows, never from a pointer on the ladder, which is what
/// lets a model added to a standing ladder next month start at rung 1 while the models
/// already halfway up carry on. Per-combination steering lives in
/// [`StoredLadderClimber`].
///
/// Not `PartialEq`: its combinations are [`crate::api::ReviewPlanCombo`]s, which are
/// wire types and carry no equality. Compare the parts that matter instead — two
/// ladders being "equal" is not a question the store ever has to answer.
#[derive(Debug, Clone)]
pub struct StoredLadder {
    /// The ladder's opaque id (minted by the handler, as a plan's is).
    pub id: String,
    /// The reviewer-chosen display name.
    pub name: String,
    /// The default target number of runs for each `rung × combination` cell; a rung
    /// may raise it for itself via [`StoredLadderRung::runs_override`].
    pub runs_per_cell: u32,
    /// The single parameterised rule every rung is judged by. Stored per ladder rather
    /// than per rung because a ladder asks *one* question of an ordered series of
    /// cases; only how many runs it takes to answer varies by rung.
    pub gate: Gate,
    /// The referenced combination groups' ids — the same `coverage_group`
    /// (`kind = "combo"`) pointers a plan uses, so one saved set of models can drive
    /// both and editing it reshapes both.
    pub combo_group_ids: Vec<String>,
    /// One-off combinations pinned directly on the ladder, unioned with the groups.
    pub combos: Vec<crate::api::ReviewPlanCombo>,
    /// The rungs, low to high. The order **is** the climb: see
    /// [`StoredLadderRung`] for why position is not a field.
    pub rungs: Vec<StoredLadderRung>,
    /// RFC 3339 of when the ladder was last saved.
    pub updated_at: String,
}

/// One rung of a [`StoredLadder`]: exactly one test case, pinned to an exact version,
/// variant, and engine.
///
/// The rung's position is deliberately **not** a field — it is the rung's index in
/// [`StoredLadder::rungs`], written to the `position` column on save and used to order
/// the read. Carrying both would let the two disagree about the same climb.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredLadderRung {
    /// The rung's stable opaque id, minted when the rung is added and never reused.
    ///
    /// It survives both a reorder and a version bump, and every recorded outcome
    /// references it, which is the point: a positional identifier would silently
    /// reattribute a combination's verdicts to a different case the moment the ladder
    /// was reordered.
    pub id: String,
    /// The test-case slug.
    pub slug: String,
    /// The pinned, exact version. A gate outcome records the version it was decided
    /// against, so bumping this neither erases the old verdict nor inherits it.
    pub version: String,
    /// The variant to climb.
    pub variant: String,
    /// The engine to climb on, or `None` for the `none` engine — the engineless run
    /// every case supports.
    ///
    /// Part of the rung's identity within the climb: the same case at the same version
    /// and variant on two engines is two rungs, because clearing a case with a runtime
    /// underneath is a different achievement from clearing it with nothing.
    pub engine: Option<String>,
    /// This rung's override of [`StoredLadder::runs_per_cell`], or `None` to inherit
    /// it — so one pivotal step can demand more evidence without making the whole
    /// climb more expensive.
    pub runs_override: Option<u32>,
}

/// How a ladder is **fed**: the order it emits its cells in, whether it is suspended,
/// whether a submitted review tops it up, and its override of the account's buffer
/// target. The ladder's counterpart to [`CoveragePlanSchedule`], split from the
/// declaration for the same reason.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LadderSchedule {
    /// Which axis the emission loop nests on: `"rung"` (finish a rung across every
    /// climber before anyone moves up) or `"combination"` (send one climber as far up
    /// as it gets before starting the next). The transport owns and validates this
    /// vocabulary; the store round-trips what it was handed.
    pub outer_axis: String,
    /// Whether topping up is suspended.
    pub paused: bool,
    /// Whether submitting a review re-runs this ladder's top-up automatically.
    pub auto_top_up: bool,
    /// This ladder's override of the account's buffer target, or `None` to inherit
    /// [`Db::coverage_buffer_target`]; the same three instructions as
    /// [`CoveragePlanSchedule::buffer_target`].
    pub buffer_target: Option<BufferTarget>,
}

impl Default for LadderSchedule {
    /// A new ladder climbs a rung at a time, is not paused, never tops itself up
    /// unasked, and has no opinion on the buffer target. These match the columns'
    /// database defaults.
    fn default() -> Self {
        Self {
            outer_axis: "rung".to_string(),
            paused: false,
            auto_top_up: false,
            buffer_target: None,
        }
    }
}

/// A reviewer's steering of one combination on one ladder: climb this one first,
/// watch it, stop it. Never progress — that lives in [`StoredLadderOutcome`], so there
/// is exactly one source of truth for how far a climber has got.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredLadderClimber {
    /// The steered combination's [`combination_key`].
    pub combination_key: String,
    /// Climb-order weight; higher goes first, `0` is the default. Pushes one model to
    /// the front without reordering the ladder, which would change what every *other*
    /// climber is measured against.
    pub priority: i32,
    /// The reviewer's "watch this one" flag, and the tiebreak between equal
    /// priorities.
    pub focused: bool,
    /// The manual downward override: stop this combination where it stands whatever
    /// its gates say. Clearing it resumes the climb from exactly where it was, because
    /// the automatic outcomes underneath were never touched.
    pub held: bool,
    /// RFC 3339 of when this steering was last changed.
    pub updated_at: String,
}

/// A resolved gate verdict as stored in `ladder_outcome`.
///
/// [`GateOutcome::Undecided`] has no token because it has no row: a rung still
/// climbing, or still waiting on this account's reviews, is *unrecorded* rather than
/// recorded as undecided, so "no verdict yet" can never be confused with "a verdict of
/// nothing".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LadderOutcomeKind {
    /// The rung was cleared; the climber moved up.
    Advanced,
    /// The rung was failed; the climber stopped there.
    Walled,
}

impl LadderOutcomeKind {
    /// The stored token.
    pub fn as_str(self) -> &'static str {
        match self {
            LadderOutcomeKind::Advanced => "advanced",
            LadderOutcomeKind::Walled => "walled",
        }
    }

    /// Parse a stored token, erroring on an unknown value (a corrupt row) rather than
    /// guessing — a verdict quietly read as its opposite would move a climb for
    /// reasons nobody could reconstruct.
    pub fn parse(token: &str) -> Result<Self> {
        match token {
            "advanced" => Ok(LadderOutcomeKind::Advanced),
            "walled" => Ok(LadderOutcomeKind::Walled),
            other => Err(BackendError::Internal(format!(
                "unknown ladder outcome: {other}"
            ))),
        }
    }

    /// The storable form of a freshly evaluated gate, or `None` for
    /// [`GateOutcome::Undecided`] — which is recorded by writing no row at all.
    pub fn from_gate(outcome: GateOutcome) -> Option<Self> {
        match outcome {
            GateOutcome::Advance => Some(LadderOutcomeKind::Advanced),
            GateOutcome::Wall => Some(LadderOutcomeKind::Walled),
            GateOutcome::Undecided => None,
        }
    }
}

/// One combination's recorded verdict on one rung, at one pinned case version.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredLadderOutcome {
    /// The rung this verdict is about, by its stable id.
    pub rung_id: String,
    /// The combination this verdict is about, by its [`combination_key`].
    pub combination_key: String,
    /// The exact case version the verdict was decided against. Part of the row's
    /// identity, so bumping a rung to a newer version neither erases the verdict
    /// earned on the old one nor silently inherits it, and re-pinning back restores
    /// it. A rung's *current* verdict is the row whose version matches its present
    /// pin.
    pub decided_version: String,
    /// What the gate computed. Recomputable at any time from this account's reviews.
    pub outcome: LadderOutcomeKind,
    /// The reviewer's manual override of that result, or `None` for none.
    ///
    /// Kept beside the automatic outcome rather than replacing it so a recompute can
    /// never silently undo a human decision, and so clearing it reverses the override
    /// exactly — see [`Self::effective`].
    pub override_outcome: Option<LadderOutcomeKind>,
    /// RFC 3339 of when the override was applied, or `None` when there is none.
    pub override_at: Option<String>,
    /// RFC 3339 of when the automatic outcome was last computed.
    pub decided_at: String,
}

impl StoredLadderOutcome {
    /// The verdict that actually governs the climb: the reviewer's override when they
    /// made one, else what the gate computed.
    pub fn effective(&self) -> LadderOutcomeKind {
        self.override_outcome.unwrap_or(self.outcome)
    }
}

/// Ladders: the ordered, gated sibling of a coverage plan.
///
/// A ladder itself is per-account (keyed by the auth-service `user_id`) and every
/// read/write of one is scoped by it. Its child tables — rungs, climbers, outcomes —
/// are keyed by `ladder_id` alone and **inherit** that scoping: a caller reaches them
/// only after resolving the ladder through [`Db::get_ladder`], which is where
/// ownership is checked. The alternative, re-verifying the owner on every outcome
/// write, would put a query in front of each row of a recompute that walks the whole
/// board.
///
/// As with plans, run and job counting stays global; only *judgement* — whose reviews
/// a gate reads — is per account.
impl Db {
    /// Every ladder the account owns, ordered by display name, each with its rungs in
    /// climb order. The rungs are fetched in one further query and bucketed, so
    /// listing N ladders costs two round-trips rather than N + 1.
    pub async fn list_ladders(&self, user_id: &str) -> Result<Vec<StoredLadder>> {
        let rows = ladder::Entity::find()
            .filter(ladder::Column::UserId.eq(user_id))
            .order_by_asc(ladder::Column::Name)
            .all(&self.conn())
            .await?;
        if rows.is_empty() {
            return Ok(Vec::new());
        }
        let ids: Vec<String> = rows.iter().map(|row| row.id.clone()).collect();
        let mut rungs_by_ladder: HashMap<String, Vec<StoredLadderRung>> = HashMap::new();
        for rung in ladder_rung::Entity::find()
            .filter(ladder_rung::Column::LadderId.is_in(ids))
            .order_by_asc(ladder_rung::Column::Position)
            .all(&self.conn())
            .await?
        {
            rungs_by_ladder
                .entry(rung.ladder_id.clone())
                .or_default()
                .push(stored_ladder_rung(rung));
        }
        rows.into_iter()
            .map(|row| {
                let rungs = rungs_by_ladder.remove(&row.id).unwrap_or_default();
                stored_ladder(row, rungs)
            })
            .collect()
    }

    /// One ladder by id with its rungs in climb order, scoped to the owning account
    /// (`None` when the id is unknown or owned by someone else).
    pub async fn get_ladder(&self, user_id: &str, id: &str) -> Result<Option<StoredLadder>> {
        let Some(row) = ladder::Entity::find_by_id(id.to_string())
            .filter(ladder::Column::UserId.eq(user_id))
            .one(&self.conn())
            .await?
        else {
            return Ok(None);
        };
        let rungs = self.list_ladder_rungs(id).await?;
        Ok(Some(stored_ladder(row, rungs)?))
    }

    /// One ladder's rungs in climb order. Exposed on its own for the paths that need
    /// the climb but not the ladder's own settings (a top-up walking the rungs, a
    /// recompute of every outcome).
    pub async fn list_ladder_rungs(&self, ladder_id: &str) -> Result<Vec<StoredLadderRung>> {
        Ok(ladder_rung::Entity::find()
            .filter(ladder_rung::Column::LadderId.eq(ladder_id))
            .order_by_asc(ladder_rung::Column::Position)
            .all(&self.conn())
            .await?
            .into_iter()
            .map(stored_ladder_rung)
            .collect())
    }

    /// Insert a new ladder (ids already minted by the handler) with its rungs and the
    /// [schedule](LadderSchedule) it starts under. The ladder row and every rung land
    /// in one transaction, so a ladder never exists with half a climb.
    pub async fn insert_ladder(
        &self,
        user_id: &str,
        stored: &StoredLadder,
        schedule: &LadderSchedule,
    ) -> Result<()> {
        let (gate_floor, gate_threshold_kind, gate_threshold_value) = gate_columns(&stored.gate);
        let txn = self.conn().begin().await?;
        ladder::ActiveModel {
            id: Set(stored.id.clone()),
            user_id: Set(user_id.to_string()),
            name: Set(stored.name.clone()),
            outer_axis: Set(schedule.outer_axis.clone()),
            runs_per_cell: Set(stored.runs_per_cell as i32),
            gate_floor: Set(gate_floor),
            gate_threshold_kind: Set(gate_threshold_kind),
            gate_threshold_value: Set(gate_threshold_value),
            early_stop: Set(stored.gate.early_stop),
            count_unloaded_as_broken: Set(stored.gate.unloaded_counts_as_broken),
            paused: Set(schedule.paused),
            auto_top_up: Set(schedule.auto_top_up),
            buffer_target: Set(schedule.buffer_target.map(buffer_target_to_column)),
            // A fresh ladder is nobody's claim; only a top-up ever sets this.
            topping_up_at: Set(None),
            combo_group_ids_json: Set(serde_json::to_string(&stored.combo_group_ids)?),
            combos_json: Set(serde_json::to_string(&stored.combos)?),
            updated_at: Set(stored.updated_at.clone()),
        }
        .insert(&txn)
        .await?;
        write_ladder_rungs(&txn, &stored.id, &stored.rungs).await?;
        txn.commit().await?;
        Ok(())
    }

    /// Update a ladder's **declaration** in place, scoped to the owning account, and
    /// reconcile its rungs to the supplied list. Returns whether a row matched.
    ///
    /// The [schedule](LadderSchedule) columns are untouched for the same reason
    /// [`Self::update_coverage_plan`] leaves a plan's alone: editing the climb must not
    /// un-pause a ladder somebody paused. They travel through
    /// [`Self::set_ladder_schedule`].
    ///
    /// Rungs are **reconciled, never replaced**. Rewriting them wholesale would delete
    /// every rung row, and `ladder_outcome` cascades from `ladder_rung` — so saving a
    /// rename would silently erase every climber's recorded progress. Instead a rung
    /// still present is updated in place under its stable id (keeping its outcomes), a
    /// new one is inserted, and only a rung genuinely removed from the climb takes its
    /// verdicts with it, which is what removing it means.
    pub async fn update_ladder(&self, user_id: &str, stored: &StoredLadder) -> Result<bool> {
        let (gate_floor, gate_threshold_kind, gate_threshold_value) = gate_columns(&stored.gate);
        let txn = self.conn().begin().await?;
        let res = ladder::Entity::update_many()
            .col_expr(ladder::Column::Name, Expr::value(stored.name.clone()))
            .col_expr(
                ladder::Column::RunsPerCell,
                Expr::value(stored.runs_per_cell as i32),
            )
            .col_expr(ladder::Column::GateFloor, Expr::value(gate_floor))
            .col_expr(
                ladder::Column::GateThresholdKind,
                Expr::value(gate_threshold_kind),
            )
            .col_expr(
                ladder::Column::GateThresholdValue,
                Expr::value(gate_threshold_value),
            )
            .col_expr(
                ladder::Column::EarlyStop,
                Expr::value(stored.gate.early_stop),
            )
            .col_expr(
                ladder::Column::CountUnloadedAsBroken,
                Expr::value(stored.gate.unloaded_counts_as_broken),
            )
            .col_expr(
                ladder::Column::ComboGroupIdsJson,
                Expr::value(serde_json::to_string(&stored.combo_group_ids)?),
            )
            .col_expr(
                ladder::Column::CombosJson,
                Expr::value(serde_json::to_string(&stored.combos)?),
            )
            .col_expr(
                ladder::Column::UpdatedAt,
                Expr::value(stored.updated_at.clone()),
            )
            .filter(ladder::Column::Id.eq(stored.id.clone()))
            .filter(ladder::Column::UserId.eq(user_id))
            .exec(&txn)
            .await?;
        if res.rows_affected == 0 {
            txn.commit().await?;
            return Ok(false);
        }

        let mut drop_removed = ladder_rung::Entity::delete_many()
            .filter(ladder_rung::Column::LadderId.eq(stored.id.clone()));
        if !stored.rungs.is_empty() {
            let kept: Vec<String> = stored.rungs.iter().map(|rung| rung.id.clone()).collect();
            drop_removed = drop_removed.filter(ladder_rung::Column::Id.is_not_in(kept));
        }
        drop_removed.exec(&txn).await?;
        write_ladder_rungs(&txn, &stored.id, &stored.rungs).await?;

        txn.commit().await?;
        Ok(true)
    }

    /// Delete a ladder, scoped to the owning account. Returns whether a row was
    /// removed.
    ///
    /// Its rungs, climbers, and outcomes all carry `ON DELETE CASCADE` back to the
    /// ladder (and foreign keys are enforced on both backends — see
    /// [`Self::connect`]), so the whole climb goes with it and nothing is orphaned.
    /// Jobs the ladder launched are *not* touched: a job is a run in its own right, it
    /// records the ladder only as its `origin`, and deleting the plan you launched
    /// from is not a reason to throw away runs that already cost money. Halt first if
    /// that is what you meant.
    pub async fn delete_ladder(&self, user_id: &str, id: &str) -> Result<bool> {
        let res = ladder::Entity::delete_many()
            .filter(ladder::Column::Id.eq(id))
            .filter(ladder::Column::UserId.eq(user_id))
            .exec(&self.conn())
            .await?;
        Ok(res.rows_affected > 0)
    }

    /// One ladder's [schedule](LadderSchedule), scoped to the owning account.
    pub async fn ladder_schedule(&self, user_id: &str, id: &str) -> Result<Option<LadderSchedule>> {
        Ok(ladder::Entity::find_by_id(id.to_string())
            .filter(ladder::Column::UserId.eq(user_id))
            .one(&self.conn())
            .await?
            .map(|row| LadderSchedule {
                outer_axis: row.outer_axis,
                paused: row.paused,
                auto_top_up: row.auto_top_up,
                buffer_target: row.buffer_target.map(buffer_target_from_column),
            }))
    }

    /// Replace a ladder's [schedule](LadderSchedule), scoped to the owning account.
    /// Returns whether a row matched. The ladder's counterpart to
    /// [`Self::set_coverage_plan_schedule`].
    pub async fn set_ladder_schedule(
        &self,
        user_id: &str,
        id: &str,
        schedule: &LadderSchedule,
    ) -> Result<bool> {
        let res = ladder::Entity::update_many()
            .col_expr(
                ladder::Column::OuterAxis,
                Expr::value(schedule.outer_axis.clone()),
            )
            .col_expr(ladder::Column::Paused, Expr::value(schedule.paused))
            .col_expr(ladder::Column::AutoTopUp, Expr::value(schedule.auto_top_up))
            .col_expr(
                ladder::Column::BufferTarget,
                Expr::value(schedule.buffer_target.map(buffer_target_to_column)),
            )
            .filter(ladder::Column::Id.eq(id))
            .filter(ladder::Column::UserId.eq(user_id))
            .exec(&self.conn())
            .await?;
        Ok(res.rows_affected > 0)
    }

    /// Take the top-up claim on a ladder, returning whether this caller got it. The
    /// ladder's counterpart to [`Self::claim_coverage_plan_top_up`], with the same
    /// compare-and-swap and the same `TOP_UP_LEASE`; see that method for why
    /// both exist and how the race is closed.
    pub async fn claim_ladder_top_up(&self, user_id: &str, id: &str, now: &str) -> Result<bool> {
        let txn = self.conn().begin().await?;
        let Some(row) = ladder::Entity::find_by_id(id.to_string())
            .filter(ladder::Column::UserId.eq(user_id))
            .one(&txn)
            .await?
        else {
            txn.commit().await?;
            return Ok(false);
        };
        if !top_up_claim_is_available(row.topping_up_at.as_deref(), now) {
            txn.commit().await?;
            return Ok(false);
        }
        let mut update = ladder::Entity::update_many()
            .col_expr(ladder::Column::ToppingUpAt, Expr::value(now))
            .filter(ladder::Column::Id.eq(id));
        update = match row.topping_up_at {
            Some(held) => update.filter(ladder::Column::ToppingUpAt.eq(held)),
            None => update.filter(ladder::Column::ToppingUpAt.is_null()),
        };
        let claimed = update.exec(&txn).await?.rows_affected > 0;
        txn.commit().await?;
        Ok(claimed)
    }

    /// Release the top-up claim on a ladder. Unconditional, for the same reason
    /// [`Self::release_coverage_plan_top_up`] is.
    pub async fn release_ladder_top_up(&self, id: &str) -> Result<()> {
        ladder::Entity::update_many()
            .col_expr(ladder::Column::ToppingUpAt, Expr::value(None::<String>))
            .filter(ladder::Column::Id.eq(id))
            .exec(&self.conn())
            .await?;
        Ok(())
    }

    /// Every steering row on one ladder, ordered so the reviewer's own priority is the
    /// climb order: focused and highest-priority first, then by key for a stable tie.
    ///
    /// Combinations with no row are absent — an un-steered climber writes nothing —
    /// so the caller unions this against the ladder's resolved members rather than
    /// treating it as the member list.
    pub async fn list_ladder_climbers(&self, ladder_id: &str) -> Result<Vec<StoredLadderClimber>> {
        Ok(ladder_climber::Entity::find()
            .filter(ladder_climber::Column::LadderId.eq(ladder_id))
            .order_by_desc(ladder_climber::Column::Priority)
            .order_by_desc(ladder_climber::Column::Focused)
            .order_by_asc(ladder_climber::Column::CombinationKey)
            .all(&self.conn())
            .await?
            .into_iter()
            .map(|row| StoredLadderClimber {
                combination_key: row.combination_key,
                priority: row.priority,
                focused: row.focused,
                held: row.held,
                updated_at: row.updated_at,
            })
            .collect())
    }

    /// Set one combination's steering on a ladder, creating the row on first use.
    ///
    /// Steering is written whole because it is one small decision — "climb this one
    /// first and watch it" — rather than three independent settings, and a whole write
    /// cannot leave a combination focused-but-forgotten by a partial update.
    pub async fn set_ladder_climber(
        &self,
        ladder_id: &str,
        climber: &StoredLadderClimber,
    ) -> Result<()> {
        ladder_climber::Entity::insert(ladder_climber::ActiveModel {
            ladder_id: Set(ladder_id.to_string()),
            combination_key: Set(climber.combination_key.clone()),
            priority: Set(climber.priority),
            focused: Set(climber.focused),
            held: Set(climber.held),
            updated_at: Set(climber.updated_at.clone()),
        })
        .on_conflict(
            OnConflict::columns([
                ladder_climber::Column::LadderId,
                ladder_climber::Column::CombinationKey,
            ])
            .update_columns([
                ladder_climber::Column::Priority,
                ladder_climber::Column::Focused,
                ladder_climber::Column::Held,
                ladder_climber::Column::UpdatedAt,
            ])
            .to_owned(),
        )
        .exec(&self.conn())
        .await?;
        Ok(())
    }

    /// Every recorded verdict on one ladder — one climber's whole progress and the
    /// board's at once — ordered by combination then rung for a stable read.
    ///
    /// A rung with no row for a combination is *undecided*: still climbing, or still
    /// waiting on this account's reviews.
    pub async fn list_ladder_outcomes(&self, ladder_id: &str) -> Result<Vec<StoredLadderOutcome>> {
        ladder_outcome::Entity::find()
            .filter(ladder_outcome::Column::LadderId.eq(ladder_id))
            .order_by_asc(ladder_outcome::Column::CombinationKey)
            .order_by_asc(ladder_outcome::Column::RungId)
            .all(&self.conn())
            .await?
            .into_iter()
            .map(|row| {
                Ok(StoredLadderOutcome {
                    rung_id: row.rung_id,
                    combination_key: row.combination_key,
                    decided_version: row.decided_version,
                    outcome: LadderOutcomeKind::parse(&row.outcome)?,
                    override_outcome: row
                        .override_outcome
                        .as_deref()
                        .map(LadderOutcomeKind::parse)
                        .transpose()?,
                    override_at: row.override_at,
                    decided_at: row.decided_at,
                })
            })
            .collect()
    }

    /// Record the gate's automatic verdict for one combination on one rung, at the
    /// case version it was decided against.
    ///
    /// Idempotent: re-deciding the same rung updates the verdict and its timestamp. It
    /// writes **only** the automatic columns — a reviewer's
    /// [override](Self::set_ladder_outcome_override) on the same row survives a
    /// recompute untouched, which is the whole reason the two live in separate
    /// columns.
    ///
    /// `decided_version` is part of the row's identity, so bumping a rung's pin later
    /// leaves this verdict recorded against the version that actually earned it rather
    /// than silently transferring it to different content.
    pub async fn record_ladder_outcome(
        &self,
        ladder_id: &str,
        rung_id: &str,
        combination_key: &str,
        decided_version: &str,
        outcome: LadderOutcomeKind,
        now: &str,
    ) -> Result<()> {
        ladder_outcome::Entity::insert(ladder_outcome::ActiveModel {
            ladder_id: Set(ladder_id.to_string()),
            rung_id: Set(rung_id.to_string()),
            combination_key: Set(combination_key.to_string()),
            decided_version: Set(decided_version.to_string()),
            outcome: Set(outcome.as_str().to_string()),
            // Only ever applied on a first insert: the conflict path below updates the
            // automatic columns alone, so an existing override is never cleared here.
            override_outcome: Set(None),
            override_at: Set(None),
            decided_at: Set(now.to_string()),
        })
        .on_conflict(
            OnConflict::columns([
                ladder_outcome::Column::LadderId,
                ladder_outcome::Column::RungId,
                ladder_outcome::Column::CombinationKey,
                ladder_outcome::Column::DecidedVersion,
            ])
            .update_columns([
                ladder_outcome::Column::Outcome,
                ladder_outcome::Column::DecidedAt,
            ])
            .to_owned(),
        )
        .exec(&self.conn())
        .await?;
        Ok(())
    }

    /// Apply (or, with `None`, clear) the reviewer's manual override of one recorded
    /// verdict — a `promote` past a wall the runs failed, or its reversal. Returns
    /// whether a row matched.
    ///
    /// It updates an existing verdict rather than creating one, so an override is
    /// always recorded *alongside* the automatic outcome it disagrees with and the
    /// disagreement stays legible. A rung the gate has not resolved has nothing to
    /// promote past yet and returns `false`; the downward direction of manual control
    /// is [`StoredLadderClimber::held`], which stops a climber wherever it stands
    /// without pretending a rung was decided.
    ///
    /// Clearing passes `None` for both columns at once, restoring exactly what the gate
    /// itself says.
    pub async fn set_ladder_outcome_override(
        &self,
        ladder_id: &str,
        rung_id: &str,
        combination_key: &str,
        decided_version: &str,
        override_outcome: Option<LadderOutcomeKind>,
        now: &str,
    ) -> Result<bool> {
        let res = ladder_outcome::Entity::update_many()
            .col_expr(
                ladder_outcome::Column::OverrideOutcome,
                Expr::value(override_outcome.map(|outcome| outcome.as_str())),
            )
            .col_expr(
                ladder_outcome::Column::OverrideAt,
                Expr::value(override_outcome.map(|_| now)),
            )
            .filter(ladder_outcome::Column::LadderId.eq(ladder_id))
            .filter(ladder_outcome::Column::RungId.eq(rung_id))
            .filter(ladder_outcome::Column::CombinationKey.eq(combination_key))
            .filter(ladder_outcome::Column::DecidedVersion.eq(decided_version))
            .exec(&self.conn())
            .await?;
        Ok(res.rows_affected > 0)
    }
}

/// Write a ladder's rungs, stamping each with its index in the list as its `position`
/// so the stored order is the list order by construction.
///
/// Upserts on the rung's stable id: a rung already stored is updated in place — which
/// is what keeps its `ladder_outcome` rows, since those cascade from it — and a new one
/// is inserted. Removing rungs is the caller's job ([`Db::update_ladder`] does it in
/// the same transaction), because only the caller knows whether an absent rung was
/// deleted or simply not being written this time.
async fn write_ladder_rungs(
    txn: &DatabaseTransaction,
    ladder_id: &str,
    rungs: &[StoredLadderRung],
) -> Result<()> {
    if rungs.is_empty() {
        return Ok(());
    }
    let models = rungs
        .iter()
        .enumerate()
        .map(|(position, rung)| ladder_rung::ActiveModel {
            id: Set(rung.id.clone()),
            ladder_id: Set(ladder_id.to_string()),
            position: Set(position as i32),
            slug: Set(rung.slug.clone()),
            version: Set(rung.version.clone()),
            variant: Set(rung.variant.clone()),
            engine: Set(rung.engine.clone()),
            runs_override: Set(rung.runs_override.map(|runs| runs as i32)),
        });
    ladder_rung::Entity::insert_many(models)
        .on_conflict(
            OnConflict::column(ladder_rung::Column::Id)
                .update_columns([
                    ladder_rung::Column::Position,
                    ladder_rung::Column::Slug,
                    ladder_rung::Column::Version,
                    ladder_rung::Column::Variant,
                    ladder_rung::Column::Engine,
                    ladder_rung::Column::RunsOverride,
                ])
                .to_owned(),
        )
        .exec(txn)
        .await?;
    Ok(())
}

/// Convert a stored ladder row and its already-ordered rungs into the in-memory
/// [`StoredLadder`], decoding the JSON member columns and rebuilding the gate.
fn stored_ladder(row: ladder::Model, rungs: Vec<StoredLadderRung>) -> Result<StoredLadder> {
    Ok(StoredLadder {
        gate: gate_from_row(&row)?,
        id: row.id,
        name: row.name,
        runs_per_cell: row.runs_per_cell.max(0) as u32,
        combo_group_ids: serde_json::from_str(&row.combo_group_ids_json)?,
        combos: serde_json::from_str(&row.combos_json)?,
        rungs,
        updated_at: row.updated_at,
    })
}

/// Convert a stored rung row into its in-memory form. The `position` column is dropped
/// on the way in: it has already done its job ordering the read, and
/// [`StoredLadderRung`] deliberately carries no copy of it.
fn stored_ladder_rung(row: ladder_rung::Model) -> StoredLadderRung {
    StoredLadderRung {
        id: row.id,
        slug: row.slug,
        version: row.version,
        variant: row.variant,
        engine: row.engine,
        runs_override: row.runs_override.map(|runs| runs.max(0) as u32),
    }
}

/// The `(gate_floor, gate_threshold_kind, gate_threshold_value)` column triple for a
/// gate.
///
/// One threshold column serves both kinds because a gate only ever has one threshold;
/// `f64` represents the small whole numbers of the `count` form exactly. The kind
/// tokens match [`GateThreshold`]'s serde tags, so a stored ladder and a gate on the
/// wire always name the same rule.
fn gate_columns(gate: &Gate) -> (String, String, f64) {
    let (kind, value) = match gate.threshold {
        GateThreshold::Count { runs } => ("count", f64::from(runs)),
        GateThreshold::Fraction { fraction } => ("fraction", fraction),
    };
    (gate.floor.as_str().to_string(), kind.to_string(), value)
}

/// Rebuild a [`Gate`] from a stored ladder row.
///
/// An unrecognized floor or threshold kind is a corrupt row and surfaces as an error
/// rather than degrading into some other rule: a gate that quietly changed shape would
/// wall or advance climbers for reasons nobody could reconstruct afterwards. A
/// negative stored count clamps to zero, which is a gate that always advances — the
/// harmless direction for a value that cannot be written through the API at all.
fn gate_from_row(row: &ladder::Model) -> Result<Gate> {
    let floor = Rating::parse(&row.gate_floor).ok_or_else(|| {
        BackendError::Internal(format!("unknown ladder gate floor: {}", row.gate_floor))
    })?;
    let threshold = match row.gate_threshold_kind.as_str() {
        "count" => GateThreshold::Count {
            runs: row.gate_threshold_value.max(0.0) as u32,
        },
        "fraction" => GateThreshold::Fraction {
            fraction: row.gate_threshold_value,
        },
        other => {
            return Err(BackendError::Internal(format!(
                "unknown ladder gate threshold kind: {other}"
            )));
        }
    };
    Ok(Gate {
        floor,
        threshold,
        unloaded_counts_as_broken: row.count_unloaded_as_broken,
        early_stop: row.early_stop,
    })
}

/// The lifted `run.rating` column value: the [functional rating](functional_rating)
/// as its lowercase wire token, or `None` when a legacy run carries no reviews.
fn lifted_rating(
    manifest: Option<&StoredManifest>,
    record: &RunRecord,
    reviews: &[StoredReview],
) -> Option<String> {
    functional_rating(manifest, record, reviews).map(|rating| rating.as_str().to_string())
}

/// The lifted `run.aesthetic` column value: the aggregate aesthetic rating as its
/// lowercase wire token, or `None` when no review rated the aesthetic channel.
fn lifted_aesthetic(reviews: &[StoredReview]) -> Option<String> {
    aggregate_review_aesthetic(reviews).map(|rating| rating.as_str().to_string())
}

/// The test types graded automatically, which therefore never await a human
/// review. A [`performance`](test_cabinet_core::TestType::Performance) run is
/// scored by its validator — correctness against a reference oracle, then the fuel
/// a correct engine burned — and carries no reviewer checklist at all, so it would
/// otherwise sit in the unreviewed worklist forever: `review_count` stays 0 because
/// there is no review anyone can write. The unreviewed slices exclude these types
/// for the same reason they exclude the failure tiers.
///
/// Stored as the wire strings ([`TestType::as_str`](test_cabinet_core::TestType::as_str))
/// the lifted `test_type` column holds.
const AUTO_GRADED_TEST_TYPES: [&str; 1] = ["performance"];

/// Which lifecycle slice the console's summary listing draws its page from,
/// mirroring the `state` selector of the cursor listings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SummaryState {
    /// Published runs only (the public read side). The default.
    #[default]
    Published,
    /// Completed runs (pending + published) — the reviewer worklist.
    Review,
    /// The publishable failure tiers (catastrophic, timed-out,
    /// harness-error), pending and published.
    Failures,
    /// Every unpublished run whatever its terminal state — the "produced" worklist.
    Unpublished,
    /// The unpublished runs that would **publish right now** — the subset of
    /// [`Self::Unpublished`] that clears the publish gate (`gate_publishable`, the
    /// rule [`Db::ensure_publishable`] enforces): a reviewed completed run, or a
    /// publishable failure tier (which needs no review). Never an infrastructure
    /// failure, whatever reviews it carries.
    ///
    /// This is the console's publish worklist. It is deliberately narrower than
    /// [`Self::Unpublished`], which also holds the runs nobody has reviewed yet and
    /// the infrastructure failures that can never go public — listing those in a
    /// worklist whose whole purpose is "select these and publish them" would offer
    /// rows the backend is about to refuse.
    Publishable,
    /// Completed runs no account has reviewed yet (`review_count = 0`) — the
    /// reviewer's "needs a first pass" worklist, a subset of [`Self::Review`].
    /// Excludes the automatically-graded types, which no reviewer can clear (see
    /// `AUTO_GRADED_TEST_TYPES`).
    Unreviewed,
    /// Every recorded run, whatever its terminal state and whether or not it is
    /// published — the union of [`Self::Published`] and [`Self::Unpublished`]. This
    /// is what a listing scoped to something *other* than the publish lifecycle
    /// wants: the consoles' run listings, where an unpublished (and therefore
    /// unreviewed) run must take its place in the *same* sorted, paged listing as the
    /// published ones rather than being pinned ahead of them client-side, and the gg
    /// analysis section's Sessions tab, which must show exactly the runs the
    /// [document index](crate::gg_docs::GgDocIndex) holds, most of which are never
    /// published.
    Any,
}

/// The filter for [`Db::list_summaries`]: a lifecycle `state` slice, optional
/// equality filters on the lifted identity columns, and an optional case-
/// insensitive free-text query — all combined with AND.
#[derive(Debug, Clone, Default)]
pub struct SummaryFilter {
    /// The lifecycle slice to draw from (default [`SummaryState::Published`]).
    pub state: SummaryState,
    /// Restrict to one test-case slug (`test_case_slug`).
    pub test_case: Option<String>,
    /// Restrict to a list of test-case slugs (`test_case_slug` ∈ the list) — the
    /// home page's group-leaderboard slice: one query covers a [test-case
    /// group](test_cabinet_core::TestCaseGroup)'s member cases. Like every other
    /// filter it ANDs, [`Self::test_case`] included, so naming both narrows to
    /// their intersection (the semantic `api.md` documents and the console's
    /// `runQuery.ts` `matches` mirrors), and [`Self::latest_versions`] composes
    /// with it as with any case slice. An empty or absent list applies no filter.
    pub test_cases: Option<Vec<String>>,
    /// Restrict to one model (`model_id`).
    pub model: Option<String>,
    /// Restrict to one harness (`harness_slug`).
    pub harness: Option<String>,
    /// Restrict to one variant (`variant`). Paired with [`Self::test_case`] this is
    /// the case-detail Runs tab's slice — a variant slug is only unique within its
    /// case.
    pub variant: Option<String>,
    /// Restrict to one exact test-case version (`test_case_version`). A version
    /// string is only meaningful within a case, so this is normally paired with
    /// [`Self::test_case`] — but it is a plain equality filter, so on its own it
    /// selects that version of *every* case.
    pub version: Option<String>,
    /// Restrict to a list of exact test-case versions (`test_case_version` ∈ the
    /// list). This is the case-detail Runs tab's anchored version scope: the
    /// console computes the versions in the anchored `major.minor` or major line
    /// from the catalog and sends the concrete list. Like [`Self::version`], it
    /// silences [`Self::latest_versions`] — the explicit list is the more specific
    /// instruction. An empty or absent list applies no filter.
    pub versions: Option<Vec<String>>,
    /// Restrict to one engine slug (`engine_slug`) — the runtime the produced
    /// build was written against, with `none` naming the engineless run. Runs
    /// under different engines are not comparable, so this is how the case-detail
    /// tabs pin a listing to the anchored engine.
    ///
    /// A `NULL` column is a row written before the column existed whose record no
    /// longer deserializes (the startup backfill lifts every readable record,
    /// pre-engine-era ones included, to a concrete slug). Such a row's engine is
    /// unknown, so it is excluded from any engine filter — except `"none"`, where
    /// `NULL` matches: every pre-engine-era record deserializes to `none`, so an
    /// un-backfillable row can only plausibly be an engineless-era one.
    pub engine: Option<String>,
    /// Restrict to the runs launched from one gg configuration, by the configuration's
    /// **id** (`gg_config_id`).
    ///
    /// The id rather than the configuration's name, which is display text an operator
    /// rewrites freely and nothing keeps unique within an account. A coverage
    /// cell counts by this same column, so a listing narrowed by it holds exactly the runs
    /// a cell's count is made of, and a reviewer following a cell's link reads the rows
    /// behind the figure they clicked.
    ///
    /// The bare id the account's library is keyed by, never the `saved:<id>` spelling a
    /// stored member may carry: the run records the bare form and this is an equality on
    /// that column. `NULL` (every non-gg run, and a gg run assembled by hand) matches no
    /// id.
    pub gg_config_id: Option<String>,
    /// Restrict every run to its case's **current** version — the greatest
    /// `major.minor` that case has a run for within this filter's
    /// [`state`](Self::state) slice (see [`Db::current_case_versions`]). This is
    /// the listings' "only show runs against the current spec" toggle: a case is
    /// frozen once it has runs, so an older `major.minor` is a different spec whose
    /// runs are not comparable with the current one's.
    ///
    /// Ignored when [`Self::version`] names an exact version — an explicit version
    /// is the more specific instruction, and AND'ing the two would silently empty
    /// the listing whenever the picked version is not the current one.
    pub latest_versions: bool,
    /// Restrict to runs whose aggregate **aesthetic** rating is exactly this wire
    /// token (`legendary`/`amazing`/`good`/`okay`/`slop`) — an equality on the
    /// lifted `aesthetic` column. A `NULL` column (no review has rated the
    /// channel) matches no token, so an unrated run never appears in an
    /// aesthetic-filtered listing. `aesthetic=legendary` newest-first is the home
    /// page's showcase query.
    pub aesthetic: Option<String>,
    /// Free-text query matched case-insensitively (LIKE `%q%`) across
    /// `test_case_slug`, `model_id`, `harness_slug`, `variant`, and `gg_preset` —
    /// the last so a gg run is findable by the configuration name its row shows in
    /// place of a model.
    pub q: Option<String>,
}

/// One case's in-scope versions for a [`SummaryFilter::latest_versions`] query:
/// every version of `slug` sharing its greatest `major.minor` (a case can carry
/// several revisions of one minor, e.g. `v1.2.0` and `v1.2.1`, and all of them are
/// the same spec).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaseVersions {
    /// The test-case slug.
    pub slug: String,
    /// Its current versions, ascending.
    pub versions: Vec<String>,
}

/// The sort column for [`Db::list_summaries`], mapped to a lifted `run` column (or,
/// for [`SummarySort::Rating`], a tier-rank expression).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SummarySort {
    /// By start time (`started_at`). The default.
    #[default]
    Date,
    /// By end-to-end wall-clock time (`run_time_seconds`).
    Runtime,
    /// By total token count (`total_tokens`).
    Tokens,
    /// By comparable cost (`cost_comparable`); unknown-cost NULLs sort last.
    Cost,
    /// By rating **tier** (`flawless > great > passable > scuffed > broken`); unrated NULLs
    /// sort last.
    Rating,
    /// By test type (`test_type`).
    TestType,
    /// By the test case's **display name** — what the listing's column shows — with
    /// the slug standing in for a case the store has no name for (see
    /// `case_name_expr`).
    TestCase,
    /// By harness slug (`harness_slug`).
    Harness,
    /// By the run's model/configuration identity — the gg configuration name where
    /// there is one, else the model id (`COALESCE(gg_preset, model_id)`), so the
    /// order matches what the console's MODEL / CONFIG cell actually shows.
    Model,
    /// By variant (`variant`).
    Variant,
}

/// The sort direction for [`Db::list_summaries`], applied to the primary sort key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SortDir {
    /// Descending — the default (newest / largest / best first).
    #[default]
    Desc,
    /// Ascending.
    Asc,
}

/// The readable `run` query narrowed to one lifecycle slice and nothing else — the
/// base both [`summary_query`] and the current-version resolution start from, so
/// the versions a `latest_versions` query is measured against come from exactly the
/// slice that query lists.
///
/// It starts from [`readable_runs`], so the COUNT and the page a listing runs over
/// it agree on how many rows exist.
fn state_slice(state: SummaryState) -> Select<run::Entity> {
    let query = readable_runs();
    match state {
        SummaryState::Published => query.filter(run::Column::Published.eq(true)),
        SummaryState::Review => query.filter(run::Column::RunState.is_in(["completed"])),
        SummaryState::Failures => {
            query.filter(run::Column::RunState.is_in(publishable_failure_states()))
        }
        SummaryState::Unpublished => query.filter(run::Column::Published.eq(false)),
        // Mirrors `gate_publishable` as a query: not already public, never one of the
        // states that can never be published, and one of: a publishable failure tier
        // (no review required), a validator-rated run (its functional rating and
        // score stand on their own, so no review is required either), or a run
        // someone has reviewed. The exclusion is `never_publishable_states` rather
        // than a written-out state for the reason that helper exists: a review is
        // enough to satisfy the second half of the rule, so any state naming itself
        // unpublishable has to be refused by the first half or a reviewed one would
        // be listed and then refused by the gate. Kept in step with the gate by
        // `publishable_slice_matches_the_publish_gate`.
        SummaryState::Publishable => query
            .filter(run::Column::Published.eq(false))
            .filter(run::Column::RunState.is_not_in(never_publishable_states()))
            .filter(
                Condition::any()
                    .add(run::Column::RunState.is_in(publishable_failure_states()))
                    .add(run::Column::ValidatorRated.eq(true))
                    .add(run::Column::ReviewCount.gt(0)),
            ),
        SummaryState::Unreviewed => query
            .filter(run::Column::RunState.eq("completed"))
            .filter(run::Column::ReviewCount.eq(0))
            .filter(run::Column::TestType.is_not_in(AUTO_GRADED_TEST_TYPES)),
        // Every recorded run — no lifecycle predicate at all.
        SummaryState::Any => query,
    }
}

/// Build the filtered `run` query shared by [`Db::list_summaries`]'s COUNT and its
/// page: the lifecycle-state predicate AND'd with the optional equality filters and
/// the free-text query. No ordering, limit, or offset — the caller adds those.
///
/// `scope` is the already-resolved [`SummaryFilter::latest_versions`] allowlist
/// ([`Db::current_case_versions`]), or `None` when the caller did not ask for one.
/// It is passed in rather than resolved here because resolving it costs a query,
/// and this builder is called twice (COUNT, then page) per listing.
fn summary_query(filter: &SummaryFilter, scope: Option<&[CaseVersions]>) -> Select<run::Entity> {
    let mut query = state_slice(filter.state);
    if let Some(scope) = scope {
        query = query.filter(current_versions_condition(scope));
    }
    if let Some(version) = filter.version.as_deref().filter(|s| !s.is_empty()) {
        query = query.filter(run::Column::TestCaseVersion.eq(version));
    }
    if let Some(versions) = filter.versions.as_deref().filter(|v| !v.is_empty()) {
        query =
            query.filter(run::Column::TestCaseVersion.is_in(versions.iter().map(String::as_str)));
    }
    if let Some(engine) = filter.engine.as_deref().filter(|s| !s.is_empty()) {
        // NULL is a row whose record could not be re-read (the backfill settles every
        // readable row to a concrete slug), so its engine is unknown and it matches no
        // engine filter — except `none`: every pre-engine-era record deserializes to
        // `none`, so the only engine an un-backfillable row can plausibly have is none.
        if engine == "none" {
            query = query.filter(
                Condition::any()
                    .add(run::Column::EngineSlug.eq(engine))
                    .add(run::Column::EngineSlug.is_null()),
            );
        } else {
            query = query.filter(run::Column::EngineSlug.eq(engine));
        }
    }
    if let Some(test_case) = filter.test_case.as_deref().filter(|s| !s.is_empty()) {
        query = query.filter(run::Column::TestCaseSlug.eq(test_case));
    }
    if let Some(test_cases) = filter.test_cases.as_deref().filter(|v| !v.is_empty()) {
        // AND'd with `test_case` like every other filter, so naming both narrows
        // to their intersection (see [`SummaryFilter::test_cases`]).
        query =
            query.filter(run::Column::TestCaseSlug.is_in(test_cases.iter().map(String::as_str)));
    }
    if let Some(aesthetic) = filter.aesthetic.as_deref().filter(|s| !s.is_empty()) {
        // A NULL column never equals a token, which is the contract: a run no
        // review has rated on the aesthetic channel matches no tier.
        query = query.filter(run::Column::Aesthetic.eq(aesthetic));
    }
    if let Some(model) = filter.model.as_deref().filter(|s| !s.is_empty()) {
        query = query.filter(run::Column::ModelId.eq(model));
    }
    if let Some(harness) = filter.harness.as_deref().filter(|s| !s.is_empty()) {
        query = query.filter(run::Column::HarnessSlug.eq(harness));
    }
    if let Some(variant) = filter.variant.as_deref().filter(|s| !s.is_empty()) {
        query = query.filter(run::Column::Variant.eq(variant));
    }
    if let Some(config_id) = filter
        .gg_config_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        // An equality on the same column a gg cell's counts group on, so the listing this
        // narrows to and the count a cell shows are the one set of runs. A NULL column
        // never equals an id, which is the contract: a run launched from no configuration
        // belongs to no configuration's listing.
        query = query.filter(run::Column::GgConfigId.eq(config_id));
    }
    if let Some(q) = filter.q.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        // Lower both sides so the match is case-insensitive on any backend (SQLite's
        // LIKE is ASCII-case-insensitive already; lowering makes it explicit and
        // portable). OR across the searchable identity columns; AND'd with the rest.
        let pattern = format!("%{}%", q.to_lowercase());
        let text = Condition::any()
            .add(Expr::expr(Func::lower(run::Column::TestCaseSlug.into_expr())).like(&pattern))
            .add(Expr::expr(Func::lower(run::Column::ModelId.into_expr())).like(&pattern))
            .add(Expr::expr(Func::lower(run::Column::HarnessSlug.into_expr())).like(&pattern))
            .add(Expr::expr(Func::lower(run::Column::Variant.into_expr())).like(&pattern))
            // A gg row is displayed by its configuration, so it must be findable by
            // it. NULL (every non-gg run) simply never matches: `lower(NULL) LIKE …`
            // is NULL, which the OR discards.
            .add(Expr::expr(Func::lower(run::Column::GgPreset.into_expr())).like(&pattern));
        query = query.filter(text);
    }
    query
}

/// The `latest_versions` predicate: a run is in scope when its
/// `(test_case_slug, test_case_version)` pair appears in `scope` — an OR of one
/// per-case term, each pinning a slug to its current versions.
///
/// An empty `scope` means the slice holds no runs at all, so the condition is a
/// literal false rather than an empty (and therefore vacuously true) `OR`.
fn current_versions_condition(scope: &[CaseVersions]) -> Condition {
    if scope.is_empty() {
        return Condition::all().add(Expr::value(false));
    }
    scope.iter().fold(Condition::any(), |condition, case| {
        condition.add(
            Condition::all()
                .add(run::Column::TestCaseSlug.eq(case.slug.as_str()))
                .add(run::Column::TestCaseVersion.is_in(case.versions.iter().map(String::as_str))),
        )
    })
}

/// A version's `(major, minor)` pair, using the catalog's own component-wise
/// [`version_key`] so `v1.10.0` orders after `v1.9.0` (a lexical compare gets that
/// backwards). Missing or non-numeric components read as `0`, matching
/// [`version_key`]'s own tolerance.
fn major_minor(version: &str) -> (u64, u64) {
    let key = version_key(version);
    (
        key.first().copied().unwrap_or(0),
        key.get(1).copied().unwrap_or(0),
    )
}

/// Group `(slug, version)` pairs into each case's **current** versions: those
/// sharing the greatest `major.minor` the case has a pair for. Pure, so the
/// grouping is covered without a database.
fn current_versions(pairs: Vec<(String, String)>) -> Vec<CaseVersions> {
    let mut by_case: HashMap<String, Vec<String>> = HashMap::new();
    for (slug, version) in pairs {
        by_case.entry(slug).or_default().push(version);
    }
    let mut scope: Vec<CaseVersions> = by_case
        .into_iter()
        .map(|(slug, mut versions)| {
            let current = versions
                .iter()
                .map(|v| major_minor(v))
                .max()
                .unwrap_or((0, 0));
            versions.retain(|version| major_minor(version) == current);
            versions.sort_by(|a, b| version_key(a).cmp(&version_key(b)).then_with(|| a.cmp(b)));
            CaseVersions { slug, versions }
        })
        .collect();
    // `HashMap` iteration is unordered; sort so the built condition (and anything
    // asserting on it) is deterministic.
    scope.sort_by(|a, b| a.slug.cmp(&b.slug));
    scope
}

/// Apply the primary sort key (in `order`) to a summary query. The caller appends
/// the `id` tiebreak. Cost/rating lead with a null-group key so NULLs always sort
/// last regardless of `order`. `case_names` feeds the test-case key alone.
fn apply_summary_sort(
    query: Select<run::Entity>,
    sort: SummarySort,
    order: Order,
    case_names: &CaseNames,
) -> Select<run::Entity> {
    match sort {
        SummarySort::Date => query.order_by(run::Column::StartedAt, order),
        SummarySort::Runtime => query.order_by(run::Column::RunTimeSeconds, order),
        SummarySort::Tokens => query.order_by(run::Column::TotalTokens, order),
        SummarySort::TestType => query.order_by(run::Column::TestType, order),
        // The TEST column shows the case's display name, so it sorts by it: a run
        // of `pong` (shown as Carom) files under "c", not "p".
        SummarySort::TestCase => query.order_by(case_name_expr(case_names), order),
        SummarySort::Harness => query.order_by(run::Column::HarnessSlug, order),
        // The MODEL / CONFIG column sorts by what it displays: a gg run's
        // configuration name, falling back to the model id for every other run (and
        // for a gg run recorded without one). A bare COALESCE suffices because
        // `gg_preset` is only ever set for a gg run — see `lifted_gg_preset`.
        SummarySort::Model => query.order_by(model_identity_expr(), order),
        SummarySort::Variant => query.order_by(run::Column::Variant, order),
        // Unknown-cost NULLs sort last in either direction: order first by a
        // null-group key (non-null `false`/0 before null `true`/1), then the value.
        SummarySort::Cost => query
            .order_by(
                run::Column::CostComparable.into_expr().is_null(),
                Order::Asc,
            )
            .order_by(run::Column::CostComparable, order),
        // Rating is a TIER, not a lexical token: rank it via a CASE, with unrated
        // NULLs pinned last (again via a leading null-group key).
        SummarySort::Rating => query
            .order_by(run::Column::Rating.into_expr().is_null(), Order::Asc)
            .order_by(rating_rank_expr(), order),
    }
}

/// The run's model/configuration identity as one sortable expression:
/// `COALESCE(gg_preset, model_id)` — the gg configuration name where the run has
/// one, else the model id.
///
/// This is the value the console's MODEL / CONFIG cell renders, so ordering by it
/// puts a server-ordered page in the order its own header claims. Safe as a bare
/// COALESCE because [`lifted_gg_preset`] only ever writes the column for a gg run.
/// The display name of a run's case as a SQL expression: a `CASE` over
/// `test_case_slug` mapping every slug in `names` to its name, with the slug itself
/// for any other. The catalog is not in the database — the definition store holds
/// it — so the lookup is spelled out per query rather than joined; a catalog's
/// worth of branches is a few hundred at most. An empty map degrades to the bare
/// slug column, which is also what a slug nobody knows sorts by.
fn case_name_expr(names: &CaseNames) -> SimpleExpr {
    if names.is_empty() {
        return run::Column::TestCaseSlug.into_expr().into();
    }
    let mut case = CaseStatement::new();
    for (slug, name) in names {
        case = case.case(run::Column::TestCaseSlug.eq(slug.as_str()), name.as_str());
    }
    case.finally(run::Column::TestCaseSlug.into_expr()).into()
}

fn model_identity_expr() -> SimpleExpr {
    Func::coalesce([
        run::Column::GgPreset.into_expr().into(),
        run::Column::ModelId.into_expr().into(),
    ])
    .into()
}

/// A SQL `CASE` mapping the `run.rating` text token to its tier ordinal (`0` best,
/// larger worse), drawn from [`Rating::rank`](test_cabinet_core::review::Rating) so
/// the DB order matches the in-memory "worst wins" aggregate. Any unexpected/legacy
/// non-null token ranks beyond the worst tier; genuine NULLs are separated out by
/// the caller's null-group key before this is consulted.
fn rating_rank_expr() -> SimpleExpr {
    use test_cabinet_core::review::Rating;
    let mut case = CaseStatement::new();
    for rating in Rating::ALL {
        case = case.case(
            run::Column::Rating.eq(rating.as_str()),
            rating.rank() as i32,
        );
    }
    case.finally(Rating::ALL.len() as i32).into()
}

/// The wire strings of the **publishable failure** tiers — catastrophic,
/// timed-out, harness-error, limit-exceeded and hung — the slice every failures-only
/// query and publish gate filters on.
///
/// Derived from [`RunState::is_publishable_failure`](test_cabinet_core::run_record::RunState::is_publishable_failure) rather than written out, so a
/// new failure tier cannot be added to the contract and silently missed here.
/// `publishable_failure_states_match_the_contract` pins the two together.
fn publishable_failure_states() -> Vec<&'static str> {
    test_cabinet_core::run_record::RunState::ALL
        .into_iter()
        .filter(|state| state.is_publishable_failure())
        .map(run_state_str)
        .collect()
}

/// The wire string for a run state (matching the serde representation).
fn run_state_str(state: test_cabinet_core::run_record::RunState) -> &'static str {
    use test_cabinet_core::run_record::RunState;
    match state {
        RunState::Completed => "completed",
        RunState::Catastrophic => "catastrophic",
        RunState::TimedOut => "timed_out",
        RunState::HarnessError => "harness_error",
        RunState::LimitExceeded => "limit_exceeded",
        RunState::Hung => "hung",
        RunState::Infrastructure => "infrastructure",
        RunState::Canceled => "canceled",
    }
}

/// The wire strings of the run states that can **never** be published — today the
/// infrastructure failure (our fault, not a model result) and an operator-canceled
/// run (a deliberate stop, not an outcome). Both are retained for inspection only.
///
/// Derived from [`RunState::is_publishable`](test_cabinet_core::run_record::RunState::is_publishable) rather than written out, for the same
/// reason [`publishable_failure_states`] is: a new never-publishable state cannot be
/// added to the contract and silently slip through the publish gate.
fn never_publishable_states() -> Vec<&'static str> {
    test_cabinet_core::run_record::RunState::ALL
        .into_iter()
        .filter(|state| !state.is_publishable())
        .map(run_state_str)
        .collect()
}

/// Extract the filesystem path from a SQLite **file** connection URL, or `None`
/// for a PostgreSQL URL or an in-memory SQLite database. Used to create the
/// parent directory before connecting.
fn sqlite_file_path(url: &str) -> Option<PathBuf> {
    let rest = url
        .strip_prefix("sqlite://")
        .or_else(|| url.strip_prefix("sqlite:"))?;
    // Drop any `?mode=rwc`-style query string, leaving the bare path.
    let path = rest.split('?').next().unwrap_or_default();
    if path.is_empty() || path == ":memory:" {
        return None;
    }
    Some(Path::new(path).to_path_buf())
}

/// What launched a job, as stored in `job.origin`. A run launched by hand from the
/// new-run form has no origin at all, which is represented by `None` at the call sites
/// rather than by a variant here — "launched by nothing in particular" is the absence
/// of an origin, not a kind of one.
///
/// This is what makes a scoped halt safe. `halt` cancels exactly the plan's or
/// ladder's own waiting jobs; without an origin there would be no way to tell those
/// from the manual run someone kicked off in another tab, and a job with no origin is
/// never swept up by a scoped halt.
///
/// Deliberately invisible to coverage counting, which stays global: a run counts
/// toward its cell's target whoever launched it and whatever launched it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JobOrigin {
    /// A coverage plan's top-up, by the plan's id.
    Plan(String),
    /// A ladder's top-up, by the ladder's id.
    Ladder(String),
}

impl JobOrigin {
    /// The stored token: `plan:<id>` or `ladder:<id>`. Prefixed rather than bare so a
    /// plan and a ladder cannot halt each other's runs — their ids are minted
    /// independently and nothing stops them colliding.
    pub fn as_token(&self) -> String {
        match self {
            JobOrigin::Plan(id) => format!("plan:{id}"),
            JobOrigin::Ladder(id) => format!("ladder:{id}"),
        }
    }

    /// Parse a stored token, returning `None` for anything that is not one of the two
    /// forms — including the empty string and a token from a future kind of owner.
    /// Unrecognized is treated as unattributed rather than as an error: an origin is a
    /// label on a job, and a job nobody can attribute is still a perfectly good job.
    pub fn parse(token: &str) -> Option<Self> {
        if let Some(id) = token.strip_prefix("plan:") {
            return (!id.is_empty()).then(|| JobOrigin::Plan(id.to_string()));
        }
        let id = token.strip_prefix("ladder:")?;
        (!id.is_empty()).then(|| JobOrigin::Ladder(id.to_string()))
    }
}

/// Everything one claim pass changed: the job it handed to the dispatcher, and the
/// waiting jobs whose display state it reconciled on the way past.
///
/// The two are separate because they mean different things to a caller. `claimed` is
/// the *answer* — the job to dispatch, or `None` when nothing is claimable — while
/// `reconciled` is a side effect the pass performs on the rest of the queue. A
/// dispatcher acts on the first and ignores the second; the console stream announces
/// both, because both changed a row somebody may be looking at.
#[derive(Debug, Clone, Default)]
pub struct ClaimOutcome {
    /// The job moved to `dispatched`, if any was claimable.
    pub claimed: Option<job::Model>,
    /// The waiting jobs this pass moved between `queued` and `pending`, each with its
    /// new state. Empty when every waiting job's display state was already correct.
    pub reconciled: Vec<job::Model>,
}

/// Which jobs a bulk cancel reaches: the in-flight states to sweep, optionally narrowed
/// to one plan/ladder and/or one account.
///
/// Every field narrows, and the default — no origin, no account — is the global
/// Runs-page control, which is deliberately scoped to nothing. States outside the
/// in-flight set are ignored rather than rejected, so no filter can move a job back out
/// of a terminal state.
#[derive(Debug, Clone, Default)]
pub struct JobCancelFilter<'a> {
    /// The job states to cancel — normally [`CANCELABLE_WAITING_STATES`] (the jobs that
    /// have cost nothing yet), or both that and [`CANCELABLE_ACTIVE_STATES`] for the
    /// confirmed "stop everything" controls.
    pub states: &'a [&'a str],
    /// Restrict to the jobs one plan or ladder launched. `None` sweeps every job in the
    /// chosen states whatever launched it, **including manual launches**, which is why
    /// only the explicitly global controls leave it unset.
    pub origin: Option<&'a JobOrigin>,
    /// Restrict to the jobs one account launched. `None` sweeps every account's — jobs
    /// enqueued before attribution existed carry no `user_id`, so a filter set here
    /// silently skips them, which is correct for "cancel *my* runs" and wrong for
    /// "cancel everything".
    pub user_id: Option<&'a str>,
}

/// A run to enqueue: the minted id and token, the verbatim launch request, and
/// the identity columns lifted out of it for the active-run list.
#[derive(Clone)]
pub struct NewJob {
    /// The job id, minted by the backend at enqueue.
    pub id: String,
    /// The launch request serialized verbatim (the `RunRequest` HTTP shape).
    pub request_json: String,
    /// The test-case slug, lifted for the active-run list.
    pub test_case_slug: String,
    /// The test-case version, lifted for the active-run list.
    pub test_case_version: String,
    /// The variant, lifted for the active-run list.
    pub variant: String,
    /// The resolved test case's type, lifted so the queue can serialize the run
    /// types that must not overlap (see [`job::Model::test_type`]).
    pub test_type: String,
    /// The harness slug, lifted for the active-run list.
    pub harness_slug: String,
    /// The opaque model id, lifted for the active-run list.
    pub model_id: String,
    /// The engine the launch request names, lifted at enqueue — the fourth segment of a
    /// queued run's [cell identity](CellKey). `None` where the request named none, which
    /// is the `none` engine every grouped count coalesces it to.
    ///
    /// A column for the reason `harness_slug` and `model_id` are: the queue counts a
    /// cell's in-flight runs in SQL, and a count that must first deserialize a launch
    /// request per row is not a count the database can do.
    pub engine_slug: Option<String>,
    /// The **gg** run's capability set serialized to JSON, lifted from the launch
    /// request at enqueue. `None` for every third-party-harness job.
    pub gg_config_json: Option<String>,
    /// The **gg** run's configuration name, lifted from that same capability set for the
    /// console's active-run list. Display text, not identity — that is
    /// [`gg_config_id`](Self::gg_config_id). `None` for every third-party-harness job,
    /// and for a gg run assembled without a configuration.
    pub gg_preset: Option<String>,
    /// The id of the **gg** configuration the run was launched from, lifted from that
    /// same capability set — the first half of a queued gg run's
    /// [cell identity](CellKey). `None` for every third-party-harness job, and for a gg
    /// run assembled without a configuration.
    pub gg_config_id: Option<String>,
    /// The models the **gg** run's capability set binds, as one comparable string — the
    /// second half of a queued gg run's [cell identity](CellKey). `None` for every
    /// third-party-harness job.
    ///
    /// Lifted into its own column rather than derived per row from `gg_config_json`,
    /// for the reason `harness_slug` and `model_id` already are: the queue counts a
    /// cell's in-flight runs in SQL, and a count that must first deserialize a
    /// capability set per row is not a count the database can do.
    pub gg_models: Option<String>,
    /// The per-job bearer token the driver authenticates its streaming with.
    pub job_token: String,
    /// Which attempt this job is: `0` for a console launch, `n > 0` for the backend's
    /// `n`th automatic retry after a terminal infrastructure/catastrophic failure.
    pub attempt: i32,
    /// The account launching the run, or `None` when it is not known (which is how
    /// every row enqueued before attribution existed reads). A retry carries the
    /// original launcher, not whoever the retry ran as — the run is still theirs.
    pub user_id: Option<String>,
    /// What is launching the run, or `None` for a launch by hand. See [`JobOrigin`];
    /// this is what a scoped halt cancels by.
    pub origin: Option<JobOrigin>,
    /// RFC 3339 of enqueue (also the initial update time). The queue's ordering key
    /// is [`job::Model::queue_seq`], minted at insert — not this.
    pub created_at: String,
}

/// The queue position to mint for the next job enqueued: one past the highest ever
/// handed out. Read inside the enqueue's own transaction, so a committed enqueue's
/// positions are never reused and a batch's block of positions stays contiguous.
///
/// Deriving it from the table rather than a database sequence keeps the store
/// portable across SQLite and Postgres, which is the same reason the schema is built
/// from SeaORM's portable builder. Two enqueues that genuinely race on Postgres can
/// read the same maximum and tie; the claim's `created_at`-then-`id` tiebreakers make
/// that deterministic, and it only ever mis-orders the two racing submissions against
/// each other — never a batch's runs among themselves, which is what this fixes.
async fn next_queue_seq(txn: &DatabaseTransaction) -> Result<i64> {
    let highest: Option<i64> = job::Entity::find()
        .select_only()
        .column_as(job::Column::QueueSeq.max(), "highest")
        .into_tuple::<Option<i64>>()
        .one(txn)
        .await?
        .flatten();
    Ok(highest.unwrap_or(0) + 1)
}

/// Build the `queued` `job` row for a run to enqueue, at queue position `queue_seq`.
/// Shared by the single ([`Db::enqueue_job`]) and batch ([`Db::enqueue_jobs`]) insert
/// paths so a job is materialized identically however it was submitted.
fn new_job_model(new: NewJob, queue_seq: i64) -> job::ActiveModel {
    job::ActiveModel {
        id: Set(new.id),
        queue_seq: Set(queue_seq),
        state: Set("queued".to_string()),
        request_json: Set(new.request_json),
        test_case_slug: Set(new.test_case_slug),
        test_case_version: Set(new.test_case_version),
        variant: Set(new.variant),
        test_type: Set(new.test_type),
        harness_slug: Set(new.harness_slug),
        model_id: Set(new.model_id),
        engine_slug: Set(new.engine_slug),
        gg_config_json: Set(new.gg_config_json),
        gg_preset: Set(new.gg_preset),
        gg_config_id: Set(new.gg_config_id),
        gg_models: Set(new.gg_models),
        job_token: Set(new.job_token),
        record_id: Set(None),
        detail: Set(None),
        attempt: Set(new.attempt),
        user_id: Set(new.user_id),
        origin: Set(new.origin.as_ref().map(JobOrigin::as_token)),
        created_at: Set(new.created_at.clone()),
        updated_at: Set(new.created_at),
        // A queued job has not started; the anchor is stamped by the transition into
        // `starting`, not by joining the queue.
        started_at: Set(None),
    }
}

/// A publish job to enqueue: the minted id and token, and the run it releases. The
/// publish path's analogue of [`NewJob`] — it references an existing run by id
/// rather than carrying a launch request.
pub struct NewPublishJob {
    /// The publish job id, minted by the backend at enqueue.
    pub id: String,
    /// The id of the (already pushed, reviewed) run to release.
    pub run_id: String,
    /// The per-job bearer token the publisher reports its result with.
    pub job_token: String,
    /// RFC 3339 of enqueue (the claim-ordering key, also the initial update time).
    pub created_at: String,
}

/// The run-queue operations on the store: enqueue, claim, advance, read. A job is
/// the lifecycle of a requested run; the produced [`RunRecord`] lands via
/// [`Db::push`] like any other.
impl Db {
    /// Enqueue a run: insert it in the `queued` state for the dispatcher to claim, at
    /// the back of the queue — it takes the next [`job::Model::queue_seq`].
    pub async fn enqueue_job(&self, new: NewJob) -> Result<()> {
        let txn = self.conn().begin().await?;
        let seq = next_queue_seq(&txn).await?;
        job::Entity::insert(new_job_model(new, seq))
            .exec(&txn)
            .await?;
        txn.commit().await?;
        Ok(())
    }

    /// Enqueue many runs, all in the `queued` state, in as few statements as
    /// possible — the batch analogue of [`Self::enqueue_job`] backing
    /// `POST /jobs/batch`. Rows are inserted in bounded chunks so a large fan-out
    /// (a whole coverage plan's missing runs) never exceeds the backing database's
    /// bind-parameter ceiling. An empty batch is a no-op.
    ///
    /// The batch takes a **contiguous run of queue positions in the order it was
    /// submitted**, so the dispatcher starts the runs in the order the console listed
    /// them: a console that fans a case out over its repeats before moving to the
    /// next case gets all of that case's repeats started first. The whole batch is
    /// one transaction, so it never interleaves with a concurrent enqueue's
    /// positions and a failed chunk leaves nothing behind.
    pub async fn enqueue_jobs(&self, jobs: Vec<NewJob>) -> Result<()> {
        if jobs.is_empty() {
            return Ok(());
        }
        // Each row binds ~18 columns; a 1000-row chunk is ~18k parameters, well
        // under both SQLite's (32766) and Postgres's (65535) per-statement limits.
        const CHUNK: usize = 1000;
        let txn = self.conn().begin().await?;
        let first = next_queue_seq(&txn).await?;
        for (chunk_index, chunk) in jobs.chunks(CHUNK).enumerate() {
            let base = first + (chunk_index * CHUNK) as i64;
            let models = chunk
                .iter()
                .cloned()
                .enumerate()
                .map(|(i, new)| new_job_model(new, base + i as i64));
            job::Entity::insert_many(models).exec(&txn).await?;
        }
        txn.commit().await?;
        Ok(())
    }

    /// Atomically claim the first claimable job in queue order, flipping it to
    /// `dispatched`, and return it (or `None` when nothing is claimable). Selection
    /// is FIFO across harnesses by [`job::Model::queue_seq`] — the position minted at
    /// enqueue — skipping any job held back. So a batch of repeated runs is
    /// dispatched in the order it was submitted, and a console that fans one case out
    /// over its repeats before moving to the next case gets all of the first case's
    /// runs started (and so finished) before the next case's. Enforces each harness's
    /// configured maximum parallelism: a job is claimable only when its harness has
    /// fewer than its limit of runs already occupying a parallelism slot
    /// (`ACTIVE_SLOT_STATES` — `dispatched`/`starting`/`running`). A harness with
    /// no configured limit is always claimable.
    ///
    /// It additionally **serializes a game jam per model**: a `game-jam` job is not
    /// claimable while another run of the same jam and model occupies a slot, no
    /// matter which harness either uses. A repeated jam run is briefed with the
    /// gameplay READMEs of that model's earlier entries so it builds something
    /// distinct, and those READMEs only exist once the earlier runs have finished —
    /// dispatching a model's jam runs in parallel would hand every one of them an
    /// empty history and invite the same game three times over. Runs of *different*
    /// jams, or of the same jam by different models, share no history and stay
    /// parallel.
    ///
    /// The same pass **reconciles the display state** of every non-selected waiting
    /// job: a `queued`/`pending` job that is held back — because its harness is at
    /// its cap, or because it is a jam run waiting its turn behind the same model's
    /// earlier entry — is moved to `pending` (visible as such), and one that is
    /// claimable again is released to `queued`. So an operator sees exactly which
    /// waiting runs are deliberately held versus merely next in line.
    ///
    /// The select-then-updates run in one transaction; SQLite serializes writers
    /// (single-writer WAL), so two dispatchers cannot claim the same job.
    /// Both halves of the pass are reported, because both are state changes a
    /// console is showing: the claim moves one run to `dispatched`, and the
    /// reconciliation moves any number of others between `queued` and `pending`.
    /// Returning only the claim would leave every held-back run's row stale until
    /// something else re-read the queue.
    pub async fn claim_next(&self, now: &str) -> Result<ClaimOutcome> {
        use std::collections::{HashMap, HashSet};

        let txn = self.conn().begin().await?;

        // The per-harness parallelism limits (harnesses with no configured limit are
        // absent → unlimited).
        let caps: HashMap<String, i32> = harness_config::Entity::find()
            .all(&txn)
            .await?
            .into_iter()
            .filter_map(|row| row.max_parallelism.map(|max| (row.harness_slug, max)))
            .collect();

        // How many runs of each harness already occupy a parallelism slot, and which
        // (jam, model) pairs are already running one — the pairs whose next entry
        // must wait, so it can be seeded with the finished run's README.
        let mut active_by_harness: HashMap<String, i64> = HashMap::new();
        let mut jams_in_flight: HashSet<(String, String)> = HashSet::new();
        for job in job::Entity::find()
            .filter(job::Column::State.is_in(ACTIVE_SLOT_STATES))
            .all(&txn)
            .await?
        {
            if job.test_type == TestType::GameJam.as_str() {
                jams_in_flight.insert((job.test_case_slug.clone(), job.model_id.clone()));
            }
            *active_by_harness.entry(job.harness_slug).or_insert(0) += 1;
        }

        // Is a harness under its configured cap right now, given `active` already in
        // flight? Absent from `caps` means unlimited.
        let under_cap = |harness: &str, active: i64| -> bool {
            caps.get(harness).is_none_or(|&max| active < i64::from(max))
        };

        // Walk the waiting jobs oldest-first: claim the first that is not held back,
        // and reconcile the pending/queued display state of the rest so a held-back
        // run reads as `pending` and a now-claimable one as `queued`.
        let waiting = job::Entity::find()
            .filter(job::Column::State.is_in(["queued", "pending"]))
            .order_by_asc(job::Column::QueueSeq)
            .order_by_asc(job::Column::CreatedAt)
            .order_by_asc(job::Column::Id)
            .all(&txn)
            .await?;

        let mut claimed: Option<job::Model> = None;
        let mut reconciled: Vec<job::Model> = Vec::new();
        for job in waiting {
            let active = active_by_harness
                .get(&job.harness_slug)
                .copied()
                .unwrap_or(0);
            let jam_key = (job.test_case_slug.clone(), job.model_id.clone());
            // A jam run waits its turn behind any in-flight run of the same jam by
            // the same model — including one claimed earlier in this very pass, so a
            // single sweep never dispatches two entries of the same pair.
            let jam_turn =
                job.test_type != TestType::GameJam.as_str() || !jams_in_flight.contains(&jam_key);
            let has_room = under_cap(&job.harness_slug, active) && jam_turn;

            if claimed.is_none() && has_room {
                // Claim this one: it now occupies a slot for its harness, so bump the
                // count for the reconcile of any later same-harness jobs, and (for a
                // jam) hold the jam+model pair against the entries behind it.
                *active_by_harness
                    .entry(job.harness_slug.clone())
                    .or_insert(0) += 1;
                if job.test_type == TestType::GameJam.as_str() {
                    jams_in_flight.insert(jam_key);
                }
                let mut active_model = job.into_active_model();
                active_model.state = Set("dispatched".to_string());
                active_model.updated_at = Set(now.to_string());
                claimed = Some(active_model.update(&txn).await?);
                continue;
            }

            // Not claimed: make its display state match whether its harness has room.
            // Only a job that actually moved is reported — the common case is a queue
            // whose display states are already correct, and re-announcing those every
            // claim pass would be pure noise on the console stream.
            let target = if has_room { "queued" } else { "pending" };
            if job.state != target {
                let mut active_model = job.into_active_model();
                active_model.state = Set(target.to_string());
                active_model.updated_at = Set(now.to_string());
                reconciled.push(active_model.update(&txn).await?);
            }
        }

        txn.commit().await?;
        Ok(ClaimOutcome {
            claimed,
            reconciled,
        })
    }

    /// Claim, reporting only what was claimed — the convenience form of
    /// [`Db::claim_next`] for callers that care which job was picked and not about
    /// the display states the same pass reconciled around it.
    pub async fn claim_next_job(&self, now: &str) -> Result<Option<job::Model>> {
        Ok(self.claim_next(now).await?.claimed)
    }

    /// Every stored per-harness config row (harnesses with no overrides are absent).
    pub async fn list_harness_configs(&self) -> Result<Vec<harness_config::Model>> {
        Ok(harness_config::Entity::find().all(&self.conn()).await?)
    }

    /// Set (or clear, with `None`) a harness's maximum parallelism, upserting its
    /// config row and stamping `updated_at`. A `None` limit means unlimited; the row
    /// is kept (carrying `NULL`) so the setting is explicit and auditable.
    pub async fn set_harness_max_parallelism(
        &self,
        harness_slug: &str,
        max_parallelism: Option<i32>,
        now: &str,
    ) -> Result<()> {
        harness_config::Entity::insert(harness_config::ActiveModel {
            harness_slug: Set(harness_slug.to_string()),
            max_parallelism: Set(max_parallelism),
            updated_at: Set(now.to_string()),
        })
        .on_conflict(
            OnConflict::column(harness_config::Column::HarnessSlug)
                .update_columns([
                    harness_config::Column::MaxParallelism,
                    harness_config::Column::UpdatedAt,
                ])
                .to_owned(),
        )
        .exec(&self.conn())
        .await?;
        Ok(())
    }

    /// Atomically cancel a job: move it to the terminal `canceled` state, stamping
    /// `updated_at` and the `detail` reason — but **only** from a non-terminal
    /// state (`queued`, `dispatched`, or `running`). Returns the updated row, or
    /// `None` when no such non-terminal job exists (an unknown id, or one that has
    /// already reached a terminal state). The select-then-update runs in one
    /// transaction; SQLite serializes writers, so a cancel cannot race a concurrent
    /// driver status update — whichever commits first wins, and the loser sees the
    /// terminal row and does nothing.
    pub async fn cancel_job(
        &self,
        id: &str,
        now: &str,
        detail: &str,
    ) -> Result<Option<job::Model>> {
        let txn = self.conn().begin().await?;
        let candidate = job::Entity::find_by_id(id.to_string())
            .filter(job::Column::State.is_in(IN_FLIGHT_STATES))
            .one(&txn)
            .await?;
        let Some(model) = candidate else {
            txn.commit().await?;
            return Ok(None);
        };
        let mut active = model.into_active_model();
        active.state = Set("canceled".to_string());
        active.updated_at = Set(now.to_string());
        active.detail = Set(Some(detail.to_string()));
        let updated = active.update(&txn).await?;
        txn.commit().await?;
        Ok(Some(updated))
    }

    /// Attach the produced `record_id` to an already-`canceled` job, leaving its
    /// state and cancellation `detail` alone. Returns the updated row, or `None`
    /// when the job is unknown or is not canceled.
    ///
    /// The one sanctioned write to a canceled job, and the reason it is not
    /// [`set_job_state`](Db::set_job_state): a killed gg run's driver winds the session
    /// down, builds the record for what it got, and posts it after the cancel landed.
    /// Without this the record would be discarded and the killed run would vanish from
    /// the run list. It cannot resurrect the job — `state` is never written — and an
    /// already-attached record is not overwritten, so a duplicate report from a
    /// winding-down driver is a no-op.
    ///
    /// A killed run of any other harness never reaches here: its driver destroys the run
    /// and posts no record, so the job stays canceled with nothing attached. Nor does a
    /// third-party run that reached its own ending before its driver noticed the kill:
    /// it posts an ordinary terminal status, which the canceled-job guard in
    /// `update_status` turns away before any record is attached.
    pub async fn attach_canceled_job_record(
        &self,
        id: &str,
        record_id: &str,
        now: &str,
    ) -> Result<Option<job::Model>> {
        let txn = self.conn().begin().await?;
        let candidate = job::Entity::find_by_id(id.to_string())
            .filter(job::Column::State.eq("canceled"))
            .filter(job::Column::RecordId.is_null())
            .one(&txn)
            .await?;
        let Some(model) = candidate else {
            txn.commit().await?;
            return Ok(None);
        };
        let mut active = model.into_active_model();
        active.record_id = Set(Some(record_id.to_string()));
        active.updated_at = Set(now.to_string());
        let updated = active.update(&txn).await?;
        txn.commit().await?;
        Ok(Some(updated))
    }

    /// Cancel every in-flight job matching `filter` in one statement, moving each to
    /// the terminal `canceled` state with `detail` as its reason, and return how many
    /// were cancelled.
    ///
    /// This backs both the scoped halts (a plan's or ladder's own waiting runs, via
    /// [`JobCancelFilter::origin`]) and the Runs page's global controls, which differ
    /// only in how the filter is built.
    ///
    /// The transition is exactly [`Self::cancel_job`]'s, deliberately reused rather
    /// than reimplemented: only a job still in an in-flight state moves, so one that
    /// reached a terminal state a moment ago is left alone and a driver's already-final
    /// report can never be overwritten. It is a single `UPDATE … WHERE`, so the set it
    /// sweeps is chosen atomically by the database rather than read-then-written a job
    /// at a time — a run that finishes mid-halt is either cancelled or finished, never
    /// both.
    ///
    /// The count is the point, not a nicety. A halt that reports nothing is the
    /// difference between "the queue was already empty" and "the origin filter is
    /// wrong", and the reviewer cannot tell those apart from a silent success.
    pub async fn cancel_jobs(
        &self,
        filter: &JobCancelFilter<'_>,
        now: &str,
        detail: &str,
    ) -> Result<u64> {
        // Narrow to the states a cancel may legally touch. Silently dropping the rest
        // (rather than erroring) means a caller can pass a state set without first
        // knowing which of them are terminal.
        let states: Vec<&str> = filter
            .states
            .iter()
            .copied()
            .filter(|state| IN_FLIGHT_STATES.contains(state))
            .collect();
        if states.is_empty() {
            return Ok(0);
        }
        let mut update = job::Entity::update_many()
            .col_expr(job::Column::State, Expr::value("canceled"))
            .col_expr(job::Column::UpdatedAt, Expr::value(now))
            .col_expr(job::Column::Detail, Expr::value(detail))
            .filter(job::Column::State.is_in(states));
        if let Some(origin) = filter.origin {
            update = update.filter(job::Column::Origin.eq(origin.as_token()));
        }
        if let Some(user_id) = filter.user_id {
            update = update.filter(job::Column::UserId.eq(user_id));
        }
        Ok(update.exec(&self.conn()).await?.rows_affected)
    }

    /// Advance a job to a new state, stamping `updated_at` and — when supplied —
    /// the terminal `detail` (a failure reason) and `record_id` (the produced
    /// run). Returns the updated row, or `None` when no job with `id` is stored.
    ///
    /// A job already in the terminal `canceled` state is left untouched (returning
    /// `None`): once an operator has canceled a run, a late `running`/`succeeded`/
    /// `failed` report from the still-winding-down driver must not resurrect or
    /// overwrite it.
    ///
    /// This is also where `started_at` is stamped, because it is the one choke point
    /// every job transition passes through. The anchor is the move into `starting`:
    /// the driver posts that as its very first act and *then* takes the `started_at`
    /// its produced record's `startedAt` is measured from, so the stamp and the record
    /// name the same moment. What a duration ticked from it does and does not carry is
    /// on [`test_cabinet_core::job_api::JobSummary::started_at`], which reports it to
    /// the console. `dispatched` would wrongly bill the run for pod scheduling and the
    /// image pull; `running` would wrongly omit setup, which is inside
    /// `run_time_seconds`. `running` is nonetheless a fallback anchor for a driver that
    /// never reported `starting`, since a running row with no start time is worse than
    /// a slightly late one.
    ///
    /// Stamped once and never rewritten — the later `running` report must not restart
    /// the clock — and never stamped for `queued`, `pending`, or `dispatched`, none of
    /// which is time the run spent working.
    pub async fn set_job_state(
        &self,
        id: &str,
        state: &str,
        now: &str,
        detail: Option<&str>,
        record_id: Option<&str>,
    ) -> Result<Option<job::Model>> {
        let Some(model) = job::Entity::find_by_id(id.to_string())
            .filter(job::Column::State.ne("canceled"))
            .one(&self.conn())
            .await?
        else {
            return Ok(None);
        };
        let unstarted = model.started_at.is_none();
        let mut active = model.into_active_model();
        active.state = Set(state.to_string());
        active.updated_at = Set(now.to_string());
        if unstarted && matches!(state, "starting" | "running") {
            active.started_at = Set(Some(now.to_string()));
        }
        if let Some(detail) = detail {
            active.detail = Set(Some(detail.to_string()));
        }
        if let Some(record_id) = record_id {
            active.record_id = Set(Some(record_id.to_string()));
        }
        Ok(Some(active.update(&self.conn()).await?))
    }

    /// Fetch one job by id.
    pub async fn get_job(&self, id: &str) -> Result<Option<job::Model>> {
        Ok(job::Entity::find_by_id(id.to_string())
            .one(&self.conn())
            .await?)
    }

    /// Fail every job mid-execution (`dispatched`, `starting`, or `running`) in one
    /// update, stamping `updated_at` and the supplied terminal `detail`. Returns how
    /// many were reaped.
    ///
    /// This is the single-box backend's startup reconciliation (see
    /// [`crate::build`]): when the whole stack shares one machine, a backend
    /// restart means every in-flight driver went down with it, so any job the
    /// store still believes is executing is orphaned — it can never reach a
    /// terminal state on its own and would otherwise show as forever "running".
    /// `queued` and `pending` jobs are deliberately left untouched: they have no
    /// driver yet, so the dispatcher drains them normally once it reconnects.
    pub async fn fail_in_flight_jobs(&self, now: &str, detail: &str) -> Result<u64> {
        let result = job::Entity::update_many()
            .col_expr(job::Column::State, Expr::value("failed"))
            .col_expr(job::Column::UpdatedAt, Expr::value(now))
            .col_expr(job::Column::Detail, Expr::value(detail))
            .filter(job::Column::State.is_in(REAPABLE_STATES))
            .exec(&self.conn())
            .await?;
        Ok(result.rows_affected)
    }

    /// Every job still in flight (`queued`, `pending`, `dispatched`, `starting`, or
    /// `running`), in queue order. This is the console's active-run list: a run it is
    /// watching survives a page reload because the backend remembers it — including
    /// one held back (`pending`) or spinning up (`starting`). Ordering it by queue
    /// position rather than enqueue time means the list reads in the order the runs
    /// will actually start, which for a batch of repeats is the order they were
    /// requested in.
    pub async fn active_jobs(&self) -> Result<Vec<job::Model>> {
        Ok(job::Entity::find()
            .filter(job::Column::State.is_in(IN_FLIGHT_STATES))
            .order_by_asc(job::Column::QueueSeq)
            .order_by_asc(job::Column::CreatedAt)
            .order_by_asc(job::Column::Id)
            .all(&self.conn())
            .await?)
    }
}

/// The **publish-queue** operations on the store: the parallel, smaller queue that
/// turns a `POST /runs/{id}/publish` into a per-publish Kubernetes Job. It mirrors
/// the run queue above — enqueue, claim, advance, read — but a publish job
/// references an existing run rather than carrying a launch request, and its
/// terminal success records the links the gh/wrangler release produced and flips
/// the run published in one transaction ([`Db::complete_publish_job`]).
impl Db {
    /// The publish gate, with no flip: refuse a run that can never be published
    /// (an infrastructure failure, or a completed run with no review yet). Called
    /// at enqueue so the user is rejected immediately rather than after a publish
    /// Job spins up and fails. Loads the run (404 if missing) and applies the same
    /// gate [`Db::publish`] does.
    pub async fn ensure_publishable(&self, run_id: &str) -> Result<()> {
        let run = run::Entity::find_by_id(run_id.to_string())
            .one(&self.conn())
            .await?
            .ok_or_else(|| {
                crate::error::BackendError::NotFound(format!("run `{run_id}` not found"))
            })?;
        gate_publishable(
            &self.conn(),
            run_id,
            &run.run_state,
            run.validator_rated,
            false,
        )
        .await
    }

    /// Gate a run for publishing **as a comparison arm run**: the same checks as
    /// [`Self::ensure_publishable`], but the review requirement is waived for a run
    /// that carries automated validation verdicts (a comparison scores its runs by
    /// machine, not by a human reviewer). An infrastructure failure, or a review-less
    /// run with no automated verdicts, is still refused.
    pub async fn ensure_publishable_comparison_run(&self, run_id: &str) -> Result<()> {
        let run = run::Entity::find_by_id(run_id.to_string())
            .one(&self.conn())
            .await?
            .ok_or_else(|| {
                crate::error::BackendError::NotFound(format!("run `{run_id}` not found"))
            })?;
        gate_publishable(
            &self.conn(),
            run_id,
            &run.run_state,
            run.validator_rated,
            true,
        )
        .await
    }

    /// The publish job already releasing `run_id` — one that is `queued`, or
    /// `dispatched` recently enough that its publisher may still be running — or
    /// `None` when the run has no release under way.
    ///
    /// This is the enqueue-time idempotency check: `POST /runs/{id}/publish` answers
    /// with the job this finds instead of inserting a second one, so a double-click,
    /// a second console tab, or a retry after a dropped live stream re-attaches to
    /// the publish already running rather than starting another. That matters
    /// because each publish job deploys a *new* Cloudflare Pages deployment, so a
    /// duplicate leaves an orphaned public build behind.
    ///
    /// Terminal (`succeeded`/`failed`) jobs never block — a failed publish must stay
    /// retryable — and neither does a `dispatched` job gone quiet long enough to be
    /// treated as abandoned, since nothing reaps one whose publisher died before
    /// reporting. `now` is the RFC 3339 instant that staleness is measured against.
    /// The oldest still-live job wins, so the caller re-attaches to the publish that
    /// started first.
    pub async fn active_publish_job_for_run(
        &self,
        run_id: &str,
        now: &str,
    ) -> Result<Option<publish_job::Model>> {
        let candidates = publish_job::Entity::find()
            .filter(publish_job::Column::RunId.eq(run_id))
            .filter(publish_job::Column::State.is_in(ACTIVE_PUBLISH_STATES))
            .order_by_asc(publish_job::Column::CreatedAt)
            .order_by_asc(publish_job::Column::Id)
            .all(&self.conn())
            .await?;

        Ok(candidates
            .into_iter()
            .find(|job| !is_abandoned_publish_job(job, now)))
    }

    /// Enqueue a publish job: insert it in the `queued` state for the dispatcher to
    /// claim. Mirrors [`Db::enqueue_job`] for the publish path.
    ///
    /// Callers gate with [`Db::active_publish_job_for_run`] first; a partial unique
    /// index on `run_id` (where the state is `queued`) backs that check in the
    /// database, so two concurrent enqueues cannot both land a queued job for the
    /// same run even if they race past the application-level check.
    pub async fn enqueue_publish_job(&self, new: NewPublishJob) -> Result<()> {
        publish_job::Entity::insert(publish_job::ActiveModel {
            id: Set(new.id),
            state: Set("queued".to_string()),
            run_id: Set(new.run_id),
            job_token: Set(new.job_token),
            source_repo: Set(None),
            playable_build: Set(None),
            detail: Set(None),
            created_at: Set(new.created_at.clone()),
            updated_at: Set(new.created_at),
        })
        .exec(&self.conn())
        .await?;
        Ok(())
    }

    /// Atomically claim the oldest `queued` publish job, flipping it to
    /// `dispatched`, and return it (or `None` when the queue is empty). The
    /// select-then-update runs in one transaction, exactly like
    /// [`Db::claim_next_job`], so two dispatchers cannot claim the same publish job.
    pub async fn claim_next_publish_job(&self, now: &str) -> Result<Option<publish_job::Model>> {
        let txn = self.conn().begin().await?;
        let candidate = publish_job::Entity::find()
            .filter(publish_job::Column::State.eq("queued"))
            .order_by_asc(publish_job::Column::CreatedAt)
            .order_by_asc(publish_job::Column::Id)
            .one(&txn)
            .await?;
        let Some(model) = candidate else {
            txn.commit().await?;
            return Ok(None);
        };
        let mut active = model.into_active_model();
        active.state = Set("dispatched".to_string());
        active.updated_at = Set(now.to_string());
        let updated = active.update(&txn).await?;
        txn.commit().await?;
        Ok(Some(updated))
    }

    /// Fetch one publish job by id.
    pub async fn get_publish_job(&self, id: &str) -> Result<Option<publish_job::Model>> {
        Ok(publish_job::Entity::find_by_id(id.to_string())
            .one(&self.conn())
            .await?)
    }

    /// Advance a publish job to a new state, stamping `updated_at` and — when
    /// supplied — the terminal `detail` (a failure reason). The failure path; the
    /// success path goes through [`Db::complete_publish_job`], which also records
    /// the links and flips the run. Returns the updated row, or `None` when no
    /// publish job with `id` is stored.
    pub async fn set_publish_job_state(
        &self,
        id: &str,
        state: &str,
        now: &str,
        detail: Option<&str>,
    ) -> Result<Option<publish_job::Model>> {
        let Some(model) = publish_job::Entity::find_by_id(id.to_string())
            .one(&self.conn())
            .await?
        else {
            return Ok(None);
        };
        let mut active = model.into_active_model();
        active.state = Set(state.to_string());
        active.updated_at = Set(now.to_string());
        if let Some(detail) = detail {
            active.detail = Set(Some(detail.to_string()));
        }
        Ok(Some(active.update(&self.conn()).await?))
    }

    /// Finalize a **succeeded** publish: in one transaction, attach the links the
    /// release produced to the run, flip it published, mark the snapshot dirty, and
    /// mark the publish job `succeeded` with the same links. This is the publish
    /// path's terminal write — the analogue of [`Db::publish`] but driven by the
    /// publisher's reported result rather than a synchronous flip, and it also
    /// records the links (which `publish` does not, since the legacy path's links
    /// arrive via `push`).
    ///
    /// Patches both the `run_link` sibling row and the `run.record_json` blob's
    /// `links` so the two never disagree (exactly as [`Db::push`] keeps them in
    /// sync). Preserves an existing `published_at` on a re-publish, like
    /// [`Db::publish`]. `404` when the run is missing.
    pub async fn complete_publish_job(
        &self,
        publish_job_id: &str,
        run_id: &str,
        source_repo: Option<&str>,
        playable_build: Option<&str>,
        now: &str,
    ) -> Result<PublishRunOutcome> {
        let txn = self.conn().begin().await?;

        let run = run::Entity::find_by_id(run_id.to_string())
            .one(&txn)
            .await?
            .ok_or_else(|| {
                crate::error::BackendError::NotFound(format!("run `{run_id}` not found"))
            })?;

        let newly_published = !run.published;
        let effective_published_at = run.published_at.clone().unwrap_or_else(|| now.to_string());

        // Patch the record blob's links so the verbatim JSON and the `run_link`
        // sibling agree — the same invariant `push` maintains.
        let mut record: RunRecord = serde_json::from_str(&run.record_json)?;
        record.links = RunLinks {
            source_repo: source_repo.map(|s| s.to_string()),
            playable_build: playable_build.map(|s| s.to_string()),
        };
        let record_json = serde_json::to_string(&record)?;

        let mut active = run.into_active_model();
        active.published = Set(true);
        active.published_at = Set(Some(effective_published_at));
        active.record_json = Set(record_json);
        active.update(&txn).await?;

        touch_run(&txn, run_id).await?;

        // Upsert the links sibling, exactly like `push`.
        run_link::Entity::insert(run_link::ActiveModel {
            run_id: Set(run_id.to_string()),
            source_repo: Set(source_repo.map(|s| s.to_string())),
            playable_build: Set(playable_build.map(|s| s.to_string())),
        })
        .on_conflict(
            OnConflict::column(run_link::Column::RunId)
                .update_columns([
                    run_link::Column::SourceRepo,
                    run_link::Column::PlayableBuild,
                ])
                .to_owned(),
        )
        .exec(&txn)
        .await?;

        set_dirty(&txn).await?;

        // Mark the publish job succeeded with the links it produced.
        let Some(job_model) = publish_job::Entity::find_by_id(publish_job_id.to_string())
            .one(&txn)
            .await?
        else {
            return Err(crate::error::BackendError::NotFound(format!(
                "publish job `{publish_job_id}` not found"
            )));
        };
        let mut job_active = job_model.into_active_model();
        job_active.state = Set("succeeded".to_string());
        job_active.source_repo = Set(source_repo.map(|s| s.to_string()));
        job_active.playable_build = Set(playable_build.map(|s| s.to_string()));
        job_active.updated_at = Set(now.to_string());
        job_active.update(&txn).await?;

        txn.commit().await?;
        Ok(PublishRunOutcome { newly_published })
    }
}

/// One canonical model id a curated model claims, with the harness family it is
/// usable with. The `alias` string is globally unique across all models; the
/// `family` tags which harnesses can launch it (see [`HarnessFamily`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AliasEntry {
    /// The canonical model id (globally unique).
    pub alias: String,
    /// The harness family this slug is usable with.
    pub family: HarnessFamily,
}

/// A curated model configuration and the canonical run-record ids it covers.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredModel {
    /// The curated `model` row.
    pub config: model::Model,
    /// The canonical model ids this config claims, each with its harness family,
    /// sorted by id.
    pub aliases: Vec<AliasEntry>,
}

/// The write payload for [`Db::upsert_model_config`].
#[derive(Debug, Clone)]
pub struct ModelConfigWrite {
    pub slug: String,
    pub display_name: String,
    pub provider: String,
    pub provider_logo_url: Option<String>,
    pub provider_logo_svg: Option<String>,
    pub description_md: Option<String>,
    pub openrouter_slug: Option<String>,
    /// The canonical model ids this config claims, each with its harness family
    /// (at least one).
    pub aliases: Vec<AliasEntry>,
    /// RFC 3339 timestamp for the created/updated stamp.
    pub now: String,
}

/// One price observation to append to a model's history.
#[derive(Debug, Clone)]
pub struct PriceWrite {
    pub model_id: String,
    pub observed_at: String,
    pub uncached_input: Option<f64>,
    pub cached_input: Option<f64>,
    pub output: Option<f64>,
    pub context_length: Option<i64>,
    pub released_at: Option<String>,
    /// The accepted input modalities as a comma-separated lowercase list, or
    /// `None` when OpenRouter reported none (unknown, not "text only").
    pub input_modalities: Option<String>,
}

/// Project a stored `model_alias` row into an [`AliasEntry`], parsing its
/// `harness_family` wire slug and falling back to [`HarnessFamily::Openrouter`]
/// for an unrecognized value (the migration default, and the harmless choice for
/// a slug the current build does not know a family for).
fn alias_entry(row: model_alias::Model) -> AliasEntry {
    let family = HarnessFamily::from_wire(&row.harness_family).unwrap_or(HarnessFamily::Openrouter);
    AliasEntry {
        alias: row.alias,
        family,
    }
}

/// The model catalog store: curated config, its aliases, and observed prices.
impl Db {
    /// Every curated model config with its aliases, ordered by slug.
    pub async fn list_model_configs(&self) -> Result<Vec<StoredModel>> {
        let configs = model::Entity::find()
            .order_by_asc(model::Column::Slug)
            .all(&self.conn())
            .await?;
        let mut alias_map: std::collections::HashMap<String, Vec<AliasEntry>> =
            std::collections::HashMap::new();
        for alias in model_alias::Entity::find().all(&self.conn()).await? {
            let model_slug = alias.model_slug.clone();
            alias_map
                .entry(model_slug)
                .or_default()
                .push(alias_entry(alias));
        }
        Ok(configs
            .into_iter()
            .map(|config| {
                let mut aliases = alias_map.remove(&config.slug).unwrap_or_default();
                aliases.sort_by(|a, b| a.alias.cmp(&b.alias));
                StoredModel { config, aliases }
            })
            .collect())
    }

    /// A single curated model config with its aliases, or `None`.
    pub async fn get_model_config(&self, slug: &str) -> Result<Option<StoredModel>> {
        let Some(config) = model::Entity::find_by_id(slug).one(&self.conn()).await? else {
            return Ok(None);
        };
        let mut aliases: Vec<AliasEntry> = model_alias::Entity::find()
            .filter(model_alias::Column::ModelSlug.eq(slug))
            .all(&self.conn())
            .await?
            .into_iter()
            .map(alias_entry)
            .collect();
        aliases.sort_by(|a, b| a.alias.cmp(&b.alias));
        Ok(Some(StoredModel { config, aliases }))
    }

    /// Create or update a curated model config and replace its alias set, in one
    /// transaction. On update the original `created_at` is preserved. Returns a
    /// [`BackendError::Conflict`] when any
    /// alias is already claimed by a *different* curated model.
    pub async fn upsert_model_config(&self, write: ModelConfigWrite) -> Result<()> {
        let txn = self.conn().begin().await?;

        // Reject an alias that another curated model already owns (the alias
        // column is globally unique; catch it before the constraint fires so the
        // caller gets a clean 409 naming the offending id).
        for entry in &write.aliases {
            if let Some(existing) = model_alias::Entity::find()
                .filter(model_alias::Column::Alias.eq(entry.alias.clone()))
                .one(&txn)
                .await?
                && existing.model_slug != write.slug
            {
                return Err(crate::error::BackendError::Conflict(format!(
                    "model id `{}` is already claimed by model `{}`",
                    entry.alias, existing.model_slug
                )));
            }
        }

        let existing = model::Entity::find_by_id(&write.slug).one(&txn).await?;
        let created_at = existing
            .as_ref()
            .map(|m| m.created_at.clone())
            .unwrap_or_else(|| write.now.clone());
        let active = model::ActiveModel {
            slug: Set(write.slug.clone()),
            display_name: Set(write.display_name),
            provider: Set(write.provider),
            provider_logo_url: Set(write.provider_logo_url),
            provider_logo_svg: Set(write.provider_logo_svg),
            description_md: Set(write.description_md),
            openrouter_slug: Set(write.openrouter_slug),
            created_at: Set(created_at),
            updated_at: Set(write.now),
        };
        model::Entity::insert(active)
            .on_conflict(
                OnConflict::column(model::Column::Slug)
                    .update_columns([
                        model::Column::DisplayName,
                        model::Column::Provider,
                        model::Column::ProviderLogoUrl,
                        model::Column::ProviderLogoSvg,
                        model::Column::DescriptionMd,
                        model::Column::OpenrouterSlug,
                        model::Column::UpdatedAt,
                    ])
                    .to_owned(),
            )
            .exec(&txn)
            .await?;

        // Replace the alias set wholesale.
        model_alias::Entity::delete_many()
            .filter(model_alias::Column::ModelSlug.eq(write.slug.clone()))
            .exec(&txn)
            .await?;
        for entry in write.aliases {
            model_alias::Entity::insert(model_alias::ActiveModel {
                id: Set(cuid2::create_id()),
                model_slug: Set(write.slug.clone()),
                alias: Set(entry.alias),
                harness_family: Set(entry.family.as_str().to_string()),
            })
            .exec(&txn)
            .await?;
        }

        txn.commit().await?;
        Ok(())
    }

    /// Delete a curated model config (its aliases cascade). Returns whether a row
    /// was removed. The model's runs and price history are untouched, so it may
    /// reappear as a derived (uncurated) catalog entry.
    pub async fn delete_model_config(&self, slug: &str) -> Result<bool> {
        let deleted = model::Entity::delete_by_id(slug).exec(&self.conn()).await?;
        Ok(deleted.rows_affected > 0)
    }

    /// The distinct `(model_id, harness_slug)` pairs across **all** stored runs.
    /// The catalog derives a model per canonical id from these.
    pub async fn distinct_run_models(&self) -> Result<Vec<(String, String)>> {
        Ok(run::Entity::find()
            .select_only()
            .column(run::Column::ModelId)
            .column(run::Column::HarnessSlug)
            .distinct()
            .into_tuple()
            .all(&self.conn())
            .await?)
    }

    /// The distinct `(model_id, harness_slug)` pairs across **published** runs
    /// only — the derived set the public snapshot may show.
    pub async fn distinct_published_run_models(&self) -> Result<Vec<(String, String)>> {
        Ok(run::Entity::find()
            .select_only()
            .column(run::Column::ModelId)
            .column(run::Column::HarnessSlug)
            .filter(run::Column::Published.eq(true))
            .distinct()
            .into_tuple()
            .all(&self.conn())
            .await?)
    }

    /// The most recent price observation for a canonical model id, or `None`.
    pub async fn latest_price(&self, model_id: &str) -> Result<Option<model_price::Model>> {
        Ok(model_price::Entity::find()
            .filter(model_price::Column::ModelId.eq(model_id))
            .order_by_desc(model_price::Column::ObservedAt)
            .order_by_desc(model_price::Column::Id)
            .one(&self.conn())
            .await?)
    }

    /// Append a price observation to a model's history.
    pub async fn insert_price_observation(&self, write: PriceWrite) -> Result<()> {
        model_price::Entity::insert(model_price::ActiveModel {
            id: NotSet,
            model_id: Set(write.model_id),
            observed_at: Set(write.observed_at),
            uncached_input: Set(write.uncached_input),
            cached_input: Set(write.cached_input),
            output: Set(write.output),
            context_length: Set(write.context_length),
            released_at: Set(write.released_at),
            input_modalities: Set(write.input_modalities),
        })
        .exec(&self.conn())
        .await?;
        Ok(())
    }

    /// Every price observation, ascending by `(model_id, observed_at)`. The
    /// catalog groups these into per-model histories.
    pub async fn all_model_prices(&self) -> Result<Vec<model_price::Model>> {
        Ok(model_price::Entity::find()
            .order_by_asc(model_price::Column::ModelId)
            .order_by_asc(model_price::Column::ObservedAt)
            .order_by_asc(model_price::Column::Id)
            .all(&self.conn())
            .await?)
    }

    /// The curated `openrouter_slug` of the model that claims `alias`, if any. Used
    /// to price a run's model against its configured OpenRouter slug rather than a
    /// slug guessed from the run's model id.
    pub async fn openrouter_slug_for_alias(&self, alias: &str) -> Result<Option<String>> {
        let Some(row) = model_alias::Entity::find()
            .filter(model_alias::Column::Alias.eq(alias))
            .one(&self.conn())
            .await?
        else {
            return Ok(None);
        };
        Ok(model::Entity::find_by_id(row.model_slug)
            .one(&self.conn())
            .await?
            .and_then(|m| m.openrouter_slug))
    }

    /// Every `(id, alias, harness_family)` triple across all curated models. Used
    /// by the startup backfill that corrects the harness family of aliases created
    /// before the `harness_family` column existed.
    pub async fn all_alias_families(&self) -> Result<Vec<(String, String, HarnessFamily)>> {
        Ok(model_alias::Entity::find()
            .all(&self.conn())
            .await?
            .into_iter()
            .map(|row| {
                let family = HarnessFamily::from_wire(&row.harness_family)
                    .unwrap_or(HarnessFamily::Openrouter);
                (row.id, row.alias, family)
            })
            .collect())
    }

    /// Set the harness family of a single alias row by its id. Used by the startup
    /// backfill; a no-op set costs nothing because the caller only writes rows whose
    /// family actually changed.
    pub async fn set_alias_family(&self, id: &str, family: HarnessFamily) -> Result<()> {
        model_alias::ActiveModel {
            id: Set(id.to_string()),
            harness_family: Set(family.as_str().to_string()),
            ..Default::default()
        }
        .update(&self.conn())
        .await?;
        Ok(())
    }

    /// Whether any stored run is a candidate for `:free` normalization — an
    /// OpenRouter-accessed harness whose model id carries a trailing `:tag`. Used
    /// to skip the OpenRouter price fetch entirely at startup when there is nothing
    /// to re-price (the common case), so a boot with no such runs costs no network.
    pub async fn has_free_tag_candidates(&self) -> Result<bool> {
        let rows: Vec<(String, String)> = run::Entity::find()
            .select_only()
            .column(run::Column::ModelId)
            .column(run::Column::HarnessSlug)
            .filter(run::Column::ModelId.contains(":"))
            .into_tuple()
            .all(&self.conn())
            .await?;
        Ok(rows.iter().any(|(model_id, harness_slug)| {
            parse_harness_slug(harness_slug).routes_through_openrouter() && model_id.contains(':')
        }))
    }

    /// Re-associate `:free`-style runs to their base model: for every run driven by
    /// an OpenRouter-accessed harness whose model id carries a trailing `:tag`,
    /// strip the tag from the lifted `model_id` column and the record's
    /// `subject.modelId`, and recompute the run's comparable cost at the base
    /// model's price (from `base_prices`, keyed by OpenRouter id). A run whose base
    /// price is unavailable has its cost set to unknown rather than left at the
    /// misleading `$0.00` a free tag produces. Idempotent (an already-stripped run
    /// is unchanged) and best-effort per row. Returns how many runs were rewritten.
    ///
    /// Only rows whose `model_id` actually carries a `:` are loaded — the same
    /// predicate [`Self::has_free_tag_candidates`] gates on. A `:`-free model id can
    /// never be rewritten here, and pulling every run's `record_json` off disk to
    /// discover that made a startup backfill cost the whole run corpus for what is
    /// almost always zero work.
    pub async fn normalize_free_model_ids(
        &self,
        base_prices: &std::collections::HashMap<String, TokenPrices>,
    ) -> Result<usize> {
        let rows = run::Entity::find()
            .filter(run::Column::ModelId.contains(":"))
            .all(&self.conn())
            .await?;
        let mut rewritten = 0usize;
        for row in rows {
            let harness = parse_harness_slug(&row.harness_slug);
            if !harness.routes_through_openrouter() {
                continue;
            }
            let Some((base, _tag)) = row.model_id.rsplit_once(':') else {
                continue;
            };
            let base = base.to_string();
            // Deserialize the record; a legacy record that no longer matches the
            // schema is skipped rather than corrupted.
            let Ok(mut record) = serde_json::from_str::<RunRecord>(&row.record_json) else {
                continue;
            };
            record.subject.model_id = base.clone();
            let lookup = test_cabinet_core::model_id::openrouter_price_id(&base, harness);
            let comparable = base_prices
                .get(&lookup)
                .and_then(|prices| Cost::comparable_from(&record.metrics.tokens, prices));
            record.metrics.cost = Cost {
                comparable,
                actual: comparable,
            };
            let record_json = serde_json::to_string(&record)?;

            let id = row.id.clone();
            let mut active = row.into_active_model();
            active.model_id = Set(base);
            // Keep the lifted cost column in step with the record's recomputed cost.
            active.cost_comparable = Set(comparable);
            active.record_json = Set(record_json);
            active.update(&self.conn()).await?;
            touch_run(&self.conn(), &id).await?;
            rewritten += 1;
        }
        Ok(rewritten)
    }

    /// Backfill the sort/filter columns lifted onto the `run` row after rows
    /// already existed (`test_type`, `run_time_seconds`, `total_tokens`,
    /// `cost_comparable`, `rating`, `review_count`, `gg_preset`, `gg_config_id`,
    /// `gg_models`): parse each
    /// un-backfilled row's record for the record-derived columns and compute
    /// `rating` / `review_count` from its reviews.
    ///
    /// Idempotent: a row is "un-backfilled" iff its `test_type` is still the empty
    /// string the migration's default stamped — a value no real run carries, since
    /// every write sets a kebab-case token. A second boot (or a store whose rows
    /// were all written with the columns already populated) therefore does no work.
    ///
    /// That candidate rule is also why this is **not** what fills a gg row's cell identity: a
    /// gg run has always carried a `test_type`, so no gg row is ever a candidate here. The
    /// gg columns are filled for those rows by [`Self::backfill_gg_models`] and
    /// [`Self::backfill_gg_config_id`] instead; they are written here as well only so a row
    /// this pass does claim is left complete.
    /// Best-effort per row: a legacy record that no longer deserializes is left for
    /// a later boot (exactly as [`Self::normalize_free_model_ids`] and
    /// `assemble` tolerate such rows). Returns how many rows were filled.
    pub async fn backfill_sort_columns(&self) -> Result<usize> {
        let rows = run::Entity::find()
            .filter(run::Column::TestType.eq(""))
            .all(&self.conn())
            .await?;
        if rows.is_empty() {
            return Ok(0);
        }

        // Group the candidate rows' reviews by run id in one query.
        let ids: Vec<String> = rows.iter().map(|row| row.id.clone()).collect();
        let mut review_map: std::collections::HashMap<String, Vec<StoredReview>> =
            std::collections::HashMap::new();
        let reviews = review::Entity::find()
            .filter(review::Column::RunId.is_in(ids))
            .all(&self.conn())
            .await?;
        for review in reviews {
            let run_id = review.run_id.clone();
            review_map
                .entry(run_id)
                .or_default()
                .push(stored_review(review)?);
        }

        let mut backfilled = 0usize;
        for row in rows {
            let Ok(record) = serde_json::from_str::<RunRecord>(&row.record_json) else {
                continue;
            };
            let lifted = lifted_run_metrics(&record);
            let reviews = review_map.get(&row.id).map(Vec::as_slice).unwrap_or(&[]);
            // Rows this backfill fills predate validator-rated versions, so the
            // legacy review aggregate is the right rating for every one of them.
            let rating = lifted_rating(None, &record, reviews);
            let aesthetic = lifted_aesthetic(reviews);
            let review_count = reviews.len() as i64;

            let id = row.id.clone();
            let mut active = row.into_active_model();
            active.test_type = Set(lifted.test_type);
            active.run_time_seconds = Set(lifted.run_time_seconds);
            active.total_tokens = Set(lifted.total_tokens);
            active.cost_comparable = Set(lifted.cost_comparable);
            active.code_analyzer_version = Set(lifted.code_analyzer_version);
            active.rating = Set(rating);
            active.aesthetic = Set(aesthetic);
            active.review_count = Set(review_count);
            active.gg_preset = Set(lifted.gg_preset);
            active.gg_config_id = Set(lifted.gg_config_id);
            active.gg_models = Set(lifted.gg_models);
            active.update(&self.conn()).await?;
            touch_run(&self.conn(), &id).await?;
            backfilled += 1;
        }
        Ok(backfilled)
    }

    /// Backfill the lifted `code_analyzer_version` column for runs whose record already
    /// carries a code analysis but which were stored before the column existed.
    ///
    /// **This does not analyse anything.** There is no backfill of the analysis itself,
    /// deliberately: a historical run's tree can only be re-read in its archived,
    /// post-validation state — carrying build output, a rewritten lockfile and toolchain
    /// caches — and those are not the figures a fresh run reports. Stamping them into the
    /// same corpus would create exactly the silent incomparability the version column
    /// exists to prevent. So the corpus starts at ship day and this routine only lifts a
    /// number that is *already in the record blob* into a column that can be queried.
    ///
    /// Scoped to rows that are still `NULL` **and whose record blob actually mentions an
    /// analysis**, so the candidate set settles to empty.
    ///
    /// The second filter is what makes the difference, and it is not an optimization of
    /// degree. A `NULL` here is ambiguous — "not yet lifted" or "carries no analysis" —
    /// and the analysis-less half is *every run recorded before the analyzer shipped*,
    /// which is the whole historical corpus and grows without bound. Selecting on the
    /// column alone would therefore fetch and `serde_json`-parse every one of them, at
    /// tens of kilobytes of `record_json` apiece, on every boot, before the router is
    /// built — an unbounded startup cost in a service whose availability incidents have
    /// been single-replica ones. `codeAnalysis` is
    /// [omitted from the blob when absent](test_cabinet_core::run_record::RunRecord::code_analysis),
    /// so the substring is a sound over-approximation of "has an analysis": it can only
    /// fail toward including a row, never toward skipping one that needed the lift. A
    /// spurious match — the string occurring somewhere else in the record — parses, finds
    /// nothing to lift and stays `NULL`: a harmless no-write residue. The same pushdown
    /// [`Self::has_free_tag_candidates`] uses to keep a boot's price fetch off the wire.
    ///
    /// Best-effort per row: a record that no longer deserializes is left for a later
    /// boot. Returns how many rows were filled.
    pub async fn backfill_code_analyzer_version(&self) -> Result<usize> {
        let rows = run::Entity::find()
            .filter(run::Column::CodeAnalyzerVersion.is_null())
            .filter(run::Column::RecordJson.contains("\"codeAnalysis\""))
            .all(&self.conn())
            .await?;

        let mut backfilled = 0usize;
        for row in rows {
            let Ok(record) = serde_json::from_str::<RunRecord>(&row.record_json) else {
                continue;
            };
            let Some(version) = lifted_code_analyzer_version(&record) else {
                continue;
            };
            let id = row.id.clone();
            let mut active = row.into_active_model();
            active.code_analyzer_version = Set(Some(version));
            active.update(&self.conn()).await?;
            touch_run(&self.conn(), &id).await?;
            backfilled += 1;
        }
        Ok(backfilled)
    }

    /// Backfill the lifted `engine_slug` column for rows stored before the column
    /// existed: parse each `NULL` row's record and lift `record.subject.engine_slug`
    /// into the column — `none` included, since the engineless run is a real value
    /// the engine filter matches on, not an absence.
    ///
    /// Unlike [`Self::backfill_code_analyzer_version`], no record-blob pushdown is
    /// needed for the candidate set to settle: every readable record carries a slug
    /// (a pre-engine-era record deserializes to the default `none`), so one
    /// successful pass leaves `NULL` only on rows whose record no longer
    /// deserializes — a bounded residue, not the whole historical corpus.
    ///
    /// Best-effort per row: a record that no longer deserializes is left for a later
    /// boot (and is the reason the engine filter treats `NULL` as unknown). Returns
    /// how many rows were filled.
    ///
    /// The pass is paged by an `id` cursor because its first boot visits the ENTIRE
    /// historical corpus — every pre-migration row is `NULL` — and each row carries
    /// its multi-KB record (and event) blobs; one unpaged `.all()` would materialize
    /// all of it in memory before the router is even built, on the single-replica
    /// coordinator. An `id` cursor rather than offset paging (or re-querying the
    /// first N `NULL`s) is load-bearing twice over: filled rows leave the `NULL`
    /// predicate mid-pass, which would shift offset pages, and undeserializable rows
    /// stay `NULL`, which would pin a "first N" loop in place forever.
    pub async fn backfill_engine_slug(&self) -> Result<usize> {
        const BATCH: u64 = 256;
        let mut backfilled = 0usize;
        let mut cursor: Option<String> = None;
        loop {
            let mut query = run::Entity::find().filter(run::Column::EngineSlug.is_null());
            if let Some(after) = cursor.as_deref() {
                query = query.filter(run::Column::Id.gt(after));
            }
            let rows = query
                .order_by_asc(run::Column::Id)
                .limit(BATCH)
                .all(&self.conn())
                .await?;
            let Some(last) = rows.last() else {
                break;
            };
            cursor = Some(last.id.clone());

            for row in rows {
                let Ok(record) = serde_json::from_str::<RunRecord>(&row.record_json) else {
                    continue;
                };
                let id = row.id.clone();
                let mut active = row.into_active_model();
                active.engine_slug = Set(Some(record.subject.engine_slug));
                active.update(&self.conn()).await?;
                touch_run(&self.conn(), &id).await?;
                backfilled += 1;
            }
        }
        Ok(backfilled)
    }

    /// Backfill the second half of a gg run's [cell identity](CellKey) — `run.gg_models` — for
    /// the gg rows stored before the column existed, by re-deriving it from each row's own
    /// recorded capability set.
    ///
    /// **This is not covered by [`Self::backfill_sort_columns`]**, and the difference matters
    /// enough to say twice. That pass selects rows whose `test_type` is still the empty string
    /// the migration's default stamped, which is how it identifies a row written before *that*
    /// column existed. Every gg run in a live store was written long after `test_type` shipped,
    /// so no gg row is ever a candidate there and none would ever be filled.
    ///
    /// Left unfilled, the column reads as `NULL`, which every grouped coverage query coalesces
    /// to the empty string — the **harness** form of the cell key. So the entire gg backlog
    /// would count toward no gg cell at all: a plan's cells would read zero however many runs
    /// stood behind them, its top-up would re-buy work that already exists, and a ladder rung
    /// gated on a configuration would find no evidence in its own history. Coverage counts are
    /// global precisely so that a run someone already paid for is never re-requested, and that
    /// promise is only kept if the runs that predate the column are keyed like the ones after
    /// it.
    ///
    /// Idempotent and best-effort per row, exactly as the backfills above are: a gg row whose
    /// record no longer deserializes, or which records no capability set at all (a run
    /// assembled by hand), keeps its `NULL` and is simply revisited by a later boot — a bounded
    /// residue, since a set is what a gg run is launched from. Paged by an `id` cursor for the
    /// same reason [`Self::backfill_engine_slug`] is: the first boot after the migration visits
    /// every gg run in the store, each carrying its multi-KB blobs.
    pub async fn backfill_gg_models(&self) -> Result<usize> {
        const BATCH: u64 = 256;
        let mut backfilled = 0usize;
        let mut cursor: Option<String> = None;
        loop {
            let mut query = run::Entity::find()
                .filter(run::Column::HarnessSlug.eq(HarnessSlug::Gg.as_str()))
                .filter(run::Column::GgModels.is_null());
            if let Some(after) = cursor.as_deref() {
                query = query.filter(run::Column::Id.gt(after));
            }
            let rows = query
                .order_by_asc(run::Column::Id)
                .limit(BATCH)
                .all(&self.conn())
                .await?;
            let Some(last) = rows.last() else {
                break;
            };
            cursor = Some(last.id.clone());

            for row in rows {
                let Ok(record) = serde_json::from_str::<RunRecord>(&row.record_json) else {
                    continue;
                };
                // Asked of the same lift a push writes, so a backfilled row and a freshly
                // pushed one land in one cell rather than in two that differ by a comma.
                let Some(models) = lifted_gg_models(&record) else {
                    continue;
                };
                let id = row.id.clone();
                let mut active = row.into_active_model();
                active.gg_models = Set(Some(models));
                // The configuration's name is lifted from the same set and gated on the same
                // harness, so a row missing one is missing both; fill the pair together rather
                // than leaving half a cell identity behind.
                active.gg_preset = Set(lifted_gg_preset(&record));
                active.update(&self.conn()).await?;
                touch_run(&self.conn(), &id).await?;
                backfilled += 1;
            }
        }
        Ok(backfilled)
    }

    /// Backfill the same two segments on the gg **jobs still in flight** at the moment the
    /// columns arrived, re-deriving them from the capability set the job was enqueued with.
    ///
    /// A queued gg job with no lifted pair counts toward the harness-shaped cell rather than
    /// its own, which is the one case where the missing identity does not merely under-count
    /// but actively over-spends: a plan sees zero runs coming for a cell that already has
    /// several on the way and enqueues a second set on top of them.
    ///
    /// Bounded to the non-terminal states on purpose. A finished job's counts come from the
    /// `run` row it produced, so rewriting the whole job history would be a large write for a
    /// number nothing reads; what is left in flight across a deploy is at most the queue's
    /// depth.
    pub async fn backfill_in_flight_gg_cells(&self) -> Result<usize> {
        let rows = job::Entity::find()
            .filter(job::Column::HarnessSlug.eq(HarnessSlug::Gg.as_str()))
            .filter(job::Column::GgModels.is_null())
            .filter(job::Column::State.is_in(IN_FLIGHT_STATES))
            .all(&self.conn())
            .await?;
        let mut backfilled = 0usize;
        for row in rows {
            let Some(json) = row.gg_config_json.as_deref() else {
                continue;
            };
            let Ok(set) = serde_json::from_str::<test_cabinet_core::gg::GgCapabilitySet>(json)
            else {
                continue;
            };
            let mut active = row.into_active_model();
            active.gg_models = Set(Some(set.bound_model_key()));
            active.gg_preset = Set(set.preset.clone());
            active.update(&self.conn()).await?;
            backfilled += 1;
        }
        Ok(backfilled)
    }

    /// Backfill `job.engine_slug` on the **jobs still in flight** at the moment the column
    /// arrived, re-deriving it from each row's own launch request.
    ///
    /// Only a job that actually names an engine needs it. A request with no engine key is a
    /// `none` run, which is exactly what a `NULL` column already coalesces to, so leaving it
    /// `NULL` is not a loss — the rows this fixes are the ones whose runs will land in a
    /// non-`none` cell while the job counts toward the `none` one. That mismatch is the case
    /// where a missing lift does not merely under-count but over-spends: a plan sees no runs
    /// coming for a cell that already has several on the way and buys a second set.
    ///
    /// Bounded to the non-terminal states for the reason
    /// [`Self::backfill_in_flight_gg_cells`] is: a finished job's counts come from the `run`
    /// row it produced, so rewriting the whole job history would be a large write for a
    /// number nothing reads; what is left in flight across a deploy is at most the queue's
    /// depth. Best-effort per row — a request that no longer deserializes keeps its `NULL`.
    pub async fn backfill_in_flight_engine_slugs(&self) -> Result<usize> {
        let rows = job::Entity::find()
            .filter(job::Column::EngineSlug.is_null())
            .filter(job::Column::State.is_in(IN_FLIGHT_STATES))
            .all(&self.conn())
            .await?;
        let mut backfilled = 0usize;
        for row in rows {
            let Ok(body) = serde_json::from_str::<test_cabinet_core::LaunchBody>(&row.request_json)
            else {
                continue;
            };
            let Some(engine) = body.engine.filter(|slug| !slug.trim().is_empty()) else {
                continue;
            };
            let mut active = row.into_active_model();
            active.engine_slug = Set(Some(engine));
            active.update(&self.conn()).await?;
            backfilled += 1;
        }
        Ok(backfilled)
    }

    /// Backfill the other half of a gg run's [cell identity](CellKey) —
    /// `run.gg_config_id` — for the gg rows recorded before the column existed.
    ///
    /// Unlike every backfill above it, this one cannot be re-derived from the row: an older
    /// run records the configuration's **name** and nothing else, and the name is not the
    /// id. What resolves it is the `job` that produced the run — `job.record_id` points at
    /// the run and `job.user_id` at the account that launched it — because a configuration
    /// is account-scoped, so a name only means something inside one account. The launching
    /// account's configurations are then matched by name.
    ///
    /// A resolved row is written in **both** places the id lives: the record's
    /// [`preset_id`](test_cabinet_core::gg::GgCapabilitySet::preset_id) and the column
    /// lifted from it. The column is what the grouped counts read and the record is what a
    /// cell's review queue matches a run against, so filling one alone would produce a run
    /// that counts toward a cell and can never be offered for review in it — a review-buffer
    /// slot spent on a run no reviewer is ever shown.
    ///
    /// Both are left alone whenever the answer is not exact: no job points at the run, the
    /// job that does is unattributed, two jobs disagree about whose run it is, the account
    /// no longer has a configuration by that name, or it has more than one. A miss
    /// under-counts one cell, which the next top-up fills with new runs; a guess would merge
    /// two configurations' histories permanently, and no later pass could tell it had
    /// happened. Rows recording no name at all — a set assembled by hand — are never
    /// candidates: they belong in no configuration's cell.
    ///
    /// **One-shot**, unlike every other backfill here, and marked as such in
    /// [`backfill_state`] once a pass completes. The name it resolves through is the one
    /// thing an operator edits freely, so re-examining the residue on a later boot would
    /// answer with a configuration library that has since moved: a rename frees a name, a
    /// new configuration takes it, and the old configuration's whole history is adopted by a
    /// configuration that never ran any of it. A pass that fails part way writes no marker
    /// and runs again on the next boot.
    ///
    /// Best-effort and batched exactly as [`Self::backfill_gg_models`] is. Paged by an `id`
    /// cursor, and scanning only the two columns it needs, with the whole row read for the
    /// rows it actually resolves, because the one pass visits every gg run in the store.
    pub async fn backfill_gg_config_id(&self) -> Result<usize> {
        const BATCH: u64 = 256;
        if self.backfill_completed(RUN_GG_CONFIG_ID_BACKFILL).await? {
            return Ok(0);
        }
        let mut backfilled = 0usize;
        let mut cursor: Option<String> = None;
        // One name→ids map per account, kept across batches: a store's gg runs cluster into
        // a handful of accounts, and re-reading a configuration list per batch would be the
        // bulk of the work.
        let mut by_account: HashMap<String, HashMap<String, Vec<String>>> = HashMap::new();
        loop {
            let mut query = run::Entity::find()
                .select_only()
                .column(run::Column::Id)
                .column(run::Column::GgPreset)
                .filter(run::Column::HarnessSlug.eq(HarnessSlug::Gg.as_str()))
                .filter(run::Column::GgConfigId.is_null())
                .filter(run::Column::GgPreset.is_not_null());
            if let Some(after) = cursor.as_deref() {
                query = query.filter(run::Column::Id.gt(after));
            }
            let rows: Vec<(String, Option<String>)> = query
                .order_by_asc(run::Column::Id)
                .limit(BATCH)
                .into_tuple()
                .all(&self.conn())
                .await?;
            let Some((last, _)) = rows.last() else {
                break;
            };
            cursor = Some(last.clone());

            let launchers = self
                .launching_accounts(rows.iter().map(|(id, _)| id.clone()).collect())
                .await?;
            let wanted: Vec<String> = launchers
                .values()
                .filter(|user_id| !by_account.contains_key(*user_id))
                .cloned()
                .collect::<std::collections::BTreeSet<_>>()
                .into_iter()
                .collect();
            by_account.extend(self.gg_config_ids_by_name(&wanted).await?);

            for (run_id, preset) in rows {
                let Some(preset) = preset else {
                    continue;
                };
                let Some(user_id) = launchers.get(&run_id) else {
                    continue;
                };
                let Some(config_id) = by_account
                    .get(user_id)
                    .and_then(|configs| configs.get(&preset))
                    .filter(|ids| ids.len() == 1)
                    .and_then(|ids| ids.first())
                    .cloned()
                else {
                    continue;
                };
                if self.stamp_run_gg_config_id(&run_id, &config_id).await? {
                    backfilled += 1;
                }
            }
        }
        self.mark_backfill_complete(RUN_GG_CONFIG_ID_BACKFILL)
            .await?;
        Ok(backfilled)
    }

    /// Write one resolved configuration id onto a run, in the record and in the column
    /// lifted from it, and report whether the row was rewritten.
    ///
    /// The record is the authority: a run whose stored capability set no longer
    /// deserializes, or which carries no capability set at all, is left entirely alone
    /// rather than given a column its record cannot account for.
    async fn stamp_run_gg_config_id(&self, run_id: &str, config_id: &str) -> Result<bool> {
        let Some(row) = run::Entity::find_by_id(run_id).one(&self.conn()).await? else {
            return Ok(false);
        };
        let Ok(mut record) = serde_json::from_str::<RunRecord>(&row.record_json) else {
            return Ok(false);
        };
        let Some(set) = record.subject.gg_capability_set.as_mut() else {
            return Ok(false);
        };
        set.preset_id = Some(config_id.to_string());
        let record_json = serde_json::to_string(&record)?;
        let mut active = row.into_active_model();
        active.gg_config_id = Set(Some(config_id.to_string()));
        active.record_json = Set(record_json);
        active.update(&self.conn()).await?;
        touch_run(&self.conn(), run_id).await?;
        Ok(true)
    }

    /// Whether the named startup backfill has already run to completion.
    ///
    /// Only the passes that must run **once** ask this. A backfill that re-derives a column
    /// from the row holding the answer needs no marker: filling a row removes it from the
    /// candidate set, so the pass settles to empty by itself.
    async fn backfill_completed(&self, key: &str) -> Result<bool> {
        Ok(backfill_state::Entity::find_by_id(key.to_string())
            .one(&self.conn())
            .await?
            .is_some())
    }

    /// Record that the named startup backfill has completed, so no later boot re-examines
    /// the rows it left unresolved. Called only on a pass that ran through without error.
    async fn mark_backfill_complete(&self, key: &str) -> Result<()> {
        let now = OffsetDateTime::now_utc().format(&Rfc3339)?;
        backfill_state::Entity::insert(backfill_state::ActiveModel {
            id: Set(key.to_string()),
            completed_at: Set(now),
        })
        .on_conflict(
            OnConflict::column(backfill_state::Column::Id)
                .do_nothing()
                .to_owned(),
        )
        .do_nothing()
        .exec(&self.conn())
        .await?;
        Ok(())
    }

    /// Which account launched each of `run_ids`, via the `job` that produced the run — the
    /// only link a `run` row has to an account, since a run belongs to no one.
    ///
    /// A run with no attributed job is absent, and so is one two jobs claim for two
    /// different accounts: a retried run keeps its original launcher, so a disagreement is a
    /// store nobody can interpret rather than a tie to break.
    async fn launching_accounts(&self, run_ids: Vec<String>) -> Result<HashMap<String, String>> {
        let rows: Vec<(Option<String>, Option<String>)> = job::Entity::find()
            .select_only()
            .column(job::Column::RecordId)
            .column(job::Column::UserId)
            .filter(job::Column::RecordId.is_in(run_ids))
            .filter(job::Column::UserId.is_not_null())
            .into_tuple()
            .all(&self.conn())
            .await?;
        let mut launchers: HashMap<String, String> = HashMap::new();
        let mut disputed: Vec<String> = Vec::new();
        for (record_id, user_id) in rows {
            let (Some(record_id), Some(user_id)) = (record_id, user_id) else {
                continue;
            };
            match launchers.get(&record_id) {
                Some(seen) if seen != &user_id => disputed.push(record_id),
                _ => {
                    launchers.insert(record_id, user_id);
                }
            }
        }
        for record_id in disputed {
            launchers.remove(&record_id);
        }
        Ok(launchers)
    }

    /// Every configuration each of `user_ids` has saved, as a name→ids map per account.
    ///
    /// The ids are a list rather than one id because nothing makes a configuration's name
    /// unique within an account — which is one of the reasons a cell is keyed on the id in
    /// the first place. A name that lands on two ids is ambiguous and its runs are left
    /// unattributed; the caller decides that by asking for the length.
    async fn gg_config_ids_by_name(
        &self,
        user_ids: &[String],
    ) -> Result<HashMap<String, HashMap<String, Vec<String>>>> {
        let mut by_account: HashMap<String, HashMap<String, Vec<String>>> = HashMap::new();
        if user_ids.is_empty() {
            return Ok(by_account);
        }
        // Every named account gets an entry, even one with no configurations at all, so the
        // caller's cache does not re-query it on every batch.
        for user_id in user_ids {
            by_account.entry(user_id.clone()).or_default();
        }
        let rows: Vec<(String, String, String)> = gg_config::Entity::find()
            .select_only()
            .column(gg_config::Column::UserId)
            .column(gg_config::Column::Name)
            .column(gg_config::Column::Id)
            .filter(gg_config::Column::UserId.is_in(user_ids.iter().map(String::as_str)))
            .into_tuple()
            .all(&self.conn())
            .await?;
        for (user_id, name, id) in rows {
            by_account
                .entry(user_id)
                .or_default()
                .entry(name)
                .or_default()
                .push(id);
        }
        Ok(by_account)
    }

    /// Backfill `job.gg_config_id` on the gg **jobs still in flight** when the column
    /// arrived, so a run already on its way is counted under the cell the run it becomes
    /// will land in.
    ///
    /// Resolved from the job's own capability set where that set already names the
    /// configuration it came from, and otherwise by the same name lookup
    /// [`Self::backfill_gg_config_id`] uses — which is cheaper here, because a job carries
    /// the launching account itself and needs no run to be traced back to it.
    ///
    /// A name-resolved job has the id written into its stored capability set as well as into
    /// its column, because that set is what the driver hands the run: writing the column
    /// alone would count the job toward a cell and then produce a run recording no
    /// configuration, which lands in no cell at all and is re-bought.
    ///
    /// Bounded to the non-terminal states for the reason
    /// [`Self::backfill_in_flight_gg_cells`] is: a finished job's counts come from the `run`
    /// row it produced, so rewriting the whole job history would be a large write for a
    /// number nothing reads. One-shot for the reason [`Self::backfill_gg_config_id`] is: the
    /// name it resolves through belongs to a library the operator keeps editing.
    pub async fn backfill_in_flight_gg_config_ids(&self) -> Result<usize> {
        if self.backfill_completed(JOB_GG_CONFIG_ID_BACKFILL).await? {
            return Ok(0);
        }
        let rows = job::Entity::find()
            .filter(job::Column::HarnessSlug.eq(HarnessSlug::Gg.as_str()))
            .filter(job::Column::GgConfigId.is_null())
            .filter(job::Column::State.is_in(IN_FLIGHT_STATES))
            .all(&self.conn())
            .await?;
        let user_ids: Vec<String> = rows.iter().filter_map(|row| row.user_id.clone()).collect();
        let by_account = self.gg_config_ids_by_name(&user_ids).await?;

        let mut backfilled = 0usize;
        for row in rows {
            let set = row.gg_config_json.as_deref().and_then(|json| {
                serde_json::from_str::<test_cabinet_core::gg::GgCapabilitySet>(json).ok()
            });
            let Some(mut set) = set else {
                continue;
            };
            // A set that already names its configuration needs no lookup, and its stored
            // JSON is already right; only a name-resolved one is rewritten.
            let resolved = match set.preset_id.clone() {
                Some(id) => Some((id, false)),
                None => set
                    .preset
                    .as_ref()
                    .and_then(|name| {
                        row.user_id
                            .as_ref()
                            .and_then(|user_id| by_account.get(user_id))
                            .and_then(|configs| configs.get(name))
                            .filter(|ids| ids.len() == 1)
                            .and_then(|ids| ids.first())
                            .cloned()
                    })
                    .map(|id| (id, true)),
            };
            let Some((config_id, rewrite_set)) = resolved else {
                continue;
            };
            let gg_config_json = if rewrite_set {
                set.preset_id = Some(config_id.clone());
                Some(serde_json::to_string(&set)?)
            } else {
                None
            };
            let mut active = row.into_active_model();
            active.gg_config_id = Set(Some(config_id));
            if let Some(json) = gg_config_json {
                active.gg_config_json = Set(Some(json));
            }
            active.update(&self.conn()).await?;
            backfilled += 1;
        }
        self.mark_backfill_complete(JOB_GG_CONFIG_ID_BACKFILL)
            .await?;
        Ok(backfilled)
    }
}

/// The reference-implementation store: the deployed URL of a test-case variant's
/// authored, correct build (the case-variant analogue of a run's `playableBuild`).
///
/// The rows are written **out-of-band** by the `tcab publish-reference` CLI (via
/// the authenticated record endpoint), never at ingest and never seeded into a
/// run. Reads feed `GET /test-cases/{slug}/versions/{version}` and the public
/// snapshot, which surface the URL on the test-case page's "Reference" tab.
impl Db {
    /// Create or replace the served URL for one `(slug, version, variant)` triple.
    /// A re-deploy of the same variant upserts its `url` (and `updated_at`) in
    /// place — the composite primary key means there is never more than one row per
    /// triple.
    pub async fn upsert_reference_build(
        &self,
        slug: &str,
        version: &str,
        variant: &str,
        engine: &str,
        url: &str,
        now: &str,
    ) -> Result<()> {
        case_reference_build::Entity::insert(case_reference_build::ActiveModel {
            slug: Set(slug.to_string()),
            version: Set(version.to_string()),
            variant: Set(variant.to_string()),
            engine: Set(engine.to_string()),
            url: Set(url.to_string()),
            updated_at: Set(now.to_string()),
        })
        .on_conflict(
            OnConflict::columns([
                case_reference_build::Column::Slug,
                case_reference_build::Column::Version,
                case_reference_build::Column::Variant,
                case_reference_build::Column::Engine,
            ])
            .update_columns([
                case_reference_build::Column::Url,
                case_reference_build::Column::UpdatedAt,
            ])
            .to_owned(),
        )
        .exec(&self.conn())
        .await?;
        Ok(())
    }

    /// The reference-build URLs of every variant of `(slug, version)` that has any,
    /// keyed by variant slug and then by engine slug. Feeds the version response and
    /// the snapshot, both of which fold the inner map onto each variant object; a
    /// variant absent from the outer map simply has no reference implementation, and
    /// an engine absent from an inner map has none published for that engine yet.
    pub async fn reference_builds_for_version(
        &self,
        slug: &str,
        version: &str,
    ) -> Result<std::collections::HashMap<String, std::collections::BTreeMap<String, String>>> {
        let mut by_variant: std::collections::HashMap<
            String,
            std::collections::BTreeMap<String, String>,
        > = std::collections::HashMap::new();
        for row in case_reference_build::Entity::find()
            .filter(case_reference_build::Column::Slug.eq(slug))
            .filter(case_reference_build::Column::Version.eq(version))
            .all(&self.conn())
            .await?
        {
            by_variant
                .entry(row.variant)
                .or_default()
                .insert(row.engine, row.url);
        }
        Ok(by_variant)
    }

    /// Reconcile the **entire** reference-build table to `desired` — the complete set
    /// of deployed reference URLs for this backend's environment, read from the
    /// committed reference-builds lockfile at ingest (see the `/ingest` handler).
    /// Every entry in `desired` is upserted; every stored row absent from `desired`
    /// is removed. The lockfile is the single source of truth, so this
    /// makes the table match it exactly — the pull-model replacement for the former
    /// per-variant write endpoint.
    ///
    /// Returns whether the table actually changed, so the caller can skip a redundant
    /// snapshot refresh when a re-ingest finds the lockfile already in sync.
    pub async fn sync_reference_builds(
        &self,
        desired: &[ReferenceBuildEntry],
        now: &str,
    ) -> Result<bool> {
        // Snapshot the current rows so the table is touched only where it differs; an
        // unchanged re-ingest then neither writes nor forces a snapshot rebuild.
        type Key = (String, String, String, String);
        let current: std::collections::HashMap<Key, String> = case_reference_build::Entity::find()
            .all(&self.conn())
            .await?
            .into_iter()
            .map(|row| ((row.slug, row.version, row.variant, row.engine), row.url))
            .collect();
        let desired_keys: std::collections::HashSet<Key> = desired
            .iter()
            .map(|e| {
                (
                    e.slug.clone(),
                    e.version.clone(),
                    e.variant.clone(),
                    e.engine.clone(),
                )
            })
            .collect();

        let mut changed = false;

        // Upsert rows that are new or whose served URL moved.
        for entry in desired {
            let key = (
                entry.slug.clone(),
                entry.version.clone(),
                entry.variant.clone(),
                entry.engine.clone(),
            );
            if current.get(&key).map(String::as_str) != Some(entry.url.as_str()) {
                self.upsert_reference_build(
                    &entry.slug,
                    &entry.version,
                    &entry.variant,
                    &entry.engine,
                    &entry.url,
                    now,
                )
                .await?;
                changed = true;
            }
        }

        // Remove rows the lockfile no longer lists.
        for key in current.keys() {
            if !desired_keys.contains(key) {
                case_reference_build::Entity::delete_by_id(key.clone())
                    .exec(&self.conn())
                    .await?;
                changed = true;
            }
        }

        Ok(changed)
    }
}

/// One variant's published reference sheet, as the reconcile wants it: the triple it
/// belongs to and the frame indices found for it.
///
/// The asset-generation counterpart of [`ReferenceBuildEntry`], which comes from the
/// committed reference-builds lockfile. There is no lockfile here — a published
/// asset reference is discovered by listing the snapshot bucket (see the `/ingest`
/// handler's `reconcile_reference_sheets`) — so the entry type is defined with the
/// store that consumes it rather than in `core`'s lockfile module.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReferenceSheetEntry {
    /// The test-case slug.
    pub slug: String,
    /// The case version.
    pub version: String,
    /// The variant slug.
    pub variant: String,
    /// The published frame indices. Need not be sorted or de-duplicated; the store
    /// canonicalizes them on the way in.
    pub frames: Vec<u32>,
}

/// Encode a frame set into the canonical column form: ascending, de-duplicated,
/// comma-separated decimal integers with no whitespace (`""` for no frames).
///
/// Canonical because the reconcile decides whether to write by comparing this string
/// to the stored one — two equal frame sets discovered in a different order must
/// compare equal, or every ingest would rewrite every row and force a needless
/// snapshot refresh.
fn encode_frames(frames: &[u32]) -> String {
    let mut frames: Vec<u32> = frames.to_vec();
    frames.sort_unstable();
    frames.dedup();
    frames
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",")
}

/// Decode the stored frame column back into indices, the inverse of
/// [`encode_frames`].
///
/// Deliberately lenient: an unparsable or empty component is skipped rather than
/// failing the read. The column is only ever written by [`encode_frames`], so a
/// malformed value means hand-editing or a future format — and dropping one frame
/// from a gallery tab is a far better failure than a 500 on the whole version
/// response. The result is re-canonicalized so callers always see ascending,
/// de-duplicated indices even if the stored string was not.
fn decode_frames(encoded: &str) -> Vec<u32> {
    let mut frames: Vec<u32> = encoded
        .split(',')
        .filter_map(|part| part.trim().parse::<u32>().ok())
        .collect();
    frames.sort_unstable();
    frames.dedup();
    frames
}

/// The asset-generation reference store: which frames of a test-case variant's
/// authored, correct reference have been published to the public snapshot bucket.
///
/// The asset-generation analogue of the reference-build store above. Rows are
/// written **out-of-band**: `tcab publish-reference` runs a variant's `draw.sh` and
/// uploads the frames it produced under the deterministic keys
/// [`test_cabinet_core::asset_reference`] defines, and the backend reconciles this
/// table to what it finds in the bucket at ingest. Nothing here is resolved from a
/// manifest and nothing is seeded into a run. Reads feed
/// `GET /test-cases/{slug}/versions/{version}` and the public snapshot, which fold
/// the frame list onto each variant so the client can rebuild each frame's URL from
/// the triple, the index, and the public snapshot base URL.
impl Db {
    /// Create or replace the published frame set for one `(slug, version, variant)`
    /// triple. Re-publishing the same variant upserts its `frames` (and `updated_at`)
    /// in place — the composite primary key means there is never more than one row
    /// per triple. `frames` is canonicalized on the way in, so the caller may pass
    /// them in any order.
    pub async fn upsert_reference_sheet(
        &self,
        slug: &str,
        version: &str,
        variant: &str,
        frames: &[u32],
        now: &str,
    ) -> Result<()> {
        case_reference_sheet::Entity::insert(case_reference_sheet::ActiveModel {
            slug: Set(slug.to_string()),
            version: Set(version.to_string()),
            variant: Set(variant.to_string()),
            frames: Set(encode_frames(frames)),
            updated_at: Set(now.to_string()),
        })
        .on_conflict(
            OnConflict::columns([
                case_reference_sheet::Column::Slug,
                case_reference_sheet::Column::Version,
                case_reference_sheet::Column::Variant,
            ])
            .update_columns([
                case_reference_sheet::Column::Frames,
                case_reference_sheet::Column::UpdatedAt,
            ])
            .to_owned(),
        )
        .exec(&self.conn())
        .await?;
        Ok(())
    }

    /// The published frame indices of every variant of `(slug, version)` that has a
    /// reference sheet, keyed by variant slug and ascending within each. Feeds the
    /// version response and the snapshot, both of which fold the list onto each
    /// variant; a variant absent from the map has no published reference.
    pub async fn reference_sheets_for_version(
        &self,
        slug: &str,
        version: &str,
    ) -> Result<std::collections::HashMap<String, Vec<u32>>> {
        Ok(case_reference_sheet::Entity::find()
            .filter(case_reference_sheet::Column::Slug.eq(slug))
            .filter(case_reference_sheet::Column::Version.eq(version))
            .all(&self.conn())
            .await?
            .into_iter()
            .map(|row| (row.variant, decode_frames(&row.frames)))
            .collect())
    }

    /// Reconcile the **entire** reference-sheet table to `desired` — the complete set
    /// of published asset references, read by listing the snapshot bucket at ingest
    /// (see the `/ingest` handler). Every triple in `desired` is upserted; every
    /// stored triple absent from `desired` is removed. The bucket is the single source
    /// of truth for what a client can actually fetch, so this makes the table match it
    /// exactly — a frame deleted from the bucket must stop being advertised.
    ///
    /// The caller is responsible for only invoking this when it *knows* the desired
    /// set: a backend with no R2 configured must not reconcile to empty, because
    /// "listed nothing" and "could not look" are different facts.
    ///
    /// Returns whether the table actually changed, so the caller can skip a redundant
    /// snapshot refresh when a re-ingest finds the bucket already in sync.
    pub async fn sync_reference_sheets(
        &self,
        desired: &[ReferenceSheetEntry],
        now: &str,
    ) -> Result<bool> {
        // Snapshot the current rows so the table is touched only where it differs; an
        // unchanged re-ingest then neither writes nor forces a snapshot rebuild. The
        // stored form is canonical, so comparing the encoded strings is exactly a
        // comparison of the frame sets.
        let current: std::collections::HashMap<(String, String, String), String> =
            case_reference_sheet::Entity::find()
                .all(&self.conn())
                .await?
                .into_iter()
                .map(|row| ((row.slug, row.version, row.variant), row.frames))
                .collect();
        let desired_keys: std::collections::HashSet<(String, String, String)> = desired
            .iter()
            .map(|e| (e.slug.clone(), e.version.clone(), e.variant.clone()))
            .collect();

        let mut changed = false;

        // Upsert triples that are new or whose published frame set moved.
        for entry in desired {
            let key = (
                entry.slug.clone(),
                entry.version.clone(),
                entry.variant.clone(),
            );
            if current.get(&key).map(String::as_str) != Some(encode_frames(&entry.frames).as_str())
            {
                self.upsert_reference_sheet(
                    &entry.slug,
                    &entry.version,
                    &entry.variant,
                    &entry.frames,
                    now,
                )
                .await?;
                changed = true;
            }
        }

        // Remove triples the bucket no longer holds.
        for key in current.keys() {
            if !desired_keys.contains(key) {
                case_reference_sheet::Entity::delete_by_id(key.clone())
                    .exec(&self.conn())
                    .await?;
                changed = true;
            }
        }

        Ok(changed)
    }
}

/// Parse a stored harness slug string into a [`HarnessSlug`], defaulting to Claude
/// for an unrecognized value (a slug the current build does not know). The default
/// only affects the `:free` normalization guard, which a non-OpenRouter default
/// simply skips.
fn parse_harness_slug(slug: &str) -> HarnessSlug {
    // `from_wire` covers every variant, gg included, so a `gg` run's model id
    // canonicalizes with the right `:free` handling rather than falling back to
    // Claude (which does not route through OpenRouter).
    HarnessSlug::from_wire(slug).unwrap_or(HarnessSlug::Claude)
}

// `pub(crate)` under `cfg(test)`: the router tests in `api.test.rs` build their
// fixtures from the same `record`/`links` helpers, so the run a route test drives is
// the run every database test drives.
#[cfg(test)]
#[path = "db.test.rs"]
pub(crate) mod tests;

#[cfg(test)]
#[path = "db.readability.test.rs"]
mod readability_tests;

/// The model-probe store: responses-as-code readiness probes of catalog models
/// (see [`crate::probe`]).
///
/// A probe row is inserted `running` when an operator triggers it, its per-call
/// items are appended as the background runner completes each call, and the row
/// is finished exactly once with its verdict and spend. Probes are append-only
/// history — a re-run is a new row — and console-only data: nothing here feeds
/// the public snapshot.
impl Db {
    /// Insert a freshly-triggered probe row (id and timestamps minted by the
    /// handler; status `running`).
    pub async fn insert_model_probe(&self, row: model_probe::Model) -> Result<()> {
        model_probe::ActiveModel {
            id: Set(row.id),
            model_slug: Set(row.model_slug),
            openrouter_slug: Set(row.openrouter_slug),
            provider: Set(row.provider),
            user_id: Set(row.user_id),
            language: Set(row.language),
            samples: Set(row.samples),
            max_tokens: Set(row.max_tokens),
            request_json: Set(row.request_json),
            status: Set(row.status),
            error: Set(row.error),
            verdict: Set(row.verdict),
            pass_rate: Set(row.pass_rate),
            spend: Set(row.spend),
            created_at: Set(row.created_at),
            finished_at: Set(row.finished_at),
        }
        .insert(&self.conn())
        .await?;
        Ok(())
    }

    /// One probe by id, or `None` when unknown.
    pub async fn get_model_probe(&self, id: &str) -> Result<Option<model_probe::Model>> {
        Ok(model_probe::Entity::find_by_id(id.to_string())
            .one(&self.conn())
            .await?)
    }

    /// Every probe of one catalog model, newest first.
    pub async fn list_model_probes(&self, model_slug: &str) -> Result<Vec<model_probe::Model>> {
        Ok(model_probe::Entity::find()
            .filter(model_probe::Column::ModelSlug.eq(model_slug))
            .order_by_desc(model_probe::Column::CreatedAt)
            .order_by_desc(model_probe::Column::Id)
            .all(&self.conn())
            .await?)
    }

    /// Whether a probe of this catalog model is still running (the trigger
    /// endpoint refuses a second concurrent probe of the same model).
    pub async fn model_probe_running(&self, model_slug: &str) -> Result<bool> {
        Ok(model_probe::Entity::find()
            .filter(model_probe::Column::ModelSlug.eq(model_slug))
            .filter(model_probe::Column::Status.eq("running"))
            .one(&self.conn())
            .await?
            .is_some())
    }

    /// Append one completed (or errored) probe call.
    pub async fn insert_model_probe_item(&self, row: model_probe_item::Model) -> Result<()> {
        model_probe_item::ActiveModel {
            id: Set(row.id),
            probe_id: Set(row.probe_id),
            language: Set(row.language),
            scenario: Set(row.scenario),
            prompt: Set(row.prompt),
            sample: Set(row.sample),
            provider: Set(row.provider),
            finish_reason: Set(row.finish_reason),
            native_finish_reason: Set(row.native_finish_reason),
            label: Set(row.label),
            pass: Set(row.pass),
            program_text: Set(row.program_text),
            response_text: Set(row.response_text),
            reasoning_text: Set(row.reasoning_text),
            prompt_tokens: Set(row.prompt_tokens),
            completion_tokens: Set(row.completion_tokens),
            cost: Set(row.cost),
            duration_ms: Set(row.duration_ms),
            error: Set(row.error),
            created_at: Set(row.created_at),
        }
        .insert(&self.conn())
        .await?;
        Ok(())
    }

    /// One probe's calls, in case order (items are ordered by creation, which
    /// the sequential runner makes case-then-sample order).
    pub async fn list_model_probe_items(
        &self,
        probe_id: &str,
    ) -> Result<Vec<model_probe_item::Model>> {
        Ok(model_probe_item::Entity::find()
            .filter(model_probe_item::Column::ProbeId.eq(probe_id))
            .order_by_asc(model_probe_item::Column::CreatedAt)
            .order_by_asc(model_probe_item::Column::Id)
            .all(&self.conn())
            .await?)
    }

    /// The `/stats/providers` probe projection: every probe item's serving
    /// provider, the probed model's catalog slug (via the owning probe), its
    /// pass flag, and whether the call errored before classification —
    /// four columns across the whole store, folded in Rust by
    /// [`fold_probe_providers`](crate::stats::fold_probe_providers). The label
    /// travels only as its absence: `None` is the errored call, exactly the
    /// reading the probe reducer uses.
    pub async fn probe_item_provider_rows(&self) -> Result<Vec<crate::stats::ProbeItemRow>> {
        let rows: Vec<(Option<String>, String, bool, Option<String>)> =
            model_probe_item::Entity::find()
                .select_only()
                .column(model_probe_item::Column::Provider)
                .column(model_probe::Column::ModelSlug)
                .column(model_probe_item::Column::Pass)
                .column(model_probe_item::Column::Label)
                .join(JoinType::InnerJoin, model_probe_item::Relation::Probe.def())
                .into_tuple()
                .all(&self.conn())
                .await?;
        Ok(rows
            .into_iter()
            .map(|(provider, model_slug, pass, label)| {
                (provider, model_slug, pass, label.is_none())
            })
            .collect())
    }

    /// Finish a probe: stamp its terminal status (`complete`/`failed`), the
    /// verdict and clean rate when it completed, the failure message when it did
    /// not, and the summed spend. Returns whether a row matched.
    #[allow(clippy::too_many_arguments)]
    pub async fn finish_model_probe(
        &self,
        id: &str,
        status: &str,
        error: Option<String>,
        verdict: Option<String>,
        pass_rate: Option<f64>,
        spend: f64,
        finished_at: &str,
    ) -> Result<bool> {
        let res = model_probe::Entity::update_many()
            .col_expr(model_probe::Column::Status, Expr::value(status))
            .col_expr(model_probe::Column::Error, Expr::value(error))
            .col_expr(model_probe::Column::Verdict, Expr::value(verdict))
            .col_expr(model_probe::Column::PassRate, Expr::value(pass_rate))
            .col_expr(model_probe::Column::Spend, Expr::value(spend))
            .col_expr(model_probe::Column::FinishedAt, Expr::value(finished_at))
            .filter(model_probe::Column::Id.eq(id))
            .exec(&self.conn())
            .await?;
        Ok(res.rows_affected > 0)
    }

    /// Fail every probe still marked `running` — the startup reap. A probe runs
    /// inside the backend process, so a backend restart always killed it; unlike
    /// the job-queue reap this is correct on every deployment shape.
    pub async fn fail_running_model_probes(&self, now: &str) -> Result<u64> {
        let res = model_probe::Entity::update_many()
            .col_expr(model_probe::Column::Status, Expr::value("failed"))
            .col_expr(
                model_probe::Column::Error,
                Expr::value("the backend restarted while the probe was running"),
            )
            .col_expr(model_probe::Column::FinishedAt, Expr::value(now))
            .filter(model_probe::Column::Status.eq("running"))
            .exec(&self.conn())
            .await?;
        Ok(res.rows_affected)
    }
}
