//! Adds the `artifacts_stored` column to the `run` table, the earlier of the
//! two migrations of that meaning.
//!
//! Staging's schema applied it before the column's meaning settled, and a
//! migrator refuses to start over an applied migration it does not list, so it
//! stays registered. The column is the one
//! `m20261019_000060_add_run_artifacts_stored` describes, and a database that
//! already has it, whichever of the two added it, is left as it is, and rolling
//! back past both drops it once.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_column("run", "artifacts_stored").await? {
            return Ok(());
        }
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
        // The later migration of the same column drops it first on the way down.
        if !manager.has_column("run", "artifacts_stored").await? {
            return Ok(());
        }
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
