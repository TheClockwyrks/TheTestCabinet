//! The auth service's SeaORM store: accounts and bearer-token hashes.
//!
//! Like the backend's store, one connection URL selects the backend (`sqlite://`
//! for local/dev/tests, `postgres://` for deployments) and the schema is applied
//! by [`crate::migration`] at startup. This is a *separate* database from the
//! backend's — it holds only the `user` and `token` tables.

use std::path::{Path, PathBuf};

use sea_orm::ActiveValue::Set;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectOptions, Database, DatabaseBackend, DatabaseConnection,
    EntityTrait, ModelTrait, QueryFilter,
};

use crate::entity::{token, user};

/// The SeaORM-backed account store.
pub struct Db {
    conn: DatabaseConnection,
}

impl Db {
    /// Connect to the store at `url`, choosing the backend by URL scheme. For a
    /// SQLite **file** URL the parent directory is created first and WAL +
    /// foreign-key pragmas are applied; both are no-ops for PostgreSQL.
    pub async fn connect(url: &str) -> Result<Self, sea_orm::DbErr> {
        if let Some(path) = sqlite_file_path(url)
            && let Some(parent) = path.parent()
            && !parent.as_os_str().is_empty()
        {
            std::fs::create_dir_all(parent)
                .map_err(|err| sea_orm::DbErr::Custom(err.to_string()))?;
        }
        let conn = Database::connect(ConnectOptions::new(url.to_owned())).await?;
        apply_sqlite_pragmas(&conn).await?;
        Ok(Self { conn })
    }

    /// Open an in-memory SQLite store with the schema migrated in (used by tests).
    /// The pool is pinned to one connection so the in-memory database persists for
    /// the store's lifetime.
    #[cfg(test)]
    pub async fn connect_in_memory() -> Result<Self, sea_orm::DbErr> {
        use sea_orm_migration::MigratorTrait;

        let mut opts = ConnectOptions::new("sqlite::memory:".to_owned());
        opts.max_connections(1).min_connections(1);
        let conn = Database::connect(opts).await?;
        apply_sqlite_pragmas(&conn).await?;
        crate::migration::Migrator::up(&conn, None).await?;
        Ok(Self { conn })
    }

    /// The underlying connection, for the startup migration in [`crate::build`].
    pub fn connection(&self) -> &DatabaseConnection {
        &self.conn
    }

    /// Find an account by its unique login handle.
    pub async fn find_user_by_username(
        &self,
        username: &str,
    ) -> Result<Option<user::Model>, sea_orm::DbErr> {
        user::Entity::find()
            .filter(user::Column::Username.eq(username))
            .one(&self.conn)
            .await
    }

    /// Insert a new account row.
    pub async fn insert_user(&self, model: user::Model) -> Result<(), sea_orm::DbErr> {
        user::ActiveModel {
            id: Set(model.id),
            username: Set(model.username),
            display_name: Set(model.display_name),
            password_hash: Set(model.password_hash),
            created_at: Set(model.created_at),
        }
        .insert(&self.conn)
        .await?;
        Ok(())
    }

    /// Insert a minted token's hash row.
    pub async fn insert_token(&self, model: token::Model) -> Result<(), sea_orm::DbErr> {
        token::ActiveModel {
            id: Set(model.id),
            user_id: Set(model.user_id),
            token_hash: Set(model.token_hash),
            created_at: Set(model.created_at),
            expires_at: Set(model.expires_at),
        }
        .insert(&self.conn)
        .await?;
        Ok(())
    }

    /// Resolve the account a token hash authenticates as, or `None` when the hash
    /// is unknown or its token has expired (relative to `now`, an RFC 3339
    /// instant). An expired token resolves to `None` so verification rejects it.
    pub async fn user_for_token(
        &self,
        token_hash: &str,
        now: &str,
    ) -> Result<Option<user::Model>, sea_orm::DbErr> {
        let Some(token) = token::Entity::find()
            .filter(token::Column::TokenHash.eq(token_hash))
            .one(&self.conn)
            .await?
        else {
            return Ok(None);
        };
        // A non-null `expires_at` that is at or before now means the token has
        // lapsed. RFC 3339 in a fixed UTC offset sorts lexically, so the string
        // comparison is a valid instant comparison.
        if let Some(expires_at) = &token.expires_at
            && expires_at.as_str() <= now
        {
            return Ok(None);
        }
        token.find_related(user::Entity).one(&self.conn).await
    }

    /// Revoke a token by its hash, returning how many rows were deleted (`0` when
    /// the token was already unknown).
    pub async fn delete_token(&self, token_hash: &str) -> Result<u64, sea_orm::DbErr> {
        let result = token::Entity::delete_many()
            .filter(token::Column::TokenHash.eq(token_hash))
            .exec(&self.conn)
            .await?;
        Ok(result.rows_affected)
    }
}

/// Apply the SQLite-only pragmas (WAL + foreign keys), matching the backend. A
/// no-op on PostgreSQL.
async fn apply_sqlite_pragmas(conn: &DatabaseConnection) -> Result<(), sea_orm::DbErr> {
    use sea_orm::ConnectionTrait;
    if conn.get_database_backend() == DatabaseBackend::Sqlite {
        conn.execute_unprepared("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .await?;
    }
    Ok(())
}

/// Extract the filesystem path from a SQLite **file** connection URL, or `None`
/// for a PostgreSQL URL or an in-memory database. Mirrors the backend's helper.
fn sqlite_file_path(url: &str) -> Option<PathBuf> {
    let rest = url
        .strip_prefix("sqlite://")
        .or_else(|| url.strip_prefix("sqlite:"))?;
    let path = rest.split('?').next().unwrap_or_default();
    if path.is_empty() || path == ":memory:" {
        return None;
    }
    Some(Path::new(path).to_path_buf())
}
