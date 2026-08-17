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
use test_cabinet_core::match_play::TournamentRecord;
use test_cabinet_core::metrics::{Cost, TokenPrices};
use test_cabinet_core::reference_lock::ReferenceBuildEntry;
use test_cabinet_core::review::{DomainRating, Rating, ReviewDiff, ReviewRevision, ReviewVerdict};
use test_cabinet_core::run_record::{
    HarnessFamily, HarnessSlug, PriorGameJamEntry, RunLinks, RunRecord,
};
use test_cabinet_core::test_case::{TestType, version_key};
use test_cabinet_entities::{
    case_reference_build, case_reference_sheet, coverage_group, coverage_plan, coverage_settings,
    harness_config, job, ladder, ladder_climber, ladder_outcome, ladder_rung, model, model_alias,
    model_price, publish_job, review, review_plan, review_revision, run, run_link, snapshot_state,
    tournament,
};

use crate::coverage::gate::{Gate, GateOutcome, GateThreshold, RungRun};
use crate::error::{BackendError, Result};

/// The non-terminal job states — a run the queue still owns, from enqueue through
/// execution. A job in one of these is "in flight": it appears in the active-run
/// list, counts toward coverage, and is cancelable. `queued` and `pending` have no
/// driver yet (the dispatcher will claim a `queued` one; a `pending` one is held
/// back because its harness is at its parallelism cap); `dispatched`, `starting`,
/// and `running` each have a driver Job coming up or executing.
const IN_FLIGHT_STATES: [&str; 5] = ["queued", "pending", "dispatched", "starting", "running"];

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

