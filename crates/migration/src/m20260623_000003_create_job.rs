//! Adds the `job` table: the backend's run **queue**. A job is a requested run
//! awaiting (or undergoing) execution — enqueued by a console, claimed by the
//! dispatcher, and driven by a per-run Job pod that streams progress back. This
//! is the durable control-plane state; the live event/preview fan-out it feeds is
//! in-memory (see `crates/backend/src/relay.rs`) and not persisted.
//!
//! The produced `RunRecord` lands in the `run` table on success (the same store a
//! locally-driven `tcab` run pushes to), so a job holds only the lifecycle: the
//! request to run, the state machine, the per-job token the driver authenticates
//! with, and lifted columns for the active-run list.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Job::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(Job::Id).string().not_null().primary_key())
                    // queued | dispatched | running | succeeded | failed | canceled
                    .col(ColumnDef::new(Job::State).string().not_null())
                    // The serialized launch request (the `RunRequest` HTTP shape).
                    .col(ColumnDef::new(Job::RequestJson).text().not_null())
                    // Lifted from the request so the active-run list can describe a
                    // job without parsing the blob.
                    .col(ColumnDef::new(Job::TestCaseSlug).string().not_null())
                    .col(ColumnDef::new(Job::Variant).string().not_null())
                    .col(ColumnDef::new(Job::HarnessSlug).string().not_null())
                    .col(ColumnDef::new(Job::ModelId).string().not_null())
                    // The per-job bearer token the driver presents to stream
                    // events/preview/status for exactly this job.
                    .col(ColumnDef::new(Job::JobToken).string().not_null())
                    // The produced run record's id, once the job succeeds (the row
                    // the console navigates to). NULL until then.
                    .col(ColumnDef::new(Job::RecordId).string().null())
                    // A terminal failure reason, when the job failed.
                    .col(ColumnDef::new(Job::Detail).text().null())
                    .col(ColumnDef::new(Job::CreatedAt).string().not_null())
                    .col(ColumnDef::new(Job::UpdatedAt).string().not_null())
                    .to_owned(),
            )
            .await?;

        // The dispatcher claims the oldest queued job; this index serves both the
        // state filter and the created-at ordering of that query.
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

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Job::Table).to_owned())
            .await?;
        Ok(())
    }
}

// `TestCase*`/lifted columns share prefixes by necessity (they map to the
// `test_case_*` and `*_id` columns), so the variant-naming lint does not apply.
#[derive(DeriveIden)]
#[allow(clippy::enum_variant_names)]
enum Job {
    Table,
    Id,
    State,
    RequestJson,
    TestCaseSlug,
    Variant,
    HarnessSlug,
    ModelId,
    JobToken,
    RecordId,
    Detail,
    CreatedAt,
    UpdatedAt,
}
