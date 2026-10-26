//! Adds the two tables the replicas' announcements read through (the backend
//! overview's "Replicas"):
//!
//! - `job_preview`, the latest live preview frame per job and frame index, stored
//!   before a frame is acknowledged so a subscriber connected to any replica is
//!   sent the current frames, and deleted once the job ends;
//! - `relay_overflow`, an announcement whose payload exceeds PostgreSQL's
//!   notification limit, announced by its key and read back by every other
//!   replica.
//!
//! Only a PostgreSQL deployment writes either; a SQLite one runs one replica and
//! announces nothing, and holds the tables empty.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(JobPreview::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(JobPreview::JobId).string().not_null())
                    .col(ColumnDef::new(JobPreview::Frame).big_integer().not_null())
                    .col(ColumnDef::new(JobPreview::PreviewJson).text().not_null())
                    .primary_key(
                        Index::create()
                            .col(JobPreview::JobId)
                            .col(JobPreview::Frame),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_table(
                Table::create()
                    .table(RelayOverflow::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(RelayOverflow::Id)
                            .big_integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(RelayOverflow::Payload).text().not_null())
                    .col(ColumnDef::new(RelayOverflow::CreatedAt).string().not_null())
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(RelayOverflow::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(JobPreview::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum JobPreview {
    Table,
    JobId,
    Frame,
    PreviewJson,
}

#[derive(DeriveIden)]
enum RelayOverflow {
    Table,
    Id,
    Payload,
    CreatedAt,
}
