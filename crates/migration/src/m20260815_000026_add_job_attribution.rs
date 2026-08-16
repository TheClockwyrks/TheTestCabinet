//! Adds the `user_id` and `origin` columns to the `job` table: who launched a job,
//! and what launched it.
//!
//! A job has never recorded either. `AuthUser` already carries the launching
//! account's id and the enqueue path discarded it, so nothing downstream could tell
//! one reviewer's queued runs from another's. That is tolerable while the only
//! queue controls are per-job, but it is not tolerable once a coverage plan or a
//! ladder can be **halted**: halting must cancel exactly the jobs that plan/ladder
//! put in the queue and nothing else, and there was no column that could express
//! "this job came from that plan". `origin` is that column — `plan:<id>` or
//! `ladder:<id>`, `NULL` for a run a human launched by hand from the new-run form.
//!
//! Both are nullable precisely so no backfill is needed: every row enqueued before
//! this migration reads as an unattributed manual launch, which is the safe
//! interpretation — an unattributed job is never swept up by a plan-scoped halt.
//!
//! **These columns must not enter coverage counting.** Coverage counts stay
//! *global*: a run counts toward a cell's target whoever launched it and from
//! wherever, so an existing run is never re-requested just because a different
//! account or a different plan produced it. `user_id`/`origin` exist for
//! attribution and halting only. The per-account part of the feature is
//! *judgement* (whose review exists), which lives in `review.reviewer_user_id`, not
//! here.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite only allows one column change per `ALTER TABLE`, so each column is
        // added in its own statement (this applies identically to PostgreSQL).
        //
        // `user_id` is nullable: pre-existing rows have no known launcher.
        // `origin` is nullable: a manual launch from the new-run form has no
        // originating plan or ladder, and that is the majority case.
        for column in [
            ColumnDef::new(Job::UserId).string().to_owned(),
            ColumnDef::new(Job::Origin).string().to_owned(),
        ] {
            manager
                .alter_table(
                    Table::alter()
                        .table(Job::Table)
                        .add_column(column)
                        .to_owned(),
                )
                .await?;
        }

        // Halting reads `origin = 'plan:<id>' AND state IN (…)` — the queued/pending
        // subset for one plan — and the plan dashboard counts its own in-flight jobs
        // the same way. Leading with `origin` keeps that scan off the full job table,
        // which grows without bound while any one plan's slice stays small.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_job_origin_state")
                    .table(Job::Table)
                    .col(Job::Origin)
                    .col(Job::State)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name("idx_job_origin_state")
                    .table(Job::Table)
                    .to_owned(),
            )
            .await?;
        for column in [Job::Origin, Job::UserId] {
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

#[derive(DeriveIden)]
enum Job {
    Table,
    State,
    UserId,
    Origin,
}
