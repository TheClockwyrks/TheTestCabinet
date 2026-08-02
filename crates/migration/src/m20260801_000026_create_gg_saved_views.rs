//! Adds the `gg_saved_query` and `gg_dashboard` tables: the operator's saved
//! **views** over the gg analysis corpus.
//!
//! One migration for both because they are one feature and one decision. The gg run
//! population is deliberately *not* account-scoped — a run belongs to the deployment,
//! exactly as the run listings and the coverage matrix already treat runs — so the
//! asymmetry this schema encodes is "shared data, private views": both tables carry a
//! `user_id` and nothing else does.
//!
//! Both store the query as **source text** rather than a compiled query, so a
//! relative `now-30d` stays relative and a later grammar addition cannot invalidate
//! something already saved; a dashboard's panels are a JSON list, read and written
//! whole like the coverage plans' list columns. Built from the portable schema
//! builder so it applies identically to SQLite and PostgreSQL; timestamps are RFC
//! 3339 strings. A `user_id` index on each keeps the per-account list query cheap.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(GgSavedQuery::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(GgSavedQuery::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(GgSavedQuery::UserId).string().not_null())
                    .col(ColumnDef::new(GgSavedQuery::Name).string().not_null())
                    .col(
                        ColumnDef::new(GgSavedQuery::Description)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(GgSavedQuery::QueryText).text().not_null())
                    .col(ColumnDef::new(GgSavedQuery::RangeId).string().not_null())
                    .col(ColumnDef::new(GgSavedQuery::UpdatedAt).string().not_null())
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_gg_saved_query_user")
                    .table(GgSavedQuery::Table)
                    .col(GgSavedQuery::UserId)
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(GgDashboard::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(GgDashboard::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(GgDashboard::UserId).string().not_null())
                    .col(ColumnDef::new(GgDashboard::Name).string().not_null())
                    .col(ColumnDef::new(GgDashboard::Description).string().not_null())
                    .col(ColumnDef::new(GgDashboard::PanelsJson).text().not_null())
                    .col(ColumnDef::new(GgDashboard::RangeId).string().not_null())
                    .col(ColumnDef::new(GgDashboard::UpdatedAt).string().not_null())
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_gg_dashboard_user")
                    .table(GgDashboard::Table)
                    .col(GgDashboard::UserId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(GgDashboard::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(GgSavedQuery::Table).to_owned())
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum GgSavedQuery {
    Table,
    Id,
    UserId,
    Name,
    Description,
    QueryText,
    RangeId,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum GgDashboard {
    Table,
    Id,
    UserId,
    Name,
    Description,
    PanelsJson,
    RangeId,
    UpdatedAt,
}
