//! Adds the two columns the backend's state reclamation sweep writes on the `run`
//! table.
//!
//! - `state_reclaimed_at`: RFC 3339 of when the sweep removed the run's files from
//!   the backend's own store on purpose. `NULL` for a run whose files were never
//!   reclaimed, and `NULL` again once the run's record is stored again or a file
//!   is uploaded for it.
//! - `state_reclaimed_reason`: why (`published`, `failed` or `canceled`); set
//!   together with `state_reclaimed_at`.
//!
//! Every existing row starts with both `NULL`. Each is its own statement because
//! SQLite adds one column per `ALTER TABLE`.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for column in [Run::StateReclaimedAt, Run::StateReclaimedReason] {
            manager
                .alter_table(
                    Table::alter()
                        .table(Run::Table)
                        .add_column(ColumnDef::new(column).string().null())
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for column in [Run::StateReclaimedReason, Run::StateReclaimedAt] {
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

#[derive(DeriveIden, Clone, Copy)]
enum Run {
    Table,
    StateReclaimedAt,
    StateReclaimedReason,
}
