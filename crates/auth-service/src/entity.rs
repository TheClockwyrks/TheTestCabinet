//! SeaORM entity models for the auth service's own store.
//!
//! Two tables, created by [`crate::migration`]: `user` holds an account and its
//! Argon2id password hash; `token` holds the SHA-256 hash of each minted bearer
//! token (never the token itself), keyed back to its user. They are deliberately
//! kept in this crate rather than the backend's `test-cabinet-entities` — the
//! auth service owns a *separate* database, so the backend never sees these
//! tables and the auth service never sees the run tables.

/// The `user` table: one account, with its Argon2id password hash.
pub mod user {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
    #[sea_orm(table_name = "user")]
    pub struct Model {
        /// The account id (a UUID); the primary key and the value a review is
        /// attributed to on the backend.
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: String,
        /// The unique login handle.
        #[sea_orm(unique)]
        pub username: String,
        /// The human-facing display name shown beside the account's reviews.
        pub display_name: String,
        /// The Argon2id PHC hash string (carries its own salt and parameters).
        #[sea_orm(column_type = "Text")]
        pub password_hash: String,
        /// RFC 3339 of when the account was created.
        pub created_at: String,
        /// The account's profile picture, base64-encoded, or `NULL` when unset.
        /// Avatars are downscaled to a small square before upload, so base64 in a
        /// `Text` column stays small and is portable across SQLite and PostgreSQL.
        /// The bytes are served (decoded) by `GET /auth/users/{id}/picture`.
        #[sea_orm(column_type = "Text", nullable)]
        pub picture: Option<String>,
        /// The picture's content type (e.g. `image/webp`), or `NULL` when unset.
        #[sea_orm(nullable)]
        pub picture_content_type: Option<String>,
        /// RFC 3339 of when the picture was last set, or `NULL` when unset. Surfaced
        /// on the public [`Account`](test_cabinet_core::accounts::Account) as a
        /// "has picture" flag and cache-bust version.
        #[sea_orm(nullable)]
        pub picture_updated_at: Option<String>,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {
        #[sea_orm(has_many = "super::token::Entity")]
        Token,
    }

    impl Related<super::token::Entity> for Entity {
        fn to() -> RelationDef {
            Relation::Token.def()
        }
    }

    impl ActiveModelBehavior for ActiveModel {}
}

/// The `token` table: one row per minted bearer token, holding only its SHA-256
/// hash so a leaked database cannot be used to authenticate.
pub mod token {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
    #[sea_orm(table_name = "token")]
    pub struct Model {
        /// The token row id (a UUID); the primary key.
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: String,
        /// The account this token authenticates as (FK to `user.id`).
        pub user_id: String,
        /// The hex-encoded SHA-256 of the bearer token. Unique, and the lookup
        /// key on verify; the raw token is shown to the client exactly once.
        #[sea_orm(unique)]
        pub token_hash: String,
        /// RFC 3339 of when the token was minted.
        pub created_at: String,
        /// RFC 3339 of when the token expires, or `NULL` for a non-expiring token
        /// (the default — tokens are revoked explicitly via logout).
        #[sea_orm(nullable)]
        pub expires_at: Option<String>,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {
        #[sea_orm(
            belongs_to = "super::user::Entity",
            from = "Column::UserId",
            to = "super::user::Column::Id",
            on_delete = "Cascade"
        )]
        User,
    }

    impl Related<super::user::Entity> for Entity {
        fn to() -> RelationDef {
            Relation::User.def()
        }
    }

    impl ActiveModelBehavior for ActiveModel {}
}
