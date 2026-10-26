//! Adds the `run_controller` table: an adversarial run's pushed `controller.wasm`,
//! kept in the database beside the run's row (the backend overview's "Durable
//! state").
//!
//! The driver pushes a run's controller after it uploads the run's tree and before
//! its terminal report, which is what creates the run's row, so the module arrives
//! before the row it belongs to. The table therefore keys it by the run id with no
//! foreign key back to `run`, as `job.record_id` and `publish_job.run_id` reference
//! the run by a plain column, and deleting a run deletes its controller in the same
//! transaction. The arena's controller listing joins against the run rows, so a
//! module whose run was never recorded is never offered.
//!
//! `module` holds the wasm bytes verbatim: `blob` on SQLite, `bytea` on PostgreSQL.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(RunController::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(RunController::RunId)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(RunController::Module).blob().not_null())
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(RunController::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum RunController {
    Table,
    RunId,
    Module,
}
