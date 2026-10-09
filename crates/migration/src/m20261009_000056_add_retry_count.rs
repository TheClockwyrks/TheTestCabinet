//! Adds the `retry_count` column to the `coverage_plan` and `ladder` tables.
//!
//! A plan and a ladder each set how many automatic retries every run their launch passes
//! enqueue gets, and each job carries the value as its launch request's `retryCount`. The
//! column defaults to `1`, the count a launch that names none gets, so the rows already
//! stored keep launching as they did.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(CoveragePlan::Table)
                    .add_column(
                        ColumnDef::new(CoveragePlan::RetryCount)
                            .integer()
                            .not_null()
                            .default(1),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Ladder::Table)
                    .add_column(
                        ColumnDef::new(Ladder::RetryCount)
                            .integer()
                            .not_null()
                            .default(1),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Ladder::Table)
                    .drop_column(Ladder::RetryCount)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(CoveragePlan::Table)
                    .drop_column(CoveragePlan::RetryCount)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum CoveragePlan {
    Table,
    RetryCount,
}

#[derive(DeriveIden)]
enum Ladder {
    Table,
    RetryCount,
}
