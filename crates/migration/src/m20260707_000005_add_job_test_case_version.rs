//! Adds the `test_case_version` column to the `job` table.
//!
//! Like the other identity columns on `job` (`test_case_slug`, `variant`,
//! `harness_slug`, `model_id`), the version is lifted out of the launch request at
//! enqueue so the active-run list can describe an in-flight job — including which
//! case version it targets — without parsing the request blob. It carries a `""`
//! default so any rows already queued when this migration runs stay valid; every
//! enqueue after this sets the real version.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Job::Table)
                    .add_column(
                        ColumnDef::new(Job::TestCaseVersion)
                            .string()
                            .not_null()
                            .default(""),
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
                    .table(Job::Table)
                    .drop_column(Job::TestCaseVersion)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum Job {
    Table,
    TestCaseVersion,
}
