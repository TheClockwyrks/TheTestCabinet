//! Adds the `started_at` column to the `job` table: RFC 3339 of the moment the run
//! actually began, as distinct from when it was enqueued (`created_at`) or last moved
//! between states (`updated_at`).
//!
//! The column exists because the console's in-progress rows have to show a start time
//! and a duration that tick while the run is going, and neither existing timestamp is
//! that anchor. `created_at` is when the run joined the queue, so a run that waited an
//! hour behind a parallelism cap would read as an hour old the instant it started;
//! `updated_at` is rewritten by every subsequent transition, so a duration measured
//! from it would reset to zero each time the driver reported in.
//!
//! Stamped once, on the transition into `starting` (defensively on `running` for a
//! driver that skipped a state), because that is the transition the driver posts
//! immediately before it takes the `started_at` its produced record is measured from,
//! so the two name the same moment. It is the closest any transition sits to the start
//! the record itself reports: `dispatched` would bill the run for pod scheduling and
//! the image pull, and `running` would drop the setup that `run_time_seconds` counts.
//! A duration ticked from here is still elapsed wall clock, so it reads higher than
//! that recorded figure — see `JobSummary::started_at` for what the gap is made of.
//!
//! Nullable, defaulting to `NULL`, with no backfill: a job that is queued, pending, or
//! dispatched has not started, and a job already in flight when this migration lands
//! has no start time we could honestly invent. Both read as the dash the console
//! renders for a run that has not begun.
//!
//! No index. Nothing filters or sorts on it — it is read off a row the active-run list
//! already fetched, and off the job row a status update just wrote.

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
                    .add_column(ColumnDef::new(Job::StartedAt).text().null())
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
                    .drop_column(Job::StartedAt)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum Job {
    Table,
    StartedAt,
}
