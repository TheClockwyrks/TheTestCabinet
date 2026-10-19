//! Adds the `lease_expires_at` column to the `publish_job` table.
//!
//! A claimed publish job carries a lease like a claimed run: an expiry the backend
//! stores on the publish job's row. The claim sets it two minutes out, and the
//! dispatcher renews it each tick for every publish job whose publisher `Job` is live.
//! A `dispatched` publish job whose lease lapsed is reported lost by the dispatcher,
//! and the backend records it failed (the backend results page's "A publisher that
//! stops").
//!
//! The column is nullable text holding an RFC 3339 UTC instant written at whole-second
//! precision (`YYYY-MM-DDTHH:MM:SSZ`). `NULL` while the publish job has never been
//! claimed and on every row already in flight when the column was added, which reads
//! as a lapsed lease: the dispatcher's first renewal gives each such publish job whose
//! publisher `Job` is still live a lease before anything is judged.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(PublishJob::Table)
                    .add_column(ColumnDef::new(PublishJob::LeaseExpiresAt).text().null())
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(PublishJob::Table)
                    .drop_column(PublishJob::LeaseExpiresAt)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum PublishJob {
    Table,
    LeaseExpiresAt,
}
