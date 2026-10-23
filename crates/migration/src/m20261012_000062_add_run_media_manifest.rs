//! Adds the two columns a run's media confirmation gained when it widened to
//! every file of the run.
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
        manager
            .alter_table(
                Table::alter()
                    .table(Run::Table)
                    .add_column(
                        ColumnDef::new(Run::MediaConfirmationVersion)
                            .integer()
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Run::Table)
                    .add_column(ColumnDef::new(Run::MediaManifest).text().null())
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for column in [Run::MediaManifest, Run::MediaConfirmationVersion] {
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
    MediaConfirmationVersion,
    MediaManifest,
}
