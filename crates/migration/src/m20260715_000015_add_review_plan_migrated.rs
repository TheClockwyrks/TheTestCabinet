//! Adds `review_plan.migrated`: the flag the idempotent startup backfill uses to
//! copy each legacy single-per-account plan into the new multi-plan `coverage_plan`
//! table exactly once.
//!
//! The legacy `review_plan` table (one row per account) is retained for this
//! release so a v0.6.0 roll never loses a reviewer's existing plan; the backfill in
//! `backend::bootstrap` reads every legacy row with `migrated = false`, inserts a
//! `coverage_plan` carrying its combinations/cases as one-off members, then sets
//! this flag — so a restart is a no-op and an intentionally deleted migrated plan
//! is not recreated. The column is `NOT NULL` with a portable `false` default.
//! Built from the portable schema builder so it applies identically to SQLite and
//! PostgreSQL.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(ReviewPlan::Table)
                    .add_column(
                        ColumnDef::new(ReviewPlan::Migrated)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(ReviewPlan::Table)
                    .drop_column(ReviewPlan::Migrated)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum ReviewPlan {
    Table,
    Migrated,
}
