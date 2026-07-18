//! The schema migrations for the auth service's SeaORM store.
//!
//! Two migrations run at startup via [`Migrator::up`] and apply identically to
//! SQLite (local/tests) and PostgreSQL (deployment) because they are built from
//! SeaORM's portable schema builder:
//!
//! 1. `migration` — the initial schema: the `user` and `token` tables.
//! 2. `m02_add_user_picture` — adds the profile-picture columns to `user`.
//!
//! The picture columns live in a *second* migration rather than being folded
//! into the initial `create_table` on purpose: an existing store has already
//! recorded the initial migration as applied, and `if_not_exists()` would skip
//! re-creating its table — so a column added to that create is never applied to a
//! store that already exists. A distinct migration is the only thing the migrator
//! will run against such a store.

use sea_orm_migration::prelude::*;

/// The auth service's migrator, registered with its migrations in order.
pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![Box::new(Migration), Box::new(AddUserPicture)]
    }
}

/// The initial schema: the `user` and `token` tables. Its name is derived from
/// this file's stem (`migration`) and MUST stay that way — it is the name already
/// recorded as applied in every existing store.
#[derive(DeriveMigrationName)]
struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(User::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(User::Id).string().not_null().primary_key())
                    .col(
                        ColumnDef::new(User::Username)
                            .string()
                            .not_null()
                            .unique_key(),
                    )
                    .col(ColumnDef::new(User::DisplayName).string().not_null())
                    .col(ColumnDef::new(User::PasswordHash).text().not_null())
                    .col(ColumnDef::new(User::CreatedAt).string().not_null())
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(Token::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(Token::Id).string().not_null().primary_key())
                    .col(ColumnDef::new(Token::UserId).string().not_null())
                    .col(
                        ColumnDef::new(Token::TokenHash)
                            .string()
                            .not_null()
                            .unique_key(),
                    )
                    .col(ColumnDef::new(Token::CreatedAt).string().not_null())
                    .col(ColumnDef::new(Token::ExpiresAt).string())
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_token_user")
                            .from(Token::Table, Token::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_token_user")
                    .table(Token::Table)
                    .col(Token::UserId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Drop the child (`token`) before the parent (`user`).
        manager
            .drop_table(Table::drop().table(Token::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(User::Table).to_owned())
            .await?;
        Ok(())
    }
}

/// Adds the profile-picture columns to `user`: the base64 picture (text), its
/// content type, and the RFC 3339 instant it was last set. All nullable — an
/// account has no picture until one is uploaded.
///
/// Its name is set explicitly because `DeriveMigrationName` derives from the
/// file stem, which both migrations in this file would share.
struct AddUserPicture;

impl MigrationName for AddUserPicture {
    fn name(&self) -> &str {
        "m02_add_user_picture"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for AddUserPicture {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite permits only one `ADD COLUMN` per `ALTER TABLE`, so add each
        // column in its own statement (portable to PostgreSQL too).
        manager
            .alter_table(
                Table::alter()
                    .table(User::Table)
                    .add_column(ColumnDef::new(User::Picture).text())
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(User::Table)
                    .add_column(ColumnDef::new(User::PictureContentType).string())
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(User::Table)
                    .add_column(ColumnDef::new(User::PictureUpdatedAt).string())
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(User::Table)
                    .drop_column(User::PictureUpdatedAt)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(User::Table)
                    .drop_column(User::PictureContentType)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(User::Table)
                    .drop_column(User::Picture)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum User {
    Table,
    Id,
    Username,
    DisplayName,
    PasswordHash,
    CreatedAt,
    Picture,
    PictureContentType,
    PictureUpdatedAt,
}

// `TokenHash` necessarily starts with the table name — it maps to the
// `token_hash` column — so the variant-naming lint does not apply here.
#[derive(DeriveIden)]
#[allow(clippy::enum_variant_names)]
enum Token {
    Table,
    Id,
    UserId,
    TokenHash,
    CreatedAt,
    ExpiresAt,
}
