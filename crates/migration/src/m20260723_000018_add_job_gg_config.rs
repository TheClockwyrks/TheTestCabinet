//! Adds the `gg_config_json` column to the `job` table.
//!
//! A **gg** run is configured by a declarative capability set rather than the flat
//! `(model, orchestrator)` tuple a third-party-harness run uses. The gg enqueue
//! endpoint lifts that set out of the launch request at enqueue and stores it here
//! as JSON — a first-class, queryable column (mirroring the other identity columns
//! lifted onto `job`), so a gg job's exact configuration is inspectable without
//! parsing the opaque `request_json` blob. It is nullable and defaults to `NULL`:
//! every third-party-harness job carries no capability set, and any row already
//! queued when this migration runs reads as `NULL` and stays valid.

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
                    .add_column(ColumnDef::new(Job::GgConfigJson).text().null())
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
                    .drop_column(Job::GgConfigJson)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum Job {
    Table,
    GgConfigJson,
}
