//! Adds the `held_report_json` column to the `job` table.
//!
//! Kept registered for the databases that applied it: staging's schema holds this
//! migration, and a migrator refuses to start over an applied migration it does
//! not list. The feature that wrote the column is not part of this design (the
//! backend keeps no copy of a run's files and the artifacts service holds no
//! volume; see `components/backend/overview.md#durable-state`), so nothing reads
//! or writes it now. The column is nullable or defaulted, so a row written without
//! it is valid.

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
                    .add_column(ColumnDef::new(Job::HeldReportJson).text().null())
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Job::Table)
                    .drop_column(Job::HeldReportJson)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum Job {
    Table,
    HeldReportJson,
}
