//! Initial schema: `run`, `review`, `run_link`, and `snapshot_state`.
//!
//! Mirrors the `SCHEMA` that previously lived inline in the backend's SQLite
//! layer, expressed through SeaORM's portable schema builder so it applies to
//! both SQLite and PostgreSQL. Two intentional differences from the old raw SQL:
//! `loaded`/`dirty` are real boolean columns (portable, instead of SQLite's
//! integer flags), and `snapshot_state` drops the SQLite-only `CHECK (id = 1)` —
//! the backend always writes id `1`.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Run::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(Run::Id).string().not_null().primary_key())
                    .col(ColumnDef::new(Run::StartedAt).string().not_null())
                    .col(ColumnDef::new(Run::FinishedAt).string().not_null())
                    .col(ColumnDef::new(Run::PublishedAt).string().not_null())
                    .col(ColumnDef::new(Run::TestCaseSlug).string().not_null())
                    .col(ColumnDef::new(Run::TestCaseVersion).string().not_null())
                    .col(ColumnDef::new(Run::Variant).string().not_null())
                    .col(ColumnDef::new(Run::HarnessSlug).string().not_null())
                    .col(ColumnDef::new(Run::HarnessVersion).string())
                    .col(ColumnDef::new(Run::ModelId).string().not_null())
                    .col(ColumnDef::new(Run::RunState).string().not_null())
                    .col(ColumnDef::new(Run::Loaded).boolean().not_null())
                    .col(ColumnDef::new(Run::RecordJson).text().not_null())
                    .col(ColumnDef::new(Run::EventsJson).text())
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_run_published_at")
                    .table(Run::Table)
                    .col(Run::PublishedAt)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_run_case")
                    .table(Run::Table)
                    .col(Run::TestCaseSlug)
                    .col(Run::TestCaseVersion)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_run_harness")
                    .table(Run::Table)
                    .col(Run::HarnessSlug)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_run_model")
                    .table(Run::Table)
                    .col(Run::ModelId)
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(Review::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Review::RunId)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(Review::Rating).string().not_null())
                    .col(ColumnDef::new(Review::Writeup).text().not_null())
                    .col(
                        ColumnDef::new(Review::Checklist)
                            .text()
                            .not_null()
                            .default("[]"),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_review_run")
                            .from(Review::Table, Review::RunId)
                            .to(Run::Table, Run::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(RunLink::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(RunLink::RunId)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(RunLink::SourceRepo).string())
                    .col(ColumnDef::new(RunLink::PlayableBuild).string())
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_run_link_run")
                            .from(RunLink::Table, RunLink::RunId)
                            .to(Run::Table, Run::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(SnapshotState::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(SnapshotState::Id)
                            .integer()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(SnapshotState::Dirty)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(ColumnDef::new(SnapshotState::LastUploaded).string())
                    .col(ColumnDef::new(SnapshotState::LastRunCount).big_integer())
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Drop in reverse dependency order (children before the parent `run`).
        manager
            .drop_table(Table::drop().table(SnapshotState::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(RunLink::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Review::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Run::Table).to_owned())
            .await?;
        Ok(())
    }
}

// `RunState` necessarily starts with the enum name — it maps to the `run_state`
// column — so the variant-naming lint does not apply here.
#[derive(DeriveIden)]
#[allow(clippy::enum_variant_names)]
enum Run {
    Table,
    Id,
    StartedAt,
    FinishedAt,
    PublishedAt,
    TestCaseSlug,
    TestCaseVersion,
    Variant,
    HarnessSlug,
    HarnessVersion,
    ModelId,
    RunState,
    Loaded,
    RecordJson,
    EventsJson,
}

#[derive(DeriveIden)]
enum Review {
    Table,
    RunId,
    Rating,
    Writeup,
    Checklist,
}

#[derive(DeriveIden)]
enum RunLink {
    Table,
    RunId,
    SourceRepo,
    PlayableBuild,
}

#[derive(DeriveIden)]
enum SnapshotState {
    Table,
    Id,
    Dirty,
    LastUploaded,
    LastRunCount,
}
