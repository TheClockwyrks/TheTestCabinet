//! Adds the `held_report_json` column to the `job` table.
//!
//! A driver whose run has finished can wait hours on an artifact store that will
//! not take the run's tree, and for that whole wait the run's record exists only
//! in the driver's pod: it travels on the terminal report. So the driver hands the
//! record over with its first `storing` report, and the backend keeps it here. If
//! the driver is then lost, the backend finishes the run from the kept record
//! rather than failing a finished run as infrastructure and running it again.
//!
//! The column is nullable text and holds the report as JSON: the record, the
//! failure reason when the run failed, and whether the tree was stored once the
//! wait ended. It is `NULL` for every job whose driver never waited, which is
//! every row already stored, and is cleared when the job's own terminal report
//! lands.

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
