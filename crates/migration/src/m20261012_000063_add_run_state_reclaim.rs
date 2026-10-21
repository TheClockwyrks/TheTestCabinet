//! Adds the two columns the backend's state reclamation sweep writes on the `run`
//! table.
//!
//! Kept registered for the databases that applied it: staging's schema holds this
//! migration, and a migrator refuses to start over an applied migration it does
//! not list. The feature that wrote the columns is not part of this design (the
//! backend keeps no copy of a run's files and the artifacts service holds no
//! volume; see `components/backend/overview.md#durable-state`), so nothing reads
//! or writes them now. The columns are nullable or defaulted, so a row written without
//! them is valid.

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
