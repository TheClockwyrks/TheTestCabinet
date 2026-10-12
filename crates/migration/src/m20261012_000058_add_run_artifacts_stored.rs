//! Adds the `artifacts_stored` column to the `run` table.
//!
//! A run is released from the tree its driver uploaded to the artifact service, so
//! the backend records for each run whether the service holds one. The column is a
//! nullable boolean with three readings: `true` when the tree is stored, `false`
//! when it is not, and `NULL` while nothing has reported on the run. `NULL` is what
//! every row carries on a backend with no artifact service configured.
//!
//! The rows already stored start `NULL`. The backend fills them from the artifact
//! service's listing on its next reclamation sweep pass, which is not a migration's
//! work: it needs the network.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Run::Table)
                    .add_column(ColumnDef::new(Run::ArtifactsStored).boolean().null())
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Run::Table)
                    .drop_column(Run::ArtifactsStored)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum Run {
    Table,
    ArtifactsStored,
}
