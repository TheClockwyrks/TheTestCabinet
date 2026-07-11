//! Adds the `review_plan` table: a reviewer's per-account declarative coverage
//! plan (the harness+model combinations and version-pinned test cases they want
//! covered, plus a target runs-per-cell count).
//!
//! One row per account — the auth-service `user_id` is the primary key, so saving
//! a plan upserts it in place. The two list fields are stored as JSON text
//! columns (like the `review` table's `ratings`/`checklist`), since a plan is
//! small and always read and written whole. Built from the portable schema
//! builder so it applies identically to SQLite and PostgreSQL; the timestamp is an
//! RFC 3339 string to match the other tables.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(ReviewPlan::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(ReviewPlan::UserId)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(ReviewPlan::RunsPerCell).integer().not_null())
                    .col(ColumnDef::new(ReviewPlan::CasesJson).text().not_null())
                    .col(
                        ColumnDef::new(ReviewPlan::CombinationsJson)
                            .text()
                            .not_null(),
                    )
                    .col(ColumnDef::new(ReviewPlan::UpdatedAt).string().not_null())
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(ReviewPlan::Table).to_owned())
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum ReviewPlan {
    Table,
    UserId,
    RunsPerCell,
    CasesJson,
    CombinationsJson,
    UpdatedAt,
}
