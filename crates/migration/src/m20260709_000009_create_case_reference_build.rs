//! Adds the `case_reference_build` table: the deployed URL of a test-case
//! variant's **reference implementation** (the authored, correct build of that
//! variant, the case-variant analogue of a run's `playableBuild`).
//!
//! One row per `(slug, version, variant)` triple — the composite primary key — so
//! a re-deploy of the same variant upserts its `url` in place. A variant that does
//! not declare a `reference_implementation` simply has no row. Built from the
//! portable schema builder so it applies identically to SQLite and PostgreSQL, and
//! timestamps are stored as RFC 3339 strings to match the model-catalog tables.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(CaseReferenceBuild::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(CaseReferenceBuild::Slug).string().not_null())
                    .col(
                        ColumnDef::new(CaseReferenceBuild::Version)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(CaseReferenceBuild::Variant)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(CaseReferenceBuild::Url).text().not_null())
                    .col(
                        ColumnDef::new(CaseReferenceBuild::UpdatedAt)
                            .string()
                            .not_null(),
                    )
                    .primary_key(
                        Index::create()
                            .col(CaseReferenceBuild::Slug)
                            .col(CaseReferenceBuild::Version)
                            .col(CaseReferenceBuild::Variant),
                    )
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(CaseReferenceBuild::Table).to_owned())
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum CaseReferenceBuild {
    Table,
    Slug,
    Version,
    Variant,
    Url,
    UpdatedAt,
}
