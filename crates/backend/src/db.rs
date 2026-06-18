//! The SQLite store: the system of record for published runs (§2 of
//! `design/v0.2.0-contracts.md`).
//!
//! A single embedded SQLite file holds every published run as a verbatim
//! `RunRecord` JSON blob (so the snapshot re-emits it without reserialization
//! drift) plus lifted columns for ordering/pagination, and the run's review and
//! links in sibling tables. Definitions/screenshots are **not** here — they live
//! in the on-disk [`crate::store`].
//!
//! Access is serialized behind a `Mutex<Connection>`: SQLite is single-writer,
//! the backend's write volume is low (a publish at a time, coalesced), and a
//! single connection sidesteps WAL-writer contention. Reads are quick enough that
//! holding the same lock is fine for v0.2.0.

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use test_cabinet_core::review::{Rating, ReviewVerdict};
use test_cabinet_core::run_record::{RunLinks, RunRecord};

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
    /// items, or a run published before the field existed.
    #[serde(default)]
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

/// The embedded SQLite store.
pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    /// Open (creating if necessary) the SQLite store at `path` and apply the
    /// schema. Idempotent: re-opening an existing store is a no-op beyond the
    /// pragmas. The parent directory is created so a fresh deployment works.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        if let Some(parent) = path.parent()
            && !parent.as_os_str().is_empty()
        {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        Self::init(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Open an in-memory store (used by tests).
    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        Self::init(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Apply the schema and pragmas (§2).
    fn init(conn: &Connection) -> Result<()> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.execute_batch(SCHEMA)?;
        Ok(())
    }

    /// Publish a run: upsert the record (verbatim JSON + lifted columns), its
    /// review, and its links in one transaction. Idempotent on `record.id`: a
    /// re-publish updates the review, links, and the record blob (with links
    /// rewritten on) but **keeps** the original `published_at`.
    pub fn publish(
        &self,
        record: &RunRecord,
        review: &StoredReview,
        links: &RunLinks,
        published_at: &str,
    ) -> Result<PublishOutcome> {
        // The stored record always carries the resolved links, so the snapshot's
        // record blob and its `links` sibling never disagree.
        let mut record = record.clone();
        record.links = links.clone();
        let record_json = serde_json::to_string(&record)?;

        let mut conn = self.conn.lock().expect("db mutex poisoned");
        let tx = conn.transaction()?;

        let existing_published_at: Option<String> = tx
            .query_row(
                "SELECT published_at FROM run WHERE id = ?1",
                params![record.id],
                |row| row.get(0),
            )
            .optional()?;
        let newly_published = existing_published_at.is_none();
        // Preserve the first publish's timestamp on re-publish.
        let effective_published_at =
            existing_published_at.unwrap_or_else(|| published_at.to_string());

        tx.execute(
            "INSERT INTO run (
                id, started_at, finished_at, published_at,
                test_case_slug, test_case_version, variant,
                harness_slug, harness_version, model_id,
                run_state, loaded, record_json
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)
             ON CONFLICT(id) DO UPDATE SET
                started_at = excluded.started_at,
                finished_at = excluded.finished_at,
                test_case_slug = excluded.test_case_slug,
                test_case_version = excluded.test_case_version,
                variant = excluded.variant,
                harness_slug = excluded.harness_slug,
                harness_version = excluded.harness_version,
                model_id = excluded.model_id,
                run_state = excluded.run_state,
                loaded = excluded.loaded,
                record_json = excluded.record_json",
            params![
                record.id,
                record.started_at,
                record.finished_at,
                effective_published_at,
                record.subject.test_case_slug,
                record.subject.test_case_version,
                record.subject.variant,
                record.subject.harness_slug.as_str(),
                record.subject.harness_version,
                record.subject.model_id,
                run_state_str(record.status.state),
                record.validation.loaded as i64,
                record_json,
            ],
        )?;

        let checklist_json = serde_json::to_string(&review.checklist)?;
        tx.execute(
            "INSERT INTO review (run_id, rating, writeup, checklist) VALUES (?1,?2,?3,?4)
             ON CONFLICT(run_id) DO UPDATE SET
                rating = excluded.rating, writeup = excluded.writeup,
                checklist = excluded.checklist",
            params![
                record.id,
                review.rating.as_str(),
                review.writeup,
                checklist_json
            ],
        )?;

        tx.execute(
            "INSERT INTO run_link (run_id, source_repo, playable_build) VALUES (?1,?2,?3)
             ON CONFLICT(run_id) DO UPDATE SET
                source_repo = excluded.source_repo, playable_build = excluded.playable_build",
            params![record.id, links.source_repo, links.playable_build],
        )?;

        // Mark the snapshot dirty within the same transaction so a publish and
        // its coalescing flag commit atomically.
        tx.execute(
            "INSERT INTO snapshot_state (id, dirty) VALUES (1, 1)
             ON CONFLICT(id) DO UPDATE SET dirty = 1",
            [],
        )?;

        tx.commit()?;
        Ok(PublishOutcome { newly_published })
    }

    /// Fetch one stored run by id.
    pub fn get_run(&self, id: &str) -> Result<Option<StoredRun>> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        let sql = format!(
            "SELECT {STORED_RUN_COLUMNS}
             FROM run r
             JOIN review rv ON rv.run_id = r.id
             JOIN run_link l ON l.run_id = r.id
             WHERE r.id = ?1"
        );
        conn.query_row(&sql, params![id], row_to_stored_run)
            .optional()
            .map_err(BackendError::from)
    }

    /// List stored runs newest-first (by `published_at`), paginated by a
    /// `published_at` cursor. Returns at most `limit` runs and the next cursor
    /// (the last row's `published_at`) when more may remain.
    pub fn list_runs(
        &self,
        limit: usize,
        before: Option<&str>,
    ) -> Result<(Vec<StoredRun>, Option<String>)> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        // Fetch one extra row to decide whether a next cursor exists.
        let fetch = limit.saturating_add(1);
        let sql = format!(
            "SELECT {STORED_RUN_COLUMNS}
             FROM run r
             JOIN review rv ON rv.run_id = r.id
             JOIN run_link l ON l.run_id = r.id
             WHERE (?1 IS NULL OR r.published_at < ?1)
             ORDER BY r.published_at DESC, r.id DESC
             LIMIT ?2"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![before, fetch as i64], row_to_stored_run)?;
        let mut runs = Vec::new();
        for run in rows {
            runs.push(run?);
        }

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
    pub fn all_runs(&self) -> Result<Vec<StoredRun>> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        let sql = format!(
            "SELECT {STORED_RUN_COLUMNS}
             FROM run r
             JOIN review rv ON rv.run_id = r.id
             JOIN run_link l ON l.run_id = r.id
             ORDER BY r.published_at DESC, r.id DESC"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], row_to_stored_run)?;
        let mut runs = Vec::new();
        for run in rows {
            runs.push(run?);
        }
        Ok(runs)
    }

    /// The total number of published runs.
    pub fn run_count(&self) -> Result<i64> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        Ok(conn.query_row("SELECT COUNT(*) FROM run", [], |row| row.get(0))?)
    }

    /// Read the snapshot coalescing state, defaulting to a clean state when the
    /// row has never been written.
    pub fn snapshot_state(&self) -> Result<SnapshotState> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        let state = conn
            .query_row(
                "SELECT dirty, last_uploaded, last_run_count FROM snapshot_state WHERE id = 1",
                [],
                |row| {
                    Ok(SnapshotState {
                        dirty: row.get::<_, i64>(0)? != 0,
                        last_uploaded: row.get(1)?,
                        last_run_count: row.get(2)?,
                    })
                },
            )
            .optional()?;
        Ok(state.unwrap_or(SnapshotState {
            dirty: false,
            last_uploaded: None,
            last_run_count: None,
        }))
    }

    /// Mark the snapshot dirty (a publish has landed). Coalescing reads this to
    /// decide whether a refresh is needed.
    pub fn mark_dirty(&self) -> Result<()> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        conn.execute(
            "INSERT INTO snapshot_state (id, dirty) VALUES (1, 1)
             ON CONFLICT(id) DO UPDATE SET dirty = 1",
            [],
        )?;
        Ok(())
    }

    /// Record a successful upload: clear the dirty flag and stamp the upload time
    /// and run count.
    pub fn mark_uploaded(&self, uploaded_at: &str, run_count: i64) -> Result<()> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        conn.execute(
            "INSERT INTO snapshot_state (id, dirty, last_uploaded, last_run_count)
             VALUES (1, 0, ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET
                dirty = 0, last_uploaded = excluded.last_uploaded,
                last_run_count = excluded.last_run_count",
            params![uploaded_at, run_count],
        )?;
        Ok(())
    }
}

