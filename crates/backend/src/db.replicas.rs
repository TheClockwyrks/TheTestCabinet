//! What the replicas coordinate through (the backend overview's "Replicas"): the
//! database locks a snapshot refresh and a reclamation sweep pass hold, the
//! `NOTIFY` an announcement is sent with, and the two tables an announcement reads
//! through, the latest preview frames and the oversized payloads.
//!
//! On PostgreSQL a lock is a session advisory lock held on a pool connection of its
//! own, so a replica that dies while holding one releases it with its connection.
//! On SQLite the deployment runs one replica, and a lock is an in-process mutex
//! that serializes the same work within it.

use std::collections::HashMap;
use std::sync::Arc;

use sea_orm::ActiveValue::{NotSet, Set};
use sea_orm::sea_query::OnConflict;
use sea_orm::sqlx::pool::PoolConnection;
use sea_orm::sqlx::postgres::PgPool;
use sea_orm::sqlx::{self, Postgres};
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseBackend, DatabaseConnection, EntityTrait, QueryFilter,
    QueryOrder, Statement,
};
use test_cabinet_contracts::preview::AssetPreview;
use test_cabinet_entities::{job_preview, relay_overflow};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use super::Db;
use crate::error::{BackendError, Result};

/// How long a stored oversized announcement is kept. Every replica reads it back as
/// soon as the announcement naming it arrives, so a few minutes covers a replica
/// that is slow to; the announcing replica deletes older rows as it writes.
const OVERFLOW_RETENTION: time::Duration = time::Duration::minutes(5);

/// A driver error from a query this module issues on `sqlx` directly, as the
/// connection error SeaORM would have raised for it.
fn sqlx_error(error: sqlx::Error) -> sea_orm::DbErr {
    sea_orm::DbErr::Conn(sea_orm::RuntimeErr::SqlxError(error))
}

/// The work held to one replica at a time by a database lock.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DbLockKey {
    /// A snapshot refresh, which a publish's index rewrite is.
    Snapshot,
    /// An artifact reclamation sweep pass.
    Sweep,
    /// The schema migration a backend applies as it starts.
    Migration,
}

impl DbLockKey {
    /// The advisory lock key. The high half spells `tcab` so the keys stay clear of
    /// any other user of the database's advisory locks.
    fn advisory_key(self) -> i64 {
        const NAMESPACE: i64 = 0x7463_6162 << 32;
        NAMESPACE
            | match self {
                Self::Snapshot => 1,
                Self::Sweep => 2,
                Self::Migration => 3,
            }
    }
}

/// The in-process locks a SQLite store serializes the same work with, one per key.
#[derive(Default)]
pub(super) struct LocalLocks(std::sync::Mutex<HashMap<DbLockKey, Arc<tokio::sync::Mutex<()>>>>);

impl LocalLocks {
    fn mutex(&self, key: DbLockKey) -> Arc<tokio::sync::Mutex<()>> {
        let mut locks = self.0.lock().expect("local lock registry poisoned");
        Arc::clone(locks.entry(key).or_default())
    }
}

/// A held database lock. [`release`](Self::release) gives it back; dropping it
/// unreleased closes the connection that holds a PostgreSQL lock, which releases it
/// too, so a holder that fails part way never leaves the lock taken.
pub struct DbLock {
    held: Option<Held>,
}

enum Held {
    Postgres {
        connection: PoolConnection<Postgres>,
        key: i64,
    },
    Local(#[allow(dead_code)] tokio::sync::OwnedMutexGuard<()>),
}

impl DbLock {
    /// Run a lock function that answers whether it took the lock, on the guard's
    /// connection with its key.
    async fn query(&mut self, sql: &str) -> Result<bool> {
        let Some(Held::Postgres { connection, key }) = self.held.as_mut() else {
            unreachable!("only a PostgreSQL lock queries");
        };
        sqlx::query_scalar(sql)
            .bind(*key)
            .fetch_one(&mut **connection)
            .await
            .map_err(sqlx_error)
            .map_err(Into::into)
    }

