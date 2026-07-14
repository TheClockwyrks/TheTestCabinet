//! Adds the `attempt` column to the `job` table.
//!
//! An `attempt` counter records which try a job is: `0` for the run the console
//! launched, then `1`, `2`, … for each automatic retry the backend re-enqueues
//! after a terminal infrastructure or catastrophic failure (see
//! [`update_status`](../../test_cabinet_backend/api/jobs/fn.update_status.html)).
//! It is bounded against the launch request's `retryCount`, so the retry chain
//! always terminates. It carries a `0` default so any rows already queued when this
//! migration runs stay valid — an existing job reads as the original attempt; every
//! enqueue after this sets it explicitly.

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
                    .add_column(ColumnDef::new(Job::Attempt).integer().not_null().default(0))
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
                    .drop_column(Job::Attempt)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum Job {
    Table,
    Attempt,
}