/// Decode a joined row into a [`StoredRun`]. Every query selects the same seven
/// columns in this order: `record_json, rating, writeup, source_repo,
/// playable_build, published_at, checklist`.
fn row_to_stored_run(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredRun> {
    let record_json: String = row.get(0)?;
    let rating_str: String = row.get(1)?;
    let writeup: String = row.get(2)?;
    let source_repo: Option<String> = row.get(3)?;
    let playable_build: Option<String> = row.get(4)?;
    let published_at: String = row.get(5)?;
    let checklist_json: String = row.get(6)?;

    let record: RunRecord = serde_json::from_str(&record_json).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    })?;
    let rating = Rating::parse(&rating_str).ok_or_else(|| {
        rusqlite::Error::InvalidColumnType(1, "rating".to_string(), rusqlite::types::Type::Text)
    })?;
    let checklist: Vec<ReviewVerdict> = serde_json::from_str(&checklist_json).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(6, rusqlite::types::Type::Text, Box::new(e))
    })?;

    Ok(StoredRun {
        record,
        review: StoredReview {
            rating,
            writeup,
            checklist,
        },
        links: RunLinks {
            source_repo,
            playable_build,
        },
        published_at,
    })
}

/// The shared seven-column projection every `StoredRun` query selects.
const STORED_RUN_COLUMNS: &str = "r.record_json, rv.rating, rv.writeup, l.source_repo, \
     l.playable_build, r.published_at, rv.checklist";

