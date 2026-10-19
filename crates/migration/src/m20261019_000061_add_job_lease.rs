//! Adds the `lease_expires_at` column to the `job` table.
//!
//! Every claimed run carries a lease: an expiry the backend stores on the job's row.
//! The claim sets it two minutes out, and the dispatcher renews it each tick for every
//! job whose driver `Job` is live. A `dispatched` job whose lease lapsed returns to the
//! queue on the next claim, and a job past `dispatched` whose lease lapsed is reported
//! lost by the dispatcher.
//!
//! The column is nullable text holding an RFC 3339 UTC instant written at whole-second
//! precision (`YYYY-MM-DDTHH:MM:SSZ`), so two expiries compare chronologically as
//! strings. `NULL` while the job has never been claimed, after a lapsed claim returned
//! it to the queue, and on every row already in flight when the column was added,
//! which reads as a lapsed lease: the dispatcher's first renewal gives each such job
//! whose driver `Job` is still live a lease before anything is judged.

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
                    .add_column(ColumnDef::new(Job::LeaseExpiresAt).text().null())
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Job::Table)
                    .drop_column(Job::LeaseExpiresAt)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum Job {
    Table,
    LeaseExpiresAt,
}
