//! Adds the `publish_job` table: the backend's **publish** queue. A publish job is
//! a request to release an already-pushed, reviewed run to its public GitHub repo +
//! Cloudflare Pages — enqueued by `POST /runs/{id}/publish`, claimed by the
//! dispatcher (`POST /publish-jobs/next`), and carried out by a per-publish
//! `tcab-publisher` Job that reports its result back. This is the publish path's
//! analogue of the `job` (run) queue; it references an existing run by id rather
//! than carrying a launch request, and records the links the release produced.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(PublishJob::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(PublishJob::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    // queued | dispatched | succeeded | failed
                    .col(ColumnDef::new(PublishJob::State).string().not_null())
                    // The run this publish job releases (the `run` table's id).
                    .col(ColumnDef::new(PublishJob::RunId).string().not_null())
                    // The per-job bearer token the publisher reports its result with.
                    .col(ColumnDef::new(PublishJob::JobToken).string().not_null())
                    // The links the release produced, set on success.
                    .col(ColumnDef::new(PublishJob::SourceRepo).string().null())
                    .col(ColumnDef::new(PublishJob::PlayableBuild).string().null())
                    // A terminal failure reason, when the publish failed.
                    .col(ColumnDef::new(PublishJob::Detail).text().null())
                    .col(ColumnDef::new(PublishJob::CreatedAt).string().not_null())
                    .col(ColumnDef::new(PublishJob::UpdatedAt).string().not_null())
                    .to_owned(),
            )
            .await?;

        // The dispatcher claims the oldest queued publish job; this index serves
        // both the state filter and the created-at ordering of that query.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_publish_job_state_created")
                    .table(PublishJob::Table)
                    .col(PublishJob::State)
                    .col(PublishJob::CreatedAt)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(PublishJob::Table).to_owned())
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
#[allow(clippy::enum_variant_names)]
enum PublishJob {
    Table,
    Id,
    State,
    RunId,
    JobToken,
    SourceRepo,
    PlayableBuild,
    Detail,
    CreatedAt,
    UpdatedAt,
}
