//! Adds the `job_event` table: every normalized event a job's driver delivered, stored
//! as it arrives (the driver's events page, "Delivery to the backend").
//!
//! The driver numbers a job's events from `0`, one per event, and posts them in batches
//! that each carry the sequence of their first event. The backend writes every event of
//! a batch here, keyed by `(job_id, sequence)`, before it answers, so a resent batch is
//! idempotent and the stream survives a restart. A job's rows, in sequence order, are
//! its recorded stream: a live subscriber is replayed them, and the run's events are
//! built from them when the run is recorded. A job that ends with no run record keeps
//! them all the same; they go only with the job row itself, through the foreign key's
//! `ON DELETE CASCADE`.
//!
//! `event_json` holds one `HarnessEvent` serialized verbatim.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(JobEvent::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(JobEvent::JobId).string().not_null())
                    .col(ColumnDef::new(JobEvent::Sequence).big_integer().not_null())
                    .col(ColumnDef::new(JobEvent::EventJson).text().not_null())
                    .primary_key(Index::create().col(JobEvent::JobId).col(JobEvent::Sequence))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_job_event_job")
                            .from(JobEvent::Table, JobEvent::JobId)
                            .to(Job::Table, Job::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(JobEvent::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum JobEvent {
    Table,
    JobId,
    Sequence,
    EventJson,
}

#[derive(DeriveIden)]
enum Job {
    Table,
    Id,
}