/// A stored run: the full record, its reviews, and its links. This is the shape
/// `GET /runs/{id}` and the snapshot's per-run file are built from. A run may be
/// pushed (private, [`published`](Self::published) false) or published; it may
/// carry zero reviews (while pending) or many.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredRun {
    /// The full run record, links populated.
    pub record: RunRecord,
    /// The run's reviews, oldest first. Empty while the run is still pending
    /// review; one per reviewing account once reviewed. The run's overall rating
    /// is the worst across them and its score the average.
    pub reviews: Vec<StoredReview>,
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
    /// The reviewer's per-domain ratings. This review's overall rating is the
    /// worst across them; the run's is the worst across all its reviews.
    pub ratings: Vec<DomainRating>,
    /// The markdown writeup body.
    pub writeup: String,
    /// The reviewer's verdicts on the case's declared checklist items. Stored as
    /// a JSON array in the `review.checklist` column. Empty for a case with no
    /// items.
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
    /// game jam), or one whose stored ratings JSON no longer parsed.
    pub ratings: Vec<DomainRating>,
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
    pub async fn push(
        &self,
        record: &RunRecord,
        links: &RunLinks,
        events_json: Option<&str>,
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
        // refreshed on every (re-)push; the review-derived columns (rating /
        // review_count) are NOT touched here — they are maintained by `add_review`,
        // and a re-push must preserve an already-reviewed run's aggregate. A brand-
        // new push writes the zero-review defaults (no rating, count 0).
        let lifted = lifted_run_metrics(&record);

        run::Entity::insert(run::ActiveModel {
            id: Set(record.id.clone()),
            started_at: Set(record.started_at.clone()),
            finished_at: Set(record.finished_at.clone()),
            published_at: Set(existing_published_at),
            test_case_slug: Set(record.subject.test_case_slug.clone()),
            test_case_version: Set(record.subject.test_case_version.clone()),
            variant: Set(record.subject.variant.clone()),
            harness_slug: Set(record.subject.harness_slug.as_str().to_string()),
            harness_version: Set(record.subject.harness_version.clone()),
            model_id: Set(record.subject.model_id.clone()),
            test_type: Set(lifted.test_type),
            run_state: Set(run_state_str(record.status.state).to_string()),
            run_time_seconds: Set(lifted.run_time_seconds),
            total_tokens: Set(lifted.total_tokens),
            cost_comparable: Set(lifted.cost_comparable),
            rating: Set(None),
            review_count: Set(0),
            loaded: Set(record.validation.loaded),
            published: Set(was_published),
            record_json: Set(record_json),
            events_json: Set(events_json.map(|s| s.to_string())),
        })
        .on_conflict(
            // Re-push updates the record and its lifted record-derived columns but
            // never the publish state (`Published`/`PublishedAt`, changed only by
            // `publish`) nor the review-derived `Rating`/`ReviewCount` (maintained
            // by `add_review`).
            OnConflict::column(run::Column::Id)
                .update_columns([
                    run::Column::StartedAt,
                    run::Column::FinishedAt,
                    run::Column::TestCaseSlug,
                    run::Column::TestCaseVersion,
                    run::Column::Variant,
                    run::Column::HarnessSlug,
                    run::Column::HarnessVersion,
                    run::Column::ModelId,
                    run::Column::TestType,
                    run::Column::RunState,
                    run::Column::RunTimeSeconds,
                    run::Column::TotalTokens,
                    run::Column::CostComparable,
                    run::Column::Loaded,
                    run::Column::RecordJson,
                    run::Column::EventsJson,
                ])
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
    /// Returns the run's current published state so the caller can decide whether the
    /// public snapshot needs refreshing. Errors with
    /// [`NotFound`](crate::error::BackendError::NotFound) when no run with `run_id` is
    /// stored.
    pub async fn add_review(
        &self,
        run_id: &str,
        review: &StoredReview,
        edit_note: Option<&str>,
    ) -> Result<bool> {
        let ratings_json = serde_json::to_string(&review.ratings)?;
        let checklist_json = serde_json::to_string(&review.checklist)?;

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
                let prior_ratings: Vec<DomainRating> = serde_json::from_str(&prior.ratings)?;
                let prior_checklist: Vec<ReviewVerdict> = serde_json::from_str(&prior.checklist)?;
                let diff = test_cabinet_core::review::diff_reviews(
                    &prior_ratings,
                    &prior.writeup,
                    &prior_checklist,
                    &review.ratings,
                    &review.writeup,
                    &review.checklist,
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
                        id: Set(uuid::Uuid::new_v4().to_string()),
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
            None => (
                uuid::Uuid::new_v4().to_string(),
                review.reviewed_at.clone(),
                None,
            ),
        };

        review::Entity::insert(review::ActiveModel {
            id: Set(id),
            run_id: Set(run_id.to_string()),
            reviewer_user_id: Set(review.reviewer.user_id.clone()),
            reviewer_username: Set(review.reviewer.username.clone()),
            reviewer_display_name: Set(review.reviewer.display_name.clone()),
            ratings: Set(ratings_json),
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
                    review::Column::Writeup,
                    review::Column::Checklist,
                    review::Column::EditedAt,
                ])
                .to_owned(),
        )
        .exec(&txn)
        .await?;

        // Recompute the lifted rating / review_count from the run's full review set
        // (including the review just written) so the console's sort columns stay in
        // step with the reviews table.
        let reviews = review::Entity::find()
            .filter(review::Column::RunId.eq(run_id))
            .all(&txn)
            .await?
            .into_iter()
            .map(stored_review)
            .collect::<Result<Vec<_>>>()?;
        let rating = lifted_rating(&reviews);
        let review_count = reviews.len() as i64;

        let published = run.published;
        let mut active = run.into_active_model();
        active.rating = Set(rating);
        active.review_count = Set(review_count);
        active.update(&txn).await?;

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

        // The gate (infrastructure → refuse; completed needs ≥1 review;
        // catastrophic/timed-out waived) is shared with
        // [`Db::ensure_publishable`], the publish-queue's at-enqueue check.
        gate_publishable(&txn, run_id, &run.run_state).await?;

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

        set_dirty(&txn).await?;

        txn.commit().await?;
        Ok(PublishRunOutcome { newly_published })
    }

    /// Delete a stored run and its dependent rows (its reviews and links cascade
    /// via their `ON DELETE CASCADE` foreign keys; its run- and publish-queue rows
    /// are deleted explicitly, as they reference the run by a plain column with no
    /// foreign key). Refused with
    /// [`crate::error::BackendError::Unprocessable`] when the run is **published**:
    /// a public run is in the snapshot and the gallery, so it can never be deleted
    /// out from under them. [`crate::error::BackendError::NotFound`] when no run
    /// with `run_id` is stored. Because only an unpublished run can be deleted, the
    /// run is not in the public snapshot and no refresh is needed.
    pub async fn delete_run(&self, run_id: &str) -> Result<()> {
        let txn = self.conn().begin().await?;

        let run = run::Entity::find_by_id(run_id.to_string())
            .one(&txn)
            .await?
            .ok_or_else(|| {
                crate::error::BackendError::NotFound(format!("run `{run_id}` not found"))
            })?;

        if run.published {
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
        let mut query = run::Entity::find().filter(run::Column::Published.eq(true));
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
        let mut query = run::Entity::find().filter(run::Column::Published.eq(false));
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
        let mut query = run::Entity::find()
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
    /// `assemble` preserves the input row order (it maps rows
    /// one-for-one, only skipping any that no longer deserialize), so the returned
    /// page stays in the sorted order.
    pub async fn list_summaries(
        &self,
        filter: &SummaryFilter,
        sort: SummarySort,
        dir: SortDir,
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
        let rows = apply_summary_sort(summary_query(filter, scope), sort, order.clone())
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
    /// does not (the toggle is off, or an exact [`SummaryFilter::version`] overrides
    /// it — see that field).
    async fn resolve_version_scope(
        &self,
        filter: &SummaryFilter,
    ) -> Result<Option<Vec<CaseVersions>>> {
        let exact = filter.version.as_deref().is_some_and(|s| !s.is_empty());
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
    pub async fn list_reviews_by_user(
        &self,
        user_id: &str,
        limit: usize,
        offset: usize,
    ) -> Result<(Vec<StoredRun>, usize)> {
        let total = review::Entity::find()
            .filter(review::Column::ReviewerUserId.eq(user_id))
            .count(&self.conn())
            .await? as usize;

        // The account's reviews, newest-first, windowed to this page. Each names its
        // run; the run ids (in this order) drive the returned run order.
        let review_rows = review::Entity::find()
            .filter(review::Column::ReviewerUserId.eq(user_id))
            .order_by_desc(review::Column::ReviewedAt)
            .order_by_desc(review::Column::Id)
            .limit(limit as u64)
            .offset(offset as u64)
            .all(&self.conn())
            .await?;
        let ordered_run_ids: Vec<String> = review_rows
            .into_iter()
            .map(|review| review.run_id)
            .collect();
        if ordered_run_ids.is_empty() {
            return Ok((Vec::new(), total));
        }

        // Load the runs by id, then restore the review-driven order (a `WHERE id IN`
        // query does not preserve the id list's order). A run id with no matching row
        // (a run deleted after the review, which the FK cascade normally prevents) is
        // simply dropped.
        let mut by_id: std::collections::HashMap<String, run::Model> = run::Entity::find()
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

        // Select only the three columns the charts need, joined to the review's run for
        // its subject. Column order here is the tuple order below.
        let rows: Vec<(String, String, String)> = review::Entity::find()
            .select_only()
            .column(run::Column::TestCaseSlug)
            .column(run::Column::ModelId)
            .column(review::Column::Ratings)
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
                |(test_case_slug, model_id, ratings_json)| RecentReviewSubject {
                    test_case_slug,
                    model_id,
                    ratings: serde_json::from_str(&ratings_json).unwrap_or_default(),
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
        let mut query =
            run::Entity::find().filter(run::Column::RunState.is_in(states.iter().copied()));
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
        let rows = run::Entity::find()
            .filter(run::Column::TestCaseSlug.eq(slug.to_string()))
            .order_by_desc(run::Column::FinishedAt)
            .order_by_desc(run::Column::Id)
            .all(&self.conn())
            .await?;
        self.assemble(rows).await
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
        let rows = run::Entity::find()
            .filter(run::Column::Published.eq(true))
            .order_by_desc(run::Column::PublishedAt)
            .order_by_desc(run::Column::Id)
            .all(&self.conn())
            .await?;
        self.assemble(rows).await
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

    /// The total number of published runs (the count that lands in the snapshot).
    pub async fn run_count(&self) -> Result<i64> {
        Ok(run::Entity::find()
            .filter(run::Column::Published.eq(true))
            .count(&self.conn())
            .await? as i64)
    }

    /// Assemble [`StoredRun`]s from `run` rows: batch-load their links and reviews
    /// and stitch them in. Keeps the per-run review fan-out to two queries total
    /// regardless of page size.
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
        for run in runs {
            // Tolerate a single record that no longer matches the current
            // `RunRecord` schema: skip it (with a warning) rather than failing the
            // whole page. A stored record can predate a contract change — e.g. an
            // animated-voxel run recorded before F-curve keyframes gained their
            // required `interp` field — and without this guard one such legacy row
            // would 500 an entire worklist, blanking the console. The record stays in
            // the DB for inspection; it simply does not appear in a listing.
            let record: RunRecord = match serde_json::from_str(&run.record_json) {
                Ok(record) => record,
                Err(err) => {
                    tracing::warn!(
                        run_id = %run.id,
                        error = %err,
                        "skipping run whose stored record no longer deserializes against the \
                         current RunRecord schema (likely predates a contract change)",
                    );
                    continue;
                }
            };
            let link = link_map.remove(&run.id);
            out.push(StoredRun {
                record,
                reviews: review_map.remove(&run.id).unwrap_or_default(),
                links: RunLinks {
                    source_repo: link.as_ref().and_then(|l| l.source_repo.clone()),
                    playable_build: link.and_then(|l| l.playable_build.clone()),
                },
                published: run.published,
                published_at: run.published_at,
                events_json: run.events_json,
            });
        }
        Ok(out)
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

/// The publish gate, factored out so both [`Db::publish`] (the legacy/desktop
/// flip) and [`Db::ensure_publishable`] (the publish-queue's at-enqueue check)
/// enforce it identically.
///
/// Publishability is decided by the run's terminal state. Infrastructure failures
/// are the Test Cabinet's fault, not a model result, and are never publishable.
/// Completed runs publish through the review gate (≥1 review). The publishable
/// failure tiers — catastrophic, timed-out, and harness-error —
/// are real model signal: publishable, but with no review checklist to complete, so the
/// review-count requirement is waived for them (they publish through the separate
/// publish-failures path).
async fn gate_publishable<C: ConnectionTrait>(
    conn: &C,
    run_id: &str,
    run_state: &str,
) -> Result<()> {
    if run_state == "infrastructure" {
        return Err(crate::error::BackendError::Unprocessable(format!(
            "run `{run_id}` is an infrastructure failure and can never be published"
        )));
    }
    let is_publishable_failure = publishable_failure_states().contains(&run_state);
    if !is_publishable_failure {
        let review_count = review::Entity::find()
            .filter(review::Column::RunId.eq(run_id))
            .count(conn)
            .await?;
        if review_count == 0 {
            return Err(crate::error::BackendError::Unprocessable(format!(
                "run `{run_id}` has no reviews — a run needs at least one review before it can be published"
            )));
        }
    }
    Ok(())
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
    let checklist: Vec<ReviewVerdict> = serde_json::from_str(&model.checklist)?;
    Ok(StoredReview {
        reviewer: Reviewer {
            user_id: model.reviewer_user_id,
            username: model.reviewer_username,
            display_name: model.reviewer_display_name,
        },
        ratings,
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
    /// End-to-end wall-clock time in seconds (`record.metrics.run_time_seconds`).
    run_time_seconds: f64,
    /// Total token count across every class — the same sum the UI's `totalTokens`
    /// shows — with an unreported/absent total stored as `0`.
    total_tokens: i64,
    /// Comparable cost (USD), or `None` when the cost is unknown.
    cost_comparable: Option<f64>,
}

/// Lift the record-derived sort columns out of a run's record. Reuses the core
/// [`TokenCounts::total`](test_cabinet_core::metrics::TokenCounts::total) so the
/// lifted `total_tokens` matches the UI's headline figure exactly.
fn lifted_run_metrics(record: &RunRecord) -> LiftedRunMetrics {
    LiftedRunMetrics {
        test_type: record.subject.test_type.as_str().to_string(),
        run_time_seconds: record.metrics.run_time_seconds,
        total_tokens: record.metrics.tokens.total().unwrap_or(0) as i64,
        cost_comparable: record.metrics.cost.comparable,
    }
}

/// The run's aggregate rating — the worst rating any reviewer gave any domain —
/// or `None` when the run carries no reviews. The single source of truth for the
/// lifted `run.rating` column and the snapshot's summary cards; wraps the core
/// [`aggregate_rating`](test_cabinet_core::review::aggregate_rating).
pub(crate) fn aggregate_review_rating(
    reviews: &[StoredReview],
) -> Option<test_cabinet_core::review::Rating> {
    test_cabinet_core::review::aggregate_rating(
        reviews.iter().map(|review| review.ratings.as_slice()),
    )
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
            buffer_target: Set(schedule.buffer_target.map(|target| target as i32)),
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
                buffer_target: row.buffer_target.map(|target| target.max(0) as u32),
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
                Expr::value(schedule.buffer_target.map(|target| target as i32)),
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
    /// `None` is deliberately not `0`: an account with no row has expressed no
    /// opinion, and the caller applies the backend's compiled-in default rather than
    /// the store materializing a row on read. An explicit `0` — "never top me up
    /// automatically" — is a different, storable instruction.
    pub async fn coverage_buffer_target(&self, user_id: &str) -> Result<Option<u32>> {
        Ok(coverage_settings::Entity::find_by_id(user_id.to_string())
            .one(&self.conn())
            .await?
            .map(|row| row.buffer_target.max(0) as u32))
    }

    /// Set an account's default buffer target, creating its settings row on first use.
    pub async fn set_coverage_buffer_target(
        &self,
        user_id: &str,
        buffer_target: u32,
        now: &str,
    ) -> Result<()> {
        coverage_settings::Entity::insert(coverage_settings::ActiveModel {
            user_id: Set(user_id.to_string()),
            buffer_target: Set(buffer_target as i32),
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
    /// `slugs`, in a single grouped query. The result is keyed by cell identity
    /// `(slug, version, variant, harness, model)`; a cell with no completed runs
    /// is simply absent. Only evaluable `completed` runs count toward a cell's
    /// target; the failure tiers do not.
    ///
    /// This computes the whole coverage matrix's completed counts at once, so the
    /// `coverage` handler does not fan out into a per-cell `COUNT(*)` — two queries
    /// per cell, thousands of serial round-trips for a large plan.
    pub async fn count_completed_runs_by_cell(&self, slugs: &[String]) -> Result<CellCounts> {
        if slugs.is_empty() {
            return Ok(CellCounts::new());
        }
        let rows: Vec<(String, String, String, String, String, i64)> = run::Entity::find()
            .select_only()
            .column(run::Column::TestCaseSlug)
            .column(run::Column::TestCaseVersion)
            .column(run::Column::Variant)
            .column(run::Column::HarnessSlug)
            .column(run::Column::ModelId)
            .column_as(run::Column::Id.count(), "cnt")
            .filter(run::Column::RunState.eq("completed"))
            .filter(run::Column::TestCaseSlug.is_in(slugs.iter().map(String::as_str)))
            .group_by(run::Column::TestCaseSlug)
            .group_by(run::Column::TestCaseVersion)
            .group_by(run::Column::Variant)
            .group_by(run::Column::HarnessSlug)
            .group_by(run::Column::ModelId)
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
        let rows: Vec<(String, String, String, String, String, i64)> = job::Entity::find()
            .select_only()
            .column(job::Column::TestCaseSlug)
            .column(job::Column::TestCaseVersion)
            .column(job::Column::Variant)
            .column(job::Column::HarnessSlug)
            .column(job::Column::ModelId)
            .column_as(job::Column::Id.count(), "cnt")
            .filter(job::Column::State.is_in(IN_FLIGHT_STATES))
            .filter(job::Column::TestCaseSlug.is_in(slugs.iter().map(String::as_str)))
            .group_by(job::Column::TestCaseSlug)
            .group_by(job::Column::TestCaseVersion)
            .group_by(job::Column::Variant)
            .group_by(job::Column::HarnessSlug)
            .group_by(job::Column::ModelId)
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
            .column(run::Column::HarnessSlug)
            .column(run::Column::ModelId)
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
        let rows: Vec<(String, String, String, String, String, i64)> = query
            .group_by(run::Column::TestCaseSlug)
            .group_by(run::Column::TestCaseVersion)
            .group_by(run::Column::Variant)
            .group_by(run::Column::HarnessSlug)
            .group_by(run::Column::ModelId)
            .into_tuple()
            .all(&self.conn())
            .await?;
        Ok(cell_counts(rows))
    }

    /// The requesting account's own verdict on every completed run of one cell, oldest
    /// first — the evidence a ladder's rung gate is evaluated from.
    ///
    /// `cell` is the same `(slug, version, variant, harness, launched model)` identity
    /// the grouped counts are keyed by, so a caller builds it exactly as it builds the
    /// key it looks a count up with. The model segment is the id the run was
    /// **launched** with (a provider-routed harness carries an `openrouter/` prefix the
    /// plan's canonical model omits); matching on anything else silently reads zero.
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
        let (slug, version, variant, harness, model) = cell;
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
            .filter(run::Column::HarnessSlug.eq(harness))
            .filter(run::Column::ModelId.eq(model))
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
    /// [`Db::coverage_buffer_target`]. `None` and `Some(0)` are different
    /// instructions — "no opinion" versus "never top up".
    pub buffer_target: Option<u32>,
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

/// A coverage cell's identity: `(slug, version, variant, harness, model)` — the
/// key both grouped-count queries return their tallies under.
pub type CellKey = (String, String, String, String, String);

/// Per-cell counts from a grouped coverage query, keyed by [`CellKey`].
pub type CellCounts = HashMap<CellKey, u32>;

/// Fold the `(slug, version, variant, harness, model, count)` rows a grouped
/// coverage query returns into a [`CellCounts`] map. The count is a SQL
/// `COUNT(*)` so it is non-negative; the clamp is defensive.
fn cell_counts(rows: Vec<(String, String, String, String, String, i64)>) -> CellCounts {
    rows.into_iter()
        .map(|(slug, version, variant, harness, model, count)| {
            (
                (slug, version, variant, harness, model),
                count.max(0) as u32,
            )
        })
        .collect()
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

// ---- Ladders --------------------------------------------------------------

/// The canonical key a ladder identifies one harness+model combination by:
/// `harness|model|provider`, with an empty trailing segment when the harness is not
/// provider-routed.
///
/// It encodes exactly the `(harness, model, provider)` triple the coverage resolver
/// de-dupes members on, so a key built here and a member resolved there are the same
/// combination by construction. `|` separates because a model id routinely contains
/// `/` (`anthropic/claude-opus-4.8`) and a separator that can appear inside a segment
/// is not a separator.
///
/// The **canonical** model is used, not the launched one: this key names a member of
/// the ladder, not a row in the `run` table, and the two differ for provider-routed
/// harnesses (see [`Db::cell_run_ratings`], which does want the launched id).
pub fn combination_key(combo: &crate::api::ReviewPlanCombo) -> String {
    format!(
        "{}|{}|{}",
        combo.harness.as_str(),
        combo.model,
        combo.provider.as_deref().unwrap_or_default()
    )
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

/// One rung of a [`StoredLadder`]: exactly one test case, pinned to an exact version
/// and variant.
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
    /// [`Db::coverage_buffer_target`].
    pub buffer_target: Option<u32>,
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
            buffer_target: Set(schedule.buffer_target.map(|target| target as i32)),
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
                buffer_target: row.buffer_target.map(|target| target.max(0) as u32),
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
                Expr::value(schedule.buffer_target.map(|target| target as i32)),
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

/// The lifted `run.rating` column value: the aggregate rating as its lowercase
/// wire token, or `None` when the run carries no reviews.
fn lifted_rating(reviews: &[StoredReview]) -> Option<String> {
    aggregate_review_rating(reviews).map(|rating| rating.as_str().to_string())
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
    /// **Every** stored run — published and unpublished alike, whatever its
    /// terminal state. The union of [`Self::Published`] and [`Self::Unpublished`],
    /// for the consoles' run listings, where an unpublished (and therefore
    /// unreviewed) run must take its place in the *same* sorted, paged listing as
    /// the published ones rather than being pinned ahead of them client-side.
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
    /// Free-text query matched case-insensitively (LIKE `%q%`) across
    /// `test_case_slug`, `model_id`, `harness_slug`, and `variant`.
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
    /// By test-case slug (`test_case_slug`).
    TestCase,
    /// By harness slug (`harness_slug`).
    Harness,
    /// By model id (`model_id`).
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

/// The `run` query narrowed to one lifecycle slice and nothing else — the base
/// both [`summary_query`] and the current-version resolution start from, so the
/// versions a `latest_versions` query is measured against come from exactly the
/// slice that query lists.
fn state_slice(state: SummaryState) -> Select<run::Entity> {
    let query = run::Entity::find();
    match state {
        SummaryState::Published => query.filter(run::Column::Published.eq(true)),
        SummaryState::Review => query.filter(run::Column::RunState.is_in(["completed"])),
        SummaryState::Failures => {
            query.filter(run::Column::RunState.is_in(publishable_failure_states()))
        }
        SummaryState::Unpublished => query.filter(run::Column::Published.eq(false)),
        // Mirrors `gate_publishable` as a query: not already public, never an
        // infrastructure failure, and either a publishable failure tier (no review
        // required) or a run someone has reviewed. Kept in step with the gate by
        // `publishable_slice_matches_the_publish_gate`.
        SummaryState::Publishable => query
            .filter(run::Column::Published.eq(false))
            .filter(run::Column::RunState.ne("infrastructure"))
            .filter(
                Condition::any()
                    .add(run::Column::RunState.is_in(publishable_failure_states()))
                    .add(run::Column::ReviewCount.gt(0)),
            ),
        SummaryState::Unreviewed => query
            .filter(run::Column::RunState.eq("completed"))
            .filter(run::Column::ReviewCount.eq(0))
            .filter(run::Column::TestType.is_not_in(AUTO_GRADED_TEST_TYPES)),
        // Every stored run: no lifecycle predicate at all.
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
    if let Some(test_case) = filter.test_case.as_deref().filter(|s| !s.is_empty()) {
        query = query.filter(run::Column::TestCaseSlug.eq(test_case));
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
    if let Some(q) = filter.q.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        // Lower both sides so the match is case-insensitive on any backend (SQLite's
        // LIKE is ASCII-case-insensitive already; lowering makes it explicit and
        // portable). OR across the searchable identity columns; AND'd with the rest.
        let pattern = format!("%{}%", q.to_lowercase());
        let text = Condition::any()
            .add(Expr::expr(Func::lower(run::Column::TestCaseSlug.into_expr())).like(&pattern))
            .add(Expr::expr(Func::lower(run::Column::ModelId.into_expr())).like(&pattern))
            .add(Expr::expr(Func::lower(run::Column::HarnessSlug.into_expr())).like(&pattern))
            .add(Expr::expr(Func::lower(run::Column::Variant.into_expr())).like(&pattern));
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
/// last regardless of `order`.
fn apply_summary_sort(
    query: Select<run::Entity>,
    sort: SummarySort,
    order: Order,
) -> Select<run::Entity> {
    match sort {
        SummarySort::Date => query.order_by(run::Column::StartedAt, order),
        SummarySort::Runtime => query.order_by(run::Column::RunTimeSeconds, order),
        SummarySort::Tokens => query.order_by(run::Column::TotalTokens, order),
        SummarySort::TestType => query.order_by(run::Column::TestType, order),
        SummarySort::TestCase => query.order_by(run::Column::TestCaseSlug, order),
        SummarySort::Harness => query.order_by(run::Column::HarnessSlug, order),
        SummarySort::Model => query.order_by(run::Column::ModelId, order),
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
/// timed-out, and harness-error — the slice every failures-only
/// query and publish gate filters on.
///
/// Derived from [`RunState::is_publishable_failure`] rather than written out, so a
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
        RunState::Hung => "hung",
        RunState::Infrastructure => "infrastructure",
    }
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
        job_token: Set(new.job_token),
        record_id: Set(None),
        detail: Set(None),
        attempt: Set(new.attempt),
        user_id: Set(new.user_id),
        origin: Set(new.origin.as_ref().map(JobOrigin::as_token)),
        created_at: Set(new.created_at.clone()),
        updated_at: Set(new.created_at),
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
        // Each row binds ~16 columns; a 1000-row chunk is ~16k parameters, well
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
    pub async fn claim_next_job(&self, now: &str) -> Result<Option<job::Model>> {
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
            let target = if has_room { "queued" } else { "pending" };
            if job.state != target {
                let mut active_model = job.into_active_model();
                active_model.state = Set(target.to_string());
                active_model.updated_at = Set(now.to_string());
                active_model.update(&txn).await?;
            }
        }

        txn.commit().await?;
        Ok(claimed)
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
        let mut active = model.into_active_model();
        active.state = Set(state.to_string());
        active.updated_at = Set(now.to_string());
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
        gate_publishable(&self.conn(), run_id, &run.run_state).await
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
                id: Set(uuid::Uuid::new_v4().to_string()),
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

            let mut active = row.into_active_model();
            active.model_id = Set(base);
            // Keep the lifted cost column in step with the record's recomputed cost.
            active.cost_comparable = Set(comparable);
            active.record_json = Set(record_json);
            active.update(&self.conn()).await?;
            rewritten += 1;
        }
        Ok(rewritten)
    }

    /// Backfill the sort/filter columns lifted onto the `run` row after rows
    /// already existed (`test_type`, `run_time_seconds`, `total_tokens`,
    /// `cost_comparable`, `rating`, `review_count`): parse each un-backfilled row's
    /// record for the record-derived columns and compute `rating` / `review_count`
    /// from its reviews.
    ///
    /// Idempotent: a row is "un-backfilled" iff its `test_type` is still the empty
    /// string the migration's default stamped — a value no real run carries, since
    /// every write sets a kebab-case token. A second boot (or a store whose rows
    /// were all written with the columns already populated) therefore does no work.
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
            let rating = lifted_rating(reviews);
            let review_count = reviews.len() as i64;

            let mut active = row.into_active_model();
            active.test_type = Set(lifted.test_type);
            active.run_time_seconds = Set(lifted.run_time_seconds);
            active.total_tokens = Set(lifted.total_tokens);
            active.cost_comparable = Set(lifted.cost_comparable);
            active.rating = Set(rating);
            active.review_count = Set(review_count);
            active.update(&self.conn()).await?;
            backfilled += 1;
        }
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
        url: &str,
        now: &str,
    ) -> Result<()> {
        case_reference_build::Entity::insert(case_reference_build::ActiveModel {
            slug: Set(slug.to_string()),
            version: Set(version.to_string()),
            variant: Set(variant.to_string()),
            url: Set(url.to_string()),
            updated_at: Set(now.to_string()),
        })
        .on_conflict(
            OnConflict::columns([
                case_reference_build::Column::Slug,
                case_reference_build::Column::Version,
                case_reference_build::Column::Variant,
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

    /// The reference-build URL of every variant of `(slug, version)` that has one,
    /// keyed by variant slug. Feeds the version response and the snapshot, both of
    /// which fold the URL onto each variant object; a variant absent from the map
    /// simply has no reference implementation.
    pub async fn reference_builds_for_version(
        &self,
        slug: &str,
        version: &str,
    ) -> Result<std::collections::HashMap<String, String>> {
        Ok(case_reference_build::Entity::find()
            .filter(case_reference_build::Column::Slug.eq(slug))
            .filter(case_reference_build::Column::Version.eq(version))
            .all(&self.conn())
            .await?
            .into_iter()
            .map(|row| (row.variant, row.url))
            .collect())
    }

    /// Reconcile the **entire** reference-build table to `desired` — the complete set
    /// of deployed reference URLs for this backend's environment, read from the
    /// committed reference-builds lockfile at ingest (see the `/ingest` handler).
    /// Every triple in `desired` is upserted; every stored triple absent from
    /// `desired` is removed. The lockfile is the single source of truth, so this
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
        let current: std::collections::HashMap<(String, String, String), String> =
            case_reference_build::Entity::find()
                .all(&self.conn())
                .await?
                .into_iter()
                .map(|row| ((row.slug, row.version, row.variant), row.url))
                .collect();
        let desired_keys: std::collections::HashSet<(String, String, String)> = desired
            .iter()
            .map(|e| (e.slug.clone(), e.version.clone(), e.variant.clone()))
            .collect();

        let mut changed = false;

        // Upsert triples that are new or whose served URL moved.
        for entry in desired {
            let key = (
                entry.slug.clone(),
                entry.version.clone(),
                entry.variant.clone(),
            );
            if current.get(&key).map(String::as_str) != Some(entry.url.as_str()) {
                self.upsert_reference_build(
                    &entry.slug,
                    &entry.version,
                    &entry.variant,
                    &entry.url,
                    now,
                )
                .await?;
                changed = true;
            }
        }

        // Remove triples the lockfile no longer lists.
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
    HarnessSlug::ALL
        .into_iter()
        .find(|h| h.as_str() == slug)
        .unwrap_or(HarnessSlug::Claude)
}

#[cfg(test)]
#[path = "db.test.rs"]
mod tests;
