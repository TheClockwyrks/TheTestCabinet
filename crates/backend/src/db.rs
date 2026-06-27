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

use std::path::{Path, PathBuf};

use sea_orm::ActiveValue::{NotSet, Set};
use sea_orm::sea_query::{Expr, OnConflict};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectOptions, ConnectionTrait, Database, DatabaseBackend,
    DatabaseConnection, EntityTrait, IntoActiveModel, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use test_cabinet_core::match_play::TournamentRecord;
use test_cabinet_core::review::{DomainRating, ReviewVerdict};
use test_cabinet_core::run_record::{RunLinks, RunRecord};
use test_cabinet_entities::{job, review, run, run_link, snapshot_state, tournament};

use crate::error::Result;

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
    /// RFC 3339 of when the review was submitted (or last updated).
    pub reviewed_at: String,
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
    conn: DatabaseConnection,
}

impl Db {
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
        Ok(Self { conn })
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
        Ok(Self { conn })
    }

    /// The underlying connection, for the startup migration in [`crate::build`].
    pub fn connection(&self) -> &DatabaseConnection {
        &self.conn
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

        let txn = self.conn.begin().await?;

        let existing = run::Entity::find_by_id(record.id.clone()).one(&txn).await?;
        let newly_pushed = existing.is_none();
        let was_published = existing
            .as_ref()
            .map(|model| model.published)
            .unwrap_or(false);
        let existing_published_at = existing.and_then(|model| model.published_at);

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
            run_state: Set(run_state_str(record.status.state).to_string()),
            loaded: Set(record.validation.loaded),
            published: Set(was_published),
            record_json: Set(record_json),
            events_json: Set(events_json.map(|s| s.to_string())),
        })
        .on_conflict(
            // Re-push updates the record and lifted columns but never the publish
            // state (`Published`/`PublishedAt`), which only `publish` changes.
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
                    run::Column::RunState,
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
    /// updates that review rather than adding another. Returns the run's current
    /// published state so the caller can decide whether the public snapshot needs
    /// refreshing. Errors with [`crate::error::BackendError::NotFound`] when no
    /// run with `run_id` is stored.
    pub async fn add_review(&self, run_id: &str, review: &StoredReview) -> Result<bool> {
        let ratings_json = serde_json::to_string(&review.ratings)?;
        let checklist_json = serde_json::to_string(&review.checklist)?;

        let txn = self.conn.begin().await?;

        let run = run::Entity::find_by_id(run_id.to_string())
            .one(&txn)
            .await?
            .ok_or_else(|| {
                crate::error::BackendError::NotFound(format!("run `{run_id}` not found"))
            })?;

        // Reuse the existing review id for this (run, reviewer) pair so a
        // re-submission updates in place; mint a fresh id for a first review.
        let existing = review::Entity::find()
            .filter(review::Column::RunId.eq(run_id))
            .filter(review::Column::ReviewerUserId.eq(&review.reviewer.user_id))
            .one(&txn)
            .await?;
        let id = existing
            .map(|model| model.id)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        review::Entity::insert(review::ActiveModel {
            id: Set(id),
            run_id: Set(run_id.to_string()),
            reviewer_user_id: Set(review.reviewer.user_id.clone()),
            reviewer_username: Set(review.reviewer.username.clone()),
            reviewer_display_name: Set(review.reviewer.display_name.clone()),
            ratings: Set(ratings_json),
            writeup: Set(review.writeup.clone()),
            checklist: Set(checklist_json),
            reviewed_at: Set(review.reviewed_at.clone()),
        })
        .on_conflict(
            OnConflict::column(review::Column::Id)
                .update_columns([
                    review::Column::ReviewerUsername,
                    review::Column::ReviewerDisplayName,
                    review::Column::Ratings,
                    review::Column::Writeup,
                    review::Column::Checklist,
                    review::Column::ReviewedAt,
                ])
                .to_owned(),
        )
        .exec(&txn)
        .await?;

        // A new/updated review changes a published run's aggregate rating and
        // score, so refresh the snapshot; a pending run is not public.
        if run.published {
            set_dirty(&txn).await?;
        }

        txn.commit().await?;
        Ok(run.published)
    }

    /// Publish a stored run: flip it public. Refused with
    /// [`crate::error::BackendError::Unprocessable`] when the run is an
    /// infrastructure failure (never publishable) or when a *completed* run has no
    /// review yet; the publishable failure tiers (catastrophic, timed-out) need no
    /// review. [`crate::error::BackendError::NotFound`] when no run with `run_id` is
    /// stored. Idempotent: re-publishing an already-published run preserves its
    /// original `published_at`. Stamps `published_at` on the first publish.
    pub async fn publish(&self, run_id: &str, published_at: &str) -> Result<PublishRunOutcome> {
        let txn = self.conn.begin().await?;

        let run = run::Entity::find_by_id(run_id.to_string())
            .one(&txn)
            .await?
            .ok_or_else(|| {
                crate::error::BackendError::NotFound(format!("run `{run_id}` not found"))
            })?;

        // Publishability is decided by the run's terminal state. Infrastructure
        // failures are the Test Cabinet's fault, not a model result, and are never
        // publishable. Completed runs publish through the review gate (≥1 review).
        // The publishable failure tiers — catastrophic and timed-out — are real
        // model signal: publishable, but with no review checklist to complete, so
        // the review-count requirement is waived for them (they publish through the
        // separate publish-failures path).
        if run.run_state == "infrastructure" {
            return Err(crate::error::BackendError::Unprocessable(format!(
                "run `{run_id}` is an infrastructure failure and can never be published"
            )));
        }
        let is_publishable_failure = matches!(run.run_state.as_str(), "catastrophic" | "timed_out");
        if !is_publishable_failure {
            let review_count = review::Entity::find()
                .filter(review::Column::RunId.eq(run_id))
                .count(&txn)
                .await?;
            if review_count == 0 {
                return Err(crate::error::BackendError::Unprocessable(format!(
                    "run `{run_id}` has no reviews — a run needs at least one review before it can be published"
                )));
            }
        }

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
    /// via their `ON DELETE CASCADE` foreign keys). Refused with
    /// [`crate::error::BackendError::Unprocessable`] when the run is **published**:
    /// a public run is in the snapshot and the gallery, so it can never be deleted
    /// out from under them. [`crate::error::BackendError::NotFound`] when no run
    /// with `run_id` is stored. Because only an unpublished run can be deleted, the
    /// run is not in the public snapshot and no refresh is needed.
    pub async fn delete_run(&self, run_id: &str) -> Result<()> {
        let txn = self.conn.begin().await?;

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
        // the run removes them too. The job that produced the run is part of the
        // queue's history (no foreign key back to the run) and is left intact.
        run::Entity::delete_by_id(run_id.to_string())
            .exec(&txn)
            .await?;

        txn.commit().await?;
        Ok(())
    }

    /// Fetch one stored run by id (published or pending).
    pub async fn get_run(&self, id: &str) -> Result<Option<StoredRun>> {
        let run = run::Entity::find_by_id(id.to_string())
            .one(&self.conn)
            .await?;
        let Some(run) = run else {
            return Ok(None);
        };
        Ok(self.assemble(vec![run]).await?.into_iter().next())
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
            .all(&self.conn)
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

    /// List the **publishable failure** runs — catastrophic and timed-out (pending
    /// and published) — newest-first by `finished_at`, paginated by a `finished_at`
    /// cursor. These have no review checklist, so they are kept out of the reviewer
    /// worklist and surfaced in their own "publish failures" affordance, where each
    /// can be published with a single click. Infrastructure failures are excluded:
    /// they are retained for inspection but never publishable.
    pub async fn list_publishable_failures(
        &self,
        limit: usize,
        before: Option<&str>,
    ) -> Result<(Vec<StoredRun>, Option<String>)> {
        self.list_by_states(&["catastrophic", "timed_out"], limit, before)
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
            .all(&self.conn)
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
            .all(&self.conn)
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
            .all(&self.conn)
            .await?;
        self.assemble(rows).await
    }

    /// Load every **published** run, newest-first, for full snapshot
    /// regeneration. Pending (unpublished) runs are excluded — the public
    /// snapshot only ever contains published runs.
    pub async fn all_published(&self) -> Result<Vec<StoredRun>> {
        let rows = run::Entity::find()
            .filter(run::Column::Published.eq(true))
            .order_by_desc(run::Column::PublishedAt)
            .order_by_desc(run::Column::Id)
            .all(&self.conn)
            .await?;
        self.assemble(rows).await
    }

    /// The total number of published runs (the count that lands in the snapshot).
    pub async fn run_count(&self) -> Result<i64> {
        Ok(run::Entity::find()
            .filter(run::Column::Published.eq(true))
            .count(&self.conn)
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
                .all(&self.conn)
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
            .all(&self.conn)
            .await?;
        for review in reviews {
            let run_id = review.run_id.clone();
            review_map
                .entry(run_id)
                .or_default()
                .push(stored_review(review)?);
        }

        let mut out = Vec::with_capacity(runs.len());
        for run in runs {
            let record: RunRecord = serde_json::from_str(&run.record_json)?;
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

        let txn = self.conn.begin().await?;
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
            .one(&self.conn)
            .await?
            .map(stored_tournament)
            .transpose()
    }

    /// List stored tournaments newest-first (by `published_at`), paginated by a
    /// `published_at` cursor — the same scheme as [`Db::list_runs`].
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
            .all(&self.conn)
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
            .one(&self.conn)
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
        set_dirty(&self.conn).await
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
        .exec(&self.conn)
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

/// Decode a `review` row into the in-memory [`StoredReview`], parsing its
/// JSON-backed ratings/checklist columns.
fn stored_review(model: review::Model) -> Result<StoredReview> {
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

/// The wire string for a run state (matching the serde representation).
fn run_state_str(state: test_cabinet_core::run_record::RunState) -> &'static str {
    use test_cabinet_core::run_record::RunState;
    match state {
        RunState::Completed => "completed",
        RunState::Catastrophic => "catastrophic",
        RunState::TimedOut => "timed_out",
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

/// A run to enqueue: the minted id and token, the verbatim launch request, and
/// the identity columns lifted out of it for the active-run list.
pub struct NewJob {
    /// The job id, minted by the backend at enqueue.
    pub id: String,
    /// The launch request serialized verbatim (the `RunRequest` HTTP shape).
    pub request_json: String,
    /// The test-case slug, lifted for the active-run list.
    pub test_case_slug: String,
    /// The variant, lifted for the active-run list.
    pub variant: String,
    /// The harness slug, lifted for the active-run list.
    pub harness_slug: String,
    /// The opaque model id, lifted for the active-run list.
    pub model_id: String,
    /// The per-job bearer token the driver authenticates its streaming with.
    pub job_token: String,
    /// RFC 3339 of enqueue (the claim-ordering key, also the initial update time).
    pub created_at: String,
}

/// The run-queue operations on the store: enqueue, claim, advance, read. A job is
/// the lifecycle of a requested run; the produced [`RunRecord`] lands via
/// [`Db::push`] like any other.
impl Db {
    /// Enqueue a run: insert it in the `queued` state for the dispatcher to claim.
    pub async fn enqueue_job(&self, new: NewJob) -> Result<()> {
        job::Entity::insert(job::ActiveModel {
            id: Set(new.id),
            state: Set("queued".to_string()),
            request_json: Set(new.request_json),
            test_case_slug: Set(new.test_case_slug),
            variant: Set(new.variant),
            harness_slug: Set(new.harness_slug),
            model_id: Set(new.model_id),
            job_token: Set(new.job_token),
            record_id: Set(None),
            detail: Set(None),
            created_at: Set(new.created_at.clone()),
            updated_at: Set(new.created_at),
        })
        .exec(&self.conn)
        .await?;
        Ok(())
    }

    /// Atomically claim the oldest `queued` job, flipping it to `dispatched`, and
    /// return it (or `None` when the queue is empty). The select-then-update runs
    /// in one transaction; SQLite serializes writers (single-writer WAL), so two
    /// dispatchers cannot claim the same job.
    pub async fn claim_next_job(&self, now: &str) -> Result<Option<job::Model>> {
        let txn = self.conn.begin().await?;
        let candidate = job::Entity::find()
            .filter(job::Column::State.eq("queued"))
            .order_by_asc(job::Column::CreatedAt)
            .order_by_asc(job::Column::Id)
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

    /// Advance a job to a new state, stamping `updated_at` and — when supplied —
    /// the terminal `detail` (a failure reason) and `record_id` (the produced
    /// run). Returns the updated row, or `None` when no job with `id` is stored.
    pub async fn set_job_state(
        &self,
        id: &str,
        state: &str,
        now: &str,
        detail: Option<&str>,
        record_id: Option<&str>,
    ) -> Result<Option<job::Model>> {
        let Some(model) = job::Entity::find_by_id(id.to_string())
            .one(&self.conn)
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
        Ok(Some(active.update(&self.conn).await?))
    }

    /// Fetch one job by id.
    pub async fn get_job(&self, id: &str) -> Result<Option<job::Model>> {
        Ok(job::Entity::find_by_id(id.to_string())
            .one(&self.conn)
            .await?)
    }

    /// Fail every job mid-execution (`dispatched` or `running`) in one update,
    /// stamping `updated_at` and the supplied terminal `detail`. Returns how many
    /// were reaped.
    ///
    /// This is the single-box backend's startup reconciliation (see
    /// [`crate::build`]): when the whole stack shares one machine, a backend
    /// restart means every in-flight driver went down with it, so any job the
    /// store still believes is executing is orphaned — it can never reach a
    /// terminal state on its own and would otherwise show as forever "running".
    /// `queued` jobs are deliberately left untouched: they have no driver yet, so
    /// the dispatcher drains them normally once it reconnects.
    pub async fn fail_in_flight_jobs(&self, now: &str, detail: &str) -> Result<u64> {
        let result = job::Entity::update_many()
            .col_expr(job::Column::State, Expr::value("failed"))
            .col_expr(job::Column::UpdatedAt, Expr::value(now))
            .col_expr(job::Column::Detail, Expr::value(detail))
            .filter(job::Column::State.is_in(["dispatched", "running"]))
            .exec(&self.conn)
            .await?;
        Ok(result.rows_affected)
    }

    /// Every job still in flight (`queued`, `dispatched`, or `running`),
    /// oldest-first by enqueue time. This is the console's active-run list: a run
    /// it is watching survives a page reload because the backend remembers it.
    pub async fn active_jobs(&self) -> Result<Vec<job::Model>> {
        Ok(job::Entity::find()
            .filter(job::Column::State.is_in(["queued", "dispatched", "running"]))
            .order_by_asc(job::Column::CreatedAt)
            .order_by_asc(job::Column::Id)
            .all(&self.conn)
            .await?)
    }
}

#[cfg(test)]
#[path = "db.test.rs"]
mod tests;
