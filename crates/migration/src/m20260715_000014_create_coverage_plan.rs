//! Adds the `coverage_plan` table: a reviewer's named declarative coverage plan.
//!
//! Unlike the legacy per-account `review_plan` (one row per account), an account
//! may hold many coverage plans — each with its own opaque id, name, and target
//! runs-per-cell — so the model space can be split into smaller, separately
//! triggerable plans ("Anthropic/E2E", "OpenAI/2D", …). A plan is **hybrid**: it
//! references reusable `coverage_group`s as pointers (`combo_group_ids_json` /
//! `case_group_ids_json`) and may also pin individual one-off members
//! (`combos_json` / `cases_json`); the backend unions and de-dupes them when it
//! builds the coverage matrix. All list fields are JSON text, read and written
//! whole like the other plan/review columns. Built from the portable schema builder
//! so it applies identically to SQLite and PostgreSQL; the timestamp is an RFC 3339
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
                    .table(CoveragePlan::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(CoveragePlan::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(CoveragePlan::UserId).string().not_null())
                    .col(ColumnDef::new(CoveragePlan::Name).string().not_null())
                    .col(ColumnDef::new(CoveragePlan::RunsPerCell).integer().not_null())
                    .col(
                        ColumnDef::new(CoveragePlan::ComboGroupIdsJson)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(CoveragePlan::CaseGroupIdsJson)
                            .text()
                            .not_null(),
                    )
                    .col(ColumnDef::new(CoveragePlan::CombosJson).text().not_null())
                    .col(ColumnDef::new(CoveragePlan::CasesJson).text().not_null())
                    .col(ColumnDef::new(CoveragePlan::UpdatedAt).string().not_null())
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_coverage_plan_user")
                    .table(CoveragePlan::Table)
                    .col(CoveragePlan::UserId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(CoveragePlan::Table).to_owned())
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum CoveragePlan {
    Table,
    Id,
    UserId,
    Name,
    RunsPerCell,
    ComboGroupIdsJson,
    CaseGroupIdsJson,
    CombosJson,
    CasesJson,
    UpdatedAt,
}
