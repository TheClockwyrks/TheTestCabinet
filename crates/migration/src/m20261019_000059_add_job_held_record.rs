//! Adds the held record and the lost mark to the `job` table.
//!
//! A driver hands its finished run to the backend with a `storing` report before it
//! uploads anything, and the backend keeps that report's record and failure detail on
//! the job's row (`held_record`, `held_detail`) so the result survives the driver. A
//! job the dispatcher then reports lost, or dead, is finished from them with the state
//! the run reached and is never retried.
//!
//! `lost_at` records when the dispatcher reported the job lost, so a terminal report
//! that reaches the backend afterwards is told apart from a repeat of the driver's own:
//! it supersedes the lost outcome and withdraws the retry that outcome enqueued.
//!
//! All three are nullable text, `NULL` on every row already stored. Each is added by
//! its own statement, since SQLite alters one column at a time.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for column in [Job::HeldRecord, Job::HeldDetail, Job::LostAt] {
            manager
                .alter_table(
                    Table::alter()
                        .table(Job::Table)
                        .add_column(ColumnDef::new(column).text().null())
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for column in [Job::LostAt, Job::HeldDetail, Job::HeldRecord] {
            manager
                .alter_table(
                    Table::alter()
                        .table(Job::Table)
                        .drop_column(column)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

#[derive(DeriveIden, Clone, Copy)]
enum Job {
    Table,
    HeldRecord,
    HeldDetail,
    LostAt,
}