/// The wire string for a run state (matching the serde representation).
fn run_state_str(state: test_cabinet_core::run_record::RunState) -> &'static str {
    use test_cabinet_core::run_record::RunState;
    match state {
        RunState::Completed => "completed",
        RunState::Failed => "failed",
        RunState::Unevaluable => "unevaluable",
    }
}

/// The schema from §2 (pragmas applied separately at open).
const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS run (
    id                  TEXT PRIMARY KEY,
    started_at          TEXT NOT NULL,
    finished_at         TEXT NOT NULL,
    published_at        TEXT NOT NULL,
    test_case_slug      TEXT NOT NULL,
    test_case_version   TEXT NOT NULL,
    variant             TEXT NOT NULL,
    harness_slug        TEXT NOT NULL,
    harness_version     TEXT,
    model_id            TEXT NOT NULL,
    run_state           TEXT NOT NULL,
    loaded              INTEGER NOT NULL,
    record_json         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_run_published_at ON run (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_run_case        ON run (test_case_slug, test_case_version);
CREATE INDEX IF NOT EXISTS idx_run_harness     ON run (harness_slug);
CREATE INDEX IF NOT EXISTS idx_run_model       ON run (model_id);

CREATE TABLE IF NOT EXISTS review (
    run_id    TEXT PRIMARY KEY REFERENCES run (id) ON DELETE CASCADE,
    rating    TEXT NOT NULL,
    writeup   TEXT NOT NULL,
    checklist TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS run_link (
    run_id          TEXT PRIMARY KEY REFERENCES run (id) ON DELETE CASCADE,
    source_repo     TEXT,
    playable_build  TEXT
);

CREATE TABLE IF NOT EXISTS snapshot_state (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    dirty           INTEGER NOT NULL DEFAULT 0,
    last_uploaded   TEXT,
    last_run_count  INTEGER
);
"#;

#[cfg(test)]
#[path = "db.test.rs"]
mod tests;
