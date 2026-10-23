//! Adds the `artifacts_stored` column to the `run` table.
//!
//! The driver's terminal report says whether the artifacts service acknowledged the
//! run's tree (`artifactsStored`), and the backend records it on the run. The column
//! is a nullable boolean with three readings: `true` when the tree is stored, `false`
//! when it is not, and `NULL` while no report has said, which is what every row
//! already stored and every run of a driver with no artifacts service carries.
//!
//! A database that already has the column is left as it is: production's schema
//! gained it from an earlier migration of the same meaning on another branch.

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