    /// Release the lock. A PostgreSQL connection whose unlock fails is closed rather
    /// than returned to the pool, so the lock is released either way.
    pub async fn release(mut self) {
        if let Some(Held::Postgres {
            mut connection,
            key,
        }) = self.held.take()
        {
            let unlocked = sqlx::query("SELECT pg_advisory_unlock($1)")
                .bind(key)
                .execute(&mut *connection)
                .await;
            if let Err(error) = unlocked {
                tracing::warn!(%error, "releasing a database lock failed; closing its connection");
                let _ = connection.close().await;
            }
        }
    }
}

impl Drop for DbLock {
    fn drop(&mut self) {
        if let Some(Held::Postgres { connection, .. }) = self.held.take() {
            // The session holds the lock, so ending the session is what releases it.
            // A pool connection would return to the pool still holding it.
            if let Ok(runtime) = tokio::runtime::Handle::try_current() {
                runtime.spawn(async move {
                    let _ = connection.close().await;
                });
            } else {
                drop(connection.detach());
            }
        }
    }
}

impl Db {
    /// Whether the store is PostgreSQL, which more than one replica can share.
    pub fn is_postgres(&self) -> bool {
        self.conn().get_database_backend() == DatabaseBackend::Postgres
    }

    /// The current PostgreSQL pool, or `None` on SQLite. Under Azure AD auth this is
    /// the pool built with the freshest token, so a caller takes it per connection.
    pub(crate) fn postgres_pool(&self) -> Option<PgPool> {
        match self.conn() {
            DatabaseConnection::SqlxPostgresPoolConnection(_) => {
                Some(self.conn().get_postgres_connection_pool().clone())
            }
            _ => None,
        }
    }

    /// Take `key`'s lock, waiting while another holder has it.
    pub async fn lock(&self, key: DbLockKey) -> Result<DbLock> {
        match self.postgres_pool() {
            Some(pool) => {
                let mut lock = self.postgres_lock(&pool, key).await?;
                lock.query("SELECT true FROM pg_advisory_lock($1)").await?;
                Ok(lock)
            }
            None => Ok(DbLock {
                held: Some(Held::Local(self.locks.mutex(key).lock_owned().await)),
            }),
        }
    }

    /// Take `key`'s lock if nobody holds it, or answer `None`.
    pub async fn try_lock(&self, key: DbLockKey) -> Result<Option<DbLock>> {
        match self.postgres_pool() {
            Some(pool) => {
                let mut lock = self.postgres_lock(&pool, key).await?;
                let taken = lock.query("SELECT pg_try_advisory_lock($1)").await?;
                // Not taken, the lock is released at once: there is nothing to unlock.
                Ok(taken.then_some(lock))
            }
            None => Ok(self
                .locks
                .mutex(key)
                .try_lock_owned()
                .ok()
                .map(|guard| DbLock {
                    held: Some(Held::Local(guard)),
                })),
        }
    }

    /// A guard over a connection of its own, made before the lock is asked for: a
    /// caller that stops waiting drops it, which closes the connection, so a lock
    /// granted after the caller left is never returned to the pool held.
    async fn postgres_lock(&self, pool: &PgPool, key: DbLockKey) -> Result<DbLock> {
        let connection = pool.acquire().await.map_err(sqlx_error)?;
        Ok(DbLock {
            held: Some(Held::Postgres {
                connection,
                key: key.advisory_key(),
            }),
        })
    }

    /// Send `payload` on PostgreSQL channel `channel`. Only called on PostgreSQL.
    pub(crate) async fn notify(&self, channel: &str, payload: &str) -> Result<()> {
        self.conn()
            .execute(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                "SELECT pg_notify($1, $2)",
                [channel.into(), payload.into()],
            ))
            .await?;
        Ok(())
    }

