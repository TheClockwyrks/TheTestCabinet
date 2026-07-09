//! Adds the sort/filter columns lifted onto the `run` table for the console
//! listing: `test_type`, `run_time_seconds`, `total_tokens`, `cost_comparable`
//! (nullable — cost can be unknown), `rating` (nullable — a run may carry no
//! reviews yet), and `review_count`.
//!
//! Like the identity columns already on `run` (`test_case_slug`, `model_id`, …),
//! these are lifted out of the verbatim `record_json` blob (and the reviews
//! table) so the console can order/filter/paginate by run time, tokens, cost,
//! test type, and rating without parsing every record. Each non-null column
//! carries a default so rows already stored when this migration runs stay valid;
//! the backend's idempotent startup backfill
//! ([`Db::backfill_sort_columns`](../../test_cabinet_backend/db/struct.Db.html))
//! then fills the real values from each row's record and reviews. Every write
//! after this sets the columns directly.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite only allows one column change per `ALTER TABLE`, so each column is
        // added in its own statement (this applies identically to PostgreSQL).
        add_column(
            manager,
            ColumnDef::new(Run::TestType)
                .string()
                .not_null()
                .default("")
                .to_owned(),
        )
        .await?;
        add_column(
            manager,
            ColumnDef::new(Run::RunTimeSeconds)
                .double()
                .not_null()
                .default(0.0)
                .to_owned(),
        )
        .await?;
        add_column(
            manager,
            ColumnDef::new(Run::TotalTokens)
                .big_integer()
                .not_null()
                .default(0)
                .to_owned(),
        )
        .await?;
        // Nullable: the cost is unknown when the model's per-token prices could not
        // be resolved (distinct from a free `0.0`).
        add_column(
            manager,
            ColumnDef::new(Run::CostComparable).double().to_owned(),
        )
        .await?;
        // Nullable: a pushed-but-unreviewed run has no rating yet.
        add_column(manager, ColumnDef::new(Run::Rating).string().to_owned()).await?;
        add_column(
            manager,
            ColumnDef::new(Run::ReviewCount)
                .big_integer()
                .not_null()
                .default(0)
                .to_owned(),
        )
        .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for column in [
            Run::TestType,
            Run::RunTimeSeconds,
            Run::TotalTokens,
            Run::CostComparable,
            Run::Rating,
            Run::ReviewCount,
        ] {
            manager
                .alter_table(
                    Table::alter()
                        .table(Run::Table)
                        .drop_column(column)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

/// Add a single column to the `run` table in its own `ALTER TABLE` statement —
/// SQLite rejects a multi-change alter.
async fn add_column(manager: &SchemaManager<'_>, column: ColumnDef) -> Result<(), DbErr> {
    manager
        .alter_table(
            Table::alter()
                .table(Run::Table)
                .add_column(column)
                .to_owned(),
        )
        .await
}

// `RunTimeSeconds` necessarily starts with the enum name — it maps to the
// `run_time_seconds` column.
#[derive(DeriveIden)]
#[allow(clippy::enum_variant_names)]
enum Run {
    Table,
    TestType,
    RunTimeSeconds,
    TotalTokens,
    CostComparable,
    Rating,
    ReviewCount,
}
