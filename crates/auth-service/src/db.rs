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
    /// The current SeaORM connection, as a cheap clone. Every query goes through
    /// this so that, under Azure AD auth, work runs on the pool built with the
    /// freshest token.
    fn conn(&self) -> DatabaseConnection {
        match &self.handle {
            ConnHandle::Static(conn) => conn.clone(),
            ConnHandle::AzureAd(db) => db.connection(),
        }
    }

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
        Ok(Self {
            handle: ConnHandle::Static(conn),
        })
    }

    /// Connect to a managed-PostgreSQL store using Microsoft Entra managed-identity
    /// (passwordless) authentication. `url` must name the Entra Postgres role as
    /// its username and carry no password; the access token is minted from the
    /// pod's Workload Identity and the pool is rebuilt as it rotates. See
    /// [`test_cabinet_db_auth`].
    pub async fn connect_azure_ad(url: &str) -> Result<Self, sea_orm::DbErr> {
        let db = test_cabinet_db_auth::AzureAdDb::connect(url)
            .await
            .map_err(|err| sea_orm::DbErr::Custom(format!("Azure AD Postgres auth: {err}")))?;
        Ok(Self {
            handle: ConnHandle::AzureAd(std::sync::Arc::new(db)),
        })
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
        Ok(Self {
            handle: ConnHandle::Static(conn),
        })
    }

    /// The underlying connection, for the startup migration in [`crate::build`].
    /// Returns a cheap clone of the current pool (owned, so it is valid across a
    /// background refresh under Azure AD auth).
    pub fn connection(&self) -> DatabaseConnection {
        self.conn()
    }

    /// Find an account by its unique login handle.
    pub async fn find_user_by_username(
        &self,
        username: &str,
    ) -> Result<Option<user::Model>, sea_orm::DbErr> {
        user::Entity::find()
            .filter(user::Column::Username.eq(username))
            .one(&self.conn())
            .await
    }

    /// Find an account by its stable id. Used to serve a profile picture, which is
    /// addressed by account id rather than login handle.
    pub async fn find_user_by_id(&self, id: &str) -> Result<Option<user::Model>, sea_orm::DbErr> {
        user::Entity::find_by_id(id.to_string())
            .one(&self.conn())
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
            picture: Set(model.picture),
            picture_content_type: Set(model.picture_content_type),
            picture_updated_at: Set(model.picture_updated_at),
        }
        .insert(&self.conn())
        .await?;
        Ok(())
    }

    /// Set (or replace) an account's profile picture: the base64-encoded bytes,
    /// their content type, and the RFC 3339 instant the change happened (which
    /// becomes the account's cache-bust version). Errors when no such account
    /// exists.
    pub async fn set_user_picture(
        &self,
        user_id: &str,
        picture_base64: String,
        content_type: String,
        updated_at: String,
    ) -> Result<(), sea_orm::DbErr> {
        let conn = self.conn();
        let model = user::Entity::find_by_id(user_id.to_string())
            .one(&conn)
            .await?
            .ok_or_else(|| sea_orm::DbErr::RecordNotFound(format!("user `{user_id}` not found")))?;
        let mut active: user::ActiveModel = model.into();
        active.picture = Set(Some(picture_base64));
        active.picture_content_type = Set(Some(content_type));
        active.picture_updated_at = Set(Some(updated_at));
        active.update(&conn).await?;
        Ok(())
    }

    /// Clear an account's profile picture, resetting all three picture columns to
    /// `NULL`. Idempotent for an account that already has none. Errors when no such
    /// account exists.
    pub async fn clear_user_picture(&self, user_id: &str) -> Result<(), sea_orm::DbErr> {
        let conn = self.conn();
        let model = user::Entity::find_by_id(user_id.to_string())
            .one(&conn)
            .await?
            .ok_or_else(|| sea_orm::DbErr::RecordNotFound(format!("user `{user_id}` not found")))?;
        let mut active: user::ActiveModel = model.into();
        active.picture = Set(None);
        active.picture_content_type = Set(None);
        active.picture_updated_at = Set(None);
        active.update(&conn).await?;
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
        .insert(&self.conn())
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
            .one(&self.conn())
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
        token.find_related(user::Entity).one(&self.conn()).await
    }

    /// Revoke a token by its hash, returning how many rows were deleted (`0` when
    /// the token was already unknown).
    pub async fn delete_token(&self, token_hash: &str) -> Result<u64, sea_orm::DbErr> {
        let result = token::Entity::delete_many()
            .filter(token::Column::TokenHash.eq(token_hash))
            .exec(&self.conn())
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
