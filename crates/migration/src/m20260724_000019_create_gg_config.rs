//! Adds the `gg_config` table: an operator's named, reusable gg capability set.
//!
//! A gg run is configured by a declarative capability set rather than the flat
//! `(harness, model, orchestrator)` tuple a third-party-harness run carries, so the
//! configuration is the thing worth naming and reusing across runs (and across an
//! ablation's arms). An account may hold many, each with its own opaque id, name,
//! and optional description; the set itself is JSON text, read and written whole
//! like the coverage plans' list columns. Built from the portable schema builder so
//! it applies identically to SQLite and PostgreSQL; the timestamp is an RFC 3339
//! string. A `user_id` index keeps the per-account list query cheap.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(GgConfig::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(GgConfig::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(GgConfig::UserId).string().not_null())
                    .col(ColumnDef::new(GgConfig::Name).string().not_null())
                    .col(ColumnDef::new(GgConfig::Description).string().not_null())
                    .col(
                        ColumnDef::new(GgConfig::CapabilitySetJson)
                            .text()
                            .not_null(),
                    )
                    .col(ColumnDef::new(GgConfig::UpdatedAt).string().not_null())
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_gg_config_user")
                    .table(GgConfig::Table)
                    .col(GgConfig::UserId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(GgConfig::Table).to_owned())
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum GgConfig {
    Table,
    Id,
    UserId,
    Name,
    Description,
    CapabilitySetJson,
    UpdatedAt,
}
