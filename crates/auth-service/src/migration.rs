//! The schema migration for the auth service's SeaORM store.
//!
//! A single migration creates the `user` and `token` tables. It runs at startup
//! via [`Migrator::up`] and applies identically to SQLite (local/tests) and
//! PostgreSQL (deployment) because it is built from SeaORM's portable schema
//! builder. There is no data-migration logic — this is the initial schema for a
//! store that has never held data.

use sea_orm_migration::prelude::*;

/// The auth service's migrator, registered with the single initial-schema
/// migration below.
pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![Box::new(Migration)]
    }
}

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

#[derive(DeriveIden)]
enum User {
    Table,
    Id,
    Username,
    DisplayName,
    PasswordHash,
    CreatedAt,
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