    /// Store an announcement too large to notify, deleting the ones old enough that
    /// every replica has read them, and answer the key it is announced by.
    pub(crate) async fn store_overflow(&self, payload: &str) -> Result<i64> {
        let now = OffsetDateTime::now_utc();
        let format = |at: OffsetDateTime| {
            at.format(&Rfc3339)
                .map_err(|e| BackendError::Internal(format!("formatting a timestamp: {e}")))
        };
        relay_overflow::Entity::delete_many()
            .filter(relay_overflow::Column::CreatedAt.lt(format(now - OVERFLOW_RETENTION)?))
            .exec(&self.conn())
            .await?;
        let inserted = relay_overflow::Entity::insert(relay_overflow::ActiveModel {
            id: NotSet,
            payload: Set(payload.to_string()),
            created_at: Set(format(now)?),
        })
        .exec(&self.conn())
        .await?;
        Ok(inserted.last_insert_id)
    }

    /// The stored announcement `id`, or `None` once it was deleted.
    pub(crate) async fn overflow(&self, id: i64) -> Result<Option<String>> {
        Ok(relay_overflow::Entity::find_by_id(id)
            .one(&self.conn())
            .await?
            .map(|row| row.payload))
    }

    /// Store `preview` as job `job_id`'s latest frame at its index, replacing the one
    /// before it.
    pub async fn store_job_preview(&self, job_id: &str, preview: &AssetPreview) -> Result<()> {
        job_preview::Entity::insert(job_preview::ActiveModel {
            job_id: Set(job_id.to_string()),
            frame: Set(i64::from(preview.frame)),
            preview_json: Set(serde_json::to_string(preview)?),
        })
        .on_conflict(
            OnConflict::columns([job_preview::Column::JobId, job_preview::Column::Frame])
                .update_column(job_preview::Column::PreviewJson)
                .to_owned(),
        )
        .exec_without_returning(&self.conn())
        .await?;
        Ok(())
    }

    /// Job `job_id`'s stored latest frame at index `frame`.
    pub async fn job_preview(&self, job_id: &str, frame: u32) -> Result<Option<AssetPreview>> {
        job_preview::Entity::find_by_id((job_id.to_string(), i64::from(frame)))
            .one(&self.conn())
            .await?
            .map(|row| Ok(serde_json::from_str(&row.preview_json)?))
            .transpose()
    }

    /// Job `job_id`'s stored latest frames, in frame order.
    pub async fn job_previews(&self, job_id: &str) -> Result<Vec<AssetPreview>> {
        job_preview::Entity::find()
            .filter(job_preview::Column::JobId.eq(job_id))
            .order_by_asc(job_preview::Column::Frame)
            .all(&self.conn())
            .await?
            .into_iter()
            .map(|row| Ok(serde_json::from_str(&row.preview_json)?))
            .collect()
    }

    /// Delete the stored frames of every job that has ended or no longer exists:
    /// what a replica that stopped before it announced a job's end, or a frame stored
    /// after the end was announced, left behind.
    pub async fn delete_ended_job_previews(&self) -> Result<u64> {
        use sea_orm::sea_query::Query;
        let in_flight = Query::select()
            .column(test_cabinet_entities::job::Column::Id)
            .from(test_cabinet_entities::job::Entity)
            .and_where(test_cabinet_entities::job::Column::State.is_in(super::IN_FLIGHT_STATES))
            .to_owned();
        Ok(job_preview::Entity::delete_many()
            .filter(job_preview::Column::JobId.not_in_subquery(in_flight))
            .exec(&self.conn())
            .await?
            .rows_affected)
    }

    /// Delete job `job_id`'s stored frames, once it has ended.
    pub async fn delete_job_previews(&self, job_id: &str) -> Result<()> {
        job_preview::Entity::delete_many()
            .filter(job_preview::Column::JobId.eq(job_id))
            .exec(&self.conn())
            .await?;
        Ok(())
    }
}
