//! Adds the `comparison` table: an operator's saved harness comparison (A/B
//! experiment).
//!
//! A comparison holds every run variable constant and varies one dimension — the
//! harness, a gg configuration, or the model — into N-run arms, then presents the
//! cost/token/score distributions side by side. Only the configuration is stored
//! (controls, varied dimension, arms with their run ids, as JSON text, read and
//! written whole like the coverage plans' list columns); the per-arm statistics are
//! computed on read from the arms' runs. `published`/`published_at` gate snapshot
//! inclusion. Built from the portable schema builder so it applies identically to
//! SQLite and PostgreSQL; timestamps are RFC 3339 strings. A `user_id` index keeps
//! the per-account list query cheap.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Comparison::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Comparison::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(Comparison::UserId).string().not_null())
                    .col(ColumnDef::new(Comparison::Name).string().not_null())
                    .col(ColumnDef::new(Comparison::Description).string().not_null())
                    .col(ColumnDef::new(Comparison::ConfigJson).text().not_null())
                    .col(
                        ColumnDef::new(Comparison::Published)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(ColumnDef::new(Comparison::PublishedAt).string().null())
                    .col(ColumnDef::new(Comparison::CreatedAt).string().not_null())
                    .col(ColumnDef::new(Comparison::UpdatedAt).string().not_null())
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_comparison_user")
                    .table(Comparison::Table)
                    .col(Comparison::UserId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Comparison::Table).to_owned())
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum Comparison {
    Table,
    Id,
    UserId,
    Name,
    Description,
    ConfigJson,
    Published,
    PublishedAt,
    CreatedAt,
    UpdatedAt,
}
