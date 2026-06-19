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
use sea_orm::sea_query::OnConflict;
use sea_orm::{
    ColumnTrait, ConnectOptions, ConnectionTrait, Database, DatabaseBackend, DatabaseConnection,
    EntityTrait, FromQueryResult, JoinType, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect,
    RelationTrait, Select, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use test_cabinet_core::review::{Rating, ReviewVerdict};
use test_cabinet_core::run_record::{RunLinks, RunRecord};
use test_cabinet_entities::{review, run, run_link, snapshot_state};

use crate::error::{BackendError, Result};

/// A published run as stored: the full record, its review, and its links. This
/// is the shape `GET /runs/{id}` and the snapshot's per-run file are built from.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredRun {
    /// The full run record, links populated.
    pub record: RunRecord,
    /// The review (rating + writeup body).
    pub review: StoredReview,
    /// The resolved links.
    pub links: RunLinks,
    /// RFC 3339 of when this run was first published (the snapshot card's
    /// `publishedAt`). Not part of the run record itself.
    pub published_at: String,
    /// The run's recorded normalized event stream, stored verbatim as a JSON
    /// array string (the `run.events_json` column). `None` for a run that
    /// recorded none. Re-emitted into the snapshot and served by
    /// `GET /runs/{id}/events`.
    pub events_json: Option<String>,
}

/// A run's review as stored.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredReview {
    /// The quality rating.
    pub rating: Rating,
    /// The markdown writeup body.
    pub writeup: String,
    /// The reviewer's verdicts on the case's declared checklist items. Stored as
    /// a JSON array in the `review.checklist` column. Empty for a case with no
    /// items.
    pub checklist: Vec<ReviewVerdict>,
}

