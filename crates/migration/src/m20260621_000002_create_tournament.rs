//! Adds the `tournament` table: one persisted adversarial tournament, holding the
//! verbatim `TournamentRecord` JSON plus lifted columns for ordering/pagination.
//!
//! A tournament references runs and baselines by id string, not by DB relation, so
//! there is no foreign key. Mirrors the `run` table's `published_at` cursor index.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Tournament::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Tournament::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(Tournament::PublishedAt).string().not_null())
                    .col(ColumnDef::new(Tournament::CreatedAt).string().not_null())
                    .col(ColumnDef::new(Tournament::TestCaseSlug).string().not_null())
                    .col(
                        ColumnDef::new(Tournament::TestCaseVersion)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(Tournament::Variant).string().not_null())
                    .col(
                        ColumnDef::new(Tournament::ParticipantCount)
                            .integer()
                            .not_null(),
                    )
                    .col(ColumnDef::new(Tournament::RecordJson).text().not_null())
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_tournament_published_at")
                    .table(Tournament::Table)
                    .col(Tournament::PublishedAt)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_tournament_case")
                    .table(Tournament::Table)
                    .col(Tournament::TestCaseSlug)
                    .col(Tournament::TestCaseVersion)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Tournament::Table).to_owned())
            .await?;
        Ok(())
    }
}

// `TestCase*` variants share a prefix by necessity (they map to the `test_case_*`
// columns), so the variant-naming lint does not apply.
#[derive(DeriveIden)]
#[allow(clippy::enum_variant_names)]
enum Tournament {
    Table,
    Id,
    PublishedAt,
    CreatedAt,
    TestCaseSlug,
    TestCaseVersion,
    Variant,
    ParticipantCount,
    RecordJson,
}
