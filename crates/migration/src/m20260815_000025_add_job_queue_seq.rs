//! Adds the `queue_seq` column to the `job` table: the queue's ordering key.
//!
//! The claim used to order by `(created_at, id)`, which is not the order runs were
//! enqueued in. Two reasons: every job of one `POST /jobs/batch` is stamped with the
//! *same* `created_at`, so the whole batch tie-breaks on `id` — a random UUID — and
//! `created_at` is a *string* whose RFC 3339 subsecond part is variable-length, so
//! even distinct timestamps do not always compare chronologically (`…:00.55Z` sorts
//! before `…:00.5Z`). The visible effect was a batch of repeated runs starting, and
//! so finishing, in an arbitrary order.
//!
//! `queue_seq` is a backend-minted monotonic integer — one per enqueued job, handed
//! out in request order — so ordering by it is exactly enqueue order regardless of
//! clock resolution or timestamp encoding. It carries a `0` default so rows already
//! queued when this migration runs stay valid and sort ahead of everything minted
//! afterwards, which is what they are: older.

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
                    .add_column(
                        ColumnDef::new(Job::QueueSeq)
                            .big_integer()
                            .not_null()
                            .default(0i64),
                    )
                    .to_owned(),
            )
            .await?;

        // The claim (and the active-run list) scans jobs in a state filter, ordered
        // by queue position; this index serves both, exactly as
        // `idx_job_state_created` did for the ordering it replaces.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_job_state_queue_seq")
                    .table(Job::Table)
                    .col(Job::State)
                    .col(Job::QueueSeq)
                    .to_owned(),
            )
            .await?;

        // Minting the next sequence number reads `MAX(queue_seq)` over the whole
        // table — every job ever enqueued, not just the waiting ones — so it needs an
        // index the state-scoped one above cannot serve.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_job_queue_seq")
                    .table(Job::Table)
                    .col(Job::QueueSeq)
                    .to_owned(),
            )
            .await?;

        // `idx_job_state_created` existed only for the `(state, created_at)` claim
        // ordering, which nothing performs any more; leaving it would cost a write on
        // every insert and on each of the many row updates a claim sweep makes.
        manager
            .drop_index(
                Index::drop()
                    .name("idx_job_state_created")
                    .table(Job::Table)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_job_state_created")
                    .table(Job::Table)
                    .col(Job::State)
                    .col(Job::CreatedAt)
                    .to_owned(),
            )
            .await?;
        for index in ["idx_job_queue_seq", "idx_job_state_queue_seq"] {
            manager
                .drop_index(Index::drop().name(index).table(Job::Table).to_owned())
                .await?;
        }
        manager
            .alter_table(
                Table::alter()
                    .table(Job::Table)
                    .drop_column(Job::QueueSeq)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum Job {
    Table,
    State,
    QueueSeq,
    CreatedAt,
}