/// The outcome of publishing a run into the store.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PublishOutcome {
    /// Whether the run was newly inserted (vs. an idempotent re-publish).
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

    /// Publish a run: upsert the record (verbatim JSON + lifted columns), its
    /// review, and its links in one transaction. Idempotent on `record.id`: a
    /// re-publish updates the review, links, and the record blob (with links
    /// rewritten on) but **keeps** the original `published_at`.
    pub async fn publish(
        &self,
        record: &RunRecord,
        review: &StoredReview,
        links: &RunLinks,
        published_at: &str,
        events_json: Option<&str>,
    ) -> Result<PublishOutcome> {
        // The stored record always carries the resolved links, so the snapshot's
        // record blob and its `links` sibling never disagree.
        let mut record = record.clone();
        record.links = links.clone();
        let record_json = serde_json::to_string(&record)?;
        let checklist_json = serde_json::to_string(&review.checklist)?;

        let txn = self.conn.begin().await?;

        let existing_published_at = run::Entity::find_by_id(record.id.clone())
            .one(&txn)
            .await?
            .map(|model| model.published_at);
        let newly_published = existing_published_at.is_none();
        // Preserve the first publish's timestamp on re-publish.
        let effective_published_at =
            existing_published_at.unwrap_or_else(|| published_at.to_string());

        run::Entity::insert(run::ActiveModel {
            id: Set(record.id.clone()),
            started_at: Set(record.started_at.clone()),
            finished_at: Set(record.finished_at.clone()),
            published_at: Set(effective_published_at),
            test_case_slug: Set(record.subject.test_case_slug.clone()),
            test_case_version: Set(record.subject.test_case_version.clone()),
            variant: Set(record.subject.variant.clone()),
            harness_slug: Set(record.subject.harness_slug.as_str().to_string()),
            harness_version: Set(record.subject.harness_version.clone()),
            model_id: Set(record.subject.model_id.clone()),
            run_state: Set(run_state_str(record.status.state).to_string()),
            loaded: Set(record.validation.loaded),
            record_json: Set(record_json),
            events_json: Set(events_json.map(|s| s.to_string())),
        })
        .on_conflict(
            // Re-publish updates everything except the id and the preserved
            // `published_at` (the latter is already the original value here).
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

        review::Entity::insert(review::ActiveModel {
            run_id: Set(record.id.clone()),
            rating: Set(review.rating.as_str().to_string()),
            writeup: Set(review.writeup.clone()),
            checklist: Set(checklist_json),
        })
        .on_conflict(
            OnConflict::column(review::Column::RunId)
                .update_columns([
                    review::Column::Rating,
                    review::Column::Writeup,
                    review::Column::Checklist,
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

        // Mark the snapshot dirty within the same transaction so a publish and
        // its coalescing flag commit atomically.
        set_dirty(&txn).await?;

        txn.commit().await?;
        Ok(PublishOutcome { newly_published })
    }

    /// Fetch one stored run by id.
    pub async fn get_run(&self, id: &str) -> Result<Option<StoredRun>> {
        stored_run_query()
            .filter(run::Column::Id.eq(id))
            .into_model::<StoredRunRow>()
            .one(&self.conn)
            .await?
            .map(StoredRunRow::into_stored_run)
            .transpose()
    }

    /// List stored runs newest-first (by `published_at`), paginated by a
    /// `published_at` cursor. Returns at most `limit` runs and the next cursor
    /// (the last row's `published_at`) when more may remain.
    pub async fn list_runs(
        &self,
        limit: usize,
        before: Option<&str>,
    ) -> Result<(Vec<StoredRun>, Option<String>)> {
        // Fetch one extra row to decide whether a next cursor exists.
        let fetch = limit.saturating_add(1);
        let mut query = stored_run_query();
        if let Some(before) = before {
            query = query.filter(run::Column::PublishedAt.lt(before));
        }
        let rows = query
            .order_by_desc(run::Column::PublishedAt)
            .order_by_desc(run::Column::Id)
            .limit(fetch as u64)
            .into_model::<StoredRunRow>()
            .all(&self.conn)
            .await?;

        let mut runs = rows
            .into_iter()
            .map(StoredRunRow::into_stored_run)
            .collect::<Result<Vec<_>>>()?;

        // More rows than the page size means a next cursor exists; drop the
        // probe row and cursor on the last returned run's timestamp.
        let next_before = if runs.len() > limit {
            runs.truncate(limit);
            runs.last().map(|run| run.published_at.clone())
        } else {
            None
        };
        Ok((runs, next_before))
    }

    /// Load every stored run, newest-first, for full snapshot regeneration.
    pub async fn all_runs(&self) -> Result<Vec<StoredRun>> {
        let rows = stored_run_query()
            .order_by_desc(run::Column::PublishedAt)
            .order_by_desc(run::Column::Id)
            .into_model::<StoredRunRow>()
            .all(&self.conn)
            .await?;
        rows.into_iter()
            .map(StoredRunRow::into_stored_run)
            .collect()
    }

    /// The total number of published runs.
    pub async fn run_count(&self) -> Result<i64> {
        Ok(run::Entity::find().count(&self.conn).await? as i64)
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

/// The shared joined projection every `StoredRun` query selects: the eight
/// columns of [`StoredRunRow`], from `run` joined to its `review` and `run_link`.
fn stored_run_query() -> Select<run::Entity> {
    run::Entity::find()
        .select_only()
        .column(run::Column::RecordJson)
        .column(review::Column::Rating)
        .column(review::Column::Writeup)
        .column(run_link::Column::SourceRepo)
        .column(run_link::Column::PlayableBuild)
        .column(run::Column::PublishedAt)
        .column(review::Column::Checklist)
        .column(run::Column::EventsJson)
        .join(JoinType::InnerJoin, run::Relation::Review.def())
        .join(JoinType::InnerJoin, run::Relation::RunLink.def())
}

/// A joined row from [`stored_run_query`], decoded into a [`StoredRun`].
#[derive(FromQueryResult)]
struct StoredRunRow {
    record_json: String,
    rating: String,
    writeup: String,
    source_repo: Option<String>,
    playable_build: Option<String>,
    published_at: String,
    checklist: String,
    events_json: Option<String>,
}

impl StoredRunRow {
    /// Parse the JSON-backed columns into the in-memory [`StoredRun`].
    fn into_stored_run(self) -> Result<StoredRun> {
        let record: RunRecord = serde_json::from_str(&self.record_json)?;
        let rating = Rating::parse(&self.rating).ok_or_else(|| {
            BackendError::BadRequest(format!(
                "stored review has invalid rating `{}`",
                self.rating
            ))
        })?;
        let checklist: Vec<ReviewVerdict> = serde_json::from_str(&self.checklist)?;
        Ok(StoredRun {
            record,
            review: StoredReview {
                rating,
                writeup: self.writeup,
                checklist,
            },
            links: RunLinks {
                source_repo: self.source_repo,
                playable_build: self.playable_build,
            },
            published_at: self.published_at,
            events_json: self.events_json,
        })
    }
}

/// The wire string for a run state (matching the serde representation).
fn run_state_str(state: test_cabinet_core::run_record::RunState) -> &'static str {
    use test_cabinet_core::run_record::RunState;
    match state {
        RunState::Completed => "completed",
        RunState::Failed => "failed",
        RunState::Unevaluable => "unevaluable",
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

#[cfg(test)]
#[path = "db.test.rs"]
mod tests;
